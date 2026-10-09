// Critical path method engine (chapter 4, open question S-1; spec 05 §2). Pure and deterministic.
//
// What it does, P6-style ("Reschedule" = F9):
// - forward / backward pass over FS, SS, FF, SF links with lags (negative lags allowed), in WORKING DAYS (S-8);
// - one calendar per activity (its override, else the project calendar); lags counted on the lag calendar (default: the
//   predecessor's, as P6's default "predecessor activity calendar");
// - constraints ASAP, SNET, SNLT, FNET, FNLT, MSO, MFO (MSO / MFO are mandatory: they override logic and report the conflict);
// - progress at the data date: actual dates are kept, completed activities are fixed, the remaining duration of an activity
//   in progress (from its % complete unless entered) is scheduled from the data date with RETAINED LOGIC (an unfinished
//   predecessor still drives the remaining work) or PROGRESS OVERRIDE (option);
// - total float and free float in working days, critical = total float ≤ CPM threshold (0), driving predecessors
//   (relationships with zero relationship float), constraint violations, and cycle detection (CpmCycleError).
//
// Time model (domain/calendar.ts): boundaries. An activity on calendar C occupies the working days [s, f) of C; its start
// date is C.dateOf(s), its finish date C.dateOf(f − 1). A zero-duration activity (milestone) has s = f and is dated
// C.dateOf(s) (P6 start-milestone semantics). Relationships go through 00:00 instants so different calendars mix correctly.
import { CALENDAR_EPOCH, isIsoDate, type IsoDate, type WorkCalendar } from './calendar';

export type CpmLinkType = 'FS' | 'SS' | 'FF' | 'SF';
export type CpmConstraintType = 'ASAP' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';
const CONSTRAINTS: readonly string[] = ['ASAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'];
const LINKS: readonly string[] = ['FS', 'SS', 'FF', 'SF'];

export interface CpmActivityInput {
  id: string;
  /** Original duration, working days (≥ 0; 0 = milestone). */
  duration: number;
  /** Calendar code; null / undefined = the project calendar. */
  calendar?: string | null;
  /** 0–100. */
  percentComplete?: number | null;
  /** Actual start (ISO) — set for activities in progress and complete. */
  actualStart?: IsoDate | null;
  /** Actual finish (ISO) — set for complete activities. */
  actualFinish?: IsoDate | null;
  /** Remaining duration entered by the user (working days); null = derived from % complete. */
  remaining?: number | null;
  /** Constraint; 'ASAP' or null = none. Unknown types are reported as input errors. */
  constraint?: { type: string; date?: IsoDate | null } | null;
}

export interface CpmLinkInput {
  pred: string;
  succ: string;
  type: CpmLinkType;
  /** Working days; may be negative (lead). */
  lag: number;
}

export interface CpmOptions {
  /** Critical when total float ≤ this many working days (S-1 default 0). */
  criticalFloat: number;
  /** Remaining duration of a progressed activity = round / ceil / floor(duration × (1 − % / 100)). */
  remainingRounding: 'round' | 'ceil' | 'floor';
  /** 'retained' (P6 default) or 'override' (progressed activities ignore their predecessors). */
  progressMode: 'retained' | 'override';
  /** Calendar on which lags are counted. */
  lagCalendar: 'predecessor' | 'successor' | 'project';
  /** Remaining work starts on the data date ('data_date', P6) or on the next working day after it. */
  remainingStartsOn: 'data_date' | 'next_day';
}

export const DEFAULT_CPM_OPTIONS: CpmOptions = {
  criticalFloat: 0,
  remainingRounding: 'round',
  progressMode: 'retained',
  lagCalendar: 'predecessor',
  remainingStartsOn: 'data_date',
};

export interface CpmInput {
  /** Data date (status date): remaining work is scheduled from it. */
  dataDate: IsoDate;
  /** Earliest start of unstarted work (project planned start); the data date wins when later. */
  projectStart?: IsoDate | null;
  /** Code of the project calendar (must exist in `calendars`). */
  projectCalendar: string;
  /** Calendars by code. */
  calendars: Readonly<Record<string, WorkCalendar>>;
  activities: readonly CpmActivityInput[];
  links: readonly CpmLinkInput[];
  /** Project deadline: late finish of open-ended activities (default: the project's early finish). */
  mustFinishBy?: IsoDate | null;
  options?: Partial<CpmOptions>;
}

export type CpmActivityState = 'complete' | 'in_progress' | 'not_started';

export interface CpmViolation {
  type: CpmConstraintType;
  date: IsoDate;
  /** Working days by which the constraint is missed (> 0). */
  days: number;
}

export interface CpmActivityResult {
  id: string;
  state: CpmActivityState;
  calendar: string;
  /** Current dates: actual where recorded, else early. */
  start: IsoDate;
  finish: IsoDate;
  /** Early dates (for an activity in progress: actual start and early finish of the remaining work). */
  earlyStart: IsoDate;
  earlyFinish: IsoDate;
  /** Start of the remaining work (in progress / not started); null when complete. */
  remainingStart: IsoDate | null;
  /** Late dates; null when complete. For an activity in progress, lateStart is the late start of its remaining work. */
  lateStart: IsoDate | null;
  lateFinish: IsoDate | null;
  /** Duration actually scheduled (remaining for an activity in progress, 0 when complete). */
  remaining: number;
  /** Working days; null when complete. */
  totalFloat: number | null;
  freeFloat: number | null;
  critical: boolean;
  /** Predecessor ids whose relationship drives this activity's early date. */
  drivingPredecessors: string[];
  violation: CpmViolation | null;
}

export interface CpmResult {
  dataDate: IsoDate;
  /** Earliest start and latest finish over the network. */
  projectStart: IsoDate;
  projectFinish: IsoDate;
  activities: Record<string, CpmActivityResult>;
  /** Topological order (predecessors first, input order among independent activities). */
  order: string[];
  /** Critical activities (not complete, total float ≤ threshold), in topological order. */
  criticalPath: string[];
  /** Relationships with zero relationship float (`pred>succ`). */
  drivingLinks: string[];
}

/** Invalid input (unknown activity, self link, duplicate, bad date or calendar…). `issues` are EN source sentences. */
export class CpmInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid schedule: ${issues.join('; ')}`);
    this.name = 'CpmInputError';
    this.issues = issues;
  }
}

/** The logic contains a loop. `cycle` lists the activity ids of one loop, first id repeated at the end. */
export class CpmCycleError extends Error {
  readonly cycle: string[];
  constructor(cycle: string[]) {
    super(`Circular logic: ${cycle.join(' → ')}`);
    this.name = 'CpmCycleError';
    this.cycle = cycle;
  }
}

export const linkKey = (pred: string, succ: string) => `${pred}>${succ}`;

/** Remaining duration of an activity (see CpmOptions.remainingRounding). */
export function remainingDuration(a: Pick<CpmActivityInput, 'duration' | 'percentComplete' | 'remaining'>, rounding: CpmOptions['remainingRounding'] = 'round'): number {
  if (a.remaining != null && Number.isFinite(a.remaining)) return Math.max(0, Math.round(a.remaining));
  const pc = Math.min(100, Math.max(0, a.percentComplete ?? 0));
  const raw = a.duration * (1 - pc / 100);
  const r = rounding === 'ceil' ? Math.ceil(raw - 1e-9) : rounding === 'floor' ? Math.floor(raw + 1e-9) : Math.round(raw);
  return Math.max(0, r);
}

/**
 * Topological order of `ids` under `links` (Kahn; ties keep input order). Returns the order, or the ids of one cycle
 * (first id repeated at the end).
 */
export function topologicalOrder(ids: readonly string[], links: readonly Pick<CpmLinkInput, 'pred' | 'succ'>[]): { order: string[] } | { cycle: string[] } {
  const index = new Map(ids.map((id, i) => [id, i]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const l of links) {
    if (!index.has(l.pred) || !index.has(l.succ)) continue;
    succs.get(l.pred)!.push(l.succ);
    indeg.set(l.succ, indeg.get(l.succ)! + 1);
  }
  // Min-heap by input index keeps the order deterministic and close to the input.
  const heap: number[] = [];
  const push = (i: number) => {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p] <= heap[c]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1;
        const r = l + 1;
        let m = p;
        if (l < heap.length && heap[l] < heap[m]) m = l;
        if (r < heap.length && heap[r] < heap[m]) m = r;
        if (m === p) break;
        [heap[p], heap[m]] = [heap[m], heap[p]];
        p = m;
      }
    }
    return top;
  };
  ids.forEach((id, i) => indeg.get(id) === 0 && push(i));
  const order: string[] = [];
  while (heap.length) {
    const id = ids[pop()];
    order.push(id);
    for (const s of succs.get(id)!) {
      const n = indeg.get(s)! - 1;
      indeg.set(s, n);
      if (n === 0) push(index.get(s)!);
    }
  }
  if (order.length === ids.length) return { order };
  return { cycle: findCycle(ids.filter((id) => indeg.get(id)! > 0), succs) };
}

function findCycle(candidates: string[], succs: Map<string, string[]>): string[] {
  const inSet = new Set(candidates);
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const dfs = (id: string): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const s of succs.get(id) ?? []) {
      if (!inSet.has(s)) continue;
      if (state.get(s) === 1) return [...stack.slice(stack.indexOf(s)), s];
      if (!state.has(s)) {
        const c = dfs(s);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of candidates) {
    if (state.has(id)) continue;
    const c = dfs(id);
    if (c) return c;
  }
  return candidates.slice(0, 1);
}

/** Cycle the links would create (ids, first repeated at the end), or null — e.g. to refuse "Add relationship". */
export function detectCycle(ids: readonly string[], links: readonly Pick<CpmLinkInput, 'pred' | 'succ'>[]): string[] | null {
  const r = topologicalOrder(ids, links);
  return 'cycle' in r ? r.cycle : null;
}

// ── Engine ────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Node {
  a: CpmActivityInput;
  cal: WorkCalendar;
  state: CpmActivityState;
  d: number; // scheduled duration (remaining for in progress, original otherwise)
  // Early boundaries on the activity's calendar: start (actual start for in progress / complete), remaining start, finish.
  es: number;
  rs: number;
  ef: number;
  lf: number;
  ls: number; // late (remaining) start
  violation: CpmViolation | null;
  driving: string[];
  forcedStart: boolean;
}

/** Runs the CPM on a network. Throws CpmInputError on invalid input and CpmCycleError on circular logic. */
export function schedule(input: CpmInput): CpmResult {
  const opt: CpmOptions = { ...DEFAULT_CPM_OPTIONS, ...(input.options ?? {}) };
  const issues: string[] = [];
  if (!isIsoDate(input.dataDate)) issues.push(`Invalid data date "${input.dataDate}"`);
  else if (input.dataDate < CALENDAR_EPOCH) issues.push(`Data date before ${CALENDAR_EPOCH}`);
  if (input.projectStart != null && !isIsoDate(input.projectStart)) issues.push(`Invalid project start "${input.projectStart}"`);
  if (input.mustFinishBy != null && !isIsoDate(input.mustFinishBy)) issues.push(`Invalid must-finish-by date "${input.mustFinishBy}"`);
  const projectCal = input.calendars[input.projectCalendar];
  if (!projectCal) issues.push(`Unknown project calendar "${input.projectCalendar}"`);

  const byId = new Map<string, CpmActivityInput>();
  for (const a of input.activities) {
    if (!a.id) issues.push('Activity without id');
    else if (byId.has(a.id)) issues.push(`Duplicate activity ${a.id}`);
    else byId.set(a.id, a);
    if (!(Number.isFinite(a.duration) && a.duration >= 0)) issues.push(`${a.id}: duration must be a number ≥ 0`);
    if (a.calendar && !input.calendars[a.calendar]) issues.push(`${a.id}: unknown calendar "${a.calendar}"`);
    if (a.actualStart != null && !isIsoDate(a.actualStart)) issues.push(`${a.id}: invalid actual start "${a.actualStart}"`);
    if (a.actualFinish != null && !isIsoDate(a.actualFinish)) issues.push(`${a.id}: invalid actual finish "${a.actualFinish}"`);
    if (a.actualFinish && !a.actualStart) issues.push(`${a.id}: actual finish without actual start`);
    if (a.actualFinish && a.actualStart && a.actualFinish < a.actualStart) issues.push(`${a.id}: actual finish before actual start`);
    const c = a.constraint;
    if (c && c.type && c.type !== 'ASAP') {
      if (!CONSTRAINTS.includes(c.type)) issues.push(`${a.id}: unknown constraint "${c.type}"`);
      else if (!c.date || !isIsoDate(c.date)) issues.push(`${a.id}: constraint ${c.type} needs a date`);
    }
  }
  const seen = new Set<string>();
  for (const l of input.links) {
    if (!byId.has(l.pred)) issues.push(`Unknown predecessor ${l.pred}${l.succ ? ` of ${l.succ}` : ''}`);
    if (!byId.has(l.succ)) issues.push(`Unknown successor ${l.succ}`);
    if (l.pred === l.succ) issues.push(`${l.pred} cannot be its own predecessor`);
    if (!LINKS.includes(l.type)) issues.push(`${l.pred} → ${l.succ}: unknown link type "${l.type}"`);
    if (!Number.isFinite(l.lag)) issues.push(`${l.pred} → ${l.succ}: lag must be a number`);
    const k = linkKey(l.pred, l.succ);
    if (seen.has(k)) issues.push(`Duplicate link ${l.pred} → ${l.succ}`);
    seen.add(k);
  }
  if (issues.length) throw new CpmInputError(issues);

  const ids = input.activities.map((a) => a.id);
  const topo = topologicalOrder(ids, input.links);
  if ('cycle' in topo) throw new CpmCycleError(topo.cycle);
  const order = topo.order;

  const preds = new Map<string, CpmLinkInput[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, CpmLinkInput[]>(ids.map((id) => [id, []]));
  for (const l of input.links) {
    preds.get(l.succ)!.push(l);
    succs.get(l.pred)!.push(l);
  }

  const calOf = (a: CpmActivityInput) => (a.calendar ? input.calendars[a.calendar] : projectCal!);
  const nodes = new Map<string, Node>();
  for (const a of input.activities) {
    const state: CpmActivityState = a.actualFinish ? 'complete' : a.actualStart ? 'in_progress' : 'not_started';
    const d = state === 'complete' ? 0 : state === 'in_progress' || (a.percentComplete ?? 0) > 0 || a.remaining != null
      ? remainingDuration(a, opt.remainingRounding)
      : Math.round(a.duration);
    nodes.set(a.id, { a, cal: calOf(a), state, d, es: 0, rs: 0, ef: 0, lf: 0, ls: 0, violation: null, driving: [], forcedStart: false });
  }

  const lagCal = (p: Node, s: Node) => (opt.lagCalendar === 'predecessor' ? p.cal : opt.lagCalendar === 'successor' ? s.cal : projectCal!);
  /** Forward: boundary on the successor's calendar implied by a link (start- or finish-type target). */
  const forwardBound = (l: CpmLinkInput, p: Node, s: Node): { target: 'start' | 'finish'; b: number } => {
    const anchorFinish = l.type === 'FS' || l.type === 'FF';
    const target = l.type === 'FS' || l.type === 'SS' ? 'start' : 'finish';
    const anchorInstant = anchorFinish ? p.cal.endInstant(p.ef) : p.cal.startInstant(p.es);
    const lag = Math.round(l.lag);
    // Without lag the successor follows the anchor instant directly (no snapping to the lag calendar's working time).
    if (lag === 0) return { target, b: s.cal.ordinal(anchorInstant) };
    const lc = lagCal(p, s);
    const x = lc.ordinal(anchorInstant) + lag;
    const instant = target === 'start' ? lc.startInstant(Math.max(0, x)) : lc.endInstant(Math.max(0, x));
    return { target, b: s.cal.ordinal(instant) };
  };
  /** Backward: latest boundary on the predecessor's calendar (finish- or start-type anchor) given the successor's late boundary. */
  const backwardBound = (l: CpmLinkInput, p: Node, s: Node, succBoundary: number): { anchor: 'start' | 'finish'; b: number } => {
    const anchorFinish = l.type === 'FS' || l.type === 'FF';
    const target = l.type === 'FS' || l.type === 'SS' ? 'start' : 'finish';
    const instant = target === 'start' ? s.cal.startInstant(Math.max(0, succBoundary)) : s.cal.endInstant(Math.max(0, succBoundary));
    const lag = Math.round(l.lag);
    if (lag === 0) return { anchor: anchorFinish ? 'finish' : 'start', b: p.cal.ordinal(instant) };
    const lc = lagCal(p, s);
    const y = lc.ordinal(instant) - lag;
    const anchorInstant = anchorFinish ? lc.endInstant(Math.max(0, y)) : lc.startInstant(Math.max(0, y));
    return { anchor: anchorFinish ? 'finish' : 'start', b: p.cal.ordinal(anchorInstant) };
  };

  // ── Forward pass ──
  for (const id of order) {
    const n = nodes.get(id)!;
    const { cal, a } = n;
    if (n.state === 'complete') {
      n.es = cal.startBoundary(a.actualStart!);
      n.ef = Math.max(n.es, cal.finishBoundary(a.actualFinish!));
      n.rs = n.ef;
      continue;
    }
    const dataB = cal.startBoundary(opt.remainingStartsOn === 'next_day' ? addDay(input.dataDate) : input.dataDate);
    let startLb = dataB;
    if (input.projectStart) startLb = Math.max(startLb, cal.startBoundary(input.projectStart));
    let finishLb = -Infinity;
    const cands: { pred: string; target: 'start' | 'finish'; b: number }[] = [];
    const inProgress = n.state === 'in_progress';
    for (const l of preds.get(id)!) {
      const p = nodes.get(l.pred)!;
      if (inProgress) {
        if (opt.progressMode === 'override') continue;
        // Retained logic: the start already happened, so start-anchored-to-start relations (SS) no longer apply.
        if (l.type === 'SS') continue;
      }
      const c = forwardBound(l, p, n);
      cands.push({ pred: l.pred, ...c });
      if (c.target === 'start') startLb = Math.max(startLb, c.b);
      else finishLb = Math.max(finishLb, c.b);
    }
    const cons = a.constraint && a.constraint.type !== 'ASAP' ? (a.constraint as { type: CpmConstraintType; date: IsoDate }) : null;
    if (inProgress) {
      n.es = cal.startBoundary(a.actualStart!);
      n.rs = Math.max(startLb, n.es);
      n.ef = Math.max(n.rs + n.d, finishLb);
      if (cons?.type === 'FNET') n.ef = Math.max(n.ef, cal.startBoundary(cons.date) + 1);
      if (cons?.type === 'MFO') {
        const forced = cal.finishBoundary(cons.date);
        if (n.ef > forced) n.violation = { type: 'MFO', date: cons.date, days: n.ef - forced };
        n.ef = Math.max(forced, n.rs);
      }
    } else {
      if (cons?.type === 'SNET') startLb = Math.max(startLb, cal.startBoundary(cons.date));
      if (cons?.type === 'FNET') finishLb = Math.max(finishLb, cal.startBoundary(cons.date) + 1);
      let es = Math.max(startLb, finishLb - n.d);
      let ef = es + n.d;
      if (cons?.type === 'MSO') {
        const forced = cal.startBoundary(cons.date);
        if (es > forced) n.violation = { type: 'MSO', date: cons.date, days: es - forced };
        es = forced;
        ef = es + n.d;
        n.forcedStart = true;
      } else if (cons?.type === 'MFO') {
        const forced = cal.finishBoundary(cons.date);
        if (ef > forced) n.violation = { type: 'MFO', date: cons.date, days: ef - forced };
        ef = forced;
        es = ef - n.d;
        n.forcedStart = true;
      }
      n.es = es;
      n.rs = es;
      n.ef = ef;
    }
    // Driving relationships: zero relationship float.
    n.driving = [...new Set(cands.filter((c) => (c.target === 'start' ? c.b === n.rs : c.b === n.ef)).map((c) => c.pred))];
  }

  // Project finish instant (latest early finish over all activities, as a date at 00:00 after it).
  let finishInstant = CALENDAR_EPOCH;
  for (const n of nodes.values()) {
    const fi = n.cal.endInstant(n.ef);
    if (fi > finishInstant) finishInstant = fi;
  }
  const deadlineInstant = input.mustFinishBy ? addDay(input.mustFinishBy) : finishInstant;

  // ── Backward pass ──
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const n = nodes.get(id)!;
    if (n.state === 'complete') {
      n.lf = n.ef;
      n.ls = n.es;
      continue;
    }
    const { cal } = n;
    let lf = cal.ordinal(deadlineInstant);
    for (const l of succs.get(id)!) {
      const s = nodes.get(l.succ)!;
      if (s.state === 'complete') continue;
      if (s.state === 'in_progress') {
        if (opt.progressMode === 'override') continue;
        if (l.type === 'SS') continue;
      }
      const succBoundary = l.type === 'FS' || l.type === 'SS' ? s.ls : s.lf;
      const bb = backwardBound(l, n, s, succBoundary);
      if (bb.anchor === 'finish') lf = Math.min(lf, bb.b);
      else if (n.state === 'not_started') lf = Math.min(lf, bb.b + n.d);
      // In progress: its start is actual, start-anchored relationships do not constrain its finish.
    }
    const cons = n.a.constraint && n.a.constraint.type !== 'ASAP' ? (n.a.constraint as { type: CpmConstraintType; date: IsoDate }) : null;
    if (cons?.type === 'FNLT') lf = Math.min(lf, cal.finishBoundary(cons.date));
    if (cons?.type === 'SNLT' && n.state === 'not_started') lf = Math.min(lf, cal.finishBoundary(cons.date) - 1 + n.d);
    if (cons?.type === 'MFO') lf = cal.finishBoundary(cons.date);
    if (cons?.type === 'MSO' && n.state === 'not_started') lf = cal.startBoundary(cons.date) + n.d;
    n.lf = lf;
    n.ls = lf - n.d;
    // Late-side constraint violations (early date beyond the constraint date).
    if (!n.violation && cons) {
      if (cons.type === 'FNLT') {
        const bound = cal.finishBoundary(cons.date);
        if (n.ef > bound) n.violation = { type: 'FNLT', date: cons.date, days: n.ef - bound };
      } else if (cons.type === 'SNLT' && n.state === 'not_started') {
        const bound = cal.finishBoundary(cons.date) - 1;
        if (n.es > bound) n.violation = { type: 'SNLT', date: cons.date, days: n.es - bound };
      }
    }
  }

  // ── Free float, results ──
  const results: Record<string, CpmActivityResult> = {};
  const drivingLinks: string[] = [];
  for (const id of order) {
    const n = nodes.get(id)!;
    const { cal } = n;
    for (const p of n.driving) drivingLinks.push(linkKey(p, id));
    if (n.state === 'complete') {
      results[id] = {
        id, state: n.state, calendar: cal.code, start: n.a.actualStart!, finish: n.a.actualFinish!, earlyStart: n.a.actualStart!, earlyFinish: n.a.actualFinish!,
        remainingStart: null, lateStart: null, lateFinish: null, remaining: 0, totalFloat: null, freeFloat: null, critical: false, drivingPredecessors: n.driving,
        violation: null,
      };
      continue;
    }
    // Free float: how far the finish (or remaining start) may slip without delaying any successor's early date.
    let ffBound = cal.ordinal(finishInstant);
    for (const l of succs.get(id)!) {
      const s = nodes.get(l.succ)!;
      if (s.state === 'complete') continue;
      if (s.state === 'in_progress' && (opt.progressMode === 'override' || l.type === 'SS')) continue;
      const succBoundary = l.type === 'FS' || l.type === 'SS' ? s.rs : s.ef;
      const bb = backwardBound(l, n, s, succBoundary);
      if (bb.anchor === 'finish') ffBound = Math.min(ffBound, bb.b);
      else if (n.state === 'not_started') ffBound = Math.min(ffBound, bb.b + n.d);
    }
    const tf = n.lf - n.ef;
    const ff = ffBound - n.ef;
    const startIso = n.state === 'in_progress' ? n.a.actualStart! : dateAt(cal, n.es);
    const finishIso = n.ef > n.es ? cal.dateOf(n.ef - 1) : dateAt(cal, n.es);
    results[id] = {
      id,
      state: n.state,
      calendar: cal.code,
      start: startIso,
      finish: n.state === 'in_progress' && n.ef <= n.rs && n.d === 0 ? finishOfZeroRemaining(cal, n) : finishIso,
      earlyStart: startIso,
      earlyFinish: n.state === 'in_progress' && n.ef <= n.rs && n.d === 0 ? finishOfZeroRemaining(cal, n) : finishIso,
      remainingStart: dateAt(cal, n.rs),
      lateStart: dateAt(cal, n.ls),
      lateFinish: n.lf > n.ls ? cal.dateOf(n.lf - 1) : dateAt(cal, n.ls),
      remaining: n.d,
      totalFloat: tf,
      freeFloat: ff,
      critical: tf <= opt.criticalFloat,
      drivingPredecessors: n.driving,
      violation: n.violation,
    };
  }

  const criticalPath = order.filter((id) => results[id].critical);
  let projectFinish = CALENDAR_EPOCH;
  let projectStart: IsoDate | null = null;
  for (const r of Object.values(results)) {
    if (r.finish > projectFinish) projectFinish = r.finish;
    if (!projectStart || r.start < projectStart) projectStart = r.start;
  }
  return { dataDate: input.dataDate, projectStart: projectStart ?? input.dataDate, projectFinish, activities: results, order, criticalPath, drivingLinks };
}

const addDay = (iso: IsoDate) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};
const dateAt = (cal: WorkCalendar, b: number) => cal.dateOf(Math.max(0, b));
/** An activity in progress with no remaining work finishes on the last working day before its remaining start. */
const finishOfZeroRemaining = (cal: WorkCalendar, n: Node) => cal.dateOf(Math.max(n.es, n.rs - 1));

/** Number of activities whose current dates, floats or critical flag differ between two results (Reschedule toast). */
export function changedActivities(before: Readonly<Record<string, Pick<CpmActivityResult, 'start' | 'finish' | 'totalFloat' | 'critical'>>>, after: CpmResult): string[] {
  return after.order.filter((id) => {
    const b = before[id];
    const a = after.activities[id];
    return !b || b.start !== a.start || b.finish !== a.finish || b.totalFloat !== a.totalFloat || b.critical !== a.critical;
  });
}
