// Documents — Codex index (docs/spec/10 §4–§5, template 2310–2383, logic 5019–5062): vault scope, saved views,
// family / status filters and search (`inScope`, `viewFilter`, `dvList`), chip counts, KPI tiles (`dvKpis`), the
// deposit hand-off (number preview `depNumber`, type detection, revision letters), the record drawer texts and who
// may approve a circuit step. Pure: the screen feeds the DAL rows (src/server/dal/documents.ts) and translates the
// English source strings with t().
import {
  AUDIT_VIEW_TYPES, DEPOSIT_TYPES, docFamily, docSavedView, documentStatus, type DocFamily, type DocSavedView, type DocumentStatus,
} from '@/server/db/codes';

export type { DocFamily, DocumentStatus };
export type DocView = DocSavedView;
/** Scope segment: "Current project" (its documents + the company QMS documents) or "All projects". */
export type DocScope = 'proj' | 'all';

/** Scope value of company quality-system documents (`proj: 'QMS'`), visible from every project. */
export const QMS = 'QMS';
/** Saved views, DOC_VIEWS order (3663). */
export const DOC_VIEWS: readonly DocView[] = docSavedView.codes;
/** Families, DOC_FAM order (3614). */
export const DOC_FAMILIES: readonly DocFamily[] = docFamily.codes;
/** Statuses, DOC_STATUSES order (3664). */
export const DOC_STATUSES: readonly DocumentStatus[] = documentStatus.codes;
/** Types offered by the deposit hand-off (5051), DOC_TYPES order. */
export const DEPOSIT_TYPE_CODES: readonly string[] = DEPOSIT_TYPES;
/** Type preselected by the deposit dialog (`dv.dep.type`, 3774). */
export const DEPOSIT_DEFAULT_TYPE = 'CER';

/** What the vault logic needs from a record (a subset of the DAL's VaultDocument). */
export interface VaultFacts {
  number: string;
  type: string;
  family: DocFamily;
  /** Project code or "QMS". */
  project: string;
  status: DocumentStatus;
  revision: string;
  /** Client-deliverable type and released. */
  shared: boolean;
  /** Shared and acknowledged by the client for the current revision. */
  acknowledged: boolean;
  /** Revisions withdrawn so far (obsolete revision rows). */
  withdrawnRevisions: number;
  /** Search fields (`id + title + tags + typeLabel + by`, EN source). */
  title: string;
  tagsText: string;
  typeLabel: string;
  author: string;
}

// ── URL state ──────────────────────────────────────────────────────────────────────────────────────────

export const parseScope = (v: string | null | undefined): DocScope => (v === 'all' ? 'all' : 'proj');
export const parseView = (v: string | null | undefined): DocView => (docSavedView.isCode(v) ? v : 'all');
export const parseFamily = (v: string | null | undefined): DocFamily | null => (docFamily.isCode(v) ? v : null);
export const parseStatus = (v: string | null | undefined): DocumentStatus | null => (documentStatus.isCode(v) ? v : null);

// ── Filters ────────────────────────────────────────────────────────────────────────────────────────────

/** `inScope` (5029): every record, or the project's own records plus the QMS documents. */
export function inScope<D extends Pick<VaultFacts, 'project'>>(docs: readonly D[], scope: DocScope, project: string): D[] {
  return scope === 'all' ? [...docs] : docs.filter((d) => d.project === project || d.project === QMS);
}

/** `viewFilter` (5030). "BPE dossier" keeps the current project's released records only (not the QMS ones). */
export function viewMatch(d: Pick<VaultFacts, 'type' | 'status' | 'project' | 'shared' | 'revision'>, view: DocView, project: string): boolean {
  switch (view) {
    case 'bpe':
      return d.status === 'released' && d.project === project;
    case 'audit':
      return AUDIT_VIEW_TYPES.includes(d.type) && d.status !== 'draft';
    case 'client':
      return d.shared;
    case 'pending':
      return d.status === 'release_proposed';
    case 'obsolete':
      return d.revision !== 'A';
    default:
      return true;
  }
}

/**
 * Search (`dvList` 5031): case-insensitive substring of `number title tags typeLabel author`. `display` adds the
 * texts shown to the viewer (French title and kind), so what the user reads also matches.
 */
export function queryMatch(d: Pick<VaultFacts, 'number' | 'title' | 'tagsText' | 'typeLabel' | 'author'>, q: string, display = ''): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return `${d.number} ${d.title} ${d.tagsText} ${d.typeLabel} ${d.author} ${display}`.toLowerCase().includes(needle);
}

export interface VaultQuery {
  scope: DocScope;
  /** Current project code. */
  project: string;
  view: DocView;
  family: DocFamily | null;
  status: DocumentStatus | null;
  q: string;
}

/** Records in scope and the filtered list (vault order: Keystone-created records first, then the Codex order). */
export function vaultList<D extends VaultFacts>(docs: readonly D[], query: VaultQuery, display?: (d: D) => string): { scoped: D[]; list: D[] } {
  const scoped = inScope(docs, query.scope, query.project);
  const list = scoped.filter(
    (d) =>
      viewMatch(d, query.view, query.project) &&
      (!query.family || d.family === query.family) &&
      (!query.status || d.status === query.status) &&
      queryMatch(d, query.q, display?.(d)),
  );
  return { scoped, list };
}

/** Saved-view chip counts over the records in scope (`dvViews`, family / status / search ignored). */
export const viewCounts = (scoped: readonly VaultFacts[], project: string): { view: DocView; count: number }[] =>
  DOC_VIEWS.map((view) => ({ view, count: scoped.filter((d) => viewMatch(d, view, project)).length }));

/** Family chips (`dvFam`): DOC_FAM order, families with at least one record in scope. */
export const familyCounts = (scoped: readonly Pick<VaultFacts, 'family'>[]): { family: DocFamily; count: number }[] =>
  DOC_FAMILIES.map((family) => ({ family, count: scoped.filter((d) => d.family === family).length })).filter((c) => c.count > 0);

/** Status chips (`dvSt`): DOC_STATUSES order, statuses present in scope. */
export const statusCounts = (scoped: readonly Pick<VaultFacts, 'status'>[]): { status: DocumentStatus; count: number }[] =>
  DOC_STATUSES.map((status) => ({ status, count: scoped.filter((d) => d.status === status).length })).filter((c) => c.count > 0);

// ── KPI tiles ──────────────────────────────────────────────────────────────────────────────────────────

export interface VaultKpi {
  /** EN source strings. */
  label: string;
  value: number;
  sub: string;
  /** Value in the attention colour (LO). */
  alert: boolean;
}

/**
 * `dvKpis` (5039). "Obsolete revisions withdrawn" counts the withdrawn revision records (the prototype summed the
 * revision letters, 10 OQ16 / 00 §7.16 — identical on the seed, where each earlier revision is withdrawn).
 */
export function vaultKpis(scoped: readonly VaultFacts[]): VaultKpi[] {
  const proposed = scoped.filter((d) => d.status === 'release_proposed').length;
  const pendingAck = scoped.filter((d) => d.shared && !d.acknowledged).length;
  return [
    { label: 'Documents in scope', value: scoped.length, sub: `${scoped.filter((d) => d.status === 'released').length} released`, alert: false },
    { label: 'Awaiting approval', value: proposed, sub: 'circuit defined by document type', alert: proposed > 0 },
    { label: 'Client acknowledgments pending', value: pendingAck, sub: `${scoped.filter((d) => d.shared).length} shared with client`, alert: pendingAck > 0 },
    { label: 'Obsolete revisions withdrawn', value: scoped.reduce((s, d) => s + d.withdrawnRevisions, 0), sub: 'automatic on release of the next revision', alert: false },
  ];
}

/** Vault card title count `dvCount`: "38 / 40 documents". */
export const countText = (shown: number, total: number) => `${shown} / ${total} documents`;

/** Sidebar badge (`navDocs` 5150): records awaiting approval, all projects; empty when none. */
export const docsBadgeText = (n: number) => (n > 0 ? String(n) : '');

// ── Revisions ──────────────────────────────────────────────────────────────────────────────────────────

/** 0 for A, 3 for D. */
export const revisionIndex = (rev: string) => rev.charCodeAt(0) - 65;
/** Letter of the next revision ("D" → "E"); null after Z. */
export const nextRevision = (rev: string): string | null => (rev >= 'A' && rev < 'Z' ? String.fromCharCode(rev.charCodeAt(0) + 1) : null);
/** Letter of the previous revision ("D" → "C"); null for A. */
export const previousRevision = (rev: string): string | null => (rev > 'A' && rev <= 'Z' ? String.fromCharCode(rev.charCodeAt(0) - 1) : null);

/** Revision row note (`docRevs` 5041): "First issue" / "Rev D · changes recorded in transmittal" / "Withdrawn 2 Sep". */
export function revisionNote(r: { revision: string; current: boolean; withdrawnText: string | null }): string {
  if (!r.current) return r.withdrawnText ? `Withdrawn ${r.withdrawnText}` : 'Withdrawn';
  return r.revision === 'A' ? 'First issue' : `Rev ${r.revision} · changes recorded in transmittal`;
}

/**
 * Working versions of a revision: the current revision shows its last working version ("D.3"; the prototype printed
 * the literal "A.3" whatever the revision), earlier ones their count ("2 working versions").
 */
export const versionsText = (r: { revision: string; current: boolean; workingVersions: number }) =>
  r.current ? `${r.revision}.${r.workingVersions}` : `${r.workingVersions} working versions`;

// ── Approval circuit ───────────────────────────────────────────────────────────────────────────────────

export interface ApproverViewer {
  /** "G. Comte" — the form approvers are named in (DOC_WHO). */
  short: string;
  role: string;
}

/**
 * Who may record the next circuit step ("Approve in Codex · {role} · {approver}"). The prototype let any persona
 * approve any step (10 OQ12, P-7); here the named approver of the step does, and the portfolio director may sign on
 * their behalf (steps whose approver is not a Keystone user, e.g. L. Fabre). The button names the step either way.
 */
export function canApproveDocument(viewer: ApproverViewer, d: { canApprove: boolean; nextApprover: string | null }): boolean {
  if (!d.canApprove) return false;
  return viewer.role === 'director' || (!!d.nextApprover && d.nextApprover === viewer.short);
}

/** "Approve in Codex · Quality manager · G. Comte" (`approveLabel`), role and name as given. */
export const approveLabelText = (roleLabel: string, approver: string) => `Approve in Codex · ${roleLabel} · ${approver}`;

// ── Deposit hand-off ───────────────────────────────────────────────────────────────────────────────────

/** Codex project code of a number: "QMS" or the prefix of the project code (HLT-026 → HLT). */
export const codexProjectCode = (project: string) => (project === QMS ? QMS : project.split('-')[0]);

/**
 * Number previewed for a new document (`depNumber` 5050): `TYPE-PROJ-SEQ`, SEQ = (records of the type in the
 * project) + 40, 3 digits — the next free number when that one is taken (the prototype could collide).
 */
export function depositNumberPreview(docs: readonly Pick<VaultFacts, 'number' | 'type' | 'project'>[], type: string, project: string): string {
  const taken = new Set(docs.map((d) => d.number));
  for (let seq = docs.filter((d) => d.type === type && d.project === project).length + 40; ; seq++) {
    const n = `${type}-${codexProjectCode(project)}-${String(seq).padStart(3, '0')}`;
    if (!taken.has(n)) return n;
  }
}

/** Context banner of a new revision (`ctx` 5047): "PID-HLT-026 · new revision E". */
export const revisionContextText = (number: string, revision: string) => {
  const next = nextRevision(revision);
  return next ? `${number} · new revision ${next}` : `${number} · new revision`;
};

/** Keywords of the file-name type detection, checked in order (French and English file names). */
const DETECT: readonly [string, RegExp][] = [
  ['PHO', /\.(jpe?g|png|heic|webp)$/],
  ['CER', /certifica(t|te)[\s_-]*(mati|3\.1|material|matl)|\b3\.1\b|\bmtc\b|material[\s_-]*cert|coul[ée]e|\bheat\b/],
  ['NCR', /\bncr\b|\bnc\b|non[\s_-]*conform/],
  ['COC', /\bcoc\b|conformit|certificate[\s_-]*of[\s_-]*conform|\bcdc\b/],
  ['PV', /\bpv\b|proc[eè]s[\s_-]*verbal|acceptance|r[ée]ception/],
  ['MIN', /\bmin(utes)?\b|\bcr[\s_-]*r[ée]union|compte[\s_-]*rendu|meeting/],
  ['LET', /\blet(ter)?\b|lettre|courrier|correspond/],
  ['REC', /\brec(ord)?\b|enregistrement|calibrat|[ée]talonnage|inspection[\s_-]*record/],
  ['RPT', /\brpt\b|report|rapport|\bfat\b|\bsat\b|essai|\btest/],
  ['PHO', /photo|\bimg\b/],
];

/**
 * Type proposed from a file name (`dep.detected` "Type detected from file name · …", 10 §4.6): the first deposit
 * type whose keywords match, else null (the dialog then keeps the proposed type). The prototype's demo file
 * "Certificat_3.1_S355_coulee_7781.pdf" → CER.
 */
export function detectDocType(fileName: string): string | null {
  const s = fileName
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .trim();
  if (!s) return null;
  for (const [code, re] of DETECT) if (re.test(s)) return code;
  return null;
}

/** Title proposed from a file name: extension dropped, "_" runs → spaces ("Rapport_FAT_lot-2.pdf" → "Rapport FAT lot-2"). */
export function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Linked to" summary row: "PO-2026-118 · CR-RAIL-A100" or "—". */
export const linkedToText = (po: string, part: string) => [po.trim(), part.trim()].filter(Boolean).join(' · ') || '—';

/** Confidentiality of a new record: Client when the type is a client deliverable, else Internal (`depMeta` 5053). */
export const depositConfidentiality = (isClientDeliverable: boolean): 'client' | 'internal' => (isClientDeliverable ? 'client' : 'internal');

export const DEPOSIT_TITLE_MAX = 160;
export const DEPOSIT_REF_MAX = 60;

export interface DepositDraft {
  /** Project code or "QMS". */
  project: string;
  type: string;
  title: string;
  po: string;
  part: string;
  /** Existing document number (new revision) or null (new document). */
  revisionOf: string | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validates a deposit sent by the dialog (strings only; a forged payload gets the validation message). A new document
 * needs one of the deposit types and a title; a new revision keeps the record's type and title.
 */
export function parseDeposit(raw: unknown, knownTypes: readonly string[] = DEPOSIT_TYPE_CODES): ParseResult<DepositDraft> {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  const project = str('project');
  if (!project) return { ok: false, error: 'Invalid request' };
  const revisionOf = str('revisionOf') || null;
  const po = str('po');
  const part = str('part');
  if (po.length > DEPOSIT_REF_MAX || part.length > DEPOSIT_REF_MAX) return { ok: false, error: 'Reference too long' };
  if (revisionOf) return { ok: true, value: { project, type: str('type'), title: '', po, part, revisionOf } };
  const type = str('type');
  if (!knownTypes.includes(type)) return { ok: false, error: 'Unknown document type' };
  const title = str('title').replace(/\s+/g, ' ');
  if (!title) return { ok: false, error: 'Title is required' };
  if (title.length > DEPOSIT_TITLE_MAX) return { ok: false, error: 'Title too long' };
  return { ok: true, value: { project, type, title, po, part, revisionOf: null } };
}

/**
 * Records linked to a reference (`partDocs` 5062, PLM part drawer "Documents linked to this article"): a relation to
 * it, or the reference among the tags (the prototype matched a substring of the tags string; whole tags here).
 */
export function documentsLinkedTo<D extends { tags: readonly string[]; links: readonly { ref: string }[] }>(docs: readonly D[], ref: string): D[] {
  return docs.filter((d) => d.links.some((l) => l.ref === ref) || d.tags.includes(ref));
}

// ── Record drawer ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Identity / deposit "Type" value `{label} ({code})` ("Material certificate (CER)"). A label that already ends with
 * its code keeps it once: "Acceptance minutes (PV)", FR "Schéma de procédé (PFD)" (the prototype printed
 * "Acceptance minutes (PV) (PV)").
 */
export const typeWithCode = (label: string, code: string) => (label.endsWith(`(${code})`) ? label : `${label} (${code})`);

/** Identity "Project" value: "QMS — transverse" for company documents. */
export const projectText = (project: string) => (project === QMS ? 'QMS — transverse' : project);
/** Identity "Files" value: "JPG ×12" for site photos, else "Native + PDF". */
export const filesText = (files: 'photos' | 'native_pdf') => (files === 'photos' ? 'JPG ×12' : 'Native + PDF');
/** Client distribution row: "Client — Port authority · N. Bensaïd" (no contact → organisation only). */
export const clientRecipientText = (organisation: string, contact: string | null) => (contact ? `Client — ${organisation} · ${contact}` : `Client — ${organisation}`);
/** Selection bar "3 selected". */
export const selectedText = (n: number) => `${n} selected`;
