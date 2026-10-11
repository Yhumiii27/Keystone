// View models of the Quality — NCR & deliverables screen (docs/spec/07 §2.3, template 1883–1971, logic 4612–4644):
// the register switch, the NCR log (KPI tiles, severity chips, rows, drawer) and the deliverables register (KPI tiles,
// status chips, rows, drawer), translated for the viewer. NCRs are Vigie's (src/server/dal/quality.ts reads the mirror);
// the derivations are src/domain/quality.ts. Pure (no I/O): the page passes the data, the viewer, `t` and the language.
import { LO, OK } from '@/components/app/tones';
import {
  QUALITY_TABS, RACI_LABEL, RACI_ORDER, awaitsVerification, deliverableActionFor, deliverableChips, deliverableHint, deliverableKpis, deliverableSteps,
  deliverableTagOf, depositTypeOf, ncrActionFor, ncrChips, ncrKpis, ncrSegments, ncrStatusTagOf, ncrSteps, ncrSyncLine, severityTagOf,
  type DeliverableStatus, type DeliverableViewer, type NcrSeverity, type NcrStatus, type ProducerTarget, type QualityKpi, type QualityTab,
} from '@/domain/quality';
import type { Lang, T } from '@/i18n/translate';
import { exportHref } from '@/lib/export-href';
import { money } from '@/lib/format';
import { NCR_VERIFIER_ROLES, fmtDOfIso, ncrSeverity, ncrStatus } from '@/server/db/codes';
import type { QualityDocument } from '@/server/dal/quality-screen';
import type { DeliverableRow, NcrRow } from '@/server/dal/quality';
import { dataText, moveToText, qualityT } from './i18n';
import { deliverableHref, ecoHref, partRecordHref, planActivityHref, planHref, purchaseOrderHref, qualityHref } from './links';

export interface QualityState {
  tab: QualityTab;
  /** NCR severity chips (`?filter=`). */
  filter: NcrSeverity | null;
  /** Deliverable status chips (`?status=`). */
  status: DeliverableStatus | null;
  /** Open NCR drawer (canonical number) or null. */
  ncr: string | null;
  /** Open deliverable drawer (canonical number) or null. */
  dlv: string | null;
}

/** Who looks at the screen, with what they may do on this project. */
export interface QualityViewerCtx extends DeliverableViewer {
  /** Links to Vigie are shown (Vigie is an internal application: not to the client). */
  vigie: boolean;
}

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

export interface ChipView {
  value: string;
  label: string;
  count: number;
  href: string;
}

export interface SegView {
  value: QualityTab;
  label: string;
  href: string;
}

const kpiView = (k: QualityKpi, t: T, lang: Lang): KpiView => ({
  label: t(k.label),
  value: k.money ? money(k.value, lang) : String(k.value),
  sub: t(k.sub),
  color: k.lo ? LO : OK,
});

/** Register switch (qSeg): links keep the chip filters, drop the drawers. */
export function qualitySegView(code: string, state: QualityState, tr: T): SegView[] {
  return QUALITY_TABS.map((o) => ({ value: o.value, label: tr(o.label), href: qualityHref(code, { tab: o.value, filter: state.filter, status: state.status }) }));
}

// ── NCR log ────────────────────────────────────────────────────────────────────────────────────────────

export type NcrRowAction =
  /** "→ Containment": the next step, sent to Vigie. */
  | { kind: 'step'; target: NcrStatus; label: string }
  /** "→ Closed": the quality manager's verification (approve), sent to Vigie. */
  | { kind: 'verify'; label: string };

export interface NcrRowView {
  number: string;
  /** Row click: opens the drawer, or closes it when this NCR is open. */
  href: string;
  selected: boolean;
  title: string;
  /** "Hélène Sauvage · 18 Sep". */
  raisedLine: string;
  severity: string;
  severityClass: string;
  source: string;
  /** "A1250 · Steel erection — Bays 3–4" or "—". */
  activity: string;
  owner: string;
  due: string;
  cost: string;
  /** Six progress segments (colours). */
  segments: string[];
  status: string;
  statusClass: string;
  action: NcrRowAction | null;
  /** "Containment requested · Pending sync with Vigie" — progress recorded in Keystone and not yet in Vigie. */
  sync: string | null;
  /** "Open in Vigie"; null when Vigie links are not shown to the viewer. */
  vigieUrl: string | null;
}

export interface NcrTabView {
  kpis: KpiView[];
  chips: ChipView[];
  /** Chip value of the current filter ('all' or a severity code). */
  filter: string;
  rows: NcrRowView[];
  empty: string | null;
  /** "Mirrored from Vigie — NCRs are managed in Vigie" in the card header (viewers with Vigie links). */
  mirrorNote: boolean;
}

const activityText = (n: Pick<NcrRow, 'activityCode' | 'activityName'>) => (n.activityCode ? n.activityCode + (n.activityName ? ' · ' + n.activityName : '') : '—');

function ncrRowAction(n: NcrRow, viewer: QualityViewerCtx, t: T): NcrRowAction | null {
  const a = ncrActionFor(n, viewer);
  if (!a) return null;
  if (a.kind === 'verify') return { kind: 'verify', label: `→ ${t(ncrStatus.label('closed'))}` };
  return { kind: 'step', target: a.target, label: `→ ${t(ncrStatus.label(a.target))}` };
}

/** The NCR log of a project: KPI tiles, severity chips (links), rows in Vigie's order, filtered by severity. */
export function ncrTabView(input: { code: string; ncrs: NcrRow[]; state: QualityState; viewer: QualityViewerCtx; dataDate?: string }, tr: T, lang: Lang): NcrTabView {
  const t = qualityT(tr, lang);
  const { code, ncrs, state, viewer } = input;
  const kpis = ncrKpis(ncrs, undefined, input.dataDate).map((k) => kpiView(k, t, lang));
  const chips = ncrChips(ncrs).map((c) => ({
    value: c.value ?? 'all', label: t(c.label), count: c.count, href: qualityHref(code, { filter: c.value, ncr: state.ncr }),
  }));
  const shown = state.filter ? ncrs.filter((n) => n.severity === state.filter) : ncrs;
  const rows = shown.map((n): NcrRowView => {
    const selected = state.ncr === n.number;
    const sync = ncrSyncLine(n);
    return {
      number: n.number,
      href: qualityHref(code, { filter: state.filter, ncr: selected ? null : n.number }),
      selected,
      title: dataText(n.title, lang),
      raisedLine: `${n.raisedBy} · ${t(fmtDOfIso(n.raisedOn))}`,
      severity: t(n.severityLabel),
      severityClass: severityTagOf(n.severity),
      source: t(n.sourceLabel),
      activity: t(activityText(n)),
      owner: n.owner,
      due: n.dueOn ? t(fmtDOfIso(n.dueOn)) : '—',
      cost: n.costKeur ? money(n.costKeur, lang) : '—',
      segments: ncrSegments(n.status),
      status: t(n.statusLabel),
      statusClass: ncrStatusTagOf(n.status),
      action: ncrRowAction(n, viewer, t),
      sync: sync ? sync.split(' · ').map(t).join(' · ') : null,
      vigieUrl: viewer.vigie ? n.vigieUrl : null,
    };
  });
  // A project Vigie reports no NCR for gets its own message (the prototype showed Harbor Line's NCRs, 00 §7.16).
  const empty = rows.length ? null : t(ncrs.length ? 'No non-conformance at this severity' : 'No non-conformance reported for this project');
  return { kpis, chips, filter: state.filter ?? 'all', rows, empty, mirrorNote: viewer.vigie };
}

export interface RecordRow {
  k: string;
  v: string;
  /** Value links to this Keystone page (deliverable, NCR). */
  href?: string;
  /** Several linked values (Linked NCRs). */
  links?: { label: string; href: string }[];
}

export interface NcrDrawerView {
  number: string;
  /** "NCR-029 · Survey". */
  head: string;
  title: string;
  severity: string;
  severityClass: string;
  status: string;
  statusClass: string;
  closeHref: string;
  steps: { label: string; reached: boolean }[];
  /** Severity (Vigie's): the three options, the current one on. */
  severities: { label: string; on: boolean }[];
  rootCause: string;
  action: string;
  record: RecordRow[];
  /** "Move to Containment" (the next step, sent to Vigie). */
  move: { target: NcrStatus; label: string } | null;
  /** Quality manager on an NCR in Verification: "Move to Closed" / "Back to corrective action". */
  verify: { closeLabel: string; backLabel: string } | null;
  /** In Verification and the viewer is not the quality manager. */
  verifyHint: string | null;
  sync: string | null;
  activityHref: string | null;
  partHref: string | null;
  eco: { number: string; href: string } | null;
  orders: { number: string; href: string }[];
  /** "Open in Vigie" / "8D report" / "Manage in Vigie"; null when Vigie links are not shown to the viewer. */
  vigieUrl: string | null;
}

/** NCR drawer (ncrVals 4624): opened by `?ncr=`. */
export function ncrDrawerView(
  input: { code: string; ncr: NcrRow; state: QualityState; viewer: QualityViewerCtx; ecoByPart: Record<string, string>; ordersByPart: Record<string, string[]> },
  tr: T,
  lang: Lang,
): NcrDrawerView {
  const t = qualityT(tr, lang);
  const { code, ncr: n, state, viewer } = input;
  const a = ncrActionFor(n, viewer);
  const ecoNumber = n.partRef ? input.ecoByPart[n.partRef] ?? null : null;
  const sync = ncrSyncLine(n);
  const record: RecordRow[] = [
    { k: t('Raised by'), v: `${n.raisedBy} · ${t(fmtDOfIso(n.raisedOn))}` },
    { k: t('Owner'), v: n.owner },
    { k: t('Source'), v: t(n.sourceLabel) },
    { k: t('Linked activity'), v: t(activityText(n)) },
    { k: t('Part'), v: n.partRef ?? '—' },
    { k: t('Deliverable impacted'), v: n.deliverableNumber ?? '—', href: n.deliverableNumber ? deliverableHref(code, n.deliverableNumber) : undefined },
    { k: t('ISO 9001 clause'), v: dataText(n.isoClause, lang) },
    { k: t('Cost of non-quality'), v: n.costKeur ? money(n.costKeur, lang) : '—' },
    { k: t('Action due'), v: n.dueOn ? t(fmtDOfIso(n.dueOn)) : '—' },
  ];
  const inVerification = awaitsVerification(n);
  return {
    number: n.number,
    head: `${n.number} · ${t(n.sourceLabel)}`,
    title: dataText(n.title, lang),
    severity: t(n.severityLabel),
    severityClass: severityTagOf(n.severity),
    status: t(n.statusLabel),
    statusClass: ncrStatusTagOf(n.status),
    closeHref: qualityHref(code, { filter: state.filter }),
    steps: ncrSteps(n.status).map((s) => ({ label: t(s.label), reached: s.reached })),
    severities: (['minor', 'major', 'critical'] as const).map((s) => ({ label: t(ncrSeverity.label(s)), on: s === n.severity })),
    rootCause: dataText(n.rootCause, lang),
    action: dataText(n.action, lang),
    record,
    move: a?.kind === 'step' ? { target: a.target, label: moveToText(ncrStatus.label(a.target), t, lang) } : null,
    verify: a?.kind === 'verify' ? { closeLabel: moveToText(ncrStatus.label('closed'), t, lang), backLabel: t('Back to corrective action') } : null,
    verifyHint: inVerification && !NCR_VERIFIER_ROLES.includes(viewer.role) ? t('Verification and closure are decided by the quality manager.') : null,
    sync: sync ? sync.split(' · ').map(t).join(' · ') : null,
    activityHref: n.activityCode ? planActivityHref(code, n.activityCode) : null,
    partHref: n.partRef ? partRecordHref(n.partRef) : null,
    eco: ecoNumber ? { number: ecoNumber, href: ecoHref(ecoNumber) } : null,
    orders: (n.partRef ? input.ordersByPart[n.partRef] ?? [] : []).map((po) => ({ number: po, href: purchaseOrderHref(code, po) })),
    vigieUrl: viewer.vigie ? n.vigieUrl : null,
  };
}

// ── Deliverables register ──────────────────────────────────────────────────────────────────────────────

export type DlvRowAction =
  | { kind: 'move'; to: ProducerTarget; label: string; variant: 'primary' | 'secondary' }
  | { kind: 'decide' };

export interface DlvRowView {
  number: string;
  href: string;
  selected: boolean;
  title: string;
  type: string;
  wbs: string;
  due: string;
  rev: string;
  /** R, A, C, I, B avatars: initials, full name as tooltip; empty when nobody holds the role. */
  raci: { role: string; name: string; initials: string }[];
  acceptance: string;
  status: string;
  statusClass: string;
  action: DlvRowAction | null;
}

export interface DlvTabView {
  kpis: KpiView[];
  chips: ChipView[];
  filter: string;
  rows: DlvRowView[];
  empty: string | null;
}

/** Acceptance text ("Accept by 2 Oct", "25 Sep · comments issued") translated per segment. */
const accText = (s: string, t: T) => s.split(' · ').map(t).join(' · ');

/** The deliverables register of a project: KPI tiles, status chips (links), rows in register order, filtered by status. */
export function dlvTabView(input: { code: string; deliverables: DeliverableRow[]; state: QualityState; viewer: QualityViewerCtx }, tr: T, lang: Lang): DlvTabView {
  const t = qualityT(tr, lang);
  const { code, deliverables, state, viewer } = input;
  const kpis = deliverableKpis(deliverables).map((k) => kpiView(k, t, lang));
  const chips = deliverableChips(deliverables).map((c) => ({
    value: c.value ?? 'all', label: t(c.label), count: c.count, href: qualityHref(code, { tab: 'dlv', status: c.value, dlv: state.dlv }),
  }));
  const shown = state.status ? deliverables.filter((d) => d.status === state.status) : deliverables;
  const rows = shown.map((d): DlvRowView => {
    const selected = state.dlv === d.number;
    const a = deliverableActionFor(d, viewer);
    return {
      number: d.number,
      href: qualityHref(code, { tab: 'dlv', status: state.status, dlv: selected ? null : d.number }),
      selected,
      title: dataText(d.title, lang),
      type: t(d.typeLabel),
      wbs: d.wbsCode,
      due: t(fmtDOfIso(d.dueOn)),
      rev: d.revision ?? '—',
      raci: RACI_ORDER.map((role) => {
        const c = d.raci.find((x) => x.role === role);
        return { role, name: c?.name ?? '', initials: c?.initials ?? '' };
      }),
      acceptance: accText(d.acceptanceText, t),
      status: t(d.statusLabel),
      statusClass: deliverableTagOf(d.status),
      action: a ? (a.kind === 'move' ? { ...a, label: t(a.label) } : a) : null,
    };
  });
  const empty = rows.length ? null : t(deliverables.length ? 'No deliverable in this status' : 'No deliverable registered for this project');
  return { kpis, chips, filter: state.status ?? 'all', rows, empty };
}

export interface DlvDrawerView {
  number: string;
  /** "D-015 · Manuals / as-built". */
  head: string;
  title: string;
  status: string;
  statusClass: string;
  closeHref: string;
  steps: { label: string; reached: boolean }[];
  raci: { k: string; l: string; who: string }[];
  record: RecordRow[];
  /** The issued document in the Codex index; null when none is linked. */
  document: QualityDocument | null;
  /** Producers may deposit / link the issued document. */
  canLinkDocument: boolean;
  /** Proposed Codex deposit type (PV, RPT, CER, MIN) for "Deposit in Codex". */
  depositType: string | null;
  /** Codex records of the project offered for the link (number · title). */
  documentOptions: { value: string; label: string }[];
  hint: string;
  /** "Submit to client" (Internal review, producers). */
  canSubmit: boolean;
  /** "Accept (PV)" / "Reject with comments" (Submitted, the project's client contact). */
  canDecide: boolean;
  planHref: string;
  /** Accepted deliverable: its acceptance certificate ("PV de réception") as a PDF (chapter 4 exports); null otherwise. */
  pvHref: string | null;
}

/** Deliverable drawer (dlvVals 4639): opened by `?dlv=`. */
export function dlvDrawerView(
  input: { code: string; deliverable: DeliverableRow; state: QualityState; viewer: QualityViewerCtx; documents: QualityDocument[] },
  tr: T,
  lang: Lang,
): DlvDrawerView {
  const t = qualityT(tr, lang);
  const { code, deliverable: d, state, viewer } = input;
  const a = deliverableActionFor(d, viewer);
  const doc = d.documentNumber ? input.documents.find((x) => x.number === d.documentNumber) ?? { number: d.documentNumber, title: '', revision: '', statusLabel: '' } : null;
  return {
    number: d.number,
    head: `${d.number} · ${t(d.typeLabel)}`,
    title: dataText(d.title, lang),
    status: t(d.statusLabel),
    statusClass: deliverableTagOf(d.status),
    closeHref: qualityHref(code, { tab: 'dlv', status: state.status }),
    steps: deliverableSteps(d.status).map((s) => ({ label: t(s.label), reached: s.reached })),
    raci: RACI_ORDER.map((k) => ({ k, l: t(RACI_LABEL[k]), who: d.raci.find((c) => c.role === k)?.name ?? '—' })),
    record: [
      { k: t('WBS'), v: t(d.wbsCode + (d.wbsName ? ' · ' + d.wbsName : '')) },
      { k: t('Due'), v: t(fmtDOfIso(d.dueOn)) },
      { k: t('Revision'), v: d.revision ?? '—' },
      { k: t('Acceptance'), v: accText(d.acceptanceText, t) },
      d.linkedNcrs.length
        ? { k: t('Linked NCRs'), v: d.linkedNcrs.join(', '), links: d.linkedNcrs.map((n) => ({ label: n, href: qualityHref(code, { ncr: n }) })) }
        : { k: t('Linked NCRs'), v: t('None') },
      { k: t('Quality reference'), v: t('ISO 9001 · 8.6 Release of products and services') },
    ],
    // R-148: the linked document's title as typed (or its seeded demo entry).
    document: doc ? { ...doc, title: doc.title ? dataText(doc.title, lang) : '' } : null,
    canLinkDocument: viewer.canEdit && viewer.role !== 'client',
    depositType: depositTypeOf(d.type),
    documentOptions: input.documents.map((x) => ({ value: x.number, label: `${x.number} · ${dataText(x.title, lang)}` })),
    hint: t(deliverableHint(d, viewer)),
    canSubmit: a?.kind === 'move' && a.to === 'submitted',
    canDecide: a?.kind === 'decide',
    planHref: planHref(code),
    pvHref: d.status === 'accepted' ? exportHref('quality', { format: 'pdf', code, variant: 'pv', id: d.number }) : null,
  };
}
