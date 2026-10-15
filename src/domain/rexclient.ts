// Lessons learned & project closure (docs/spec/07 §2.7, logic 4997–5006) and the client portal "My project — client
// view" (docs/spec/03 §8, logic 4679–4690, 5061): KPI tiles, register rows, closure checklist, satisfaction survey,
// progress bars, milestones, decisions waiting / decided, invoices, contract summary, issues, shared documents and the
// two action forms (AF `rex`, AF `client`). Pure functions over plain data shaped like the DAL rows; every string is
// the prototype's English source (render through t()), amounts go through lib/format money(). Golden values:
// rexclient.test.ts against rexclient.golden.json (scripts/proto-golden-rexclient.ts, the prototype run in node:vm).
//
// Deliberate fixes of prototype defects / gaps (docs/spec/00 §7.16, 03 OQ2, OQ6, OQ16, 07 OQ24):
// - issue numbers are per project and zero-padded by the data layer (CI-08, CI-09, CI-10 — never "CI-010");
// - invoices follow the contract billing plan (real invoice numbers, real due dates: "Due 10 Nov"), not the static
//   BILLING rows ("F-2026-103", "Due 15 Oct") — the Delivery 3 billing source of truth (A-5);
// - the Documents tab's ID column is "Reference" (the prototype bound the wrong key "Column mapping"), its sub-title
//   and empty state talk to the client ("Released documents shared with you", "No document shared with you yet"),
//   not about the engineering register ("Deliverables", "Own documents · …");
// - decimals of the satisfaction survey follow the language ("4,5" in French).
import { CR_TYPE_LABEL } from '@/domain/change-control';
import { scheduleMilestone, scheduleProgression, type MilestoneInput } from '@/domain/schedule-gantt';
import type { Lang } from '@/i18n/translate';
import { money } from '@/lib/format';
import { BASE_CURRENCY, moneyIn, type CurrencyCode } from './currency';
import {
  CLOSURE_NEXT, DOCUMENT_STATUS_TAG, LESSON_APPLIES_TO, STATUS_ISO, closureItemStatus, clientIssueStatus, docFamily, fmtDOfIso, lessonStatus,
  lessonTheme, reportPeriod,
  type ChangeStatus, type ChangeStep, type ChangeType, type ClientIssueStatus, type ClosureItemStatus, type DeliverableStatus, type DocFamily, type DocumentStatus,
  type LessonStatus, type LessonTheme, type PaymentMilestoneStatus, type ReportPeriod, type StepDecision,
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

// ── Client portal ──────────────────────────────────────────────────────────────────────────────────────

export type ClientTab = 'progress' | 'planning' | 'decisions' | 'invoices' | 'issues' | 'docs';
/**
 * Display segments (`cpSeg`), default Progress & milestones. "Schedule" (`planning`, read-only summary Gantt and milestones
 * with its PDF) is not in the prototype: the owner's answer S-9a puts the plan in the client portal.
 */
export const CLIENT_TABS: { value: ClientTab; label: string }[] = [
  { value: 'progress', label: 'Progress & milestones' },
  { value: 'planning', label: 'Schedule' },
  { value: 'decisions', label: 'Decisions' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'issues', label: 'Issues' },
  { value: 'docs', label: 'Documents' },
];
export const parseClientTab = (v: unknown): ClientTab => CLIENT_TABS.find((o) => o.value === v)?.value ?? 'progress';

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

/** The five tiles (`cpKpis` 4681). Without schedule data the progress and dates read "—". */
export function clientKpis(i: { evm: EvmLike | null; schedule: ScheduleHeaderLike | null; awaiting: number; openIssues: number }): Kpi[] {
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
    { label: 'Open issues', value: String(i.openIssues), sub: 'Raised by you', alert: false },
  ];
}

export interface ProgressBar {
  label: string;
  /** Planned / actual heights in the 120px area ("71.3%"). */
  planH: string;
  actH: string;
}

/** Months up to the data date (`progression.slice(0, EVn)`): planned vs actual cumulative % of BAC. */
export function clientProgress(chartMonths: readonly string[], evm: EvmLike): ProgressBar[] {
  return scheduleProgression([...chartMonths], [...evm.pv], [...evm.ev], evm.bac)
    .slice(0, evm.ev.length)
    .map((p) => ({ label: p.label, planH: p.planH, actH: p.actH }));
}

export interface MilestoneRow {
  name: string;
  /** "15 Mar" / "13 Jan ’27". */
  baseDate: string;
  fcDate: string;
  status: string;
  /** Done neutral, Late accent, else outline. */
  tone: Tone;
}

export function clientMilestones(ms: readonly MilestoneInput[], start: number): MilestoneRow[] {
  return ms.map((m) => {
    const v = scheduleMilestone(m, start);
    return { name: v.name, baseDate: v.baseDate, fcDate: v.fcDate, status: v.statusLabel, tone: m.status === 'done' ? 'neutral' : m.status === 'late' ? 'accent' : 'outline' };
  });
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
/** A change request waits for the client: in review, client step pending. */
export const crAwaitsClient = (cr: Pick<ChangeRequestLike, 'status' | 'chain'>) => cr.status === 'in_review' && clientStepOf(cr) === 'pending';

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
});

export const deliverableDecisionRow = (d: DeliverableLike): DecisionRow => ({
  kind: 'deliverable', kindLabel: 'Deliverable', id: d.number, when: fmtDOfIso(d.dueOn), title: d.title,
  sub: `${d.typeLabel} · rev ${d.revision ?? '—'} · ${d.acceptanceText}`, approveLabel: 'Accept (PV)',
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

/** Waiting (`cpDecisions`) and decided (`cpDecided`) lists: change requests first, then deliverables. */
export function clientDecisions(crs: readonly ChangeRequestLike[], dlv: readonly DeliverableLike[], lang: Lang): { waiting: DecisionRow[]; decided: DecidedRow[] } {
  return {
    waiting: [...crs.filter(crAwaitsClient).map((c) => crDecisionRow(c, lang)), ...dlv.filter((d) => d.status === 'submitted').map(deliverableDecisionRow)],
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

/** Payment column: "Due 10 Nov" (invoice due date, 30 days net), "Settled", "On milestone". */
export function paymentOf(i: Pick<InvoiceLike, 'status' | 'dueOn'>): PaymentText {
  if (i.status === 'paid') return { kind: 'text', text: 'Settled' };
  if (i.status === 'planned') return { kind: 'text', text: 'On milestone' };
  return i.dueOn ? { kind: 'due', date: fmtDOfIso(i.dueOn) } : { kind: 'text', text: '—' };
}

/** An invoice row in the invoice's currency (C-9: the contract's; EUR by default). */
export const invoiceRow = (i: InvoiceLike, lang: Lang, currency: CurrencyCode = BASE_CURRENCY): InvoiceRow => ({
  no: i.invoiceNumber ?? '—', name: i.milestone, amount: moneyIn(i.amountKeur, currency, lang), status: INVOICE_LOOK[i.status].label, tone: INVOICE_LOOK[i.status].tone,
  payment: paymentOf(i),
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

export interface IssueLike {
  number: string;
  title: string;
  raisedOn: string;
  status: ClientIssueStatus;
  response: string;
}

export interface IssueRow {
  id: string;
  title: string;
  /** "Raised 12 Aug" / "Raised today" (the status date). */
  when: string;
  status: string;
  /** Closed neutral, Open accent, In progress outline. */
  tone: Tone;
  response: string;
}

export const ISSUE_TONE: Record<ClientIssueStatus, Tone> = { closed: 'neutral', open: 'accent', in_progress: 'outline' };

export const issueRow = (i: IssueLike, today: string = STATUS_ISO): IssueRow => ({
  id: i.number, title: i.title, when: i.raisedOn === today ? 'Raised today' : `Raised ${fmtDOfIso(i.raisedOn)}`, status: clientIssueStatus.label(i.status),
  tone: ISSUE_TONE[i.status], response: i.response,
});

/** Issues not closed ("Open issues · Raised by you"). */
export const openIssueCount = (issues: readonly Pick<IssueLike, 'status'>[]) => issues.filter((i) => i.status !== 'closed').length;

export const ISSUE_MAX = 500;

/** "Raise issue" text: trimmed, required, bounded. */
export function parseIssueText(v: unknown): Parsed<string> {
  const t = str(v);
  if (!t) return { ok: false, error: 'Describe the issue or request' };
  if (t.length > ISSUE_MAX) return { ok: false, error: 'The description is too long' };
  return { ok: true, value: t };
}

export interface SharedDocLike {
  number: string;
  title: string;
  typeLabel: string;
  /** "26 Sep". */
  dateText: string;
  revision: string;
  status: DocumentStatus;
  statusLabel: string;
  /** The client acknowledged the current revision. */
  acknowledged: boolean;
}

export interface SharedDocRow {
  id: string;
  title: string;
  typeLabel: string;
  date: string;
  rev: string;
  status: string;
  tone: Tone;
  acknowledged: boolean;
  /** "Acknowledged" tag or "Acknowledge receipt" button. */
  ackLabel: 'Acknowledged' | 'Acknowledge receipt';
}

export const sharedDocRow = (d: SharedDocLike): SharedDocRow => ({
  id: d.number, title: d.title, typeLabel: d.typeLabel, date: d.dateText, rev: d.revision, status: d.statusLabel, tone: DOCUMENT_STATUS_TAG[d.status].slice(4) as Tone,
  acknowledged: d.acknowledged, ackLabel: d.acknowledged ? 'Acknowledged' : 'Acknowledge receipt',
});

/**
 * Fixed labels of the Documents tab. 03 OQ2 / A.3: the prototype bound three keys of the engineering register —
 * "Column mapping" (ID header), "Deliverables" (sub-title of a list that also holds minutes, HSE plans and drawings)
 * and "Own documents · files stay in the business tool…" (empty state); the rebuild uses client-facing strings.
 */
export const DOCS_TAB = { idHeader: 'Reference', sub: 'Released documents shared with you', empty: 'No document shared with you yet' } as const;

/**
 * Client document categories (Delivery 8, L-9 = a, R-138): the prototype's typed CLIENT_DOCS rows (defined, never
 * rendered) give way to categories computed from the Codex index — the documents shared with the client. One constant
 * maps a Codex type to its category; any other type falls back to its Codex family. Keys are stable; the order is the
 * prototype's (contract, minutes, HSE, accepted deliverables), then the families in Codex order. The owner's own list
 * can replace this constant. "HSE documents", not "HSE reports": the Codex HSE type is a prevention plan, and the
 * monthly safety statistics and incident reports are Vigie site-HSE records, never in the Codex index. "Monthly progress
 * reports" has no Codex type (Keystone's status report is not a Codex record): it is left out until the owner decides.
 */
export const CLIENT_DOC_CATEGORY_OF_TYPE: Readonly<Record<string, { key: string; label: string }>> = {
  CTR: { key: 'contract', label: 'Contract & amendments' },
  MIN: { key: 'minutes', label: 'Meeting minutes' },
  HSE: { key: 'hse', label: 'HSE documents' },
  PV: { key: 'accepted', label: 'Accepted deliverables' },
};
/** Order of the categories: the typed ones above, then the Codex families (DOC_FAM order). */
const CLIENT_DOC_CATEGORY_ORDER: readonly string[] = ['contract', 'minutes', 'hse', 'accepted', ...docFamily.codes];

export interface SharedDocCategoryInput {
  /** Codex type code ("MIN") and its EN label ("Meeting minutes"). */
  type: string;
  typeLabel: string;
  family: DocFamily;
  issuedOn: string;
}

export interface ClientDocCategory {
  /** Stable key ("minutes", "hse", "eng"…). */
  key: string;
  /** EN source label ("Meeting minutes", "Engineering"). */
  category: string;
  fileCount: number;
  /** The distinct type labels of its files (EN source, first-seen order). */
  types: string[];
  /** Description: the type labels joined with " · " (EN source). */
  description: string;
  /** Latest issue date of its files (ISO). */
  latestIssuedOn: string;
}

/** Categories of the documents shared with the client, in a fixed order; a category without file is left out. */
export function clientDocCategories(docs: readonly SharedDocCategoryInput[]): ClientDocCategory[] {
  const by = new Map<string, ClientDocCategory>();
  for (const d of docs) {
    const c = CLIENT_DOC_CATEGORY_OF_TYPE[d.type] ?? { key: d.family, label: docFamily.label(d.family) };
    const cur = by.get(c.key) ?? { key: c.key, category: c.label, fileCount: 0, types: [], description: '', latestIssuedOn: d.issuedOn };
    cur.fileCount++;
    if (!cur.types.includes(d.typeLabel)) cur.types.push(d.typeLabel);
    if (d.issuedOn > cur.latestIssuedOn) cur.latestIssuedOn = d.issuedOn;
    by.set(c.key, cur);
  }
  return CLIENT_DOC_CATEGORY_ORDER.flatMap((k) => {
    const c = by.get(k);
    return c ? [{ ...c, description: c.types.join(' · ') }] : [];
  });
}

// ── Download status report (AF.client) ─────────────────────────────────────────────────────────────────

export type ReportFormat = 'pdf' | 'pptx';
export const CLIENT_REPORT_PERIODS: { value: ReportPeriod; label: string }[] = reportPeriod.codes.map((c) => ({ value: c, label: reportPeriod.label(c) }));
export const CLIENT_REPORT_FORMATS: { value: ReportFormat; label: string }[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'pptx', label: 'PowerPoint' },
];
/** AF_RESULT.client toast. */
export const REPORT_RESULT = 'Report downloaded';

export function parseClientReport(values: unknown): Parsed<{ period: ReportPeriod; format: ReportFormat }> {
  const v = record(values);
  const period = str(v.period) || CLIENT_REPORT_PERIODS[0].value;
  const format = str(v.format) || CLIENT_REPORT_FORMATS[0].value;
  if (!reportPeriod.isCode(period)) return { ok: false, error: 'Unknown period' };
  const f = CLIENT_REPORT_FORMATS.find((o) => o.value === format);
  if (!f) return { ok: false, error: 'Unknown format' };
  return { ok: true, value: { period, format: f.value } };
}
