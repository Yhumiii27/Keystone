import 'server-only';
// Progress recorded in Keystone on a Vigie ECO (the viewer's approval-key decision, step advancement): validated
// against the mirror and queued in the outbox (vigie_eco_progress) "pending sync with Vigie".
import { and, eq, inArray } from 'drizzle-orm';
import { ECO_STEP_ADVANCE, ecoApproverKey, ecoDecision, ecoKeyOfRole, ecoStatus, vigieSyncStatus, type EcoStatus } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { projects, vigieEcoProgress, vigieEcos } from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { entryOf } from './mirror';
import type { EcoProgressActor, EcoProgressEntry, EcoProgressInput, VigieEco } from './types';

/**
 * Roles whose workspace includes Change orders (ROLE_SCREENS 3465 for `eco`, 09 §0.2 — the same list as
 * src/config/screens.ts, kept here so the connector stays loadable outside React, e.g. by scripts/db-check.ts).
 */
export const ECO_SCREEN_ROLES: readonly string[] = ['director', 'pm', 'englead', 'quality', 'procurement'];

/**
 * Validates progress against the mirror and queues it in the outbox ("pending sync with Vigie"), with an audit row
 * and an activity event. Rules (09 §4.7–4.8, the prototype's in-screen gates, server-side):
 * - approval: only the viewer's own key (ecoRoleKey: englead, quality, pm — the director holds none), the ECO in
 *   approval in Vigie, the key still pending and not already decided in Keystone; the PM key belongs to the PMs of
 *   the ECO's projects;
 * - step: "Start impact analysis" (Draft) and "Submit for approval" (Impact analysis, interchangeability decided in
 *   Vigie), one at a time, by a viewer whose workspace includes the ECO screen.
 */
export async function recordProgressEntry(
  tx: Tx, eco: VigieEco, input: EcoProgressInput, actor: EcoProgressActor, at: Date = new Date(),
): Promise<EcoProgressEntry> {
  const comment = input.comment?.trim() || null;
  const person = await findPerson(tx, actor.name);
  const who = person ? nameOf(person) : actor.name;
  const [row] = await tx.select({ id: vigieEcos.id }).from(vigieEcos).where(eq(vigieEcos.number, eco.number));
  if (!row) throw new Error(`Unknown ECO ${eco.number}`);
  let values: Omit<typeof vigieEcoProgress.$inferInsert, 'ecoId' | 'ecoNumber' | 'actorName' | 'actorPersonId' | 'actorRole' | 'recordedAt' | 'syncStatus' | 'fromStatus' | 'comment'>;
  let change: string;
  let text: string;
  if ('key' in input) {
    const own = ecoKeyOfRole(actor.role);
    if (!own) throw new Error('Your role holds no ECO approval');
    if (input.key !== own) throw new Error(`Only the ${ecoApproverKey.label(input.key)} decides this approval`);
    if (input.decision !== 'ok' && input.decision !== 'rejected') throw new Error('Invalid decision');
    if (eco.status !== 'in_approval') throw new Error(`${eco.number} is not in approval`);
    const a = eco.approvals.find((x) => x.key === input.key);
    if (!a || a.decision !== 'pending') throw new Error(`${eco.number}: the ${ecoApproverKey.label(input.key)} approval is not pending`);
    if (a.pending) throw new Error(`${eco.number}: a decision is already waiting for Vigie`);
    if (input.key === 'pm') {
      const managed = person
        ? (await tx.select({ code: projects.code }).from(projects).where(and(eq(projects.pmPersonId, person.id), inArray(projects.code, eco.projects.length ? eco.projects : ['']))))
        : [];
      if (!managed.length) throw new Error(`${eco.number}: only a PM of an impacted project decides the PM approval`);
    }
    values = { kind: 'approval', approvalKey: input.key, decision: input.decision, targetStatus: null };
    change = `${ecoApproverKey.label(input.key)}: Pending → ${ecoDecision.label(input.decision)} · ${vigieSyncStatus.label('pending')}`;
    text = `${input.decision === 'ok' ? 'Approved' : 'Rejected'} ${eco.number} · ${ecoApproverKey.label(input.key)} · ${vigieSyncStatus.label('pending')}`;
  } else {
    if (!ECO_SCREEN_ROLES.includes(actor.role)) throw new Error('Change orders are outside your workspace');
    const target: EcoStatus = input.step;
    if (eco.requestedStatus) throw new Error(`${eco.number}: a step change is already waiting for Vigie`);
    if (ECO_STEP_ADVANCE[eco.status] !== target) throw new Error(`${eco.number} cannot move from ${ecoStatus.label(eco.status)} to ${ecoStatus.isCode(target) ? ecoStatus.label(target) : target}`);
    if (target === 'in_approval' && !eco.interchangeability) throw new Error(`${eco.number}: decide interchangeability in Vigie before submitting for approval`);
    values = { kind: 'step', approvalKey: null, decision: null, targetStatus: target };
    change = `status: ${ecoStatus.label(eco.status)} → ${ecoStatus.label(target)} · ${vigieSyncStatus.label('pending')}`;
    text = `${target === 'impact_analysis' ? 'Started the impact analysis of' : 'Submitted for approval'} ${eco.number} · ${vigieSyncStatus.label('pending')}`;
  }
  const [entry] = await tx
    .insert(vigieEcoProgress)
    .values({
      ...values, ecoId: row.id, ecoNumber: eco.number, fromStatus: eco.status, comment, actorName: who, actorPersonId: person?.id ?? null, actorRole: actor.role,
      recordedAt: at, syncStatus: 'pending',
    })
    .returning();
  await writeAudit(tx, { actorName: who, actorPersonId: person?.id, objectRef: eco.number, change, area: 'ECO', entityType: 'vigie_eco_progress', entityId: entry.id, occurredAt: at });
  await recordActivity(tx, { actorName: who, actorPersonId: person?.id, text, kind: 'eco', occurredAt: at });
  return entryOf(entry);
}
