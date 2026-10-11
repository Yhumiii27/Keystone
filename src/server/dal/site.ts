import 'server-only';
// Site (chantier) DAL (docs/spec/10 §3). Keystone owns the site sheet, equipment, client prerequisites, rotation plan,
// collisions, mission costs and daily reports. The people Go / No Go comes from Cursus (Cursus connector, mirror +
// reminders); the HSE register from Vigie (Vigie quality connector, read-only, "Manage / Report in Vigie"); the site
// punch list is the `site` register of punch items (itp.ts). "Go chantier" = no prerequisite pending ∧ no Cursus NO GO ∧
// all equipment confirmed ∧ no open collision ∧ no HSE item pending (`goItems` 4747) — the rule lives in
// src/domain/site.ts (`goChantier`).
// Time model: a prerequisite is late when still pending at J-15 of its need date (J-15 rule of the card subtitle,
// against the status date; the prototype listed two dates, 10 OQ6) — `isPrerequisiteLate`.
import { and, asc, desc, eq } from 'drizzle-orm';
import { plannedManDays, standardCalendar } from '@/domain/kpis';
import { PREREQUISITE_ALERT_DAYS, goChantier, isPrerequisiteLate, missionCostUse, type GoCondition } from '@/domain/site';
import { getDb } from '@/server/db/client';
import {
  STATUS_ISO, collisionKind, confirmStatus, cursusClearance, cursusVaccination, cursusVerdict, cursusVisa, equipmentSource, hseIncident, hseStatus,
  nextBusinessNumber, weather,
  type CollisionKind, type ConfirmStatus, type CursusVerdict, type EquipmentSource, type HseIncident, type HseItemKind, type HseStatus, type Weather,
} from '@/server/db/codes';
import {
  activities, dailyReports, missionCostLines, projects, siteCollisions, siteEquipment, sitePrerequisites, siteRotations, siteSheets,
} from '@/server/db/schema';
import { cursusChantierUrl } from '@/server/integrations/cursus/links';
import { getCursusConnector, type CursusClearanceView } from '@/server/integrations/cursus/connector';
import { vigieConnectorMode } from '@/server/integrations/vigie/connection';
import { getVigieQualityConnector } from '@/server/integrations/vigie/quality-connector';
import { vigieCoactivityUrl, vigieHseListUrl, vigieReportIncidentUrl } from '@/server/integrations/vigie/links';
import { getProjectCalendarCode, loadWorkCalendars } from './calendars';
import { listPunchItems, type PunchRow } from './itp';
import { clientDecisionsOf } from './kpis';
import type { Tx } from '@/server/db/types';
import { isIsoDate, projectOf, requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';

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
}

export interface EquipmentRow { position: number; name: string; source: EquipmentSource; sourceLabel: string; status: Exclude<ConfirmStatus, 'signed'>; statusLabel: string; note: string }
export interface PrerequisiteRow {
  position: number; title: string; activityCode: string; activityName: string | null; neededBy: string; status: ConfirmStatus; statusLabel: string; evidence: string;
  late: boolean;
}
export interface RotationRow {
  person: string; roleOnSite: string; fromOn: string; toOn: string; lodging: string; travel: string; rotationNo: number; hasCollision: boolean;
}
export interface CollisionRow { position: number; person: string; description: string; kind: CollisionKind; kindLabel: string; proposedFix: string; resolved: boolean }
export interface MissionCostRow { name: string; budgetKeur: number; actualKeur: number; remainingKeur: number; usedPct: number }
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
  equipment: EquipmentRow[];
  prerequisites: PrerequisiteRow[];
  cursus: { verdict: CursusVerdict | null; people: CursusClearanceView[]; lastSyncedAt: string | null; mode: 'mock' | 'http'; openUrl: string };
  rotation: RotationRow[];
  collisions: CollisionRow[];
  missionCosts: MissionCostRow[];
  dailyReports: DailyReportRow[];
  punch: PunchRow[];
  hse: HseRow[];
  /** Vigie connector mode and the last refresh of the HSE register (ISO; null when nothing was received). */
  hseSource: { mode: 'mock' | 'http'; lastSyncedAt: string | null };
  /** A-12: change requests of the project whose client step is decided ("Client decisions logged"). */
  clientDecisions: number;
  go: { ok: boolean; conditions: GoCondition[] };
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
  const [eq_, pre, acts, rot, col, costs, reports, punch, hse, gng, cals, calCode, clientDecisions] = await Promise.all([
    db.select().from(siteEquipment).where(eq(siteEquipment.projectId, p.id)).orderBy(asc(siteEquipment.position)),
    db.select().from(sitePrerequisites).where(eq(sitePrerequisites.projectId, p.id)).orderBy(asc(sitePrerequisites.position)),
    db.select({ code: activities.code, name: activities.name }).from(activities).where(eq(activities.projectId, p.id)),
    db.select().from(siteRotations).where(eq(siteRotations.projectId, p.id)).orderBy(asc(siteRotations.position)),
    db.select().from(siteCollisions).where(eq(siteCollisions.projectId, p.id)).orderBy(asc(siteCollisions.position)),
    db.select().from(missionCostLines).where(eq(missionCostLines.projectId, p.id)).orderBy(asc(missionCostLines.position)),
    db.select().from(dailyReports).where(eq(dailyReports.projectId, p.id)).orderBy(desc(dailyReports.reportOn), desc(dailyReports.number)),
    listPunchItems(projectCode, 'site'),
    getVigieQualityConnector().listHse(projectCode),
    cursus.getGoNoGo(projectCode),
    loadWorkCalendars(projectCode),
    getProjectCalendarCode(projectCode),
    clientDecisionsOf(projectCode),
  ]);
  const actName = new Map(acts.map((a) => [a.code, a.name]));
  const collisions: CollisionRow[] = col.map((c) => ({
    position: c.position, person: c.personName, description: c.description, kind: c.kind, kindLabel: collisionKind.label(c.kind), proposedFix: c.proposedFix, resolved: !!c.resolvedAt,
  }));
  const open = new Set(collisions.filter((c) => !c.resolved).map((c) => c.person));
  const data: Omit<SiteData, 'go'> = {
    projectCode,
    sheet: {
      site: s.siteName, country: s.country, timeZone: s.timeZone, language: s.language, currency: s.currency, clientContact: s.clientContact, workingHours: s.workingHours,
      localHolidays: s.localHolidays, accessConstraints: s.accessConstraints, startOn: s.startOn, endOn: s.endOn, doneDays: s.doneDays, planDays: s.planDays,
      // A-12: Σ rotation crew × working days on the project calendar (the stored figure is the prototype's literal 168).
      manDaysPlanned: plannedManDays(rot.map((r) => ({ person: r.personName, fromOn: r.fromOn, toOn: r.toOn })), cals[calCode] ?? standardCalendar()),
      cursusChantierId: s.cursusChantierId,
    },
    equipment: eq_.map((e) => ({ position: e.position, name: e.name, source: e.source, sourceLabel: equipmentSource.label(e.source), status: e.status, statusLabel: confirmStatus.label(e.status), note: e.note })),
    prerequisites: pre.map((x) => ({
      position: x.position, title: x.title, activityCode: x.activityCode, activityName: actName.get(x.activityCode) ?? null, neededBy: x.neededBy, status: x.status,
      statusLabel: confirmStatus.label(x.status), evidence: x.evidence, late: isPrerequisiteLate(x, today),
    })),
    cursus: { verdict: gng.verdict, people: gng.people, lastSyncedAt: gng.lastSyncedAt, mode: cursus.mode, openUrl: cursusChantierUrl(s.cursusChantierId) },
    rotation: rot.map((r) => ({
      person: r.personName, roleOnSite: r.roleOnSite, fromOn: r.fromOn, toOn: r.toOn, lodging: r.lodging, travel: r.travel, rotationNo: r.rotationNo, hasCollision: open.has(r.personName),
    })),
    collisions,
    missionCosts: costs.map((c) => ({ name: c.name, budgetKeur: c.budgetKeur, actualKeur: c.actualKeur, ...missionCostUse(c) })),
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
  };
  return { ...data, go: goConditions(data) };
}

/** Labels of the Cursus approvals (visa, vaccinations, clearances, verdict) for one person row. */
export const cursusLabels = (c: Pick<CursusClearanceView, 'visa' | 'vaccination' | 'clearance' | 'verdict'>) => ({
  visa: cursusVisa.label(c.visa), vaccination: cursusVaccination.label(c.vaccination), clearance: cursusClearance.label(c.clearance), verdict: cursusVerdict.label(c.verdict),
});

/** "NO GO" when the project has a site sheet and Go chantier is not reached (Site nav badge), per project. */
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
  incident: HseIncident;
}

/** "Daily report" (AF.site): saved as the project's next report (DR-003…), by the viewer — listed with the others. */
export async function saveDailyReport(projectCode: string, input: DailyReportInput, actor: Actor): Promise<string> {
  requireWorkspace('site', actor, 'Site');
  const text = requiredText(input.progress, 'Progress', 2000);
  if (!isIsoDate(input.date)) throw new Error('Invalid date');
  if (!weather.isCode(input.weather)) throw new Error('Invalid weather');
  if (!hseIncident.isCode(input.incident)) throw new Error('Invalid HSE incident');
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
      headcount, hseIncident: input.incident, fromForm: true,
    }).returning({ id: dailyReports.id });
    await trace(tx, who, {
      objectRef: number, change: `daily report ${input.date} · ${weather.label(input.weather)}${headcount != null ? ` · ${headcount} on site` : ''} · HSE ${hseIncident.label(input.incident)}`,
      area: 'Site', entityType: 'daily_report', entityId: row.id, projectId: p.id, activity: { text: `Daily report ${number} saved · ${text.slice(0, 80)}`, kind: 'comment' },
    });
    return number;
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
