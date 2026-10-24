// R-187 (Arche K-02, K-03, K-10): the subsidiaries' machine needs and Keystone's answers. Pure rules — no import of the server:
// the capex connector (src/server/integrations/capex/), the DAL (src/server/dal/capex-needs.ts), the Server Functions and the
// "Subsidiaries' machine needs" card of Portfolio › Projects share them.
//
//   Mirror     Arche (the CAPEX application) publishes arche.pub_capex and arche.pub_besoins_machines (contracts in Arche's
//              docs/CONTRATS.md § 3). Keystone keeps a read-only copy (capex_mirror, capex_needs), replaced by each read of the
//              source; `parseCapexRow` / `parseNeedRow` check every row read (a malformed row is skipped and counted).
//   Answers    Keystone's answer to a need (need_answers), published to Arche by keystone.pub_reponses_besoins (K-02, one row per
//              answer, the most recent is authoritative): nature, qualification, reason, estimate class and range (K-03), lead time,
//              validity, Codex document reference, project created at the order (K-10), status.
//   Order      A need Arche marks `ordered` (G2 of its CAPEX) lets the director create the EPC2i project with the need's equipment
//              line, or add the line to an existing project — always a person's action, never automatic.
import type { RoleKey } from '@/config/screens';
import { ESTIMATE_CLASSES, estimateRange, isEstimateClass, offerClassError, type EstimateClass, type OfferNature } from './estimate-class';

export type { OfferNature };

// ── Arche's views (read-only mirror) ─────────────────────────────────────────────────────────────────────────────────

/** `statut` of arche.pub_besoins_machines (drafts are never published by Arche). */
export type NeedStatus = 'submitted' | 'withdrawn' | 'ordered';
export const NEED_STATUSES: readonly NeedStatus[] = ['submitted', 'withdrawn', 'ordered'];
/** EN source labels (t()). */
export const NEED_STATUS_LABEL: Record<NeedStatus, string> = { submitted: 'Submitted', withdrawn: 'Withdrawn by the subsidiary', ordered: 'Ordered' };

/** Arche's keys (Arche decision N-9; same formats as projects.capex_code / besoin_ref, src/domain/capex-link.ts). */
export const CAPEX_CODE_RE = /^CPX-[A-Z]{3}-\d{4}-\d{2,}$/;
export const NEED_REF_RE = /^CPX-[A-Z]{3}-\d{4}-\d{2,}\/B\d{2,}$/;

/** A CAPEX as Keystone mirrors it (arche.pub_capex; the sponsor's and the lead's e-mails are not kept). */
export interface CapexRecord {
  code: string;
  subsidiaryCode: string | null;
  subsidiaryName: string | null;
  zone: string | null;
  site: string | null;
  countryIso2: string | null;
  title: string;
  investmentType: string | null;
  status: string | null;
  phaseCode: string | null;
  typology: string | null;
  sponsorName: string | null;
  leadName: string | null;
  g1On: string | null;
  g2On: string | null;
  g3On: string | null;
  commissioningOn: string | null;
  /** `maj_le` at the source (ISO timestamp). */
  sourceUpdatedAt: string | null;
}

/** A machine need as Keystone mirrors it (arche.pub_besoins_machines). */
export interface NeedRecord {
  needRef: string;
  capexCode: string;
  line: string;
  catalogueCode: string | null;
  catalogueVersion: number | null;
  freeLabel: string | null;
  quantity: number;
  /** Codes of the catalogue options chosen. */
  options: string[];
  targetCapacity: number | null;
  capacityUnit: string | null;
  neededOn: string | null;
  site: string | null;
  status: NeedStatus;
  comment: string | null;
  submittedAt: string | null;
  orderedOn: string | null;
  sourceUpdatedAt: string | null;
}

type Row = Record<string, unknown>;

const str = (v: unknown, max = 2000): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
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

/** One row of arche.pub_capex (as `to_jsonb(v)` returns it), or null when its key is missing or malformed. */
export function parseCapexRow(r: Row): CapexRecord | null {
  const code = str(r.code, 40);
  if (!code || !CAPEX_CODE_RE.test(code)) return null;
  return {
    code, subsidiaryCode: str(r.filiale_code, 10), subsidiaryName: str(r.filiale, 200), zone: str(r.zone, 80), site: str(r.site, 200),
    countryIso2: str(r.pays_iso2, 2), title: str(r.intitule, 300) ?? code, investmentType: str(r.type_investissement, 40), status: str(r.statut, 40),
    phaseCode: str(r.phase_code, 40), typology: str(r.typologie, 40), sponsorName: str(r.sponsor_nom, 200), leadName: str(r.chef_projet_nom, 200),
    g1On: isoDate(r.g1_le), g2On: isoDate(r.g2_le), g3On: isoDate(r.g3_le), commissioningOn: isoDate(r.debut_mes_le), sourceUpdatedAt: isoInstant(r.maj_le),
  };
}

/** Option codes of a need (`options` jsonb: an array of codes; objects with a `code` are accepted too). */
function optionCodes(v: unknown): string[] {
  const list = typeof v === 'string' ? (() => { try { return JSON.parse(v) as unknown; } catch { return []; } })() : v;
  if (!Array.isArray(list)) return [];
  const codes = list.map((o) => (typeof o === 'string' ? o : o && typeof o === 'object' && typeof (o as Row).code === 'string' ? (o as Row).code as string : null));
  return [...new Set(codes.filter((c): c is string => !!c && !!c.trim()).map((c) => c.trim().slice(0, 40)))].slice(0, 20);
}

/** One row of arche.pub_besoins_machines, or null when it is malformed (key, CAPEX, quantity or status). */
export function parseNeedRow(r: Row): NeedRecord | null {
  const needRef = str(r.besoin_ref, 50);
  const capexCode = str(r.capex_code, 40);
  if (!needRef || !NEED_REF_RE.test(needRef) || !capexCode || !needRef.startsWith(`${capexCode}/`)) return null;
  const quantity = numberOf(r.quantite);
  if (quantity == null || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) return null;
  const status = str(r.statut, 20);
  if (!status || !(NEED_STATUSES as readonly string[]).includes(status)) return null;
  const catalogueCode = str(r.catalogue_code, 30);
  const version = numberOf(r.catalogue_version);
  const catalogueVersion = catalogueCode && version != null && Number.isInteger(version) && version >= 1 ? version : null;
  const capacity = numberOf(r.capacite_visee);
  return {
    needRef, capexCode, line: str(r.ligne, 10) ?? needRef.slice(capexCode.length + 1), catalogueCode: catalogueVersion ? catalogueCode : null, catalogueVersion,
    freeLabel: str(r.libelle_libre, 300), quantity, options: optionCodes(r.options), targetCapacity: capacity != null && capacity > 0 ? capacity : null,
    capacityUnit: str(r.unite_capacite, 20), neededOn: isoDate(r.date_besoin), site: str(r.site, 200), status: status as NeedStatus, comment: str(r.commentaire),
    submittedAt: isoInstant(r.soumis_le), orderedOn: isoDate(r.commande_le), sourceUpdatedAt: isoInstant(r.maj_le),
  };
}

// ── Rights ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Who reads the "Subsidiaries' machine needs" card (architecture R-187: the director and the project managers — the roles with
 * Portfolio › Projects in their workspace). Never the client; Finance does not have the Projects register.
 */
export const CAPEX_NEED_READERS: readonly RoleKey[] = ['director', 'pm'];
/** Who answers a need and creates the project at the order: the portfolio director (EPC2i's commercial commitment). */
export const CAPEX_NEED_WRITERS: readonly RoleKey[] = ['director'];
export const canReadCapexNeeds = (role: string) => (CAPEX_NEED_READERS as readonly string[]).includes(role);
export const canAnswerCapexNeeds = (role: string) => (CAPEX_NEED_WRITERS as readonly string[]).includes(role);
export const CAPEX_NEEDS_DIRECTOR_ONLY = 'Only the portfolio director answers the subsidiaries’ machine needs';

// ── Answers (pub_reponses_besoins, K-02 / K-03) ─────────────────────────────────────────────────────────────────────

export const ANSWER_NATURES: readonly OfferNature[] = ['qualification', 'indicatif', 'devis', 'offre_ferme'];
export const ANSWER_NATURE_LABEL: Record<OfferNature, string> = {
  qualification: 'Qualification', indicatif: 'Indicative price', devis: 'Quote', offre_ferme: 'Firm offer',
};

export type Qualification = 'faisable' | 'a_etudier' | 'refuse';
export const QUALIFICATIONS: readonly Qualification[] = ['faisable', 'a_etudier', 'refuse'];
export const QUALIFICATION_LABEL: Record<Qualification, string> = { faisable: 'Feasible', a_etudier: 'To be studied', refuse: 'Declined' };

export type AnswerStatus = 'en_cours' | 'remise' | 'acceptee' | 'caduque';
export const ANSWER_STATUSES: readonly AnswerStatus[] = ['en_cours', 'remise', 'acceptee', 'caduque'];
export const ANSWER_STATUS_LABEL: Record<AnswerStatus, string> = { en_cours: 'In preparation', remise: 'Sent to the subsidiary', acceptee: 'Accepted by the subsidiary', caduque: 'Lapsed' };

export const MAX_ANSWER_REASON = 1000;
export const MAX_DOCUMENT_REF = 80;
export const MAX_LEAD_TIME_WEEKS = 520;
export const MAX_ANSWER_KEUR = 1_000_000;
/** A Codex document reference ("OFF-CPX-SAI-2026-01-003", "DEV-2026-014"): letters, digits, dots, dashes, underscores, slashes. */
export const DOCUMENT_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,79}$/;

/** A priced nature carries an amount and its estimate class (K-03); a qualification carries neither. */
export const isPricedNature = (n: OfferNature) => n !== 'qualification';

/** The values of an answer as stored (amounts in k€, the range computed from the class). */
export interface NeedAnswerInput {
  nature: OfferNature;
  qualification: Qualification;
  reason: string | null;
  estimateClass: EstimateClass | null;
  centralKeur: number | null;
  lowKeur: number | null;
  highKeur: number | null;
  leadTimeWeeks: number | null;
  validUntil: string | null;
  documentRef: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : null);
function typedNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const s = v.trim().replace(/\s/g, '').replace(',', '.');
  return s === '' ? null : Number(s);
}
const validIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/**
 * Validates an answer typed by the director (strings from the form, or values). Messages are English source strings.
 * - nature among the four (K-02); qualification among the three; a priced answer is never "declined", a firm offer is feasible;
 * - reason required for "to be studied" and "declined";
 * - a priced answer needs a positive central amount and its class (`offerClassError`: a firm offer is E10, K-03); the low and high
 *   amounts are computed from the class (`estimateRange`, never typed); a qualification carries no amount nor class;
 * - lead time 1–520 weeks, validity a date (not before `today` when given), Codex reference in Codex's format.
 * What a firm offer or a quote needs before it is sent (validity, lead time, document) is `sendBlocker`'s.
 */
export function parseNeedAnswer(input: Record<string, unknown> | null | undefined, today: string): Parsed<NeedAnswerInput> {
  const v = input ?? {};
  const nature = text(v.nature);
  if (!nature || !(ANSWER_NATURES as readonly string[]).includes(nature)) return { ok: false, error: 'Choose the nature of the answer' };
  const n = nature as OfferNature;
  const q = text(v.qualification) || (isPricedNature(n) ? 'faisable' : '');
  if (!q || !(QUALIFICATIONS as readonly string[]).includes(q)) return { ok: false, error: 'Choose the qualification of the need' };
  const qualification = q as Qualification;
  if (isPricedNature(n) && qualification === 'refuse') return { ok: false, error: 'A declined need is answered with a qualification, without price' };
  if (n === 'offre_ferme' && qualification !== 'faisable') return { ok: false, error: 'A firm offer answers a feasible need' };
  const reason = text(v.reason);
  if (reason == null || reason.length > MAX_ANSWER_REASON) return { ok: false, error: 'The reason is too long' };
  if (qualification !== 'faisable' && !reason) return { ok: false, error: 'Give the reason of the qualification' };
  const rawClass = text(v.estimateClass);
  if (rawClass == null || (rawClass && !isEstimateClass(rawClass))) return { ok: false, error: 'Unknown estimate class' };
  const estimateClass = (rawClass || null) as EstimateClass | null;
  const amount = typedNumber(v.centralKeur);
  let range: { low: number; central: number; high: number } | null = null;
  if (isPricedNature(n)) {
    if (amount == null || !Number.isFinite(amount) || amount <= 0 || amount > MAX_ANSWER_KEUR) return { ok: false, error: 'Enter the central amount in k€' };
    const classError = offerClassError(n, estimateClass, true);
    if (classError) return { ok: false, error: classError };
    range = estimateRange(amount, estimateClass!);
  } else if (amount != null || estimateClass) {
    return { ok: false, error: 'A qualification carries no amount nor estimate class' };
  }
  const weeks = typedNumber(v.leadTimeWeeks);
  if (weeks != null && (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_LEAD_TIME_WEEKS)) return { ok: false, error: `The lead time is a whole number of weeks from 1 to ${MAX_LEAD_TIME_WEEKS}` };
  const valid = text(v.validUntil);
  if (valid == null || (valid && !validIso(valid))) return { ok: false, error: 'The validity date is a date YYYY-MM-DD' };
  if (valid && valid < today) return { ok: false, error: 'The validity date is in the past' };
  const doc = text(v.documentRef);
  if (doc == null || (doc && !DOCUMENT_REF_RE.test(doc))) return { ok: false, error: 'The Codex reference is a document number like OFF-CPX-SAI-2026-01-003' };
  return {
    ok: true,
    value: {
      nature: n, qualification, reason: reason || null, estimateClass: range ? estimateClass : null, centralKeur: range?.central ?? null, lowKeur: range?.low ?? null,
      highKeur: range?.high ?? null, leadTimeWeeks: weeks, validUntil: valid || null, documentRef: doc || null,
    },
  };
}

/**
 * What an answer needs before it is sent to the subsidiary (null = ready): a quote or a firm offer names its Codex document; a
 * firm offer also has its validity date and lead time (K-02: the G2 criterion of Arche reads them).
 */
export function sendBlocker(a: Pick<NeedAnswerInput, 'nature' | 'documentRef' | 'validUntil' | 'leadTimeWeeks'>): string | null {
  if ((a.nature === 'devis' || a.nature === 'offre_ferme') && !a.documentRef) return 'A quote or a firm offer is sent with its Codex document reference';
  if (a.nature === 'offre_ferme' && (!a.validUntil || !a.leadTimeWeeks)) return 'A firm offer is sent with its validity date and lead time';
  return null;
}

/**
 * Status moves of an answer (null = allowed): in preparation → sent (`sendBlocker`) or lapsed; sent → accepted (a quote or a firm
 * offer) or lapsed. Accepted and lapsed answers are final: a new answer is a new row (the most recent is authoritative, K-02).
 */
export function answerTransitionBlocker(a: Pick<NeedAnswerInput, 'nature' | 'documentRef' | 'validUntil' | 'leadTimeWeeks'> & { status: AnswerStatus }, to: AnswerStatus): string | null {
  if (!(ANSWER_STATUSES as readonly string[]).includes(to) || to === a.status) return 'Invalid status change';
  if (a.status === 'en_cours') {
    if (to === 'remise') return sendBlocker(a);
    return to === 'caduque' ? null : 'Send the answer first';
  }
  if (a.status === 'remise') {
    if (to === 'caduque') return null;
    if (to === 'acceptee') return a.nature === 'devis' || a.nature === 'offre_ferme' ? null : 'Only a quote or a firm offer is accepted';
    return 'Invalid status change';
  }
  return 'This answer is closed: record a new answer';
}

/** Only an answer in preparation is edited; a sent one stays as sent (a new answer is a new row). */
export const answerEditable = (status: AnswerStatus) => status === 'en_cours';

/** "RB-007": the next answer number after the highest in use (numbers never reused). */
export function nextAnswerNumber(numbers: readonly string[]): string {
  const max = numbers.reduce((m, s) => {
    const x = /^RB-(\d+)$/.exec(s);
    return x ? Math.max(m, parseInt(x[1], 10)) : m;
  }, 0);
  return `RB-${String(max + 1).padStart(3, '0')}`;
}

/** The most recent answer of each need (K-02: the most recent is authoritative) — by answered time, then number. */
export function latestAnswerOf<A extends { needRef: string; answeredAt: string; number: string }>(answers: readonly A[]): Map<string, A> {
  const out = new Map<string, A>();
  for (const a of answers) {
    const cur = out.get(a.needRef);
    if (!cur || a.answeredAt > cur.answeredAt || (a.answeredAt === cur.answeredAt && a.number > cur.number)) out.set(a.needRef, a);
  }
  return out;
}

// ── Catalogue: default amount and the equipment line of a need ──────────────────────────────────────────────────────

/** A catalogue version as the rules read it (pub_catalogue_machines' content). */
export interface NeedCatalogueEntry {
  code: string;
  version: number;
  machineTypeCode: string;
  label: string;
  options: { code: string; libelle: string; prix_indicatif_keur: number | null }[];
  nominalCapacity: number | null;
  capacityUnit: string | null;
  indicativePriceKeur: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Default central amount of an answer (k€, class E50 — the catalogue price class, R-186): (the version's indicative price + the
 * indicative prices of the options the need chose) × quantity. Null without a catalogue version or without its price; an option
 * without a price adds nothing.
 */
export function defaultNeedAmount(need: Pick<NeedRecord, 'quantity' | 'options'>, entry: NeedCatalogueEntry | null): number | null {
  if (!entry || entry.indicativePriceKeur == null) return null;
  const options = need.options.reduce((a, code) => a + (entry.options.find((o) => o.code === code)?.prix_indicatif_keur ?? 0), 0);
  return round1((entry.indicativePriceKeur + options) * need.quantity);
}

/** Default class of a first answer: E50 from the catalogue price (R-186), the order of magnitude. */
export const DEFAULT_NEED_CLASS: EstimateClass = ESTIMATE_CLASSES[0];

/** The equipment line a need gives (K-10): the fields of project_equipments (src/domain/project-equipment.ts). */
export interface NeedEquipmentLine {
  machineTypeCode: string;
  quantity: number;
  label: string | null;
  capacityValue: number | null;
  capacityUnit: string | null;
  options: string[];
  besoinRef: string;
  catalogueCode: string | null;
  catalogueVersion: number | null;
}

/**
 * The equipment line of a need: the machine type of its catalogue version (or `typeIfFree`, chosen by the director for a need
 * without catalogue entry), its quantity, its free label (none for a catalogue need: the catalogue reference names it), its target
 * capacity (unit: the need's, else the catalogue's; dropped without unit), its options ("TELE · Radio remote control" with the
 * catalogue label, the code alone otherwise; at most 12 of 80 characters, the line's limits), the need reference and the catalogue
 * code and version. Null when no machine type can be given (a free need without `typeIfFree`).
 */
export function needEquipmentLine(need: NeedRecord, entry: NeedCatalogueEntry | null, typeIfFree?: string | null): NeedEquipmentLine | null {
  const machineTypeCode = entry?.machineTypeCode ?? typeIfFree ?? null;
  if (!machineTypeCode) return null;
  const unit = need.capacityUnit ?? entry?.capacityUnit ?? null;
  const options = need.options.map((code) => {
    const o = entry?.options.find((x) => x.code === code);
    return (o ? `${code} · ${o.libelle}` : code).slice(0, 80);
  }).slice(0, 12);
  return {
    machineTypeCode, quantity: need.quantity, label: entry ? null : need.freeLabel ? need.freeLabel.slice(0, 120) : null,
    capacityValue: need.targetCapacity != null && unit ? need.targetCapacity : null, capacityUnit: need.targetCapacity != null && unit ? unit.slice(0, 20) : null,
    options, besoinRef: need.needRef, catalogueCode: entry ? entry.code : null, catalogueVersion: entry ? entry.version : null,
  };
}

/** Why the project cannot be created or the line added from this need (null = allowed): the need is ordered and not yet placed. */
export function orderActionBlocker(need: Pick<NeedRecord, 'status'> | null, placedOn: string | null): string | null {
  if (!need) return 'Unknown machine need';
  if (need.status !== 'ordered') return 'The need is not ordered yet: the project is created at the order (G2 of the CAPEX)';
  if (placedOn) return `This need is already delivered by a project · ${placedOn}`;
  return null;
}

/** Why an answer cannot be recorded for this need (null = allowed): it must be mirrored and not withdrawn. */
export function answerNeedBlocker(need: Pick<NeedRecord, 'status'> | null): string | null {
  if (!need) return 'Unknown machine need';
  if (need.status === 'withdrawn') return 'The subsidiary withdrew this need';
  return null;
}

/** The project name the wizard proposes for a need: "<CAPEX title> — <machine>". */
export const needProjectName = (capexTitle: string | null, machine: string) => (capexTitle ? `${capexTitle} — ${machine}` : machine).slice(0, 200);
