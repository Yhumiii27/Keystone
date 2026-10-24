import 'server-only';
// R-190 (Arche K-05): the project's client as a group subsidiary — clients.is_internal and clients.subsidiary_code, published at
// the end of pub_projets (client_interne, filiale_code). Set by the director on the Contract screen's "Client" card, or when a
// project is created from a subsidiary's ordered need (R-187, `markNeedSubsidiaryClient`). Rules: src/domain/internal-client.ts.
// The flag is on the client: every project of that client gets it, and their projects.updated_at moves (pub_projets.maj_le).
import { asc, eq, isNotNull } from 'drizzle-orm';
import { isSubsidiaryClient, parseInternalClient, type InternalClient } from '@/domain/internal-client';
import { systemMessage } from '@/domain/system-messages';
import { getDb } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { capexMirror, clients, projects } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import type { Actor } from './ops-common';

type Q = DB | Tx;

export interface ProjectClient extends InternalClient {
  id: string;
  name: string;
}

/** The project's registered client (null: unknown project or no client). */
export async function getProjectClient(projectCode: string, q?: Q): Promise<ProjectClient | null> {
  const db = q ?? (await getDb());
  const [r] = await db
    .select({ id: clients.id, name: clients.name, isInternal: clients.isInternal, subsidiaryCode: clients.subsidiaryCode })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(projects.code, projectCode));
  return r ?? null;
}

/**
 * The group subsidiaries Keystone knows, code → name: those of the CAPEX mirrored from Arche (pub_capex.filiale_code, filiale),
 * then the codes already set on a client (named after that client). Code order.
 */
export async function listSubsidiaries(q?: Q): Promise<{ code: string; name: string }[]> {
  const db = q ?? (await getDb());
  const [mirror, registered] = await Promise.all([
    db.selectDistinct({ code: capexMirror.subsidiaryCode, name: capexMirror.subsidiaryName }).from(capexMirror).where(isNotNull(capexMirror.subsidiaryCode)),
    db.select({ code: clients.subsidiaryCode, name: clients.name }).from(clients).where(isNotNull(clients.subsidiaryCode)).orderBy(asc(clients.subsidiaryCode)),
  ]);
  const byCode = new Map<string, string>();
  for (const r of mirror) if (r.code && !byCode.has(r.code)) byCode.set(r.code, r.name ?? r.code);
  for (const r of registered) if (r.code && !byCode.has(r.code)) byCode.set(r.code, r.name);
  return [...byCode].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
}

/** Registered client of each subsidiary code (R-187: the wizard starts from it for a need of that subsidiary). */
export async function subsidiaryClientNames(q?: Q): Promise<Record<string, string>> {
  const db = q ?? (await getDb());
  const rows = await db.select({ code: clients.subsidiaryCode, name: clients.name }).from(clients).where(isNotNull(clients.subsidiaryCode));
  return Object.fromEntries(rows.map((r) => [r.code!, r.name]));
}

/** Writes the flag of one client in `tx`: the client row, its projects' updated_at, one audit row and one activity event. */
async function writeFlag(tx: Tx, client: ProjectClient, next: InternalClient, who: { actorName: string; actorPersonId: string | null }, projectId: string | null): Promise<void> {
  const holder = next.subsidiaryCode
    ? (await tx.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.subsidiaryCode, next.subsidiaryCode)))[0]
    : undefined;
  if (holder && holder.id !== client.id) throw new Error(`Subsidiary ${next.subsidiaryCode} is already the client ${holder.name}`);
  const now = new Date();
  await tx.update(clients).set({ isInternal: next.isInternal, subsidiaryCode: next.subsidiaryCode, updatedAt: now }).where(eq(clients.id, client.id));
  // pub_projets.maj_le = projects.updated_at: the readers' incremental read sees the change on every project of the client.
  await tx.update(projects).set({ updatedAt: now }).where(eq(projects.clientId, client.id));
  const message = next.isInternal
    ? systemMessage('client.internalSet', { client: client.name, subsidiary: next.subsidiaryCode ?? '—' })
    : systemMessage('client.internalCleared', { client: client.name });
  await writeAudit(tx, {
    ...who, objectRef: client.name, message, area: 'Contract', entityType: 'client', entityId: client.id, projectId,
    before: { isInternal: client.isInternal, subsidiaryCode: client.subsidiaryCode }, after: { ...next },
  });
  await recordActivity(tx, { ...who, message, kind: 'change', projectId });
}

/**
 * Flags (or clears) the project's client as a group subsidiary. The Server Function checks the viewer's rights (director); the
 * input is parsed again here. One client per subsidiary code. Returns the stored state.
 */
export async function setProjectClientInternal(projectCode: string, input: { isInternal?: unknown; subsidiaryCode?: unknown }, actor: Actor): Promise<InternalClient> {
  const parsed = parseInternalClient(input);
  if (!parsed.ok) throw new Error(parsed.error);
  const next = parsed.value;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [p] = await tx.select({ id: projects.id, clientId: projects.clientId }).from(projects).where(eq(projects.code, projectCode));
    if (!p) throw new Error(`Unknown project ${projectCode}`);
    if (!p.clientId) throw new Error('This project has no registered client');
    const [client] = await tx
      .select({ id: clients.id, name: clients.name, isInternal: clients.isInternal, subsidiaryCode: clients.subsidiaryCode })
      .from(clients).where(eq(clients.id, p.clientId)).for('update');
    if (client.isInternal === next.isInternal && client.subsidiaryCode === next.subsidiaryCode) return next;
    const person = await findPerson(tx, actor.name);
    await writeFlag(tx, client, next, { actorName: person ? nameOf(person) : actor.name, actorPersonId: person?.id ?? null }, p.id);
    return next;
  });
}

/**
 * R-187 + R-190: in the transaction that creates a project from a subsidiary's need, its client becomes internal for that
 * subsidiary when it is that subsidiary (`isSubsidiaryClient`: registered with its code, or named as Arche names it) — the code is
 * set when the client has none and no other client holds it. Anything else is left as it is. Returns whether the client changed.
 */
export async function markNeedSubsidiaryClient(tx: Tx, projectId: string, capexCode: string, who: { actorName: string; actorPersonId: string | null }): Promise<boolean> {
  const [cpx] = await tx.select({ code: capexMirror.subsidiaryCode, name: capexMirror.subsidiaryName }).from(capexMirror).where(eq(capexMirror.code, capexCode));
  if (!cpx) return false;
  const [client] = await tx
    .select({ id: clients.id, name: clients.name, isInternal: clients.isInternal, subsidiaryCode: clients.subsidiaryCode })
    .from(projects).innerJoin(clients, eq(clients.id, projects.clientId)).where(eq(projects.id, projectId));
  if (!client || !isSubsidiaryClient(client, cpx)) return false;
  let code = client.subsidiaryCode ?? cpx.code ?? null;
  if (code && code !== client.subsidiaryCode) {
    const [holder] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.subsidiaryCode, code));
    if (holder && holder.id !== client.id) code = null;
  }
  if (client.isInternal && client.subsidiaryCode === code) return false;
  await writeFlag(tx, client, { isInternal: true, subsidiaryCode: code }, who, projectId);
  return true;
}
