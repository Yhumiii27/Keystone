// View models of the Documents — Codex index (docs/spec/10 §4, template 2310–2345), the document record drawer
// (§4.5, template 2346–2362), the "Deposit in Codex" hand-off (§4.6, template 2363–2374, depVals) and the Document
// types register (§5, template 2375–2383): the domain figures (src/domain/documents.ts) and the DAL rows turned into
// the translated strings, tag classes and links the components render. Pure (no I/O): `t` and `lang` come from the
// page. Delivery 8: links to Codex open it in a new tab (R-033); the drawer keeps the current revision and circuit, the
// history stays in Codex (R-127, D-2 = a); deliverable, order and punch-item relations are links (R-128).
import { LO, OK } from '@/components/app/tones';
import { screenHref } from '@/config/screens';
import {
  QMS, canApproveDocument, clientRecipientText, countText, depositConfidentiality, depositNumberPreview, familyCounts,
  filesText, projectText, revisionContextText, revisionNote, statusCounts, typeWithCode, vaultKpis, vaultList, versionsText, viewCounts,
  type ApproverViewer, type DocFamily, type DocScope, type DocView, type DocumentStatus,
} from '@/domain/documents';
import type { Lang, T } from '@/i18n/translate';
import { codexSyncText } from '@/domain/codex-approvals';
import { CONFIDENTIALITY_TAG, DOCUMENT_STATUS_TAG, codexDecision, confidentiality, docFamily, docSavedView, documentStatus, shortDateOfIso } from '@/server/db/codes';
import type { CodexSyncState, DocumentLinkRow, DocumentRecord, DocumentTypeRow, VaultDocument } from '@/server/dal/documents';
import { approveLabelT, circuitT, exactT, revisionContextT, roleT } from './i18n';
import { codexConnectorMode } from '@/server/integrations/codex/config';
import { codexIndexLineT } from '@/server/integrations/codex/display';
import { codexDocumentUrl } from '@/server/integrations/codex/links';
import { itpHref } from '@/features/itpcom/model';
import { ordersHref } from '@/features/orders/links';
import { deliverableHref } from '@/features/quality/links';
import { documentsHref, type DocsQuery } from './links';
import { pageSlice, pagerView, type PagerView } from '@/domain/pagination';

const tag = (tone: string) => `tag ${tone}`;

// ── Vault ──────────────────────────────────────────────────────────────────────────────────────────────

export interface DocsState {
  scope: DocScope;
  view: DocView;
  family: DocFamily | null;
  status: DocumentStatus | null;
  q: string;
  /** `?doc=` (open drawer). */
  doc: string | null;
  /** R-017: `?page=` of the vault list (1 when absent). */
  page?: number;
}

/**
 * Search params of the vault kept when a chip, the scope or the drawer changes. The page is kept (opening a record keeps the
 * page it is on); a filter chip or the scope goes back to page 1.
 */
export const keepQuery = (s: DocsState): DocsQuery => ({
  scope: s.scope, view: s.view, fam: s.family, status: s.status, q: s.q || null, page: s.page && s.page > 1 ? String(s.page) : null,
});

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

export interface VaultRowView {
  number: string;
  isNew: boolean;
  title: string;
  kind: string;
  service: string;
  project: string;
  revision: string;
  status: string;
  statusClass: string;
  conf: string;
  confClass: string;
  tags: string;
  /** Row click toggles the drawer (`dv.open === id ? null : id`). */
  href: string;
  /** Drawer open on this row. */
  open: boolean;
}

export interface VaultView {
  /** "Mock index · 412 records" (translated; "Last sync 08:02 · 412 records" once Codex is connected, R-021). */
  sync: string;
  /** Record count of the sync line, for the "Sync now" toast. */
  records: number;
  kpis: KpiView[];
  scope: { value: DocScope; options: { value: DocScope; label: string; href: string }[] };
  views: { value: DocView; chips: ChipView[] };
  families: { value: string; chips: ChipView[] };
  statuses: { value: string; chips: ChipView[] };
  q: string;
  /** "Vault · 38 / 40 documents" (translated). */
  title: string;
  rows: VaultRowView[];
  /** "No document matches" under the empty table, else null. */
  empty: string | null;
  /** R-017: the pager when the list holds more than one page (PAGE_SIZE rows), else null. */
  pager: PagerView | null;
}


export function vaultRowView(d: VaultDocument, href: string, open: boolean, t: T, lang: Lang): VaultRowView {
  return {
    number: d.number, isNew: d.isNew, title: exactT(d.title, lang), kind: t(d.typeLabel), service: t(d.serviceLabel), project: d.project,
    revision: d.revision, status: t(d.statusLabel), statusClass: tag(DOCUMENT_STATUS_TAG[d.status]), conf: t(d.confidentialityLabel),
    confClass: tag(CONFIDENTIALITY_TAG[d.confidentiality]), tags: exactT(d.tagsText, lang), href, open,
  };
}

export interface VaultInput {
  project: string;
  docs: VaultDocument[];
  sync: CodexSyncState | null;
  state: DocsState;
}

export function vaultView({ project, docs, sync, state }: VaultInput, t: T, lang: Lang): VaultView {
  // R-017: a filter chip or the scope goes back to page 1; the rows and the pager keep the page.
  const keep = { ...keepQuery(state), page: null };
  const keepPage = keepQuery(state);
  const href = (q: DocsQuery) => documentsHref(project, q);
  const display = (d: VaultDocument) => `${exactT(d.title, lang)} ${t(d.typeLabel)} ${exactT(d.tagsText, lang)}`;
  const { scoped, list } = vaultList(docs, { scope: state.scope, project, view: state.view, family: state.family, status: state.status, q: state.q }, display);

  const kpis = vaultKpis(scoped).map((k) => ({ label: t(k.label), value: String(k.value), sub: t(k.sub), color: k.alert ? LO : OK }));
  const scopeOptions = (['proj', 'all'] as DocScope[]).map((value) => ({
    value, label: t(value === 'proj' ? 'Current project' : 'All projects'), href: href({ ...keep, scope: value }),
  }));
  // Selecting a saved view resets the family and status filters (setDv({view, fam:null, st:null})).
  const views = viewCounts(scoped, project).map((c) => ({
    value: c.view as string, label: t(docSavedView.label(c.view)), count: c.count, href: href({ ...keep, view: c.view, fam: null, status: null }),
  }));
  const families = [
    { value: 'all', label: t('All families'), count: scoped.length, href: href({ ...keep, fam: null }) },
    ...familyCounts(scoped).map((c) => ({ value: c.family as string, label: t(docFamily.label(c.family)), count: c.count, href: href({ ...keep, fam: c.family }) })),
  ];
  const statuses = [
    { value: 'all', label: t('All statuses'), count: scoped.length, href: href({ ...keep, status: null }) },
    ...statusCounts(scoped).map((c) => ({ value: c.status as string, label: t(documentStatus.label(c.status)), count: c.count, href: href({ ...keep, status: c.status }) })),
  ];
  // R-017: the list is shown PAGE_SIZE rows at a time (`?page=`); counts, KPIs and the title cover the whole list.
  const { rows: shown, window } = pageSlice(list, state.page ?? 1);
  const rows = shown.map((d) => {
    const open = state.doc === d.number;
    return vaultRowView(d, href({ ...keepPage, page: window.page > 1 ? String(window.page) : null, doc: open ? null : d.number }), open, t, lang);
  });
  const pager = pagerView(window.page, window.pages, (n) => href({ ...keepPage, page: n > 1 ? String(n) : null, doc: state.doc }), t);
  return {
    // R-021: Codex is a mock until its connector exists — "Mock index · 412 records", no sync time.
    sync: sync ? codexIndexLineT(sync, codexConnectorMode(), t, lang) : '',
    records: sync?.records ?? 0,
    kpis,
    scope: { value: state.scope, options: scopeOptions },
    views: { value: state.view, chips: views },
    families: { value: state.family ?? 'all', chips: families },
    statuses: { value: state.status ?? 'all', chips: statuses },
    q: state.q,
    title: `${t('Vault')} · ${t(countText(list.length, scoped.length))}`,
    rows,
    empty: rows.length ? null : t('No document matches'),
    pager,
  };
}

// ── Document record drawer ─────────────────────────────────────────────────────────────────────────────

export interface DrawerRevisionView {
  revision: string;
  current: boolean;
  note: string;
  /** "{date} · {by} · {versions}". */
  sub: string;
  status: string;
  statusClass: string;
}

export interface DrawerApprovalView {
  /** "{role} · {who}". */
  label: string;
  /** "Signed · 27 Sep" / "Pending · —" / Delivery 7: "Approved · 11 Oct · Pending sync with Codex" (decided in Keystone). */
  state: string;
  signed: boolean;
  /** Delivery 7: decided in Keystone, waiting for Codex. */
  pendingSync: boolean;
}

export interface DrawerDistributionView {
  to: string;
  /** "· rev D · 26 Sep" (the template's literal "rev"). */
  sub: string;
  ack: string;
  ackClass: string;
}

export interface DrawerLinkView {
  kind: string;
  ref: string;
  /**
   * Article → PLM part drawer, change request → Change control drawer; R-128: deliverable → Quality › Deliverables, purchase
   * order → Orders, punch item → the project's punch list row (`#punch-P-01`), each resolved in the record's own project.
   * Null (inert pill) for a QMS record or a reference not found there. Not gated by the viewer's screens: the target pages
   * apply their own rights and read-only banner, as for the article and change-request links.
   */
  href: string | null;
}

export interface DocDrawerView {
  number: string;
  revision: string;
  /** "Document record · PID-HLT-026 · rev D". */
  head: string;
  title: string;
  conf: string;
  confClass: string;
  status: string;
  statusClass: string;
  closeHref: string;
  /**
   * "Open in Codex" (R-033): the record in Codex, new tab — Codex's own link once the index read brought it, else Codex's
   * home (TODO(codex) D-1); null for the client role (no Codex access).
   */
  codexHref: string | null;
  /** R-127 (D-2 = a): "Earlier revisions and download log in Codex" under the current revision; null for the client role. */
  historyHref: string | null;
  /** "New revision · Codex" → the deposit hand-off in revision mode; null for read-only viewers. */
  newRevisionHref: string | null;
  /** "Approve in Codex · {role} · {approver}" when the viewer may record the next step, else null. */
  approveLabel: string | null;
  /** Delivery 7: the circuit as Keystone shows it ("Approved · Pending sync with Codex", "Awaiting PM validation"), translated; null when none. */
  circuitNote: string | null;
  /** "Withdrawal · rev C withdrawn automatically · 29 Sep" after a release that withdrew the previous revision. */
  withdrawal: string | null;
  identity: { k: string; v: string }[];
  tags: string[];
  /** The current revision only (D-2 = a, R-127). */
  revisions: DrawerRevisionView[];
  approvals: DrawerApprovalView[];
  distribution: DrawerDistributionView[];
  links: DrawerLinkView[];
}

export interface DrawerInput {
  /** Vault page the drawer sits on. */
  project: string;
  record: DocumentRecord;
  state: DocsState;
  viewer: ApproverViewer;
  /** Viewer may hand a new revision over (not outside / read-only). */
  canEdit: boolean;
}

/**
 * Link targets of a relation (`docLinks` 5047): article and change request as before; R-128 (D-2 context, 10 OQ15):
 * deliverable, purchase order and punch item through the target the DAL resolved in the record's own project.
 */
function linkHref(l: DocumentLinkRow, project: string): string | null {
  if (l.kind === 'article') return `${screenHref('plm')}?part=${encodeURIComponent(l.ref)}`;
  if (l.kind === 'change_request' && project !== QMS) return `${screenHref('changes', { code: project })}?cr=${encodeURIComponent(l.ref)}`;
  const x = l.target;
  if (!x) return null;
  if (x.screen === 'deliverable') return deliverableHref(x.project, x.ref);
  if (x.screen === 'order') return ordersHref(x.project, { po: x.ref });
  // The punch list of the project; the row carries id="punch-{number}" (site-quality lot, R-117).
  return `${itpHref(x.project, 'punch')}#punch-${encodeURIComponent(x.ref)}`;
}

export function drawerView({ project, record: r, state, viewer, canEdit }: DrawerInput, t: T, lang: Lang): DocDrawerView {
  const keep = keepQuery(state);
  const role = roleT(t, lang);
  const date = (iso: string) => t(shortDateOfIso(iso));
  const typeText = typeWithCode(t(r.typeLabel), r.type);
  const identity = [
    ['Number', r.number],
    ['Type', typeText],
    ['Family', t(r.familyLabel)],
    ['Project', t(projectText(r.project))],
    ['Service', t(r.serviceLabel)],
    ['Author', r.author],
    ['Confidentiality', t(r.confidentialityLabel)],
    ['Files', t(filesText(r.files))],
    ['Approval circuit', circuitT(r.circuit.map((c) => c.label), t, lang)],
    ['Retention', t(r.retention)],
    ['ISO process', t(r.isoClause)],
  ].map(([k, v]) => ({ k: t(k), v }));

  const revisions = r.revisions.map((x) => ({
    revision: x.revision,
    current: x.current,
    note: t(revisionNote({ revision: x.revision, current: x.current, withdrawnText: x.withdrawnOn ? shortDateOfIso(x.withdrawnOn) : null })),
    sub: [date(x.issuedOn), x.author, t(versionsText(x))].join(' · '),
    status: t(documentStatus.label(x.status)),
    statusClass: tag(DOCUMENT_STATUS_TAG[x.status]),
  }));

  // Delivery 7 (R-124): a step decided in Keystone shows the decision, its author and day, and its sync with Codex.
  const approvals = r.approvals.map((a) =>
    a.keystone
      ? {
          label: `${role(a.roleLabel)} · ${a.keystone.by}`,
          state: [t(codexDecision.label(a.keystone.decision)), date(a.keystone.on), t(codexSyncText(a.keystone.sync))].join(' · '),
          signed: false,
          pendingSync: true,
        }
      : {
          label: `${role(a.roleLabel)} · ${a.who}`,
          state: `${t(a.signed ? 'Signed' : 'Pending')} · ${a.signedOn ? date(a.signedOn) : '—'}`,
          signed: a.signed,
          pendingSync: false,
        },
  );

  const distribution = r.distribution.map((x) =>
    x.kind === 'client'
      ? {
          to: t(clientRecipientText(x.organisation, x.contact)),
          sub: `· rev ${x.revision} · ${date(x.date)}`,
          ack: t(x.acknowledgedOn ? `Acknowledged ${shortDateOfIso(x.acknowledgedOn)}` : 'Acknowledgment pending'),
          ackClass: tag(x.acknowledgedOn ? 'tag-neutral' : 'tag-accent'),
        }
      : { to: t(x.label), sub: `· rev ${x.revision} · ${date(x.date)}`, ack: t('Received'), ackClass: tag('tag-neutral') },
  );

  const mayApprove = canApproveDocument(viewer, r) && r.nextRoleLabel && r.nextApprover;
  // Clients have no Codex access: no link to Codex in their drawer (R-127; R-033 opens the record in Codex for the team).
  const client = viewer.role === 'client';
  const inCodex = client ? null : codexDocumentUrl(r.number, r.revision, r.codexUrl);
  return {
    number: r.number,
    revision: r.revision,
    head: `${t('Document record')} · ${r.number} · ${t(`rev ${r.revision}`)}`,
    title: exactT(r.title, lang),
    conf: t(confidentiality.label(r.confidentiality)),
    confClass: tag(CONFIDENTIALITY_TAG[r.confidentiality]),
    status: t(r.statusLabel),
    statusClass: tag(DOCUMENT_STATUS_TAG[r.status]),
    closeHref: documentsHref(project, keep),
    codexHref: inCodex,
    historyHref: inCodex,
    // R-047: a new revision is deposited by the team of the record's own project, from its vault (the page's `canEdit`).
    newRevisionHref: canEdit && r.project === project ? documentsHref(project, { ...keep, deposit: r.number }) : null,
    approveLabel: mayApprove ? approveLabelT(r.nextRoleLabel!, r.nextApprover!, t, lang) : null,
    circuitNote: r.circuitNote ? t(r.circuitNote) : null,
    withdrawal: r.withdrawal ? `${t('Withdrawal')} · ${t(`rev ${r.withdrawal.revision} withdrawn automatically · ${shortDateOfIso(r.withdrawal.on)}`)}` : null,
    identity,
    // `tagList = tags.split(' · ')`: a record without classification shows a single "—" pill.
    tags: r.tags.length ? r.tags.map((x) => exactT(x, lang)) : ['—'],
    revisions,
    approvals,
    distribution,
    // A client's relations stay inert: every target is an internal screen that sends the client home (P-1).
    links: r.links.map((l) => ({ kind: t(l.kindLabel), ref: l.ref, href: client ? null : linkHref(l, r.project) })),
  };
}

// ── Deposit hand-off ───────────────────────────────────────────────────────────────────────────────────

export interface DepositTypeView {
  code: string;
  label: string;
  /** "Material certificate (CER)". */
  typeText: string;
  circuit: string;
  retention: string;
  confidentiality: string;
  /** Number previewed by Codex for a new record of this type ("CER-HLT-042"). */
  number: string;
}

export interface DepositView {
  mode: 'new' | 'revision';
  /** Vault page (current project): the hand-off is checked against it. */
  page: string;
  /** Project code or "QMS" the record goes to. */
  project: string;
  projectText: string;
  /** New revision: the record handed back to Codex. */
  revision: { number: string; title: string; context: string; type: string } | null;
  /** Initial draft (type proposed, linked order / article from the context). */
  initial: { type: string; po: string; part: string };
  /** Chips "Type proposed · confirm or change" (deposit types; the record's own type in revision mode). */
  types: DepositTypeView[];
  /** Vault state to come back to (the drawer of the new record opens with it). */
  keep: DocsQuery;
  /** URL that closes the dialog. */
  closeHref: string;
}

export interface DepositInput {
  /** Vault page (current project). */
  project: string;
  docs: VaultDocument[];
  types: DocumentTypeRow[];
  depositTypes: readonly string[];
  state: DocsState;
  /** `?deposit=` value: "new" or the number of the record to revise. */
  deposit: string;
  /** Context of a new deposit (`?dtype=`, `?po=`, `?part=`). */
  context: { type: string | null; po: string | null; part: string | null };
}

/** Null when `?deposit=` names an unknown record. */
export function depositView(input: DepositInput, t: T, lang: Lang): DepositView | null {
  const { project, docs, types, depositTypes, state, deposit, context } = input;
  const keep = keepQuery(state);
  const typeByCode = new Map(types.map((x) => [x.code, x]));
  const typeView = (code: string, target: string, number?: string): DepositTypeView => {
    const ty = typeByCode.get(code)!;
    return {
      code, label: t(ty.label), typeText: typeWithCode(t(ty.label), code), circuit: circuitT(ty.circuit.map((c) => c.label), t, lang), retention: t(ty.retention),
      confidentiality: t(confidentiality.label(depositConfidentiality(ty.isClientDeliverable))), number: number ?? depositNumberPreview(docs, code, target),
    };
  };
  const closeHref = documentsHref(project, { ...keep, doc: state.doc });
  if (deposit !== 'new') {
    const doc = docs.find((d) => d.number === deposit);
    if (!doc || !typeByCode.has(doc.type)) return null;
    return {
      mode: 'revision',
      page: project,
      project: doc.project,
      projectText: t(projectText(doc.project)),
      revision: { number: doc.number, title: exactT(doc.title, lang), context: revisionContextT(revisionContextText(doc.number, doc.revision), lang), type: doc.type },
      // `openDep` from the drawer: type of the record, linked order = its first relation, no article.
      initial: { type: doc.type, po: doc.links[0]?.ref ?? '', part: '' },
      types: [{ ...typeView(doc.type, doc.project, doc.number), confidentiality: t(doc.confidentialityLabel) }],
      keep,
      closeHref,
    };
  }
  const codes = depositTypes.filter((c) => typeByCode.has(c));
  const type = context.type && codes.includes(context.type) ? context.type : codes.includes('CER') ? 'CER' : codes[0];
  return {
    mode: 'new',
    page: project,
    project,
    projectText: t(projectText(project)),
    revision: null,
    initial: { type, po: context.po ?? '', part: context.part ?? '' },
    types: codes.map((c) => typeView(c, project)),
    keep,
    closeHref,
  };
}

// ── Document types register ────────────────────────────────────────────────────────────────────────────

export interface DocTypeRowView {
  code: string;
  label: string;
  family: string;
  circuit: string;
  retention: string;
  iso: string;
  client: string;
  count: number;
}

export const docTypesView = (rows: DocumentTypeRow[], t: T, lang: Lang): DocTypeRowView[] =>
  rows.map((r) => ({
    code: r.code, label: t(r.label), family: t(r.familyLabel), circuit: circuitT(r.circuit.map((c) => c.label), t, lang), retention: t(r.retention),
    iso: t(r.isoClause), client: r.isClientDeliverable ? t('Yes') : '—', count: r.inCodex,
  }));
