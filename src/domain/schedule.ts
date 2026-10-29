// Plan — WBS & activities: pure business logic (docs/spec/05 §2.4–§2.5, logic 3971–4046 of the prototype).
// Row model and roll-ups, budget-weighted progress, float / variance formatting, predecessor syntax and
// validation, KPI figures, activity-drawer derivations and the numbering rules of the add forms.
// Shared by the server (view model, Server Functions) and tests. No I/O, no translation: strings returned
// here are the prototype's English source strings (translate with t()).
import { dayLabel, pct as pctW, wbsParseDate } from '@/lib/format';

export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';
/** Logic link stored on the successor: [predecessor id, type, lag in days]. */
export type PredLink = [id: string, type: LinkType, lag: number];

/** One activity (a WBS leaf) as the plan reads it. Display dates keep the prototype's text form. */
export interface PlanActivity {
  /** "A1250". */
  id: string;
  /** Work-package code ("1.4"). */
  wbs: string;
  name: string;
  durationDays: number;
  /** "17 Aug" without the " A" suffix; `startActual` carries it. */
  start: string;
  startActual: boolean;
  finish: string;
  finishActual: boolean;
  /** ISO start date (sorting "Next start"); null when unknown. */
  startDate: string | null;
  /** BL1 finish ("31 Aug"). */
  baselineFinish: string;
  /** Finish variance vs baseline in days (negative = late). */
  variance: number;
  /** "FNLT 18 Dec", '' when none. */
  constraint: string;
  violated: boolean;
  /** Stored total float in days (null = none recorded / complete). Use `effectiveFloat()` for display. */
  totalFloat: number | null;
  /** 0–100. */
  pct: number;
  /** Owner key (OWN: "JW"). */
  owner: string | null;
  budget: number;
  actual: number;
  eac: number;
  preds: PredLink[];
  /** Created through "Add activity" (`added`). */
  isAdded?: boolean;
  /** Structure edited (name, owner, duration, budget or logic) after creation (`edited`). */
  edited?: boolean;
  // ── Chapter 4 (S-1, S-2, A-7): optional, absent in the prototype-shaped fixtures ──
  /** ISO finish and displayed-baseline finish (work-package roll-ups by real dates). */
  finishDate?: string | null;
  baselineFinishDate?: string | null;
  /** Calendar override (null = the project calendar). */
  calendarCode?: string | null;
  /** Remaining duration entered (working days); null = derived from % complete. */
  remainingDays?: number | null;
  /** Free float (working days) written by the last Reschedule; null when complete or never scheduled. */
  freeFloat?: number | null;
  /** The last Reschedule dated this activity (`scheduled_at` set). */
  scheduled?: boolean;
  /** Predecessors that drive the early dates (CPM); null before the first Reschedule (the prototype labels the first one). */
  drivingPreds?: string[] | null;
}

export interface PlanPackage {
  /** "1.4". */
  code: string;
  name: string;
  /** Created through "Add work package". */
  added?: boolean;
}

export interface PlanRoot {
  /** "1". */
  code: string;
  name: string;
  start: string | null;
  finish: string | null;
  baselineFinish: string | null;
  totalFloat: number | null;
}

// ── Formatting (prototype strings, logic 4001–4008) ─────────────────────────────────────────────────────

/** Start/finish display text with the " A" (actual) suffix. */
export const withActual = (text: string, actual: boolean) => (actual ? `${text} A` : text);

/** "+20d" / "-27d" / "0d" — the prototype's `(n>0?'+':'')+n+'d'` (ASCII minus, no space). */
export const signedDays = (n: number) => `${n > 0 ? '+' : ''}${n}d`;

/** TF cell: "—" when null (complete), else signed days. */
export const floatText = (tf: number | null) => (tf == null ? '—' : signedDays(tf));

/** Var cell: '' when null (work packages), else "{v}d" (no plus sign: "0d", "-39d"). */
export const varianceText = (v: number | null) => (v == null ? '' : `${v}d`);

/** Predecessors as shown in the read-only list: "A1240 FS, A1220 FS+10d" ('—' when none). */
export const predsLabel = (p: PredLink[]) => p.map(([id, t, l]) => id + ' ' + t + (l ? (l > 0 ? '+' : '') + l + 'd' : '')).join(', ') || '—';

/** Predecessors as the input value: "A1240 FS, A1220 FS+10" (no "d", '' when none). */
export const predsInput = (p: PredLink[]) => p.map(([id, t, l]) => id + ' ' + t + (l ? (l > 0 ? '+' : '') + l : '')).join(', ');

/** Relationship text in the drawer: "FS", "FS +10d", "FS -5d" (`relText`, logic 4019). */
export const relText = (t: LinkType, l: number) => t + (l ? (l > 0 ? ' +' : ' ') + l + 'd' : '');

// ── Row derivations ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Total float after progress (applyOv, logic 3978): null once complete, else the stored float, 10 when none is
 * recorded (an activity reopened from 100 %, or added without one).
 */
export const effectiveFloat = (a: Pick<PlanActivity, 'pct' | 'totalFloat'>): number | null =>
  a.pct === 100 ? null : a.totalFloat == null ? 10 : a.totalFloat;

/** "Behind" (`critical` lightning): negative float and not complete. */
export const isBehind = (tf: number | null, pct: number) => tf != null && tf < 0 && pct < 100;

export type ProgressStatus = 'completed' | 'behind' | 'in_progress' | 'not_started';

/** Table status (logic 4007): Completed > Behind > In progress > Not started. */
export function progressStatus(pct: number, behind: boolean): ProgressStatus {
  return pct === 100 ? 'completed' : behind ? 'behind' : pct > 0 ? 'in_progress' : 'not_started';
}

export const PROGRESS_STATUS: Record<ProgressStatus, { label: string; className: string }> = {
  completed: { label: 'Completed', className: 'tag tag-neutral' },
  behind: { label: 'Behind', className: 'tag tag-accent' },
  in_progress: { label: 'In progress', className: 'tag tag-outline' },
  not_started: { label: 'Not started', className: 'text-muted' },
};

/** Progress bar fill: done → neutral-500, behind → LO, else accent. */
export type BarTone = 'done' | 'behind' | 'normal';
export const barTone = (pct: number, behind: boolean): BarTone => (pct === 100 ? 'done' : behind ? 'behind' : 'normal');

/**
 * Drawer status tag (logic 4022). The prototype used other classes than the table (docs/spec/02 Q-6); the owner chose one
 * colour per status everywhere (X-13b, R-154), so the classes are the table's (`PROGRESS_STATUS`).
 */
export function drawerStatus(pct: number): { label: string; className: string } {
  if (pct === 100) return { label: 'Complete', className: PROGRESS_STATUS.completed.className };
  if (pct > 0) return { label: `In progress · ${pct}%`, className: PROGRESS_STATUS.in_progress.className };
  return { label: 'Not started', className: PROGRESS_STATUS.not_started.className };
}

/** Clamp a typed % complete: parseInt, 0 when invalid, 0..100. */
export const clampPct = (v: string | number) => Math.max(0, Math.min(100, parseInt(String(v), 10) || 0));

/** Budget-weighted % complete, rounded (`Σ(b·pc)/Σb`; Σb of 0 counts as 1). */
export function weightedProgress(acts: Pick<PlanActivity, 'budget' | 'pct'>[]): number {
  const tb = acts.reduce((s, a) => s + a.budget, 0) || 1;
  return Math.round(acts.reduce((s, a) => s + a.budget * a.pct, 0) / tb);
}

export interface Rollup {
  /** First child's start (display text), '—' when empty. */
  start: string;
  /** Last child's finish in display order (not the latest date). */
  finish: string;
  baselineFinish: string;
  pct: number;
  /** Min float of unfinished children (null counted as 0); null when all are complete. */
  tf: number | null;
  budget: number;
  count: number;
}

/** The child whose date wins (`better(candidate, best)`); children without a date are ignored; null when none has one. */
function pick(children: PlanActivity[], date: (a: PlanActivity) => string | null | undefined, better: (x: string, y: string) => boolean): PlanActivity | null {
  let best: PlanActivity | null = null;
  for (const a of children) {
    const d = date(a);
    if (d && (!best || better(d, date(best)!))) best = a;
  }
  return best;
}

/**
 * Work-package roll-up `roll(w)` (logic 3988). Chapter 4 (A-7): start = earliest child start and finish / baseline finish =
 * latest child dates when the ISO dates are known (the prototype took the first / last child in display order, which moving
 * an activity changed); children without dates fall back to the display order.
 */
export function rollUp(children: PlanActivity[]): Rollup {
  if (!children.length) return { start: '—', finish: '—', baselineFinish: '—', pct: 0, tf: null, budget: 0, count: 0 };
  const open = children.filter((x) => x.pct < 100);
  const first = pick(children, (a) => a.startDate, (x, y) => x < y) ?? children[0];
  const last = pick(children, (a) => a.finishDate, (x, y) => x >= y) ?? children[children.length - 1];
  const lastBl = pick(children, (a) => a.baselineFinishDate, (x, y) => x >= y) ?? children[children.length - 1];
  return {
    start: withActual(first.start, first.startActual),
    finish: withActual(last.finish, last.finishActual),
    baselineFinish: lastBl.baselineFinish,
    pct: weightedProgress(children),
    tf: open.length ? Math.min(...open.map((x) => effectiveFloat(x) ?? 0)) : null,
    budget: children.reduce((s, x) => s + x.budget, 0),
    count: children.length,
  };
}

// ── Row model ───────────────────────────────────────────────────────────────────────────────────────────

export type PlanRowKind = 'root' | 'wp' | 'act';

export interface PlanRow {
  kind: PlanRowKind;
  /** Displayed id: "1", "1.4", "A1250". */
  id: string;
  /** WBS code of the row (activity: its work package). */
  wbs: string;
  name: string;
  /** Indent in px: root 0, work package 18, activity 36. */
  indent: number;
  start: string;
  finish: string;
  baselineFinish: string;
  /** Finish variance (null on work packages). */
  variance: number | null;
  /** Total float after progress. */
  tf: number | null;
  pct: number;
  behind: boolean;
  status: ProgressStatus;
  bar: BarTone;
  /** Budget (k€): activity b0, summaries Σ b0. */
  budget: number;
  /** Activities under a summary row (root: all). */
  count: number;
  todos: { done: number; total: number };
  /** Accent dot in the Structure view: added or edited. */
  mark: boolean;
  /** The activity itself (activity rows only). */
  act?: PlanActivity;
}

export interface PlanRowInput {
  root: PlanRoot;
  /** Static root % (`PD.pct`, round(progress × 100)) — the prototype does not roll the root up. */
  rootPct: number;
  /** Root variance = project float (`PD.floatDays`). */
  floatDays: number;
  packages: PlanPackage[];
  /** Activities in display order (sorted by position). */
  activities: PlanActivity[];
  /** To-dos linked by activity id. */
  todosOf: (actId: string) => { done: number; total: number };
  /** To-dos of the whole project (root row). */
  projectTodos: { done: number; total: number };
}

/** Builds every row of the plan (root, then each work package followed by its activities). Collapse is a view concern. */
export function buildPlanRows(input: PlanRowInput): PlanRow[] {
  const { root, packages, activities } = input;
  const rows: PlanRow[] = [];
  const rootBehind = isBehind(root.totalFloat, input.rootPct);
  rows.push({
    kind: 'root', id: root.code, wbs: root.code, name: root.name, indent: 0,
    start: root.start ?? '—', finish: root.finish ?? '—', baselineFinish: root.baselineFinish ?? '—',
    variance: input.floatDays, tf: root.totalFloat, pct: input.rootPct, behind: rootBehind,
    status: progressStatus(input.rootPct, rootBehind), bar: barTone(input.rootPct, rootBehind),
    budget: activities.reduce((s, a) => s + a.budget, 0), count: activities.length, todos: input.projectTodos, mark: false,
  });
  for (const wp of packages) {
    const kids = activities.filter((a) => a.wbs === wp.code);
    const r = rollUp(kids);
    const behind = isBehind(r.tf, r.pct);
    const todos = kids.reduce((s, a) => { const x = input.todosOf(a.id); return { done: s.done + x.done, total: s.total + x.total }; }, { done: 0, total: 0 });
    rows.push({
      kind: 'wp', id: wp.code, wbs: wp.code, name: wp.name, indent: 18, start: r.start, finish: r.finish, baselineFinish: r.baselineFinish,
      variance: null, tf: r.tf, pct: r.pct, behind, status: progressStatus(r.pct, behind), bar: barTone(r.pct, behind),
      budget: r.budget, count: r.count, todos, mark: !!wp.added,
    });
    for (const a of kids) {
      const tf = effectiveFloat(a);
      const b = isBehind(tf, a.pct);
      rows.push({
        kind: 'act', id: a.id, wbs: a.wbs, name: a.name, indent: 36,
        start: withActual(a.start, a.startActual), finish: withActual(a.finish, a.finishActual), baselineFinish: a.baselineFinish,
        variance: a.variance, tf, pct: a.pct, behind: b, status: progressStatus(a.pct, b), bar: barTone(a.pct, b),
        budget: a.budget, count: 0, todos: input.todosOf(a.id), mark: !!(a.isAdded || a.edited), act: a,
      });
    }
  }
  return rows;
}

/** Rows visible with a collapse map (`collapsed[w]` hides the work package's activities, not its header). */
export const visibleRows = (rows: PlanRow[], collapsed: Record<string, boolean>) => rows.filter((r) => r.kind !== 'act' || !collapsed[r.wbs]);

/** Default collapse state (`collapsed`, initial state 3767): global, not per project. */
export const DEFAULT_COLLAPSED: Readonly<Record<string, boolean>> = { '1.1': true, '1.2': true, '1.3': true };

// ── KPIs (`planKpis`, logic 4036–4046) ─────────────────────────────────────────────────────────────────

export interface StructureKpis {
  workPackages: number;
  activities: number;
  budget: number;
  /** Activities behind (the prototype labels it "on the critical path"). */
  behind: number;
  relationships: number;
  byType: Record<LinkType, number>;
  constraints: number;
  violated: number;
}

export function structureKpis(packageCount: number, acts: PlanActivity[]): StructureKpis {
  const byType: Record<LinkType, number> = { FS: 0, SS: 0, FF: 0, SF: 0 };
  for (const a of acts) for (const p of a.preds) byType[p[1]]++;
  return {
    workPackages: packageCount,
    activities: acts.length,
    budget: acts.reduce((s, a) => s + a.budget, 0),
    behind: acts.filter((a) => isBehind(effectiveFloat(a), a.pct)).length,
    relationships: acts.reduce((s, a) => s + a.preds.length, 0),
    byType,
    constraints: acts.filter((a) => a.constraint).length,
    violated: acts.filter((a) => a.violated).length,
  };
}

/**
 * Activities on the critical path (S-1: total float ≤ 0, not complete) — the Structure KPI "… on the critical path"
 * (the prototype counted the behind ones, float < 0; same figures on the seeded data).
 */
export const criticalCount = (acts: PlanActivity[], threshold = 0) =>
  acts.filter((a) => {
    const tf = effectiveFloat(a);
    return tf != null && tf <= threshold && a.pct < 100;
  }).length;

export interface ProgressKpis {
  /** Budget-weighted % complete of all activities. */
  overall: number;
  done: number;
  total: number;
  /** Σ budget of completed activities. */
  earned: number;
  running: number;
  behind: number;
  notStarted: number;
  /** Earliest not-started activity by real start date (WBS order on ties / unknown dates). */
  nextStart: { id: string; start: string } | null;
}

export function progressKpis(acts: PlanActivity[]): ProgressKpis {
  const done = acts.filter((a) => a.pct === 100);
  const fresh = acts.filter((a) => a.pct === 0);
  const next = fresh
    .map((a, i) => ({ a, i }))
    .sort((p, q) => {
      const x = p.a.startDate ?? '9999-12-31';
      const y = q.a.startDate ?? '9999-12-31';
      return x < y ? -1 : x > y ? 1 : p.i - q.i;
    })[0]?.a;
  return {
    overall: weightedProgress(acts),
    done: done.length,
    total: acts.length,
    earned: done.reduce((s, a) => s + a.budget, 0),
    running: acts.filter((a) => a.pct > 0 && a.pct < 100).length,
    behind: acts.filter((a) => isBehind(effectiveFloat(a), a.pct)).length,
    notStarted: fresh.length,
    nextStart: next ? { id: next.id, start: withActual(next.start, next.startActual) } : null,
  };
}

// ── Predecessor syntax (logic 3976) and validation ─────────────────────────────────────────────────────

const PRED_RE = /^(A\d+)\s*(FS|SS|FF|SF)?\s*([+-]?\d+)?\s*d?$/i;

export type PredError = { token: string; reason: 'syntax' | 'unknown' | 'self' | 'duplicate' | 'cycle' };

/**
 * Parses "A1010 FS+5, a1020 ss, A1230 FF 5d". Type defaults to FS, lag to 0. The prototype drops invalid
 * tokens silently; here they are returned in `errors` (unknown id, bad syntax, self-link, duplicate) so the
 * UI can reject the edit (docs/spec/05 §7 "validate … with visible errors").
 */
export function parsePredecessors(text: string, validIds: ReadonlySet<string>, self?: string): { links: PredLink[]; errors: PredError[] } {
  const links: PredLink[] = [];
  const errors: PredError[] = [];
  for (const token of String(text ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = token.match(PRED_RE);
    if (!m) { errors.push({ token, reason: 'syntax' }); continue; }
    const id = m[1].toUpperCase();
    if (!validIds.has(id)) { errors.push({ token, reason: 'unknown' }); continue; }
    if (id === self) { errors.push({ token, reason: 'self' }); continue; }
    if (links.some((l) => l[0] === id)) { errors.push({ token, reason: 'duplicate' }); continue; }
    links.push([id, (m[2] || 'FS').toUpperCase() as LinkType, parseInt(m[3] || '0', 10)]);
  }
  return { links, errors };
}

/**
 * Would giving `succ` these predecessors close a loop? True when `succ` is already a (transitive)
 * predecessor of one of them. `predsOf` returns the current predecessor ids of an activity.
 */
export function createsCycle(succ: string, newPreds: string[], predsOf: (id: string) => string[]): string | null {
  for (const start of newPreds) {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === succ) return start;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...predsOf(id));
    }
  }
  return null;
}

// ── Activity drawer (logic 4019–4030) ──────────────────────────────────────────────────────────────────

/** Office calendar for WBS 1.1 and A1230, site calendar otherwise (hard-coded rule of the prototype). */
export const isSiteCalendar = (a: Pick<PlanActivity, 'wbs' | 'id'>) => !(a.wbs === '1.1' || a.id === 'A1230');
export const calendarLabel = (site: boolean) => (site ? 'Site 6d · 10h' : 'Standard 5d · 8h');

/** Remaining duration: round(d × (1 − pc/100)), or the remaining duration entered (`remaining`). */
export const remainingDays = (d: number, pc: number, remaining?: number | null) => (remaining != null ? remaining : Math.round(d * (1 - pc / 100)));

/** "40d / 11d". */
export const durationText = (d: number, pc: number, remaining?: number | null) => `${d}d / ${remainingDays(d, pc, remaining)}d`;

/**
 * Default resource line when no assignment is recorded: the owner as lead. The prototype reads 8 h/d and "6 × 10 h/d" on
 * site; chapter 4 (S-2) passes the hours per day of the activity's calendar (`hoursPerDay`, 8 by default).
 */
export function ownerResource(ownerName: string, ownerTitle: string, d: number, pc: number, site: boolean, hoursPerDay = 8) {
  const h = site ? 8 : hoursPerDay;
  return {
    name: ownerName,
    sub: `${ownerTitle} · lead · ${Math.round((d * h * pc) / 100)} / ${d * h} h`,
    units: site ? '6 × 10 h/d' : `${hoursPerDay} h/d`,
  };
}

export interface CostBar {
  /** CSS widths/positions on a scale of 1.4 × budget. */
  actualW: string;
  budgetW: string;
  eacW: string;
  /** EAC above budget → EAC in LO and the "Forecast … over" note. */
  over: boolean;
  overBy: number;
}

/** Cost bar of the drawer: actual fill, budget tick at 1/1.4, EAC diamond, all capped at 1.4 × budget. */
export function costBar(budget: number, actual: number, eac: number): CostBar {
  const ratio = (v: number) => (budget > 0 ? Math.min(v / budget, 1.4) : v > 0 ? 1.4 : 0);
  return {
    actualW: pctW(ratio(actual) / 1.4),
    budgetW: pctW(1 / 1.4),
    eacW: pctW(ratio(eac) / 1.4),
    over: eac > budget,
    overBy: eac - budget,
  };
}

/** Activity successors: activities whose predecessors reference `id`, with the link. */
export function successorsOf(id: string, acts: PlanActivity[]): { act: PlanActivity; type: LinkType; lag: number }[] {
  return acts.flatMap((x) => {
    const p = x.preds.find((l) => l[0] === id);
    return p ? [{ act: x, type: p[1], lag: p[2] }] : [];
  });
}

// ── To-dos (todoLite / dueTextOf, logic 3893–3896) ─────────────────────────────────────────────────────

export type TodoStatus = 'todo' | 'doing' | 'review' | 'done';
export const TODO_STATUS_LABEL: Record<TodoStatus, string> = { todo: 'To do', doing: 'In progress', review: 'In review', done: 'Done' };

/** "Done" · "Overdue · Tue 22 Sep" · "Today" · "Thu 1 Oct" (`due`, `today` = working-day offsets from Mon 21 Sep 2026; `today` from `workdayOffsetOf`, R-013). */
export function dueText(status: TodoStatus, due: number, today: number): string {
  if (status === 'done') return 'Done';
  if (due < today) return 'Overdue · ' + dayLabel(due);
  if (due === today) return 'Today';
  return dayLabel(due);
}

// ── Add forms (afSubmit, logic 5129–5131) ──────────────────────────────────────────────────────────────

/**
 * Working days between two "5 Oct 2026" dates (a year-less date is in the business year `year`, R-013): max(1, round(days ×
 * 5/7)); 20 when unparseable or not increasing.
 */
export function workingDaysBetween(start: string, finish: string, year: number): number {
  const ds = wbsParseDate(start, year);
  const df = wbsParseDate(finish, year);
  if (!ds || !df || !(df > ds)) return 20;
  const days = (Date.UTC(df.getFullYear(), df.getMonth(), df.getDate()) - Date.UTC(ds.getFullYear(), ds.getMonth(), ds.getDate())) / 864e5;
  return Math.max(1, Math.round((days * 5) / 7));
}

/** New activity id 'A' + project idx + '9' + NN (NN = added activities + 1, 2 digits), skipping ids in use. */
export function nextActivityCode(projectIdx: number, addedCount: number, existing: ReadonlySet<string>): string {
  for (let n = addedCount + 1; ; n++) {
    const id = `A${projectIdx}9${String(n).padStart(2, '0')}`;
    if (!existing.has(id)) return id;
  }
}

/** New work-package code '1.' + (work packages + 1), skipping codes in use. */
export function nextWorkPackageCode(existing: readonly string[]): string {
  for (let n = existing.length + 1; ; n++) {
    const w = `1.${n}`;
    if (!existing.includes(w)) return w;
  }
}

/** Activity ids of a work package after moving `id` by `dir` (−1 up, +1 down); null at the ends. */
export function moveWithin(ids: readonly string[], id: string, dir: -1 | 1): string[] | null {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const out = ids.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Inline duration edit: parseInt, else the current value (`applyOv`). Minimum 1 (input min=1). */
export const parseDuration = (v: string, current: number) => {
  const n = parseInt(v, 10);
  return n ? Math.max(1, n) : current;
};

/** Inline budget edit: parseFloat, else 0; EAC rises to the new budget when the budget changes (`applyOv`). */
export function applyBudget(v: string, current: { budget: number; eac: number }): { budget: number; eac: number } {
  const b = Math.max(0, parseFloat(v) || 0);
  return { budget: b, eac: b === current.budget ? current.eac : Math.max(current.eac, b) };
}
