import 'server-only';
// Schedule import (chapter 4, S-9): plans and writes an MS Project / P6 schedule read by ./mspdi.ts or ./xer.ts into Keystone —
// a NEW project (identity, WBS, activities, logic, calendars, baselines, project header, milestones, schedule bars, assignments)
// or an EXISTING one (UPDATE mode: matching on UID or Activity ID). `planScheduleImport` is the dry run: it reads the database,
// never writes, and returns the preview rows (OK / warning / error), the summary and the blocking problems (circular logic).
// `writeScheduleImport` performs the same plan inside the caller's transaction.
//
// Rules (chapter-4 defaults, see docs): Keystone's WBS has two levels — summary tasks below the first level are flattened into
// their top work package; dates and floats are taken from the file (no recalculation: "Reschedule" is manual, S-1); durations
// are working days on the activity's calendar (S-8); a file calendar equal to a built-in one (same week, hours and only public
// holidays as exceptions) maps to it, the others become project calendars; MSPDI Baseline 0 → BL1 (current) of a new project,
// Baseline n → BL(n+1) (superseded); in UPDATE mode the file's Baseline 0 becomes a new PROPOSED baseline (option); activities of
// the project absent from the file are kept; the logic of every activity present in the file is replaced by the file's.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { BUILTIN_CALENDARS, WorkCalendar, holidaysOf, type CalendarDef } from '@/domain/calendar';
import { DEFAULT_DATA_DATE, DEFAULT_PROJECT_CALENDAR, nextBaselineCode } from '@/domain/ch4-defaults';
import { detectCycle } from '@/domain/cpm';
import { allocateProjectIdentity } from '@/domain/lifecycle';
import type { DB, Tx } from '@/server/db/client';
import { clientCode3, isConstraintType, type CalendarCode, type ConstraintType, type ImportMode, type LinkType, type MilestoneStatus } from '@/server/db/codes';
import { findPerson, nameOf } from '@/server/db/helpers';
import {
  activities, activityAssignments, activityLinks, baselineActivities, baselines, calendars, clients, milestones, persons, projectControls, projectMembers, projects,
  scheduleBars, wbsNodes,
} from '@/server/db/schema';
import { settingsHolidayDates, upsertCalendar } from '@/server/dal/calendars';
import { markBl1Deliverable } from '@/server/dal/lifecycle';
import type { ImportPreviewRow } from '@/server/dal/import-jobs';
import { INTERCHANGE_DEFAULTS } from './defaults';
import { fmt } from './messages';
import { longDateText, monthIndex, monthText, planDateText, round1, round2, type ImportedActivity, type ImportedCalendar, type ImportedSchedule, type IsoDate } from './model';

type Q = DB | Tx;

export type MatchOn = 'uid' | 'activity_id';

export interface ScheduleImportOptions {
  mode: ImportMode;
  /** UPDATE mode: the project to update. */
  projectCode: string | null;
  matchOn: MatchOn;
  /** Import the file's baselines (NEW: always as BL1…; UPDATE: Baseline 0 as a new proposed baseline). */
  importBaselines: boolean;
  /** NEW mode: project name (default: the file's), client (default: the file's company), project manager (full or short name). */
  projectName?: string | null;
  client?: string | null;
  pmName?: string | null;
}

const UNGROUPED = '__ungrouped__';
const ACTIVITY_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/;

interface PlannedCalendar {
  uid: string;
  name: string;
  /** Built-in code it maps to, else null (a project calendar is created). */
  builtin: string | null;
  /** Existing project calendar of an earlier import (UPDATE). */
  existingCode: string | null;
  def: ImportedCalendar;
}

interface PlannedPackage {
  key: string;
  code: string;
  name: string;
  externalUid: string | null;
  existingId: string | null;
  action: 'create' | 'update';
}

interface PlannedActivity {
  a: ImportedActivity;
  code: string;
  existingId: string | null;
  action: 'create' | 'update';
  packageKey: string;
  messages: string[];
  warning: boolean;
}

interface PlannedLink {
  pred: string;
  succ: string;
  type: LinkType;
  lag: number;
}

export interface ScheduleSummary {
  format: ImportedSchedule['format'];
  fileProject: string;
  mode: ImportMode;
  projectCode: string | null;
  projectName: string;
  start: IsoDate | null;
  finish: IsoDate | null;
  activities: { create: number; update: number; error: number; warning: number };
  packages: { create: number; update: number };
  links: number;
  calendars: { name: string; mappedTo: string | null }[];
  baselines: string[];
  assignments: number;
  /** Project activities absent from the file (UPDATE), kept as they are. */
  kept: number;
  unmapped: string[];
  warnings: string[];
  blocking: string[];
}

export interface SchedulePlan {
  rows: ImportPreviewRow[];
  summary: ScheduleSummary;
  /** Problems that forbid the import (circular logic, nothing to import). */
  blocking: string[];
  /** Write plan (not stored: recomputed at confirmation). */
  calendars: PlannedCalendar[];
  packages: PlannedPackage[];
  activities: PlannedActivity[];
  links: PlannedLink[];
  projectCalendarUid: string | null;
  baselineNumbers: number[];
  /** UPDATE: code of the proposed baseline the file's Baseline 0 becomes. */
  proposedBaseline: string | null;
}

// ── Calendars ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const norm = (s: string) => s.replace(/œ/gi, 'oe').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameWeek = (b: CalendarDef, c: ImportedCalendar) =>
  b.workDays.length === c.workDays.length && b.workDays.every((d) => c.workDays.includes(d)) && Math.abs(b.hoursPerDay - c.hoursPerDay) < 0.01;

/** Built-in calendar a file calendar is equal to (name exported by Keystone, or same week + only public / Settings holidays). */
export function builtinCalendarFor(c: ImportedCalendar, settingsHolidays: readonly string[]): string | null {
  const byName = BUILTIN_CALENDARS.find((b) => norm(b.name) === norm(c.name) || b.code === c.name);
  if (byName && sameWeek(byName, c)) return byName.code;
  const settings = new Set(settingsHolidays);
  const candidates = BUILTIN_CALENDARS.filter((b) => sameWeek(b, c)).sort((x, y) => {
    const workshop = /atelier|workshop/i.test(c.name);
    const wx = x.code === 'standard_5x8_workshop' ? 1 : 0;
    const wy = y.code === 'standard_5x8_workshop' ? 1 : 0;
    return workshop ? wy - wx : wx - wy;
  });
  for (const b of candidates) {
    const holidays = new Map<number, Set<string>>();
    const ok = c.exceptions.every((e) => {
      if (e.working) return false;
      const y = +e.date.slice(0, 4);
      if (!holidays.has(y)) holidays.set(y, new Set(holidaysOf(b.holidaySet, y).map((h) => h.date)));
      return holidays.get(y)!.has(e.date) || (b.useSettingsHolidays && settings.has(e.date));
    });
    if (ok) return b.code;
  }
  return null;
}

const calendarUidPart = (uid: string) => uid.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || '0';
const customCalendarCode = (projectCode: string, uid: string) => `${projectCode}.CAL${calendarUidPart(uid)}`;

// ── Planning (dry run) ────────────────────────────────────────────────────────────────────────────────────────────────
interface ExistingProject {
  id: string;
  code: string;
  calendar: string | null;
  packages: { id: string; code: string; name: string; externalUid: string | null; position: number }[];
  activities: { id: string; code: string; externalUid: string | null; wbsNodeId: string; position: number }[];
  links: { pred: string; succ: string }[];
  baselineCodes: string[];
  calendars: { code: string; externalUid: string | null }[];
}

async function loadExisting(q: Q, code: string): Promise<ExistingProject> {
  const [p] = await q.select({ id: projects.id, code: projects.code, calendar: projects.calendar }).from(projects).where(eq(projects.code, code));
  if (!p) throw new Error(`Unknown project ${code}`);
  const [nodes, acts, linkRows, bls, cals] = await Promise.all([
    q.select().from(wbsNodes).where(eq(wbsNodes.projectId, p.id)).orderBy(asc(wbsNodes.position)),
    q.select({ id: activities.id, code: activities.code, externalUid: activities.externalUid, wbsNodeId: activities.wbsNodeId, position: activities.position }).from(activities).where(eq(activities.projectId, p.id)),
    q.select({ pred: activityLinks.predecessorId, succ: activityLinks.successorId }).from(activityLinks).where(eq(activityLinks.projectId, p.id)),
    q.select({ code: baselines.code }).from(baselines).where(eq(baselines.projectId, p.id)),
    q.select({ code: calendars.code, externalUid: calendars.externalUid }).from(calendars).where(eq(calendars.projectId, p.id)),
  ]);
  if (!nodes.some((n) => n.level === 0)) throw new Error(fmt('This project has no WBS yet — import the schedule as a new project'));
  const codeOf = new Map(acts.map((a) => [a.id, a.code]));
  return {
    id: p.id, code: p.code, calendar: p.calendar,
    packages: nodes.filter((n) => n.level === 1).map((n) => ({ id: n.id, code: n.code, name: n.name, externalUid: n.externalUid, position: n.position })),
    activities: acts, links: linkRows.map((l) => ({ pred: codeOf.get(l.pred)!, succ: codeOf.get(l.succ)! })).filter((l) => l.pred && l.succ),
    baselineCodes: bls.map((b) => b.code), calendars: cals,
  };
}

/**
 * Next free activity code: "A" + (highest numeric "A…" code + 10, rounded down to the ten), from A1000. `reserved` holds the
 * Activity IDs that later rows of the file will claim.
 */
function codeGenerator(taken: Set<string>, reserved: ReadonlySet<string>): () => string {
  let n = 990;
  for (const c of [...taken, ...reserved]) {
    const m = /^A(\d{1,7})$/.exec(c);
    if (m) n = Math.max(n, +m[1]);
  }
  n = Math.floor(n / 10) * 10;
  return () => {
    let code: string;
    do {
      n += 10;
      code = `A${n}`;
    } while (taken.has(code) || reserved.has(code));
    taken.add(code);
    return code;
  };
}

const linkText = (l: PlannedLink) => `${l.pred} ${l.type}${l.lag ? (l.lag > 0 ? '+' : '') + l.lag : ''}`;

/**
 * Dry run of a schedule import: matching, codes, validation, logic check. Reads the database (`q`), writes nothing.
 * Throws an EN Error for an unknown target project.
 */
export async function planScheduleImport(s: ImportedSchedule, opts: ScheduleImportOptions, q: Q): Promise<SchedulePlan> {
  const existing = opts.mode === 'update' && opts.projectCode ? await loadExisting(q, opts.projectCode) : null;
  if (opts.mode === 'update' && !existing) throw new Error(fmt('Choose the project to update'));
  const settings = await settingsHolidayDates(q);
  const unmapped = [...s.unmapped];
  const warnings = [...s.warnings];
  const blocking: string[] = [];
  const rows: ImportPreviewRow[] = [];

  // Calendars used by the project and its activities.
  const usedCal = new Set([s.calendarUid, ...s.activities.map((a) => a.calendarUid)].filter((x): x is string => !!x));
  const plannedCalendars: PlannedCalendar[] = s.calendars
    .filter((c) => usedCal.has(c.uid))
    .map((c) => ({
      uid: c.uid, name: c.name, builtin: builtinCalendarFor(c, settings), def: c,
      existingCode: existing?.calendars.find((x) => x.externalUid === c.uid)?.code ?? null,
    }));
  for (const c of plannedCalendars) {
    rows.push({
      status: 'ok', action: c.builtin || c.existingCode ? 'update' : 'create', key: c.name,
      data: { kind: 'calendar', name: c.name, mappedTo: c.builtin, workDays: c.def.workDays, hoursPerDay: c.def.hoursPerDay, exceptions: c.def.exceptions.length },
      messages: [c.builtin ? fmt('Mapped to the built-in calendar {0}', BUILTIN_CALENDARS.find((b) => b.code === c.builtin)!.name) : fmt('New project calendar')],
    });
  }

  // Work packages: the top WBS elements of the file (deeper levels flattened).
  const wbsByUid = new Map(s.wbs.map((w) => [w.uid, w]));
  const topOf = (uid: string | null): string | null => {
    let cur = uid ? wbsByUid.get(uid) : undefined;
    for (let i = 0; cur && cur.parentUid && i < 50; i++) cur = wbsByUid.get(cur.parentUid) ?? undefined;
    return cur?.uid ?? null;
  };
  const deep = s.wbs.filter((w) => w.parentUid).length;
  if (deep) unmapped.push(fmt('Work packages below level 2 are flattened into their top work package ({0})', deep));
  const packages: PlannedPackage[] = [];
  const usedCodes = new Set(existing?.packages.map((p) => p.code) ?? []);
  let nextPkg = Math.max(0, ...[...usedCodes].map((c) => (/^1\.(\d+)$/.exec(c) ? +/^1\.(\d+)$/.exec(c)![1] : 0)));
  const newPackageCode = (fileCode: string | null) => {
    if (opts.mode === 'new' && fileCode && /^1\.\d+$/.test(fileCode) && !usedCodes.has(fileCode)) {
      usedCodes.add(fileCode);
      nextPkg = Math.max(nextPkg, +fileCode.slice(2));
      return fileCode;
    }
    let code: string;
    do code = `1.${++nextPkg}`;
    while (usedCodes.has(code));
    usedCodes.add(code);
    return code;
  };
  const matchedPkgIds = new Set<string>();
  const planPackage = (key: string, name: string, externalUid: string | null, fileCode: string | null) => {
    const ex = existing?.packages.find((p) => !matchedPkgIds.has(p.id) && externalUid && p.externalUid === externalUid)
      ?? existing?.packages.find((p) => !matchedPkgIds.has(p.id) && norm(p.name) === norm(name));
    if (ex) matchedPkgIds.add(ex.id);
    const pkg: PlannedPackage = { key, code: ex?.code ?? newPackageCode(fileCode), name: name || ex?.name || key, externalUid, existingId: ex?.id ?? null, action: ex ? 'update' : 'create' };
    packages.push(pkg);
    rows.push({ status: 'ok', action: pkg.action, key: pkg.code, data: { kind: 'wbs', name: pkg.name }, messages: [] });
    return pkg;
  };
  // NEW mode keeps the file's "1.n" codes (a Keystone export); other codes ("1", "2", "DES") are renumbered 1.1, 1.2…
  for (const w of s.wbs.filter((x) => !x.parentUid)) planPackage(w.uid, w.name, w.uid, w.code);
  const pkgByKey = new Map(packages.map((p) => [p.key, p]));
  if (s.activities.some((a) => !topOf(a.wbsUid))) {
    const ungrouped = planPackage(UNGROUPED, fmt('Ungrouped activities'), null, null);
    pkgByKey.set(UNGROUPED, ungrouped);
    warnings.push(fmt('Activities without a work package go to "{0}"', ungrouped.name));
  }

  // Activities.
  const takenCodes = new Set(existing?.activities.map((a) => a.code) ?? []);
  const byUid = new Map((existing?.activities ?? []).filter((a) => a.externalUid).map((a) => [a.externalUid!, a]));
  const byCode = new Map((existing?.activities ?? []).map((a) => [a.code, a]));
  const matchedIds = new Set<string>();
  const seenUid = new Set<string>();
  const seenId = new Set<string>();
  const planned: PlannedActivity[] = [];
  const errorsByUid = new Set<string>();
  const fileIds = new Set(s.activities.map((a) => a.activityId).filter((x): x is string => !!x));
  const nextCode = codeGenerator(takenCodes, fileIds);
  for (const a of s.activities) {
    const messages: string[] = [];
    const errors: string[] = [];
    if (!a.name.trim()) errors.push(fmt('Name is missing'));
    if (seenUid.has(a.uid)) errors.push(fmt('Duplicate UID {0}', a.uid));
    if (a.activityId && seenId.has(a.activityId)) errors.push(fmt('Duplicate Activity ID {0}', a.activityId));
    if (a.durationDays < 0) errors.push(fmt('Negative duration'));
    seenUid.add(a.uid);
    if (a.activityId) seenId.add(a.activityId);
    const pkg = pkgByKey.get(topOf(a.wbsUid) ?? UNGROUPED)!;
    if (errors.length) {
      errorsByUid.add(a.uid);
      rows.push({ status: 'error', action: 'skip', key: a.activityId ?? a.uid, data: activityData(a, a.activityId ?? a.uid, pkg.code, []), messages: errors });
      continue;
    }
    let match: { id: string; code: string } | undefined;
    if (existing) {
      const viaUid = byUid.get(a.uid);
      const viaId = a.activityId ? byCode.get(a.activityId) : undefined;
      const first = opts.matchOn === 'uid' ? viaUid : viaId;
      const second = opts.matchOn === 'uid' ? viaId : viaUid;
      match = first && !matchedIds.has(first.id) ? first : second && !matchedIds.has(second.id) ? second : undefined;
      if (match) {
        matchedIds.add(match.id);
        messages.push(match === viaUid ? fmt('Matched on UID {0}', a.uid) : fmt('Matched on Activity ID {0}', match.code));
        const ex = existing.activities.find((x) => x.id === match!.id)!;
        if (pkg.existingId !== ex.wbsNodeId) messages.push(fmt('Moved to work package {0}', pkg.code));
      }
    }
    let code: string;
    let warning = false;
    if (match) code = match.code;
    else if (a.activityId && ACTIVITY_CODE_RE.test(a.activityId) && !takenCodes.has(a.activityId)) {
      code = a.activityId;
      takenCodes.add(code);
    } else {
      code = nextCode();
      if (a.activityId) {
        messages.push(fmt('Activity ID {0} is already used in the project — new code {1}', a.activityId, code));
        warning = true;
      }
    }
    if (!a.start && !a.finish) {
      messages.push(fmt('No dates in the file — dated from the project start'));
      warning = true;
    }
    if (a.constraint && !a.constraint.date) {
      messages.push(fmt('Constraint {0} without a date — ignored', a.constraint.type));
      warning = true;
    }
    if (a.calendarUid && !plannedCalendars.some((c) => c.uid === a.calendarUid)) {
      messages.push(fmt('Unknown calendar {0} — project calendar used', a.calendarUid));
      warning = true;
    }
    planned.push({ a, code, existingId: match?.id ?? null, action: match ? 'update' : 'create', packageKey: pkg.key, messages, warning });
  }

  // Logic.
  const plannedByUid = new Map(planned.map((p) => [p.a.uid, p]));
  const fileActByUid = new Map(s.activities.map((a) => [a.uid, a]));
  const links: PlannedLink[] = [];
  const seenLink = new Set<string>();
  for (const l of s.links) {
    const succ = plannedByUid.get(l.succUid);
    if (!succ) continue;
    const pred = plannedByUid.get(l.predUid);
    if (!pred) {
      const label = fileActByUid.get(l.predUid)?.activityId ?? l.predUid;
      succ.messages.push(fmt('Unknown predecessor {0} — link not imported', label));
      succ.warning = true;
      continue;
    }
    const key = `${pred.code}>${succ.code}`;
    if (pred === succ || seenLink.has(key)) continue;
    seenLink.add(key);
    links.push({ pred: pred.code, succ: succ.code, type: l.type, lag: l.lagDays });
  }
  // Circular logic over the resulting network (file links + the kept links of activities absent from the file).
  const fileCodes = new Set(planned.map((p) => p.code));
  const keptLinks = (existing?.links ?? []).filter((l) => !fileCodes.has(l.succ));
  const allIds = [...new Set([...planned.map((p) => p.code), ...(existing?.activities.map((a) => a.code) ?? [])])];
  const cycle = detectCycle(allIds, [...links, ...keptLinks]);
  if (cycle) blocking.push(fmt('The logic has a cycle: {0}', cycle.join(' → ')));
  if (!planned.length) blocking.push(fmt('The file contains no activity'));

  for (const p of planned) {
    const preds = links.filter((l) => l.succ === p.code);
    rows.push({
      status: p.warning ? 'warning' : 'ok', action: p.action, key: p.code,
      data: activityData(p.a, p.code, pkgByKey.get(p.packageKey)!.code, preds.map(linkText)), messages: p.messages,
    });
  }

  // Baselines.
  const baselineNumbers = [...new Set(planned.flatMap((p) => p.a.baselines.map((b) => b.number)))].sort((a, b) => a - b);
  let proposedBaseline: string | null = null;
  const baselineLabels: string[] = [];
  if (opts.mode === 'new' && opts.importBaselines) {
    for (const n of baselineNumbers) {
      const count = planned.filter((p) => p.a.baselines.some((b) => b.number === n)).length;
      baselineLabels.push(`BL${n + 1}`);
      rows.push({ status: 'ok', action: 'create', key: `BL${n + 1}`, data: { kind: 'baseline', number: n }, messages: [fmt('Baseline {0} · {1} activities', n, count)] });
    }
    if (baselineNumbers.some((n) => n > 0)) unmapped.push(fmt('Baselines 1 to 10 of the file are imported as superseded baselines ({0})', baselineNumbers.filter((n) => n > 0).length));
  } else if (opts.mode === 'update' && opts.importBaselines && baselineNumbers.includes(0)) {
    proposedBaseline = nextBaselineCode(existing!.baselineCodes);
    const count = planned.filter((p) => p.a.baselines.some((b) => b.number === 0)).length;
    baselineLabels.push(proposedBaseline);
    rows.push({ status: 'ok', action: 'create', key: proposedBaseline, data: { kind: 'baseline', number: 0 }, messages: [fmt('Baseline {0} · {1} activities', 0, count)] });
  } else if (baselineNumbers.length) unmapped.push(fmt('Baselines of the file are not imported (option off)'));
  if (s.assignments.length) unmapped.push(fmt('Resource assignments are imported on the activities ({0})', s.assignments.filter((x) => plannedByUid.has(x.activityUid)).length));
  if (s.activities.length) unmapped.push(fmt('Activity owners are not in the file — set them on the Plan'));

  const kept = existing ? existing.activities.filter((a) => !matchedIds.has(a.id)).length : 0;
  if (kept) warnings.push(fmt('{0} activities of the project are not in the file — kept', kept));
  const errors = s.activities.length - planned.length;
  const starts = planned.map((p) => p.a.actualStart ?? p.a.start).filter((x): x is string => !!x).sort();
  const finishes = planned.map((p) => p.a.finish).filter((x): x is string => !!x).sort();
  const summary: ScheduleSummary = {
    format: s.format, fileProject: s.name, mode: opts.mode, projectCode: existing?.code ?? null,
    projectName: (opts.projectName ?? '').trim() || s.name, start: s.start ?? starts[0] ?? null, finish: s.finish ?? finishes[finishes.length - 1] ?? null,
    activities: {
      create: planned.filter((p) => p.action === 'create').length, update: planned.filter((p) => p.action === 'update').length, error: errors,
      warning: planned.filter((p) => p.warning).length,
    },
    packages: { create: packages.filter((p) => p.action === 'create').length, update: packages.filter((p) => p.action === 'update').length },
    links: links.length, calendars: plannedCalendars.map((c) => ({ name: c.name, mappedTo: c.builtin })), baselines: baselineLabels,
    assignments: s.assignments.filter((x) => plannedByUid.has(x.activityUid)).length, kept, unmapped, warnings, blocking,
  };
  return {
    rows, summary, blocking, calendars: plannedCalendars, packages, activities: planned, links, projectCalendarUid: s.calendarUid, baselineNumbers, proposedBaseline,
  };
}

function activityData(a: ImportedActivity, code: string, wbs: string, preds: string[]): Record<string, unknown> {
  return {
    kind: 'activity', code, uid: a.uid, name: a.name, wbs, start: a.actualStart ?? a.start, finish: a.finish, duration: a.durationDays, pct: a.percentComplete,
    preds, constraint: a.constraint?.date ? `${a.constraint.type} ${a.constraint.date}` : '', milestone: a.milestone,
  };
}

// ── Write ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ScheduleWriteResult {
  projectCode: string;
  created: number;
  updated: number;
  packages: number;
  links: number;
}

const descriptionOf = (a: ImportedActivity) => [a.notes?.slice(0, 2000), a.codes.length ? `Codes · ${a.codes.join(' · ')}` : null].filter(Boolean).join('\n') || null;

/**
 * Writes the planned import inside the caller's transaction (`tx`). NEW mode creates the project and returns its code.
 * Audit / activity of the import itself are written by the caller (markImportJobApplied).
 */
export async function writeScheduleImport(s: ImportedSchedule, plan: SchedulePlan, opts: ScheduleImportOptions, actorName: string, tx: Tx): Promise<ScheduleWriteResult> {
  if (plan.blocking.length) throw new Error(plan.blocking[0]);
  const actor = await findPerson(tx, actorName);
  const who = actor ? nameOf(actor) : actorName;
  const settings = await settingsHolidayDates(tx);
  const dataDate = s.statusDate ?? null;

  // Project (NEW) or target (UPDATE).
  let projectId: string;
  let projectCode: string;
  let projectCalendar: string;
  if (opts.mode === 'new') {
    const created = await createImportedProject(tx, s, plan, opts, who);
    projectId = created.id;
    projectCode = created.code;
    projectCalendar = DEFAULT_PROJECT_CALENDAR;
  } else {
    const [p] = await tx.select({ id: projects.id, code: projects.code, calendar: projects.calendar }).from(projects).where(eq(projects.code, opts.projectCode!));
    if (!p) throw new Error(`Unknown project ${opts.projectCode}`);
    projectId = p.id;
    projectCode = p.code;
    projectCalendar = p.calendar ?? DEFAULT_PROJECT_CALENDAR;
  }

  // Calendars: built-in mapping or project calendars (created / replaced).
  const codeOfCal = new Map<string, string>();
  const defs = new Map<string, CalendarDef>(BUILTIN_CALENDARS.map((b) => [b.code, b]));
  const exceptionsOf = new Map<string, ImportedCalendar['exceptions']>();
  for (const c of plan.calendars) {
    if (c.builtin) {
      codeOfCal.set(c.uid, c.builtin);
      continue;
    }
    const code = c.existingCode ?? customCalendarCode(projectCode, c.uid);
    await upsertCalendar(
      { code, name: c.name.slice(0, 120), workDays: c.def.workDays, hoursPerDay: c.def.hoursPerDay, holidaySet: null, useSettingsHolidays: false, projectCode, externalUid: c.uid, exceptions: c.def.exceptions },
      who, tx,
    );
    codeOfCal.set(c.uid, code);
    defs.set(code, { code, name: c.name, workDays: c.def.workDays, hoursPerDay: c.def.hoursPerDay, holidaySet: null, useSettingsHolidays: false });
    exceptionsOf.set(code, c.def.exceptions);
  }
  if (plan.projectCalendarUid && codeOfCal.has(plan.projectCalendarUid)) {
    const cal = codeOfCal.get(plan.projectCalendarUid)!;
    if (cal !== projectCalendar) {
      projectCalendar = cal;
      await tx.update(projects).set({ calendar: cal as CalendarCode, updatedAt: new Date() }).where(eq(projects.id, projectId));
    }
  }
  const workCals = new Map<string, WorkCalendar>();
  const workCal = (code: string) => {
    if (!workCals.has(code)) {
      const def = defs.get(code) ?? defs.get(DEFAULT_PROJECT_CALENDAR)!;
      workCals.set(code, new WorkCalendar(def, { settingsHolidays: settings, exceptions: exceptionsOf.get(code) ?? [] }));
    }
    return workCals.get(code)!;
  };

  // Work packages.
  const [root] = await tx.select({ id: wbsNodes.id }).from(wbsNodes).where(and(eq(wbsNodes.projectId, projectId), eq(wbsNodes.level, 0)));
  if (!root) throw new Error(`Project ${projectCode} has no WBS root`);
  const pkgId = new Map<string, string>();
  for (const p of plan.packages) {
    if (p.existingId) {
      await tx.update(wbsNodes).set({ name: p.name, externalUid: p.externalUid, updatedAt: new Date() }).where(eq(wbsNodes.id, p.existingId));
      pkgId.set(p.key, p.existingId);
    } else {
      const [n] = await tx
        .insert(wbsNodes)
        .values({ projectId, code: p.code, name: p.name.slice(0, 200), level: 1, parentId: root.id, position: 1_000_000 + pkgId.size, externalUid: p.externalUid })
        .returning({ id: wbsNodes.id });
      pkgId.set(p.key, n.id);
    }
  }

  // Activities.
  const projectStart = s.start ?? DEFAULT_DATA_DATE;
  const idOfCode = new Map<string, string>();
  let created = 0;
  let updated = 0;
  let order = 0;
  const inserts: (typeof activities.$inferInsert)[] = [];
  for (const p of plan.activities) {
    const a = p.a;
    const calCode = a.calendarUid ? codeOfCal.get(a.calendarUid) ?? null : null;
    const override = calCode && calCode !== projectCalendar ? calCode : null;
    const wc = workCal(override ?? projectCalendar);
    const start = a.actualStart ?? a.start ?? (a.finish ? wc.startOf(a.finish, a.durationDays) : wc.nextWorkDay(projectStart));
    const finish = a.finish ?? (a.durationDays > 0 ? wc.finishOf(start, a.durationDays) : start);
    const complete = a.percentComplete >= 100 && !!a.actualFinish;
    const bl0 = a.baselines.find((b) => b.number === 0);
    const constraint = a.constraint?.date && isConstraintType(a.constraint.type) ? a.constraint : null;
    const tf = complete ? null : a.totalFloatDays;
    const values = {
      name: a.name.slice(0, 300), durationDays: Math.round(a.durationDays), startText: planDateText(start), startActual: !!a.actualStart, finishText: planDateText(finish),
      finishActual: complete, startDate: start, finishDate: finish, percentComplete: Math.round(a.percentComplete), remainingDays: a.remainingDays,
      constraintType: (constraint?.type ?? null) as ConstraintType | null, constraintDateText: constraint?.date ? planDateText(constraint.date) : null, constraintDate: constraint?.date ?? null,
      constraintViolated: false, totalFloatDays: tf, critical: complete ? false : (a.critical ?? (tf != null ? tf <= 0 : null)), calendarCode: override as CalendarCode | null,
      externalUid: a.uid, wbsNodeId: pkgId.get(p.packageKey)!,
    };
    const money = a.costKeur != null || a.budgetKeur != null || a.actualCostKeur != null
      ? { budgetKeur: round2(a.budgetKeur ?? a.costKeur ?? 0), actualKeur: round2(a.actualCostKeur ?? 0), eacKeur: round2(a.costKeur ?? a.budgetKeur ?? 0) }
      : null;
    const description = descriptionOf(a);
    if (p.existingId) {
      const [cur] = await tx.select({ bl: activities.baselineFinishDate }).from(activities).where(eq(activities.id, p.existingId));
      const bl = cur?.bl ?? null;
      await tx
        .update(activities)
        .set({ ...values, ...(money ?? {}), ...(description ? { description } : {}), varianceDays: bl ? wc.workDaysBetween(finish, bl) : 0, updatedAt: new Date() })
        .where(eq(activities.id, p.existingId));
      idOfCode.set(p.code, p.existingId);
      updated++;
    } else {
      const blFinish = (opts.importBaselines && bl0?.finish) || finish;
      inserts.push({
        projectId, code: p.code, ...values, ...(money ?? { budgetKeur: 0, actualKeur: 0, eacKeur: 0 }), description, baselineFinishText: planDateText(blFinish), baselineFinishDate: blFinish,
        varianceDays: wc.workDaysBetween(finish, blFinish), isAdded: true, position: 2_000_000 + order++,
      });
    }
  }
  for (let i = 0; i < inserts.length; i += 500) {
    for (const row of await tx.insert(activities).values(inserts.slice(i, i + 500)).returning({ id: activities.id, code: activities.code })) idOfCode.set(row.code, row.id);
  }
  created = inserts.length;

  // Logic: the file's links replace the predecessors of every imported activity.
  const succIds = [...idOfCode.values()];
  if (succIds.length) await tx.delete(activityLinks).where(and(eq(activityLinks.projectId, projectId), inArray(activityLinks.successorId, succIds)));
  const allActs = await tx.select({ id: activities.id, code: activities.code }).from(activities).where(eq(activities.projectId, projectId));
  const anyId = new Map(allActs.map((x) => [x.code, x.id]));
  const position = new Map<string, number>();
  const linkRows = plan.links
    .filter((l) => anyId.has(l.pred) && anyId.has(l.succ))
    .map((l) => {
      const n = position.get(l.succ) ?? 0;
      position.set(l.succ, n + 1);
      return { projectId, predecessorId: anyId.get(l.pred)!, successorId: anyId.get(l.succ)!, type: l.type, lagDays: Math.round(l.lag), position: n };
    });
  for (let i = 0; i < linkRows.length; i += 500) await tx.insert(activityLinks).values(linkRows.slice(i, i + 500));

  // Resource assignments of the imported activities (replacing theirs when the file has some).
  await writeAssignments(tx, s, plan, idOfCode, (code) => workCal(code ?? projectCalendar).hoursPerDay, codeOfCal, projectCalendar);

  // Positions: root, then each work package followed by its activities (existing order kept, new ones appended).
  await renumber(tx, projectId);

  // Baselines.
  if (opts.importBaselines) await writeBaselines(tx, s, plan, opts, projectId, idOfCode, who, actor?.id ?? null, dataDate ?? projectStart);

  // WBS roll-ups and the root's display dates.
  await rollUp(tx, projectId, opts.mode === 'new');
  if (opts.mode === 'new') await writeProjectHeader(tx, s, projectId, opts.importBaselines);
  return { projectCode, created, updated, packages: plan.packages.length, links: linkRows.length };
}

async function createImportedProject(tx: Tx, s: ImportedSchedule, plan: SchedulePlan, opts: ScheduleImportOptions, who: string): Promise<{ id: string; code: string }> {
  const client = (opts.client ?? s.company ?? '').trim().slice(0, 120);
  const name = ((opts.projectName ?? '').trim() || s.name || 'Imported schedule').slice(0, 200);
  const [existing, [registered], [{ min }]] = await Promise.all([
    tx.select({ code: projects.code, number: projects.number, analytic: projects.analyticCode }).from(projects),
    client ? tx.select({ id: clients.id, code3: clients.code3 }).from(clients).where(eq(clients.name, client)) : Promise.resolve([]),
    tx.select({ min: sql<number>`coalesce(min(${projects.sortOrder}), 1)::int` }).from(projects),
  ]);
  const ident = allocateProjectIdentity({
    code3: clientCode3(client, registered?.code3), numbers: existing.map((p) => p.number), codes: existing.map((p) => p.code), analytics: existing.map((p) => p.analytic),
  });
  let clientId = registered?.id ?? null;
  if (client && !clientId) {
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${clients.sortOrder}), 0)::int` }).from(clients);
    [{ id: clientId }] = await tx.insert(clients).values({ name: client, sortOrder: max + 1 }).returning({ id: clients.id });
  }
  const pm = await findPerson(tx, opts.pmName ?? who);
  const start = s.start ?? plan.activities.map((p) => p.a.actualStart ?? p.a.start).filter((x): x is string => !!x).sort()[0] ?? DEFAULT_DATA_DATE;
  const finish = s.finish ?? plan.activities.map((p) => p.a.finish).filter((x): x is string => !!x).sort().pop() ?? start;
  const [p] = await tx
    .insert(projects)
    .values({
      code: ident.code, number: ident.number, shortCode: ident.code.slice(0, 3), name, clientId, pmPersonId: pm?.id ?? null, stage: INTERCHANGE_DEFAULTS.newProjectStage, analyticCode: ident.analytic,
      startText: monthText(start), finishText: monthText(finish), startMonth: Math.floor(monthIndex(start)), finishMonth: Math.floor(monthIndex(finish)),
      budgetKeur: 0, actualKeur: 0, progress: 0, spi: 1, isNew: true, currency: 'EUR', calendar: DEFAULT_PROJECT_CALENDAR, sortOrder: min - 1,
      dataDate: s.statusDate ?? null, plannedStartDate: start, plannedFinishDate: finish,
    })
    .returning({ id: projects.id });
  if (pm) await tx.insert(projectMembers).values({ projectId: p.id, personId: pm.id, projectRole: 'pm', position: 0 });
  await tx.insert(wbsNodes).values({ projectId: p.id, code: '1', name, level: 0, parentId: null, position: 0, startText: planDateText(start), finishText: planDateText(finish), startDate: start, finishDate: finish });
  return { id: p.id, code: ident.code };
}

async function writeAssignments(
  tx: Tx, s: ImportedSchedule, plan: SchedulePlan, idOfCode: Map<string, string>, hoursOf: (cal: string | null) => number, codeOfCal: Map<string, string>, projectCalendar: string,
): Promise<void> {
  if (!s.assignments.length) return;
  const resById = new Map(s.resources.map((r) => [r.uid, r]));
  const byUid = new Map(plan.activities.map((p) => [p.a.uid, p]));
  const targets = new Map<string, typeof s.assignments>();
  for (const x of s.assignments) {
    const p = byUid.get(x.activityUid);
    if (!p || !idOfCode.has(p.code)) continue;
    targets.set(p.code, [...(targets.get(p.code) ?? []), x]);
  }
  if (!targets.size) return;
  const ids = [...targets.keys()].map((c) => idOfCode.get(c)!);
  await tx.delete(activityAssignments).where(inArray(activityAssignments.activityId, ids));
  const people = await tx.select({ id: persons.id, fullName: persons.fullName, shortName: persons.shortName, dept: persons.departmentId }).from(persons);
  const personOf = (n: string) => people.find((p) => p.fullName === n || p.shortName === n) ?? null;
  const fmtH = (h: number) => Math.round(h).toLocaleString('en-US');
  const rows: (typeof activityAssignments.$inferInsert)[] = [];
  for (const [code, list] of targets) {
    const p = plan.activities.find((x) => x.code === code)!;
    const cal = p.a.calendarUid ? codeOfCal.get(p.a.calendarUid) ?? projectCalendar : projectCalendar;
    const hpd = hoursOf(cal);
    list.forEach((x, position) => {
      const r = resById.get(x.resourceUid);
      if (!r) return;
      const person = personOf(r.name);
      const count = round2(x.units || 1);
      const labour = r.type === 'work';
      rows.push({
        activityId: idOfCode.get(code)!, position, resource: r.name.slice(0, 200), personId: person?.id ?? null,
        detail: r.type === 'material' ? 'Material' : r.type === 'equipment' ? 'Equipment' : r.type === 'cost' ? 'Cost' : 'Labour',
        units: labour ? `${count} × ${hpd} h/d` : `${count}`, progressText: x.plannedHours != null ? `${fmtH(x.actualHours ?? 0)} / ${fmtH(x.plannedHours)} h` : '—',
        plannedHours: x.plannedHours != null ? round2(x.plannedHours) : null, actualHours: x.actualHours != null ? round2(x.actualHours) : null,
        resourceCount: labour ? count : null, hoursPerDay: labour ? hpd : null, departmentId: person?.dept ?? null, externalUid: r.uid,
      });
    });
  }
  for (let i = 0; i < rows.length; i += 500) await tx.insert(activityAssignments).values(rows.slice(i, i + 500));
}

/** Positions in one sequence: root, then each package and its activities (existing order first, then new rows). */
async function renumber(tx: Tx, projectId: string): Promise<void> {
  const nodes = await tx.select({ id: wbsNodes.id, level: wbsNodes.level, position: wbsNodes.position }).from(wbsNodes).where(eq(wbsNodes.projectId, projectId)).orderBy(asc(wbsNodes.position));
  const acts = await tx.select({ id: activities.id, wbs: activities.wbsNodeId, position: activities.position }).from(activities).where(eq(activities.projectId, projectId)).orderBy(asc(activities.position));
  let pos = 0;
  const updatesNode: [string, number, number][] = [];
  const updatesAct: [string, number, number][] = [];
  for (const n of nodes.filter((x) => x.level === 0)) updatesNode.push([n.id, n.position, pos++]);
  for (const n of nodes.filter((x) => x.level !== 0)) {
    updatesNode.push([n.id, n.position, pos++]);
    for (const a of acts.filter((x) => x.wbs === n.id)) updatesAct.push([a.id, a.position, pos++]);
  }
  for (const [id, before, after] of updatesNode) if (before !== after) await tx.update(wbsNodes).set({ position: after }).where(eq(wbsNodes.id, id));
  for (const [id, before, after] of updatesAct) if (before !== after) await tx.update(activities).set({ position: after }).where(eq(activities.id, id));
}

/** Roll-up dates of the work packages and the root (start / finish texts, total float). */
async function rollUp(tx: Tx, projectId: string, isNew: boolean): Promise<void> {
  const acts = await tx
    .select({ wbs: activities.wbsNodeId, start: activities.startDate, finish: activities.finishDate, tf: activities.totalFloatDays })
    .from(activities)
    .where(eq(activities.projectId, projectId));
  const nodes = await tx.select({ id: wbsNodes.id, level: wbsNodes.level }).from(wbsNodes).where(eq(wbsNodes.projectId, projectId));
  const span = (list: typeof acts) => {
    const s = list.map((a) => a.start).filter((x): x is string => !!x).sort();
    const f = list.map((a) => a.finish).filter((x): x is string => !!x).sort();
    return { start: s[0] ?? null, finish: f[f.length - 1] ?? null };
  };
  for (const n of nodes) {
    const own = n.level === 0 ? acts : acts.filter((a) => a.wbs === n.id);
    const r = span(own);
    if (n.level === 0) {
      const tfs = acts.map((a) => a.tf).filter((x): x is number => x != null);
      await tx
        .update(wbsNodes)
        .set({
          startDate: r.start, finishDate: r.finish, ...(r.start ? { startText: planDateText(r.start) } : {}), ...(r.finish ? { finishText: planDateText(r.finish) } : {}),
          ...(isNew || tfs.length ? { totalFloatDays: tfs.length ? Math.min(...tfs) : 0 } : {}), updatedAt: new Date(),
        })
        .where(eq(wbsNodes.id, n.id));
    } else await tx.update(wbsNodes).set({ startDate: r.start, finishDate: r.finish }).where(eq(wbsNodes.id, n.id));
  }
}

async function writeBaselines(
  tx: Tx, s: ImportedSchedule, plan: SchedulePlan, opts: ScheduleImportOptions, projectId: string, idOfCode: Map<string, string>, who: string, actorId: string | null,
  setOn: IsoDate,
): Promise<void> {
  const numbers = opts.mode === 'new' ? plan.baselineNumbers : plan.proposedBaseline ? [0] : [];
  const [proj] = await tx.select({ budget: projects.budgetKeur }).from(projects).where(eq(projects.id, projectId));
  const wbsCodes = new Map(plan.packages.map((p) => [p.key, p.code]));
  const [{ maxPos }] = await tx.select({ maxPos: sql<number>`coalesce(max(${baselines.position}), -1)::int` }).from(baselines).where(eq(baselines.projectId, projectId));
  let position = maxPos + 1;
  for (const n of numbers) {
    const values = plan.activities.map((p) => ({ p, b: p.a.baselines.find((x) => x.number === n) })).filter((x) => x.b && idOfCode.has(x.p.code));
    if (!values.length) continue;
    const code = opts.mode === 'new' ? `BL${n + 1}` : plan.proposedBaseline!;
    const finishes = values.map((v) => v.b!.finish).filter((x): x is string => !!x).sort();
    const costs = values.map((v) => v.b!.costKeur).filter((x): x is number => x != null);
    const [b] = await tx
      .insert(baselines)
      .values({
        projectId, code, name: n === 0 ? 'Imported baseline' : `Imported baseline ${n}`, setOn, bacKeur: costs.length ? round2(costs.reduce((x, y) => x + y, 0)) : proj.budget,
        finishDate: finishes[finishes.length - 1] ?? setOn, state: opts.mode === 'update' ? 'proposed' : n === 0 ? 'current' : 'superseded', source: 'import',
        comment: `${s.format === 'mspdi' ? 'MS Project' : 'Primavera P6'} · Baseline ${n}`, dataDate: s.statusDate ?? null, createdByPersonId: actorId, createdByName: who, position: position++,
      })
      .returning({ id: baselines.id });
    const rows = values.map(({ p, b: v }, i) => ({
      baselineId: b.id, activityId: idOfCode.get(p.code)!, activityCode: p.code, name: p.a.name.slice(0, 300), wbsCode: wbsCodes.get(p.packageKey) ?? null,
      startDate: v!.start, finishDate: v!.finish, startText: v!.start ? planDateText(v!.start) : null, finishText: v!.finish ? planDateText(v!.finish) : null,
      durationDays: v!.durationDays, budgetKeur: v!.costKeur, percentComplete: null, totalFloatDays: null, position: i,
    }));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(baselineActivities).values(rows.slice(i, i + 500));
    // R-054 (L-2 "a"): a NEW import whose Baseline 0 becomes BL1 current ticks « Planning BL1 posé » (no stage move).
    if (opts.mode === 'new' && code === 'BL1') await markBl1Deliverable(tx, projectId, who);
  }
}

/** Header of a NEW project: budget and progress, project controls, milestones and one schedule bar per work package. */
async function writeProjectHeader(tx: Tx, s: ImportedSchedule, projectId: string, withBaselines: boolean): Promise<void> {
  const acts = await tx.select().from(activities).where(eq(activities.projectId, projectId)).orderBy(asc(activities.position));
  const nodes = await tx.select().from(wbsNodes).where(eq(wbsNodes.projectId, projectId)).orderBy(asc(wbsNodes.position));
  const [proj] = await tx.select().from(projects).where(eq(projects.id, projectId));
  const start = proj.plannedStartDate ?? DEFAULT_DATA_DATE;
  const startMonth = Math.floor(monthIndex(start));
  const rel = (iso: string | null) => round2(monthIndex(iso ?? start) - startMonth);
  const weight = (a: (typeof acts)[number]) => Math.max(1, a.durationDays);
  const totalW = acts.reduce((x, a) => x + weight(a), 0) || 1;
  const progress = acts.reduce((x, a) => x + weight(a) * a.percentComplete, 0) / totalW / 100;
  const budget = round2(acts.reduce((x, a) => x + a.budgetKeur, 0));
  const actual = round2(acts.reduce((x, a) => x + a.actualKeur, 0));
  const finishes = acts.map((a) => a.finishDate).filter((x): x is string => !!x).sort();
  const finish = finishes[finishes.length - 1] ?? start;
  const blFinishes = acts.map((a) => a.baselineFinishDate).filter((x): x is string => !!x).sort();
  const blFinish = blFinishes[blFinishes.length - 1] ?? finish;
  const tfs = acts.filter((a) => !a.finishActual).map((a) => a.totalFloatDays).filter((x): x is number => x != null);
  const float = tfs.length ? Math.min(...tfs) : 0;
  const pkgs = nodes.filter((n) => n.level === 1);
  const critPkgs = pkgs.filter((n) => acts.some((a) => a.wbsNodeId === n.id && a.critical)).length;
  const miles = acts.filter((a) => a.durationDays === 0);
  const done = miles.filter((a) => a.percentComplete >= 100);
  const onDate = done.filter((a) => a.finishDate && a.baselineFinishDate && a.finishDate <= a.baselineFinishDate).length;
  const minus = (n: number) => (n < 0 ? `−${-n}` : String(n));
  const [bl1] = withBaselines ? await tx.select({ setOn: baselines.setOn }).from(baselines).where(and(eq(baselines.projectId, projectId), eq(baselines.code, 'BL1'))) : [];
  await tx
    .update(projects)
    .set({ budgetKeur: budget, actualKeur: actual, progress: round2(progress), finishText: monthText(finish), finishMonth: Math.floor(monthIndex(finish)), plannedFinishDate: finish, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  await tx.update(wbsNodes).set({ baselineFinishText: planDateText(blFinish) }).where(and(eq(wbsNodes.projectId, projectId), eq(wbsNodes.level, 0)));
  await tx.insert(projectControls).values({
    projectId, startMonth, tNow: round1(monthIndex(proj.dataDate ?? DEFAULT_DATA_DATE) - startMonth), floatDays: float, finishText: longDateText(finish), baselineText: longDateText(blFinish),
    floatText: `${minus(float)} days`, floatShort: `${minus(float)} d`, critText: `${critPkgs} of ${pkgs.length} packages critical`, milesText: `${done.length} of ${miles.length}`,
    milesSub: `Complete · ${onDate} on baseline date`, baselineSet: bl1?.setOn ? longDateText(bl1.setOn) : '—', reconOrigKeur: budget, reconChangesKeur: 0, reconCrCount: 0,
    reconPendingKeur: 0, reconPendingSub: '—', contingencyKeur: 0, contingencyUsedKeur: 0, ordersPlacedKeur: null,
    note: `Imported from ${s.format === 'mspdi' ? 'MS Project' : 'Primavera P6'}`,
  });
  if (miles.length) {
    await tx.insert(milestones).values(
      miles.map((a, position) => {
        const status: MilestoneStatus =
          a.percentComplete >= 100 ? 'done' : a.finishDate && a.baselineFinishDate && a.finishDate > a.baselineFinishDate ? 'late' : a.critical ? 'at_risk' : 'on_track';
        return { projectId, position, name: a.name, baselineMonth: rel(a.baselineFinishDate ?? a.finishDate), forecastMonth: rel(a.finishDate), status, activityId: a.id };
      }),
    );
  }
  if (pkgs.length) {
    await tx.insert(scheduleBars).values(
      pkgs.map((n, position) => {
        const own = acts.filter((a) => a.wbsNodeId === n.id);
        const st = own.map((a) => a.startDate).filter((x): x is string => !!x).sort();
        const fi = own.map((a) => a.finishDate).filter((x): x is string => !!x).sort();
        const bl = own.map((a) => a.baselineFinishDate).filter((x): x is string => !!x).sort();
        const w = own.reduce((x, a) => x + weight(a), 0) || 1;
        return {
          projectId, wbsNodeId: n.id, position, name: n.name, ownerPersonId: proj.pmPersonId, baselineStart: rel(st[0] ?? null), baselineEnd: rel(bl[bl.length - 1] ?? fi[fi.length - 1] ?? null),
          forecastStart: rel(st[0] ?? null), forecastEnd: rel(fi[fi.length - 1] ?? null), percentComplete: Math.round(own.reduce((x, a) => x + weight(a) * a.percentComplete, 0) / w),
          critical: own.some((a) => a.critical),
        };
      }),
    );
  }
}
