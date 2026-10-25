import 'server-only';
// R-190 (Arche K-05): the project's client as a group subsidiary — clients.is_internal and clients.subsidiary_code, published at
// the end of pub_projets (client_interne, filiale_code). Set by the director on the Contract screen's "Client" card, or when a
// project is created from a subsidiary's ordered need (R-187, `markNeedSubsidiaryClient`). Rules: src/domain/internal-client.ts.
// The flag is on the client: every project of that client gets it, and their projects.updated_at moves (pub_projets.maj_le).
// Matrix D21 (docs/delivery-9/notes-matrix-d21-d22.md): the subsidiaries come from Matrix (matrix.pub_filiales, mirrored by
// src/server/integrations/matrix/subsidiaries.ts; the CAPEX mirror is the fallback while Matrix publishes none), an internal
// client's code3 is its subsidiary's code, and a code3 equal to an offered subsidiary's code is reserved to that subsidiary.
import { asc, eq, isNotNull } from 'drizzle-orm';
import { isSubsidiaryClient, parseInternalClient, type InternalClient } from '@/domain/internal-client';
import { RESERVED_CLIENT_CODE, reservedCodeHolder, subsidiaryChoices, type SubsidiaryChoices } from '@/domain/subsidiaries';
import { systemMessage } from '@/domain/system-messages';
import { getDb } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { capexMirror, clients, projects } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { mirroredSubsidiaries } from '@/server/integrations/matrix/subsidiaries-mirror';
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
 * The group subsidiaries a client may be (D21): Matrix's active subsidiaries (matrix_subsidiaries) as soon as Matrix publishes any;
 * otherwise (R-190's list, fallback) those of the CAPEX mirrored from Arche (pub_capex.filiale_code, filiale), then the codes already
 * set on a client (named after that client).
 */
export async function listSubsidiaries(q?: Q): Promise<SubsidiaryChoices> {
  const db = q ?? (await getDb());
  const [matrix, mirror, registered] = await Promise.all([
    mirroredSubsidiaries(db),
    db.selectDistinct({ code: capexMirror.subsidiaryCode, name: capexMirror.subsidiaryName }).from(capexMirror).where(isNotNull(capexMirror.subsidiaryCode)),
    db.select({ code: clients.subsidiaryCode, name: clients.name }).from(clients).where(isNotNull(clients.subsidiaryCode)).orderBy(asc(clients.subsidiaryCode)),
  ]);
  const fallback = [
    ...mirror.flatMap((r) => (r.code ? [{ code: r.code, name: r.name ?? r.code }] : [])),
    ...registered.flatMap((r) => (r.code ? [{ code: r.code, name: r.name }] : [])),
  ];
  return subsidiaryChoices(matrix, fallback);
}

/**
 * D21: refuses (throws RESERVED_CLIENT_CODE) a client code proposed for a new project's client when it is the code of an offered
 * subsidiary and the client is not that subsidiary. `code3` = the code the project gets; called only when the client has no
 * registered code3 (a registered code is kept as it is).
 */
export async function assertClientCodeFree(q: Q, code3: string, clientName: string): Promise<void> {
  const [client] = clientName ? await q.select({ subsidiaryCode: clients.subsidiaryCode }).from(clients).where(eq(clients.name, clientName)) : [];
  const holder = reservedCodeHolder(code3, client ?? null, (await listSubsidiaries(q)).list);
  if (holder) throw new Error(RESERVED_CLIENT_CODE);
}

/** Registered client of each subsidiary code (R-187: the wizard starts from it for a need of that subsidiary). */
export async function subsidiaryClientNames(q?: Q): Promise<Record<string, string>> {
  const db = q ?? (await getDb());
  const rows = await db.select({ code: clients.subsidiaryCode, name: clients.name }).from(clients).where(isNotNull(clients.subsidiaryCode));
  return Object.fromEntries(rows.map((r) => [r.code!, r.name]));
}

type FlagClient = ProjectClient & { code3: string | null };

/**
 * D21: code3 of a client after its flag changes — an internal client with a subsidiary code takes that code; a code3 that was the
 * former subsidiary code is removed when the code is (the code is reserved to the subsidiary); otherwise code3 is kept.
 */
const nextCode3 = (client: FlagClient, next: InternalClient): string | null =>
  next.isInternal && next.subsidiaryCode ? next.subsidiaryCode : client.subsidiaryCode && client.code3 === client.subsidiaryCode ? null : client.code3;

/**
 * Writes the flag of one client in `tx`: the client row (code3 aligned on the subsidiary code, D21), its projects' updated_at,
 * one audit row and one activity event.
 */
async function writeFlag(tx: Tx, client: FlagClient, next: InternalClient, who: { actorName: string; actorPersonId: string | null }, projectId: string | null): Promise<void> {
  const holder = next.subsidiaryCode
    ? (await tx.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.subsidiaryCode, next.subsidiaryCode)))[0]
    : undefined;
  if (holder && holder.id !== client.id) throw new Error(`Subsidiary ${next.subsidiaryCode} is already the client ${holder.name}`);
  const code3 = nextCode3(client, next);
  if (code3 && code3 !== client.code3) {
    const [taken] = await tx.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.code3, code3));
    if (taken && taken.id !== client.id) throw new Error(`Code ${code3} is already the code of the client ${taken.name}`);
  }
  const now = new Date();
  await tx.update(clients).set({ isInternal: next.isInternal, subsidiaryCode: next.subsidiaryCode, code3, updatedAt: now }).where(eq(clients.id, client.id));
  // pub_projets.maj_le = projects.updated_at: the readers' incremental read sees the change on every project of the client.
  await tx.update(projects).set({ updatedAt: now }).where(eq(projects.clientId, client.id));
  const message = next.isInternal
    ? systemMessage('client.internalSet', { client: client.name, subsidiary: next.subsidiaryCode ?? '—' })
    : systemMessage('client.internalCleared', { client: client.name });
  await writeAudit(tx, {
    ...who, objectRef: client.name, message, area: 'Contract', entityType: 'client', entityId: client.id, projectId,
    before: { isInternal: client.isInternal, subsidiaryCode: client.subsidiaryCode, code3: client.code3 }, after: { ...next, code3 },
  });
  await recordActivity(tx, { ...who, message, kind: 'change', projectId });
}

const flagClientColumns = { id: clients.id, name: clients.name, isInternal: clients.isInternal, subsidiaryCode: clients.subsidiaryCode, code3: clients.code3 };

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
    const [client] = await tx.select(flagClientColumns).from(clients).where(eq(clients.id, p.clientId)).for('update');
    if (client.isInternal === next.isInternal && client.subsidiaryCode === next.subsidiaryCode) return next;
    // D21: a new subsidiary code is one of the offered subsidiaries when Matrix publishes them (the current code is kept as is).
    if (next.subsidiaryCode && next.subsidiaryCode !== client.subsidiaryCode) {
      const choices = await listSubsidiaries(tx);
      if (choices.source === 'matrix' && !choices.list.some((x) => x.code === next.subsidiaryCode)) throw new Error('Choose a subsidiary published by Matrix');
    }
    const person = await findPerson(tx, actor.name);
    await writeFlag(tx, client, next, { actorName: person ? nameOf(person) : actor.name, actorPersonId: person?.id ?? null }, p.id);
    return next;
  });
}

/**
 * R-187 + R-190: in the transaction that creates a project from a subsidiary's need, its client becomes internal for that
 * subsidiary when it is that subsidiary (`isSubsidiaryClient`: registered with its code, or named as Arche names it) — the code is
 * set when the client has none, no other client holds it (as subsidiary code or code3) and, when Matrix publishes subsidiaries, it
 * is one of them (D21). Anything else is left as it is. Returns whether the client changed.
 */
export async function markNeedSubsidiaryClient(tx: Tx, projectId: string, capexCode: string, who: { actorName: string; actorPersonId: string | null }): Promise<boolean> {
  const [cpx] = await tx.select({ code: capexMirror.subsidiaryCode, name: capexMirror.subsidiaryName }).from(capexMirror).where(eq(capexMirror.code, capexCode));
  if (!cpx) return false;
  const [client] = await tx.select(flagClientColumns).from(projects).innerJoin(clients, eq(clients.id, projects.clientId)).where(eq(projects.id, projectId));
  if (!client || !isSubsidiaryClient(client, cpx)) return false;
  let code = client.subsidiaryCode ?? cpx.code ?? null;
  if (code && code !== client.subsidiaryCode) {
    const [[holder], [taken], choices] = await Promise.all([
      tx.select({ id: clients.id }).from(clients).where(eq(clients.subsidiaryCode, code)),
      tx.select({ id: clients.id }).from(clients).where(eq(clients.code3, code)),
      listSubsidiaries(tx),
    ]);
    if ((holder && holder.id !== client.id) || (taken && taken.id !== client.id) || (choices.source === 'matrix' && !choices.list.some((x) => x.code === code))) code = null;
  }
  if (client.isInternal && client.subsidiaryCode === code) return false;
  await writeFlag(tx, client, { isInternal: true, subsidiaryCode: code }, who, projectId);
  return true;
}
