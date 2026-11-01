// R-204 — supplier schedules consolidated into the project CPM. Pure and deterministic.
//
// A supplier schedule is the small network a supplier commits to for one purchase order (the purchasing package): milestones
// and activities (drawings approval, manufacturing, FAT, shipment, delivery) with a duration in working days (project calendar)
// and the dates of the supplier's own schedule (the "committed" dates). The buyer enters the actual dates and % complete.
//
// Consolidation (`consolidateNetwork`): the supplier activities become ordinary CPM nodes (id "PO-1082/F10", tagged with their
// purchase order in `sources`) next to the project's activities, with their own links and the ties the project's leads set:
// 'to_project' = supplier activity → project activity (FS + lag: the delivery drives the reception / installation),
// 'from_project' = project activity → supplier activity (FS + lag: EPC2i's drawings approval drives the manufacturing).
// The engine (src/domain/cpm.ts) is unchanged: a supplier node is an activity like any other, on the project calendar, with a
// "Start no earlier than" its committed start while it has not started (the supplier does not start before the date it
// committed to), so a supplier that slips pushes the project's activities it is tied to. Only schedules with at least one tie
// enter the project network (an unlinked schedule cannot move the project).
//
// Forecast (`supplierForecast`): the schedule on its own (no ties), at the data date — its forecast dates and the slip of each
// activity against its committed dates (working days, positive = late), whatever the project's own logic.
import { isIsoDate, type IsoDate, type WorkCalendar } from './calendar';
import { CpmCycleError, CpmInputError, DEFAULT_CPM_OPTIONS, detectCycle, schedule, type CpmActivityInput, type CpmInput, type CpmLinkInput, type CpmLinkType, type CpmOptions } from './cpm';

export type SupplierTieDirection = 'to_project' | 'from_project';
export const SUPPLIER_TIE_DIRECTIONS: readonly SupplierTieDirection[] = ['to_project', 'from_project'];
export const isSupplierTieDirection = (v: unknown): v is SupplierTieDirection => typeof v === 'string' && (SUPPLIER_TIE_DIRECTIONS as readonly string[]).includes(v);

export interface SupplierActivityInput {
  /** "F10", unique in its schedule. */
  code: string;
  name: string;
  /** Working days (0 = milestone). */
  duration: number;
  committedStart?: IsoDate | null;
  committedFinish?: IsoDate | null;
  actualStart?: IsoDate | null;
  actualFinish?: IsoDate | null;
  pct: number;
}

export interface SupplierLinkInput {
  /** Supplier activity codes of the same schedule. */
  pred: string;
  succ: string;
  type: CpmLinkType;
  lag: number;
}

export interface SupplierTieInput {
  /** Supplier activity code. */
  supplier: string;
  /** Project activity code ("A1250"). */
  activity: string;
  direction: SupplierTieDirection;
  lag: number;
}

export interface SupplierScheduleInput {
  /** Purchase order number ("PO-1082") — the purchasing package. */
  po: string;
  activities: readonly SupplierActivityInput[];
  links: readonly SupplierLinkInput[];
  ties: readonly SupplierTieInput[];
}

/** CPM node id of a supplier activity: never an activity code of the project (codes have no "/"). */
export const supplierNodeId = (po: string, code: string) => `${po}/${code}`;

/** Engine input of a supplier activity (project calendar; SNET its committed start while not started). */
export function supplierCpmActivity(po: string, a: SupplierActivityInput): CpmActivityInput {
  const started = !!a.actualStart;
  const done = started && !!a.actualFinish;
  return {
    id: supplierNodeId(po, a.code),
    duration: a.duration,
    calendar: null,
    percentComplete: done ? 100 : Math.max(0, Math.min(99, a.pct)),
    actualStart: started ? a.actualStart : null,
    actualFinish: done ? a.actualFinish : null,
    constraint: !started && a.committedStart ? { type: 'SNET', date: a.committedStart } : null,
  };
}

/** Links of a schedule, internal first, then its ties (always finish-to-start). */
export function supplierCpmLinks(s: SupplierScheduleInput, withTies = true): CpmLinkInput[] {
  const node = (code: string) => supplierNodeId(s.po, code);
  const links: CpmLinkInput[] = s.links.map((l) => ({ pred: node(l.pred), succ: node(l.succ), type: l.type, lag: l.lag }));
  if (withTies)
    for (const t of s.ties)
      links.push(t.direction === 'to_project' ? { pred: node(t.supplier), succ: t.activity, type: 'FS', lag: t.lag } : { pred: t.activity, succ: node(t.supplier), type: 'FS', lag: t.lag });
  return links;
}

/** A schedule enters the project network once it is tied to it. */
export const isConsolidated = (s: Pick<SupplierScheduleInput, 'ties'>) => s.ties.length > 0;

export interface ConsolidatedNetwork {
  input: CpmInput;
  /** Supplier node id → purchase order number. */
  sources: Record<string, string>;
}

/**
 * The project network with the supplier schedules tied to it. A tie to an activity that is not in the project network is left
 * out (the activity was removed); the project's activities and links are kept as they are, first and in their order.
 */
export function consolidateNetwork(input: CpmInput, schedules: readonly SupplierScheduleInput[]): ConsolidatedNetwork {
  const projectIds = new Set(input.activities.map((a) => a.id));
  const activities = [...input.activities];
  const links = [...input.links];
  const sources: Record<string, string> = {};
  for (const s of schedules) {
    const ties = s.ties.filter((t) => projectIds.has(t.activity));
    if (!ties.length) continue;
    for (const a of s.activities) {
      const n = supplierCpmActivity(s.po, a);
      activities.push(n);
      sources[n.id] = s.po;
    }
    links.push(...supplierCpmLinks({ ...s, ties }));
  }
  return { input: { ...input, activities, links }, sources };
}

/**
 * Logic loop check of the whole network (project activities and links, every supplier schedule with its internal links and its
 * ties, tied or not): the loop's node ids, or null. Used before saving a supplier link or a tie (a loop is refused).
 */
export function supplierNetworkCycle(projectIds: readonly string[], projectLinks: readonly Pick<CpmLinkInput, 'pred' | 'succ'>[], schedules: readonly SupplierScheduleInput[]): string[] | null {
  const ids = [...projectIds];
  const links: Pick<CpmLinkInput, 'pred' | 'succ'>[] = [...projectLinks];
  const known = new Set(projectIds);
  for (const s of schedules) {
    for (const a of s.activities) ids.push(supplierNodeId(s.po, a.code));
    links.push(...supplierCpmLinks({ ...s, ties: s.ties.filter((t) => known.has(t.activity)) }));
  }
  return detectCycle(ids, links);
}

// ── Validation ────────────────────────────────────────────────────────────────────────────────────────────────────

export const SUPPLIER_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,11}$/;
export const SUPPLIER_NAME_MAX = 120;
export const SUPPLIER_DURATION_MAX = 9999;
export const SUPPLIER_LAG_MAX = 999;

/** English source messages of the validation errors (translated by the caller). */
export const SUPPLIER_ERRORS = {
  code: 'Code: 1 to 12 letters, digits, - or _',
  name: 'Name: 1 to 120 characters',
  duration: 'Duration: a whole number of working days from 0 to 9999',
  date: 'Invalid date',
  committed: 'The committed finish cannot be before the committed start',
  actualFinishWithoutStart: 'An actual finish needs an actual start',
  actualOrder: 'The actual finish cannot be before the actual start',
  actualFuture: 'Actual dates cannot be after today',
  pct: '% complete: a whole number from 0 to 100',
  pctWithoutStart: 'Enter the actual start of a started activity',
  doneWithoutFinish: 'Enter the actual finish of a complete activity',
  lag: 'Lag: a whole number of working days from −999 to 999',
  linkType: 'Unknown relationship type',
  self: 'An activity cannot be linked to itself',
  duplicate: 'This relationship already exists',
  cycle: 'This relationship would create a logic loop',
  direction: 'Unknown direction',
  unknown: 'Unknown activity',
} as const;
export type SupplierError = keyof typeof SUPPLIER_ERRORS;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: SupplierError };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const optDate = (v: unknown): IsoDate | null | undefined => {
  const s = str(v);
  if (!s) return null;
  return isIsoDate(s) ? s : undefined;
};
const int = (v: unknown, min: number, max: number): number | null => {
  const s = typeof v === 'number' ? String(v) : str(v).replace('−', '-');
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
};

/** Plan of a supplier activity (code, name, duration, committed dates), as the form sends it. */
export function parseSupplierActivity(v: Record<string, unknown>): Parsed<Pick<SupplierActivityInput, 'code' | 'name' | 'duration' | 'committedStart' | 'committedFinish'>> {
  const code = str(v.code).toUpperCase();
  if (!SUPPLIER_CODE_RE.test(code)) return { ok: false, error: 'code' };
  const name = str(v.name);
  if (!name || name.length > SUPPLIER_NAME_MAX) return { ok: false, error: 'name' };
  const duration = int(v.duration, 0, SUPPLIER_DURATION_MAX);
  if (duration == null) return { ok: false, error: 'duration' };
  const committedStart = optDate(v.committedStart);
  const committedFinish = optDate(v.committedFinish);
  if (committedStart === undefined || committedFinish === undefined) return { ok: false, error: 'date' };
  if (committedStart && committedFinish && committedFinish < committedStart) return { ok: false, error: 'committed' };
  return { ok: true, value: { code, name, duration, committedStart, committedFinish } };
}

/**
 * Progress of a supplier activity entered by the buyer: an actual finish makes it complete (100 %); 100 % needs the actual
 * finish; a started activity (% > 0) needs its actual start; actual dates are never after `today`.
 */
export function parseSupplierProgress(v: Record<string, unknown>, today: IsoDate): Parsed<Pick<SupplierActivityInput, 'actualStart' | 'actualFinish' | 'pct'>> {
  const actualStart = optDate(v.actualStart);
  const actualFinish = optDate(v.actualFinish);
  if (actualStart === undefined || actualFinish === undefined) return { ok: false, error: 'date' };
  const rawPct = str(v.pct);
  let pct = rawPct === '' ? 0 : int(rawPct, 0, 100);
  if (pct == null) return { ok: false, error: 'pct' };
  if (actualFinish && !actualStart) return { ok: false, error: 'actualFinishWithoutStart' };
  if (actualStart && actualFinish && actualFinish < actualStart) return { ok: false, error: 'actualOrder' };
  if ((actualStart && actualStart > today) || (actualFinish && actualFinish > today)) return { ok: false, error: 'actualFuture' };
  if (actualFinish) pct = 100;
  if (pct === 100 && !actualFinish) return { ok: false, error: 'doneWithoutFinish' };
  if (pct > 0 && !actualStart) return { ok: false, error: 'pctWithoutStart' };
  return { ok: true, value: { actualStart, actualFinish, pct } };
}

const LINK_TYPES: readonly string[] = ['FS', 'SS', 'FF', 'SF'];

/**
 * A link inside a schedule: both ends in the schedule, no self link, no duplicate, no loop with the rest of the network
 * (`others` = every other schedule; the project's activities and links as given).
 */
export function checkSupplierLink(
  s: SupplierScheduleInput,
  link: { pred: string; succ: string; type: unknown; lag: unknown },
  project: { ids: readonly string[]; links: readonly Pick<CpmLinkInput, 'pred' | 'succ'>[] },
  others: readonly SupplierScheduleInput[],
): Parsed<SupplierLinkInput> | { ok: false; error: 'cycle'; cycle: string[] } {
  const codes = new Set(s.activities.map((a) => a.code));
  if (!codes.has(link.pred) || !codes.has(link.succ)) return { ok: false, error: 'unknown' };
  if (link.pred === link.succ) return { ok: false, error: 'self' };
  if (typeof link.type !== 'string' || !LINK_TYPES.includes(link.type)) return { ok: false, error: 'linkType' };
  const lag = int(link.lag ?? 0, -SUPPLIER_LAG_MAX, SUPPLIER_LAG_MAX);
  if (lag == null) return { ok: false, error: 'lag' };
  if (s.links.some((l) => l.pred === link.pred && l.succ === link.succ)) return { ok: false, error: 'duplicate' };
  const value: SupplierLinkInput = { pred: link.pred, succ: link.succ, type: link.type as CpmLinkType, lag };
  const cycle = supplierNetworkCycle(project.ids, project.links, [...others, { ...s, links: [...s.links, value] }]);
  return cycle ? { ok: false, error: 'cycle', cycle } : { ok: true, value };
}

/** A tie between a supplier activity and a project activity: both known, no duplicate, no loop through the project. */
export function checkSupplierTie(
  s: SupplierScheduleInput,
  tie: { supplier: string; activity: string; direction: unknown; lag: unknown },
  project: { ids: readonly string[]; links: readonly Pick<CpmLinkInput, 'pred' | 'succ'>[] },
  others: readonly SupplierScheduleInput[],
): Parsed<SupplierTieInput> | { ok: false; error: 'cycle'; cycle: string[] } {
  if (!s.activities.some((a) => a.code === tie.supplier) || !project.ids.includes(tie.activity)) return { ok: false, error: 'unknown' };
  if (!isSupplierTieDirection(tie.direction)) return { ok: false, error: 'direction' };
  const lag = int(tie.lag ?? 0, -SUPPLIER_LAG_MAX, SUPPLIER_LAG_MAX);
  if (lag == null) return { ok: false, error: 'lag' };
  if (s.ties.some((t) => t.supplier === tie.supplier && t.activity === tie.activity)) return { ok: false, error: 'duplicate' };
  const value: SupplierTieInput = { supplier: tie.supplier, activity: tie.activity, direction: tie.direction, lag };
  const cycle = supplierNetworkCycle(project.ids, project.links, [...others, { ...s, ties: [...s.ties, value] }]);
  return cycle ? { ok: false, error: 'cycle', cycle } : { ok: true, value };
}

/** Default tie target of a new tie: the schedule's last activity (the delivery, by plan order). */
export const lastSupplierActivity = (s: Pick<SupplierScheduleInput, 'activities'>) => s.activities.at(-1)?.code ?? null;

// ── Forecast and slips ────────────────────────────────────────────────────────────────────────────────────────────

export interface SupplierActivityForecast {
  start: IsoDate;
  finish: IsoDate;
  state: 'complete' | 'in_progress' | 'not_started';
  /** Working days between the committed and the forecast (actual) finish; positive = late; null without a committed finish. */
  finishSlip: number | null;
  /** Same for the start. */
  startSlip: number | null;
  /** The activity slips against the supplier's commitment (finish later than committed, or not started by its committed start). */
  late: boolean;
}

export interface SupplierForecast {
  ok: true;
  activities: Record<string, SupplierActivityForecast>;
  /** Forecast finish of the schedule (its last finish). */
  finish: IsoDate | null;
  /** Largest finish slip of the schedule (0 when on time or none committed). */
  slip: number;
  late: boolean;
}

export type SupplierForecastResult = SupplierForecast | { ok: false; cycle?: string[]; issues?: string[] };

/** Working days from `a` to `b` on `cal` (positive when b is later). */
const workDelta = (cal: WorkCalendar, a: IsoDate, b: IsoDate) => cal.workDaysBetween(a, b);

/**
 * The schedule on its own at the data date (project calendar, no ties): forecast dates and slips against the committed dates.
 * `today` marks an activity not started by its committed start as late even before the data date moves.
 */
export function supplierForecast(
  s: SupplierScheduleInput,
  ctx: { dataDate: IsoDate; projectCalendar: string; calendars: Readonly<Record<string, WorkCalendar>>; today: IsoDate; options?: Partial<CpmOptions> },
): SupplierForecastResult {
  if (!s.activities.length) return { ok: true, activities: {}, finish: null, slip: 0, late: false };
  const cal = ctx.calendars[ctx.projectCalendar] ?? Object.values(ctx.calendars)[0];
  let r;
  try {
    r = schedule({
      dataDate: ctx.dataDate, projectCalendar: ctx.projectCalendar, calendars: ctx.calendars,
      activities: s.activities.map((a) => supplierCpmActivity(s.po, a)), links: supplierCpmLinks(s, false), options: { ...DEFAULT_CPM_OPTIONS, ...(ctx.options ?? {}) },
    });
  } catch (e) {
    if (e instanceof CpmCycleError) return { ok: false, cycle: e.cycle };
    if (e instanceof CpmInputError) return { ok: false, issues: e.issues };
    throw e;
  }
  const out: Record<string, SupplierActivityForecast> = {};
  let slip = 0;
  let late = false;
  let finish: IsoDate | null = null;
  for (const a of s.activities) {
    const x = r.activities[supplierNodeId(s.po, a.code)];
    const finishSlip = a.committedFinish && cal ? workDelta(cal, a.committedFinish, x.finish) : null;
    const startSlip = a.committedStart && cal ? workDelta(cal, a.committedStart, x.start) : null;
    const notStartedInTime = x.state === 'not_started' && !!a.committedStart && a.committedStart < ctx.today;
    const isLate = (finishSlip ?? 0) > 0 || notStartedInTime;
    out[a.code] = { start: x.start, finish: x.finish, state: x.state, finishSlip, startSlip, late: isLate };
    if (finishSlip != null && finishSlip > slip) slip = finishSlip;
    late ||= isLate;
    if (!finish || x.finish > finish) finish = x.finish;
  }
  return { ok: true, activities: out, finish, slip, late };
}
