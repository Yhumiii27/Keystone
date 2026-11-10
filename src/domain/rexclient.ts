// Lessons learned & project closure (docs/spec/07 §2.7, logic 4997–5006) and what the client status report keeps of the
// former client portal (docs/spec/03 §8, logic 4679–4690, 5061; the portal itself was removed, D9-06 / D9-22): KPI tiles,
// register rows, closure checklist, satisfaction survey, decisions waiting / decided, invoices, contract summary and the
// action form AF `rex`. Pure functions over plain data shaped like the DAL rows; every string is
// the prototype's English source (render through t()), amounts go through lib/format money(). Golden values:
// rexclient.test.ts against rexclient.golden.json (scripts/proto-golden-rexclient.ts, the prototype run in node:vm).
//
// Deliberate fixes of prototype defects / gaps (docs/spec/00 §7.16, 03 OQ2, OQ6, OQ16, 07 OQ24):
// - invoices follow the contract billing plan (real invoice numbers, real due dates: "Due 10 Nov"), not the static
//   BILLING rows ("F-2026-103", "Due 15 Oct") — the Delivery 3 billing source of truth (A-5);
// - decimals of the satisfaction survey follow the language ("4,5" in French).
import { CR_TYPE_LABEL, currentStep } from '@/domain/change-control';
import type { Lang } from '@/i18n/translate';
import { money } from '@/lib/format';
import { BASE_CURRENCY, moneyIn, type CurrencyCode } from './currency';
import {
  CLOSURE_NEXT, LESSON_APPLIES_TO, closureItemStatus, fmtDOfIso, lessonStatus, lessonTheme,
  type ChangeStatus, type ChangeStep, type ChangeType, type ClosureItemStatus, type DeliverableStatus,
  type LessonStatus, type LessonTheme, type PaymentMilestoneStatus, type StepDecision,
} from '@/server/db/codes';

export type Tone = 'accent' | 'outline' | 'neutral';

/** KPI tile: EN label / value / sub; `alert` = value in the attention colour (LO). */
export interface Kpi {
  label: string;
  value: string;
  sub: string;
  alert: boolean;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const record = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
/** One decimal, in the reader's language ("4.5" / "4,5"). */
export const oneDecimal = (v: number, lang: Lang) => (lang === 'fr' ? v.toFixed(1).replace('.', ',') : v.toFixed(1));

// ── Lessons learned & closure ──────────────────────────────────────────────────────────────────────────

export interface LessonLike {
  number: string;
  theme: LessonTheme;
  whatHappened: string;
  impact: string;
  recommendation: string;
  appliesTo: string;
  status: LessonStatus;
}

export interface ClosureLike {
  position: number;
  item: string;
  owner: string;
  status: ClosureItemStatus;
}

export interface SatisfactionLike {
  criterion: string;
  /** 0–5 by 0.5. */
  score: number;
}

/** "Validate" (Proposed → Validated), "Mark applied" (Validated → Applied); nothing once applied. */
export const LESSON_NEXT: Record<LessonStatus, { to: LessonStatus; label: 'Validate' | 'Mark applied' } | null> = {
  proposed: { to: 'validated', label: 'Validate' },
  validated: { to: 'applied', label: 'Mark applied' },
  applied: null,
};

/** Status tag of a lesson: Applied neutral, Validated outline, Proposed accent (`stClass`). */
export const LESSON_TONE: Record<LessonStatus, Tone> = { applied: 'neutral', validated: 'outline', proposed: 'accent' };

/** KPI 2 hint ("REX workshop · engineering lead + quality"). */
export const REX_WORKSHOP = 'REX workshop · engineering lead + quality';

/** Customer satisfaction below this average is shown in the attention colour. */
export const SATISFACTION_ALERT = 3.5;

/** Average of the survey (0 when none). */
export const satisfactionAverage = (s: readonly SatisfactionLike[]) => (s.length ? s.reduce((a, x) => a + x.score, 0) / s.length : 0);

/** Lowest criterion (first one on a tie, the prototype's stable sort). */
export const lowestCriterion = (s: readonly SatisfactionLike[]) => (s.length ? [...s].sort((a, b) => a.score - b.score)[0] : null);

/** Closure progress: round((done + ½ in progress) / n × 100) — null without a checklist. */
export function closureProgress(c: readonly Pick<ClosureLike, 'status'>[]): { pct: number | null; done: number; inProgress: number; notStarted: number } {
  const done = c.filter((x) => x.status === 'done').length;
  const inProgress = c.filter((x) => x.status === 'in_progress').length;
  return { pct: c.length ? Math.round(((done + inProgress * 0.5) / c.length) * 100) : null, done, inProgress, notStarted: c.length - done - inProgress };
}

/** The four tiles (`rexKpis` 5006). Projects without REX data get "—" and "survey not received". */
export function rexKpis(lessons: readonly Pick<LessonLike, 'status'>[], closure: readonly Pick<ClosureLike, 'status'>[], survey: readonly SatisfactionLike[], lang: Lang): Kpi[] {
  const applied = lessons.filter((l) => l.status === 'applied').length;
  const proposed = lessons.filter((l) => l.status === 'proposed').length;
  const cl = closureProgress(closure);
  const avg = satisfactionAverage(survey);
  const low = lowestCriterion(survey);
  return [
    { label: 'Lessons recorded', value: String(lessons.length), sub: `${applied} applied to templates & procedures`, alert: false },
    { label: 'To validate', value: String(proposed), sub: REX_WORKSHOP, alert: proposed > 0 },
    { label: 'Closure checklist', value: cl.pct == null ? '—' : `${cl.pct} %`, sub: `${cl.done} done · ${cl.inProgress} in progress · ${cl.notStarted} not started`, alert: false },
    {
      label: 'Customer satisfaction',
      value: survey.length ? `${oneDecimal(avg, lang)} / 5` : '—',
      sub: low ? `lowest · ${low.criterion}` : 'survey not received',
      alert: !!avg && avg < SATISFACTION_ALERT,
    },
  ];
}

export interface LessonRow {
  id: string;
  /** EN labels (render through t()). */
  theme: string;
  what: string;
  impact: string;
  reco: string;
  apply: string;
  status: string;
  tone: Tone;
  /** Row action, null once applied. */
  next: { to: LessonStatus; label: string } | null;
}

export function lessonRow(l: LessonLike): LessonRow {
  return {
    id: l.number, theme: lessonTheme.label(l.theme), what: l.whatHappened, impact: l.impact, reco: l.recommendation, apply: l.appliesTo,
    status: lessonStatus.label(l.status), tone: LESSON_TONE[l.status], next: LESSON_NEXT[l.status],
  };
}

export type ClosureMark = 'done' | 'progress' | 'idle';

export interface ClosureRow {
  position: number;
  item: string;
  owner: string;
  status: string;
  /** Icon: check-square (done), minus-square (in progress), square (not started). */
  mark: ClosureMark;
  /** Icon and status colour: accent-300 / accent / neutral-500. */
  color: string;
  /** Item text: neutral-500 once done. */
  textColor: string;
  next: ClosureItemStatus;
}

const CLOSURE_LOOK: Record<ClosureItemStatus, { mark: ClosureMark; color: string; textColor: string }> = {
  done: { mark: 'done', color: 'var(--color-accent-300)', textColor: 'var(--color-neutral-500)' },
  in_progress: { mark: 'progress', color: 'var(--color-accent)', textColor: 'var(--color-text)' },
  not_started: { mark: 'idle', color: 'var(--color-neutral-500)', textColor: 'var(--color-text)' },
};

export function closureRow(c: ClosureLike): ClosureRow {
  return { position: c.position, item: c.item, owner: c.owner, status: closureItemStatus.label(c.status), ...CLOSURE_LOOK[c.status], next: CLOSURE_NEXT[c.status] };
}

export interface SatisfactionRow {
  criterion: string;
  /** "4.5" / "4,5". */
  score: string;
  /** Bar width "90%". */
  width: string;
}

export const satisfactionRow = (s: SatisfactionLike, lang: Lang): SatisfactionRow => ({
  criterion: s.criterion, score: oneDecimal(s.score, lang), width: Math.round((s.score / 5) * 100) + '%',
});

/** Header average ("4.0"), "—" without a survey. */
export const satisfactionAverageText = (s: readonly SatisfactionLike[], lang: Lang) => (s.length ? oneDecimal(satisfactionAverage(s), lang) : '—');

export interface RexView {
  kpis: Kpi[];
  lessons: LessonRow[];
  closure: ClosureRow[];
  satisfaction: SatisfactionRow[];
  satAvg: string;
}

export function rexView(d: { lessons: readonly LessonLike[]; closure: readonly ClosureLike[]; satisfaction: readonly SatisfactionLike[] }, lang: Lang): RexView {
  return {
    kpis: rexKpis(d.lessons, d.closure, d.satisfaction, lang),
    lessons: d.lessons.map(lessonRow),
    closure: d.closure.map(closureRow),
    satisfaction: d.satisfaction.map((s) => satisfactionRow(s, lang)),
    satAvg: satisfactionAverageText(d.satisfaction, lang),
  };
}

// ── Add lesson learned (AF.rex) ────────────────────────────────────────────────────────────────────────

export const LESSON_THEMES: { value: LessonTheme; label: string }[] = lessonTheme.codes.map((c) => ({ value: c, label: lessonTheme.label(c) }));
export const LESSON_TARGETS: readonly string[] = LESSON_APPLIES_TO;
export const LESSON_TEXT_MAX = 1000;
export const LESSON_IMPACT_MAX = 500;
/** AF_RESULT.rex toast. */
export const LESSON_RESULT = 'Lesson recorded · to be validated';

export interface NewLesson {
  theme: LessonTheme;
  whatHappened: string;
  impact: string | null;
  recommendation: string;
  appliesTo: string;
}

/** Validates the AF.rex values (blank selects → first option, as afOpen). Errors are EN source strings. */
export function parseNewLesson(values: unknown): Parsed<NewLesson> {
  const v = record(values);
  const theme = str(v.theme) || LESSON_THEMES[0].value;
  const apply = str(v.apply) || LESSON_TARGETS[0];
  const what = str(v.what);
  const impact = str(v.impact);
  const reco = str(v.reco);
  if (!lessonTheme.isCode(theme)) return { ok: false, error: 'Unknown theme' };
  if (!what) return { ok: false, error: 'What happened is required' };
  if (what.length > LESSON_TEXT_MAX) return { ok: false, error: 'What happened is too long' };
  if (impact.length > LESSON_IMPACT_MAX) return { ok: false, error: 'Impact is too long' };
  if (!reco) return { ok: false, error: 'Recommendation is required' };
  if (reco.length > LESSON_TEXT_MAX) return { ok: false, error: 'Recommendation is too long' };
  if (!LESSON_TARGETS.includes(apply)) return { ok: false, error: 'Unknown template or procedure' };
  return { ok: true, value: { theme, whatHappened: what, impact: impact || null, recommendation: reco, appliesTo: apply } };
}

// ── Client status report (the client portal's model, kept for the report the project team sends — D9-06) ──────────────────────────────────────────────────────────────────────────────────────

export interface EvmLike {
  pv: readonly number[];
  /** Earned value up to the data date (its length is the number of months reported). */
  ev: readonly number[];
  bac: number;
}

export interface ScheduleHeaderLike {
  floatDays: number;
  /** "14 Jan 2027". */
  finishText: string;
  baselineText: string;
  /** "2 of 6". */
  milesText: string;
}

/**
 * The tiles of the client status report (`cpKpis` 4681). Without schedule data the progress and dates read "—". D9-06: the
 * "Open issues" tile went with the client portal's issues (clients never see Keystone).
 */
export function clientKpis(i: { evm: EvmLike | null; schedule: ScheduleHeaderLike | null; awaiting: number }): Kpi[] {
  const n = i.evm?.ev.length ?? 0;
  const evm = i.evm && n && i.evm.bac > 0 ? i.evm : null;
  const s = i.schedule;
  return [
    evm
      ? { label: 'Progress', value: Math.round((evm.ev[n - 1] / evm.bac) * 100) + '%', sub: `Planned ${Math.round(((evm.pv[n - 1] ?? 0) / evm.bac) * 100)}% by today`, alert: false }
      : { label: 'Progress', value: '—', sub: '', alert: false },
    s
      ? { label: 'Forecast handover', value: s.finishText, sub: `Contract date ${s.baselineText}`, alert: s.floatDays < 0 }
      : { label: 'Forecast handover', value: '—', sub: '', alert: false },
    { label: 'Milestones', value: s ? s.milesText : '—', sub: s ? 'Reached' : '', alert: false },
    // The prototype paints this tile in the attention colour even at 0.
    { label: 'Awaiting your decision', value: String(i.awaiting), sub: 'Change requests and deliverables', alert: true },
  ];
}

export interface ChangeRequestLike {
  id: string;
  title: string;
  types: ChangeType[];
  /** Signed k€ on the contract. */
  amount: number;
  /** Signed days on handover. */
  days: number;
  status: ChangeStatus;
  /** "24 Sep". */
  date: string;
  chain: { step: ChangeStep; decision: StepDecision | null }[];
  /** Delivery 8 (R-140, X-11 shared): the justification as typed, shown to the client under a request waiting for them. */
  justification?: string | null;
}

export interface DeliverableLike {
  number: string;
  title: string;
  /** Settings label of the type ("Test & inspection reports"). */
  typeLabel: string;
  revision: string | null;
  status: DeliverableStatus;
  dueOn: string;
  /** "Accept by 2 Oct", "12 Mar · N. Bensaïd", "25 Sep · comments issued". */
  acceptanceText: string;
}

export const clientStepOf = (cr: Pick<ChangeRequestLike, 'chain'>) => cr.chain.find((s) => s.step === 'client')?.decision ?? null;
/**
 * A change request waits for the client: in review and its current step is the client's — delivery 8 (R-069, P-6b): the client
 * sees a request only after the project manager and the portfolio director approved it.
 */
export const crAwaitsClient = (cr: Pick<ChangeRequestLike, 'status' | 'chain'>) => cr.status === 'in_review' && currentStep(cr.chain) === 'client';

export interface DecisionRow {
  kind: 'change_request' | 'deliverable';
  /** "Change request" / "Deliverable". */
  kindLabel: string;
  id: string;
  /** CR: request date; deliverable: due date. */
  when: string;
  title: string;
  sub: string;
  approveLabel: 'Approve' | 'Accept (PV)';
  /** Delivery 8 (R-140, X-11): a change request's justification as typed (null when blank, and for deliverables). */
  justification: string | null;
}

/** "Budget · Schedule · +€85k on contract · -12 d on handover" (the prototype's hyphen for gains). */
export function crDecisionSub(cr: Pick<ChangeRequestLike, 'types' | 'amount' | 'days'>, lang: Lang): string {
  return (
    cr.types.map((t) => CR_TYPE_LABEL[t]).join(' · ') +
    (cr.amount ? ` · ${money(cr.amount, lang, { signed: true })} on contract` : '') +
    (cr.days ? ` · ${cr.days > 0 ? '+' : ''}${cr.days} d on handover` : '')
  );
}

export const crDecisionRow = (cr: ChangeRequestLike, lang: Lang): DecisionRow => ({
  kind: 'change_request', kindLabel: 'Change request', id: cr.id, when: cr.date, title: cr.title, sub: crDecisionSub(cr, lang), approveLabel: 'Approve',
  justification: cr.justification?.trim() ? cr.justification : null,
});

export const deliverableDecisionRow = (d: DeliverableLike, year: number): DecisionRow => ({
  kind: 'deliverable', kindLabel: 'Deliverable', id: d.number, when: fmtDOfIso(d.dueOn, year), title: d.title,
  sub: `${d.typeLabel} · rev ${d.revision ?? '—'} · ${d.acceptanceText}`, approveLabel: 'Accept (PV)', justification: null,
});

export interface DecidedRow {
  id: string;
  title: string;
  /** "Approved" / "Rejected" (CR client step), "Accepted" / "Rejected" (deliverable). */
  state: string;
  /** Approved / accepted neutral, rejected outline. */
  tone: Tone;
  when: string;
}

export function decidedCrRow(cr: ChangeRequestLike): DecidedRow {
  const ok = clientStepOf(cr) === 'ok';
  return { id: cr.id, title: cr.title, state: ok ? 'Approved' : 'Rejected', tone: ok ? 'neutral' : 'outline', when: cr.date };
}

export function decidedDeliverableRow(d: DeliverableLike): DecidedRow {
  const ok = d.status === 'accepted';
  return { id: d.number, title: d.title, state: ok ? 'Accepted' : 'Rejected', tone: ok ? 'neutral' : 'outline', when: d.acceptanceText };
}

/** Waiting (`cpDecisions`) and decided (`cpDecided`) lists: change requests first, then deliverables (dates against the business year `year`). */
export function clientDecisions(
  crs: readonly ChangeRequestLike[], dlv: readonly DeliverableLike[], lang: Lang, year: number,
): { waiting: DecisionRow[]; decided: DecidedRow[] } {
  return {
    waiting: [...crs.filter(crAwaitsClient).map((c) => crDecisionRow(c, lang)), ...dlv.filter((d) => d.status === 'submitted').map((d) => deliverableDecisionRow(d, year))],
    decided: [
      ...crs.filter((c) => clientStepOf(c) === 'ok' || clientStepOf(c) === 'rejected').map(decidedCrRow),
      ...dlv.filter((d) => d.status === 'accepted' || d.status === 'rejected').map(decidedDeliverableRow),
    ],
  };
}

export interface InvoiceLike {
  /** "M3 Structure topped out" (contract plan) / "Sep" (legacy plan). */
  milestone: string;
  amountKeur: number;
  status: PaymentMilestoneStatus;
  /** Customer invoice issued for the milestone ("INV-2026-003"), null before it is invoiced. */
  invoiceNumber: string | null;
  dueOn: string | null;
}

export type PaymentText = { kind: 'due'; date: string } | { kind: 'text'; text: 'Settled' | 'On milestone' | '—' };

export interface InvoiceRow {
  no: string;
  name: string;
  amount: string;
  status: string;
  /** Paid neutral, Invoiced accent, Planned outline. */
  tone: Tone;
  payment: PaymentText;
}

const INVOICE_LOOK: Record<PaymentMilestoneStatus, { label: string; tone: Tone }> = {
  paid: { label: 'Paid', tone: 'neutral' },
  invoiced: { label: 'Invoiced', tone: 'accent' },
  planned: { label: 'Planned', tone: 'outline' },
};

/** Payment column: "Due 10 Nov" (invoice due date, 30 days net; its year outside the business year `year`), "Settled", "On milestone". */
export function paymentOf(i: Pick<InvoiceLike, 'status' | 'dueOn'>, year: number): PaymentText {
  if (i.status === 'paid') return { kind: 'text', text: 'Settled' };
  if (i.status === 'planned') return { kind: 'text', text: 'On milestone' };
  return i.dueOn ? { kind: 'due', date: fmtDOfIso(i.dueOn, year) } : { kind: 'text', text: '—' };
}

/** An invoice row in the invoice's currency (C-9: the contract's; EUR by default). */
export const invoiceRow = (i: InvoiceLike, lang: Lang, year: number, currency: CurrencyCode = BASE_CURRENCY): InvoiceRow => ({
  no: i.invoiceNumber ?? '—', name: i.milestone, amount: moneyIn(i.amountKeur, currency, lang), status: INVOICE_LOOK[i.status].label, tone: INVOICE_LOOK[i.status].tone,
  payment: paymentOf(i, year),
});

/**
 * "Contract summary" rows (`cpInvKpis`): value, invoiced, paid — in the contract's currency (C-9) — and approved changes (k€,
 * signed, "—" when none).
 */
export function contractSummary(
  c: { valueKeur: number; invoicedKeur: number; paidKeur: number; approvedChangesKeur: number; currency?: CurrencyCode }, lang: Lang,
): { k: string; v: string }[] {
  const cur = c.currency ?? BASE_CURRENCY;
  return [
    { k: 'Contract value', v: moneyIn(c.valueKeur, cur, lang) },
    { k: 'Invoiced', v: moneyIn(c.invoicedKeur, cur, lang) },
    { k: 'Paid', v: moneyIn(c.paidKeur, cur, lang) },
    { k: 'Approved changes', v: c.approvedChangesKeur ? money(c.approvedChangesKeur, lang, { signed: true }) : '—' },
  ];
}
