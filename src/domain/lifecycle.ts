// Project lifecycle (stage gate) and New project wizard rules (docs/spec/03 §5, docs/spec/01 §10–§11).
// Ports of the prototype's TRANS (3146), missingOf/advance/toggleDeliv (3919–3923), the stage slider
// (stVals 3905–3915), the register filter (3933) and the wizard helpers (nextProjectId/nextAnalytic 3177–3178,
// npVals 3949–3969). Pure: strings are the prototype's English source strings (render them through t()).
import { STAGES, clientCode3, nextStageOf, type StageCode } from '@/server/db/codes';
import { isIsoDate } from './calendar';
import { nextActiveStage } from './settings-rules';

export type { StageCode };

// ── Stages and transitions ─────────────────────────────────────────────────────────────────────────

/** The 13 stages in STATUSES order (slider stops 1–13). */
export const STAGE_CODES: readonly StageCode[] = STAGES.map((s) => s.code);

/** STAGE_ORDER: the 12 ordered stages (Annulé is outside the order). */
export const STAGE_ORDER: readonly StageCode[] = STAGES.filter((s) => s.seq != null)
  .sort((a, b) => a.seq! - b.seq!)
  .map((s) => s.code);

/** Pipeline stages (PIPE_STAGES). */
export const PIPELINE_STAGES: readonly StageCode[] = ['initiative', 'aps', 'apd'];

/** Next stage in STAGE_ORDER, or null for Clos / Annulé. */
export const nextStage = (stage: StageCode): StageCode | null => nextStageOf(stage);

/**
 * TRANS (3146): the next stage (no skipping, no going back) and Annulé; nothing from Clos / Annulé. `skip` = stages
 * deactivated in Settings › Project statuses (chapter 4, A-14): the next ACTIVE stage is offered instead.
 */
export function transitionsOf(stage: StageCode, skip?: ReadonlySet<string>): StageCode[] {
  if (stage === 'clos' || stage === 'annule') return [];
  const next = skip?.size ? nextActiveStage(STAGE_ORDER, stage, skip) : nextStage(stage);
  return next ? [next, 'annule'] : ['annule'];
}

export const isTransitionAllowed = (from: StageCode, to: StageCode, skip?: ReadonlySet<string>) => transitionsOf(from, skip).includes(to);

export type MoveMode = 'auto' | 'forced';

/** Line 3938: moving to Annulé, or leaving a stage with unticked deliverables, goes through the Force dialog. */
export function moveModeFor(to: StageCode, missing: readonly string[]): MoveMode {
  return to === 'annule' || missing.length > 0 ? 'forced' : 'auto';
}

/** Unticked deliverables (missingOf 3920). `done` is aligned with `deliverables` (missing entries = not done). */
export function missingOf(deliverables: readonly string[], done: readonly boolean[]): string[] {
  return deliverables.filter((_, i) => !done[i]);
}

/** "2 / 4" and the 56px bar width ("50%") of the Stage deliverables cell (delivText / delivPct 3939). */
export function deliverableProgress(done: readonly boolean[]): { done: number; total: number; text: string; pct: string } {
  const n = done.filter(Boolean).length;
  const total = done.length;
  return { done: n, total, text: `${n} / ${total}`, pct: total ? Math.round((n / total) * 100) + '%' : '0%' };
}

/**
 * toggleDeliv (3923): sets deliverable `index` of `stage` (flips it when `value` is omitted). When this completes
 * every deliverable of the project's current stage and a next stage exists, the project advances (mode auto).
 */
export function deliverableToggle(
  current: StageCode,
  stage: StageCode,
  done: readonly boolean[],
  index: number,
  value?: boolean,
  skip?: ReadonlySet<string>,
): { done: boolean[]; advanceTo: StageCode | null } {
  const next = done.map((d, i) => (i === index ? (value ?? !d) : !!d));
  const nxt = skip?.size ? nextActiveStage(STAGE_ORDER, stage, skip) : nextStage(stage);
  const advanceTo = current === stage && next.length > 0 && next.every(Boolean) && nxt ? nxt : null;
  return { done: next, advanceTo };
}

/**
 * Server-side validation of a requested move (advance 3922 plus the dialog rules of 01 §11). Returns an English
 * error message, or null when the move is valid.
 */
export function moveError(
  from: StageCode, to: StageCode, mode: MoveMode, missing: readonly string[], reason: string, skip?: ReadonlySet<string>,
): string | null {
  if (!isTransitionAllowed(from, to, skip)) return 'This stage change is not allowed';
  if (mode === 'auto' && moveModeFor(to, missing) === 'forced') return 'Deliverables are missing — force the stage change';
  if (mode === 'forced' && !reason.trim()) return 'A reason is required to force the stage change';
  return null;
}

// ── Effective date of a stage change (L-4c = a, Delivery 7 R-055) ────────────────────────────────────

/**
 * Bounds of the effective date the PM enters for a stage change: from the previous change's effective date (the
 * history stays chronological; the same day is allowed) to "today" — the project's data date (S-4: the status date
 * until a per-project data date is written). The time of entry stays in the audit trail.
 */
export interface EffectiveDateBounds {
  /** Effective date of the project's latest stage change (ISO), null for a project without history. */
  previous: string | null;
  /** The project's data date (ISO). */
  today: string;
}

/** Default effective date: today (L-4c), never before the previous change (a history dated after the data date). */
export const defaultEffectiveDate = (b: EffectiveDateBounds): string => (b.previous && b.previous > b.today ? b.previous : b.today);

/** Why an entered effective date is refused (EN source string), or null when it is valid. */
export function effectiveDateError(effectiveOn: unknown, b: EffectiveDateBounds): string | null {
  if (!isIsoDate(effectiveOn)) return 'Enter a valid effective date';
  if (effectiveOn > defaultEffectiveDate(b)) return 'The effective date cannot be after today';
  if (b.previous && effectiveOn < b.previous) return 'The effective date cannot be before the previous stage change';
  return null;
}

/** Stages whose rows show no health / EVM indicators in the register (showH, 3933). */
export const NO_INDICATOR_STAGES: readonly StageCode[] = ['initiative', 'aps', 'clos', 'annule'];

/** `showH`: the project has a health and is not in a pipeline-start / closed stage. */
export const isLiveRow = (stage: StageCode, health: unknown) => !!health && !NO_INDICATOR_STAGES.includes(stage);

// ── Stage slider (stVals 3905–3915) ────────────────────────────────────────────────────────────────

/** 14 stops: 0 = All, 1–13 = STATUSES. */
export const SLIDER_MAX = STAGE_CODES.length;

/** Slider stop of a status filter (null = All). */
export const sliderStopOf = (stage: StageCode | null): number => (stage ? STAGE_CODES.indexOf(stage) + 1 : 0);

/** Status filter of a slider stop (clamped). */
export function stageAtStop(i: number): StageCode | null {
  const k = Math.max(0, Math.min(SLIDER_MAX, Math.round(i)));
  return k ? STAGE_CODES[k - 1] : null;
}

/** Horizontal position of a stop: `i / 13 × 100` with 3 decimals ("46.154%"). */
export const sliderLeft = (i: number) => ((i / SLIDER_MAX) * 100).toFixed(3) + '%';

/** Stop nearest to a pointer position given as a ratio of the slider width (stIdxOf 3908). */
export const stopFromRatio = (ratio: number) => Math.round(Math.max(0, Math.min(1, ratio)) * SLIDER_MAX);

/** Keyboard (stKey 3912): →/↑ next, ←/↓ previous, Home → All, End → Annulé; null for other keys. */
export function stopForKey(key: string, current: number): number | null {
  let i = current;
  if (key === 'ArrowRight' || key === 'ArrowUp') i++;
  else if (key === 'ArrowLeft' || key === 'ArrowDown') i--;
  else if (key === 'Home') i = 0;
  else if (key === 'End') i = SLIDER_MAX;
  else return null;
  return Math.max(0, Math.min(SLIDER_MAX, i));
}

export type TickState = 'on' | 'past' | 'has' | 'empty';

export interface SliderTick {
  index: number;
  stage: StageCode | null;
  /** EN source / domain label: 'All' or ST_SHORT ('Fab.'). */
  label: string;
  count: number;
  left: string;
  /** Dot colour: on = accent + ring, past = accent-700, has = neutral-500, empty = neutral-800. */
  dot: TickState;
  /** Label colour: on = accent-300 (500), has = neutral-300, empty = neutral-600. */
  text: 'on' | 'has' | 'empty';
  /** Odd stops: 14px connector and 6px label offset (labels alternate on two rows). */
  odd: boolean;
}

/** Ticks of the slider. `counts` = projects per stage in the current zone; `total` = all of them. */
export function sliderTicks(counts: Partial<Record<StageCode, number>>, total: number, selected: number): SliderTick[] {
  const items = [
    { stage: null as StageCode | null, label: 'All', count: total },
    ...STAGES.map((s) => ({ stage: s.code as StageCode | null, label: s.short, count: counts[s.code] ?? 0 })),
  ];
  return items.map((t, i) => ({
    index: i,
    stage: t.stage,
    label: t.label,
    count: t.count,
    left: sliderLeft(i),
    dot: i === selected ? 'on' : i < selected ? 'past' : t.count ? 'has' : 'empty',
    text: i === selected ? 'on' : t.count ? 'has' : 'empty',
    odd: i % 2 === 1,
  }));
}

/** Projects per stage. */
export function stageCounts(stages: readonly StageCode[]): Partial<Record<StageCode, number>> {
  const out: Partial<Record<StageCode, number>> = {};
  for (const s of stages) out[s] = (out[s] ?? 0) + 1;
  return out;
}

/** "1 project" / "n projects". */
export const projectCountText = (n: number) => (n === 1 ? '1 project' : `${n} projects`);

/** Selected-stage block: label, sub-line ("2 projects · <LIFE>") and hint (EN; LIFE is French domain text). */
export function stageSelection(stageLabel: string | null, count: number, description: string | null) {
  return {
    label: stageLabel ?? 'All projects',
    sub: projectCountText(count) + (stageLabel && description ? ' · ' + description : ''),
    hint: stageLabel ? 'Drag the cursor or use ← → to change stage' : 'Drag the cursor to filter by stage',
  };
}

// ── Register (3933, 5183) ──────────────────────────────────────────────────────────────────────────

export type RegisterView = 'health' | 'progress' | 'budget';
export const REGISTER_VIEWS: readonly RegisterView[] = ['health', 'progress', 'budget'];
export const isRegisterView = (v: unknown): v is RegisterView => REGISTER_VIEWS.includes(v as RegisterView);

/** Right-hand hint of the register card (projViewHint). */
export const VIEW_HINT: Record<RegisterView, string> = {
  health: 'Click a status to move it',
  progress: 'Forecast from SPI',
  budget: 'EAC = budget / CPI',
};

/** Card title: "{stage|All} projects · {rows}". */
export const registerTitle = (stageLabel: string | null, rows: number) => `${stageLabel ?? 'All'} projects · ${rows}`;

export interface SearchableProject {
  /** Names the user may type (English source name and its translation). */
  names: readonly string[];
  code: string;
  /** "#026" or '' when the project has no number. */
  number: string;
  analytic: string;
  machineType: string;
  /** R-185: the types of every equipment line (the search matches any of them); absent = `machineType` only. */
  machineTypes?: readonly string[];
}

/**
 * Register search (3933): name or code or project number or analytic code contains the query, or the machine
 * type equals it (case-insensitive). Empty query matches everything.
 */
export function matchesQuery(p: SearchableProject, q: string): boolean {
  const ql = q.toLowerCase();
  if (!ql) return true;
  return (
    p.names.some((n) => n.toLowerCase().includes(ql)) ||
    p.code.toLowerCase().includes(ql) ||
    p.number.includes(ql) ||
    p.analytic.toLowerCase().includes(ql) ||
    (p.machineTypes ?? [p.machineType]).some((m) => m.toLowerCase() === ql)
  );
}

// ── New project wizard (01 §10) ────────────────────────────────────────────────────────────────────

export const DAS_LIST = ['1', '2', '3', '4'] as const;
export const WIZARD_CURRENCIES = ['USD', 'EUR'] as const;
export type WizardCurrency = (typeof WIZARD_CURRENCIES)[number];
export const CONTINGENCIES = [5, 10, 15] as const;
/** Default-calendar options (np.cal); EN source strings. */
export const WIZARD_CALENDARS = ['Standard 5d · 8h', 'Site 6d · 10h', '24h continuous'] as const;
export type WizardCalendar = (typeof WIZARD_CALENDARS)[number];
/** Category types offered by the budget step (FR Main-d’œuvre / Matériel / Sous-traitance / Frais / Équipement). */
export const CATEGORY_TYPES = ['Labor', 'Material', 'Subcontract', 'Fees', 'Equipment'] as const;
/** Row appended by "Add category". */
export const NEW_CATEGORY = { name: 'New category', type: 'Labor', budget: '0' } as const;

/**
 * Fixed values of a wizard-created project (npCreate 3969; 03 OQ12): PM S. Perrin, Jan 2027 → Sep 2027 (month
 * indexes since Jan 2026). The wizard's PM / planned start / planned finish fields are static displays.
 */
export const NEW_PROJECT_DEFAULTS = { pm: 'S. Perrin', start: 'Jan 2027', finish: 'Sep 2027', startMonth: 12, finishMonth: 20 } as const;

/** nextProjectId (3177): "#" + (highest existing number + 1) on 3 digits. */
export function nextProjectId(numbers: readonly (string | null | undefined)[]): string {
  const max = Math.max(0, ...numbers.filter((n): n is string => !!n && /^#\d+$/.test(n)).map((n) => +n.slice(1)));
  return '#' + String(max + 1).padStart(3, '0');
}

/**
 * nextAnalytic (3178): client code + (existing analytic codes with that prefix + 1) on 3 digits. Analytic codes are
 * unique (shared with Lucca / Sage X3): when the counter lands on a code already taken (seed: "Health trust" →
 * CPL002 exists), the next free number is used instead (CPL003) — the prototype would have issued a duplicate.
 */
export function nextAnalytic(code3: string, analytics: readonly (string | null | undefined)[]): string {
  const prefixed = analytics.filter((a): a is string => !!a && a.startsWith(code3));
  const taken = new Set(prefixed);
  let n = prefixed.length + 1;
  while (taken.has(code3 + String(n).padStart(3, '0'))) n++;
  return code3 + String(n).padStart(3, '0');
}

export interface ProjectIdentity {
  /** "#045". */
  number: string;
  /** "LOG-045". */
  code: string;
  /** "LOG001". */
  analytic: string;
}

/**
 * Identity of a project created by the wizard (npCreate 3969): next number, code "<XXX>-<digits>" and analytic
 * code. The number is bumped while it or the resulting code is already used (e.g. a pipeline project coded
 * "EWA-051" without a number), so the unique keys always hold.
 */
export function allocateProjectIdentity(input: {
  code3: string;
  numbers: readonly (string | null | undefined)[];
  codes: readonly string[];
  analytics: readonly (string | null | undefined)[];
}): ProjectIdentity {
  const numbers = new Set(input.numbers.filter(Boolean));
  const codes = new Set(input.codes);
  let number = nextProjectId(input.numbers);
  while (numbers.has(number) || codes.has(newProjectCode(input.code3, number)))
    number = '#' + String(+number.slice(1) + 1).padStart(3, '0');
  return { number, code: newProjectCode(input.code3, number), analytic: nextAnalytic(input.code3, input.analytics) };
}

/** The wizard's 3-letter client code: registered code, else the proposed one (clientCode3 3176). */
export const wizardClientCode = (client: string, clientCodes: Readonly<Record<string, string>>) => clientCode3(client, clientCodes[client]);

/** Hint next to the analytic code (anaHint 3958). */
export function analyticHint(client: string, clientCodes: Readonly<Record<string, string>>): string {
  if (!client) return '3 client letters + incremental number';
  const registered = clientCodes[client];
  return registered ? `Client code ${registered} · incremental number` : `New client — code ${clientCode3(client)} proposed`;
}

/** New project code: client code + "-" + the number's digits ("LOG-045"). */
export const newProjectCode = (code3: string, projectId: string) => `${code3}-${projectId.slice(1)}`;

/** npTotal (3949): Σ budgets (k) × (1 + contingency %). Unparseable budgets count as 0. */
export function wizardTotal(cats: readonly { budget: string | number }[], contingencyPct: number): number {
  return cats.reduce((a, c) => a + (parseFloat(String(c.budget)) || 0), 0) * (1 + contingencyPct / 100);
}

/** totalText (3965): "€2.04M" / "$950k" — not localised, as in the prototype. */
export function wizardTotalText(total: number, currency: WizardCurrency): string {
  return (currency === 'EUR' ? '€' : '$') + (total >= 1000 ? (total / 1000).toFixed(2) + 'M' : Math.round(total) + 'k');
}

/** Copy-panel value of "Cost categories" (copyItems 3954). */
export const templateCategoriesText = (n: number) => (n ? `${n} categories` : 'Define in step 3');

/** Budget-step source caption (catSource 3959). */
export const categorySource = (template: { blank: boolean; name: string }) =>
  template.blank ? 'Start from nothing' : `Budget structure of ${template.name}`;

export interface WizardSummaryInput {
  projectId: string;
  analytic: string;
  das: string;
  machineType: string;
  name: string;
  template: { blank: boolean; wbs: string; acts: string };
  categories: number;
  contingencyPct: number;
  calendar: string;
}

/** "Will be created" sentence (summary 3967). */
export function wizardSummary(s: WizardSummaryInput): string {
  const structure = s.template.blank ? 'empty WBS' : `${s.template.wbs}, ${s.template.acts} copied`;
  return (
    `${s.projectId} · ${s.analytic} · DAS ${s.das} · ${s.machineType} · ${s.name || 'Untitled project'} · status Initiative · ` +
    `${structure} · ${s.categories} cost categories with ${s.contingencyPct}% contingency · ${s.calendar} calendar · weekly data date.`
  );
}
