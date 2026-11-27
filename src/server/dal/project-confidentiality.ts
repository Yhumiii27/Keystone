import 'server-only';
// ING-29 (owner, 27 Nov 2026): a project's confidentiality — normal or confidential (projects.confidentiality), set by the
// project's leads and the director on Project resources (src/features/team/confidentiality-actions.ts); a confidential project is
// seen by its team only (src/server/dal/project-visibility.ts). Rules: src/domain/confidentiality.ts.
import { eq } from 'drizzle-orm';
import { PROJECT_CONFIDENTIALITY_LABEL, isProjectConfidentiality, type ProjectConfidentiality } from '@/domain/confidentiality';
import { systemMessage } from '@/domain/system-messages';
import { getDb } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { projects } from '@/server/db/schema';
import type { Actor } from './ops-common';

/** The project's confidentiality ('normal' for an unknown project). */
export async function getProjectConfidentiality(projectCode: string): Promise<ProjectConfidentiality> {
  const db = await getDb();
  const [r] = await db.select({ c: projects.confidentiality }).from(projects).where(eq(projects.code, projectCode));
  return r?.c ?? 'normal';
}

/**
 * Sets the project's confidentiality. The Server Function checks the viewer's rights; the value is checked again here (and by the
 * column's CHECK). One audit row (before / after, append-only trail) and one activity event when it changes. Returns the value.
 */
export async function setProjectConfidentiality(projectCode: string, value: unknown, actor: Actor): Promise<ProjectConfidentiality> {
  if (!isProjectConfidentiality(value)) throw new Error('Choose the project confidentiality');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const [cur] = await tx.select({ c: projects.confidentiality }).from(projects).where(eq(projects.id, p.id)).for('update');
    const old = cur?.c ?? 'normal';
    if (old === value) return old;
    await tx.update(projects).set({ confidentiality: value, updatedAt: new Date() }).where(eq(projects.id, p.id));
    const person = await findPerson(tx, actor.name);
    const who = person ? nameOf(person) : actor.name;
    const message = systemMessage('project.confidentiality', { from: PROJECT_CONFIDENTIALITY_LABEL[old], to: PROJECT_CONFIDENTIALITY_LABEL[value] });
    await writeAudit(tx, {
      actorName: who, actorPersonId: person?.id, objectRef: projectCode, message, area: 'Project team', entityType: 'project', entityId: p.id, projectId: p.id,
      before: { confidentiality: old }, after: { confidentiality: value },
    });
    await recordActivity(tx, { actorName: who, actorPersonId: person?.id, message, kind: 'change', projectId: p.id });
    return value;
  });
}
