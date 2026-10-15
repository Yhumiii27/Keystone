import 'server-only';
// Site (chantier) DAL (docs/spec/10 §3). Keystone owns the site sheet, equipment, client prerequisites, rotation plan,
// collisions, mission costs and daily reports. The people Go / No Go comes from Cursus (Cursus connector, mirror +
// reminders); the HSE register from Vigie (Vigie quality connector, read-only, "Manage / Report in Vigie"); the punch list
// is the project's single list (itp.ts, R-117: the Site shows the items raised on site by default, every origin on demand,
// read-only; its KPIs count the whole list). "Go chantier" = no prerequisite pending ∧ no Cursus NO GO ∧
// all equipment confirmed ∧ no open collision ∧ no HSE item pending (`goItems` 4747) — the rule lives in
// src/domain/site.ts (`goChantier`).
// Time model: a prerequisite is late when still pending at J-15 of its need date (J-15 rule of the card subtitle,
// against the status date; the prototype listed two dates, 10 OQ6) — `isPrerequisiteLate`.
// R-118 (D-3 'a'): the sheet and its lines are created and filled by the project's leads (./site-sheet.ts); `getSite` gives
// each line its position and the stamp its edit form sends back.
import { and, asc, desc, eq, inArray, ne, or } from 'drizzle-orm';
import type { RoleKey } from '@/config/screens';
import { plannedManDays, standardCalendar } from '@/domain/kpis';
import {
  ARBITRATION_COMMENT_MAX, PREREQUISITE_ALERT_DAYS, canArbitrateConflict, goChantier, isPrerequisiteLate, missionCostUse, siteConflicts,
  type ConflictFacts, type GoCondition, type SiteConflict, type SitePremium,
} from '@/domain/site';
import { costStamp, equipmentStamp, prerequisiteStamp, rotationStamp } from '@/domain/site-sheet';
import { getDb } from '@/server/db/client';
import {
  STATUS_ISO, addDaysIso, collisionKind, confirmStatus, cursusClearance, cursusVaccination, cursusVerdict, cursusVisa, equipmentSource, hseIncident, hseStatus,
  nextBusinessNumber, weather,
  type ConfirmStatus, type CursusVerdict, type EquipmentSource, type HseIncident, type HseItemKind, type HseStatus, type Weather,
} from '@/server/db/codes';
import {
  activities, dailyReports, departments, leaveEntries, missionCostLines, persons, projects, siteConflictArbitrations, siteEquipment, sitePrerequisites, siteRotations,
  siteSheets,
} from '@/server/db/schema';
import { cursusChantierUrl } from '@/server/integrations/cursus/links';
import { getCursusConnector, type CursusClearanceView } from '@/server/integrations/cursus/connector';
import { vigieConnectorMode } from '@/server/integrations/vigie/connection';
import { getVigieQualityConnector } from '@/server/integrations/vigie/quality-connector';
import { vigieCoactivityUrl, vigieHseListUrl, vigieReportIncidentUrl } from '@/server/integrations/vigie/links';
import { multiplierAt } from '@/domain/hr';
import { getProjectCalendarCode, loadWorkCalendars } from './calendars';
import { getRateGrid } from './hr';
import { listPunchItems, type PunchRow } from './itp';
import { clientDecisionsOf } from './kpis';
import { getResourcePool, type ResourcePool } from './resources';
import type { DB, Tx } from '@/server/db/types';
import { isIsoDate, managesProject, projectOf, requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';
import { siteSheetStamp } from './site-sheet';

export type { Actor, CursusClearanceView, GoCondition };
export { PREREQUISITE_ALERT_DAYS, cursusChantierUrl, vigieCoactivityUrl, vigieHseListUrl, vigieReportIncidentUrl };

export interface SiteSheet {
  site: string;
  country: string;
  timeZone: string;
  language: string;
  currency: string;
  clientContact: string;
  workingHours: string;
  localHolidays: string;
  accessConstraints: string;
  startOn: string;
  endOn: string;
  doneDays: number;
  planDays: number;
  manDaysPlanned: number;
  cursusChantierId: string | null;
  /** R-118: what "Edit site sheet" saw (the writer refuses a sheet changed since). */
  stamp: string;
}

// R-118: `position` identifies a line for its Server Functions; `stamp` is what the edit / remove form saw (src/domain/site-sheet.ts).
export interface EquipmentRow {
  position: number; name: string; source: EquipmentSource; sourceLabel: string; status: Exclude<ConfirmStatus, 'signed'>; statusLabel: string; note: string; stamp: string;
}
export interface PrerequisiteRow {
  position: number; title: string; activityCode: string; activityName: string | null; neededBy: string; status: ConfirmStatus; statusLabel: string; evidence: string;
  late: boolean; stamp: string;
}
export interface RotationRow {
  position: number; person: string; personId: string | null; roleOnSite: string; fromOn: string; toOn: string; lodging: string; travel: string; rotationNo: number;
  /** An open (not arbitrated) conflict of this person (R-119). */
  hasCollision: boolean;
  stamp: string;
}
/** A site-team conflict computed from the rotation plan (R-119, D-6b 'a'); `resolved` = arbitrated while its cause is unchanged. */
export interface CollisionRow extends SiteConflict { kindLabel: string; resolved: boolean }
export interface MissionCostRow { position: number; name: string; budgetKeur: number; actualKeur: number; remainingKeur: number; usedPct: number; stamp: string }
export interface DailyReportRow {
  number: string; reportOn: string; activity: string; percentComplete: number | null; text: string; linkRef: string | null; author: string;
  weather: Weather | null; weatherLabel: string | null; headcount: number | null; hseIncident: HseIncident | null; hseIncidentLabel: string | null;
  /** Saved with the Daily report form in Keystone (typed text, not prototype data). */
  fromForm: boolean;
}
export interface HseRow {
  title: string; kind: HseItemKind; status: HseStatus;
  /** What the register shows: Vigie's free text ("0 déclaré") or the status label ("Signed"). */
  statusText: string;
  dateOn: string | null; vigieUrl: string;
  /** Vigie's id ("PP-2026-013") when known. */
  vigieRef: string | null;
}

export interface SiteData {
  projectCode: string;
  sheet: SiteSheet;
  /** R-118: the plan's activities (code order) — what a client prerequisite may condition. */
  planActivities: { code: string; name: string }[];
  equipment: EquipmentRow[];
  prerequisites: PrerequisiteRow[];
  cursus: { verdict: CursusVerdict | null; people: CursusClearanceView[]; lastSyncedAt: string | null; mode: 'mock' | 'http'; openUrl: string };
  rotation: RotationRow[];
  collisions: CollisionRow[];
  missionCosts: MissionCostRow[];
  dailyReports: DailyReportRow[];
  /** The project's punch list, every origin (R-117, A-6 'a'). */
  punch: PunchRow[];
  hse: HseRow[];
  /** Vigie connector mode and the last refresh of the HSE register (ISO; null when nothing was received). */
  hseSource: { mode: 'mock' | 'http'; lastSyncedAt: string | null };
  /** A-12: change requests of the project whose client step is decided ("Client decisions logged"). */
  clientDecisions: number;
  /** R-169: Saturday and Sunday / public holiday multipliers of the rate grid ("Site premium"). */
  premium?: SitePremium;
  go: { ok: boolean; conditions: GoCondition[] };
}

/**
 * R-169: the weekend premiums of the rate grid (Resources › Rates; multipliers 'sat' and 'sun') — R-083: the factors in force on
 * `on` (the business date until R-013).
 */
async function weekendPremium(on: string = STATUS_ISO): Promise<SitePremium> {
  const grid = await getRateGrid();
  return { sat: multiplierAt(grid, 'sat', on), sun: multiplierAt(grid, 'sun', on) };
}

/** Go chantier (`goItems` 4747) from the site's records (`goChantier`, src/domain/site.ts). */
export function goConditions(d: Pick<SiteData, 'prerequisites' | 'equipment' | 'collisions' | 'hse'> & { cursus: { people: { verdict: CursusVerdict }[] } }): { ok: boolean; conditions: GoCondition[] } {
  return goChantier({ prerequisites: d.prerequisites, people: d.cursus.people, equipment: d.equipment, collisions: d.collisions, hse: d.hse });
}

/** The site module of a project; null when it has no site sheet (the screen's empty state). */
export async function getSite(projectCode: string, today: string = STATUS_ISO): Promise<SiteData | null> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const [s] = await db.select().from(siteSheets).where(eq(siteSheets.projectId, p.id));
  if (!s) return null;
  const cursus = getCursusConnector();
  const [eq_, pre, acts, rot, pool, costs, reports, punch, hse, gng, cals, calCode, clientDecisions] = await Promise.all([
    db.select().from(siteEquipment).where(eq(siteEquipment.projectId, p.id)).orderBy(asc(siteEquipment.position)),
    db.select().from(sitePrerequisites).where(eq(sitePrerequisites.projectId, p.id)).orderBy(asc(sitePrerequisites.position)),
    db.select({ code: activities.code, name: activities.name }).from(activities).where(eq(activities.projectId, p.id)).orderBy(asc(activities.code)),
    db.select().from(siteRotations).where(eq(siteRotations.projectId, p.id)).orderBy(asc(siteRotations.position)),
    // R-119: the resource pool's weekly loads, through its own reader.
    getResourcePool(),
    db.select().from(missionCostLines).where(eq(missionCostLines.projectId, p.id)).orderBy(asc(missionCostLines.position)),
    db.select().from(dailyReports).where(eq(dailyReports.projectId, p.id)).orderBy(desc(dailyReports.reportOn), desc(dailyReports.number)),
    listPunchItems(projectCode),
    getVigieQualityConnector().listHse(projectCode),
    cursus.getGoNoGo(projectCode),
    loadWorkCalendars(projectCode),
    getProjectCalendarCode(projectCode),
    clientDecisionsOf(projectCode),
  ]);
  const actName = new Map(acts.map((a) => [a.code, a.name]));
  // R-119 (D-6b 'a'): the conflicts are computed (site_collisions, the prototype's literals, is no longer read).
  const collisions = collisionRows(siteConflicts(await conflictFacts(db, p.id, rot, gng.people, pool)));
  const open = new Set(collisions.filter((c) => !c.resolved).map((c) => c.person));
  const data: Omit<SiteData, 'go'> = {
    projectCode,
    sheet: {
      site: s.siteName, country: s.country, timeZone: s.timeZone, language: s.language, currency: s.currency, clientContact: s.clientContact, workingHours: s.workingHours,
      localHolidays: s.localHolidays, accessConstraints: s.accessConstraints, startOn: s.startOn, endOn: s.endOn, doneDays: s.doneDays, planDays: s.planDays,
      // A-12: Σ rotation crew × working days on the project calendar (the stored figure is the prototype's literal 168).
      manDaysPlanned: plannedManDays(rot.map((r) => ({ person: r.personName, fromOn: r.fromOn, toOn: r.toOn })), cals[calCode] ?? standardCalendar()),
      cursusChantierId: s.cursusChantierId,
      stamp: siteSheetStamp(s),
    },
    planActivities: acts,
    equipment: eq_.map((e) => ({
      position: e.position, name: e.name, source: e.source, sourceLabel: equipmentSource.label(e.source), status: e.status, statusLabel: confirmStatus.label(e.status), note: e.note,
      stamp: equipmentStamp(e),
    })),
    prerequisites: pre.map((x) => ({
      position: x.position, title: x.title, activityCode: x.activityCode, activityName: actName.get(x.activityCode) ?? null, neededBy: x.neededBy, status: x.status,
      statusLabel: confirmStatus.label(x.status), evidence: x.evidence, late: isPrerequisiteLate(x, today), stamp: prerequisiteStamp(x),
    })),
    cursus: { verdict: gng.verdict, people: gng.people, lastSyncedAt: gng.lastSyncedAt, mode: cursus.mode, openUrl: cursusChantierUrl(s.cursusChantierId) },
    rotation: rot.map((r) => ({
      position: r.position, person: r.personName, personId: r.personId, roleOnSite: r.roleOnSite, fromOn: r.fromOn, toOn: r.toOn, lodging: r.lodging, travel: r.travel,
      rotationNo: r.rotationNo, hasCollision: open.has(r.personName), stamp: rotationStamp(r),
    })),
    collisions,
    missionCosts: costs.map((c) => ({ position: c.position, name: c.name, budgetKeur: c.budgetKeur, actualKeur: c.actualKeur, ...missionCostUse(c), stamp: costStamp(c) })),
    dailyReports: reports.map((r) => ({
      number: r.number, reportOn: r.reportOn, activity: r.activityLabel, percentComplete: r.percentComplete, text: r.text, linkRef: r.linkRef, author: r.authorName,
      weather: r.weather, weatherLabel: r.weather ? weather.label(r.weather) : null, headcount: r.headcount, hseIncident: r.hseIncident,
      hseIncidentLabel: r.hseIncident ? hseIncident.label(r.hseIncident) : null, fromForm: r.fromForm,
    })),
    punch,
    hse: hse.map((h) => ({
      title: h.title, kind: h.kind, status: h.status, statusText: h.statusText ?? hseStatus.label(h.status), dateOn: h.dateOn, vigieUrl: h.vigieUrl, vigieRef: h.vigieRef,
    })),
    hseSource: { mode: vigieConnectorMode(), lastSyncedAt: hse.reduce<string | null>((m, h) => (!m || h.lastSyncedAt > m ? h.lastSyncedAt : m), null) },
    clientDecisions,
    premium: await weekendPremium(),
  };
  return { ...data, go: goConditions(data) };
}

type Q = DB | Tx;

/**
 * The facts the site-team conflicts are computed from (R-119): the rotation (with each person's department), the pool's
 * weekly loads, the other projects' rotations of the same people, Cursus's clearances of the team (matched by matricule when
 * Cursus gives one, else by name), the absences received from Cursus (R-031) and the arbitrations of the project. The pool
 * and Cursus are read by the caller through their own readers (never inside a transaction).
 */
async function conflictFacts(
  q: Q, projectId: string, rot: (typeof siteRotations.$inferSelect)[], cursus: readonly CursusClearanceView[], pool: ResourcePool,
): Promise<ConflictFacts> {
  const ids = [...new Set(rot.map((r) => r.personId).filter((x): x is string => !!x))];
  const names = [...new Set(rot.map((r) => r.personName))];
  const [people, others, absences, arbitrations] = await Promise.all([
    ids.length
      ? q.select({ id: persons.id, matricule: persons.matricule, department: departments.name }).from(persons).leftJoin(departments, eq(departments.id, persons.departmentId))
        .where(inArray(persons.id, ids))
      : Promise.resolve([]),
    names.length
      ? q.select({ person: siteRotations.personName, personId: siteRotations.personId, code: projects.code, fromOn: siteRotations.fromOn, toOn: siteRotations.toOn })
        .from(siteRotations).innerJoin(projects, eq(projects.id, siteRotations.projectId))
        .where(and(ne(siteRotations.projectId, projectId), ids.length ? or(inArray(siteRotations.personId, ids), inArray(siteRotations.personName, names)) : inArray(siteRotations.personName, names)))
      : Promise.resolve([]),
    ids.length
      ? q.select({ personId: leaveEntries.personId, leaveType: leaveEntries.leaveType, weekStart: leaveEntries.weekStart, startDate: leaveEntries.startDate, endDate: leaveEntries.endDate })
        .from(leaveEntries).where(inArray(leaveEntries.personId, ids))
      : Promise.resolve([]),
    q.select().from(siteConflictArbitrations).where(eq(siteConflictArbitrations.projectId, projectId)),
  ]);
  const byId = new Map(people.map((x) => [x.id, x]));
  const idOfMatricule = new Map(people.filter((x) => x.matricule).map((x) => [x.matricule!, x.id]));
  return {
    rotation: rot.map((r) => ({ person: r.personName, personId: r.personId, department: (r.personId && byId.get(r.personId)?.department) || null, fromOn: r.fromOn, toOn: r.toOn })),
    pool: { weeks: pool.weeks.map((w) => w.start), people: pool.people.map((x) => ({ name: x.name, loads: x.loads })) },
    otherSites: others.map((o) => ({ person: o.person, personId: o.personId, projectCode: o.code, fromOn: o.fromOn, toOn: o.toOn })),
    cursus: cursus.map((c) => ({ personName: c.personName, personId: c.matricule ? idOfMatricule.get(c.matricule) ?? null : null, clearance: c.clearance, clearanceNote: c.clearanceNote })),
    absences: absences.map((a) => ({ personId: a.personId, leaveType: a.leaveType, start: a.startDate ?? a.weekStart, end: a.endDate ?? addDaysIso(a.weekStart, 4) })),
    arbitrations: arbitrations.map((a) => ({ key: a.conflictKey, comment: a.comment, by: a.arbitratedByName, at: a.arbitratedAt.toISOString() })),
  };
}

const collisionRows = (cs: SiteConflict[]): CollisionRow[] => cs.map((c) => ({ ...c, kindLabel: collisionKind.label(c.kind), resolved: !!c.arbitration }));

/** Labels of the Cursus approvals (visa, vaccinations, clearances, verdict) for one person row. */
export const cursusLabels = (c: Pick<CursusClearanceView, 'visa' | 'vaccination' | 'clearance' | 'verdict'>) => ({
  visa: cursusVisa.label(c.visa), vaccination: cursusVaccination.label(c.vaccination), clearance: cursusClearance.label(c.clearance), verdict: cursusVerdict.label(c.verdict),
});

/**
 * "NO GO" when the project has a site sheet and Go chantier is not reached (Site nav badge), per project. R-118: sheets are now
 * created from Études, so this full read per sheet grows with the portfolio, and a new sheet shows NO GO until Cursus sends
 * verdicts (R-120) — a lighter query and a J-30 window are for the owner to confirm (docs/delivery-8/notes-site-quality.md).
 */
export async function siteBadgeByProject(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.select({ code: projects.code }).from(siteSheets).innerJoin(projects, eq(projects.id, siteSheets.projectId));
  const out: Record<string, string> = {};
  for (const r of rows) {
    const s = await getSite(r.code);
    if (s && !s.go.ok) out[r.code] = 'NO GO';
  }
  return out;
}

// ── Writers ─────────────────────────────────────────────────────────────────────────────────────────────

async function sheetProject(tx: Tx, code: string) {
  const p = await projectOf(tx, code);
  const [s] = await tx.select({ id: siteSheets.id }).from(siteSheets).where(eq(siteSheets.projectId, p.id));
  if (!s) throw new Error(`${code} has no site sheet`);
  return p;
}

/** "Client confirms" (Pending → Confirmed) and "Signed on site" (Confirmed → Signed) on a client prerequisite. */
export async function advancePrerequisite(projectCode: string, position: number, to: 'confirmed' | 'signed', actor: Actor, on: string = STATUS_ISO): Promise<void> {
  requireWorkspace('site', actor, 'Site');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await sheetProject(tx, projectCode);
    const [x] = await tx.select().from(sitePrerequisites).where(and(eq(sitePrerequisites.projectId, p.id), eq(sitePrerequisites.position, position)));
    if (!x) throw new Error(`Unknown prerequisite ${position} on ${projectCode}`);
    const expected: ConfirmStatus = to === 'confirmed' ? 'pending' : 'confirmed';
    if (x.status !== expected) throw new Error(`"${x.title}" is ${confirmStatus.label(x.status)}`);
    await tx.update(sitePrerequisites).set(to === 'confirmed' ? { status: to, confirmedOn: on, updatedAt: new Date() } : { status: to, signedOn: on, updatedAt: new Date() })
      .where(eq(sitePrerequisites.id, x.id));
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Prerequisite · ${x.title}`, change: `status: ${confirmStatus.label(x.status)} → ${confirmStatus.label(to)}`, area: 'Site', entityType: 'site_prerequisite', entityId: x.id,
      projectId: p.id,
    });
  });
}

/** "Confirm" on a pending equipment line. */
export async function confirmEquipment(projectCode: string, position: number, actor: Actor, on: string = STATUS_ISO): Promise<void> {
  requireWorkspace('site', actor, 'Site');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await sheetProject(tx, projectCode);
    const [x] = await tx.select().from(siteEquipment).where(and(eq(siteEquipment.projectId, p.id), eq(siteEquipment.position, position)));
    if (!x) throw new Error(`Unknown equipment ${position} on ${projectCode}`);
    if (x.status !== 'pending') throw new Error(`"${x.name}" is already confirmed`);
    const who = await whoIs(tx, actor);
    await tx.update(siteEquipment).set({ status: 'confirmed', confirmedOn: on, confirmedByPersonId: who.personId, updatedAt: new Date() }).where(eq(siteEquipment.id, x.id));
    await trace(tx, who, { objectRef: `Equipment · ${x.name}`, change: 'status: Pending → Confirmed', area: 'Site', entityType: 'site_equipment', entityId: x.id, projectId: p.id });
  });
}

export interface DailyReportInput {
  /** ISO date (the form's default "30 Sep 2026"). */
  date: string;
  weather: Weather;
  headcount?: number | null;
  progress: string;
}

/**
 * "Daily report" (AF.site): saved as the project's next report (DR-003…), by the viewer — listed with the others.
 * NEW-SITE-2 'a' (R-122): no HSE incident is recorded any more (`hse_incident` stays null; incidents are declared in Vigie);
 * the values saved before are kept and still shown.
 */
export async function saveDailyReport(projectCode: string, input: DailyReportInput, actor: Actor): Promise<string> {
  requireWorkspace('site', actor, 'Site');
  const text = requiredText(input.progress, 'Progress', 2000);
  if (!isIsoDate(input.date)) throw new Error('Invalid date');
  if (!weather.isCode(input.weather)) throw new Error('Invalid weather');
  const headcount = input.headcount == null ? null : Number(input.headcount);
  if (headcount != null && (!Number.isInteger(headcount) || headcount < 0 || headcount > 10000)) throw new Error('Invalid headcount');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await sheetProject(tx, projectCode);
    const existing = await tx.select({ n: dailyReports.number }).from(dailyReports).where(eq(dailyReports.projectId, p.id));
    const number = nextBusinessNumber(existing.map((e) => e.n), 'DR-', 3);
    const who = await whoIs(tx, actor);
    const [row] = await tx.insert(dailyReports).values({
      projectId: p.id, number, reportOn: input.date, activityLabel: '—', text, linkRef: null, authorName: who.short, authorPersonId: who.personId, weather: input.weather,
      headcount, hseIncident: null, fromForm: true,
    }).returning({ id: dailyReports.id });
    await trace(tx, who, {
      objectRef: number, change: `daily report ${input.date} · ${weather.label(input.weather)}${headcount != null ? ` · ${headcount} on site` : ''}`,
      area: 'Site', entityType: 'daily_report', entityId: row.id, projectId: p.id, activity: { text: `Daily report ${number} saved · ${text.slice(0, 80)}`, kind: 'comment' },
    });
    return number;
  });
}

export const CONFLICT_CHANGED = 'This conflict has changed';
export const CONFLICT_ARBITRATED = 'This conflict is already arbitrated';
export const ARBITRATION_REFUSED = 'Only the head of the person’s department or the director arbitrates this conflict';

/**
 * "Arbitrate" a site-team conflict (R-119, D-6b 'a'): records why it is accepted (comment required). Who: the director, the
 * head of the person's department; for a contractor crew or a person without a department, the director and the project's
 * leads (`canArbitrateConflict`, re-checked here with the actor — not the Site's edit right). The conflict is recomputed in the
 * transaction: a key that no longer exists (its cause changed or disappeared) or one already arbitrated is refused. The
 * arbitration lasts while the cause is unchanged (same key). Audit (reason = the comment) and activity. Returns the conflict.
 */
export async function arbitrateSiteConflict(projectCode: string, key: string, comment: string, actor: Actor): Promise<CollisionRow> {
  if (actor.role === 'client') throw new Error(ARBITRATION_REFUSED);
  if (typeof key !== 'string' || !key || key.length > 600) throw new Error('Invalid conflict');
  const text = requiredText(comment, 'Comment', ARBITRATION_COMMENT_MAX);
  const db = await getDb();
  const project = await projectOf(db, projectCode);
  // Mirrors read through their own readers, outside the transaction.
  const [gng, pool] = await Promise.all([getCursusConnector().getGoNoGo(project.code), getResourcePool()]);
  return db.transaction(async (tx) => {
    const p = await sheetProject(tx, projectCode);
    const rot = await tx.select().from(siteRotations).where(eq(siteRotations.projectId, p.id)).orderBy(asc(siteRotations.position));
    const c = collisionRows(siteConflicts(await conflictFacts(tx, p.id, rot, gng.people, pool))).find((x) => x.key === key);
    if (!c) throw new Error(CONFLICT_CHANGED);
    const who = await whoIs(tx, actor);
    const [headed, lead] = await Promise.all([
      who.personId ? tx.select({ name: departments.name }).from(departments).where(eq(departments.headPersonId, who.personId)) : Promise.resolve([]),
      managesProject(tx, actor, p),
    ]);
    if (!canArbitrateConflict(actor.role as RoleKey, { headed: headed.map((d) => d.name), lead }, c)) throw new Error(ARBITRATION_REFUSED);
    if (c.resolved) throw new Error(CONFLICT_ARBITRATED);
    const [row] = await tx.insert(siteConflictArbitrations).values({
      projectId: p.id, conflictKey: c.key, personName: c.person, kind: c.kind, comment: text, arbitratedByName: who.who, arbitratedByPersonId: who.personId,
    }).returning({ id: siteConflictArbitrations.id, at: siteConflictArbitrations.arbitratedAt });
    await trace(tx, who, {
      objectRef: `Conflict · ${c.person}`, change: `arbitrated · ${c.kindLabel}`, area: 'Site', entityType: 'site_conflict_arbitration', entityId: row.id, projectId: p.id,
      reason: text, after: { key: c.key, kind: c.kind, comment: text },
      activity: { text: `Arbitrated the ${c.kindLabel.toLowerCase()} conflict of ${c.person}`, kind: 'change' },
    });
    return { ...c, resolved: true, arbitration: { comment: text, by: who.who, at: row.at.toISOString() } };
  });
}

/** "Remind in Cursus" on a person whose verdict is not GO (one reminder per person; pending sync with Cursus). */
export async function remindInCursus(projectCode: string, personName: string, actor: Actor) {
  requireWorkspace('site', actor, 'Site');
  return getCursusConnector().remind(projectCode, personName, actor);
}

/** "Sync Cursus": refreshes the project's verdicts (HTTP mode) and delivers the outbox; returns the approvals received. */
export async function syncCursus(projectCode: string, actor: Actor) {
  requireWorkspace('site', actor, 'Site');
  const r = await getCursusConnector().sync(projectCode);
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  await trace(db, await whoIs(db, actor), {
    objectRef: `Cursus · ${projectCode}`, change: `sync · ${r.received} approvals received`, area: 'Site', projectId: p.id, activity: { text: `Cursus sync · ${r.received} approvals received`, kind: 'sync' },
  });
  return r;
}
