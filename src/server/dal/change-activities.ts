import 'server-only';
// Change request ↔ plan activities DAL (Delivery 7, NEW-D2-2 = a, R-062; rules in src/domain/change-activities.ts).
// A request names the activities it touches and, optionally, their new duration; the links are listed on the request
// (Change control drawer) and on the activity (Plan drawer). Once the request is approved, `applyApprovedChangeDurations`
// — called by "Reschedule" before the CPM runs — writes the new durations into the plan, once, audited. Links are by
// activity code within the request's project (they survive the plan trash). Permission checks belong to the callers; the
// link writers re-check the rule with the actor (defense in depth): the project's team with Change control in their
// workspace, or the director — never the client (the plan is internal; `canEditCrActivities`).
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { crActivitiesEditable, isPendingDuration, type CrActivityInput } from '@/domain/change-activities';
import { deriveCrStatus } from '@/domain/change-control';
import { getDb } from '@/server/db/client';
import { changeStatus, type ChangeStatus } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { activities, changeRequestActivities, changeRequestSteps, changeRequests, projects } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import type { Actor } from './ops-common';
import { editsProjectScreen } from './team-guard';

type Q = DB | Tx;

/** A link as the screens show it. `name` / `durationDays` are null when the activity is no longer in the plan. */
export interface CrActivityLink {
  cr: string;
  crTitle: string;
  /** Effective status of the request (derived from its approval chain). */
  crStatus: ChangeStatus;
  code: string;
  name: string | null;
  durationDays: number | null;
  newDurationDays: number | null;
  /** ISO timestamp of the Reschedule that applied the new duration; null until then. */
  appliedAt: string | null;
  appliedFromDays: number | null;
}

/** A refused link change (EN source message). */
export class CrActivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrActivityError';
  }
}

async function projectIdOf(q: Q, code: string): Promise<string> {
  const [p] = await q.select({ id: projects.id }).from(projects).where(eq(projects.code, code));
  if (!p) throw new CrActivityError('Unknown project');
  return p.id;
}

/** Effective status of requests (chain-derived, as the register shows them). */
async function effectiveStatuses(q: Q, crs: { id: string; status: ChangeStatus }[]): Promise<Map<string, ChangeStatus>> {
  if (!crs.length) return new Map();
  const steps = await q.select({ cr: changeRequestSteps.changeRequestId, step: changeRequestSteps.step, decision: changeRequestSteps.decision })
    .from(changeRequestSteps).where(inArray(changeRequestSteps.changeRequestId, crs.map((c) => c.id)));
  return new Map(crs.map((c) => [c.id, deriveCrStatus(c.status, steps.filter((s) => s.cr === c.id).map((s) => ({ step: s.step, decision: s.decision })))]));
}

/** Every link of a project's requests, register then link order. */
export async function listCrActivityLinks(projectCode: string, q?: Q): Promise<CrActivityLink[]> {
  const db = q ?? (await getDb());
  const pid = await projectIdOf(db, projectCode).catch(() => null);
  if (!pid) return [];
  const rows = await db
    .select({ l: changeRequestActivities, cr: changeRequests.number, crId: changeRequests.id, title: changeRequests.title, status: changeRequests.status })
    .from(changeRequestActivities)
    .innerJoin(changeRequests, eq(changeRequests.id, changeRequestActivities.changeRequestId))
    .where(eq(changeRequests.projectId, pid))
    .orderBy(asc(changeRequests.position), asc(changeRequestActivities.position));
  if (!rows.length) return [];
  const [acts, status] = await Promise.all([
    db.select({ code: activities.code, name: activities.name, days: activities.durationDays }).from(activities)
      .where(and(eq(activities.projectId, pid), inArray(activities.code, [...new Set(rows.map((r) => r.l.activityCode))]))),
    effectiveStatuses(db, [...new Map(rows.map((r) => [r.crId, { id: r.crId, status: r.status }])).values()]),
  ]);
  const byCode = new Map(acts.map((a) => [a.code, a]));
  return rows.map((r) => ({
    cr: r.cr, crTitle: r.title, crStatus: status.get(r.crId) ?? r.status, code: r.l.activityCode, name: byCode.get(r.l.activityCode)?.name ?? null,
    durationDays: byCode.get(r.l.activityCode)?.days ?? null, newDurationDays: r.l.newDurationDays, appliedAt: r.l.appliedAt?.toISOString() ?? null,
    appliedFromDays: r.l.appliedFromDays,
  }));
}

/** Codes among `codes` that are not activities of the project's plan (form validation before a request is raised). */
export async function unknownActivityCodes(projectCode: string, codes: readonly string[]): Promise<string[]> {
  if (!codes.length) return [];
  const db = await getDb();
  const pid = await projectIdOf(db, projectCode);
  const known = new Set((await db.select({ code: activities.code }).from(activities).where(and(eq(activities.projectId, pid), inArray(activities.code, [...codes])))).map((a) => a.code));
  return codes.filter((c) => !known.has(c));
}

/** Refusal of a link change by someone off the project's team, or the client (EN source; FR in d7-operations.json). */
export const CR_ACTIVITIES_TEAM_ONLY = 'Only the project team links plan activities to a change request';

/** The actor may change the links of the project's requests (see the header), else throws. */
async function requireLinkEditor(tx: Tx, actor: Actor, projectId: string): Promise<void> {
  if (!(await editsProjectScreen(tx, actor, projectId, 'changes'))) throw new CrActivityError(CR_ACTIVITIES_TEAM_ONLY);
}

/** The request of a project by number, for a link change: refused unless it is still open. */
async function openRequest(tx: Tx, projectId: string, number: string) {
  const [cr] = await tx.select({ id: changeRequests.id, status: changeRequests.status }).from(changeRequests)
    .where(and(eq(changeRequests.projectId, projectId), eq(changeRequests.number, number)));
  if (!cr) throw new CrActivityError('Unknown change request');
  const status = (await effectiveStatuses(tx, [cr])).get(cr.id)!;
  if (!crActivitiesEditable(status)) throw new CrActivityError('A decided change request can no longer be changed');
  return cr;
}

/**
 * Links activities to an open request (or updates the new duration of an activity already linked), in one transaction:
 * every code must be an activity of the project's plan. `actor` = the viewer (name and role), re-checked. Audited on the
 * request. Returns the codes linked.
 */
export async function linkCrActivities(projectCode: string, number: string, items: CrActivityInput[], actor: Actor, q?: Tx): Promise<string[]> {
  if (!items.length) return [];
  const actorName = actor.name;
  const run = async (tx: Tx) => {
    const pid = await projectIdOf(tx, projectCode);
    await requireLinkEditor(tx, actor, pid);
    const cr = await openRequest(tx, pid, number);
    const known = new Map((await tx.select({ code: activities.code, days: activities.durationDays }).from(activities)
      .where(and(eq(activities.projectId, pid), inArray(activities.code, items.map((i) => i.code))))).map((a) => [a.code, a.days]));
    const missing = items.filter((i) => !known.has(i.code)).map((i) => i.code);
    if (missing.length) throw new CrActivityError(`Unknown activity ${missing.join(', ')}`);
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${changeRequestActivities.position}), -1)::int` }).from(changeRequestActivities)
      .where(eq(changeRequestActivities.changeRequestId, cr.id));
    const person = await findPerson(tx, actorName);
    let next = pos + 1;
    for (const i of items) {
      await tx.insert(changeRequestActivities)
        .values({ changeRequestId: cr.id, activityCode: i.code, newDurationDays: i.newDurationDays, position: next++, createdByPersonId: person?.id ?? null })
        .onConflictDoUpdate({ target: [changeRequestActivities.changeRequestId, changeRequestActivities.activityCode], set: { newDurationDays: i.newDurationDays } });
    }
    const who = person ? nameOf(person) : actorName;
    const text = items.map((i) => (i.newDurationDays == null ? i.code : `${i.code} ${known.get(i.code)} d → ${i.newDurationDays} d`)).join(', ');
    await writeAudit(tx, { actorName: who, actorPersonId: person?.id, objectRef: number, change: `activities touched: ${text}`, area: 'Change control', entityType: 'change_request', entityId: cr.id, projectId: pid });
    return items.map((i) => i.code);
  };
  if (q) return run(q);
  return (await getDb()).transaction(run);
}

/** Removes an activity from an open request (audited). `actor` = the viewer (name and role), re-checked. */
export async function unlinkCrActivity(projectCode: string, number: string, code: string, actor: Actor): Promise<void> {
  const actorName = actor.name;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const pid = await projectIdOf(tx, projectCode);
    await requireLinkEditor(tx, actor, pid);
    const cr = await openRequest(tx, pid, number);
    const gone = await tx.delete(changeRequestActivities)
      .where(and(eq(changeRequestActivities.changeRequestId, cr.id), eq(changeRequestActivities.activityCode, code))).returning({ id: changeRequestActivities.id });
    if (!gone.length) throw new CrActivityError('This activity is not linked to the request');
    const person = await findPerson(tx, actorName);
    await writeAudit(tx, {
      actorName: person ? nameOf(person) : actorName, actorPersonId: person?.id, objectRef: number, change: `activity no longer touched: ${code}`, area: 'Change control',
      entityType: 'change_request', entityId: cr.id, projectId: pid,
    });
  });
}

/**
 * "Reschedule" (NEW-D2-2: "the impact appears at the next Reschedule"): the new durations of approved requests not applied
 * yet are written into the plan (an activity not complete; the imported remaining duration is cleared, as a duration
 * edit does), once, audited and written to the feed. Returns what was applied.
 */
export async function applyApprovedChangeDurations(projectCode: string, actorName: string): Promise<{ cr: string; code: string; from: number; to: number }[]> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const pid = await projectIdOf(tx, projectCode).catch(() => null);
    if (!pid) return [];
    const rows = await tx
      .select({ l: changeRequestActivities, cr: changeRequests.number, crId: changeRequests.id, status: changeRequests.status })
      .from(changeRequestActivities)
      .innerJoin(changeRequests, eq(changeRequests.id, changeRequestActivities.changeRequestId))
      .where(and(eq(changeRequests.projectId, pid), isNull(changeRequestActivities.appliedAt), sql`${changeRequestActivities.newDurationDays} is not null`))
      .orderBy(asc(changeRequests.position), asc(changeRequestActivities.position));
    if (!rows.length) return [];
    const status = await effectiveStatuses(tx, [...new Map(rows.map((r) => [r.crId, { id: r.crId, status: r.status }])).values()]);
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    const at = new Date();
    const applied: { cr: string; code: string; from: number; to: number }[] = [];
    for (const r of rows) {
      if (!isPendingDuration(r.l, status.get(r.crId) ?? r.status)) continue;
      const [a] = await tx.select({ id: activities.id, days: activities.durationDays, pct: activities.percentComplete }).from(activities)
        .where(and(eq(activities.projectId, pid), eq(activities.code, r.l.activityCode)));
      // An activity removed from the plan or already complete keeps the link unapplied (shown as such).
      if (!a || a.pct >= 100) continue;
      const to = r.l.newDurationDays!;
      await tx.update(activities).set({ durationDays: to, remainingDays: null, updatedAt: at }).where(eq(activities.id, a.id));
      await tx.update(changeRequestActivities).set({ appliedAt: at, appliedFromDays: a.days }).where(eq(changeRequestActivities.id, r.l.id));
      await writeAudit(tx, {
        actorName: who, actorPersonId: actor?.id, objectRef: r.l.activityCode, change: `duration ${a.days} d → ${to} d · ${r.cr} ${changeStatus.label('approved').toLowerCase()}`,
        area: 'Planning', entityType: 'activity', entityId: a.id, projectId: pid, occurredAt: at,
      });
      await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, kind: 'change', projectId: pid, occurredAt: at, text: `${r.cr} applied to ${r.l.activityCode} · ${a.days} d → ${to} d` });
      applied.push({ cr: r.cr, code: r.l.activityCode, from: a.days, to });
    }
    return applied;
  });
}
