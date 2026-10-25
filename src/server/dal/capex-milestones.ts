import 'server-only';
// R-189 (Arche K-04): the CAPEX milestone code of a project's schedule milestones (milestones.capex_milestone_code), read by the
// Schedule screen's milestone list and set there by the project's leads. pub_jalons_projets publishes the BL1 date of the tagged
// milestone as `reference_le` (drizzle/0057_capex_milestone_share.sql). Rules: src/domain/capex-milestones.ts.
import { and, asc, eq, ne } from 'drizzle-orm';
import { CAPEX_MILESTONE_LABELS, NO_CAPEX_MILESTONE, type CapexMilestoneCode } from '@/domain/capex-milestones';
import { systemMessage } from '@/domain/system-messages';
import { getDb } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { milestones, projects } from '@/server/db/schema';
import type { Actor } from './ops-common';

export interface CapexMilestoneRow {
  id: string;
  name: string;
  position: number;
  capexCode: CapexMilestoneCode | null;
}

/** The project's schedule milestones with their CAPEX code, in schedule order (the Schedule screen's milestone list). */
export async function listCapexMilestones(projectCode: string): Promise<CapexMilestoneRow[]> {
  const db = await getDb();
  return db
    .select({ id: milestones.id, name: milestones.name, position: milestones.position, capexCode: milestones.capexMilestoneCode })
    .from(milestones)
    .innerJoin(projects, eq(projects.id, milestones.projectId))
    .where(eq(projects.code, projectCode))
    .orderBy(asc(milestones.position));
}

const label = (c: CapexMilestoneCode | null) => (c ? CAPEX_MILESTONE_LABELS[c] : NO_CAPEX_MILESTONE);

export class UnknownMilestoneError extends Error {
  constructor() {
    super('Unknown milestone');
  }
}

/**
 * Sets (null clears) the CAPEX code of one milestone of the project. A code is one milestone per project: the milestone that
 * held it loses it in the same transaction (said in its own audit row). The Server Function checks the viewer's rights; the
 * code is validated by the caller (`parseCapexMilestoneCode`). Moves `updated_at` of the milestones it changes (pub_jalons,
 * pub_jalons_projets). Returns the stored code.
 */
export async function setMilestoneCapexCode(projectCode: string, milestoneId: string, code: CapexMilestoneCode | null, actor: Actor): Promise<CapexMilestoneCode | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const [m] = await tx
      .select({ id: milestones.id, name: milestones.name, capexCode: milestones.capexMilestoneCode })
      .from(milestones)
      .where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, p.id)))
      .for('update');
    if (!m) throw new UnknownMilestoneError();
    if (m.capexCode === code) return code;
    const person = await findPerson(tx, actor.name);
    const who = person ? nameOf(person) : actor.name;
    const now = new Date();
    const changed: { id: string; name: string; from: CapexMilestoneCode | null; to: CapexMilestoneCode | null }[] = [];
    if (code) {
      const holders = await tx
        .select({ id: milestones.id, name: milestones.name })
        .from(milestones)
        .where(and(eq(milestones.projectId, p.id), eq(milestones.capexMilestoneCode, code), ne(milestones.id, m.id)))
        .for('update');
      for (const h of holders) {
        await tx.update(milestones).set({ capexMilestoneCode: null, updatedAt: now }).where(eq(milestones.id, h.id));
        changed.push({ id: h.id, name: h.name, from: code, to: null });
      }
    }
    await tx.update(milestones).set({ capexMilestoneCode: code, updatedAt: now }).where(eq(milestones.id, m.id));
    changed.push({ id: m.id, name: m.name, from: m.capexCode, to: code });
    for (const c of changed) {
      const message = systemMessage('milestone.capexCode', { milestone: c.name, from: label(c.from), to: label(c.to) });
      await writeAudit(tx, {
        actorName: who, actorPersonId: person?.id, objectRef: projectCode, message, area: 'Planning', entityType: 'milestone', entityId: c.id, projectId: p.id,
        before: { capexMilestoneCode: c.from }, after: { capexMilestoneCode: c.to },
      });
    }
    const last = changed[changed.length - 1];
    await recordActivity(tx, {
      actorName: who, actorPersonId: person?.id, kind: 'change', projectId: p.id,
      message: systemMessage('milestone.capexCode', { milestone: last.name, from: label(last.from), to: label(last.to) }),
    });
    return code;
  });
}
