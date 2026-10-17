// Team & exchanges — Stakeholders & RACI and the Interface register: pure business logic (docs/spec/05 §6, 07 §2.5;
// prototype logic 4930–4936 and 4952–4957, AF `stakeholders` / `interfaces` of afSubmit 5121). Stale contacts, the
// KPI figures of both screens, the RACI grid geometry, the effective interface status (Late derived), the need-date
// texts, the row actions, the nav badge rule and the parsing of the two add-forms. No I/O, no translation: labels are
// the prototype's English source strings. Golden values: src/domain/team.test.ts.
import {
  interfaceStatus, keystoneSide, monthIndexOfIso, stakeholderType,
  type InterfaceEffectiveStatus, type InterfaceStatus, type KeystoneSide, type StakeholderType,
} from '@/server/db/codes';
import { yearOfIso } from './clock';
import { DATE_ERROR, parseDateInput } from './contract';

export type { InterfaceEffectiveStatus, InterfaceStatus, KeystoneSide, StakeholderType };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

// ── Stakeholders (stkRows / stkKpis 4931–4936) ──────────────────────────────────────────────────────────

/** Form order of the "Type" select (AF.stakeholders): Client, Internal, Supplier, Authority, Third party. */
export const STAKEHOLDER_TYPES: readonly StakeholderType[] = ['client', 'internal', 'supplier', 'authority', 'third_party'];

/** Kind tag: Client → `tag-accent`, Internal → `tag-neutral`, Authority / Supplier / Third party → `tag-outline`. */
export function stakeholderTone(type: StakeholderType): 'accent' | 'neutral' | 'outline' {
  return type === 'client' ? 'accent' : type === 'internal' ? 'neutral' : 'outline';
}

/**
 * "No contact for more than 30 days": (now − mIdx(last)) × 30 > 30. `now` = month index of the business date
 * (`monthNowOf(today)`, src/domain/clock.ts — R-013; the prototype's PG_NOW = 8.97 ≈ 30 Sep 2026). A month index rather than
 * an ISO date, like the prototype's rule, so the golden values at PG_NOW stay exact.
 */
export const isStaleContact = (lastContactIso: string, now: number) => (now - monthIndexOfIso(lastContactIso)) * 30 > 30;

/** First letters of the first two words ("Port authority HSE" → "Pa", "Nadia Bensaïd" → "NB"). */
export const stakeholderInitials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2);

export interface StakeholderFacts {
  type: StakeholderType;
  /** Relationship owner (short name). */
  owner: string;
  stale: boolean;
}

export interface StakeholderSummary {
  count: number;
  clients: number;
  authorities: number;
  /** Suppliers and third parties together. */
  suppliersAndThirdParties: number;
  /** Distinct relationship owners in register order. */
  owners: string[];
  /** RACI rows (responsibilities) and columns (roles); 0 without a matrix. */
  raciRows: number;
  raciRoles: number;
  /** Stakeholders not contacted for more than 30 days. */
  stale: number;
}

/** Figures of the four KPI tiles (stkKpis 4936). */
export function summariseStakeholders(rows: readonly StakeholderFacts[], raci: { columns: readonly unknown[]; rows: readonly unknown[] } | null): StakeholderSummary {
  return {
    count: rows.length,
    clients: rows.filter((r) => r.type === 'client').length,
    authorities: rows.filter((r) => r.type === 'authority').length,
    suppliersAndThirdParties: rows.filter((r) => r.type === 'supplier' || r.type === 'third_party').length,
    owners: [...new Set(rows.map((r) => r.owner))],
    raciRows: raci?.rows.length ?? 0,
    raciRoles: raci?.columns.length ?? 0,
    stale: rows.filter((r) => r.stale).length,
  };
}

/**
 * RACI grid geometry: label column 220px then one `minmax(96px,1fr)` column per role, gap 4px. The prototype fixed
 * 6 columns and `min-width:820px` (= 220 + 6 × (96 + 4)); the column count now follows the matrix (05 §6.4).
 */
export function raciGrid(columns: number): { template: string; minWidth: number } {
  return { template: `220px repeat(${columns}, minmax(96px,1fr))`, minWidth: 220 + columns * 100 };
}

// ── Interfaces (ifcRows / ifcKpis / ifcBadge 4954–4957) ──────────────────────────────────────────────────

/** Form order of the "Keystone side" select (AF.interfaces). */
export const KEYSTONE_SIDES: readonly KeystoneSide[] = ['process', 'mechanical', 'electrical', 'automation', 'site'];

/**
 * Effective status: an open interface needed before now is Late. `now` = month index of the business date
 * (`monthNowOf(today)`, R-013; the prototype's PG_NOW).
 */
export function effectiveInterfaceStatus(stored: InterfaceStatus, neededIso: string, now: number): InterfaceEffectiveStatus {
  return stored === 'open' && monthIndexOfIso(neededIso) < now ? 'late' : stored;
}

/** Days from now (`monthNowOf(today)`, R-013) to the need date: round((mIdx(needed) − now) × 30); negative = late. */
export const daysToNeed = (neededIso: string, now: number) => Math.round((monthIndexOfIso(neededIso) - now) * 30) + 0; // + 0: no −0

export interface InterfaceFacts {
  /** "IF-02". */
  number: string;
  status: InterfaceEffectiveStatus;
  daysToNeed: number;
}

export interface InterfaceRowState {
  /** Sub-line under the need date: "<n> d late" (Late), "in <n> d" (Open), none otherwise. */
  neededSub: { kind: 'late' | 'in'; days: number } | null;
  /** Need date in LO: Late, or Open and due within 30 days. */
  neededAlert: boolean;
  /** "Mark received" (Open or Late) / "Freeze" (Received). */
  canReceive: boolean;
  canFreeze: boolean;
}

/** Need-date texts and row actions of one interface. */
export function interfaceRowState(r: InterfaceFacts): InterfaceRowState {
  const late = r.status === 'late';
  const open = r.status === 'open';
  return {
    neededSub: late ? { kind: 'late', days: Math.abs(r.daysToNeed) } : open ? { kind: 'in', days: r.daysToNeed } : null,
    neededAlert: late || (open && r.daysToNeed <= 30),
    canReceive: open || late,
    canFreeze: r.status === 'received',
  };
}

export interface InterfaceSummary {
  count: number;
  frozen: number;
  received: number;
  open: number;
  // "<n> due within 30 days" is computed from the data date by the screen (A-12, dueWithinDays in src/domain/kpis.ts):
  // the prototype's count of every future need date was removed here in delivery 8 (R-116).
  /** Numbers of the late interfaces, register order. */
  late: string[];
  /** Interfaces blocking a commissioning step that are neither received nor frozen (register order). */
  blocking: string[];
}

/**
 * Figures of the four KPI tiles (ifcKpis 4956). `blockers` = numbers of the interfaces a commissioning step waits
 * for ("Blocked · IF-02"); the prototype hard-coded IF-02 and IF-05 for every project.
 */
export function summariseInterfaces(rows: readonly InterfaceFacts[], blockers: readonly string[]): InterfaceSummary {
  const byStatus = (s: InterfaceEffectiveStatus) => rows.filter((r) => r.status === s);
  return {
    count: rows.length,
    frozen: byStatus('frozen').length,
    received: byStatus('received').length,
    open: byStatus('open').length,
    late: byStatus('late').map((r) => r.number),
    blocking: rows.filter((r) => blockers.includes(r.number) && (r.status === 'open' || r.status === 'late')).map((r) => r.number),
  };
}

/** Interfaces nav badge (`ifcBadge`): the number of late interfaces, '' when none. */
export const interfacesBadge = (rows: readonly Pick<InterfaceFacts, 'status'>[]) => {
  const n = rows.filter((r) => r.status === 'late').length;
  return n ? String(n) : '';
};

// ── Form parsing (AF.stakeholders "Add", AF.interfaces "Register") ───────────────────────────────────────

const MAX_TEXT = 200;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (v: string | undefined) => (v ?? '').trim();

/** A select value: the stable code, or (prototype payloads) its English label. */
function codeOf<C extends string>(v: string, codec: { isCode: (x: unknown) => x is C; labels: readonly string[]; code: (l: string) => C }): C | null {
  if (codec.isCode(v)) return v;
  return codec.labels.includes(v) ? codec.code(v) : null;
}

/** Owner select (TEAM): the first option when blank; must be one of the options. */
function ownerOf(v: string | undefined, team: readonly string[]): ParseResult<string> {
  const owner = text(v) || team[0] || '';
  if (!owner || !team.includes(owner)) return { ok: false, error: 'Unknown owner' };
  return { ok: true, value: owner };
}

export interface NewStakeholderValues {
  name: string;
  organisation: string;
  role: string;
  type: StakeholderType;
  /** null when not given. */
  contactEmail: string | null;
  /** Relationship owner (a TEAM option). */
  owner: string;
}

/**
 * "Add stakeholder": name and organisation required; role optional; type defaults to Client; the e-mail, when
 * given, must look like an address (the prototype accepted anything, 05 §6.5); owner from the TEAM list.
 */
export function parseNewStakeholder(values: Record<string, string | undefined>, team: readonly string[]): ParseResult<NewStakeholderValues> {
  const name = text(values.name);
  if (!name) return { ok: false, error: 'Name is required' };
  const organisation = text(values.org);
  if (!organisation) return { ok: false, error: 'Organisation is required' };
  const role = text(values.role);
  if ([name, organisation, role].some((x) => x.length > MAX_TEXT)) return { ok: false, error: 'Text is too long' };
  const type = codeOf(text(values.type) || STAKEHOLDER_TYPES[0], stakeholderType);
  if (!type) return { ok: false, error: 'Unknown stakeholder type' };
  const contact = text(values.contact);
  if (contact && (contact.length > MAX_TEXT || !EMAIL.test(contact))) return { ok: false, error: 'Enter a valid e-mail address' };
  const owner = ownerOf(values.owner, team);
  if (!owner.ok) return owner;
  return { ok: true, value: { name, organisation, role, type, contactEmail: contact || null, owner: owner.value } };
}

export interface NewInterfaceValues {
  title: string;
  keystoneSide: KeystoneSide;
  otherParty: string;
  dataExpected: string;
  /** ISO need date. */
  neededBy: string;
  owner: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, janv: 1, janvier: 1,
  feb: 2, february: 2, fev: 2, fevr: 2, fevrier: 2,
  mar: 3, march: 3, mars: 3,
  apr: 4, april: 4, avr: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juin: 6,
  jul: 7, july: 7, juil: 7, juillet: 7,
  aug: 8, august: 8, aou: 8, aout: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12,
};

const pad2 = (n: number) => String(n).padStart(2, '0');

function isoOf(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

const yearOf = (s: string | undefined, defaultYear: number) => {
  if (!s) return defaultYear;
  const y = s.replace(/^[’']/, '');
  return /^\d{2}$/.test(y) ? 2000 + parseInt(y, 10) : /^\d{4}$/.test(y) ? parseInt(y, 10) : NaN;
};

/**
 * "Needed by" as typed: "15 Oct", "15 Oct 2026", "15 oct. 2026", "15 octobre", "15/10/2026", "15/10" or ISO
 * "2026-10-15". A date without a year is in `defaultYear`, the business date's year (R-013; the prototype appended " 2026",
 * the data set's year). Null when not a date.
 */
export function parseNeedDate(input: string | undefined, defaultYear: number): string | null {
  const s = text(input)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return isoOf(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.](\d{1,2})(?:[/.]([’']?\d{2}|\d{4}))?$/.exec(s);
  if (m) return isoOf(yearOf(m[3], defaultYear), +m[2], +m[1]);
  m = /^(\d{1,2})(?:er)?\s+([a-z]+)\.?(?:\s+([’']?\d{2}|\d{4}))?$/.exec(s);
  if (m && MONTHS[m[2]]) return isoOf(yearOf(m[3], defaultYear), MONTHS[m[2]], +m[1]);
  return null;
}

/**
 * "New interface": interface, other party, data expected and need date required (the need date must be a date —
 * the prototype stored any text and showed no lateness for it); Keystone side defaults to Process; owner from TEAM.
 */
export function parseNewInterface(values: Record<string, string | undefined>, team: readonly string[], year: number): ParseResult<NewInterfaceValues> {
  const title = text(values.title);
  if (!title) return { ok: false, error: 'Interface is required' };
  const otherParty = text(values.b);
  if (!otherParty) return { ok: false, error: 'Other party is required' };
  const dataExpected = text(values.data);
  if (!dataExpected) return { ok: false, error: 'Data expected is required' };
  if ([title, otherParty, dataExpected].some((x) => x.length > MAX_TEXT)) return { ok: false, error: 'Text is too long' };
  const needed = text(values.needed);
  if (!needed) return { ok: false, error: 'Needed by is required' };
  const neededBy = parseNeedDate(needed, year);
  if (!neededBy) return { ok: false, error: 'Enter the need date as a date, e.g. 15 Oct' };
  const side = codeOf(text(values.a) || KEYSTONE_SIDES[0], keystoneSide);
  if (!side) return { ok: false, error: 'Unknown Keystone side' };
  const owner = ownerOf(values.owner, team);
  if (!owner.ok) return owner;
  return { ok: true, value: { title, keystoneSide: side, otherParty, dataExpected, neededBy, owner: owner.value } };
}

/** "Mark received" refused: a received date after today (Q-4 a, R-116). EN source string. */
export const RECEIVED_AFTER_TODAY = 'The received date cannot be after today';

/**
 * "Received on" of "Mark received" (Q-4 a, R-116): a date as typed in either language (parseDateInput, the business year
 * by default) → ISO; empty or unreadable → DATE_ERROR; after `today` (the business date, R-013) refused.
 */
export function parseReceivedOn(raw: string | undefined, today: string): ParseResult<string> {
  const iso = parseDateInput(raw, yearOfIso(today));
  if (!iso) return { ok: false, error: DATE_ERROR };
  if (iso > today) return { ok: false, error: RECEIVED_AFTER_TODAY };
  return { ok: true, value: iso };
}

/** English status label of an interface ("Late"). */
export const interfaceStatusLabel = (s: InterfaceEffectiveStatus) => interfaceStatus.label(s);
