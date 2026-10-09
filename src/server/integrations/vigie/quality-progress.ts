import 'server-only';
// Progress recorded in Keystone on a Vigie NCR: one step forward ("→ Root cause", the prototype's row and drawer
// action) or the quality verification of My approvals (approve → Closed, reject → back to Corrective action). Validated
// against the mirror and queued in the outbox (vigie_ncr_progress) "pending sync with Vigie"; the NCR keeps Vigie's
// status until Vigie reports the change. Creation, severity, causes, actions, costs and due dates are managed in Vigie.
import { eq, and } from 'drizzle-orm';
import { NCR_VERIFIER_ROLES, inWorkspace, ncrNextStatus, ncrStatus, vigieSyncStatus, type NcrStatus } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { projects, vigieNcrProgress, vigieNcrs } from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { ncrEntryOf } from './quality-mirror';
import type { EcoProgressActor, NcrProgressEntry, NcrProgressInput, VigieNcr } from './types';

/**
 * Rules (07 §2.3.a, §5; the user decision "NCR verification / closure by quality"), server-side:
 * - the viewer's workspace includes the Quality screen;
 * - one request at a time per NCR (a request already waiting for Vigie blocks the next one);
 * - step: exactly the next step of Vigie's status, never Closed — closing is the quality verification;
 * - verification: quality only, on an NCR in Verification; approve → Closed, reject → Corrective action.
 */
export async function recordNcrProgressEntry(
  tx: Tx, ncr: VigieNcr, input: NcrProgressInput, actor: EcoProgressActor, at: Date = new Date(),
): Promise<NcrProgressEntry> {
  if (!inWorkspace('quality', actor.role)) throw new Error('Quality is outside your workspace');
  const [row] = await tx.select({ id: vigieNcrs.id }).from(vigieNcrs).where(and(eq(vigieNcrs.projectCode, ncr.projectCode), eq(vigieNcrs.number, ncr.number)));
  if (!row) throw new Error(`Unknown NCR ${ncr.number} on ${ncr.projectCode}`);
  if (ncr.requestedStatus) throw new Error(`${ncr.number}: a change is already waiting for Vigie`);
  if (ncr.status === 'closed') throw new Error(`${ncr.number} is closed`);
  const comment = input.comment?.trim() || null;
  const person = await findPerson(tx, actor.name);
  const who = person ? nameOf(person) : actor.name;
  let target: NcrStatus;
  let kind: 'step' | 'verification';
  let decision: 'approved' | 'rejected' | null = null;
  if ('verification' in input) {
    if (!NCR_VERIFIER_ROLES.includes(actor.role)) throw new Error('Only the quality manager verifies and closes NCRs');
    if (ncr.status !== 'verification') throw new Error(`${ncr.number} is not in verification`);
    if (input.verification !== 'approved' && input.verification !== 'rejected') throw new Error('Invalid decision');
    kind = 'verification';
    decision = input.verification;
    target = decision === 'approved' ? 'closed' : 'corrective_action';
  } else {
    if (!ncrStatus.isCode(input.step)) throw new Error('Invalid step');
    const next = ncrNextStatus(ncr.status);
    if (input.step !== next) throw new Error(`${ncr.number} cannot move from ${ncrStatus.label(ncr.status)} to ${ncrStatus.label(input.step)}`);
    if (next === 'closed') throw new Error('Only the quality manager verifies and closes NCRs');
    kind = 'step';
    target = next;
  }
  const [entry] = await tx
    .insert(vigieNcrProgress)
    .values({
      ncrId: row.id, projectCode: ncr.projectCode, ncrNumber: ncr.number, kind, decision, fromStatus: ncr.status, targetStatus: target, comment, actorName: who,
      actorPersonId: person?.id ?? null, actorRole: actor.role, recordedAt: at, syncStatus: 'pending',
    })
    .returning();
  const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, ncr.projectCode));
  const pending = vigieSyncStatus.label('pending');
  const change = `status: ${ncrStatus.label(ncr.status)} → ${ncrStatus.label(target)}${decision ? ` (verification ${decision})` : ''} · ${pending}`;
  const text = kind === 'verification'
    ? `${decision === 'approved' ? 'Verified and closed' : 'Sent back to corrective action'} ${ncr.number} · ${pending}`
    : `Moved ${ncr.number} to ${ncrStatus.label(target)} · ${pending}`;
  await writeAudit(tx, { actorName: who, actorPersonId: person?.id, objectRef: ncr.number, change, area: 'Quality', entityType: 'vigie_ncr_progress', entityId: entry.id, projectId: p?.id ?? null, occurredAt: at });
  await recordActivity(tx, { actorName: who, actorPersonId: person?.id, text, kind: 'quality', projectId: p?.id ?? null, occurredAt: at });
  return ncrEntryOf(entry);
}
