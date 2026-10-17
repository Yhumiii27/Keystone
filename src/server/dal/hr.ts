import 'server-only';
// HR DAL (docs/spec/06 §2–5, 11 §3.3 PublicHoliday, §3.6): the dated rate grid (R-083 — roles, multipliers and their
// versions; the legacy job-title rates are retired), skills matrix and certifications, leave and the working calendar
// (absences received from Cursus, R-031), Lucca hours reconciliation — and their writers (rates, multipliers, roles, skills,
// Cursus absences, hours import / assignment).
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { cache } from 'react';
import {
  RATE_CARD_OBJECT, canEditRates, isExternalRole, parseEffectiveDate, rateActivityText, rateAt, rateChangeText, versionAt, type RateGrid,
} from '@/domain/hr';
import { businessToday } from '@/server/clock';
import { getDb, type DB, type Tx } from '@/server/db/client';
import {
  addDaysIso, displayOfIso, dowOfIso, hoursMatching, leaveType, slugOf, weekLabelOfIso,
  type HoursMatching, type LeaveType, type RateMultiplierKey,
} from '@/server/db/codes';
import { findPerson, nameOf, requireProject, writeAudit } from '@/server/db/helpers';
import {
  allocations, certifications, cursusEvents, hoursImports, hoursLines, leaveEntries, leaveTypes, personSkills, persons, publicHolidays,
  rateMultiplierRates, rateMultipliers, rateRoleRates, rateRoles, skills, unassignedHours, wbsNodes,
} from '@/server/db/schema';
import { absenceWeeks } from '@/domain/absences';
import { workingDaysOf } from '@/domain/load-window';
import { leaveWeekDays, type LeaveDayKind } from '@/domain/load-week';
import { trace, whoIs, type Actor } from './ops-common';
import { editsProjectScreen } from './team-guard';
import type { ResourceWeek } from './resources';
import { ensureSettingsEntry, hiddenSkillNames, settingsHolidayRows } from './settings-lists';

export type { RateGrid };

// ── Rate grid (dated — R-083: A-10, R-4a, R-4b; rights P-12 c, R-044) ──────────────────────────────────────────────────

/** Refusal of a rate-grid write by anyone but the director and Finance (P-12 c: PMs read). EN source; FR in d8-roles-rates-hr. */
export const RATES_EDIT_REFUSED = 'Rates are edited by the portfolio director and Finance';

/** Reads the dated grid: roles and multipliers in their order, each with its versions oldest first. */
export async function readRateGrid(q: DB | Tx): Promise<RateGrid> {
  const [roles, roleRates, mults, multRates] = await Promise.all([
    q.select().from(rateRoles).orderBy(asc(rateRoles.position)),
    q.select().from(rateRoleRates).orderBy(asc(rateRoleRates.effectiveFrom)),
    q.select().from(rateMultipliers).orderBy(asc(rateMultipliers.position)),
    q.select().from(rateMultiplierRates).orderBy(asc(rateMultiplierRates.effectiveFrom)),
  ]);
  return {
    roles: roles.map((r) => ({
      id: r.id, role: r.role, isExternal: r.isExternal, costCenter: r.costCenter, grade: r.grade,
      versions: roleRates.filter((v) => v.rateRoleId === r.id).map((v) => ({ effectiveFrom: v.effectiveFrom, value: v.baseRateEur })),
    })),
    multipliers: mults.map((m) => ({
      key: m.key, label: m.label, versions: multRates.filter((v) => v.key === m.key).map((v) => ({ effectiveFrom: v.effectiveFrom, value: v.factor })),
    })),
  };
}

/** The dated rate grid (one read per request) — `rateAt` / `multiplierAt` (src/domain/hr.ts) value hours with it. */
export const getRateGrid = cache(async (): Promise<RateGrid> => readRateGrid(await getDb()));

export interface RateVersionRow {
  effectiveFrom: string;
  value: number;
}

export interface RateRoleRow {
  role: string;
  /** Base €/h in force on the card's date; null when the role has no version yet on that date. */
  baseRateEur: number | null;
  isExternal: boolean;
  costCenter: string | null;
  grade: string | null;
  /** Effective date of the version in force ("since"); null when none. */
  effectiveFrom: string | null;
  /** Every version, oldest first. */
  versions: RateVersionRow[];
}

export interface MultiplierRow {
  key: RateMultiplierKey;
  /** EN source string ("Overtime > 8 h/day"). */
  label: string;
  /** Factor in force on the card's date; null when none. */
  factor: number | null;
  effectiveFrom: string | null;
  versions: RateVersionRow[];
}

export interface RateCard {
  /** The date the card shows the grid on (ISO). */
  on: string;
  /** RATE_ROLES order. */
  roles: RateRoleRow[];
  /** MULTS order. */
  multipliers: MultiplierRow[];
}

/**
 * Rate card on a date (Rate cards screen and export; default the business date): each role's base rate and each multiplier's
 * factor in force on `on`, with every version. Values are for the roles that see rates only — the screen and the export mask them.
 */
export async function getRateCard(date?: string): Promise<RateCard> {
  const [grid, on] = await Promise.all([getRateGrid(), date ?? businessToday()]);
  return {
    on,
    roles: grid.roles.map((r) => {
      const v = versionAt(r.versions, on);
      return { role: r.role, baseRateEur: v?.value ?? null, isExternal: r.isExternal, costCenter: r.costCenter, grade: r.grade, effectiveFrom: v?.effectiveFrom ?? null, versions: r.versions };
    }),
    multipliers: grid.multipliers.map((m) => {
      const v = versionAt(m.versions, on);
      return { key: m.key, label: m.label, factor: v?.value ?? null, effectiveFrom: v?.effectiveFrom ?? null, versions: m.versions };
    }),
  };
}

/** Writers of the grid: the director and Finance only (P-12 c, R-044) — re-checked here with the actor (defense in depth). */
function requireRateEditor(actor: Actor): void {
  if (!canEditRates(actor.role)) throw new Error(RATES_EDIT_REFUSED);
}

/**
 * Audit + activity of a grid change (area Settings, object "Rate card" as before R-083). R-046: the values are in the audit
 * change only (masked on Activity & integrations for the roles that do not see rates); the activity text has none.
 */
async function traceRate(tx: Tx, actor: Actor, change: string, activity: string): Promise<void> {
  await trace(tx, await whoIs(tx, actor), { objectRef: RATE_CARD_OBJECT, change, area: 'Settings', activity: { text: `${RATE_CARD_OBJECT} · ${activity}`, kind: 'change' } });
}

/**
 * Upserts the version of a role (or multiplier) for `effectiveFrom`: the version of that date is updated, else a new one is
 * added — unless the value is already the one in force on that date (no redundant version). Returns the value in force before
 * on that date (null when none), or undefined when nothing changed.
 */
async function upsertVersion(
  existing: { effectiveFrom: string; value: number; id: string }[], effectiveFrom: string, value: number,
  write: { update: (id: string) => Promise<unknown>; insert: () => Promise<unknown> },
): Promise<{ from: number | null } | undefined> {
  const inForce = versionAt(existing, effectiveFrom);
  if (inForce && inForce.value === value) return undefined;
  if (inForce && inForce.effectiveFrom === effectiveFrom) await write.update(inForce.id);
  else await write.insert();
  return { from: inForce?.value ?? null };
}

/**
 * Base €/h of a role from `effectiveFrom` (R-083: an explicit date, the business date by default in the UI). Audit "Planner
 * base: 74 → 78 €/h from 1 Nov 2026" ("(backdated)" before the business date — earlier hours are revalued).
 */
export async function setBaseRate(role: string, rateEur: number, effectiveFrom: string, actor: Actor): Promise<void> {
  requireRateEditor(actor);
  if (!parseEffectiveDate(effectiveFrom)) throw new Error('Invalid effective date');
  if (!Number.isFinite(rateEur) || rateEur < 0) throw new Error('Enter a valid hourly rate');
  const db = await getDb();
  const today = await businessToday();
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(rateRoles).where(eq(rateRoles.role, role));
    if (!r) throw new Error(`Unknown rate role ${role}`);
    const versions = (await tx.select().from(rateRoleRates).where(eq(rateRoleRates.rateRoleId, r.id)).for('update'))
      .map((v) => ({ id: v.id, effectiveFrom: v.effectiveFrom, value: v.baseRateEur }));
    const who = await whoIs(tx, actor);
    const done = await upsertVersion(versions, effectiveFrom, rateEur, {
      update: (id) => tx.update(rateRoleRates).set({ baseRateEur: rateEur, createdByName: who.who, createdByPersonId: who.personId, createdAt: new Date() }).where(eq(rateRoleRates.id, id)),
      insert: () => tx.insert(rateRoleRates).values({ rateRoleId: r.id, effectiveFrom, baseRateEur: rateEur, createdByName: who.who, createdByPersonId: who.personId }),
    });
    if (!done) return;
    const on = displayOfIso(effectiveFrom);
    const backdated = effectiveFrom < today;
    await traceRate(tx, actor, rateChangeText(`${role} base`, done.from, rateEur, '€/h', on, backdated), rateActivityText(`${role} base`, on, backdated));
  });
}

/** Premium multiplier from `effectiveFrom` (R-083). Audit "Saturday multiplier: ×1.5 → ×1.6 from 1 Jan 2027". */
export async function setMultiplier(key: RateMultiplierKey, factor: number, effectiveFrom: string, actor: Actor): Promise<void> {
  requireRateEditor(actor);
  if (!parseEffectiveDate(effectiveFrom)) throw new Error('Invalid effective date');
  if (!Number.isFinite(factor) || factor < 0) throw new Error('Enter a valid multiplier');
  const db = await getDb();
  const today = await businessToday();
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(rateMultipliers).where(eq(rateMultipliers.key, key));
    if (!m) throw new Error(`Unknown multiplier ${key}`);
    const versions = (await tx.select().from(rateMultiplierRates).where(eq(rateMultiplierRates.key, key)).for('update'))
      .map((v) => ({ id: v.id, effectiveFrom: v.effectiveFrom, value: v.factor }));
    const who = await whoIs(tx, actor);
    const done = await upsertVersion(versions, effectiveFrom, factor, {
      update: (id) => tx.update(rateMultiplierRates).set({ factor, createdByName: who.who, createdByPersonId: who.personId, createdAt: new Date() }).where(eq(rateMultiplierRates.id, id)),
      insert: () => tx.insert(rateMultiplierRates).values({ key, effectiveFrom, factor, createdByName: who.who, createdByPersonId: who.personId }),
    });
    if (!done) return;
    const on = displayOfIso(effectiveFrom);
    const backdated = effectiveFrom < today;
    await traceRate(tx, actor, rateChangeText(`${m.label} multiplier`, done.from, factor, '×', on, backdated), rateActivityText(`${m.label} multiplier`, on, backdated));
  });
}

/**
 * "Add role" (AF.rates): appends a role to the grid with its first version from `effectiveFrom` (cost centre and grade are
 * information only, R-4b). A role name already on the grid is refused.
 */
export async function addRateRole(
  input: { role: string; rateEur: number; costCenter?: string; grade?: string; effectiveFrom: string }, actor: Actor,
): Promise<void> {
  requireRateEditor(actor);
  if (!parseEffectiveDate(input.effectiveFrom)) throw new Error('Invalid effective date');
  if (!Number.isFinite(input.rateEur) || input.rateEur < 0) throw new Error('Enter a valid hourly rate');
  const role = input.role.trim();
  if (!role) throw new Error('Role is required');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: rateRoles.id }).from(rateRoles).where(sql`lower(${rateRoles.role}) = ${role.toLowerCase()}`);
    if (dup) throw new Error('This role is already on the rate card');
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${rateRoles.position}), 0)::int` }).from(rateRoles);
    const [r] = await tx
      .insert(rateRoles)
      .values({ role, isExternal: isExternalRole(role), costCenter: input.costCenter ?? null, grade: input.grade ?? null, position: pos + 1 })
      .returning({ id: rateRoles.id });
    const who = await whoIs(tx, actor);
    await tx.insert(rateRoleRates).values({ rateRoleId: r.id, effectiveFrom: input.effectiveFrom, baseRateEur: input.rateEur, createdByName: who.who, createdByPersonId: who.personId });
    await traceRate(tx, actor, `role added: ${role} · ${input.rateEur} €/h from ${displayOfIso(input.effectiveFrom)}`, `role added: ${role} from ${displayOfIso(input.effectiveFrom)}`);
  });
}

async function auditSettings(tx: Tx, actorName: string, objectRef: string, change: string, area = 'Settings') {
  const actor = await findPerson(tx, actorName);
  await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef, change, area });
}

// ── Skills ─────────────────────────────────────────────────────────────────────────────────────────────

export interface SkillsMatrix {
  /** SKILLS order (matrix columns). */
  skills: { name: string; category: string | null }[];
  /** Resource pool order; levels align with `skills` (0 = none). */
  people: { name: string; shortName: string; initials: string; jobTitle: string | null; levels: number[]; certifications: string[]; certText: string | null }[];
}

/** People × skills levels and certifications (Skills matrix). */
export async function getSkillsMatrix(): Promise<SkillsMatrix> {
  const db = await getDb();
  const [allSkills, people, levels, certs, hidden] = await Promise.all([
    db.select().from(skills).orderBy(asc(skills.position)),
    db.select().from(persons).where(sql`${persons.resourcePoolPosition} is not null`).orderBy(asc(persons.resourcePoolPosition)),
    db.select().from(personSkills),
    db.select().from(certifications).orderBy(asc(certifications.position)),
    hiddenSkillNames(db),
  ]);
  // Chapter 4 (A-14): a skill family removed in Settings › Skills & levels hides its column (levels are kept).
  const sk = allSkills.filter((s) => !hidden.has(s.name.toLowerCase()));
  return {
    skills: sk.map((s) => ({ name: s.name, category: s.category })),
    people: people.map((p) => {
      const own = certs.filter((c) => c.personId === p.id).map((c) => c.name);
      return {
        name: p.fullName ?? p.shortName, shortName: p.shortName, initials: p.initials, jobTitle: p.jobTitle,
        levels: sk.map((s) => levels.find((l) => l.personId === p.id && l.skillId === s.id)?.level ?? 0),
        certifications: own, certText: own.length ? own.join(' · ') : null,
      };
    }),
  };
}

/** "Add skill" (AF.skills — the prototype only toasts): appends a skill family (a new matrix column, all levels 0). */
export async function addSkill(input: { name: string; category?: string }, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${skills.position}), 0)::int` }).from(skills);
    await tx.insert(skills).values({ name: input.name.trim(), category: input.category ?? null, position: pos + 1 });
    // Chapter 4 (A-14): the skill family is also offered by Settings › Skills & levels.
    await ensureSettingsEntry(tx, 'skills', input.name.trim(), slugOf(input.name.trim()));
    await auditSettings(tx, actorName, 'Skills', `skill added: ${input.name.trim()}`);
  });
}

// ── Leave & working calendar ───────────────────────────────────────────────────────────────────────────

export interface HolidayRow {
  date: string;
  name: string;
  /** "11 Nov · Armistice" (SETTINGS0.holidays form). */
  label: string;
}

export interface LeaveWeekCell {
  type: LeaveType | null;
  /** "Leave" / "Absence" (NEW-CURSUS-4: never the reason). */
  typeLabel: string | null;
  /** Working days lost to leave that week (every absence of the week added up, at most 5). */
  days: number;
  /** Public holidays on a weekday of that week. */
  holidays: number;
}

export interface LeaveCalendar {
  weeks: ResourceWeek[];
  /** Weekday public holidays inside the window, with their week index (HOLIDAYS = {6: '11 Nov · Armistice'}). */
  holidays: (HolidayRow & { weekIndex: number })[];
  leaveTypes: { code: LeaveType; label: string; days: number }[];
  /** Resource pool order. */
  people: { name: string; shortName: string; initials: string; jobTitle: string | null; weeks: LeaveWeekCell[] }[];
  /** R-031: when Keystone last received an absence from Cursus (ISO timestamp); null when none yet. */
  lastAbsenceReceivedAt: string | null;
}

/**
 * Public holidays of a country. France reads Settings › Public holidays (chapter 4, A-14: the company list drives the
 * leave calendar as it drives the work calendars); other countries keep the public_holidays table.
 */
export async function listPublicHolidays(countryCode = 'FR'): Promise<HolidayRow[]> {
  const db = await getDb();
  const rows = countryCode === 'FR'
    ? await settingsHolidayRows(db)
    : await db.select().from(publicHolidays).where(eq(publicHolidays.countryCode, countryCode)).orderBy(asc(publicHolidays.position));
  return rows.map((h) => ({ date: h.date, name: h.name, label: `${displayOfIso(h.date).replace(/ \d{4}$/, '')} · ${h.name}` }));
}

/**
 * Leave grid over the load window (Leave & calendar; read-only mirror of the absences received from Cursus, R-031).
 * `weeks` = the window's Mondays (R-085, `getLoadWindow`: any week — the absences and holidays of that week, none otherwise);
 * omitted = every week with an allocation row (the former rule). Several absences of a person in one week add up (at most
 * the 5 days of the week); the cell shows the type with the most days (Leave on a tie).
 */
export async function getLeaveCalendar(countryCode = 'FR', weeks?: readonly string[]): Promise<LeaveCalendar> {
  const db = await getDb();
  const [weekRows, types, people, entries, hols, [last]] = await Promise.all([
    weeks
      ? Promise.resolve(weeks.map((w) => ({ w })))
      : db.selectDistinct({ w: allocations.weekStart }).from(allocations).where(isNull(allocations.projectId)).orderBy(asc(allocations.weekStart)),
    db.select().from(leaveTypes).orderBy(asc(leaveTypes.position)),
    db.select().from(persons).where(sql`${persons.resourcePoolPosition} is not null`).orderBy(asc(persons.resourcePoolPosition)),
    db.select().from(leaveEntries),
    listPublicHolidays(countryCode),
    db.select({ at: sql<string | null>`max(${cursusEvents.receivedAt})` }).from(cursusEvents).where(eq(cursusEvents.type, 'absence.validee')),
  ]);
  const shown = weekRows.map((r) => ({ start: r.w, label: weekLabelOfIso(r.w) }));
  const weekOf = (iso: string) => shown.findIndex((w) => iso >= w.start && iso <= addDaysIso(w.start, 6));
  const holidays = hols.map((h) => ({ ...h, weekIndex: weekOf(h.date) })).filter((h) => h.weekIndex >= 0 && dowOfIso(h.date) >= 1 && dowOfIso(h.date) <= 5);
  return {
    weeks: shown, holidays,
    leaveTypes: types.map((t) => ({ code: t.code, label: t.label, days: t.daysPerWeek })),
    people: people.map((p) => ({
      name: p.fullName ?? p.shortName, shortName: p.shortName, initials: p.initials, jobTitle: p.jobTitle,
      weeks: shown.map((w, i) => {
        const es = entries.filter((x) => x.personId === p.id && x.weekStart === w.start);
        const byType = new Map<LeaveType, number>();
        for (const e of es) byType.set(e.leaveType, (byType.get(e.leaveType) ?? 0) + e.days);
        const type = [...byType].sort((a, b) => b[1] - a[1] || (a[0] === 'leave' ? -1 : 1))[0]?.[0] ?? null;
        return {
          type, typeLabel: type ? leaveType.label(type) : null, days: Math.min(5, es.reduce((n, e) => n + e.days, 0)), holidays: holidays.filter((h) => h.weekIndex === i).length,
        };
      }),
    })),
    lastAbsenceReceivedAt: last?.at ? new Date(last.at).toISOString() : null,
  };
}

/** Week view of Leave & working calendar (owner answers 17 Oct 2026): one week, day by day. */
export interface LeaveWeek {
  /** Monday of the week shown. */
  week: ResourceWeek;
  /** Monday to Friday: ISO date and the public holiday of that day (Settings), if any. */
  days: { date: string; holiday: HolidayRow | null }[];
  /** Resource pool order; one cell per working day. */
  people: { name: string; shortName: string; initials: string; jobTitle: string | null; days: LeaveDayKind[]; daysOff: number; holidays: number; availH: number }[];
  /** R-031: when Keystone last received an absence from Cursus (ISO timestamp); null when none yet. */
  lastAbsenceReceivedAt: string | null;
}

/**
 * Leave & working calendar, week view (owner answers 17 Oct 2026: "une vision à la semaine"): the absences received from
 * Cursus day by day — each `leave_entries` row carries its own dates inside its week (`start_date` / `end_date`), so the
 * granularity is the day — and the weekday public holidays of Settings. Rule: `leaveWeekDays` (src/domain/load-week.ts).
 */
export async function getLeaveWeek(countryCode: string, weekStart: string): Promise<LeaveWeek> {
  const db = await getDb();
  const days = workingDaysOf(weekStart);
  const friday = days[days.length - 1];
  const [people, entries, hols, [last]] = await Promise.all([
    db.select().from(persons).where(sql`${persons.resourcePoolPosition} is not null`).orderBy(asc(persons.resourcePoolPosition)),
    db.select().from(leaveEntries).where(and(lte(leaveEntries.startDate, friday), gte(leaveEntries.endDate, weekStart))),
    listPublicHolidays(countryCode),
    db.select({ at: sql<string | null>`max(${cursusEvents.receivedAt})` }).from(cursusEvents).where(eq(cursusEvents.type, 'absence.validee')),
  ]);
  const holidayOn = new Map(hols.filter((h) => h.date >= weekStart && h.date <= friday).map((h) => [h.date, h]));
  const holidaySet = new Set(holidayOn.keys());
  return {
    week: { start: weekStart, label: weekLabelOfIso(weekStart) },
    days: days.map((date) => ({ date, holiday: holidayOn.get(date) ?? null })),
    people: people.map((p) => {
      const spans = entries.filter((e) => e.personId === p.id).map((e) => ({ type: e.leaveType, start: e.startDate, end: e.endDate }));
      const w = leaveWeekDays(spans, days, holidaySet);
      return { name: p.fullName ?? p.shortName, shortName: p.shortName, initials: p.initials, jobTitle: p.jobTitle, ...w };
    }),
    lastAbsenceReceivedAt: last?.at ? new Date(last.at).toISOString() : null,
  };
}

export interface CursusAbsence {
  personId: string;
  type: LeaveType;
  /** ISO dates, inclusive. */
  start: string;
  end: string;
  /** Replacement key (src/domain/absences.ts `absenceKey`). */
  key: string;
}

/**
 * Writes an absence received from Cursus (R-031, NEW-CURSUS-4 / NEW-CURSUS-7): replaces the rows of its key, one row per
 * week it covers (source "cursus"), the week's working days minus the public holidays of Settings. The reason is never
 * stored. Runs in the caller's transaction (the event inbox's): it never opens a connection of its own. Returns the
 * weeks written.
 */
export async function replaceCursusAbsence(q: DB | Tx, a: CursusAbsence): Promise<number> {
  const holidays = new Set((await settingsHolidayRows(q)).map((h) => h.date));
  const weeks = absenceWeeks(a.start, a.end, holidays);
  await q.delete(leaveEntries).where(eq(leaveEntries.externalId, a.key));
  if (weeks.length)
    await q.insert(leaveEntries).values(weeks.map((w) => ({
      personId: a.personId, leaveType: a.type, weekStart: w.weekStart, startDate: w.startDate, endDate: w.endDate, days: w.days, status: 'approved', source: 'cursus',
      externalId: a.key,
    })));
  return weeks.length;
}

// ── Hours (Lucca reconciliation) ───────────────────────────────────────────────────────────────────────

export interface HoursLineRow {
  person: string;
  personShort: string;
  initials: string;
  /** "1.3". */
  wbsCode: string;
  /** "1.3 · Foundations". */
  wbsLabel: string;
  plannedH: number;
  declaredH: number;
  /**
   * A-10 (R-083): the person's grid rate in force on the import's month (null: no rate role or no version — not valued). For the
   * Variance KPI only; the hours screen is a Server Component and never sends it to the browser.
   */
  rateEur: number | null;
}

export interface HoursGroup {
  /** Person name (by resource) or WBS label (by work package). */
  label: string;
  /** Initials or WBS code. */
  avatar: string;
  /** By resource: the person's WBS labels joined " · "; by WP: the people's short names joined " · ". */
  sub: string;
  plannedH: number;
  declaredH: number;
  lines: HoursLineRow[];
}

export interface HoursReconciliation {
  projectCode: string;
  analyticCode: string;
  /** First day of the month and its label ("September 2026"). */
  periodStart: string;
  periodLabel: string;
  importedOn: string;
  /** "29 Sep 2026". */
  importedText: string;
  matchingMode: HoursMatching;
  matchingLabel: string;
  lines: HoursLineRow[];
  /** Groups in order of first appearance (no sorting, as in the prototype). */
  byResource: HoursGroup[];
  byWorkPackage: HoursGroup[];
  unassigned: { person: string; personShort: string; initials: string; hours: number; reason: string; assignedWbs: string | null }[];
  /** Level-1 work packages for the "Assign" select ("1.1 · Design & permits"). */
  workPackages: { code: string; name: string; label: string }[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function group(lines: HoursLineRow[], keyOf: (l: HoursLineRow) => string, avatarOf: (l: HoursLineRow) => string, subOf: (l: HoursLineRow) => string): HoursGroup[] {
  const out: HoursGroup[] = [];
  for (const l of lines) {
    let g = out.find((x) => x.label === keyOf(l));
    if (!g) out.push((g = { label: keyOf(l), avatar: avatarOf(l), sub: '', plannedH: 0, declaredH: 0, lines: [] }));
    g.lines.push(l);
    g.plannedH += l.plannedH;
    g.declaredH += l.declaredH;
  }
  for (const g of out) g.sub = [...new Set(g.lines.map(subOf))].join(' · ');
  return out;
}

/** Latest Lucca import of a project with its reconciliation; null when the project has none ("No Lucca import…"). */
export async function getHoursReconciliation(projectCode: string): Promise<HoursReconciliation | null> {
  const db = await getDb();
  const p = await requireProject(db, projectCode).catch(() => null);
  if (!p) return null;
  const [imp] = await db.select().from(hoursImports).where(eq(hoursImports.projectId, p.id)).orderBy(sql`${hoursImports.periodStart} desc`).limit(1);
  if (!imp) return null;
  const [lines, un, wps, grid] = await Promise.all([
    db
      .select({ l: hoursLines, full: persons.fullName, short: persons.shortName, initials: persons.initials, rateRoleId: persons.rateRoleId })
      .from(hoursLines)
      .innerJoin(persons, eq(persons.id, hoursLines.personId))
      .where(eq(hoursLines.importId, imp.id))
      .orderBy(asc(hoursLines.position)),
    db
      .select({ u: unassignedHours, full: persons.fullName, short: persons.shortName, initials: persons.initials, wbs: wbsNodes.code })
      .from(unassignedHours)
      .innerJoin(persons, eq(persons.id, unassignedHours.personId))
      .leftJoin(wbsNodes, eq(wbsNodes.id, unassignedHours.assignedWbsNodeId))
      .where(eq(unassignedHours.importId, imp.id))
      .orderBy(asc(unassignedHours.position)),
    db.select({ code: wbsNodes.code, name: wbsNodes.name }).from(wbsNodes).where(and(eq(wbsNodes.projectId, p.id), eq(wbsNodes.level, 1))).orderBy(asc(wbsNodes.position)),
    getRateGrid(),
  ]);
  const rows: HoursLineRow[] = lines.map(({ l, full, short, initials, rateRoleId }) => ({
    person: full ?? short, personShort: short, initials, wbsCode: l.wbsLabel.split(' · ')[0], wbsLabel: l.wbsLabel, plannedH: l.plannedH, declaredH: l.declaredH,
    rateEur: rateAt(grid, rateRoleId, imp.periodStart),
  }));
  return {
    projectCode, analyticCode: imp.analyticCode, periodStart: imp.periodStart, periodLabel: `${MONTHS[+imp.periodStart.slice(5, 7) - 1]} ${imp.periodStart.slice(0, 4)}`,
    importedOn: imp.importedOn, importedText: displayOfIso(imp.importedOn), matchingMode: imp.matchingMode, matchingLabel: hoursMatching.label(imp.matchingMode),
    lines: rows,
    byResource: group(rows, (l) => l.person, (l) => l.initials, (l) => l.wbsLabel),
    byWorkPackage: group(rows, (l) => l.wbsLabel, (l) => l.wbsCode, (l) => l.personShort),
    unassigned: un.map(({ u, full, short, initials, wbs }) => ({ person: full ?? short, personShort: short, initials, hours: u.hours, reason: u.reason, assignedWbs: wbs })),
    workPackages: wps.map((w) => ({ code: w.code, name: w.name, label: `${w.code} · ${w.name}` })),
  };
}

/** Refusal of an hours write (EN source, as the Server Functions'). */
export const HOURS_READ_ONLY = 'Hours are read-only for you on this project';

/**
 * Writers of the Hours screen re-check the project rule with the actor (defense in depth, delivery 8): the Hours screen in the
 * actor's workspace, on the project's team (or the director), never Finance (R-044: reads Hours).
 */
async function requireHoursEditor(tx: Tx, actor: Actor, projectId: string): Promise<void> {
  if (!(await editsProjectScreen(tx, actor, projectId, 'hours'))) throw new Error(HOURS_READ_ONLY);
}

/**
 * "Import Lucca hours" (AF.hours): re-stamps the latest import of the project with the business date (R-013; the prototype
 * only flipped the date to 30 Sep 2026; no lines are fetched — the Lucca connector is not modelled).
 */
export async function markHoursImported(
  projectCode: string, input: { analyticCode?: string; matchingMode?: HoursMatching; importedOn?: string }, actor: Actor,
): Promise<void> {
  const actorName = actor.name;
  const db = await getDb();
  const importedOn = input.importedOn ?? (await businessToday());
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    await requireHoursEditor(tx, actor, p.id);
    const [imp] = await tx.select().from(hoursImports).where(eq(hoursImports.projectId, p.id)).orderBy(sql`${hoursImports.periodStart} desc`).limit(1);
    if (!imp) return;
    await tx
      .update(hoursImports)
      .set({ importedOn, analyticCode: input.analyticCode ?? imp.analyticCode, matchingMode: input.matchingMode ?? imp.matchingMode, updatedAt: new Date() })
      .where(eq(hoursImports.id, imp.id));
    const person = await findPerson(tx, actorName);
    await writeAudit(tx, { actorName: person ? nameOf(person) : actorName, actorPersonId: person?.id, objectRef: `Hours ${imp.analyticCode}`, change: 'Lucca import', area: 'Hours', entityType: 'hours_import', entityId: imp.id, projectId: p.id });
  });
}

/** "Assign" of an unassigned line (by its position in the list) to a work package (OPEN QUESTION R-6). */
export async function assignUnassignedHours(projectCode: string, position: number, wbsCode: string, actor: Actor): Promise<void> {
  const actorName = actor.name;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    await requireHoursEditor(tx, actor, p.id);
    const [imp] = await tx.select().from(hoursImports).where(eq(hoursImports.projectId, p.id)).orderBy(sql`${hoursImports.periodStart} desc`).limit(1);
    if (!imp) throw new Error(`No Lucca import for ${projectCode}`);
    const [node] = await tx.select({ id: wbsNodes.id }).from(wbsNodes).where(and(eq(wbsNodes.projectId, p.id), eq(wbsNodes.code, wbsCode)));
    if (!node) throw new Error(`Unknown WBS ${wbsCode} on ${projectCode}`);
    const [u] = await tx.select().from(unassignedHours).where(and(eq(unassignedHours.importId, imp.id), eq(unassignedHours.position, position)));
    if (!u) throw new Error(`No unassigned line #${position}`);
    await tx.update(unassignedHours).set({ assignedWbsNodeId: node.id, assignedAt: new Date() }).where(eq(unassignedHours.id, u.id));
    const person = await findPerson(tx, actorName);
    await writeAudit(tx, { actorName: person ? nameOf(person) : actorName, actorPersonId: person?.id, objectRef: `Hours ${imp.analyticCode}`, change: `${u.hours} h assigned to WBS ${wbsCode}`, area: 'Hours', entityType: 'unassigned_hours', entityId: u.id, projectId: p.id });
  });
}
