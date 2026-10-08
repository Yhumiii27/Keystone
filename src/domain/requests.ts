// Resource requests & department approvals (docs/spec/08 §5–§6, 01 §12; prototype logic 4108–4157, template
// 2689–2812 and 3071–3092). Pure functions over request rows, the resource pool (weekly loads) and departments:
// status filters and counts, KPI figures, load impact of a request, the 3-dot stepper, reschedule shifts, team
// load, the New resource request dialog (weeks, durations, hours parsing, routing) and the department slugs of
// `/resources/approvals/[dept]`. Formatting and translation stay in the UI. Golden values: requests.test.ts.
import { addDaysIso, daysBetweenIso, dowOfIso, isoOfDayOffset, shortDateOfIso, type Priority, type RequestStatus } from '@/server/db/codes';

export type { Priority, RequestStatus };

/** Minimal request shape used by the computations (subset of the DAL's ResourceRequestRow). */
export interface RequestFacts {
  id: string;
  status: RequestStatus;
  hours: number;
  /** Named person (full name) or null for a contract role. */
  person: string | null;
  department: string;
  /** ISO dates. */
  start: string;
  due: string;
}

/** Person of the resource pool: weekly loads (%) over the window weeks. */
export interface PoolFacts {
  name: string;
  department: string | null;
  loads: number[];
}

// ── Status chips (`reqChips`, 4136) ────────────────────────────────────────────────────────────────────

/** Chip values of the Requests screen (`?status=`); `null` = All. `rejected` also lists withdrawn requests. */
export type RequestFilter = 'pending' | 'reschedule' | 'approved' | 'rejected';
export const REQUEST_FILTERS: { value: RequestFilter | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'reschedule', label: 'Reschedule proposed' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected / withdrawn' },
];
export const isRequestFilter = (v: unknown): v is RequestFilter => v === 'pending' || v === 'reschedule' || v === 'approved' || v === 'rejected';

/** `reqRows` filter: `rejected` matches rejected and withdrawn. */
export const matchesFilter = (status: RequestStatus, f: RequestFilter | null) => !f || status === f || (f === 'rejected' && status === 'withdrawn');

/** Chip counts, in REQUEST_FILTERS order: all, pending, reschedule, approved, rejected + withdrawn. */
export function requestChipCounts(rows: readonly Pick<RequestFacts, 'status'>[]): number[] {
  const c = (s: RequestStatus) => rows.filter((r) => r.status === s).length;
  return [rows.length, c('pending'), c('reschedule'), c('approved'), c('rejected') + c('withdrawn')];
}

// ── KPI tiles ──────────────────────────────────────────────────────────────────────────────────────────

/** "Avg response" tiles: hard-coded in the prototype (08 OQ23, A-12) — kept until a formula is decided. */
export const AVG_RESPONSE_PM = '1.4 d';
export const AVG_RESPONSE_DEPARTMENT = '0.9 d';

export interface RequestKpis {
  sent: number;
  pending: number;
  pendingHours: number;
  reschedule: number;
  approved: number;
}

/** `reqKpis` (4138): requests sent · awaiting review (+ Σ pending hours) · needs your answer · approved. */
export function requestKpis(rows: readonly Pick<RequestFacts, 'status' | 'hours'>[]): RequestKpis {
  const pending = rows.filter((r) => r.status === 'pending');
  return {
    sent: rows.length,
    pending: pending.length,
    pendingHours: pending.reduce((a, r) => a + r.hours, 0),
    reschedule: rows.filter((r) => r.status === 'reschedule').length,
    approved: rows.filter((r) => r.status === 'approved').length,
  };
}

/** Project part of the "Requests sent" sub-line: the single project's short name, else "{n} projects" (EN). */
export function projectsText(names: readonly string[]): string {
  const u = [...new Set(names)];
  return u.length === 1 ? u[0] : u.length ? `${u.length} projects` : '';
}

// ── Loads and impact (`loadAt`, `reqRow` 4117–4121) ───────────────────────────────────────────────────

/** Week index of a date in the pool window: weeks are Mondays; before the window → 0, after → last (clamp 0–7). */
export function weekIndex(weekStarts: readonly string[], iso: string): number | null {
  if (!weekStarts.length) return null;
  const i = Math.floor(daysBetweenIso(weekStarts[0], iso) / 7);
  return Math.max(0, Math.min(weekStarts.length - 1, i));
}

/** Load (%) of a named person in the week of `iso`; null for a contract role / unknown person (`loadAt`). */
export function loadAt(pool: readonly PoolFacts[], weekStarts: readonly string[], person: string | null, iso: string): number | null {
  const p = person ? pool.find((x) => x.name === person) : undefined;
  const i = weekIndex(weekStarts, iso);
  if (!p || i == null) return null;
  return p.loads[i] ?? 0;
}

/** Hours of a request as a share of a 40 h week: round(hours / 40 × 100). */
export const addedLoad = (hours: number) => Math.round((hours / 40) * 100);

export interface RequestImpact {
  /** First name of the person. */
  first: string;
  load: number;
  /** Load with the request: load + round(hours/40·100). */
  after: number;
  /** After > 110 % → shown in the attention colour. */
  over: boolean;
}

/** Load impact of a request on its person in the start week; null when there is no named resource. */
export function requestImpact(r: Pick<RequestFacts, 'person' | 'start' | 'hours'>, pool: readonly PoolFacts[], weekStarts: readonly string[]): RequestImpact | null {
  const load = loadAt(pool, weekStarts, r.person, r.start);
  if (load == null || !r.person) return null;
  const after = load + addedLoad(r.hours);
  return { first: firstName(r.person), load, after, over: after > 110 };
}

/** "Julien Wagner" → "Julien". */
export const firstName = (name: string) => name.split(' ')[0];

/** Monday of the week of `iso` ("w/c" weeks; weekLabel 4119 = dayLabel(floor(d/5)·5)). */
export function weekStartOf(iso: string): string {
  const dow = dowOfIso(iso);
  return addDaysIso(iso, dow === 0 ? -6 : 1 - dow);
}
/** "w/c 28 Sep" (EN). */
export const weekLabel = (iso: string) => 'w/c ' + shortDateOfIso(weekStartOf(iso));
/** "28 Sep – 29 Sep" (EN). */
export const datesText = (start: string, due: string) => `${shortDateOfIso(start)} – ${shortDateOfIso(due)}`;

// ── Stepper (`step1..3`, 4120) ─────────────────────────────────────────────────────────────────────────

/** 3-dot stepper: sent (always) → department review (not pending) → assigned to the person (approved). */
export function requestSteps(status: RequestStatus): [boolean, boolean, boolean] {
  return [true, status !== 'pending', status === 'approved'];
}

// ── Department decisions (4123–4128) ───────────────────────────────────────────────────────────────────

export const RESCHEDULE_SHIFTS = [
  { value: 1, label: '+1 wk' },
  { value: 2, label: '+2 wks' },
  { value: 3, label: '+3 wks' },
] as const;
export type RescheduleShift = 1 | 2 | 3;
export const isShift = (v: unknown): v is RescheduleShift => v === 1 || v === 2 || v === 3;

/** Counter-proposed dates: start and due moved by `shift` weeks (5 working days = 7 calendar days). */
export function shiftedDates(start: string, due: string, shift: number): { start: string; due: string } {
  return { start: addDaysIso(start, 7 * shift), due: addDaysIso(due, 7 * shift) };
}

/** Target of "Approve & send to …": the first name, or the literal "procurement" for a contract role (08 OQ20). */
export const approveTarget = (person: string | null) => (person ? firstName(person) : 'procurement');

// ── Approvals of a department (`apprKpis`, `team`, 4130–4145) ─────────────────────────────────────────

/** Σ pending hours per named person over every pending request (Team load "Pending" column). */
export function pendingHoursByPerson(rows: readonly RequestFacts[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.status === 'pending' && r.person) out[r.person] = (out[r.person] ?? 0) + r.hours;
  return out;
}

export interface TeamLoadRow {
  name: string;
  /** Loads of the first two window weeks (%). */
  w1: number;
  w2: number;
  /** Σ pending hours (0 = none). */
  pending: number;
}

/** Team of a department (pool order) with the next two weeks and their pending hours. */
export function teamLoad(pool: readonly PoolFacts[], department: string, pending: Record<string, number>): TeamLoadRow[] {
  return pool
    .filter((p) => p.department === department)
    .map((p) => ({ name: p.name, w1: p.loads[0] ?? 0, w2: p.loads[1] ?? 0, pending: pending[p.name] ?? 0 }));
}

export interface ApprovalKpis {
  pending: number;
  pendingHours: number;
  /** round(mean of the team's first-week load); 0 without team. */
  teamLoad: number;
  teamSize: number;
  capacityH: number;
  committedH: number;
  /** Non-pending requests except withdrawn. */
  decided: number;
  approved: number;
  rejected: number;
}

/** `apprKpis` (4144) for the requests of one department. */
export function approvalKpis(
  deptRows: readonly Pick<RequestFacts, 'status' | 'hours'>[],
  team: readonly TeamLoadRow[],
  capacity: { capacityH: number | null; demandH: number | null } | null,
): ApprovalKpis {
  const pending = deptRows.filter((r) => r.status === 'pending');
  return {
    pending: pending.length,
    pendingHours: pending.reduce((a, r) => a + r.hours, 0),
    teamLoad: team.length ? Math.round(team.reduce((a, p) => a + p.w1, 0) / team.length) : 0,
    teamSize: team.length,
    capacityH: capacity?.capacityH ?? 0,
    committedH: capacity?.demandH ?? 0,
    decided: deptRows.filter((r) => r.status !== 'pending' && r.status !== 'withdrawn').length,
    approved: deptRows.filter((r) => r.status === 'approved').length,
    rejected: deptRows.filter((r) => r.status === 'rejected').length,
  };
}

/** Department path segment: "Controls & planning" → "controls-planning". */
export const deptSlug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Department of a slug (case-insensitive), or null. */
export const deptOfSlug = <D extends { name: string }>(depts: readonly D[], slug: string): D | null =>
  depts.find((d) => deptSlug(d.name) === slug.toLowerCase()) ?? null;

/**
 * Default department of the Approvals screen (00 §4 "default to the viewer's department"): the department the viewer
 * heads, else the one they belong to, else Engineering (the prototype's `dept` default).
 */
export function defaultDepartment(
  depts: readonly { name: string; head: string | null }[],
  viewer: { name: string; department: string | null },
): string {
  const headed = depts.find((d) => d.head === viewer.name);
  if (headed) return headed.name;
  if (viewer.department && depts.some((d) => d.name === viewer.department)) return viewer.department;
  return depts.find((d) => d.name === 'Engineering')?.name ?? depts[0]?.name ?? 'Engineering';
}

// ── New resource request dialog (nr, 3773 / 4146–4156) ─────────────────────────────────────────────────

/** Week choices: working-day offsets of the next three Mondays after the status week (w/c 28 Sep, 5 Oct, 12 Oct). */
export const NR_WEEKS = [5, 10, 15] as const;
/** Duration choices: working days added to the start day (2 days, 1 week, 2 weeks). */
export const NR_DURATIONS = [
  { value: 1, label: '2 days' },
  { value: 4, label: '1 week' },
  { value: 9, label: '2 weeks' },
] as const;
export const NR_PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'med', label: 'Medium' },
  { value: 'high', label: 'High' },
];
/** Value of the "Contract role" chip. */
export const CONTRACT_ROLE = 'Contract structural engineer';
/** Dialog defaults (state.nr, 3773). */
export const NR_DEFAULTS = { act: 'A1250', person: 'Julien Wagner', week: 5, dur: 4, hours: '8', prio: 'med' as Priority };

export const isNrWeek = (v: unknown): v is (typeof NR_WEEKS)[number] => NR_WEEKS.includes(v as never);
export const isNrDuration = (v: unknown): v is 1 | 4 | 9 => v === 1 || v === 4 || v === 9;
export const isPriority = (v: unknown): v is Priority => v === 'low' || v === 'med' || v === 'high';

/** Start / due ISO dates of a week offset + duration (`start: week, due: week + dur`). */
export const nrDates = (week: number, dur: number) => ({ start: isoOfDayOffset(week), due: isoOfDayOffset(week + dur) });

/** Hours typed in the dialog: parseFloat, 8 when unparsable or not positive (capped at 999). */
export function parseHours(text: string): number {
  const v = parseFloat(String(text).replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 999) : 8;
}

/** Title of a sent request: the typed title, or "Untitled request". */
export const requestTitle = (text: string) => text.trim() || 'Untitled request';

export interface Routing {
  /** Department head full name ("Marion Kerviel"), department name, first name of the person, load that week. */
  head: string;
  department: string;
  first: string | null;
  load: number | null;
}

/** Routing panel: department = the person's department, Engineering for a contract role; load = loadAt(person, week). */
export function routing(
  person: string,
  startIso: string,
  pool: readonly PoolFacts[],
  weekStarts: readonly string[],
  depts: readonly { name: string; head: string | null }[],
): Routing {
  const p = pool.find((x) => x.name === person);
  const department = p?.department ?? 'Engineering';
  const head = depts.find((d) => d.name === department)?.head ?? '';
  const load = loadAt(pool, weekStarts, p ? person : null, startIso);
  return { head, department, first: p ? firstName(person) : null, load };
}
