// Inspection & test plan · punch list, and Commissioning & handover dossier — pure business logic (docs/spec/07 §2.4,
// §2.6; prototype logic 4938–4951 and 4969–4977, AF `itp` / `punch` / `commissioning` of afSubmit 5121): plan groups
// per template system, inspection and punch tones, the punch Start / Close step, the KPI figures of both screens, the
// ITP nav badge (open category-A punch items), "Blocking A" per commissioning system, the handover dossier
// completeness, the dates the screens show and the parsing of the three action forms. No I/O, no translation: labels
// are the prototype's English source strings. Golden values: src/domain/itpcom.test.ts (prototype render values in
// src/domain/itpcom.golden.json, scripts/proto-golden-itpcom.ts).
import { LO, OK, TAG_CLASS, commissioningCell, statusTone, type Tone } from '@/components/app/tones';
import {
  ITP_RECORDED_RESULTS, NOW_ISO, STATUS_ISO, addDaysIso, displayOfIso, itpPointType, itpResult, itpStage, punchCategory, punchOrigin, punchOwnerParty, punchSource,
  shortDateOfIso,
  type CommissioningCellStatus, type HandoverItemStatus, type ItpPointType, type ItpRecordedResult, type ItpResult, type ItpStage, type PunchCategory,
  type PunchOrigin, type PunchOwnerParty, type PunchSource, type PunchStatus,
} from '@/server/db/codes';
import { parseNeedDate, type ParseResult } from './team';

export type { ParseResult };

// ── Dates ───────────────────────────────────────────────────────────────────────────────────────────────

const text = (v: string | undefined) => (v ?? '').trim();

const WINDOW_START = addDaysIso(STATUS_ISO, -183);
const WINDOW_END = addDaysIso(STATUS_ISO, 183);

/**
 * Date of a plan line, punch item or commissioning step as the screens show it: year-less ("9 Sep", "14 Jan") within six
 * months of the status date — the prototype's data is year-less and the seed reads it that way (handover 14 Jan = 2027)
 * — and with its year otherwise ("3 Mar ’27", "12 Mar ’26"), so a date typed for a later year is never ambiguous.
 */
export function itpDateText(iso: string | null | undefined): string {
  if (!iso) return '';
  if (iso >= WINDOW_START && iso <= WINDOW_END) return shortDateOfIso(iso);
  return `${shortDateOfIso(iso)} ’${iso.slice(2, 4)}`;
}

/** The typed date carries its year: ISO, "15/10/26", "15 Oct 2026", "15 Oct ’26". */
const hasYear = (s: string) => /^\d{4}-/.test(s) || /^\d{1,2}[/.]\d{1,2}[/.]\S+$/.test(s) || /\s[’']?\d{2}(\d{2})?$/.test(s);

/**
 * A forward-looking date as typed ("15 Oct", "15 oct. 2026", "15/10", ISO…): a year-less date more than six months before
 * the status date is next year's (the seed's rule: "Planned · 14 Jan" is 2027). Null when it is not a date.
 */
export function parseForwardDate(input: string | undefined, today = STATUS_ISO): string | null {
  const iso = parseNeedDate(input, +today.slice(0, 4));
  if (!iso) return null;
  if (hasYear(text(input)) || iso >= addDaysIso(today, -183)) return iso;
  return `${+iso.slice(0, 4) + 1}${iso.slice(4)}`;
}

// ── Inspection & test plan (itpRows / itpBySys 4941–4943) ───────────────────────────────────────────────

/** Passed, with or without reservations (R-112: an inspection passed with reservations is accepted; its reservations are punch items). */
export const isPassedResult = (r: ItpResult) => r === 'passed' || r === 'reserved';

export interface InspectionFacts {
  number: string;
  system: string;
  pointType: ItpPointType;
  result: ItpResult;
}

export interface InspectionGroup<R extends InspectionFacts> {
  system: string;
  rows: R[];
  count: number;
  passed: number;
}

/**
 * One group per system of the template that has lines, in template order (itpBySys). Lines whose system is no longer
 * in the template (a machine type edited after the plan was built) follow in a group of their own instead of vanishing.
 */
export function groupBySystem<R extends InspectionFacts>(systems: readonly string[], rows: readonly R[]): InspectionGroup<R>[] {
  const order = [...systems, ...[...new Set(rows.map((r) => r.system))].filter((s) => !systems.includes(s))];
  return order
    .map((system) => {
      const own = rows.filter((r) => r.system === system);
      return { system, rows: own, count: own.length, passed: own.filter((r) => isPassedResult(r.result)).length };
    })
    .filter((g) => g.count > 0);
}

export interface InspectionLook {
  /** Point type tag: Hold → accent · Witness → outline · Review / Surveillance → neutral. */
  typeClass: string;
  /** Result tag: Passed → neutral · Failed → accent · Scheduled / Planned → outline. */
  statusClass: string;
  /** Result text colour (inline, over the tag's): Failed → LO · Passed → accent-300 · else neutral-400. */
  statusColor: string;
}

export function inspectionLook(pointType: ItpPointType, result: ItpResult): InspectionLook {
  return {
    typeClass: TAG_CLASS[statusTone('itpType', pointType)],
    statusClass: TAG_CLASS[statusTone('itpResult', result)],
    statusColor: result === 'failed' ? LO : isPassedResult(result) ? 'var(--color-accent-300)' : 'var(--color-neutral-400)',
  };
}

// ── Punch list (punchRows 4945–4947) ────────────────────────────────────────────────────────────────────

export interface PunchFacts {
  category: PunchCategory | null;
  status: PunchStatus;
  /** System / location ("Structure · Bay 4"). */
  location: string;
}

/**
 * R-117 (A-6 'a'): which items a punch list shows — every origin (Inspections & punch list's default), or the items raised by
 * an inspection or on site (the Site screen's default). `?origin=` / `?punch=` values; anything else is the default.
 */
export type PunchOriginFilter = 'all' | PunchOrigin;
export const PUNCH_ORIGIN_FILTERS: readonly PunchOriginFilter[] = ['all', 'itp', 'site'];
export const punchOriginFilterOf = (v: string | null | undefined, fallback: PunchOriginFilter = 'all'): PunchOriginFilter =>
  (PUNCH_ORIGIN_FILTERS as readonly string[]).includes(v ?? '') ? (v as PunchOriginFilter) : fallback;
/** The items of a list a filter keeps. */
export const filterPunchByOrigin = <R extends { origin: PunchOrigin }>(rows: readonly R[], f: PunchOriginFilter): R[] => (f === 'all' ? [...rows] : rows.filter((r) => r.origin === f));

/** Row step of a punch item (every origin, R-117): Open → "Start" (In progress), In progress → "Close" (Closed); none once closed. */
export function punchStep(status: PunchStatus): { label: 'Start' | 'Close'; to: PunchStatus } | null {
  if (status === 'open') return { label: 'Start', to: 'in_progress' };
  if (status === 'in_progress') return { label: 'Close', to: 'closed' };
  return null;
}

export interface PunchLook {
  /** A → accent · B → outline · C → neutral. */
  categoryClass: string;
  /** Closed → neutral · In progress → outline · Open → accent. */
  statusClass: string;
  /** Item text: neutral-500 once closed. */
  color: string;
}

export function punchLook(category: PunchCategory | null, status: PunchStatus): PunchLook {
  const catTone: Tone = category ? statusTone('punchCategory', category) : 'neutral';
  return { categoryClass: TAG_CLASS[catTone], statusClass: TAG_CLASS[statusTone('punch', status)], color: status === 'closed' ? 'var(--color-neutral-500)' : OK };
}

const openA = (punch: readonly PunchFacts[]) => punch.filter((p) => p.status !== 'closed' && p.category === 'A');

/** Sidebar badge of the ITP screen (`itpBadge`): open category-A punch items, '' when none. */
export const itpBadge = (punch: readonly PunchFacts[]) => {
  const n = openA(punch).length;
  return n ? String(n) : '';
};

// ── ITP KPI tiles (itpKpis 4948) ────────────────────────────────────────────────────────────────────────

export interface ItpSummary {
  passed: number;
  total: number;
  failed: number;
  /** Hold points not passed yet ("client presence required"). */
  holdAhead: number;
  open: number;
  openA: number;
  openB: number;
  openC: number;
  /** Template value: the plan's machine type, else the project's, else "—". */
  template: string;
  /** Systems and custom lines of the plan; null without a plan ("standard template for this machine type"). */
  plan: { systems: number; custom: number } | null;
  /** Value colours: LO when an inspection failed / a category-A item is open. */
  passedColor: string;
  openColor: string;
}

export function summariseItp(
  inspections: readonly InspectionFacts[],
  punch: readonly PunchFacts[],
  plan: { template: string; systems: number; custom: number } | null,
  projectMachineType: string | null,
): ItpSummary {
  const open = punch.filter((p) => p.status !== 'closed');
  const failed = inspections.filter((r) => r.result === 'failed').length;
  const a = open.filter((p) => p.category === 'A').length;
  return {
    passed: inspections.filter((r) => isPassedResult(r.result)).length,
    total: inspections.length,
    failed,
    holdAhead: inspections.filter((r) => r.pointType === 'hold' && !isPassedResult(r.result)).length,
    open: open.length,
    openA: a,
    openB: open.filter((p) => p.category === 'B').length,
    openC: open.filter((p) => p.category === 'C').length,
    template: plan?.template ?? projectMachineType ?? '—',
    plan: plan ? { systems: plan.systems, custom: plan.custom } : null,
    passedColor: failed ? LO : OK,
    openColor: a ? LO : OK,
  };
}

// ── Commissioning (cmStatus / cmRows / cmDossier / cmKpis 4970–4977) ─────────────────────────────────────

/** Status cell look (bg, border, colour, Phosphor icon name). */
export const commissioningCellLook = (status: CommissioningCellStatus) => commissioningCell(status);

/** "Blocking A" of a system: open category-A punch items whose location starts with the system's first word. */
export function blockingAOf(system: string, punch: readonly PunchFacts[]): number {
  const head = system.split(' ')[0];
  return openA(punch).filter((p) => p.location.startsWith(head)).length;
}

/** Handover dossier completeness: round((Ready + ½ Partial) / items × 100); 0 for an empty dossier. */
export function dossierPct(items: readonly { status: HandoverItemStatus }[]): number {
  if (!items.length) return 0;
  const ready = items.filter((d) => d.status === 'ready').length;
  const partial = items.filter((d) => d.status === 'partial').length;
  return Math.round(((ready + partial * 0.5) / items.length) * 100);
}

export interface CommissioningCellFacts {
  status: CommissioningCellStatus;
  dateOn: string | null;
}

export interface CommissioningSummary {
  handedOver: number;
  systems: number;
  /** SAT and handover dates of the first system (the prototype's row 0), ISO or null. */
  satOn: string | null;
  handoverOn: string | null;
  done: number;
  cells: number;
  blocked: number;
  /** Open category-A punch items of the project (all systems). */
  openA: number;
  dossierPct: number;
  missing: number;
  stepsColor: string;
  punchColor: string;
  dossierColor: string;
}

/** Column index of the SAT and Handover steps (Mechanical completion … Handover). */
const SAT = 3;
const HANDOVER = 4;

export function summariseCommissioning(
  systems: readonly { cells: readonly CommissioningCellFacts[] }[],
  dossier: readonly { status: HandoverItemStatus }[],
  punch: readonly PunchFacts[],
): CommissioningSummary {
  const cells = systems.flatMap((s) => s.cells);
  const blocked = cells.filter((c) => c.status === 'blocked').length;
  const missing = dossier.filter((d) => d.status === 'missing').length;
  const a = openA(punch).length;
  return {
    handedOver: systems.filter((s) => s.cells[HANDOVER]?.status === 'done').length,
    systems: systems.length,
    satOn: systems[0]?.cells[SAT]?.dateOn ?? null,
    handoverOn: systems[0]?.cells[HANDOVER]?.dateOn ?? null,
    done: cells.filter((c) => c.status === 'done').length,
    cells: cells.length,
    blocked,
    openA: a,
    dossierPct: dossierPct(dossier),
    missing,
    stepsColor: blocked ? LO : OK,
    punchColor: a ? LO : OK,
    dossierColor: missing ? LO : OK,
  };
}

// ── KPI sentences (English; French forms in src/features/itpcom/i18n.ts) ──────────────────────────────────

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "1 failed · NCR raised". */
export const failedText = (n: number) => `${n} failed · NCR raised`;
/** "A 0 · B 2 · C 2". */
export const openByCategoryText = (a: number, b: number, c: number) => `A ${a} · B ${b} · C ${c}`;
/** "6 systems · 2 custom lines" (singular forms for 1). */
export const planShapeText = (systems: number, custom: number) => `${plural(systems, 'system', 'systems')} · ${plural(custom, 'custom line', 'custom lines')}`;
/** "2 blocked by interfaces". */
export const blockedText = (n: number) => `${n} blocked by interfaces`;
/** "4 items missing" (singular for 1). */
export const missingText = (n: number) => `${plural(n, 'item', 'items')} missing`;

// ── Action forms (AF `itp` "Add to plan", `punch` "Add item", `commissioning` "Plan & invite") ────────────

const MAX_TEXT = 200;
const MAX_NOTE = 1000;

/** A select value: the stable code, or (prototype payloads) its English label. */
function codeOf<C extends string>(v: string, codec: { isCode: (x: unknown) => x is C; labels: readonly string[]; code: (l: string) => C }): C | null {
  if (codec.isCode(v)) return v;
  return codec.labels.includes(v) ? codec.code(v) : null;
}

export const ITP_POINT_TYPES: readonly ItpPointType[] = itpPointType.codes;
export const ITP_STAGES: readonly ItpStage[] = itpStage.codes;
export const PUNCH_CATEGORIES: readonly PunchCategory[] = punchCategory.codes;
export const PUNCH_SOURCES: readonly PunchSource[] = punchSource.codes;
/** R-117: origins (Inspection first, the form's default) and responsible parties (Keystone first). */
export const PUNCH_ORIGINS: readonly PunchOrigin[] = punchOrigin.codes;
export const PUNCH_OWNER_PARTIES: readonly PunchOwnerParty[] = ['keystone', 'client'];
/** A Vigie NCR reference as typed ("NCR-029"): letters, digits and separators, at most 40 characters (the DAL bound). */
export const NCR_REF = /^[A-Za-z0-9][A-Za-z0-9\-/. ]{0,39}$/;

export interface NewInspectionValues {
  name: string;
  system: string;
  pointType: ItpPointType;
  stage: ItpStage;
  reference: string | null;
  /** ISO planned date; null when not given. */
  plannedOn: string | null;
}

/**
 * "Add inspection": the inspection / test is required; system from the plan's template (first when blank); type
 * defaults to Hold and stage to Workshop (the select defaults); the planned date, when given, must be a date (the
 * prototype stored any text).
 */
export function parseNewInspection(values: Record<string, string | undefined>, systems: readonly string[]): ParseResult<NewInspectionValues> {
  const name = text(values.name);
  if (!name) return { ok: false, error: 'Inspection / test is required' };
  const reference = text(values.ref);
  if (name.length > MAX_TEXT || reference.length > MAX_TEXT) return { ok: false, error: 'Text is too long' };
  const system = text(values.system) || systems[0] || '';
  if (!systems.includes(system)) return { ok: false, error: 'Unknown system' };
  const pointType = codeOf(text(values.type) || ITP_POINT_TYPES[0], itpPointType);
  if (!pointType) return { ok: false, error: 'Unknown inspection type' };
  const stage = codeOf(text(values.stage) || ITP_STAGES[0], itpStage);
  if (!stage) return { ok: false, error: 'Unknown stage' };
  const date = text(values.date);
  const plannedOn = date ? parseForwardDate(date) : null;
  if (date && !plannedOn) return { ok: false, error: 'Enter the planned date as a date, e.g. 15 Oct' };
  return { ok: true, value: { name, system, pointType, stage, reference: reference || null, plannedOn } };
}

export interface NewPunchValues {
  description: string;
  location: string | null;
  category: PunchCategory;
  source: PunchSource;
  /** Owner person (a TEAM option, full name); null when only a party owns the item (R-117). */
  owner: string | null;
  dueOn: string | null;
  /** R-117 (A-6 'a'): origin, responsible party and Vigie's NCR number (internal viewers only, P-10b). */
  origin: PunchOrigin;
  ownerParty: PunchOwnerParty;
  ncrNumber: string | null;
}

/** "—" in the Owner select: no person, the party owns the item (R-117). */
export const NO_OWNER = '';

/**
 * "Add punch item": the item is required; category defaults to A (the select's first option), source to Site walk, owner
 * to the first TEAM name when the field is absent ("—" = no person, the party owns it); the due date, when given, must be a
 * date. R-117 (A-6 'a'): origin (Inspection by default, or Site), responsible party (Keystone by default, or the client)
 * and, for internal viewers, Vigie's NCR number (optional; a client's is ignored — P-10b).
 */
export function parseNewPunch(values: Record<string, string | undefined>, team: readonly string[], opts: { internal?: boolean } = {}): ParseResult<NewPunchValues> {
  const internal = opts.internal ?? true;
  const description = text(values.item);
  if (!description) return { ok: false, error: 'Item is required' };
  const location = text(values.loc);
  if (description.length > MAX_TEXT || location.length > MAX_TEXT) return { ok: false, error: 'Text is too long' };
  // The letter (code) or its label "A — blocking" (the prototype stored the label's first letter).
  const category = codeOf(text(values.cat) || PUNCH_CATEGORIES[0], punchCategory);
  if (!category) return { ok: false, error: 'Unknown category' };
  const source = codeOf(text(values.src) || PUNCH_SOURCES[0], punchSource);
  if (!source) return { ok: false, error: 'Unknown source' };
  const origin = codeOf(text(values.origin) || PUNCH_ORIGINS[0], punchOrigin);
  if (!origin) return { ok: false, error: 'Unknown origin' };
  const ownerParty = codeOf(text(values.party) || PUNCH_OWNER_PARTIES[0], punchOwnerParty);
  if (!ownerParty) return { ok: false, error: 'Unknown owner party' };
  const typed = values.owner === undefined ? team[0] ?? '' : text(values.owner);
  const owner = typed === NO_OWNER || typed === '—' ? null : typed;
  if (owner !== null && !team.includes(owner)) return { ok: false, error: 'Unknown owner' };
  const ncr = internal ? text(values.ncr) : '';
  if (ncr && !NCR_REF.test(ncr)) return { ok: false, error: 'Enter the NCR number as Vigie gives it, e.g. NCR-029' };
  const due = text(values.due);
  const dueOn = due ? parseForwardDate(due) : null;
  if (due && !dueOn) return { ok: false, error: 'Enter the due date as a date, e.g. 15 Oct' };
  return { ok: true, value: { description, location: location || null, category, source, owner, dueOn, origin, ownerParty, ncrNumber: ncr || null } };
}

export interface PlanSatValues {
  system: string;
  /** ISO SAT date. */
  date: string;
  clientWitnesses: string;
  prerequisites: string;
}

/**
 * "Plan SAT": a system of the commissioning plan (first when blank) and a date on or after the status date (required;
 * the prototype stored nothing); witnesses and prerequisites free text.
 */
export function parsePlanSat(values: Record<string, string | undefined>, systems: readonly string[], today = STATUS_ISO): ParseResult<PlanSatValues> {
  const system = text(values.system) || systems[0] || '';
  if (!systems.includes(system)) return { ok: false, error: 'Unknown system' };
  const raw = text(values.date);
  if (!raw) return { ok: false, error: 'Date is required' };
  const date = parseForwardDate(raw);
  if (!date) return { ok: false, error: 'Enter the SAT date as a date, e.g. 10 Dec 2026' };
  if (date < today) return { ok: false, error: 'The SAT date cannot be before the status date' };
  const clientWitnesses = text(values.client);
  const prerequisites = text(values.note);
  if (clientWitnesses.length > MAX_TEXT || prerequisites.length > MAX_NOTE) return { ok: false, error: 'Text is too long' };
  return { ok: true, value: { system, date, clientWitnesses, prerequisites } };
}

/** Default date of the Plan SAT form: the first system's SAT date ("10 Dec 2026", English), '' when none. */
export const defaultSatDate = (satOn: string | null) => (satOn ? displayOfIso(satOn) : '');

// ── Inspection results (R-112, Q-6a / Q-6b) ─────────────────────────────────────────────────────────────

/**
 * Roles that record inspection results (Q-6a, owner's answer "a": quality and the engineering lead; the portfolio director
 * keeps every right). The project manager, the client and the others see the results read-only.
 */
export const ITP_RESULT_ROLES: readonly string[] = ['quality', 'englead', 'director'];
export const canRecordItpResult = (role: string) => ITP_RESULT_ROLES.includes(role);

/** Point types whose result names the client representative present (Q-6a): a hold point requires it, a witness point offers it. */
export const witnessFieldOf = (pointType: ItpPointType): 'required' | 'optional' | null =>
  pointType === 'hold' ? 'required' : pointType === 'witness' ? 'optional' : null;

/** The year-less date typed is the latest such day on or before `today` ("28 Dec" typed on 5 Jan is last year's). */
export function parsePastDate(input: string | undefined, today = NOW_ISO): string | null {
  const iso = parseNeedDate(input, +today.slice(0, 4));
  if (!iso) return null;
  if (!hasYear(text(input)) && iso > today) return `${+iso.slice(0, 4) - 1}${iso.slice(4)}`;
  return iso;
}

export interface InspectionResultValues {
  result: ItpRecordedResult;
  /** ISO date of the inspection (not after the business date). */
  resultOn: string;
  inspector: string;
  /** Client representative present; null when none (never required outside hold points). */
  clientWitness: string | null;
  comment: string | null;
}

/**
 * "Record result": Passed / Passed with reservations / Failed (codes or labels), the inspection date (required, not after
 * the business date "today"), the inspector (required), the client representative (required on a hold point, Q-6a) and a
 * comment — required for a failure (what is non-conforming, before the NCR is reported in Vigie) and for reservations
 * (they are listed there).
 */
export function parseInspectionResult(values: Record<string, string | undefined>, pointType: ItpPointType, today = NOW_ISO): ParseResult<InspectionResultValues> {
  const raw = text(values.result);
  const result = (ITP_RECORDED_RESULTS as readonly string[]).includes(raw)
    ? (raw as ItpRecordedResult)
    : (ITP_RECORDED_RESULTS.find((r) => itpResult.label(r) === raw) ?? null);
  if (!result) return { ok: false, error: 'Choose the result' };
  const date = text(values.date);
  if (!date) return { ok: false, error: 'Date is required' };
  const resultOn = parsePastDate(date, today);
  if (!resultOn) return { ok: false, error: 'Enter the inspection date as a date, e.g. 24 Sep' };
  if (resultOn > today) return { ok: false, error: 'The inspection date cannot be in the future' };
  const inspector = text(values.inspector);
  if (!inspector) return { ok: false, error: 'Inspector is required' };
  const witnessRule = witnessFieldOf(pointType);
  const clientWitness = witnessRule ? text(values.witness) : '';
  if (witnessRule === 'required' && !clientWitness) return { ok: false, error: 'Name the client representative present at this hold point' };
  const comment = text(values.comment);
  if (result !== 'passed' && !comment) return { ok: false, error: result === 'failed' ? 'Describe the non-conformity' : 'List the reservations' };
  if (inspector.length > MAX_TEXT || clientWitness.length > MAX_TEXT || comment.length > MAX_NOTE) return { ok: false, error: 'Text is too long' };
  return { ok: true, value: { result, resultOn, inspector, clientWitness: clientWitness || null, comment: comment || null } };
}

/**
 * "Passed 24 Sep · Sophie Haddad · client N. Bensaïd" — the line under an inspection whose result was recorded in Keystone;
 * `t` translates the result, the date and "client" (names stay as typed). Null when no result was recorded in Keystone.
 */
export function resultLineText(
  r: { result: ItpResult; resultOn: string | null; inspector: string | null; clientWitness: string | null },
  t: (s: string) => string = (s) => s,
): string | null {
  if (!r.resultOn) return null;
  return [`${t(itpResult.label(r.result))} ${t(itpDateText(r.resultOn))}`, r.inspector ?? '', r.clientWitness ? `${t('client')} ${r.clientWitness}` : ''].filter(Boolean).join(' · ');
}

/** Title of the NCR reported in Vigie from a failed inspection (prefill `titre`): "ITP I-03 · Structure · Paint thickness (DFT)". */
export const inspectionNcrTitle = (i: { number: string; system: string; name: string }) => `ITP ${i.number} · ${i.system} · ${i.name}`;
