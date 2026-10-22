import 'server-only';
// R-180 — Keystone's planned tasks pushed to Cursus (Cursus docs/API-KEYSTONE.md « Tâches planifiées », « Synchronisation
// complète », « Ordre des envois »; Keystone's page docs/integrations/cursus-contract.md § 7). What is sent: the snapshot of
// src/domain/cursus-tasks.ts (the schedules' named assignments and the Keystone tasks of each person with a matricule). How:
//   1. `PUT /api/integrations/keystone/v1/projets/{code}` `{ nom }` for every project a task cites (« un objet ne peut citer qu'un
//      objet déjà reçu »; idempotent: an unchanged project answers "inchange");
//   2. `PUT /api/integrations/keystone/v1/instantane` `{ depuis, taches }` — the section `taches` is the complete state: Cursus
//      creates or updates each task by its id, and DELETES the Keystone tasks absent from it that end on or after `depuis`
//      (a task removed in Keystone, an assignment removed, a person who lost their matricule). A reassigned task keeps its id:
//      Cursus updates its matricule. Sections `projets` / `chantiers` / `affectations` are never sent (they would archive every
//      project or site absent from them). The snapshot is all or nothing on Cursus's side: a 400 VALIDATION naming tasks
//      (`details[].champ` = "taches[3].matricule": a matricule Cursus does not know) is sent again without them (3 rounds at
//      most), the refused tasks recorded on the push.
// When: every night (job "cursus-tasks", Cursus's « un instantané chaque nuit pour rattraper un envoi perdu ») and with "Sync
// now" of the Cursus connector (Activity & integrations). A retryable failure (no answer, 401 after a key change, 408, 429, 5xx)
// leaves the push pending: the "cursus-outbox" job (every 5 minutes) sends it again; any other refusal is final (failed) until
// the next push. Mock connector (CURSUS_API_URL unset): nothing is sent — the push is recorded with the body that would be
// sent ("pending sync with Cursus"). A connector disabled by IT (D-7a) prepares nothing.
import { and, desc, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  CURSUS_BODY_MAX_BYTES, cursusSnapshotSince, isRetryableCursusStatus, jsonBytes, refusedTaskIndexes, type CursusTaskPayload, type CursusTaskSnapshot,
} from '@/domain/cursus-tasks';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { cursusTaskPushes } from '@/server/db/schema';
import { readCursusTaskSnapshot } from '@/server/dal/cursus-tasks';
import { CURSUS_CONNECTOR_NAME, connectorEnabled } from '@/server/integrations/connector-enabled';
import { claimExpiry } from '@/server/integrations/outbox';
import { logWarning } from '@/server/log';
import { cursusConnectorMode } from './connection';
import { CURSUS_V1, CursusHttpError, cursusFetch } from './connector';

/** Pushes older than this are removed by the next push. */
export const CURSUS_TASK_PUSH_RETENTION_DAYS = 90;
/** Rounds of "send again without the refused tasks" after a 400 VALIDATION. */
const REFUSAL_ROUNDS = 3;
/** Cursus applies the snapshot in one transaction: wait longer than the 5 s of the other calls. */
const SNAPSHOT_TIMEOUT_MS = 30_000;

export interface CursusTaskPushOutcome {
  /** disabled: IT disabled the connector, nothing prepared; mock: recorded, nothing sent; sent; pending: retryable failure; failed. */
  state: 'disabled' | 'mock' | 'sent' | 'pending' | 'failed';
  mode: 'mock' | 'http';
  pushId: string | null;
  projects: number;
  tasks: number;
  persons: number;
  withoutMatricule: number;
  /** Tasks Cursus refused (left out of the snapshot it applied). */
  rejected: number;
  error: string | null;
}

interface StoredPayload {
  depuis: string;
  projets: CursusTaskSnapshot['projets'];
  taches: CursusTaskPayload[];
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "Snapshot of planned tasks · 42 tasks · 7 persons". */
const countsOf = (s: CursusTaskSnapshot) => ({
  projects: s.projets.length, tasks: s.taches.length, persons: new Set(s.taches.map((t) => t.matricule)).size, withoutMatricule: s.personsWithoutMatricule,
});

/** Records a new push (older pending ones not in flight are superseded; only the newest keeps its body; old rows purged). */
async function recordPush(trigger: 'job' | 'sync', mode: 'mock' | 'http', snap: CursusTaskSnapshot, at: Date): Promise<string> {
  const db = await getDb();
  const payload: StoredPayload = { depuis: snap.depuis, projets: snap.projets, taches: snap.taches };
  return db.transaction(async (tx) => {
    await tx.update(cursusTaskPushes).set({ status: 'superseded', payload: null })
      .where(and(eq(cursusTaskPushes.status, 'pending'), or(isNull(cursusTaskPushes.claimedAt), lt(cursusTaskPushes.claimedAt, claimExpiry(at)))));
    await tx.update(cursusTaskPushes).set({ payload: null }).where(ne(cursusTaskPushes.status, 'pending'));
    await tx.delete(cursusTaskPushes).where(lt(cursusTaskPushes.requestedAt, new Date(at.getTime() - CURSUS_TASK_PUSH_RETENTION_DAYS * 86_400_000)));
    const [row] = await tx.insert(cursusTaskPushes).values({
      requestedAt: at, trigger, mode, status: 'pending', since: snap.depuis, ...countsOf(snap), payload: payload as unknown as Record<string, unknown>,
    }).returning({ id: cursusTaskPushes.id });
    return row.id;
  });
}

/** Claims a pending push for one delivery (R-010: a concurrent delivery skips it). */
async function claim(id: string, at: Date): Promise<boolean> {
  const db = await getDb();
  const rows = await db.update(cursusTaskPushes).set({ claimedAt: at })
    .where(and(eq(cursusTaskPushes.id, id), eq(cursusTaskPushes.status, 'pending'), or(isNull(cursusTaskPushes.claimedAt), lt(cursusTaskPushes.claimedAt, claimExpiry(at)))))
    .returning({ id: cursusTaskPushes.id });
  return rows.length > 0;
}

const put = (path: string, body: unknown, timeoutMs?: number) => cursusFetch(`${CURSUS_V1}${path}`, { method: 'PUT', body: JSON.stringify(body) }, timeoutMs);

class FinalRefusal extends Error {}

/**
 * Sends one push (projects, then the snapshot) and records the result. Returns the push's state afterwards.
 */
async function deliver(id: string): Promise<Pick<CursusTaskPushOutcome, 'state' | 'rejected' | 'error'>> {
  const db = await getDb();
  const at = new Date();
  if (!(await claim(id, at))) return { state: 'pending', rejected: 0, error: null };
  const [row] = await db.select().from(cursusTaskPushes).where(eq(cursusTaskPushes.id, id));
  const payload = row?.payload as unknown as StoredPayload | null;
  try {
    if (!payload) throw new FinalRefusal('Snapshot body missing');
    let taches = payload.taches;
    if (jsonBytes({ depuis: payload.depuis, taches }) > CURSUS_BODY_MAX_BYTES) throw new FinalRefusal('Snapshot above 2 MB (Cursus\'s limit)');
    for (const p of payload.projets) await put(`/projets/${encodeURIComponent(p.code)}`, { nom: p.nom });
    const refused: { id: string; champ: string; message: string }[] = [];
    let bilan: unknown = null;
    for (let round = 0; ; round++) {
      try {
        const res = await put('/instantane', { depuis: payload.depuis, taches }, SNAPSHOT_TIMEOUT_MS);
        bilan = ((await res.json().catch(() => ({}))) as { bilan?: unknown }).bilan ?? null;
        break;
      } catch (e) {
        const idx = e instanceof CursusHttpError && e.status === 400 && e.code === 'VALIDATION' ? refusedTaskIndexes(e.body) : null;
        // Every task refused (e.g. Cursus switched to payroll matricules): nothing is applied rather than every task deleted.
        if (!idx || round >= REFUSAL_ROUNDS || idx.length >= taches.length) throw e;
        const details = (e as CursusHttpError).body as { details: { champ: string; message?: string }[] };
        for (const i of idx) {
          const d = details.details.find((x) => x.champ.startsWith(`taches[${i}]`));
          refused.push({ id: taches[i].id, champ: (d?.champ ?? '').replace(/^taches\[\d+\]\.?/, ''), message: String(d?.message ?? '') });
        }
        const drop = new Set(idx);
        taches = taches.filter((_, i) => !drop.has(i));
      }
    }
    await db.update(cursusTaskPushes).set({
      status: 'sent', sentAt: new Date(), lastAttemptAt: at, attempts: sql`${cursusTaskPushes.attempts} + 1`, lastError: null, claimedAt: null, rejected: refused.length,
      result: { bilan, refused } as Record<string, unknown>,
    }).where(eq(cursusTaskPushes.id, id));
    return { state: 'sent', rejected: refused.length, error: refused.length ? `${refused.length} tasks refused by Cursus` : null };
  } catch (e) {
    const status = e instanceof CursusHttpError ? e.status : null;
    const retry = !(e instanceof FinalRefusal) && isRetryableCursusStatus(status);
    const error = errorText(e).slice(0, 500);
    logWarning('Cursus task push', e, { component: 'cursus', retry });
    await db.update(cursusTaskPushes).set({
      status: retry ? 'pending' : 'failed', lastAttemptAt: at, attempts: sql`${cursusTaskPushes.attempts} + 1`, lastError: error, claimedAt: null,
    }).where(eq(cursusTaskPushes.id, id));
    return { state: retry ? 'pending' : 'failed', rejected: 0, error };
  }
}

/**
 * Prepares the snapshot of planned tasks as of the business date and sends it (HTTP connector), or records it (mock). `trigger`:
 * 'job' (nightly), 'sync' ("Sync now").
 */
export async function pushCursusTasks(trigger: 'job' | 'sync'): Promise<CursusTaskPushOutcome> {
  const mode = cursusConnectorMode();
  const none = { pushId: null, projects: 0, tasks: 0, persons: 0, withoutMatricule: 0, rejected: 0, error: null };
  if (!(await connectorEnabled(CURSUS_CONNECTOR_NAME))) return { state: 'disabled', mode, ...none };
  const snap = await readCursusTaskSnapshot(cursusSnapshotSince(await businessToday()));
  const pushId = await recordPush(trigger, mode, snap, new Date());
  const base = { mode, pushId, ...countsOf(snap) };
  if (mode === 'mock') return { state: 'mock', ...base, rejected: 0, error: null };
  return { ...base, ...(await deliver(pushId)) };
}

/**
 * The "cursus-outbox" job's part (every 5 minutes): the newest push left pending by a retryable failure is sent again (HTTP
 * connector, connector enabled). The mock records only: nothing to deliver, nothing counted as waiting.
 */
export async function redeliverCursusTaskPush(): Promise<{ mode: 'mock' | 'http'; delivered: number; failed: number; pending: number }> {
  const mode = cursusConnectorMode();
  if (mode !== 'http' || !(await connectorEnabled(CURSUS_CONNECTOR_NAME))) return { mode, delivered: 0, failed: 0, pending: 0 };
  const db = await getDb();
  const [row] = await db.select({ id: cursusTaskPushes.id }).from(cursusTaskPushes)
    .where(and(eq(cursusTaskPushes.status, 'pending'), eq(cursusTaskPushes.mode, 'http'))).orderBy(desc(cursusTaskPushes.requestedAt)).limit(1);
  if (!row) return { mode, delivered: 0, failed: 0, pending: 0 };
  const r = await deliver(row.id);
  return { mode, delivered: r.state === 'sent' ? 1 : 0, failed: r.state === 'failed' || r.state === 'pending' ? 1 : 0, pending: r.state === 'pending' ? 1 : 0 };
}

export interface CursusTaskPushState {
  at: string;
  mode: 'mock' | 'http';
  status: 'pending' | 'sent' | 'failed' | 'superseded';
  tasks: number;
  persons: number;
  withoutMatricule: number;
  rejected: number;
  lastError: string | null;
}

/** The newest push (Activity & integrations, Cursus row); null when none was ever prepared. */
export async function lastCursusTaskPush(): Promise<CursusTaskPushState | null> {
  const db = await getDb();
  const [r] = await db.select().from(cursusTaskPushes).orderBy(desc(cursusTaskPushes.requestedAt)).limit(1);
  return r
    ? { at: r.requestedAt.toISOString(), mode: r.mode, status: r.status, tasks: r.tasks, persons: r.persons, withoutMatricule: r.withoutMatricule, rejected: r.rejected, lastError: r.lastError }
    : null;
}
