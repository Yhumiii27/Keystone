// Change control & baselines logic (docs/spec/07 §2.2; prototype logic 4591–4610): derived CR status, type
// filter chips, KPI tiles, register cells, approval-chain indicators, the drawer's impact list, who decides which
// step, and the baseline register. Pure functions over plain data; strings are the prototype's English source
// (render through t()), amounts are formatted with lib/format money(). Golden values: change-control.test.ts.
//
// Deliberate fixes of prototype defects (docs/spec/00 §7.16, 07 OQ1–2, OQ18):
// - the status is always derived from the chain once submitted (the prototype's "In review" override stuck);
// - the change control board step is recorded by the portfolio director (no persona maps to `ccb`);
// - the Baseline KPI follows the baseline register instead of the static "BL1 / BL2 proposed · CR-009 draft".
import type { RoleKey } from '@/config/screens';
import type { Lang } from '@/i18n/translate';
import { money } from '@/lib/format';
import type { BaselineState, ChangeStatus, ChangeStep, ChangeType, StepDecision } from '@/server/db/codes';

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

/** `canAct` (4609): request in review, step pending and owned by the viewer's role (steps are not sequential, 07 OQ3). */
export function canDecideStep(role: RoleKey, cr: Pick<ChangeRequestLike, 'status' | 'chain'>, step: ChangeStep): boolean {
  if (cr.status !== 'in_review' || STEP_DECIDER[step] !== role) return false;
  return cr.chain.find((c) => c.step === step)?.decision === 'pending';
}

/** Drawer hint (crVals.hint 4610). */
export function crHint(cr: Pick<ChangeRequestLike, 'status'>, role: RoleKey): string {
  if (cr.status === 'draft') return 'Submit the request to start the approval chain.';
  if (cr.status === 'in_review' && !stepsOfRole(role).length) return 'Switch to Project manager, Portfolio director or Client (bottom-left) to decide.';
  return '';
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
    { label: 'Pending value', value: pendingAmt ? f(pendingAmt, true) : '—', sub: 'Awaiting director · client · CCB', alert: !!pendingAmt },
    { label: 'Schedule changes', value: String(crs.filter((c) => c.types.includes('schedule')).length), sub: `Net ${net} d on handover`, alert: false },
    { label: 'Baseline', value: bl.value, sub: bl.sub, alert: false },
  ];
}

// ── Drawer impact (crVals.impact 4608) ──────────────────────────────────────────────────────────────

export interface ImpactRow {
  k: string;
  v: string;
  /** Value in LO (budget impact over 50 k€). */
  lo: boolean;
}

/**
 * `ctx.proposedBaseline`: the baseline this request proposes (Baselines register, linked to the request — BL2 for the seeded
 * CR-009, BL3… for a request raised from the Plan, S-3); without it the prototype's rule applies (baseline column BL2).
 */
export function crImpact(cr: ChangeRequestLike, ctx: { bac: number; contingency: number | null; proposedBaseline?: string | null }, lang: Lang): ImpactRow[] {
  const f = (k: number, signed = false) => money(k, lang, { signed });
  const amt = cr.amount;
  const budget = amt ? `${f(amt, true)} → BAC ${f(ctx.bac + (cr.status === 'approved' ? 0 : amt))}` : 'None';
  const schedule = cr.days ? `${cr.days > 0 ? '+' : ''}${cr.days} days on handover` : 'None';
  const wbs = cr.wbs.map((w) => w.code + (w.name ? ' · ' + w.name : '')).join(' · ');
  const proposed = ctx.proposedBaseline !== undefined ? ctx.proposedBaseline : cr.baseline === 'BL2' ? 'BL2' : null;
  const contingency = amt > 0 && ctx.contingency ? `Funded from contingency · ${Math.round((amt / ctx.contingency) * 100)}% of reserve` : '—';
  return [
    { k: 'Budget', v: budget, lo: amt > 50 },
    { k: 'Schedule', v: schedule, lo: false },
    { k: 'WBS impacted', v: wbs || '—', lo: false },
    { k: 'Baseline', v: proposed ? `Requires re-baseline → ${proposed}` : 'Within BL1', lo: false },
    { k: 'Contingency', v: contingency, lo: false },
  ];
}
