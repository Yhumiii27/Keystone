// Change control & baselines logic (docs/spec/07 §2.2; prototype logic 4591–4610): derived CR status, type
// filter chips, KPI tiles, register cells, approval-chain indicators, the drawer's impact list, who decides which
// step, and the baseline register. Pure functions over plain data; strings are the prototype's English source
// (render through t()), amounts are formatted with lib/format money(). Golden values: change-control.test.ts.
//
// Deliberate fixes of prototype defects (docs/spec/00 §7.16, 07 OQ1–2, OQ18):
// - the status is always derived from the chain once submitted (the prototype's "In review" override stuck);
// - the change control board step is recorded by the portfolio director (no persona maps to `ccb`);
// - the Baseline KPI follows the baseline register instead of the static "BL1 / BL2 proposed · CR-009 draft".
// Delivery 8 (R-069, P-6b / P-6c): the chain is sequential (PM → director → client → board), the client step is not required
// for an internal change and the board only above the Settings threshold; the "Pending value" sub-line names the current steps.
import type { RoleKey } from '@/config/screens';
import type { Lang } from '@/i18n/translate';
import { money } from '@/lib/format';
import type { BaselineState, ChangeStatus, ChangeStep, ChangeType, ContractImpact, StepDecision } from '@/server/db/codes';

// ── Data shapes (structural subset of the DAL's ChangeRequestDetail / BaselineRow) ──────────────────────

export interface ChainStepLike {
  step: ChangeStep;
  /** Null when the dataset has no chain for this request (CR-005, known only from the Budget dataset). */
  decision: StepDecision | null;
  /** Who decides: project PM, portfolio director, client contact; the CCB cadence. */
  approver?: string | null;
}

export interface ChangeRequestLike {
  /** "CR-008". */
  id: string;
  title: string;
  types: ChangeType[];
  /** Signed k€. */
  amount: number;
  /** Signed days on handover (negative = gain). */
  days: number;
  status: ChangeStatus;
  /** "R. Aubert" / "Steering committee". */
  by: string;
  /** "24 Sep". */
  date: string;
  /** "BL1" / "BL2". */
  baseline: string | null;
  chain: ChainStepLike[];
  /** WBS impacted, with the summary name when the code exists in the project WBS. */
  wbs: { code: string; name: string | null }[];
  /** Delivery 8 (R-069): contractual impact chosen when it was raised (null before it was asked). */
  contractImpact?: ContractImpact | null;
  /** Delivery 8 (R-140, X-11 shared): the justification as typed, shown in the drawer to every viewer, the client included. */
  justification?: string | null;
}

export interface BaselineLike {
  code: string;
  name: string;
  /** "12 Mar 2026" or "Pending CR-009". */
  setOn: string;
  bac: number;
  /** "18 Dec 2026". */
  finish: string;
  state: BaselineState;
  /** Change request carrying a proposed baseline ("CR-009"). */
  changeRequest: string | null;
}

// ── Labels and tones ────────────────────────────────────────────────────────────────────────────────

/** CR_TYPES (3497), chip order. */
export const CR_TYPES: readonly ChangeType[] = ['budget', 'scope', 'schedule'];
export const CR_TYPE_LABEL: Record<ChangeType, string> = { budget: 'Budget', scope: 'Scope', schedule: 'Schedule' };
/** Approval chain order (CHAIN 4598). */
export const CR_STEPS: readonly ChangeStep[] = ['pm', 'director', 'client', 'ccb'];
export const CR_STEP_LABEL: Record<ChangeStep, string> = {
  pm: 'Project manager',
  director: 'Portfolio director',
  client: 'Client / sponsor',
  ccb: 'Change control board',
};
export const CR_STATUS_LABEL: Record<ChangeStatus, string> = { draft: 'Draft', in_review: 'In review', approved: 'Approved', rejected: 'Rejected' };

export type TagTone = 'accent' | 'outline' | 'neutral';

/** crTag (4594): Approved → neutral · Rejected → outline · In review → accent · Draft → outline. */
export const CR_STATUS_TONE: Record<ChangeStatus, TagTone> = { approved: 'neutral', rejected: 'outline', in_review: 'accent', draft: 'outline' };

/** Baseline state tag (blRows 4605): Current → accent · Proposed → outline · Superseded → neutral. */
export const BASELINE_TONE: Record<BaselineState, TagTone> = { current: 'accent', proposed: 'outline', superseded: 'neutral' };
export const BASELINE_STATE_LABEL: Record<BaselineState, string> = { current: 'Current', proposed: 'Proposed', superseded: 'Superseded' };

/** Drawer state tag of a step (crVals.chain 4609). */
export function stepState(decision: StepDecision | null): { label: string; tone: TagTone } | null {
  switch (decision) {
    case 'ok':
      return { label: 'Approved', tone: 'neutral' };
    case 'rejected':
      return { label: 'Rejected', tone: 'outline' };
    case 'na':
      return { label: 'Not required', tone: 'neutral' };
    case 'pending':
      return { label: 'Pending', tone: 'accent' };
    default:
      return null; // chain not recorded
  }
}

/** Colour tokens of the register's mini indicator (crRows.chain 4600). */
export interface ChainDot {
  step: ChangeStep;
  /** First word of the step label: Project, Portfolio, Client, Change. */
  label: string;
  /** CSS colour of the 8px dot. */
  dot: string;
  /** Inset ring (n/a and unrecorded steps), else 'none'. */
  ring: string;
  /** EN state of the step for assistive technologies ("Pending"), null when the chain is not recorded. */
  state: string | null;
}

const RING = 'inset 0 0 0 1px var(--color-neutral-700)';

export function chainDots(chain: ChainStepLike[]): ChainDot[] {
  return CR_STEPS.map((step) => {
    const d = chain.find((c) => c.step === step)?.decision ?? null;
    const dot = d === 'ok' ? 'var(--color-accent)' : d === 'rejected' ? 'var(--color-neutral-100)' : d === 'pending' ? 'var(--color-neutral-700)' : 'transparent';
    return { step, label: CR_STEP_LABEL[step].split(' ')[0], dot, ring: d === 'pending' || d === 'ok' || d === 'rejected' ? 'none' : RING, state: stepState(d)?.label ?? null };
  });
}

// ── Status ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Effective status (allCRs 4593, without the stuck override — 07 OQ1): a draft stays a draft; once submitted,
 * any rejected required step → rejected; every required (non-n/a) step ok → approved; else in review. A request
 * without a recorded chain keeps its stored status.
 */
export function deriveCrStatus(status: ChangeStatus, chain: ChainStepLike[]): ChangeStatus {
  if (status === 'draft') return 'draft';
  const need = chain.map((c) => c.decision).filter((d): d is StepDecision => d != null && d !== 'na');
  if (!need.length) return status;
  if (need.includes('rejected')) return 'rejected';
  if (need.every((d) => d === 'ok')) return 'approved';
  return 'in_review';
}

/** Requests with their effective status. */
export const withDerivedStatus = <C extends ChangeRequestLike>(crs: C[]): C[] => crs.map((c) => ({ ...c, status: deriveCrStatus(c.status, c.chain) }));

// ── Who decides (crRoleKey 4596) ────────────────────────────────────────────────────────────────────

/**
 * Persona that records each step. pm / director / client as in the prototype; the change control board has no
 * persona (07 OQ2, 00 §7.16), so its decision is recorded by the portfolio director after the board meeting.
 */
export const STEP_DECIDER: Record<ChangeStep, RoleKey> = { pm: 'pm', director: 'director', client: 'client', ccb: 'director' };

/** Steps a role may decide. */
export const stepsOfRole = (role: RoleKey): ChangeStep[] => CR_STEPS.filter((s) => STEP_DECIDER[s] === role);

// ── Sequential chain (delivery 8, R-069 — P-6b, P-6c) ──────────────────────────────────────────────────

/**
 * Default change control board threshold, k€ (P-6c "au-delà d'un seuil réglable"): the prototype highlights a budget impact
 * `amt > 50`. A value Keystone chose until management sets it in Settings (app_settings "change.ccbThreshold").
 */
export const DEFAULT_CCB_THRESHOLD_KEUR = 50;
/** Largest board threshold accepted, k€ (a typo guard, like the cost category budgets). */
export const MAX_CCB_THRESHOLD_KEUR = 1_000_000;
/** A usable board threshold: a number of k€ in [0, MAX]. */
export const isCcbThreshold = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_CCB_THRESHOLD_KEUR;

/**
 * Steps a new request needs, fixed when it is submitted (P-6b, P-6c): the project manager and the portfolio director always;
 * the client unless the contractual impact is 'none' (an internal change; a request without a recorded impact keeps the client
 * step); the change control board only when |amount| is strictly greater than the threshold in force ("au-delà").
 */
export function requiredSteps(input: { contractImpact: ContractImpact | null | undefined; amountKeur: number; ccbThresholdKeur: number }): Record<ChangeStep, 'pending' | 'na'> {
  const threshold = Number.isFinite(input.ccbThresholdKeur) && input.ccbThresholdKeur >= 0 ? input.ccbThresholdKeur : DEFAULT_CCB_THRESHOLD_KEUR;
  return {
    pm: 'pending',
    director: 'pending',
    client: input.contractImpact === 'none' ? 'na' : 'pending',
    ccb: Math.abs(input.amountKeur || 0) > threshold ? 'pending' : 'na',
  };
}

/**
 * The step the request waits for (P-6b: PM → director → client → change control board): the first pending step whose
 * earlier steps are all approved or not required. Null when a step is rejected or unrecorded before it, or nothing is pending.
 */
export function currentStep(chain: readonly Pick<ChainStepLike, 'step' | 'decision'>[]): ChangeStep | null {
  for (const step of CR_STEPS) {
    const d = chain.find((c) => c.step === step)?.decision ?? null;
    if (d === 'ok' || d === 'na') continue;
    return d === 'pending' ? step : null;
  }
  return null;
}

/**
 * Contractual impact of a request raised before it was asked (seed and existing-database backfill, R-069): a client step not
 * required → 'none' (internal); else from the figures — amount and days → 'price_dates', amount → 'price', days → 'dates';
 * neither → null (not recorded: the client step it holds stays as stored).
 */
export function inferredContractImpact(cr: { clientStep: StepDecision | null; amountKeur: number; scheduleDays: number }): ContractImpact | null {
  if (cr.clientStep === 'na') return 'none';
  if (cr.amountKeur && cr.scheduleDays) return 'price_dates';
  if (cr.amountKeur) return 'price';
  if (cr.scheduleDays) return 'dates';
  return null;
}

/** A request as the step rules read it: its (stored or derived) status and its chain — Change control's rows and the inbox's. */
export interface ChainCarrier {
  status: string;
  chain: readonly ChainStepLike[];
}

/** The request is in review and `step` is the one it waits for (pending, every earlier step approved or not required). */
export const isStepOpen = (cr: ChainCarrier, step: ChangeStep) => cr.status === 'in_review' && currentStep(cr.chain) === step;

/** A pending step of a request in review that waits for an earlier step (R-069: answered "Not yours to decide yet"). */
export const stepWaitsForEarlier = (cr: ChainCarrier, step: ChangeStep) =>
  cr.status === 'in_review' && cr.chain.find((c) => c.step === step)?.decision === 'pending' && currentStep(cr.chain) !== step;

/** Refusal of a step that waits for an earlier one (Change control, client portal, My approvals — R-069). */
export const NOT_YOURS_YET = 'Not yours to decide yet';

/**
 * Who records a step. `role` alone (Change control, client portal): the role owning the step (STEP_DECIDER). With `name`
 * (My approvals routes by person): the step's named approver for pm / director / client, the CCB recorder's role for ccb
 * (no named approver, 07 OQ2).
 */
export interface StepDecider {
  role: RoleKey;
  name?: string;
}

/**
 * The one rule deciding whether a step may be recorded now (`canAct` 4609, unified in delivery 8 — R-069, R-171): the request
 * is in review, the step is the current one (sequential chain, P-6b — the prototype's steps were not sequential, 07 OQ3), and
 * the decider holds it. Change control, the client portal and My approvals all call it; the PM-step routing (PM of record by
 * name in My approvals, the project's PMs and deputies on Change control) is unchanged.
 */
export function canDecideStep(cr: ChainCarrier, step: ChangeStep, who: StepDecider): boolean {
  return isStepOpen(cr, step) && holdsStep(cr, step, who);
}

/** The decider holds `step` (whether or not it is open): its role, or — routed by person — its named approver. */
export function holdsStep(cr: Pick<ChainCarrier, 'chain'>, step: ChangeStep, who: StepDecider): boolean {
  if (step === 'ccb' || who.name === undefined) return STEP_DECIDER[step] === who.role;
  const approver = cr.chain.find((c) => c.step === step)?.approver;
  return !!approver && approver === who.name;
}

// ── Notifications (delivery 8, R-015 part — X-6a) ───────────────────────────────────────────────────────

/** People the chain notifies (person ids): the PM of record, the portfolio directors, the project's client contacts, the requester. */
export interface ChainPeople {
  pm: string | null;
  directors: readonly string[];
  clientContacts: readonly string[];
  requester: string | null;
}

/**
 * The bell notice of a request after it is submitted or a step is decided (X-6a: to the approver, not a whole role): in review →
 * the approvers of its current step (PM: the PM of record — routing unchanged, notes-rights Q4; director and change control board:
 * the portfolio directors, P-6a; client: the client contacts of the project's organisation); approved or rejected → the
 * requester. Never the actor. Fixed English title (translated by the bell), the typed title goes in the sub-line. Null when
 * nobody is to be told.
 */
export function crNoticeOf(
  cr: Pick<ChangeRequestLike, 'id' | 'status' | 'chain'>, people: ChainPeople, actorPersonId: string | null,
): { title: string; toPersonIds: string[] } | null {
  let title: string;
  let to: (string | null)[];
  if (cr.status === 'approved' || cr.status === 'rejected') {
    title = `Change request ${cr.status === 'approved' ? 'approved' : 'rejected'} · ${cr.id}`;
    to = [people.requester];
  } else if (cr.status === 'in_review') {
    const step = currentStep(cr.chain);
    if (!step) return null;
    title = `Change request awaiting your decision · ${cr.id}`;
    to = step === 'pm' ? [people.pm] : step === 'client' ? [...people.clientContacts] : [...people.directors];
  } else return null;
  const toPersonIds = [...new Set(to.filter((p): p is string => !!p && p !== actorPersonId))];
  return toPersonIds.length ? { title, toPersonIds } : null;
}

/** Short names of the steps in the "Pending value" KPI sub-line ("Awaiting director · client"). */
const STEP_SHORT: Record<ChangeStep, string> = { pm: 'PM', director: 'director', client: 'client', ccb: 'CCB' };

/** "Awaiting director · client": the current steps of the requests in review, chain order; null when none is in review. */
export function awaitingStepsText(crs: readonly Pick<ChangeRequestLike, 'status' | 'chain'>[]): string | null {
  const steps = new Set(crs.filter((c) => c.status === 'in_review').map((c) => currentStep(c.chain)).filter((s): s is ChangeStep => !!s));
  const names = CR_STEPS.filter((s) => steps.has(s)).map((s) => STEP_SHORT[s]);
  return names.length ? `Awaiting ${names.join(' · ')}` : null;
}

/**
 * Drawer hint (crVals.hint 4610): a draft asks to be submitted; a viewer who holds a later step of a request in review reads
 * which step it waits for ("Waiting for Portfolio director", P-6b); a viewer holding no step is told who decides.
 */
export function crHint(cr: Pick<ChangeRequestLike, 'status'> & Partial<Pick<ChangeRequestLike, 'chain'>>, role: RoleKey): string {
  if (cr.status === 'draft') return 'Submit the request to start the approval chain.';
  if (cr.status !== 'in_review') return '';
  const mine = stepsOfRole(role);
  if (!mine.length) return 'Switch to Project manager, Portfolio director or Client (bottom-left) to decide.';
  const chain = cr.chain ?? [];
  const current = currentStep(chain);
  const waiting = mine.some((s) => s !== current && chain.find((c) => c.step === s)?.decision === 'pending');
  return current && waiting && !mine.includes(current) ? `Waiting for ${CR_STEP_LABEL[current]}` : '';
}

// ── Filter chips (crChips 4602) ─────────────────────────────────────────────────────────────────────

export type CrFilter = ChangeType | 'all';

/** `?filter=` value → chip (unknown → All). */
export const parseCrFilter = (v: unknown): CrFilter => (typeof v === 'string' && (CR_TYPES as string[]).includes(v) ? (v as ChangeType) : 'all');

export const filterCrs = <C extends Pick<ChangeRequestLike, 'types'>>(crs: C[], f: CrFilter): C[] => (f === 'all' ? crs : crs.filter((c) => c.types.includes(f)));

/** All + one chip per type; a request with several types counts in each. */
export function crChips(crs: Pick<ChangeRequestLike, 'types'>[]): { value: CrFilter; label: string; count: number }[] {
  return [{ value: 'all' as CrFilter, label: 'All', count: crs.length }, ...CR_TYPES.map((t) => ({ value: t as CrFilter, label: CR_TYPE_LABEL[t], count: crs.filter((c) => c.types.includes(t)).length }))];
}

// ── Register cells (crRows 4599) ────────────────────────────────────────────────────────────────────

/** "Scope · Budget". */
export const typesText = (types: ChangeType[]) => types.map((t) => CR_TYPE_LABEL[t]).join(' · ');

/** Budget cell: "+€85k" / "—"; `lo` when the change adds cost. */
export const amountCell = (amount: number, lang: Lang) => ({ text: amount ? money(amount, lang, { signed: true }) : '—', lo: amount > 0 });

/**
 * Schedule cell: "+12 d" / "-12 d" (prototype hyphen) / "—". Tone: delay → LO, gain → accent-300, none → neutral-400.
 */
export function daysCell(days: number): { text: string; tone: 'delay' | 'gain' | 'none' } {
  return { text: days ? (days > 0 ? '+' : '') + days + ' d' : '—', tone: days > 0 ? 'delay' : days < 0 ? 'gain' : 'none' };
}

// ── KPI tiles (crKpis 4604) ─────────────────────────────────────────────────────────────────────────

export interface CrKpi {
  label: string;
  value: string;
  sub: string;
  /** Value in the attention colour (LO). */
  alert: boolean;
}

export interface CrKpiContext {
  /** BL1 original budget (recon.orig), null for projects without cost controls. */
  originalBudget: number | null;
  /** Current BAC. */
  bac: number;
  baselines: BaselineLike[];
}

/** Baseline tile: current baseline; sub = the proposed one and its request ("BL2 proposed · CR-009 draft"). */
export function baselineKpi(baselines: BaselineLike[], crs: Pick<ChangeRequestLike, 'id' | 'status'>[]): Pick<CrKpi, 'value' | 'sub'> {
  const current = baselines.find((b) => b.state === 'current');
  const proposed = baselines.find((b) => b.state === 'proposed');
  let sub: string;
  if (proposed) {
    const cr = proposed.changeRequest ? crs.find((c) => c.id === proposed.changeRequest) : undefined;
    sub = `${proposed.code} proposed` + (cr ? ` · ${cr.id} ${CR_STATUS_LABEL[cr.status].toLowerCase()}` : '');
  } else if (current) sub = `${current.name} · ${current.setOn}`;
  else sub = 'No baseline yet';
  return { value: current?.code ?? '—', sub };
}

export function crKpis(crs: ChangeRequestLike[], ctx: CrKpiContext, lang: Lang): CrKpi[] {
  const f = (k: number, signed = false) => money(k, lang, { signed });
  const count = (s: ChangeStatus) => crs.filter((c) => c.status === s).length;
  const sum = (s: ChangeStatus) => crs.filter((c) => c.status === s).reduce((a, c) => a + c.amount, 0);
  const approvedAmt = sum('approved');
  const pendingAmt = sum('in_review');
  const net = crs.filter((c) => c.status !== 'rejected').reduce((a, c) => a + c.days, 0);
  const bl = baselineKpi(ctx.baselines, crs);
  return [
    { label: 'Change requests', value: String(crs.length), sub: `${count('in_review')} in review · ${count('draft')} draft`, alert: false },
    {
      label: 'Approved budget changes',
      value: approvedAmt ? f(approvedAmt, true) : '—',
      sub: ctx.originalBudget != null ? `BL1 ${f(ctx.originalBudget)} → BAC ${f(ctx.bac)}` : `BAC ${f(ctx.bac)}`,
      alert: false,
    },
    // R-069 (P-6b): the sub-line names the steps the requests in review wait for ("Awaiting director · client").
    { label: 'Pending value', value: pendingAmt ? f(pendingAmt, true) : '—', sub: awaitingStepsText(crs) ?? 'No change request in review', alert: !!pendingAmt },
    { label: 'Schedule changes', value: String(crs.filter((c) => c.types.includes('schedule')).length), sub: `Net ${net} d on handover`, alert: false },
    { label: 'Baseline', value: bl.value, sub: bl.sub, alert: false },
  ];
}

// ── Drawer impact (crVals.impact 4608) ──────────────────────────────────────────────────────────────

export interface ImpactRow {
  k: string;
  v: string;
  /** Value in LO (budget impact over the change control board threshold: |amount| > threshold, as `requiredSteps`). */
  lo: boolean;
}

/**
 * `ctx.proposedBaseline`: the baseline this request proposes (Baselines register, linked to the request — BL2 for the seeded
 * CR-009, BL3… for a request raised from the Plan, S-3); without it the prototype's rule applies (baseline column BL2).
 * `ctx.ccbThresholdKeur`: the board threshold in force (Settings, R-069 / P-6c; DEFAULT_CCB_THRESHOLD_KEUR without it). The
 * Budget row is highlighted when |amount| is over it — the prototype's `amt > 50`, made the adjustable threshold of the board
 * step, so a −120 k€ request is highlighted and, with 100 k€, a +60 k€ one is not.
 */
export function crImpact(
  cr: ChangeRequestLike, ctx: { bac: number; contingency: number | null; proposedBaseline?: string | null; ccbThresholdKeur?: number }, lang: Lang,
): ImpactRow[] {
  const f = (k: number, signed = false) => money(k, lang, { signed });
  const amt = cr.amount;
  const budget = amt ? `${f(amt, true)} → BAC ${f(ctx.bac + (cr.status === 'approved' ? 0 : amt))}` : 'None';
  const schedule = cr.days ? `${cr.days > 0 ? '+' : ''}${cr.days} days on handover` : 'None';
  const wbs = cr.wbs.map((w) => w.code + (w.name ? ' · ' + w.name : '')).join(' · ');
  const proposed = ctx.proposedBaseline !== undefined ? ctx.proposedBaseline : cr.baseline === 'BL2' ? 'BL2' : null;
  const contingency = amt > 0 && ctx.contingency ? `Funded from contingency · ${Math.round((amt / ctx.contingency) * 100)}% of reserve` : '—';
  const threshold = isCcbThreshold(ctx.ccbThresholdKeur) ? ctx.ccbThresholdKeur : DEFAULT_CCB_THRESHOLD_KEUR;
  return [
    { k: 'Budget', v: budget, lo: Math.abs(amt) > threshold },
    { k: 'Schedule', v: schedule, lo: false },
    { k: 'WBS impacted', v: wbs || '—', lo: false },
    { k: 'Baseline', v: proposed ? `Requires re-baseline → ${proposed}` : 'Within BL1', lo: false },
    { k: 'Contingency', v: contingency, lo: false },
  ];
}
