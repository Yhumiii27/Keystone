import 'server-only';
// R-190 (Arche K-05): a project's link to the subsidiary CAPEX it delivers (projects.capex_code, projects.besoin_ref), set by
// the project's leads on the Contract screen and published at the end of pub_projets for Arche. Rules: src/domain/capex-link.ts.
import { eq } from 'drizzle-orm';
import { parseCapexLink, type CapexLink } from '@/domain/capex-link';
import { systemMessage } from '@/domain/system-messages';
import { getDb } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { projects } from '@/server/db/schema';
import type { Actor } from './ops-common';

/** The project's CAPEX link (both null when none, or for an unknown project). */
export async function getCapexLink(projectCode: string): Promise<CapexLink> {
  const db = await getDb();
  const [r] = await db.select({ capexCode: projects.capexCode, needRef: projects.besoinRef }).from(projects).where(eq(projects.code, projectCode));
  return { capexCode: r?.capexCode ?? null, needRef: r?.needRef ?? null };
}

const show = (l: CapexLink) => (l.capexCode ? (l.needRef ? `${l.capexCode} · ${l.needRef}` : l.capexCode) : '—');

/**
 * Sets (or with empty values clears) the project's CAPEX link. The Server Function checks the viewer's rights; the input is
 * parsed again here. Writes one audit row and one activity event when something changes. Returns the stored link.
 */
export async function setCapexLink(projectCode: string, input: { capexCode?: unknown; needRef?: unknown }, actor: Actor): Promise<CapexLink> {
  const parsed = parseCapexLink(input);
  if (!parsed.ok) throw new Error(parsed.error);
  const next = parsed.value;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const [cur] = await tx.select({ capexCode: projects.capexCode, needRef: projects.besoinRef }).from(projects).where(eq(projects.id, p.id)).for('update');
    const old: CapexLink = { capexCode: cur?.capexCode ?? null, needRef: cur?.needRef ?? null };
    if (old.capexCode === next.capexCode && old.needRef === next.needRef) return old;
    await tx.update(projects).set({ capexCode: next.capexCode, besoinRef: next.needRef, updatedAt: new Date() }).where(eq(projects.id, p.id));
    const person = await findPerson(tx, actor.name);
    const who = person ? nameOf(person) : actor.name;
    const message = systemMessage('project.capexLink', { from: show(old), to: show(next) });
    await writeAudit(tx, {
      actorName: who, actorPersonId: person?.id, objectRef: projectCode, message, area: 'Contract', entityType: 'project', entityId: p.id, projectId: p.id,
      before: { ...old }, after: { ...next },
    });
    await recordActivity(tx, { actorName: who, actorPersonId: person?.id, message, kind: 'change', projectId: p.id });
    return next;
  });
}
