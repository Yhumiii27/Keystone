// Site sheet entered in Keystone (R-118, D-3 'a': "le chef de projet crée et renseigne la fiche chantier dans Keystone, dès les
// Études"). Pure part: when the sheet can be prepared and filled (the stage window), who may (the project's leads), the forms'
// validation (the sheet, client prerequisites, equipment, rotations, mission cost lines) and the stamps the Server Functions
// compare to refuse a stale form. The writers are in src/server/dal/site.ts; the forms in src/features/site/model.ts.
//
// Defaults chosen (the owner's answer only says "dès les Études" and "le chef de projet"):
// - stage window: from Études (seq 4) until Mise en service & SAT (seq 10); hidden at Garantie, Clos and Annulé;
// - who: the project's leads — PM of record, co-PM, deputy — and the director (R-041 / P-2 'a'), on a project they may edit;
// - lines: the prototype's columns only. A prerequisite conditions an activity of the plan (no plan, no prerequisite); a new
//   prerequisite or equipment line starts Pending and stays editable and removable while Pending (confirmed and signed lines
//   are kept); rotations are free to edit and remove (no mission orders, per diem or travel booking — P5 / Cursus); a mission
//   cost line has a budget only — the actual comes from Sage X3 (C-2a / A-12 'a': no typed actuals) and a line with an actual
//   is kept.
import { STAGES, equipmentSource, type EquipmentSource, type StageCode } from '@/server/db/codes';
import { CURRENCIES, isCurrency, type CurrencyCode } from './currency';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
type Values = Record<string, string | undefined>;
type DateParser = (s: string) => string | null;

// ── When and who ────────────────────────────────────────────────────────────────────────────────────

const seqOf = (code: StageCode) => STAGES.find((s) => s.code === code)?.seq ?? null;
/** First and last stage (STAGE_ORDER seq) at which the site sheet is prepared and filled: Études … Mise en service & SAT. */
export const SITE_SHEET_FROM_SEQ = seqOf('etudes')!;
export const SITE_SHEET_TO_SEQ = seqOf('mise_en_service_sat')!;

/** The stage lets the leads prepare and fill the site sheet (D-3 'a' "dès les Études"; not at Garantie, Clos, Annulé). */
export function siteSheetOpen(stage: StageCode): boolean {
  const seq = seqOf(stage);
  return seq != null && seq >= SITE_SHEET_FROM_SEQ && seq <= SITE_SHEET_TO_SEQ;
}

/**
 * "Prepare the site", "Edit site sheet" and the line entry: a lead of the project (PM of record, co-PM, deputy, or the
 * director) who may edit its Site screen (inside the workspace, not read-only), at a stage of the window.
 */
export const canFillSiteSheet = (v: { lead: boolean; canEdit: boolean; stage: StageCode }) => v.lead && v.canEdit && siteSheetOpen(v.stage);

// ── Messages (English source, translated by the feature) ────────────────────────────────────────────

export const SITE_STAGE_ERROR = 'The site sheet is prepared and filled from the Études stage until Mise en service & SAT';
export const SITE_LEADS_ONLY = 'Only the project’s leads prepare and fill the site sheet';
export const SITE_SHEET_EXISTS = 'This project already has a site sheet';
export const SITE_SHEET_CHANGED = 'The site sheet has changed — the page shows it as it is now';
export const SITE_LINE_CHANGED = 'This line has changed — the page shows it as it is now';
export const SITE_LINE_KEPT = 'A confirmed or signed line is kept';
export const SITE_COST_KEPT = 'A line with an actual from Sage X3 is kept';
export const NO_PLAN_ACTIVITY = 'A prerequisite conditions an activity of the plan — this project’s plan has no activity yet';
export const UNKNOWN_ACTIVITY = 'Choose an activity of the project’s plan';
export const TEXT_TOO_LONG = 'A text is too long';
export const SITE_REQUIRED = 'The site is required';
export const COUNTRY_REQUIRED = 'The country is required';
export const UNKNOWN_CURRENCY = 'Unknown currency';
export const START_DATE_ERROR = 'Start: enter a date such as 19 Oct 2026';
export const END_DATE_ERROR = 'End: enter a date such as 18 Dec 2026';
export const END_BEFORE_START = 'The end date is before the start date';
export const TITLE_REQUIRED = 'The title is required';
export const NEED_DATE_ERROR = 'Needed by: enter a date such as 2 Nov 2026';
export const NAME_REQUIRED = 'The name is required';
export const UNKNOWN_SOURCE = 'Unknown source';
export const PERSON_REQUIRED = 'Choose a person of the project team or type the contractor crew';
export const CREW_IS_PERSON = 'This name is a person known to Keystone — add them to the project team, then choose them';
export const ROLE_REQUIRED = 'The role on site is required';
export const FROM_DATE_ERROR = 'From: enter a date such as 19 Oct 2026';
export const TO_DATE_ERROR = 'To: enter a date such as 13 Nov 2026';
export const TO_BEFORE_FROM = 'The departure is before the arrival';
export const ROTATION_NO_ERROR = 'The rotation is a whole number from 1 to 99';
export const BUDGET_ERROR = 'The budget is an amount in k€, 0 or more';

/** Longest typed text of the sheet and its lines (the access constraints and an evidence note may be longer). */
export const SITE_TEXT_MAX = 200;
export const SITE_LONG_TEXT_MAX = 500;
/** Bound of a mission cost line's budget (k€): guards an amount typed in euros. */
export const SITE_BUDGET_MAX = 100_000;
/** The rotation person select's value for a contractor crew typed by name ("Contractant — 2 monteurs"). */
export const CONTRACTOR_CREW = '__crew';

const text = (v: string | undefined) => (v ?? '').trim();
/** Optional text bounded to `max`; undefined when too long. */
const bounded = (v: string | undefined, max = SITE_TEXT_MAX) => {
  const s = text(v);
  return s.length > max ? undefined : s;
};
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

// ── The site sheet ──────────────────────────────────────────────────────────────────────────────────

export interface SiteSheetForm {
  site: string;
  country: string;
  timeZone: string;
  language: string;
  currency: CurrencyCode;
  clientContact: string;
  workingHours: string;
  localHolidays: string;
  accessConstraints: string;
  startOn: string;
  endOn: string;
}

/** The currencies offered on the sheet (R-075's list). */
export const SITE_CURRENCIES: readonly CurrencyCode[] = CURRENCIES;

/**
 * "Prepare the site" / "Edit site sheet": site and country required (prefilled from the project), currency one of the list,
 * the other values typed text (blank allowed), start and end required with end ≥ start. Field ids: site, country, tz, lang,
 * currency, contact, hours, holidays, access, start, end.
 */
export function parseSiteSheetForm(v: Values, parseDate: DateParser): ParseResult<SiteSheetForm> {
  const site = bounded(v.site);
  const country = bounded(v.country);
  const timeZone = bounded(v.tz);
  const language = bounded(v.lang);
  const clientContact = bounded(v.contact);
  const workingHours = bounded(v.hours);
  const localHolidays = bounded(v.holidays);
  const accessConstraints = bounded(v.access, SITE_LONG_TEXT_MAX);
  if ([site, country, timeZone, language, clientContact, workingHours, localHolidays, accessConstraints].some((x) => x === undefined)) return fail(TEXT_TOO_LONG);
  if (!site) return fail(SITE_REQUIRED);
  if (!country) return fail(COUNTRY_REQUIRED);
  const currency = text(v.currency) || 'EUR';
  if (!isCurrency(currency)) return fail(UNKNOWN_CURRENCY);
  const startOn = parseDate(text(v.start));
  if (!startOn) return fail(START_DATE_ERROR);
  const endOn = parseDate(text(v.end));
  if (!endOn) return fail(END_DATE_ERROR);
  if (endOn < startOn) return fail(END_BEFORE_START);
  return {
    ok: true,
    value: {
      site: site!, country: country!, timeZone: timeZone!, language: language!, currency, clientContact: clientContact!, workingHours: workingHours!,
      localHolidays: localHolidays!, accessConstraints: accessConstraints!, startOn, endOn,
    },
  };
}

// ── Lines ───────────────────────────────────────────────────────────────────────────────────────────

export type SiteLineKind = 'prerequisite' | 'equipment' | 'rotation' | 'cost';
export const SITE_LINE_KINDS: readonly SiteLineKind[] = ['prerequisite', 'equipment', 'rotation', 'cost'];
export const isSiteLineKind = (v: unknown): v is SiteLineKind => typeof v === 'string' && (SITE_LINE_KINDS as readonly string[]).includes(v);

export interface PrerequisiteForm { title: string; activityCode: string; neededBy: string; evidence: string }
export interface EquipmentForm { name: string; source: EquipmentSource; note: string }
export interface RotationForm {
  /** A team member's name, or the contractor crew as typed. */
  personName: string;
  crew: boolean;
  roleOnSite: string;
  fromOn: string;
  toOn: string;
  lodging: string;
  travel: string;
  rotationNo: number;
}
export interface CostLineForm { name: string; budgetKeur: number }

export type SiteLineForm =
  | { kind: 'prerequisite'; value: PrerequisiteForm }
  | { kind: 'equipment'; value: EquipmentForm }
  | { kind: 'rotation'; value: RotationForm }
  | { kind: 'cost'; value: CostLineForm };

/** A client prerequisite: title, an activity of the plan (`activities` = the plan's codes), need date, evidence (optional). */
export function parsePrerequisiteForm(v: Values, activities: readonly string[], parseDate: DateParser): ParseResult<PrerequisiteForm> {
  const title = bounded(v.title);
  const evidence = bounded(v.evidence);
  if (title === undefined || evidence === undefined) return fail(TEXT_TOO_LONG);
  if (!title) return fail(TITLE_REQUIRED);
  if (!activities.length) return fail(NO_PLAN_ACTIVITY);
  const activityCode = text(v.activity);
  if (!activities.includes(activityCode)) return fail(UNKNOWN_ACTIVITY);
  const neededBy = parseDate(text(v.needed));
  if (!neededBy) return fail(NEED_DATE_ERROR);
  return { ok: true, value: { title, activityCode, neededBy, evidence } };
}

/** An equipment line: name, source (shipped with the machine, rented locally, provided by the client), note (optional). */
export function parseEquipmentForm(v: Values): ParseResult<EquipmentForm> {
  const name = bounded(v.name);
  const note = bounded(v.note);
  if (name === undefined || note === undefined) return fail(TEXT_TOO_LONG);
  if (!name) return fail(NAME_REQUIRED);
  const source = text(v.source) || 'shipped';
  if (!equipmentSource.isCode(source)) return fail(UNKNOWN_SOURCE);
  return { ok: true, value: { name, source, note } };
}

/** A name as compared with the known people's (trimmed, single spaces, case and accents ignored). */
const nameKey = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A contractor crew's typed name is a person Keystone knows (`known` = their full and short names): such a person is chosen
 * from the project team, never typed as a crew — a crew line has no person, so their department, absences and other sites
 * would not be matched (R-119).
 */
export const isKnownPersonName = (name: string, known: readonly string[]) => {
  const k = nameKey(name);
  return !!k && known.some((n) => nameKey(n) === k);
};

/**
 * A rotation line (the prototype's columns): a person of the project team (`team` = their names; `keep` = the line's current
 * person, accepted unchanged even when no longer on the team) or a contractor crew typed by name (`person` = CONTRACTOR_CREW,
 * `crew` = the name, not a person Keystone knows — `known`), role on site, arrival and departure (departure ≥ arrival),
 * lodging and travel as text, rotation 1–99.
 */
export function parseRotationForm(
  v: Values, team: readonly string[], parseDate: DateParser, keep?: string | null, known: readonly string[] = [],
): ParseResult<RotationForm> {
  const roleOnSite = bounded(v.role);
  const lodging = bounded(v.lodging);
  const travel = bounded(v.travel);
  const typedCrew = bounded(v.crew);
  if ([roleOnSite, lodging, travel, typedCrew].some((x) => x === undefined)) return fail(TEXT_TOO_LONG);
  const person = text(v.person);
  const crew = person === CONTRACTOR_CREW;
  const personName = crew ? typedCrew! : person;
  if (!personName || (!crew && !team.includes(personName) && personName !== keep)) return fail(PERSON_REQUIRED);
  if (crew && isKnownPersonName(personName, known)) return fail(CREW_IS_PERSON);
  if (!roleOnSite) return fail(ROLE_REQUIRED);
  const fromOn = parseDate(text(v.from));
  if (!fromOn) return fail(FROM_DATE_ERROR);
  const toOn = parseDate(text(v.to));
  if (!toOn) return fail(TO_DATE_ERROR);
  if (toOn < fromOn) return fail(TO_BEFORE_FROM);
  const rot = text(v.rotation) || '1';
  if (!/^\d{1,2}$/.test(rot) || +rot < 1) return fail(ROTATION_NO_ERROR);
  return { ok: true, value: { personName, crew, roleOnSite: roleOnSite!, fromOn, toOn, lodging: lodging!, travel: travel!, rotationNo: +rot } };
}

/** A mission cost line: name and budget (k€, ≥ 0, up to 3 decimals; "12,4" accepted). The actual is never typed (Sage X3). */
export function parseCostLineForm(v: Values): ParseResult<CostLineForm> {
  const name = bounded(v.name);
  if (name === undefined) return fail(TEXT_TOO_LONG);
  if (!name) return fail(NAME_REQUIRED);
  const raw = text(v.budget).replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(raw) || +raw > SITE_BUDGET_MAX) return fail(BUDGET_ERROR);
  return { ok: true, value: { name, budgetKeur: +raw } };
}

/**
 * The form of a line kind, validated (the plan's activities, the team's names, the current person and the names of the people
 * Keystone knows as context).
 */
export function parseSiteLine(
  kind: SiteLineKind, v: Values,
  ctx: { activities: readonly string[]; team: readonly string[]; keepPerson?: string | null; known?: readonly string[]; parseDate: DateParser },
): ParseResult<SiteLineForm> {
  switch (kind) {
    case 'prerequisite': {
      const r = parsePrerequisiteForm(v, ctx.activities, ctx.parseDate);
      return r.ok ? { ok: true, value: { kind, value: r.value } } : r;
    }
    case 'equipment': {
      const r = parseEquipmentForm(v);
      return r.ok ? { ok: true, value: { kind, value: r.value } } : r;
    }
    case 'rotation': {
      const r = parseRotationForm(v, ctx.team, ctx.parseDate, ctx.keepPerson, ctx.known);
      return r.ok ? { ok: true, value: { kind, value: r.value } } : r;
    }
    case 'cost': {
      const r = parseCostLineForm(v);
      return r.ok ? { ok: true, value: { kind, value: r.value } } : r;
    }
  }
}

// ── What may change, and stale forms ────────────────────────────────────────────────────────────────

/**
 * A line may be edited: prerequisites and equipment while Pending (the client's confirmation and signature, the equipment's
 * confirmation are recorded evidence); rotations and mission cost lines always.
 */
export const siteLineEditable = (kind: SiteLineKind, line: { status?: string }) => (kind === 'prerequisite' || kind === 'equipment' ? line.status === 'pending' : true);

/** A line may be removed: as editable, and a mission cost line only without an actual (received from Sage X3). */
export const siteLineRemovable = (kind: SiteLineKind, line: { status?: string; actualKeur?: number }) =>
  siteLineEditable(kind, line) && (kind !== 'cost' || !line.actualKeur);

/**
 * Stamp of a line or of the sheet as the form saw it (FNV-1a of its values): the Server Function sends it back and the writer
 * compares it with the row re-read in its transaction — a line changed, removed or replaced at the same position meanwhile
 * is refused (the positions are the lines' identifiers, R-010).
 */
export function siteStamp(values: readonly (string | number | null | undefined)[]): string {
  let h = 0x811c9dc5;
  const s = JSON.stringify(values.map((x) => x ?? null));
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** The values a stamp covers, per kind (what the forms show and the status). */
export const prerequisiteStamp = (p: { title: string; activityCode: string; neededBy: string; status: string; evidence: string }) =>
  siteStamp(['prerequisite', p.title, p.activityCode, p.neededBy, p.status, p.evidence]);
export const equipmentStamp = (e: { name: string; source: string; status: string; note: string }) => siteStamp(['equipment', e.name, e.source, e.status, e.note]);
export const rotationStamp = (r: { personName: string; roleOnSite: string; fromOn: string; toOn: string; lodging: string; travel: string; rotationNo: number }) =>
  siteStamp(['rotation', r.personName, r.roleOnSite, r.fromOn, r.toOn, r.lodging, r.travel, r.rotationNo]);
export const costStamp = (c: { name: string; budgetKeur: number; actualKeur: number }) => siteStamp(['cost', c.name, c.budgetKeur, c.actualKeur]);
export const sheetStamp = (s: Omit<SiteSheetForm, 'currency'> & { currency: string }) =>
  siteStamp([
    'sheet', s.site, s.country, s.timeZone, s.language, s.currency, s.clientContact, s.workingHours, s.localHolidays, s.accessConstraints, s.startOn, s.endOn,
  ]);
