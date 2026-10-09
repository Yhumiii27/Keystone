// MS Project XML (MSPDI, Project 2003+ schema) reader and writer (chapter 4, S-9). Pure: text in, neutral schedule out
// (./model.ts), and back. The reader maps the WBS (summary tasks), activities, durations, logic links with lags, calendars
// (week days, working times, exceptions), constraints, baselines 0–10, % complete, actual dates, costs, resources and
// assignments; everything else is listed in `unmapped`. The writer produces a file MS Project opens ("Export — MS Project
// XML": the project schedule with its displayed baseline as Baseline 0), and the reader reads it back unchanged (round trip).
//
// Conventions of the format: durations are ISO 8601 hours ("PT40H0M0S") counted on the project's MinutesPerDay; link lags
// are in tenths of minutes (LinkLag) with a LagFormat; costs are in hundredths of the currency unit; the Activity ID of
// Keystone travels in a text field aliased "Activity ID" (Text1, field 188743731), as P6 ↔ MS Project exchanges do.
import { XMLParser } from 'fast-xml-parser';
import { isConstraintType, type LinkType } from '@/server/db/codes';
import { fmt } from './messages';
import {
  MAX_IMPORT_ACTIVITIES, clip, daysOfHours, isoOfStamp, numOf, type ImportedActivity, type ImportedAssignment, type ImportedCalendar, type ImportedLink,
  type ImportedResource, type ImportedResourceType, type ImportedSchedule, type ImportedWbs, type IsoDate,
} from './model';

/** Field id of Text1, the custom field that carries the Activity ID (aliased "Activity ID"). */
export const ACTIVITY_ID_FIELD = '188743731';
const ACTIVITY_ID_ALIAS = /^(activity\s*id|activity\s*code|id\s*(d['’]|de\s+l['’]\s*)?activit[eé]|code\s*(d['’])?activit[eé])$/i;

/** MSPDI ConstraintType → Keystone code (1 = As late as possible: not scheduled by Keystone). */
const CONSTRAINT_IN: Record<string, string | null> = { '0': null, '1': null, '2': 'MSO', '3': 'MFO', '4': 'SNET', '5': 'SNLT', '6': 'FNET', '7': 'FNLT' };
const CONSTRAINT_OUT: Record<string, number> = { ASAP: 0, MSO: 2, MFO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 };
/** MSPDI link Type: 0 FF, 1 FS, 2 SF, 3 SS. */
const LINK_IN: Record<string, LinkType> = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' };
const LINK_OUT: Record<LinkType, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };
/** Lag formats counted in elapsed (calendar) time, and percent formats (LagFormat; +35 = estimated variants). */
const ELAPSED_LAG = new Set([4, 6, 8, 10, 12, 39, 41, 43, 45, 47]);
const PERCENT_LAG = new Set([19, 20, 53, 54]);

const ARRAYS = new Set([
  'Task', 'Calendar', 'WeekDay', 'WorkingTime', 'PredecessorLink', 'Baseline', 'ExtendedAttribute', 'Resource', 'Assignment', 'Exception', 'WorkWeek',
]);

type Node = Record<string, unknown>;
const arr = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : v && typeof v === 'object' ? [v as Node] : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const flag = (v: unknown) => str(v) === '1' || str(v).toLowerCase() === 'true';

/** Hours of an ISO 8601 duration ("PT40H0M0S", "PT0H30M0S", "P2DT4H"); null when absent or malformed. */
export function hoursOfDuration(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(-)?P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s);
  if (!m) return null;
  const n = (x: string | undefined) => (x ? parseFloat(x) : 0);
  const h = n(m[4]) * 24 + n(m[5]) + n(m[6]) / 60 + n(m[7]) / 3600;
  return m[1] ? -h : h;
}

/** "HH:MM:SS" → hours since midnight ("00:00:00" as an end time = 24). */
function hoursOfTime(v: unknown, isEnd: boolean): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(str(v));
  if (!m) return null;
  const h = +m[1] + +m[2] / 60;
  return isEnd && h === 0 ? 24 : h;
}

function* daysBetween(from: IsoDate, to: IsoDate, max = 3700): Generator<IsoDate> {
  let t = Date.parse(from + 'T00:00:00Z');
  const end = Date.parse(to + 'T00:00:00Z');
  for (let i = 0; t <= end && i < max; i++, t += 86_400_000) yield new Date(t).toISOString().slice(0, 10);
}

/** Finish date of a timestamp: work ending at 00:00 belongs to the previous day. */
function finishOf(v: unknown, durationHours: number | null): IsoDate | null {
  const iso = isoOfStamp(v);
  if (!iso) return null;
  if (/T00:00(:00)?$/.test(str(v)) && (durationHours ?? 1) > 0) return new Date(Date.parse(iso + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);
  return iso;
}

const isoWeekdayOfDayType = (dt: number) => (dt === 1 ? 7 : dt - 1);

interface RawCalendar {
  uid: string;
  name: string;
  base: string | null;
  isBase: boolean;
  /** ISO weekday → hours (0 = not worked); absent = inherited. */
  days: Map<number, number>;
  exceptions: { date: IsoDate; working: boolean; name: string }[];
}

function readCalendar(c: Node): RawCalendar {
  const days = new Map<number, number>();
  const exceptions: RawCalendar['exceptions'] = [];
  const hoursOf = (n: Node) =>
    arr((n.WorkingTimes as Node | undefined)?.WorkingTime).reduce((sum, w) => {
      const a = hoursOfTime(w.FromTime, false);
      const b = hoursOfTime(w.ToTime, true);
      return a != null && b != null && b > a ? sum + (b - a) : sum;
    }, 0);
  for (const wd of arr((c.WeekDays as Node | undefined)?.WeekDay)) {
    const dt = numOf(str(wd.DayType));
    if (dt == null) continue;
    const working = flag(wd.DayWorking);
    if (dt >= 1 && dt <= 7) days.set(isoWeekdayOfDayType(dt), working ? hoursOf(wd) || -1 : 0);
    else if (dt === 0) {
      // Project 2003: exceptions are WeekDay entries of type 0 with a time period.
      const tp = wd.TimePeriod as Node | undefined;
      const from = isoOfStamp(tp?.FromDate);
      const to = isoOfStamp(tp?.ToDate) ?? from;
      if (from && to) for (const d of daysBetween(from, to)) exceptions.push({ date: d, working, name: '' });
    }
  }
  for (const ex of arr((c.Exceptions as Node | undefined)?.Exception)) {
    const tp = ex.TimePeriod as Node | undefined;
    const from = isoOfStamp(tp?.FromDate);
    const to = isoOfStamp(tp?.ToDate) ?? from;
    if (!from || !to) continue;
    const working = flag(ex.DayWorking);
    for (const d of daysBetween(from, to)) exceptions.push({ date: d, working, name: str(ex.Name) });
  }
  const base = str(c.BaseCalendarUID);
  return { uid: str(c.UID), name: str(c.Name) || `Calendar ${str(c.UID)}`, base: base && base !== '-1' ? base : null, isBase: flag(c.IsBaseCalendar), days, exceptions };
}

/** Resolves inheritance (derived calendars take the base calendar's week days and exceptions first). */
function resolveCalendars(raw: RawCalendar[], defaultHours: number): ImportedCalendar[] {
  const byUid = new Map(raw.map((c) => [c.uid, c]));
  const resolveDays = (c: RawCalendar, depth = 0): Map<number, number> => {
    const base = c.base && depth < 5 ? byUid.get(c.base) : undefined;
    const days = base ? new Map(resolveDays(base, depth + 1)) : new Map<number, number>();
    for (const [k, v] of c.days) days.set(k, v);
    return days;
  };
  return raw.map((c) => {
    const days = resolveDays(c);
    if (!days.size) for (const d of [1, 2, 3, 4, 5]) days.set(d, defaultHours);
    const workDays = [...days.entries()].filter(([, h]) => h !== 0).map(([d]) => d).sort();
    const hours = [...days.values()].filter((h) => h > 0);
    const hoursPerDay = hours.length ? Math.max(...hours) : defaultHours;
    const base = c.base ? byUid.get(c.base) : undefined;
    const seen = new Map<string, { date: IsoDate; working: boolean; name: string }>();
    for (const e of [...(base?.exceptions ?? []), ...c.exceptions]) seen.set(e.date, e);
    return {
      uid: c.uid, name: c.name, workDays: workDays.length ? workDays : [1, 2, 3, 4, 5], hoursPerDay: Math.min(24, Math.max(0.5, hoursPerDay)),
      exceptions: [...seen.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    };
  });
}

/** Parses an MSPDI document. Throws an Error with an EN message when the text is not MS Project XML. */
export function parseMspdi(xml: string): ImportedSchedule {
  const text = xml.replace(/^﻿/, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(text.slice(0, 4096))) throw new Error(fmt('The file contains a DOCTYPE declaration, which is not accepted'));
  let doc: Node;
  try {
    doc = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true, isArray: (n) => ARRAYS.has(n) }).parse(text) as Node;
  } catch {
    throw new Error(fmt('The file is not an MS Project XML file (MSPDI)'));
  }
  const p = doc.Project as Node | undefined;
  if (!p || typeof p !== 'object' || !('Tasks' in p || 'Calendars' in p || 'Name' in p)) throw new Error(fmt('The file is not an MS Project XML file (MSPDI)'));

  const minutesPerDay = numOf(str(p.MinutesPerDay)) ?? 480;
  const hpd = minutesPerDay > 0 ? minutesPerDay / 60 : 8;
  const unmapped: string[] = [];
  const warnings: string[] = [];

  // Custom fields: the one aliased "Activity ID" carries the activity code; the others are reported.
  const attrDefs = arr((p.ExtendedAttributes as Node | undefined)?.ExtendedAttribute);
  const idField = attrDefs.find((a) => ACTIVITY_ID_ALIAS.test(str(a.Alias)))?.FieldID;
  const activityIdField = idField != null ? str(idField) : null;
  const otherFields = new Set<string>();

  // Calendars (resource calendars are kept only when a task uses them).
  const rawCalendars = arr((p.Calendars as Node | undefined)?.Calendar).map(readCalendar);
  const tasksRaw = arr((p.Tasks as Node | undefined)?.Task).filter((t) => !flag(t.IsNull));

  const wbs: ImportedWbs[] = [];
  const activities: ImportedActivity[] = [];
  const links: ImportedLink[] = [];
  /** Outline stack: summary UIDs by level. */
  const stack: { level: number; uid: string | null }[] = [];
  let alap = 0;
  let deadlines = 0;
  let elapsed = 0;
  let percent = 0;
  let crossProject = 0;
  let skippedTasks = 0;
  const usedCalendars = new Set<string>();

  for (const t of tasksRaw) {
    const uid = str(t.UID);
    const level = numOf(str(t.OutlineLevel)) ?? 1;
    if (uid === '0' || level === 0) continue; // project summary task
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].uid : null;
    if (flag(t.Summary)) {
      wbs.push({ uid, code: str(t.WBS) || str(t.OutlineNumber), name: str(t.Name), parentUid: parent, position: wbs.length });
      stack.push({ level, uid });
      continue;
    }
    if (str(t.Active) === '0' || flag(t.ExternalTask)) {
      skippedTasks++;
      continue;
    }
    if (activities.length >= MAX_IMPORT_ACTIVITIES) throw new Error(fmt('The file has more than {0} activities', MAX_IMPORT_ACTIVITIES));
    const durH = hoursOfDuration(t.Duration);
    // Keystone's milestones are the zero-duration activities (a "milestone" flag on a task with a duration keeps the duration).
    const durationDays = durH == null || durH <= 0 ? 0 : Math.max(1, daysOfHours(durH, hpd));
    const milestone = durationDays === 0;
    const remH = hoursOfDuration(t.RemainingDuration);
    const ct = str(t.ConstraintType);
    if (ct === '1') alap++;
    const cType = CONSTRAINT_IN[ct] ?? null;
    if (str(t.Deadline)) deadlines++;
    const cal = str(t.CalendarUID);
    if (cal && cal !== '-1') usedCalendars.add(cal);
    let activityId: string | null = null;
    for (const ea of arr(t.ExtendedAttribute)) {
      const fid = str(ea.FieldID);
      if (activityIdField && fid === activityIdField) activityId = str(ea.Value) || null;
      else if (fid) otherFields.add(fid);
    }
    const cents = (v: unknown) => {
      const n = numOf(str(v));
      return n == null ? null : n / 100 / 1000;
    };
    const baselines = arr(t.Baseline)
      .map((b) => {
        const bd = hoursOfDuration(b.Duration);
        return {
          number: numOf(str(b.Number)) ?? 0, start: isoOfStamp(b.Start), finish: finishOf(b.Finish, bd), durationDays: bd == null ? null : daysOfHours(bd, hpd), costKeur: cents(b.Cost),
        };
      })
      .filter((b) => b.number >= 0 && b.number <= 10 && (b.start || b.finish))
      .sort((a, b) => a.number - b.number);
    const pct = Math.max(0, Math.min(100, Math.round(numOf(str(t.PercentComplete)) ?? 0)));
    const totalSlack = numOf(str(t.TotalSlack));
    activities.push({
      uid, activityId, name: str(t.Name), wbsUid: parent, durationDays,
      start: isoOfStamp(t.Start), finish: finishOf(t.Finish, durH), actualStart: isoOfStamp(t.ActualStart), actualFinish: finishOf(t.ActualFinish, durH),
      percentComplete: pct, remainingDays: remH == null || pct === 0 ? null : daysOfHours(remH, hpd), milestone,
      constraint: cType ? { type: cType, date: /FNET|FNLT|MFO/.test(cType) ? finishOf(t.ConstraintDate, 1) : isoOfStamp(t.ConstraintDate) } : null,
      calendarUid: cal && cal !== '-1' ? cal : null, totalFloatDays: totalSlack == null ? null : Math.round(totalSlack / 10 / 60 / hpd), critical: str(t.Critical) ? flag(t.Critical) : null,
      costKeur: cents(t.Cost), actualCostKeur: cents(t.ActualCost), budgetKeur: baselines.find((b) => b.number === 0)?.costKeur ?? cents(t.Cost), notes: str(t.Notes) || null, codes: [],
      baselines, line: activities.length + 1,
    });
    for (const l of arr(t.PredecessorLink)) {
      if (flag(l.CrossProject)) {
        crossProject++;
        continue;
      }
      const lagFormat = numOf(str(l.LagFormat)) ?? 7;
      const lag = numOf(str(l.LinkLag)) ?? 0;
      let lagDays: number;
      if (PERCENT_LAG.has(lagFormat)) {
        percent++;
        lagDays = lag / 10; // percentage, converted against the predecessor's duration below
      } else if (ELAPSED_LAG.has(lagFormat)) {
        elapsed++;
        lagDays = Math.round(((lag / 10 / 60 / 24) * 5) / 7);
      } else lagDays = Math.round(lag / 10 / 60 / hpd);
      links.push({ predUid: str(l.PredecessorUID), succUid: uid, type: LINK_IN[str(l.Type)] ?? 'FS', lagDays: PERCENT_LAG.has(lagFormat) ? -1e9 - lagDays : lagDays });
    }
  }
  // Percent lags: lag = % of the predecessor's duration.
  const durationOf = new Map(activities.map((a) => [a.uid, a.durationDays]));
  for (const l of links) if (l.lagDays <= -1e9) l.lagDays = Math.round(((durationOf.get(l.predUid) ?? 0) * (-1e9 - l.lagDays)) / 100);

  if (alap) unmapped.push(fmt('As late as possible constraints are imported as ASAP ({0})', alap));
  if (deadlines) unmapped.push(fmt('Deadlines are not imported ({0})', deadlines));
  if (otherFields.size) unmapped.push(fmt('Custom fields other than "Activity ID" are not imported ({0})', otherFields.size));
  if (elapsed) warnings.push(fmt('Elapsed lags are converted to working days ({0})', elapsed));
  if (percent) warnings.push(fmt('Percent lags are converted to working days ({0})', percent));
  if (crossProject) unmapped.push(fmt('Cross-project links are not imported ({0})', crossProject));
  if (skippedTasks) unmapped.push(fmt('Inactive and external tasks are not imported ({0})', skippedTasks));

  // Resources and assignments.
  const resources: ImportedResource[] = arr((p.Resources as Node | undefined)?.Resource)
    .filter((r) => !flag(r.IsNull) && str(r.UID) !== '0' && str(r.Name))
    .map((r) => ({ uid: str(r.UID), name: str(r.Name), type: ({ '0': 'material', '1': 'work', '2': 'cost' } as Record<string, ImportedResourceType>)[str(r.Type)] ?? 'work' }));
  const resUids = new Set(resources.map((r) => r.uid));
  const actUids = new Set(activities.map((a) => a.uid));
  const assignments: ImportedAssignment[] = arr((p.Assignments as Node | undefined)?.Assignment)
    .filter((a) => resUids.has(str(a.ResourceUID)) && actUids.has(str(a.TaskUID)))
    .map((a) => ({
      activityUid: str(a.TaskUID), resourceUid: str(a.ResourceUID), units: numOf(str(a.Units)) ?? 1, plannedHours: hoursOfDuration(a.Work), actualHours: hoursOfDuration(a.ActualWork),
    }));
  if (resources.some((r) => r.type !== 'cost')) unmapped.push('Resource rates and cost accrual are not imported');

  const projectCal = str(p.CalendarUID);
  const keep = rawCalendars.filter((c) => c.isBase || usedCalendars.has(c.uid) || c.uid === projectCal);
  const calendars = resolveCalendars(rawCalendars, hpd).filter((c) => keep.some((k) => k.uid === c.uid));
  if (!activities.length) warnings.push(fmt('The file contains no activity'));
  return {
    format: 'mspdi', name: str(p.Title) || str(p.Name).replace(/\.(xml|mpp)$/i, '') || 'Imported schedule', company: str(p.Company) || null,
    start: isoOfStamp(p.StartDate), finish: finishOf(p.FinishDate, 1), statusDate: isoOfStamp(p.StatusDate), calendarUid: projectCal && projectCal !== '-1' ? projectCal : null,
    hoursPerDay: hpd, calendars, wbs, activities, links, resources, assignments, unmapped, warnings,
  };
}

// ── Writer ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const el = (name: string, value: string | number | null | undefined) => (value == null || value === '' ? '' : `<${name}>${typeof value === 'number' ? value : esc(value)}</${name}>`);
const hoursText = (h: number) => {
  const total = Math.round(h * 60);
  return `PT${Math.floor(total / 60)}H${total % 60}M0S`;
};

/** Working periods of a day of `h` hours: 08:00–12:00 + 13:00–… (24 h: 00:00–00:00). */
function workingTimes(h: number): [string, string][] {
  if (h >= 24) return [['00:00:00', '00:00:00']];
  const hm = (x: number) => `${String(Math.floor(x)).padStart(2, '0')}:${String(Math.round((x % 1) * 60)).padStart(2, '0')}:00`;
  if (h <= 4) return [['08:00:00', hm(8 + h)]];
  return [['08:00:00', '12:00:00'], ['13:00:00', hm(13 + h - 4)]];
}
const dayStart = (h: number) => (h >= 24 ? '00:00:00' : '08:00:00');
const dayEnd = (h: number) => (h >= 24 ? null : workingTimes(h).slice(-1)[0][1]);
const stampStart = (iso: IsoDate, h: number) => `${iso}T${dayStart(h)}`;
function stampFinish(iso: IsoDate, h: number): string {
  const end = dayEnd(h);
  if (end) return `${iso}T${end}`;
  return `${new Date(Date.parse(iso + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10)}T00:00:00`;
}

export interface MspdiWriteOptions {
  /** File name written in <Name> ("HLT-026.xml"). */
  fileName: string;
  /** Creation stamp (real clock). */
  now?: Date;
}

/**
 * Writes an MSPDI document. UIDs of calendars, WBS elements, activities and resources must be positive integers (as text);
 * the project calendar is `schedule.calendarUid`; `activityId` goes to the "Activity ID" text field; baselines 0–10.
 */
export function writeMspdi(s: ImportedSchedule, opts: MspdiWriteOptions): string {
  const hpd = s.hoursPerDay;
  const calHours = new Map(s.calendars.map((c) => [c.uid, c.hoursPerDay]));
  const projectHours = (s.calendarUid && calHours.get(s.calendarUid)) || hpd;
  const hoursOfCal = (uid: string | null) => (uid && calHours.get(uid)) || projectHours;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out.push('<Project xmlns="http://schemas.microsoft.com/project">');
  out.push(el('SaveVersion', 14), el('Name', opts.fileName), el('Title', s.name), el('Company', s.company ?? ''));
  out.push(el('CreationDate', (opts.now ?? new Date()).toISOString().slice(0, 19)));
  out.push(el('ScheduleFromStart', 1));
  if (s.start) out.push(el('StartDate', stampStart(s.start, projectHours)));
  if (s.finish) out.push(el('FinishDate', stampFinish(s.finish, projectHours)));
  out.push(el('CalendarUID', s.calendarUid ?? ''), el('DefaultStartTime', dayStart(projectHours)), el('DefaultFinishTime', dayEnd(projectHours) ?? '00:00:00'));
  out.push(el('MinutesPerDay', Math.round(hpd * 60)), el('MinutesPerWeek', Math.round(hpd * 60 * 5)), el('DaysPerMonth', 20), el('DurationFormat', 7));
  if (s.statusDate) out.push(el('StatusDate', stampFinish(s.statusDate, projectHours)));
  out.push(el('CurrencySymbol', '€'), el('CurrencyCode', 'EUR'));
  out.push('<ExtendedAttributes><ExtendedAttribute>', el('FieldID', ACTIVITY_ID_FIELD), el('FieldName', 'Text1'), el('Alias', 'Activity ID'), '</ExtendedAttribute></ExtendedAttributes>');

  out.push('<Calendars>');
  for (const c of s.calendars) {
    out.push('<Calendar>', el('UID', c.uid), el('Name', c.name), el('IsBaseCalendar', 1), el('BaseCalendarUID', -1), '<WeekDays>');
    for (let dt = 1; dt <= 7; dt++) {
      const iso = isoWeekdayOfDayType(dt);
      const working = c.workDays.includes(iso);
      out.push('<WeekDay>', el('DayType', dt), el('DayWorking', working ? 1 : 0));
      if (working) out.push('<WorkingTimes>', ...workingTimes(c.hoursPerDay).map(([a, b]) => `<WorkingTime><FromTime>${a}</FromTime><ToTime>${b}</ToTime></WorkingTime>`), '</WorkingTimes>');
      out.push('</WeekDay>');
    }
    out.push('</WeekDays>');
    if (c.exceptions.length) {
      out.push('<Exceptions>');
      for (const e of c.exceptions) {
        out.push('<Exception>', el('EnteredByOccurrences', 0), `<TimePeriod><FromDate>${e.date}T00:00:00</FromDate><ToDate>${e.date}T23:59:00</ToDate></TimePeriod>`);
        out.push(el('Occurrences', 1), el('Name', e.name), el('Type', 1), el('DayWorking', e.working ? 1 : 0));
        if (e.working) out.push('<WorkingTimes>', ...workingTimes(c.hoursPerDay).map(([a, b]) => `<WorkingTime><FromTime>${a}</FromTime><ToTime>${b}</ToTime></WorkingTime>`), '</WorkingTimes>');
        out.push('</Exception>');
      }
      out.push('</Exceptions>');
    }
    out.push('</Calendar>');
  }
  out.push('</Calendars>');

  // Tasks: project summary (UID 0), then each WBS element followed by its activities, in outline order.
  out.push('<Tasks>');
  let id = 0;
  out.push('<Task>', el('UID', 0), el('ID', id++), el('Name', s.name), el('Type', 1), el('IsNull', 0), el('WBS', '0'), el('OutlineNumber', '0'), el('OutlineLevel', 0));
  if (s.start) out.push(el('Start', stampStart(s.start, projectHours)));
  if (s.finish) out.push(el('Finish', stampFinish(s.finish, projectHours)));
  out.push(el('Summary', 1), el('Active', 1), el('Manual', 0), '</Task>');
  const predsOf = new Map<string, ImportedLink[]>();
  for (const l of s.links) predsOf.set(l.succUid, [...(predsOf.get(l.succUid) ?? []), l]);
  const childrenOf = new Map<string | null, ImportedWbs[]>();
  for (const w of s.wbs) childrenOf.set(w.parentUid, [...(childrenOf.get(w.parentUid) ?? []), w]);
  const actsOf = new Map<string | null, ImportedActivity[]>();
  for (const a of s.activities) actsOf.set(a.wbsUid, [...(actsOf.get(a.wbsUid) ?? []), a]);

  const writeActivity = (a: ImportedActivity, outline: string, level: number, wbsCode: string) => {
    const h = hoursOfCal(a.calendarUid);
    out.push('<Task>', el('UID', a.uid), el('ID', id++), el('Name', a.name), el('Type', 0), el('IsNull', 0), el('WBS', wbsCode), el('OutlineNumber', outline), el('OutlineLevel', level));
    if (a.start) out.push(el('Start', stampStart(a.start, h)));
    if (a.finish) out.push(el('Finish', a.milestone ? stampStart(a.finish, h) : stampFinish(a.finish, h)));
    out.push(el('Duration', hoursText(a.durationDays * hpd)), el('DurationFormat', 7), el('Milestone', a.milestone ? 1 : 0), el('Summary', 0));
    if (a.critical != null) out.push(el('Critical', a.critical ? 1 : 0));
    if (a.totalFloatDays != null) out.push(el('TotalSlack', Math.round(a.totalFloatDays * hpd * 60 * 10)));
    out.push(el('PercentComplete', a.percentComplete));
    if (a.costKeur != null) out.push(el('Cost', Math.round(a.costKeur * 1000 * 100)));
    if (a.actualStart) out.push(el('ActualStart', stampStart(a.actualStart, h)));
    if (a.actualFinish) out.push(el('ActualFinish', stampFinish(a.actualFinish, h)));
    if (a.actualCostKeur != null) out.push(el('ActualCost', Math.round(a.actualCostKeur * 1000 * 100)));
    if (a.remainingDays != null) out.push(el('RemainingDuration', hoursText(a.remainingDays * hpd)));
    const c = a.constraint && isConstraintType(a.constraint.type) ? a.constraint : null;
    out.push(el('ConstraintType', c ? CONSTRAINT_OUT[c.type] : 0), el('CalendarUID', a.calendarUid ?? -1));
    if (c?.date && c.type !== 'ASAP') out.push(el('ConstraintDate', /FNET|FNLT|MFO/.test(c.type) ? stampFinish(c.date, h) : stampStart(c.date, h)));
    if (a.notes) out.push(el('Notes', a.notes));
    for (const l of predsOf.get(a.uid) ?? []) {
      out.push('<PredecessorLink>', el('PredecessorUID', l.predUid), el('Type', LINK_OUT[l.type]), el('CrossProject', 0), el('LinkLag', Math.round(l.lagDays * hpd * 60 * 10)), el('LagFormat', 7), '</PredecessorLink>');
    }
    if (a.activityId) out.push('<ExtendedAttribute>', el('FieldID', ACTIVITY_ID_FIELD), el('Value', a.activityId), '</ExtendedAttribute>');
    for (const b of a.baselines) {
      out.push('<Baseline>', el('Number', b.number));
      if (b.start) out.push(el('Start', stampStart(b.start, h)));
      if (b.finish) out.push(el('Finish', b.durationDays === 0 && b.start === b.finish ? stampStart(b.finish, h) : stampFinish(b.finish, h)));
      if (b.durationDays != null) out.push(el('Duration', hoursText(b.durationDays * hpd)), el('DurationFormat', 7));
      if (b.costKeur != null) out.push(el('Cost', Math.round(b.costKeur * 1000 * 100)));
      out.push('</Baseline>');
    }
    out.push(el('Active', 1), el('Manual', 0), '</Task>');
  };

  const writeWbs = (parent: string | null, prefix: string, level: number) => {
    let n = 0;
    for (const w of childrenOf.get(parent) ?? []) {
      const outline = prefix ? `${prefix}.${++n}` : String(++n);
      const span = rollup(w.uid);
      out.push('<Task>', el('UID', w.uid), el('ID', id++), el('Name', w.name), el('Type', 1), el('IsNull', 0), el('WBS', w.code || outline), el('OutlineNumber', outline), el('OutlineLevel', level));
      if (span.start) out.push(el('Start', stampStart(span.start, projectHours)));
      if (span.finish) out.push(el('Finish', stampFinish(span.finish, projectHours)));
      out.push(el('Summary', 1), el('Active', 1), el('Manual', 0), '</Task>');
      let k = 0;
      for (const a of actsOf.get(w.uid) ?? []) {
        k++;
        writeActivity(a, `${outline}.${k}`, level + 1, `${w.code || outline}.${k}`);
      }
      writeWbs(w.uid, outline, level + 1);
    }
  };
  const rollup = (wbsUid: string): { start: IsoDate | null; finish: IsoDate | null } => {
    const acts = [...(actsOf.get(wbsUid) ?? []), ...(childrenOf.get(wbsUid) ?? []).flatMap((c) => actsOf.get(c.uid) ?? [])];
    const starts = acts.map((a) => a.start).filter((x): x is string => !!x).sort();
    const finishes = acts.map((a) => a.finish).filter((x): x is string => !!x).sort();
    return { start: starts[0] ?? null, finish: finishes[finishes.length - 1] ?? null };
  };
  // Activities without a WBS element come first, at outline level 1.
  let top = 0;
  for (const a of actsOf.get(null) ?? []) writeActivity(a, String(++top), 1, String(top));
  writeWbs(null, '', 1);
  out.push('</Tasks>');

  if (s.resources.length) {
    out.push('<Resources>');
    let rid = 1;
    for (const r of s.resources) out.push('<Resource>', el('UID', r.uid), el('ID', rid++), el('Name', r.name), el('Type', r.type === 'material' ? 0 : r.type === 'cost' ? 2 : 1), el('IsNull', 0), '</Resource>');
    out.push('</Resources>');
  }
  if (s.assignments.length) {
    out.push('<Assignments>');
    let aid = 1;
    for (const a of s.assignments) {
      out.push('<Assignment>', el('UID', aid++), el('TaskUID', a.activityUid), el('ResourceUID', a.resourceUid), el('Units', a.units));
      if (a.plannedHours != null) out.push(el('Work', hoursText(a.plannedHours)));
      if (a.actualHours != null) out.push(el('ActualWork', hoursText(a.actualHours)));
      out.push('</Assignment>');
    }
    out.push('</Assignments>');
  }
  out.push('</Project>');
  return out.filter(Boolean).join('\n') + '\n';
}

/** Short description of a schedule (preview header): "42 activities · 6 work packages · 3 calendars". */
export const scheduleCounts = (s: ImportedSchedule) => ({ activities: s.activities.length, wbs: s.wbs.length, calendars: s.calendars.length, links: s.links.length, name: clip(s.name, 120) });
