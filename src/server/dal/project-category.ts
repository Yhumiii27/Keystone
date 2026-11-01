import 'server-only';
// R-196 (Crucible K-3, K-196): a project's category — client project or R&D project (projects.category), chosen in the New project
// wizard and changed by the project's leads and the director on the Contract screen; published at the end of pub_projets as
// `categorie`. Rules: src/domain/project-category.ts.
import { eq } from 'drizzle-orm';
import { isProjectCategory, PROJECT_CATEGORY_LABEL, type ProjectCategory } from '@/domain/project-category';
import { systemMessage } from '@/domain/system-messages';
import { getDb } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { projects } from '@/server/db/schema';
import type { Actor } from './ops-common';

/** The project's category ('client' for an unknown project). */
export async function getProjectCategory(projectCode: string): Promise<ProjectCategory> {
  const db = await getDb();
  const [r] = await db.select({ category: projects.category }).from(projects).where(eq(projects.code, projectCode));
  return r?.category ?? 'client';
}

/**
 * Sets the project's category. The Server Function checks the viewer's rights; the value is checked again here. Writes one audit
 * row (before / after) and one activity event when it changes. Returns the stored category.
 */
export async function setProjectCategory(projectCode: string, category: unknown, actor: Actor): Promise<ProjectCategory> {
  if (!isProjectCategory(category)) throw new Error('Choose the project category');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const [cur] = await tx.select({ category: projects.category }).from(projects).where(eq(projects.id, p.id)).for('update');
    const old = cur?.category ?? 'client';
    if (old === category) return old;
    await tx.update(projects).set({ category, updatedAt: new Date() }).where(eq(projects.id, p.id));
    const person = await findPerson(tx, actor.name);
    const who = person ? nameOf(person) : actor.name;
    const message = systemMessage('project.category', { from: PROJECT_CATEGORY_LABEL[old], to: PROJECT_CATEGORY_LABEL[category] });
    await writeAudit(tx, {
      actorName: who, actorPersonId: person?.id, objectRef: projectCode, message, area: 'Contract', entityType: 'project', entityId: p.id, projectId: p.id,
      before: { category: old }, after: { category },
    });
    await recordActivity(tx, { actorName: who, actorPersonId: person?.id, message, kind: 'change', projectId: p.id });
    return category;
  });
}
