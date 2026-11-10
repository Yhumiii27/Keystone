// GanttProject (.gan) reader (delivery 9, owner's answer D9-08 of 10 Nov 2026: « L'import sera soit en format MS Project, soit en
// format GanttProject »). Pure: text in, the neutral schedule of ./model.ts out — the same preview / confirmation / write path as
// MS Project (./jobs.ts, ./schedule-import.ts). XML read with fast-xml-parser, already a dependency (the MSPDI reader).
//
// What a .gan file holds and how it maps (GanttProject 2.8 – 3.x format):
// - <task> elements nested in <tasks>: a task with child tasks is a WBS element (summary), the others are activities. WBS codes
//   are not stored by GanttProject: the outline number ("1", "1.2", "1.2.3") is used, as GanttProject shows it.
// - duration = working days of the project calendar; meeting="true" = milestone (duration 0); complete = % complete; start = the
//   start date; the finish is counted from the start on the calendar (GanttProject does not store it). GanttProject has no actual
//   dates: a started task (complete > 0) takes its start as actual start, a complete one its finish as actual finish.
// - <depend id="successor" type difference> inside the predecessor: type 1 SS, 2 FS, 3 FF, 4 SF; difference = lag in days.
//   Links to or from a summary task are not imported (Keystone links activities).
// - thirdDate-constraint="1" with thirdDate = "earliest start" → SNET.
// - <calendars>: the default week (sun…sat, "1" = non-working day type) and the <date> exceptions (HOLIDAY → non-working,
//   WORKING_DAY → working; a date without year repeats every year of the schedule). One project calendar, best effort.
// - <resources> / <allocations> → resources (work) and assignments (load % → units).
// - <previous><previous-tasks> (GanttProject "baselines") → baselines 0, 1, … in file order.
// Everything else (custom columns, colours, priorities, web links, roles, vacations) is listed in `unmapped`.
import { XMLParser } from 'fast-xml-parser';
import type { LinkType } from '@/server/db/codes';
import { fmt } from './messages';
import {
  MAX_IMPORT_ACTIVITIES, isoOfStamp, numOf, type ImportedActivity, type ImportedAssignment, type ImportedBaselineValue, type ImportedCalendar, type ImportedLink,
  type ImportedResource, type ImportedSchedule, type ImportedWbs, type IsoDate,
} from './model';

type Node = Record<string, unknown>;
const ARRAYS = new Set(['task', 'depend', 'date', 'resource', 'allocation', 'previous-tasks', 'previous-task', 'customproperty']);
const arr = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : v && typeof v === 'object' ? [v as Node] : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const yes = (v: unknown) => str(v).toLowerCase() === 'true';

/** GanttProject dependency types (TaskDependencyConstraint.Type persistent values). */
const LINK_IN: Record<string, LinkType> = { '1': 'SS', '2': 'FS', '3': 'FF', '4': 'SF' };
/** GanttProject default-week attributes in ISO weekday order. */
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** Hours of a working day: GanttProject counts in days; Keystone's default day. */
const HOURS_PER_DAY = 8;
const CALENDAR_UID = 'gan';

const DAY = 86_400_000;
const msOf = (iso: IsoDate) => Date.parse(iso + 'T00:00:00Z');
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const weekdayOf = (iso: IsoDate) => new Date(msOf(iso)).getUTCDay() || 7;

/** Working-day arithmetic on the file's calendar (week days and exceptions). */
function workCalendar(cal: ImportedCalendar) {
  const work = new Set(cal.workDays);
  const ex = new Map(cal.exceptions.map((e) => [e.date, e.working]));
  const isWorking = (iso: IsoDate) => ex.get(iso) ?? work.has(weekdayOf(iso));
  return {
    isWorking,
    /** First working day on or after `iso`. */
    onOrAfter(iso: IsoDate): IsoDate {
      let t = msOf(iso);
      for (let i = 0; i < 3700 && !isWorking(isoOf(t)); i++) t += DAY;
      return isoOf(t);
    },
    /** Finish of `days` working days starting on `start` (a milestone finishes on its start). */
    finishOf(start: IsoDate, days: number): IsoDate {
      let t = msOf(start);
      let left = Math.max(1, days) - 1;
      for (let i = 0; left > 0 && i < 20_000; i++) {
        t += DAY;
        if (isWorking(isoOf(t))) left--;
      }
      return isoOf(t);
    },
  };
}

/** The project calendar of the file: default week + dated exceptions (recurring ones repeated over `years`). */
function readCalendar(project: Node, years: number[]): { cal: ImportedCalendar; recurring: number } {
  const cals = (project.calendars ?? {}) as Node;
  const dayTypes = (cals['day-types'] ?? {}) as Node;
  const week = (dayTypes['default-week'] ?? null) as Node | null;
  const workDays = week ? WEEK.map((d, i) => (str(week[d]) === '1' ? 0 : i + 1)).filter((d) => d > 0) : [1, 2, 3, 4, 5];
  const exceptions = new Map<IsoDate, { date: IsoDate; working: boolean; name: string }>();
  let recurring = 0;
  for (const d of arr(cals.date)) {
    const type = str(d.type).toUpperCase();
    if (type !== 'HOLIDAY' && type !== 'WORKING_DAY') continue;
    const m = numOf(str(d.month));
    const day = numOf(str(d.date));
    const y = numOf(str(d.year));
    if (m == null || day == null) continue;
    const pad = (n: number) => String(n).padStart(2, '0');
    const list = y != null ? [y] : years;
    if (y == null) recurring++;
    for (const year of list) {
      const iso = isoOfStamp(`${year}-${pad(m)}-${pad(day)}`);
      if (iso) exceptions.set(iso, { date: iso, working: type === 'WORKING_DAY', name: str(d.description) || str(d['#text']) });
    }
  }
  return {
    cal: {
      uid: CALENDAR_UID, name: str(week?.name) || 'GanttProject calendar', workDays: workDays.length ? workDays : [1, 2, 3, 4, 5], hoursPerDay: HOURS_PER_DAY,
      exceptions: [...exceptions.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    },
    recurring,
  };
}

/** True when the text looks like a GanttProject file (root <project> element with <tasks>). */
export function looksLikeGan(name: string, head: string): boolean {
  return /\.gan$/i.test(name) || (/<project[\s>]/.test(head) && /<tasks[\s/>]|gantt-divider-location=|view-date=/.test(head));
}

/** Parses a GanttProject document. Throws an Error with an EN message when the text is not a GanttProject file. */
export function parseGan(xml: string): ImportedSchedule {
  const text = xml.replace(/^﻿/, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(text.slice(0, 4096))) throw new Error(fmt('The file contains a DOCTYPE declaration, which is not accepted'));
  let doc: Node;
  try {
    doc = new XMLParser({
      ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false, parseTagValue: false, trimValues: true, processEntities: true,
      // Elements only: `date` is also an attribute of <date> (the day of the month).
      isArray: (n, _path, _leaf, isAttribute) => !isAttribute && ARRAYS.has(n),
    }).parse(text) as Node;
  } catch {
    throw new Error(fmt('The file is not a GanttProject file'));
  }
  const project = doc.project as Node | undefined;
  if (!project || typeof project !== 'object' || !('tasks' in project)) throw new Error(fmt('The file is not a GanttProject file'));

  const unmapped: string[] = [];
  const warnings: string[] = [];
  const tasksNode = (project.tasks ?? {}) as Node;
  if (arr((tasksNode.taskproperties as Node | undefined)?.taskproperty).some((p) => str(p.type) === 'custom')) unmapped.push(fmt('Custom columns are not imported'));

  // Flatten the task tree (outline order) first: the calendar needs the years the schedule spans.
  interface Raw { node: Node; uid: string; parent: string | null; outline: string; summary: boolean }
  const raw: Raw[] = [];
  const walk = (nodes: Node[], parent: string | null, prefix: string) => {
    nodes.forEach((n, i) => {
      const outline = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      const children = arr(n.task);
      raw.push({ node: n, uid: str(n.id), parent, outline, summary: children.length > 0 });
      if (children.length) walk(children, str(n.id), outline);
    });
  };
  walk(arr(tasksNode.task), null, '');
  const starts = raw.map((r) => isoOfStamp(r.node.start)).filter((x): x is IsoDate => !!x).sort();
  const firstYear = starts.length ? +starts[0].slice(0, 4) : null;
  const lastYear = starts.length ? +starts[starts.length - 1].slice(0, 4) + 2 : null;
  const years = firstYear && lastYear ? Array.from({ length: Math.min(30, lastYear - firstYear + 1) }, (_, i) => firstYear + i) : [];
  const { cal, recurring } = readCalendar(project, years);
  if (recurring) warnings.push(fmt('Yearly holidays are repeated over the years of the schedule ({0})', recurring));
  const wc = workCalendar(cal);

  const wbs: ImportedWbs[] = [];
  const activities: ImportedActivity[] = [];
  const summaries = new Set(raw.filter((r) => r.summary).map((r) => r.uid));
  for (const r of raw) {
    const t = r.node;
    if (r.summary) {
      wbs.push({ uid: r.uid, code: r.outline, name: str(t.name), parentUid: r.parent, position: wbs.length });
      continue;
    }
    if (activities.length >= MAX_IMPORT_ACTIVITIES) throw new Error(fmt('The file has more than {0} activities', MAX_IMPORT_ACTIVITIES));
    const milestone = yes(t.meeting);
    const dur = numOf(str(t.duration));
    const durationDays = milestone ? 0 : Math.max(1, Math.round(dur ?? 1));
    const rawStart = isoOfStamp(t.start);
    const start = rawStart ? wc.onOrAfter(rawStart) : null;
    const finish = start ? wc.finishOf(start, durationDays) : null;
    const pct = Math.max(0, Math.min(100, Math.round(numOf(str(t.complete)) ?? 0)));
    const constraintOn = str(t['thirdDate-constraint']) === '1' ? isoOfStamp(t.thirdDate) : null;
    const notes = str((t.notes as unknown) ?? '') || null;
    activities.push({
      uid: r.uid, activityId: null, name: str(t.name), wbsUid: r.parent, durationDays,
      start, finish, actualStart: pct > 0 ? start : null, actualFinish: pct >= 100 ? finish : null,
      percentComplete: pct, remainingDays: null, milestone,
      constraint: constraintOn ? { type: 'SNET', date: constraintOn } : null,
      calendarUid: null, totalFloatDays: null, critical: null, costKeur: null, actualCostKeur: null, budgetKeur: null, notes, codes: [], baselines: [], line: activities.length + 1,
    });
  }

  // Links (declared on the predecessor: <depend id="successor">).
  const links: ImportedLink[] = [];
  let summaryLinks = 0;
  for (const r of raw) {
    for (const d of arr(r.node.depend)) {
      const succ = str(d.id);
      if (!succ) continue;
      if (r.summary || summaries.has(succ)) {
        summaryLinks++;
        continue;
      }
      links.push({ predUid: r.uid, succUid: succ, type: LINK_IN[str(d.type)] ?? 'FS', lagDays: Math.round(numOf(str(d.difference)) ?? 0) });
    }
  }
  if (summaryLinks) unmapped.push(fmt('Links to or from summary tasks are not imported ({0})', summaryLinks));

  // Baselines ("previous" task states), in file order: Baseline 0, 1…
  const previous = arr(((project.previous ?? {}) as Node)['previous-tasks']);
  const byUid = new Map(activities.map((a) => [a.uid, a]));
  previous.slice(0, 11).forEach((set, number) => {
    for (const p of arr(set['previous-task'])) {
      const a = byUid.get(str(p.id));
      const s = isoOfStamp(p.start);
      if (!a || !s) continue;
      const days = yes(p.meeting) ? 0 : Math.max(1, Math.round(numOf(str(p.duration)) ?? a.durationDays));
      const b: ImportedBaselineValue = { number, start: s, finish: wc.finishOf(s, days), durationDays: days, costKeur: null };
      a.baselines.push(b);
    }
  });
  if (previous.length > 11) unmapped.push(fmt('Baselines beyond the eleventh are not imported ({0})', previous.length - 11));

  // Resources and allocations.
  const resources: ImportedResource[] = arr(((project.resources ?? {}) as Node).resource)
    .filter((r) => str(r.id) && str(r.name))
    .map((r) => ({ uid: str(r.id), name: str(r.name), type: 'work' as const }));
  const resUids = new Set(resources.map((r) => r.uid));
  const assignments: ImportedAssignment[] = arr(((project.allocations ?? {}) as Node).allocation)
    .filter((a) => resUids.has(str(a['resource-id'])) && byUid.has(str(a['task-id'])))
    .map((a) => ({ activityUid: str(a['task-id']), resourceUid: str(a['resource-id']), units: (numOf(str(a.load)) ?? 100) / 100, plannedHours: null, actualHours: null }));
  if (arr(((project.vacations ?? {}) as Node).vacation).length) unmapped.push(fmt('Resource holidays are not imported'));
  if (resources.length) unmapped.push('Resource rates and cost accrual are not imported');

  if (!activities.length) warnings.push(fmt('The file contains no activity'));
  const finishes = activities.map((a) => a.finish).filter((x): x is IsoDate => !!x).sort();
  return {
    format: 'gan', name: str(project.name) || 'Imported schedule', company: str(project.company) || null,
    start: starts[0] ?? null, finish: finishes[finishes.length - 1] ?? null, statusDate: null, calendarUid: CALENDAR_UID, hoursPerDay: HOURS_PER_DAY,
    calendars: [cal], wbs, activities, links, resources, assignments, unmapped, warnings,
  };
}
