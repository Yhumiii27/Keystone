// My approvals — the unified inbox (docs/spec/08 §7, 00 §7.8; prototype `apprItems` / `myApprKpis`, logic 4720–4737).
// Pure part: the approval-item shape every provider returns (src/server/approvals), the item builders of the
// kinds still read from the prototype data set (client deliverables, NCRs) and of the Codex documents, the
// change-request routing rule shared by the provider and the Server Function, and the inbox view model (KPIs, kind
// chips, filtered rows). Strings are English source text (money already formatted for the language, as the
// prototype's `f()`), rendered through t() by the feature.
//
// Deviations from the prototype (docs/spec/00 §7.16, 08 OQ22, OQ28):
// - "Oldest" is the item with the earliest date, not the last item pushed;
// - resource-request items carry the sent date and the real sender (not '' and a fixed "R. Aubert");
// - inline decisions are recorded for real: purchase orders, ECOs, delivery quality checks (the delivery QC no longer
//   throws) and, since Delivery 5, NCR verifications (sent to Vigie) and deliverable acceptances (src/domain/quality.ts
//   builds those items; the prototype builders below are kept for their tests);
// - "Decided this week" only counts the kinds the viewer decides (not every role's ordered POs);
// - the change control board step, which no persona held (07 OQ2), reaches the portfolio director who records it
//   on Change control (STEP_DECIDER), so a change request is never stuck in review.
import { screenHref, type RoleKey, type ScreenId } from '@/config/screens';
import type { Lang } from '@/i18n/translate';
import { money } from '@/lib/format';
import { isoOfDisplayDate, type ChangeStep, type StepDecision } from '@/server/db/codes';
import { CR_STEP_LABEL, STEP_DECIDER } from './change-control';
import { renderTxt, type Txt } from './home';

// ── Kinds ──────────────────────────────────────────────────────────────────────────────────────────────

/** Kind codes (URL `?filter=`), in the prototype's push order (routing matrix 08 §7.5), Codex documents last. */
export const APPROVAL_KINDS = ['request', 'po', 'eco', 'delivery', 'stage', 'cr', 'contingency', 'deliverable', 'rfq', 'invoice', 'ncr', 'doc'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

/** Kind tag / chip label (EN source; FR from the prototype dictionary, "Codex document" from extra/myapprovals.json). */
export const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
  request: 'Resource request',
  po: 'Purchase order',
  eco: 'ECO',
  delivery: 'Delivery — quality check',
  stage: 'Forced stage change',
  cr: 'Change request',
  // Delivery 7 (R-071, C-4): the portfolio director validates the contingency draw-downs.
  contingency: 'Contingency draw-down',
  deliverable: 'Deliverable acceptance',
  rfq: 'RFQ award',
  invoice: 'Invoice — 3-way match',
  ncr: 'NCR verification',
  doc: 'Codex document',
};

export const isApprovalKind = (v: unknown): v is ApprovalKind => typeof v === 'string' && (APPROVAL_KINDS as readonly string[]).includes(v);

// ── Items ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Inline decision of a row, recorded by its module's Server Function. `change-request` goes through the Change control
 * writer (decideChangeStep). Every kind is persisted since Delivery 5 (the prototype-only `preview` mode is gone).
 */
export type ApprovalDecision =
  | { mode: 'change-request'; projectCode: string; number: string; step: ChangeStep }
  /** ECO approval key of the viewer: recorded in Keystone and sent to Vigie (src/features/eco/actions.ts). */
  | { mode: 'eco'; number: string; key: 'englead' | 'quality' | 'pm' }
  /** Purchase order awaiting approval: Approve → Ordered, Reject → Cancelled (src/features/orders/actions.ts). */
  | { mode: 'purchase-order'; projectCode: string; number: string }
  /** Goods receipt waiting for its quality check: Approve → Accept → stock, Reject → Reject → quarantine (src/features/deliveries/actions.ts). */
  | { mode: 'delivery-qc'; projectCode: string; number: string }
  /** NCR in verification (quality manager): Approve → Closed, Reject → back to Corrective action; sent to Vigie (src/features/quality/actions.ts). */
  | { mode: 'ncr-verification'; projectCode: string; number: string }
  /** Submitted deliverable (project's client contact): Approve → Accepted (PV), Reject → Rejected (src/features/quality/actions.ts). */
  | { mode: 'deliverable'; projectCode: string; number: string }
  /**
   * Chapter 4: pending resource request (department side, same rules as /resources/approvals): Approve → task created,
   * Reject → asks the reason the PM sees (src/features/myapprovals/actions.ts → src/features/requests/actions.ts).
   */
  | { mode: 'resource-request'; number: string }
  /**
   * Chapter 4 (L-1): forced stage change (portfolio director): Approve keeps the stage, Reject reverts the project to
   * `fromLabel` (the stage it left; prototype label) after a confirmation with an optional comment.
   */
  | { mode: 'stage'; projectCode: string; transitionId: string; fromLabel: string | null }
  /**
   * Delivery 7 (R-071, C-4): contingency draw-down awaiting the portfolio director: Approve → validated (drawn), Reject → rejected
   * after a confirmation with an optional comment the requester sees (src/features/risks/actions.ts decideDrawDownAction).
   */
  | { mode: 'contingency-draw'; projectCode: string; drawId: string }
  /**
   * Delivery 7 (P-7b = a, R-124): the step of a Codex document's circuit open for the viewer (named approver): Approve, or
   * Reject with the reason; sent to Codex through the outbox ("pending sync with Codex", src/features/docs/actions.ts).
   */
  | { mode: 'codex-document'; number: string; step: number };

export interface ApprovalItem {
  kind: ApprovalKind;
  /** Displayed reference — never translated ("PO-1082", "HLT-026"). */
  id: string;
  /** EN source / data text. */
  title: string;
  sub: string;
  /** Who submitted it. */
  who: string;
  /** Date shown after `who` ("24 Sep", "25 Sep 2026"); '' when unknown. */
  when: string;
  /** ISO date of `when` — the "Oldest" KPI compares these; null when unknown. */
  whenIso: string | null;
  /** Page that decides / shows the item (row click); null = not openable. */
  href: string | null;
  /** Inline Approve / Reject; null = decided on its own page only. */
  decision: ApprovalDecision | null;
  /** Link to the item in the application that owns it (e.g. "Open in Vigie"), opened outside Keystone; EN label. */
  external?: { href: string; label: string } | null;
}

/** "24 Sep" / "9 Jan ’27" / "25 Sep 2026" → ISO (2026 by default); null for "—" or ''. */
export const isoOfWhen = (when: string | null | undefined): string | null => isoOfDisplayDate(when ?? '');

const href = (screen: ScreenId, code: string | undefined, params: Record<string, string> = {}) => {
  const qs = new URLSearchParams(params).toString();
  return screenHref(screen, { code }) + (qs ? '?' + qs : '');
};

const item = (kind: ApprovalKind, x: Omit<ApprovalItem, 'kind' | 'whenIso'>): ApprovalItem => ({ kind, ...x, whenIso: isoOfWhen(x.when) });

// Every kind is read from the database (or a connector mirror): purchase orders, ECOs (Vigie mirror), delivery quality
// checks, RFQ awards and supplier invoices since Delivery 4 (`poApprovalItems` in ./orders, `ecoApprovalItems` in ./eco,
// `qcInboxItems` in ./deliveries, `rfqAwardItems` / `invoiceApprovalItems` in ./procurement); NCR verification (Vigie
// mirror) and client deliverable acceptance since Delivery 5 (`ncrVerificationItems` / `deliverableAcceptanceItems` in
// ./quality). The builders below are the kinds whose items are assembled here.

export interface ProtoDoc {
  id: string;
  type: string;
  title: string;
  /** Project code or "QMS". */
  proj: string;
  rev: string;
  status: string;
  date: string;
  by: string;
}

/**
 * Codex documents whose next circuit step names the viewer (00 §7.8; docRow 5026: circuit = DOC_TYPE.circuit split
 * on " → ", next step = steps[1 + approvals given], approver = DOC_WHO[step]). Decided in Codex, from the document
 * drawer only (no inline decision). QMS documents open in the current project's vault.
 */
export function codexDocItems(
  docs: ProtoDoc[], docTypes: Record<string, { label: string; circuit: string }>, docWho: Record<string, string>, viewerShort: string, currentCode: string,
): ApprovalItem[] {
  return docs
    .filter((d) => {
      if (d.status !== 'Release proposed') return false;
      const step = docTypes[d.type]?.circuit.split(' → ')[1];
      return !!step && docWho[step] === viewerShort;
    })
    .map((d) => {
      const step = docTypes[d.type].circuit.split(' → ')[1];
      return item('doc', {
        id: d.id, title: d.title, sub: `${docTypes[d.type].label} · rev ${d.rev} · ${step}`, when: d.date, who: d.by,
        href: href('docs', d.proj === 'QMS' ? currentCode : d.proj, { doc: d.id }), decision: null,
      });
    });
}

/** Codex index record fields the inbox reads (`VaultDocument`, src/server/dal/documents.ts). */
export interface VaultDocForInbox {
  number: string;
  title: string;
  typeLabel: string;
  /** Project code, or "QMS". */
  project: string;
  revision: string;
  status: string;
  /** "28 Sep". */
  dateText: string;
  author: string;
  /** Next circuit step (label) and its named approver; null when no step is pending. */
  nextRoleLabel: string | null;
  nextApprover: string | null;
  /** Delivery 7: the step open in Keystone (null before the PM's validation, after a rejection, or when every step waits for Codex). */
  circuitState: { nextStep: number | null };
}

/**
 * Codex documents of the database index awaiting the viewer: "Release proposed" and the circuit step open in Keystone
 * names the viewer. Same rows as `codexDocItems` on the seed; the next step follows the approvals already signed in
 * Codex or recorded in Keystone (after the quality manager approves RPT-HLT-014, the item moves to the project manager).
 * Delivery 7 (P-7b = a, R-124): decided inline (Approve, Reject with the reason), sent to Codex; "Open in Codex" opens
 * Codex (its home until the deep links exist, D-1).
 */
export function codexVaultItems(
  docs: VaultDocForInbox[], viewerShort: string, currentCode: string, codexUrl?: string | ((d: VaultDocForInbox) => string),
): ApprovalItem[] {
  return docs
    .filter((d) => d.status === 'release_proposed' && d.circuitState.nextStep != null && !!d.nextRoleLabel && d.nextApprover === viewerShort)
    .map((d) =>
      item('doc', {
        id: d.number, title: d.title, sub: `${d.typeLabel} · rev ${d.revision} · ${d.nextRoleLabel}`, when: d.dateText, who: d.author,
        href: href('docs', d.project === 'QMS' ? currentCode : d.project, { doc: d.number }),
        decision: { mode: 'codex-document', number: d.number, step: d.circuitState.nextStep! },
        // Delivery 8 (R-033): "Open in Codex" opens the record in Codex (`codexUrl` per record; Codex's home before).
        ...(codexUrl ? { external: { href: typeof codexUrl === 'function' ? codexUrl(d) : codexUrl, label: 'Open in Codex' } } : {}),
      }),
    );
}

// ── Change requests (DB) ───────────────────────────────────────────────────────────────────────────────

export interface ChangeRequestForInbox {
  id: string;
  title: string;
  /** "Budget · Schedule". */
  typesLabel: string;
  amount: number;
  days: number;
  status: string;
  by: string;
  date: string;
  chain: { step: ChangeStep; approver: string | null; decision: StepDecision | null }[];
}

/** Who decides: the signed-in person (approver of the pm / director / client steps) and their role (CCB recorder). */
export interface StepViewer {
  name: string;
  role: RoleKey;
}

/** Steps in the order the inbox offers them (one row per change request: the first step the viewer can decide). */
const INBOX_STEPS: readonly ChangeStep[] = ['pm', 'director', 'client', 'ccb'];

/**
 * The step of a change request the viewer decides now (apprItems 4726 by person instead of role): the CR is in
 * review and a step the viewer holds is pending. Null otherwise.
 */
export function pendingStepFor(cr: ChangeRequestForInbox, viewer: StepViewer): ChangeStep | null {
  return INBOX_STEPS.find((step) => canDecideStep(cr, step, viewer)) ?? null;
}

/**
 * The viewer may record `step` of this change request now (the inline decision's permission check): request in
 * review, step pending, and the viewer is the step's named approver — or, for the change control board (no named
 * approver, 07 OQ2), holds the role that records it on Change control (STEP_DECIDER.ccb, the portfolio director).
 */
export function canDecideStep(cr: ChangeRequestForInbox, step: ChangeStep, viewer: StepViewer): boolean {
  if (cr.status !== 'in_review') return false;
  const s = cr.chain.find((x) => x.step === step);
  if (!s || s.decision !== 'pending') return false;
  return step === 'ccb' ? viewer.role === STEP_DECIDER.ccb : !!s.approver && s.approver === viewer.name;
}

/**
 * "+12 d" / "-12 d": the prototype writes the number as is (ASCII hyphen, apprItems 4726), like Change control's
 * schedule cell (daysCell); the French "j" is applied at render time (src/features/myapprovals/i18n.ts).
 */
const signedDays = (d: number) => (d > 0 ? '+' : '') + d + ' d';

/** CR sub line: types · signed amount · signed days (apprItems 4726). */
export const changeRequestSub = (cr: Pick<ChangeRequestForInbox, 'typesLabel' | 'amount' | 'days'>, lang: Lang) =>
  cr.typesLabel + (cr.amount ? ' · ' + money(cr.amount, lang, { signed: true }) : '') + (cr.days ? ' · ' + signedDays(cr.days) : '');

/**
 * Change requests of a project waiting for the viewer's step, decided inline (Approve → ok, Reject → rejected).
 * A CCB row names the step at the end of the sub line ("… · Change control board"), since the same request
 * already came by for the director's own step.
 */
export function changeRequestItems(crs: ChangeRequestForInbox[], viewer: StepViewer, code: string, lang: Lang): ApprovalItem[] {
  return crs.flatMap((cr) => {
    const step = pendingStepFor(cr, viewer);
    if (!step) return [];
    const sub = changeRequestSub(cr, lang) + (step === 'ccb' ? ' · ' + CR_STEP_LABEL.ccb : '');
    return [
      item('cr', {
        id: cr.id, title: cr.title, sub, when: cr.date, who: cr.by,
        href: href('changes', code, { cr: cr.id }), decision: { mode: 'change-request', projectCode: code, number: cr.id, step },
      }),
    ];
  });
}

// ── Inbox view model ───────────────────────────────────────────────────────────────────────────────────

/** The item with the earliest known date (ties: list order); null when none has a date. */
export function oldestItem(items: ApprovalItem[]): ApprovalItem | null {
  let best: ApprovalItem | null = null;
  for (const i of items) if (i.whenIso && (!best || i.whenIso < best.whenIso!)) best = i;
  return best;
}

export interface InboxKpi {
  label: string;
  value: Txt;
  sub: Txt;
  /** Value in LO (attention) instead of OK. */
  lo: boolean;
}

export interface InboxChip {
  value: ApprovalKind | null;
  label: string;
  count: number;
}

export interface InboxView {
  kpis: InboxKpi[];
  /** Distinct kinds present, in push order. */
  kinds: ApprovalKind[];
  chips: InboxChip[];
  /** Effective filter: a kind with no item left falls back to All. */
  filter: ApprovalKind | null;
  rows: ApprovalItem[];
  total: number;
}

/**
 * KPI tiles, kind chips and rows (myApprKpis / apprChips / myApprovals, 4733–4737). `decided` = the viewer's
 * "Decided this week" count; `roleTitle` = persona title (EN source).
 */
export function inboxView(items: ApprovalItem[], opts: { decided: number; roleTitle: string; filter?: string | null }): InboxView {
  const kinds = APPROVAL_KINDS.filter((k) => items.some((i) => i.kind === k));
  const filter = isApprovalKind(opts.filter) && kinds.includes(opts.filter) ? opts.filter : null;
  const oldest = oldestItem(items);
  return {
    kpis: [
      { label: 'Waiting for me', value: String(items.length), sub: { tpl: 'As {role}', p: { role: opts.roleTitle } }, lo: items.length > 0 },
      // Sub: translated kind labels joined with " · " (rendered by kpiTexts).
      { label: 'Types', value: String(kinds.length), sub: kinds.length ? { tpl: kinds.map((_, i) => `{k${i}}`).join(' · '), p: Object.fromEntries(kinds.map((k, i) => [`k${i}`, APPROVAL_KIND_LABEL[k]])) } : 'Nothing pending', lo: false },
      { label: 'Oldest', value: oldest?.when || '—', sub: 'Submitted on', lo: false },
      { label: 'Decided this week', value: String(opts.decided), sub: 'Audit trail kept per item', lo: false },
    ],
    kinds,
    chips: [{ value: null, label: 'All', count: items.length }, ...kinds.map((k) => ({ value: k, label: APPROVAL_KIND_LABEL[k], count: items.filter((i) => i.kind === k).length }))],
    filter,
    rows: filter ? items.filter((i) => i.kind === filter) : items,
    total: items.length,
  };
}

/** KPI tiles as display strings. */
export const kpiTexts = (k: InboxKpi, t: (s: string) => string) => ({ label: t(k.label), value: renderTxt(k.value, t), sub: renderTxt(k.sub, t), lo: k.lo });
