import 'server-only';
// HR DAL (docs/spec/06 §2–5, 11 §3.3 PublicHoliday, §3.6): rate cards and multipliers (+ the legacy job-title
// rates), skills matrix and certifications, leave and the working calendar (absences received from Cursus, R-031), Lucca
// hours reconciliation — and their writers (rates, multipliers, roles, skills, Cursus absences, hours import / assignment).
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { getDb, type Tx } from '@/server/db/client';
import {
  addDaysIso, displayOfIso, dowOfIso, hoursMatching, leaveType, slugOf, weekLabelOfIso,
  type HoursMatching, type LeaveType, type RateMultiplierKey,
} from '@/server/db/codes';
import { findPerson, nameOf, requireProject, writeAudit } from '@/server/db/helpers';
import {
  allocations, certifications, cursusEvents, hoursImports, hoursLines, jobTitleRates, leaveEntries, leaveTypes, personSkills, persons, publicHolidays,
  rateMultipliers, rateRoles, skills, unassignedHours, wbsNodes,
} from '@/server/db/schema';
import type { DB } from '@/server/db/types';
import { absenceWeeks } from '@/domain/absences';
import type { ResourceWeek } from './resources';
import { ensureSettingsEntry, hiddenSkillNames, settingsHolidayRows } from './settings-lists';

// ── Rate cards ─────────────────────────────────────────────────────────────────────────────────────────

export interface RateRoleRow {
  role: string;
  baseRateEur: number;
  isExternal: boolean;
  costCenter: string | null;
  grade: string | null;
  effectiveFrom: string | null;
}

export interface MultiplierRow {
  key: RateMultiplierKey;
  /** EN source string ("Overtime > 8 h/day"). */
  label: string;
  factor: number;
}

export interface RateCard {
  /** RATE_ROLES order. */
  roles: RateRoleRow[];
  /** MULTS order. */
  multipliers: MultiplierRow[];
}

/** Rate card (Rate cards screen — values are for director and pm only; the screen masks them otherwise). */
export async function getRateCard(): Promise<RateCard> {
  const db = await getDb();
  const [roles, mults] = await Promise.all([
    db.select().from(rateRoles).orderBy(asc(rateRoles.position)),
    db.select().from(rateMultipliers).orderBy(asc(rateMultipliers.position)),
  ]);
  return {
    roles: roles.map((r) => ({ role: r.role, baseRateEur: r.baseRateEur, isExternal: r.isExternal, costCenter: r.costCenter, grade: r.grade, effectiveFrom: r.effectiveFrom })),
    multipliers: mults.map((m) => ({ key: m.key, label: m.label, factor: m.factor })),
  };
}

/** Legacy rate per job title (RATES) used by the Task cost note. */
export async function getJobTitleRates(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.select().from(jobTitleRates).orderBy(asc(jobTitleRates.position));
  return Object.fromEntries(rows.map((r) => [r.jobTitle, r.rateEur]));
}

async function auditSettings(tx: Tx, actorName: string, objectRef: string, change: string, area = 'Settings') {
  const actor = await findPerson(tx, actorName);
  await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef, change, area });
}

/** Base €/h edit (setRate: NaN → 0). Audit "Rate card · Structural engineer base: 82 → 85 €/h". */
export async function setBaseRate(role: string, rateEur: number, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(rateRoles).where(eq(rateRoles.role, role));
    if (!r) throw new Error(`Unknown rate role ${role}`);
    const v = Number.isFinite(rateEur) ? rateEur : 0;
    if (v === r.baseRateEur) return;
    await tx.update(rateRoles).set({ baseRateEur: v, updatedAt: new Date() }).where(eq(rateRoles.id, r.id));
    await auditSettings(tx, actorName, 'Rate card', `${role} base: ${r.baseRateEur} → ${v} €/h`);
  });
}

/** Multiplier edit (setMult: NaN → 0). */
export async function setMultiplier(key: RateMultiplierKey, factor: number, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(rateMultipliers).where(eq(rateMultipliers.key, key));
    if (!m) throw new Error(`Unknown multiplier ${key}`);
    const v = Number.isFinite(factor) ? factor : 0;
    if (v === m.factor) return;
    await tx.update(rateMultipliers).set({ factor: v, updatedAt: new Date() }).where(eq(rateMultipliers.key, key));
    await auditSettings(tx, actorName, 'Rate card', `${m.label} multiplier: ×${m.factor} → ×${v}`);
  });
}

/** "Add role" (AF.rates — the prototype only toasts): appends a role to the rate card. */
export async function addRateRole(input: { role: string; rateEur: number; costCenter?: string; grade?: string }, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${rateRoles.position}), 0)::int` }).from(rateRoles);
    const role = input.role.trim();
    await tx.insert(rateRoles).values({
      role, baseRateEur: input.rateEur, isExternal: /external/.test(role), costCenter: input.costCenter ?? null, grade: input.grade ?? null, position: pos + 1,
    });
    await auditSettings(tx, actorName, 'Rate card', `role added: ${role} · ${input.rateEur} €/h`);
  });
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
 * Leave grid over the resource window (Leave & calendar; read-only mirror of the absences received from Cursus, R-031).
 * Several absences of a person in one week add up (at most the 5 days of the week); the cell shows the type with the
 * most days (Leave on a tie).
 */
export async function getLeaveCalendar(countryCode = 'FR'): Promise<LeaveCalendar> {
  const db = await getDb();
  const [weekRows, types, people, entries, hols, [last]] = await Promise.all([
    db.selectDistinct({ w: allocations.weekStart }).from(allocations).where(isNull(allocations.projectId)).orderBy(asc(allocations.weekStart)),
    db.select().from(leaveTypes).orderBy(asc(leaveTypes.position)),
    db.select().from(persons).where(sql`${persons.resourcePoolPosition} is not null`).orderBy(asc(persons.resourcePoolPosition)),
    db.select().from(leaveEntries),
    listPublicHolidays(countryCode),
    db.select({ at: sql<string | null>`max(${cursusEvents.receivedAt})` }).from(cursusEvents).where(eq(cursusEvents.type, 'absence.validee')),
  ]);
  const weeks = weekRows.map((r) => ({ start: r.w, label: weekLabelOfIso(r.w) }));
  const weekOf = (iso: string) => weeks.findIndex((w) => iso >= w.start && iso <= addDaysIso(w.start, 6));
  const holidays = hols.map((h) => ({ ...h, weekIndex: weekOf(h.date) })).filter((h) => h.weekIndex >= 0 && dowOfIso(h.date) >= 1 && dowOfIso(h.date) <= 5);
  return {
    weeks, holidays,
    leaveTypes: types.map((t) => ({ code: t.code, label: t.label, days: t.daysPerWeek })),
    people: people.map((p) => ({
      name: p.fullName ?? p.shortName, shortName: p.shortName, initials: p.initials, jobTitle: p.jobTitle,
      weeks: weeks.map((w, i) => {
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
  const [lines, un, wps] = await Promise.all([
    db
      .select({ l: hoursLines, full: persons.fullName, short: persons.shortName, initials: persons.initials })
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
  ]);
  const rows: HoursLineRow[] = lines.map(({ l, full, short, initials }) => ({
    person: full ?? short, personShort: short, initials, wbsCode: l.wbsLabel.split(' · ')[0], wbsLabel: l.wbsLabel, plannedH: l.plannedH, declaredH: l.declaredH,
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

/**
 * "Import Lucca hours" (AF.hours): re-stamps the latest import of the project (the prototype only flips the date
 * to 30 Sep 2026; no lines are fetched — the Lucca connector is not modelled).
 */
export async function markHoursImported(
  projectCode: string, input: { analyticCode?: string; matchingMode?: HoursMatching; importedOn?: string }, actorName: string,
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const [imp] = await tx.select().from(hoursImports).where(eq(hoursImports.projectId, p.id)).orderBy(sql`${hoursImports.periodStart} desc`).limit(1);
    if (!imp) return;
    await tx
      .update(hoursImports)
      .set({ importedOn: input.importedOn ?? '2026-09-30', analyticCode: input.analyticCode ?? imp.analyticCode, matchingMode: input.matchingMode ?? imp.matchingMode, updatedAt: new Date() })
      .where(eq(hoursImports.id, imp.id));
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: `Hours ${imp.analyticCode}`, change: 'Lucca import', area: 'Hours', entityType: 'hours_import', entityId: imp.id, projectId: p.id });
  });
}

/** "Assign" of an unassigned line (by its position in the list) to a work package (OPEN QUESTION R-6). */
export async function assignUnassignedHours(projectCode: string, position: number, wbsCode: string, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const [imp] = await tx.select().from(hoursImports).where(eq(hoursImports.projectId, p.id)).orderBy(sql`${hoursImports.periodStart} desc`).limit(1);
    if (!imp) throw new Error(`No Lucca import for ${projectCode}`);
    const [node] = await tx.select({ id: wbsNodes.id }).from(wbsNodes).where(and(eq(wbsNodes.projectId, p.id), eq(wbsNodes.code, wbsCode)));
    if (!node) throw new Error(`Unknown WBS ${wbsCode} on ${projectCode}`);
    const [u] = await tx.select().from(unassignedHours).where(and(eq(unassignedHours.importId, imp.id), eq(unassignedHours.position, position)));
    if (!u) throw new Error(`No unassigned line #${position}`);
    await tx.update(unassignedHours).set({ assignedWbsNodeId: node.id, assignedAt: new Date() }).where(eq(unassignedHours.id, u.id));
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: `Hours ${imp.analyticCode}`, change: `${u.hours} h assigned to WBS ${wbsCode}`, area: 'Hours', entityType: 'unassigned_hours', entityId: u.id, projectId: p.id });
  });
}
