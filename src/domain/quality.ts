// Quality — NCR & deliverables: the read-side rules of the screen (docs/spec/07 §2.3; prototype `ncrRows` / `ncrKpis` /
// `ncrVals` / `dlvRows` / `dlvKpis` / `dlvVals`, logic 4612–4644) and of the two My approvals kinds (apprItems 4727,
// 4730). No I/O, no translation: labels are the prototype's English source strings.
//
// Ownership (user decision, overrides the prototype and spec 07): Vigie owns the non-conformities — status, severity,
// causes, 8D, actions, costs and due dates come from Vigie's mirror and are never computed here. What Keystone derives:
// KPI tiles, severity chips, progress segments, the step the viewer may request (one step forward; the verification
// that closes an NCR or sends it back to corrective action is the quality manager's), the texts of the progress
// waiting for Vigie, and the NCR verification items. Keystone owns the deliverables: KPI tiles, status chips, the
// producer steps (Start → To internal review → Submit to client), the client's acceptance (PV) or rejection, the
// drawer's step indicator, RACI-B rows, the role hint and the deliverable acceptance items.
//
// Deviations from the prototype (docs/spec/07 OQ5, OQ14, 00 §7.16):
// - "Due in 30 days" is computed from the business date (R-013; due between it and 30 days later, not accepted)
//   instead of the literal dates {25 Sep, 30 Sep}; the counts are the prototype's.
// - "Overdue actions" counts the open NCRs whose action is due on or before the as-of date (OPEN QUESTION 07 OQ5: the
//   prototype listed the literal dates {30 Sep, 2 Oct}); the as-of date is the next weekly review after the business
//   date (business date + 7 days, R-013 — on the demo data set 25 Sep + 7 = 2 Oct, the prototype's count).
// - Step buttons follow the viewer: the client never advances NCRs nor produces deliverables, NCR closure is the quality
//   manager's verification, and only a client contact of the project accepts or rejects (07 OQ14).
// Golden values: src/domain/quality.test.ts (prototype render values, src/features/quality/quality.golden.json).
// Type-only import: a value import of '@/domain/approvals' loads the screen registry (icons), which breaks scripts/db-check.ts.
import type { ApprovalItem } from '@/domain/approvals';
import {
  DELIVERABLE_ACCEPTANCE_DAYS, DELIVERABLE_STATUS_TAG, NCR_FLOW, NCR_STATUS_TAG, NCR_VERIFIER_ROLES, RACI_CODES, SEVERITY_TAG, addDaysIso,
  deliverableStatus, fmtDOfIso, ncrNextStatus, ncrSeverity, ncrStatus, vigieSyncStatus,
  type DeliverableStatus, type NcrSeverity, type NcrSource, type NcrStatus, type NcrVerificationDecision, type RaciCode, type VigieSyncStatus,
} from '@/server/db/codes';
import { parseDateInput, type ParseResult } from './contract';
import { closedInQuarter } from './kpis';

export type { DeliverableStatus, NcrSeverity, NcrStatus, NcrVerificationDecision, RaciCode };

/** Colours of the prototype (LO / OK 3135, progress segments 4620, step dots 4624). */
export const QUALITY_COLOR = {
  text: 'var(--color-text)',
  lo: 'var(--color-accent-300)',
  accent: 'var(--color-accent)',
  segmentOff: 'var(--color-neutral-800)',
  dotOff: 'var(--color-neutral-700)',
  labelOff: 'var(--color-neutral-500)',
} as const;

const tag = (t: 'tag-accent' | 'tag-outline' | 'tag-neutral') => `tag ${t}`;

/** Register switch (qSeg 4644): NCR log first. */
export type QualityTab = 'ncr' | 'dlv';
export const QUALITY_TABS: readonly { value: QualityTab; label: string }[] = [
  { value: 'ncr', label: 'Non-conformances (NCR)' },
  { value: 'dlv', label: 'Deliverables register (RACI-B)' },
];
export const qualityTabOf = (v: unknown): QualityTab | null => (v === 'ncr' || v === 'dlv' ? v : null);

// ── Non-conformities (Vigie) ───────────────────────────────────────────────────────────────────────────

/** Progress recorded in Keystone on an NCR and not yet reflected by Vigie. */
export interface NcrProgressLike {
  kind: 'step' | 'verification';
  decision: NcrVerificationDecision | null;
  targetStatus: NcrStatus;
  syncStatus: VigieSyncStatus;
}

/** The connector's read model, structurally (src/server/integrations/vigie/types.ts VigieNcr). */
export interface NcrLike {
  number: string;
  title: string;
  severity: NcrSeverity;
  source: NcrSource;
  status: NcrStatus;
  owner: string;
  raisedBy: string;
  /** ISO date; null = "—". */
  dueOn: string | null;
  costKeur: number;
  /** Status requested in Keystone and pending sync with Vigie. */
  requestedStatus: NcrStatus | null;
  pendingProgress: NcrProgressLike[];
  /** Raised on (ISO) and, for a closed NCR, Vigie's closure date when known — "closed this quarter" (A-12). */
  raisedOn?: string;
  closedOn?: string | null;
}

export const NCR_SEVERITIES: readonly NcrSeverity[] = ncrSeverity.codes;
/** `?filter=` of the NCR log (severity code); anything else → All. */
export const ncrFilterOf = (v: unknown): NcrSeverity | null => (typeof v === 'string' && ncrSeverity.isCode(v) ? v : null);

export const severityTagOf = (s: NcrSeverity) => tag(SEVERITY_TAG[s]);
export const ncrStatusTagOf = (s: NcrStatus) => tag(NCR_STATUS_TAG[s]);

/**
 * As-of date of "Overdue actions" (see the header, OPEN QUESTION 07 OQ5): the business date + 7 days (R-013; was the frozen
 * status date + 7 = 2 Oct 2026, the same value on the demo data set).
 */
export const ncrOverdueAsOf = (today: string) => addDaysIso(today, 7);

export interface QualityKpi {
  label: string;
  /** Number, or an amount in k€ to format for the language (`money`). */
  value: number;
  money?: boolean;
  /** EN source ("1 closed this quarter"; the count rules of FR_RULES translate it). */
  sub: string;
  /** Value in LO (attention) instead of OK. */
  lo: boolean;
}

/**
 * NCR KPI tiles (ncrKpis 4622): open, critical, cost of non-quality, overdue actions, from goods receipt. "Closed this
 * quarter" (A-12, 07 OQ23) counts the NCRs closed in the data date's quarter (`closedInQuarter`; `dataDate` = the
 * project's data date) — the prototype counted every closed NCR. `today` = the business date (R-013): "Overdue actions"
 * counts up to `ncrOverdueAsOf(today)`.
 */
export function ncrKpis(ncrs: NcrLike[], today: string, dataDate: string): QualityKpi[] {
  const asOf = ncrOverdueAsOf(today);
  const open = ncrs.filter((n) => n.status !== 'closed');
  const critical = open.filter((n) => n.severity === 'critical').length;
  return [
    { label: 'Open NCRs', value: open.length, sub: `${closedInQuarter(ncrs, dataDate)} closed this quarter`, lo: open.length > 0 },
    { label: 'Critical', value: critical, sub: 'Stop-work until containment', lo: critical > 0 },
    { label: 'Cost of non-quality', value: ncrs.reduce((a, n) => a + n.costKeur, 0), money: true, sub: 'Rework, scrap, re-inspection', lo: false },
    { label: 'Overdue actions', value: open.filter((n) => !!n.dueOn && n.dueOn <= asOf).length, sub: 'Corrective action past due date', lo: false },
    { label: 'From goods receipt', value: ncrs.filter((n) => n.source === 'goods_receipt').length, sub: 'Supplier-caused · feeds supplier rating', lo: false },
  ];
}

export interface QualityChip<V extends string> {
  /** null = All. */
  value: V | null;
  label: string;
  count: number;
}

/** Severity chips (ncrChips): All + Minor / Major / Critical with their counts (0 shown). */
export function ncrChips(ncrs: NcrLike[]): QualityChip<NcrSeverity>[] {
  return [
    { value: null, label: 'All', count: ncrs.length },
    ...NCR_SEVERITIES.map((s) => ({ value: s, label: ncrSeverity.label(s), count: ncrs.filter((n) => n.severity === s).length })),
  ];
}

/** Index of the status in the flow (0 Open … 5 Closed). */
export const ncrStepIndex = (s: NcrStatus) => NCR_FLOW.indexOf(s);

/** Progress segments of the log (one per NCR_FLOW step, filled up to and including the current one). */
export const ncrSegments = (s: NcrStatus): string[] => NCR_FLOW.map((_, i) => (i <= ncrStepIndex(s) ? QUALITY_COLOR.accent : QUALITY_COLOR.segmentOff));

export interface QualityStep {
  label: string;
  /** Accent dot and text label when reached; neutral-700 dot and neutral-500 label otherwise. */
  reached: boolean;
}

/** Drawer step indicator (ncrVals.steps): the six NCR_FLOW steps. */
export const ncrSteps = (s: NcrStatus): QualityStep[] => NCR_FLOW.map((x, i) => ({ label: ncrStatus.label(x), reached: i <= ncrStepIndex(s) }));

/** Who looks at the NCR log: role key and whether the screen is editable for them on this project. */
export interface QualityViewer {
  role: string;
  /** Not outside the workspace and the project is not read-only for them. */
  canEdit: boolean;
}

/**
 * What the viewer may record on an NCR from Keystone (sent to Vigie):
 * - `step`: the next step ("→ Containment" in the log, "Move to Containment" in the drawer) — any editor but the client;
 * - `verify`: the NCR is in Verification and the viewer is the quality manager: close it ("→ Closed") or send it back
 *   to corrective action (drawer, My approvals);
 * - null: closed, a request already waiting for Vigie, read-only, the client, or the verification of someone else.
 */
export type NcrAction = { kind: 'step'; target: NcrStatus } | { kind: 'verify' } | null;

export function ncrActionFor(n: Pick<NcrLike, 'status' | 'requestedStatus'>, viewer: QualityViewer): NcrAction {
  if (!viewer.canEdit || viewer.role === 'client' || n.status === 'closed' || n.requestedStatus) return null;
  const next = ncrNextStatus(n.status);
  if (next === 'closed') return NCR_VERIFIER_ROLES.includes(viewer.role) ? { kind: 'verify' } : null;
  return { kind: 'step', target: next };
}

/** The NCR waits for the quality manager's verification (in Verification, nothing pending in Keystone). */
export const awaitsVerification = (n: Pick<NcrLike, 'status' | 'requestedStatus'>) => n.status === 'verification' && !n.requestedStatus;

/** Text of a request waiting for Vigie: "Containment requested", "Closure requested", "Back to corrective action requested". */
export function ncrRequestText(e: Pick<NcrProgressLike, 'kind' | 'decision' | 'targetStatus'>): string {
  if (e.kind === 'verification') return e.decision === 'approved' ? 'Closure requested' : 'Back to corrective action requested';
  return `${ncrStatus.label(e.targetStatus)} requested`;
}

/** Sync state of the progress recorded in Keystone (failed > pending > sent); null when nothing waits. */
export function ncrSyncStateOf(n: Pick<NcrLike, 'pendingProgress'>): VigieSyncStatus | null {
  if (!n.pendingProgress.length) return null;
  if (n.pendingProgress.some((p) => p.syncStatus === 'failed')) return 'failed';
  return n.pendingProgress.some((p) => p.syncStatus === 'pending') ? 'pending' : 'sent';
}

/** "Containment requested · Pending sync with Vigie" under the status; null when nothing waits for Vigie. */
export function ncrSyncLine(n: Pick<NcrLike, 'pendingProgress'>): string | null {
  const state = ncrSyncStateOf(n);
  const last = n.pendingProgress.at(-1);
  return state && last ? `${ncrRequestText(last)} · ${vigieSyncStatus.label(state)}` : null;
}

/** Number of open critical NCRs (Quality nav badge `qBadge` 5147): "" when none. */
export const qualityBadge = (ncrs: Pick<NcrLike, 'status' | 'severity'>[]) => {
  const n = ncrs.filter((x) => x.status !== 'closed' && x.severity === 'critical').length;
  return n ? String(n) : '';
};

// ── Deliverables (Keystone) ───────────────────────────────────────────────────────────────────────────

export interface DeliverableLike {
  number: string;
  title: string;
  status: DeliverableStatus;
  /** ISO date. */
  dueOn: string;
  typeLabel: string;
  /** "12 Mar · N. Bensaïd", "Accept by 2 Oct"… (DAL `acceptanceText`). */
  acceptanceText: string;
  raci: { role: RaciCode; name: string | null }[];
}

export const DELIVERABLE_FLOW: readonly DeliverableStatus[] = deliverableStatus.codes;
/** `?status=` of the register (status code); anything else → All. */
export const deliverableFilterOf = (v: unknown): DeliverableStatus | null => (typeof v === 'string' && deliverableStatus.isCode(v) ? v : null);
export const deliverableTagOf = (s: DeliverableStatus) => tag(DELIVERABLE_STATUS_TAG[s]);

/**
 * Deliverable KPI tiles (dlvKpis 4637): count, awaiting acceptance, due in 30 days, without backup, rejected. `statusIso` = the
 * business date (R-013).
 */
export function deliverableKpis(ds: DeliverableLike[], statusIso: string): QualityKpi[] {
  const submitted = ds.filter((d) => d.status === 'submitted').length;
  const rejected = ds.filter((d) => d.status === 'rejected').length;
  const horizon = addDaysIso(statusIso, 30);
  return [
    { label: 'Deliverables', value: ds.length, sub: `${ds.filter((d) => d.status === 'accepted').length} accepted by client`, lo: false },
    { label: 'Awaiting client acceptance', value: submitted, sub: `${DELIVERABLE_ACCEPTANCE_DAYS}-day acceptance window`, lo: submitted > 0 },
    { label: 'Due in 30 days', value: ds.filter((d) => d.status !== 'accepted' && d.dueOn >= statusIso && d.dueOn <= horizon).length, sub: 'Not yet accepted', lo: false },
    { label: 'Without backup (B)', value: ds.filter((d) => !d.raci.find((c) => c.role === 'B')?.name).length, sub: 'RACI-B complete on every line', lo: false },
    { label: 'Rejected', value: rejected, sub: 'Resubmission needed', lo: rejected > 0 },
  ];
}

/** Status chips (dlvChips): All + the six statuses with their counts. */
export function deliverableChips(ds: DeliverableLike[]): QualityChip<DeliverableStatus>[] {
  return [
    { value: null, label: 'All', count: ds.length },
    ...DELIVERABLE_FLOW.map((s) => ({ value: s, label: deliverableStatus.label(s), count: ds.filter((d) => d.status === s).length })),
  ];
}

/** Drawer step indicator (dlvVals.steps): Planned … Accepted; every dot grey when the deliverable was rejected. */
export function deliverableSteps(s: DeliverableStatus): QualityStep[] {
  const idx = DELIVERABLE_FLOW.indexOf(s);
  return DELIVERABLE_FLOW.slice(0, 5).map((x, i) => ({ label: deliverableStatus.label(x), reached: i <= idx && s !== 'rejected' }));
}

/** RACI-B rows of the drawer (dlvVals.raci). */
export const RACI_LABEL: Record<RaciCode, string> = {
  R: 'Responsible — produces it',
  A: 'Accountable — signs it off',
  C: 'Consulted',
  I: 'Informed',
  B: 'Backup — takes over if R is absent',
};
export const RACI_ORDER: readonly RaciCode[] = RACI_CODES;

/** Who looks at the register: role, edit right on this project, and whether they are a client contact of its client. */
export interface DeliverableViewer extends QualityViewer {
  isClientContact: boolean;
}

/** Producer step of the register: Start (Planned), To internal review (In progress), Submit to client (Internal review). */
export type ProducerTarget = 'in_progress' | 'internal_review' | 'submitted';
export type DeliverableAction =
  | { kind: 'move'; to: ProducerTarget; label: string; variant: 'primary' | 'secondary' }
  /** Submitted and the viewer is the project's client contact: Accept (PV) / Reject. */
  | { kind: 'decide' }
  | null;

const PRODUCER: Partial<Record<DeliverableStatus, { to: ProducerTarget; label: string; variant: 'primary' | 'secondary' }>> = {
  planned: { to: 'in_progress', label: 'Start', variant: 'secondary' },
  in_progress: { to: 'internal_review', label: 'To internal review', variant: 'secondary' },
  internal_review: { to: 'submitted', label: 'Submit to client', variant: 'primary' },
  // R-114 (Q-3a, owner's answer "a"): a deliverable rejected by the client goes back to In progress at the next revision.
  rejected: { to: 'in_progress', label: 'Start next revision', variant: 'secondary' },
};

/** The row action of the viewer (dlvRows canStart / canSubmit / canAccept), following the viewer (07 OQ14). */
export function deliverableActionFor(d: Pick<DeliverableLike, 'status'>, viewer: DeliverableViewer): DeliverableAction {
  if (!viewer.canEdit) return null;
  if (d.status === 'submitted') return viewer.isClientContact ? { kind: 'decide' } : null;
  const p = PRODUCER[d.status];
  return p && viewer.role !== 'client' ? { kind: 'move', ...p } : null;
}

/** The producer step that follows a status (server-side check of "Start" / "To internal review" / "Submit to client"). */
export const producerNextOf = (s: DeliverableStatus): ProducerTarget | null => PRODUCER[s]?.to ?? null;

/** Drawer hint (dlvVals.hint): a submitted deliverable seen by someone who cannot decide it. */
export function deliverableHint(d: Pick<DeliverableLike, 'status'>, viewer: DeliverableViewer): string {
  return d.status === 'submitted' && !viewer.isClientContact && viewer.role !== 'client' ? 'Switch to the Client role (bottom-left) to accept or reject.' : '';
}

/**
 * Next revision of a deliverable after a client rejection (R-114, Q-3a): letters go A → B … Z → AA (case kept), numbers
 * 0 → 1, 09 → 10 (width kept), a trailing number or letter of a mixed index is stepped ("P01" → "P02", "1A" → "1B"); no
 * revision yet → "A"; anything else gets ".1".
 */
export function nextRevision(rev: string | null | undefined): string {
  const r = (rev ?? '').trim();
  if (!r || r === '—') return 'A';
  const letters = (x: string) => {
    const upper = x === x.toUpperCase();
    const a = (upper ? 'A' : 'a').charCodeAt(0);
    const digits = [...x].map((c) => c.charCodeAt(0) - a);
    let i = digits.length - 1;
    while (i >= 0 && digits[i] === 25) digits[i--] = 0;
    if (i < 0) digits.unshift(0);
    else digits[i]++;
    return digits.map((d) => String.fromCharCode(a + d)).join('');
  };
  const num = (x: string) => String(+x + 1).padStart(x.length, '0');
  let m = /^(.*?)(\d+)$/.exec(r);
  if (m) return m[1] + num(m[2]);
  m = /^(.*?)([A-Z]+|[a-z]+)$/.exec(r);
  if (m) return m[1] + letters(m[2]);
  return `${r}.1`;
}

/** One client decision of the review history (newest first in the drawer). */
export interface DeliverableReviewLike {
  revision: string | null;
  decision: 'accepted' | 'rejected';
  /** ISO date. */
  decidedOn: string;
  decidedBy: string;
  comments: string | null;
}

/**
 * "Rev C · Rejected 25 Sep · N. Bensaïd" (`t` translates the words and the date, shown with its year outside the business
 * year `year`; the comments are shown under it as typed).
 */
export const reviewLineText = (r: DeliverableReviewLike, year: number, t: (s: string) => string = (s) => s) =>
  `${t('Rev')} ${r.revision ?? '—'} · ${t(r.decision === 'accepted' ? 'Accepted' : 'Rejected')} ${t(fmtDOfIso(r.decidedOn, year))} · ${r.decidedBy}`;

// ── New deliverable (R-115, Q-3b: added by the project manager) ─────────────────────────────────────────

/** Roles that create a project's contractual deliverables (Q-3b: the project manager — of that project — and the director). */
export const DELIVERABLE_CREATOR_ROLES: readonly string[] = ['pm', 'director'];

export interface NewDeliverableValues {
  /** Settings › Deliverable types code. */
  type: string;
  title: string;
  /** ISO due date. */
  dueOn: string;
  /** WBS element code ("1.5"). */
  wbsCode: string;
  /** Responsible (R) and backup (B), full names from the project team. */
  responsible: string;
  backup: string | null;
}

/**
 * "New deliverable": a type of the Settings list (active), a title, a due date, a WBS element of the project, the
 * responsible (R) and an optional backup (B) from the team, different from the responsible. Codes or labels accepted for
 * the type; '' or "—" for no backup.
 */
export function parseNewDeliverable(
  values: Record<string, string | undefined>,
  opts: { types: readonly { code: string; label: string }[]; wbs: readonly string[]; team: readonly string[]; year: number },
): ParseResult<NewDeliverableValues> {
  const v = (k: string) => (values[k] ?? '').trim();
  const rawType = v('type') || opts.types[0]?.code || '';
  const type = opts.types.find((x) => x.code === rawType || x.label === rawType)?.code;
  if (!type) return { ok: false, error: 'Unknown deliverable type' };
  const title = v('title');
  if (!title) return { ok: false, error: 'Title is required' };
  if (title.length > 200) return { ok: false, error: 'Text is too long' };
  const due = v('due');
  if (!due) return { ok: false, error: 'Due date is required' };
  const dueOn = parseDateInput(due, opts.year);
  if (!dueOn) return { ok: false, error: 'Enter the due date as a date, e.g. 15 Oct' };
  const wbsCode = v('wbs') || opts.wbs[0] || '';
  if (!opts.wbs.includes(wbsCode)) return { ok: false, error: 'Unknown WBS element' };
  const responsible = v('r') || opts.team[0] || '';
  if (!opts.team.includes(responsible)) return { ok: false, error: 'Unknown responsible' };
  const b = v('b');
  const backup = b && b !== '—' ? b : null;
  if (backup && !opts.team.includes(backup)) return { ok: false, error: 'Unknown backup' };
  if (backup && backup === responsible) return { ok: false, error: 'The backup must differ from the responsible' };
  return { ok: true, value: { type, title, dueOn, wbsCode, responsible, backup } };
}

/** Deposit type proposed when the issued document of a deliverable is deposited in Codex (DEPOSIT_TYPES). */
export function depositTypeOf(type: string): string | null {
  switch (type) {
    case 'client_acceptance':
      return 'PV';
    case 'test_reports':
      return 'RPT';
    case 'certificates':
      return 'CER';
    case 'minutes':
      return 'MIN';
    default:
      return null;
  }
}

// ── My approvals (apprItems 4727, 4730) ───────────────────────────────────────────────────────────────

export interface QualityItemHrefs {
  /** The NCR / deliverable on the Quality screen of its project. */
  ncr: (number: string) => string;
  deliverable: (number: string) => string;
  /** The NCR in Vigie. */
  vigie?: (n: { number: string; vigieUrl: string }) => string;
}

/** "NCR verification" items: NCRs of the current project waiting for the quality manager (Close / back to Corrective action). */
export function ncrVerificationItems(
  ncrs: (NcrLike & { vigieUrl: string })[], code: string, hrefs: Pick<QualityItemHrefs, 'ncr'>, year: number,
): ApprovalItem[] {
  return ncrs.filter(awaitsVerification).map((n) => ({
    kind: 'ncr', id: n.number, title: n.title, sub: `${ncrSeverity.label(n.severity)} · ${n.owner}`, who: n.raisedBy,
    when: n.dueOn ? fmtDOfIso(n.dueOn, year) : '', whenIso: n.dueOn, href: hrefs.ncr(n.number),
    decision: { mode: 'ncr-verification', projectCode: code, number: n.number }, external: { href: n.vigieUrl, label: 'Open in Vigie' },
  }));
}

/** "Deliverable acceptance" items: submitted deliverables of the current project, for its client contact. */
export function deliverableAcceptanceItems(ds: DeliverableLike[], code: string, hrefs: Pick<QualityItemHrefs, 'deliverable'>, year: number): ApprovalItem[] {
  return ds.filter((d) => d.status === 'submitted').map((d) => ({
    kind: 'deliverable', id: d.number, title: d.title, sub: `${d.typeLabel} · ${d.acceptanceText}`, who: d.raci.find((c) => c.role === 'R')?.name ?? '',
    when: fmtDOfIso(d.dueOn, year), whenIso: d.dueOn, href: hrefs.deliverable(d.number), decision: { mode: 'deliverable', projectCode: code, number: d.number },
  }));
}
