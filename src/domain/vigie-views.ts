// D12 / D13 (Vigie): the rows of Vigie's publications on the shared PostgreSQL server, as `select to_jsonb(v)` returns them, checked
// and turned into the records the mirrors take (src/server/integrations/vigie). Pure: no database, no clock.
//   vigie.pub_non_conformites      project NCRs (D13; number = Vigie's EV-… reference since CV-07)
//   vigie.pub_hse_projet           the site HSE register of each Keystone project (D13)
//   vigie.pub_ordres_modification  engineering change orders (D12), with pub_eco_approbations and pub_eco_effectivite
//   vigie.pub_demandes_recues      the processing state of the requests Keystone deposited (D13 CV-08, Matrix's publication)
// A malformed row (key missing, unknown code) is skipped and counted, never stored — as the capex connector does (capex-needs.ts).
// Column names: the publications' contracts (Matrix's data/publications-depot.json; Vigie's migrations 0009 and 0026).
import type {
  EcoApproverKey, EcoDecision, EcoDisposition, EcoStatus, EcoTargetType, EcoType, HseItemKind, HseStatus, Interchangeability, NcrSeverity, NcrSource,
  NcrStatus, VigieRequestOutcome, VigieResultCode,
} from '@/server/db/codes';
import type { VigieEcoRecord, VigieHseRecord, VigieNcrRecord } from '@/server/integrations/vigie/types';

type Row = Record<string, unknown>;

/** Vigie's NCR reference (CV-07): "EV-2026-130" — the format vigie.pub_signaler_avancement_nc accepts. */
export const VIGIE_NCR_NUMBER_RE = /^EV-\d{4}-\d{1,9}$/;
/** Vigie's ECO number: "ECO-2026-015" — the format vigie.pub_signaler_avancement_eco accepts. */
export const VIGIE_ECO_NUMBER_RE = /^ECO-\d{4}-\d{3,9}$/;

const NCR_SEVERITIES: readonly NcrSeverity[] = ['minor', 'major', 'critical'];
const NCR_SOURCES: readonly NcrSource[] = ['site_inspection', 'goods_receipt', 'survey', 'workshop', 'client', 'audit', 'design'];
const NCR_STATUSES: readonly NcrStatus[] = ['open', 'containment', 'root_cause', 'corrective_action', 'verification', 'closed'];
const HSE_KINDS: readonly HseItemKind[] = ['prevention_plan', 'induction', 'permit', 'register'];
const HSE_STATUSES: readonly HseStatus[] = ['signed', 'ready', 'pending', 'recorded'];
const ECO_TYPES: readonly EcoType[] = ['rev', 'sub', 'asm', 'sup', 'obs'];
const ECO_STATUSES: readonly EcoStatus[] = ['draft', 'impact_analysis', 'in_approval', 'released', 'rejected'];
const ECO_KEYS: readonly EcoApproverKey[] = ['englead', 'quality', 'pm'];
const ECO_DECISIONS: readonly EcoDecision[] = ['pending', 'ok', 'rejected'];
const DISPOSITIONS: readonly EcoDisposition[] = ['update', 'pinned', 'retrofit', 'na'];
const TARGET_TYPES: readonly EcoTargetType[] = ['project', 'machine'];
const OUTCOMES: readonly VigieRequestOutcome[] = ['received', 'applied', 'rejected'];
const RESULT_CODES: readonly VigieResultCode[] = ['stale', 'refused', 'not_found', 'invalid'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown, max = 2000): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
/** Text kept as published (empty allowed): root cause, action, stock impact… */
const text = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const isoDate = (v: unknown): string | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
};
const isoInstant = (v: unknown): string | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const numberOf = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const oneOf = <T extends string>(v: unknown, codes: readonly T[]): T | null => (typeof v === 'string' && (codes as readonly string[]).includes(v) ? (v as T) : null);
/** A text array (`text[]` arrives as a JSON array; a string is tolerated as a one-element list). */
const list = (v: unknown, max = 200): string[] => {
  const xs = Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : [];
  return xs.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, max));
};

// ── NCRs (D13) ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** One row of vigie.pub_non_conformites, or null when malformed (number not an EV-… reference, unknown code, no project). */
export function parseNcrRow(r: Row): VigieNcrRecord | null {
  const projectCode = str(r.project_code, 64);
  const number = str(r.number, 64);
  const severity = oneOf(r.severity, NCR_SEVERITIES);
  const source = oneOf(r.source, NCR_SOURCES);
  const status = oneOf(r.status, NCR_STATUSES);
  const raisedOn = isoDate(r.raised_on);
  if (!projectCode || !number || !VIGIE_NCR_NUMBER_RE.test(number) || !severity || !source || !status || !raisedOn) return null;
  const supplierId = str(r.supplier_id, 64);
  return {
    projectCode, number, vigieRef: str(r.vigie_ref, 64) ?? number, title: str(r.title, 300) ?? number, severity, source, status,
    activityCode: str(r.activity_code, 64), partRef: str(r.part_ref, 64), deliverableNumber: str(r.deliverable_number, 64), supplierName: str(r.supplier_name, 200),
    inspectionNumber: null, raisedBy: str(r.raised_by_name, 200) ?? 'Anonyme', raisedOn, owner: str(r.owner_name, 200) ?? '—', rootCause: text(r.root_cause),
    action: text(r.action), dueOn: isoDate(r.due_on), costKeur: numberOf(r.cost_keur) ?? 0, isoClause: text(r.iso_clause, 200), updatedAt: isoInstant(r.vigie_updated_at),
    closedOn: isoDate(r.closed_on), supplierId: supplierId && UUID_RE.test(supplierId) ? supplierId : null, ownerMatricule: str(r.owner_matricule, 20),
  };
}

// ── Site HSE (D13) ───────────────────────────────────────────────────────────────────────────────────────────────────

/** One row of vigie.pub_hse_projet, or null when malformed. `position` orders a project's register. */
export function parseHseRow(r: Row): (VigieHseRecord & { position: number }) | null {
  const projectCode = str(r.project_code, 64);
  const kind = oneOf(r.kind, HSE_KINDS);
  const status = oneOf(r.status, HSE_STATUSES);
  const title = str(r.title, 300);
  if (!projectCode || !kind || !status || !title) return null;
  return {
    projectCode, vigieRef: str(r.vigie_ref, 64), kind, title, status, statusText: str(r.status_text, 200), dateOn: isoDate(r.date_on),
    position: numberOf(r.position) ?? 0,
  };
}

/** The HSE register rows in each project's order (project code, then Vigie's position). */
export function hseRecordsOf(rows: readonly Row[]): { records: VigieHseRecord[]; skipped: number } {
  const parsed = rows.map(parseHseRow);
  const ok = parsed.filter((x): x is VigieHseRecord & { position: number } => !!x)
    .sort((a, b) => a.projectCode.localeCompare(b.projectCode) || a.position - b.position);
  return { records: ok.map((x) => { const rec: VigieHseRecord & { position?: number } = { ...x }; delete rec.position; return rec; }), skipped: rows.length - ok.length };
}

/** The NCR rows, one per number (Vigie's reference is unique, CV-07; a duplicate counts as skipped, the last row read wins). */
export function ncrRecordsOf(rows: readonly Row[]): { records: VigieNcrRecord[]; skipped: number } {
  const byNumber = new Map<string, VigieNcrRecord>();
  for (const r of rows.map(parseNcrRow)) if (r) byNumber.set(r.number, r);
  const records = [...byNumber.values()].sort((a, b) => a.projectCode.localeCompare(b.projectCode) || a.raisedOn.localeCompare(b.raisedOn) || a.number.localeCompare(b.number));
  return { records, skipped: rows.length - byNumber.size };
}

// ── Change orders (D12) ──────────────────────────────────────────────────────────────────────────────────────────────

type EcoApprovalRecord = VigieEcoRecord['approvals'][number];
type EcoTargetRecord = VigieEcoRecord['effectivity'][number];

function parseApprovalRow(r: Row): (EcoApprovalRecord & { eco: string }) | null {
  const eco = str(r.eco_number, 64);
  const key = oneOf(r.approval_key, ECO_KEYS);
  const decision = oneOf(r.decision, ECO_DECISIONS);
  if (!eco || !key || !decision) return null;
  return { eco, key, decision, approver: str(r.approver_text, 300) ?? '—', decidedBy: str(r.decided_by_name, 200), decidedAt: isoInstant(r.decided_at) };
}

function parseTargetRow(r: Row): (EcoTargetRecord & { eco: string; position: number }) | null {
  const eco = str(r.eco_number, 64);
  const targetType = oneOf(r.target_type, TARGET_TYPES);
  const targetRef = str(r.target_ref, 64);
  if (!eco || !targetType || !targetRef) return null;
  return {
    eco, targetType, targetRef, label: str(r.label, 300) ?? targetRef, disposition: oneOf(r.disposition, DISPOSITIONS), isAutomatic: r.is_automatic === true,
    note: str(r.note, 2000), fittedPartRef: str(r.fitted_part_ref, 64), fittedRevision: str(r.fitted_revision, 20), position: numberOf(r.position) ?? 0,
  };
}

/** One row of vigie.pub_ordres_modification, with its approvals and effectivity, or null when malformed. */
export function parseEcoRow(r: Row, approvals: readonly EcoApprovalRecord[] = [], effectivity: readonly EcoTargetRecord[] = []): VigieEcoRecord | null {
  const number = str(r.number, 64);
  const type = oneOf(r.eco_type, ECO_TYPES);
  const status = oneOf(r.status, ECO_STATUSES);
  const raisedOn = isoDate(r.raised_on);
  if (!number || !VIGIE_ECO_NUMBER_RE.test(number) || !type || !status || !raisedOn) return null;
  return {
    number, title: str(r.title, 300) ?? number, type, status, interchangeability: oneOf<Interchangeability>(r.interchangeability, ['yes', 'no']),
    fromRevision: str(r.from_revision, 64) ?? '', toRevision: str(r.to_revision, 64) ?? '', costEur: numberOf(r.cost_eur) ?? 0,
    scheduleDays: Math.round(numberOf(r.schedule_days) ?? 0), stockImpact: text(r.stock_impact), documentRefs: list(r.document_refs, 300),
    requestedBy: str(r.requested_by_name, 200) ?? '—', raisedOn, pendingDispositions: Math.max(0, Math.round(numberOf(r.pending_dispositions) ?? 0)),
    locked: r.locked === true, parts: [...new Set(list(r.parts, 64))], projects: [...new Set(list(r.projects, 64))],
    approvals: ECO_KEYS.flatMap((k) => approvals.filter((a) => a.key === k).slice(-1)),
    effectivity: [...effectivity], updatedAt: isoInstant(r.vigie_updated_at), releasedAt: isoInstant(r.released_at),
  };
}

/** The ECO records of the three views (approvals and effectivity joined by ECO number), in number order. */
export function ecoRecordsOf(raw: { orders: readonly Row[]; approvals: readonly Row[]; effectivity: readonly Row[] }): { records: VigieEcoRecord[]; skipped: number } {
  const appr = raw.approvals.map(parseApprovalRow);
  const eff = raw.effectivity.map(parseTargetRow);
  const apprBy = new Map<string, EcoApprovalRecord[]>();
  for (const a of appr) if (a) apprBy.set(a.eco, [...(apprBy.get(a.eco) ?? []), { key: a.key, decision: a.decision, approver: a.approver, decidedBy: a.decidedBy, decidedAt: a.decidedAt }]);
  const effBy = new Map<string, (EcoTargetRecord & { position: number })[]>();
  for (const t of eff) if (t) { const { eco, ...rest } = t; effBy.set(eco, [...(effBy.get(eco) ?? []), rest]); }
  const byNumber = new Map<string, VigieEcoRecord>();
  for (const r of raw.orders) {
    const n = str(r.number, 64) ?? '';
    const targets = (effBy.get(n) ?? []).sort((a, b) => a.position - b.position).map((x) => { const t: EcoTargetRecord & { position?: number } = { ...x }; delete t.position; return t; });
    const rec = parseEcoRow(r, apprBy.get(n) ?? [], targets);
    if (rec) byNumber.set(rec.number, rec);
  }
  const records = [...byNumber.values()].sort((a, b) => a.number.localeCompare(b.number));
  const skipped = raw.orders.length - byNumber.size + appr.filter((a) => !a).length + eff.filter((t) => !t).length;
  return { records, skipped };
}

// ── Requests deposited by Keystone (D13 CV-08: vigie.pub_demandes_recues) ─────────────────────────────────────────────

/** The processing state of one request, by Keystone's own id (`id_externe` = the outbox entry's id). */
export interface VigieRequestState {
  /** Vigie's request number (the value the function returned). */
  id: string;
  externalId: string;
  outcome: VigieRequestOutcome;
  resultCode: VigieResultCode | null;
  result: string | null;
  processedAt: string | null;
}

/** One row of vigie.pub_demandes_recues, or null when malformed. */
export function parseRequestRow(r: Row): VigieRequestState | null {
  const externalId = str(r.id_externe, 100);
  const outcome = oneOf(r.statut, OUTCOMES);
  const id = numberOf(r.id);
  if (!externalId || !outcome || id == null) return null;
  return { id: String(id), externalId, outcome, resultCode: oneOf(r.code_resultat, RESULT_CODES), result: str(r.resultat, 500), processedAt: isoInstant(r.traite_le) };
}
