import 'server-only';
// R-118 (D-3 'a'): the site sheet created and filled in Keystone by the project's leads — "Prepare the site", "Edit site sheet"
// and the lines (client prerequisites, equipment, rotations, mission cost lines). The rules are pure (src/domain/site-sheet.ts):
// the stage window, who, the forms, what may change and the stamps. Each writer re-checks in its transaction, with the actor:
// the Site in the actor's workspace, the actor leads the project (PM of record, co-PM, deputy, or the director), the stage, then
// the record as it is now (sheet present or not, the line at its position with the stamp the form saw, its status). New lines
// take the next position (max + 1). Audit with before / after; the sheet's creation and edits also go to the activity feed.
// System boundaries: no Cursus site-creation request is queued (R-028 — Cursus has no creation endpoint; the sheet shows
// "Cursus site: not created yet"); mission actuals stay Sage X3's (never typed, C-2a / A-12 'a'); mission orders, per diem and
// travel bookings are not Keystone's (P5 / Cursus).
import { and, asc, eq, max } from 'drizzle-orm';
import { currencyOf, type CurrencyCode } from '@/domain/currency';
import { plannedManDays, standardCalendar } from '@/domain/kpis';
import {
  NO_PLAN_ACTIVITY, PERSON_REQUIRED, SITE_COST_KEPT, SITE_LEADS_ONLY, SITE_LINE_CHANGED, SITE_LINE_KEPT, SITE_SHEET_CHANGED, SITE_SHEET_EXISTS, SITE_STAGE_ERROR,
  UNKNOWN_ACTIVITY, costStamp, equipmentStamp, prerequisiteStamp, rotationStamp, sheetStamp, siteLineEditable, siteLineRemovable, siteSheetOpen,
  type SiteLineForm, type SiteLineKind, type SiteSheetForm,
} from '@/domain/site-sheet';
import { getDb } from '@/server/db/client';
import { equipmentSource } from '@/server/db/codes';
import {
  activities, contracts, missionCostLines, projectSites, projects, siteEquipment, sitePrerequisites, siteRotations, siteSheets, stakeholders,
} from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { getProjectCalendarCode, loadWorkCalendars } from './calendars';
import { managesProject, requireWorkspace, trace, whoIs, type Actor } from './ops-common';
import { getNamedTeam } from './project-team';

export const NO_SHEET = 'This project has no site sheet';

/** Defaults of a new site sheet, from the project (R-118). */
export interface SiteSheetDefaults {
  /** The site's city (project_sites). */
  site: string;
  country: string;
  /** The contract's currency, else the project's, else EUR. */
  currency: CurrencyCode;
  /** The first client stakeholder of the project ("Nadia Bensaïd · n.bensaid@port-lehavre.fr"); '' when none. */
  clientContact: string;
}

export async function siteSheetDefaults(projectCode: string): Promise<SiteSheetDefaults> {
  const db = await getDb();
  const [p] = await db
    .select({ id: projects.id, currency: projects.currency, city: projectSites.city, country: projectSites.countryName })
    .from(projects)
    .leftJoin(projectSites, eq(projectSites.projectId, projects.id))
    .where(eq(projects.code, projectCode));
  if (!p) throw new Error(`Unknown project ${projectCode}`);
  const [[contract], [contact]] = await Promise.all([
    db.select({ currency: contracts.currency }).from(contracts).where(eq(contracts.projectId, p.id)),
    db.select({ name: stakeholders.name, email: stakeholders.contactEmail }).from(stakeholders)
      .where(and(eq(stakeholders.projectId, p.id), eq(stakeholders.type, 'client'))).orderBy(asc(stakeholders.position)).limit(1),
  ]);
  return {
    site: p.city ?? '',
    country: p.country ?? '',
    currency: currencyOf(contract?.currency ?? p.currency),
    clientContact: contact ? (contact.email ? `${contact.name} · ${contact.email}` : contact.name) : '',
  };
}

/** The project has a site sheet (a light read for the Server Functions). */
export async function hasSiteSheet(projectCode: string): Promise<boolean> {
  const db = await getDb();
  const [s] = await db.select({ id: siteSheets.id }).from(siteSheets).innerJoin(projects, eq(projects.id, siteSheets.projectId)).where(eq(projects.code, projectCode));
  return !!s;
}

/** The plan's activities of the project (code order) — what a client prerequisite may condition. */
export async function planActivities(projectCode: string): Promise<{ code: string; name: string }[]> {
  const db = await getDb();
  return db.select({ code: activities.code, name: activities.name }).from(activities).innerJoin(projects, eq(projects.id, activities.projectId))
    .where(eq(projects.code, projectCode)).orderBy(asc(activities.code));
}

/** Rights and stage, re-checked in the transaction: Site in the workspace, a lead of the project (or the director), stage window. */
async function leadProject(tx: Tx, code: string, actor: Actor) {
  requireWorkspace('site', actor, 'Site');
  const [p] = await tx.select({ id: projects.id, code: projects.code, stage: projects.stage }).from(projects).where(eq(projects.code, code));
  if (!p) throw new Error(`Unknown project ${code}`);
  if (!(await managesProject(tx, actor, p))) throw new Error(SITE_LEADS_ONLY);
  if (!siteSheetOpen(p.stage)) throw new Error(SITE_STAGE_ERROR);
  return p;
}

async function sheetOf(tx: Tx, projectId: string) {
  const [s] = await tx.select().from(siteSheets).where(eq(siteSheets.projectId, projectId));
  if (!s) throw new Error(NO_SHEET);
  return s;
}

/** The project's calendar (A-12: the site's working days and man-days are counted on it). */
async function calendarOf(tx: Tx, code: string) {
  const [cals, calCode] = await Promise.all([loadWorkCalendars(code, tx), getProjectCalendarCode(code, tx)]);
  return cals[calCode] ?? standardCalendar();
}

const sheetValues = (f: SiteSheetForm) => ({
  siteName: f.site, country: f.country, timeZone: f.timeZone, language: f.language, currency: f.currency, clientContact: f.clientContact, workingHours: f.workingHours,
  localHolidays: f.localHolidays, accessConstraints: f.accessConstraints, startOn: f.startOn, endOn: f.endOn,
});
const formOfSheet = (s: typeof siteSheets.$inferSelect) => ({
  site: s.siteName, country: s.country, timeZone: s.timeZone, language: s.language, currency: s.currency, clientContact: s.clientContact, workingHours: s.workingHours,
  localHolidays: s.localHolidays, accessConstraints: s.accessConstraints, startOn: s.startOn, endOn: s.endOn,
});
/** The sheet's stamp as the Site screen shows it (the "Edit site sheet" form sends it back). */
export const siteSheetStamp = (s: typeof siteSheets.$inferSelect) => sheetStamp(formOfSheet(s));

/**
 * "Prepare the site": creates the project's site sheet (one per project) with the typed values — working days of the window
 * on the project calendar, nothing done yet, no man-days until rotations are entered, no Cursus site (R-028).
 */
export async function createSiteSheet(projectCode: string, form: SiteSheetForm, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await leadProject(tx, projectCode, actor);
    const [existing] = await tx.select({ id: siteSheets.id }).from(siteSheets).where(eq(siteSheets.projectId, p.id));
    if (existing) throw new Error(SITE_SHEET_EXISTS);
    const planDays = (await calendarOf(tx, p.code)).durationOf(form.startOn, form.endOn);
    const [row] = await tx.insert(siteSheets).values({ projectId: p.id, ...sheetValues(form), doneDays: 0, planDays, manDaysPlanned: 0, cursusChantierId: null })
      .returning({ id: siteSheets.id });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Site sheet · ${p.code}`, change: `prepared · ${form.startOn} → ${form.endOn} · ${planDays} working days`, area: 'Site', entityType: 'site_sheet',
      entityId: row.id, projectId: p.id, after: { ...form, planDays },
      activity: { text: `Prepared the site sheet · ${form.site}`, kind: 'change' },
    });
  });
}

/**
 * "Edit site sheet": the typed values and the window; refused when the sheet changed since the form opened (`stamp`). The
 * working days are recounted when the window moves (else kept: the seeded figure stays).
 */
export async function updateSiteSheet(projectCode: string, stamp: string, form: SiteSheetForm, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await leadProject(tx, projectCode, actor);
    const s = await sheetOf(tx, p.id);
    if (siteSheetStamp(s) !== stamp) throw new Error(SITE_SHEET_CHANGED);
    const before = formOfSheet(s);
    const moved = s.startOn !== form.startOn || s.endOn !== form.endOn;
    const planDays = moved ? (await calendarOf(tx, p.code)).durationOf(form.startOn, form.endOn) : s.planDays;
    await tx.update(siteSheets).set({ ...sheetValues(form), planDays, updatedAt: new Date() }).where(eq(siteSheets.id, s.id));
    const changed = (Object.keys(before) as (keyof typeof before)[]).filter((k) => before[k] !== form[k]);
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Site sheet · ${p.code}`, change: changed.length ? `edited · ${changed.join(', ')}` : 'edited · no change', area: 'Site', entityType: 'site_sheet',
      entityId: s.id, projectId: p.id,
      before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: { ...Object.fromEntries(changed.map((k) => [k, form[k]])), ...(moved ? { planDays } : {}) },
      activity: { text: `Edited the site sheet · ${form.site}`, kind: 'change' },
    });
  });
}

// ── Lines ───────────────────────────────────────────────────────────────────────────────────────────

const TABLE = { prerequisite: sitePrerequisites, equipment: siteEquipment, rotation: siteRotations, cost: missionCostLines } as const;
const LABEL: Record<SiteLineKind, string> = { prerequisite: 'Prerequisite', equipment: 'Equipment', rotation: 'Rotation', cost: 'Mission cost' };

async function nextPosition(tx: Tx, kind: SiteLineKind, projectId: string): Promise<number> {
  const t = TABLE[kind];
  const [r] = await tx.select({ m: max(t.position) }).from(t).where(eq(t.projectId, projectId));
  return (r?.m ?? -1) + 1;
}

/** A line as it is now, with its stamp and what may change. */
async function lineAt(tx: Tx, kind: SiteLineKind, projectId: string, position: number) {
  switch (kind) {
    case 'prerequisite': {
      const [x] = await tx.select().from(sitePrerequisites).where(and(eq(sitePrerequisites.projectId, projectId), eq(sitePrerequisites.position, position)));
      return x && { id: x.id, name: x.title, stamp: prerequisiteStamp(x), status: x.status, actualKeur: 0, personName: null, personId: null, row: x as Record<string, unknown> };
    }
    case 'equipment': {
      const [x] = await tx.select().from(siteEquipment).where(and(eq(siteEquipment.projectId, projectId), eq(siteEquipment.position, position)));
      return x && { id: x.id, name: x.name, stamp: equipmentStamp(x), status: x.status, actualKeur: 0, personName: null, personId: null, row: x as Record<string, unknown> };
    }
    case 'rotation': {
      const [x] = await tx.select().from(siteRotations).where(and(eq(siteRotations.projectId, projectId), eq(siteRotations.position, position)));
      return x && { id: x.id, name: x.personName, stamp: rotationStamp(x), status: undefined, actualKeur: 0, personName: x.personName, personId: x.personId, row: x as Record<string, unknown> };
    }
    case 'cost': {
      const [x] = await tx.select().from(missionCostLines).where(and(eq(missionCostLines.projectId, projectId), eq(missionCostLines.position, position)));
      return x && { id: x.id, name: x.name, stamp: costStamp(x), status: undefined, actualKeur: x.actualKeur, personName: null, personId: null, row: x as Record<string, unknown> };
    }
  }
}

/** The activity a prerequisite conditions, among the project's plan activities (re-read in the transaction). */
async function planActivityOf(tx: Tx, projectId: string, code: string): Promise<string> {
  const acts = await tx.select({ id: activities.id, code: activities.code }).from(activities).where(eq(activities.projectId, projectId));
  if (!acts.length) throw new Error(NO_PLAN_ACTIVITY);
  const a = acts.find((x) => x.code === code);
  if (!a) throw new Error(UNKNOWN_ACTIVITY);
  return a.id;
}

/** A rotation's person: a member of the project's team (by name), a contractor crew (no person), or the line's current person kept. */
async function rotationPerson(tx: Tx, code: string, line: Extract<SiteLineForm, { kind: 'rotation' }>['value'], current?: { personName: string | null; personId: string | null }) {
  if (line.crew) return null;
  const member = (await getNamedTeam(code, tx)).find((m) => m.name === line.personName);
  if (member) return member.personId;
  if (current && current.personName === line.personName) return current.personId;
  throw new Error(PERSON_REQUIRED);
}

/** Man-days planned stored with the sheet (A-12: Σ crew × working days on the project calendar; the screen recomputes it). */
async function refreshManDays(tx: Tx, code: string, projectId: string): Promise<void> {
  const rot = await tx.select({ person: siteRotations.personName, fromOn: siteRotations.fromOn, toOn: siteRotations.toOn }).from(siteRotations)
    .where(eq(siteRotations.projectId, projectId));
  await tx.update(siteSheets).set({ manDaysPlanned: plannedManDays(rot, await calendarOf(tx, code)), updatedAt: new Date() }).where(eq(siteSheets.projectId, projectId));
}

const lineName = (l: SiteLineForm) => (l.kind === 'prerequisite' ? l.value.title : l.kind === 'rotation' ? l.value.personName : l.value.name);
const lineSummary = (l: SiteLineForm) => {
  switch (l.kind) {
    case 'prerequisite':
      return `${l.value.activityCode} · needed by ${l.value.neededBy}`;
    case 'equipment':
      return equipmentSource.label(l.value.source);
    case 'rotation':
      return `${l.value.fromOn} → ${l.value.toOn} · R${l.value.rotationNo}`;
    case 'cost':
      return `budget ${l.value.budgetKeur} k€`;
  }
};
/** A line row as the audit keeps it (its values, without the ids and timestamps). */
const auditValues = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !['id', 'projectId', 'createdAt', 'updatedAt', 'activityId', 'personId', 'confirmedByPersonId'].includes(k)));

/** "Add …": a new line at the next position (prerequisites and equipment start Pending; a mission cost line has no actual). Returns its position. */
export async function addSiteLine(projectCode: string, line: SiteLineForm, actor: Actor): Promise<number> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await leadProject(tx, projectCode, actor);
    await sheetOf(tx, p.id);
    const position = await nextPosition(tx, line.kind, p.id);
    let id: string;
    switch (line.kind) {
      case 'prerequisite': {
        const v = line.value;
        const activityId = await planActivityOf(tx, p.id, v.activityCode);
        [{ id }] = await tx.insert(sitePrerequisites).values({
          projectId: p.id, title: v.title, activityCode: v.activityCode, activityId, neededBy: v.neededBy, status: 'pending', evidence: v.evidence, position,
        }).returning({ id: sitePrerequisites.id });
        break;
      }
      case 'equipment': {
        const v = line.value;
        [{ id }] = await tx.insert(siteEquipment).values({ projectId: p.id, name: v.name, source: v.source, status: 'pending', note: v.note, position })
          .returning({ id: siteEquipment.id });
        break;
      }
      case 'rotation': {
        const v = line.value;
        const personId = await rotationPerson(tx, p.code, v);
        [{ id }] = await tx.insert(siteRotations).values({
          projectId: p.id, personName: v.personName, personId, roleOnSite: v.roleOnSite, fromOn: v.fromOn, toOn: v.toOn, lodging: v.lodging, travel: v.travel,
          rotationNo: v.rotationNo, position,
        }).returning({ id: siteRotations.id });
        await refreshManDays(tx, p.code, p.id);
        break;
      }
      case 'cost': {
        const v = line.value;
        [{ id }] = await tx.insert(missionCostLines).values({ projectId: p.id, name: v.name, budgetKeur: v.budgetKeur, actualKeur: 0, position })
          .returning({ id: missionCostLines.id });
        break;
      }
    }
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `${LABEL[line.kind]} · ${lineName(line)}`, change: `added · ${lineSummary(line)}`, area: 'Site', entityType: `site_${line.kind}`, entityId: id, projectId: p.id,
      after: { ...line.value, position },
    });
    return position;
  });
}

/**
 * "Edit" of a line, refused when it changed since the form opened (`stamp`) or is no longer editable (a prerequisite or an
 * equipment line confirmed meanwhile). A rotation keeps its person when unchanged, even off the team now.
 */
export async function updateSiteLine(projectCode: string, position: number, stamp: string, line: SiteLineForm, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await leadProject(tx, projectCode, actor);
    await sheetOf(tx, p.id);
    const cur = await lineAt(tx, line.kind, p.id, position);
    if (!cur || cur.stamp !== stamp) throw new Error(SITE_LINE_CHANGED);
    if (!siteLineEditable(line.kind, cur)) throw new Error(SITE_LINE_KEPT);
    const now = new Date();
    switch (line.kind) {
      case 'prerequisite': {
        const v = line.value;
        const activityId = await planActivityOf(tx, p.id, v.activityCode);
        await tx.update(sitePrerequisites).set({ title: v.title, activityCode: v.activityCode, activityId, neededBy: v.neededBy, evidence: v.evidence, updatedAt: now })
          .where(eq(sitePrerequisites.id, cur.id));
        break;
      }
      case 'equipment': {
        const v = line.value;
        await tx.update(siteEquipment).set({ name: v.name, source: v.source, note: v.note, updatedAt: now }).where(eq(siteEquipment.id, cur.id));
        break;
      }
      case 'rotation': {
        const v = line.value;
        const personId = await rotationPerson(tx, p.code, v, cur);
        await tx.update(siteRotations).set({
          personName: v.personName, personId, roleOnSite: v.roleOnSite, fromOn: v.fromOn, toOn: v.toOn, lodging: v.lodging, travel: v.travel, rotationNo: v.rotationNo,
        }).where(eq(siteRotations.id, cur.id));
        await refreshManDays(tx, p.code, p.id);
        break;
      }
      case 'cost': {
        const v = line.value;
        await tx.update(missionCostLines).set({ name: v.name, budgetKeur: v.budgetKeur }).where(eq(missionCostLines.id, cur.id));
        break;
      }
    }
    const after = line.value as unknown as Record<string, unknown>;
    const changed = Object.keys(after).filter((k) => k !== 'crew' && k in cur.row && cur.row[k] !== after[k]);
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `${LABEL[line.kind]} · ${lineName(line)}`, change: changed.length ? `edited · ${changed.join(', ')}` : 'edited · no change', area: 'Site',
      entityType: `site_${line.kind}`, entityId: cur.id, projectId: p.id,
      before: Object.fromEntries(changed.map((k) => [k, cur.row[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])),
    });
  });
}

/**
 * "Remove" of a line without recorded evidence: a pending prerequisite or equipment line, a rotation, a mission cost line
 * without an actual. Refused when it changed since the page showed it (`stamp`). The positions of the other lines stay.
 */
export async function removeSiteLine(projectCode: string, kind: SiteLineKind, position: number, stamp: string, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await leadProject(tx, projectCode, actor);
    await sheetOf(tx, p.id);
    const cur = await lineAt(tx, kind, p.id, position);
    if (!cur || cur.stamp !== stamp) throw new Error(SITE_LINE_CHANGED);
    if (!siteLineRemovable(kind, cur)) throw new Error(kind === 'cost' ? SITE_COST_KEPT : SITE_LINE_KEPT);
    const t = TABLE[kind];
    await tx.delete(t).where(eq(t.id, cur.id));
    if (kind === 'rotation') await refreshManDays(tx, p.code, p.id);
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `${LABEL[kind]} · ${cur.name}`, change: 'removed', area: 'Site', entityType: `site_${kind}`, entityId: cur.id, projectId: p.id, before: auditValues(cur.row),
    });
  });
}
