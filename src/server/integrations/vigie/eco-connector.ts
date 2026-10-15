import 'server-only';
// ECO connector to Vigie. Vigie owns the engineering change orders (creation, editing, dispositions,
// interchangeability, effectivity, release, workflow); Keystone lists the ECOs relevant to its parts and projects,
// opens them in Vigie (links.ts) and records progress — the viewer's approval-key decision and the step
// advancements the prototype offered — which is sent to Vigie.
//
// Vigie has no ECO module or API yet, hence two implementations behind one interface:
// - mock (default): reads the local read-only mirror (seeded from the prototype's ECOS) and queues progress in the
//   outbox, where it stays "pending sync with Vigie";
// - http (when VIGIE_API_URL is set): refreshes the mirror from Vigie and delivers the outbox — TODO(vigie): the
//   endpoints are a proposal until Vigie publishes its API (OPEN QUESTION V-2).
import { ecosToAnnounce } from '@/domain/vigie-events';
import { getDb } from '@/server/db/client';
import { vigieEcos } from '@/server/db/schema';
import { VIGIE_CONNECTOR_NAME, connectorEnabled } from '@/server/integrations/connector-enabled';
import { logError, logWarning } from '@/server/log';
import { vigieApiUrl, vigieAuthHeaders, vigieConnectorMode } from './connection';
import { claimProgressDelivery, markDelivery, progressSyncStatus, readMirror, undeliveredProgress, upsertMirror } from './mirror';
import { notifyEcosToApprove } from './notices';
import { recordProgressEntry } from './progress';
import type { EcoListFilter, EcoProgressActor, EcoProgressInput, EcoProgressReceipt, VigieEcoConnector, VigieEcoRecord } from './types';

export type { EcoListFilter, EcoProgressActor, EcoProgressInput, EcoProgressReceipt, VigieEco, VigieEcoConnector, VigieEcoRecord } from './types';

async function record(number: string, input: EcoProgressInput, actor: EcoProgressActor): Promise<EcoProgressReceipt> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [eco] = await readMirror(tx, { numbers: [number] });
    if (!eco) throw new Error(`Unknown ECO ${number}`);
    const e = await recordProgressEntry(tx, eco, input, actor);
    return { id: e.id, ecoNumber: e.ecoNumber, kind: e.kind, syncStatus: e.syncStatus, recordedAt: e.recordedAt };
  });
}

/** Mock connector: the local mirror is the source; progress waits in the outbox (Vigie has no API yet). */
export const mockEcoConnector: VigieEcoConnector = {
  mode: 'mock',
  async listEcos(filter?: EcoListFilter) {
    return readMirror(await getDb(), filter);
  },
  async getEco(number: string) {
    return (await readMirror(await getDb(), { numbers: [number] }))[0] ?? null;
  },
  recordProgress: record,
  async sync() {
    const pending = (await undeliveredProgress(await getDb())).length;
    return { delivered: 0, failed: 0, pending, refreshed: 0 };
  },
};

// ── HTTP (TODO(vigie): endpoints to confirm with Vigie, OPEN QUESTION V-2) ─────────────────────────────

const HTTP_TIMEOUT_MS = 5000;
/** Reads refresh the mirror at most once a minute (a failed refresh is retried at the next read). */
const REFRESH_EVERY_MS = 60_000;
// Per server process (R-010): with several instances each refreshes at most once a minute, which is the intent (bounded
// load on Vigie); concurrent reads of one process share the refresh in flight instead of starting their own.
const g = globalThis as unknown as { __ksVigieRefreshedAt?: number; __ksVigieRefreshing?: Promise<void> };

/** Forgets the last refresh time (tests). */
export function resetVigieRefreshThrottle(): void {
  g.__ksVigieRefreshedAt = undefined;
  g.__ksVigieRefreshing = undefined;
}

async function vigieFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = vigieApiUrl();
  if (!base) throw new Error('VIGIE_API_URL is not set');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, { ...init, signal: ctrl.signal, headers: { 'content-type': 'application/json', accept: 'application/json', ...vigieAuthHeaders(), ...init?.headers } });
    if (!res.ok) throw new Error(`Vigie ${init?.method ?? 'GET'} ${path} → ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** TODO(vigie): GET /api/ecos?source=keystone — the ECOs that concern Keystone's parts and projects (VigieEcoRecord[]). */
async function refreshFromVigie(): Promise<number> {
  if (!(await connectorEnabled(VIGIE_CONNECTOR_NAME))) return 0; // D-7a: disabled by IT — the local mirror is read
  const res = await vigieFetch('/api/ecos?source=keystone');
  const records = (await res.json()) as VigieEcoRecord[];
  if (!Array.isArray(records)) throw new Error('Vigie: unexpected ECO payload');
  const db = await getDb();
  // R-015 (X-6a, dormant until V-3): the ECOs entering "In approval", from the statuses read in the refresh's transaction
  // and returned from it (the callback may run twice, R-010); notified after the commit. The first refresh of an empty
  // mirror is the baseline: nothing announced (`ecosToAnnounce`).
  const { n, toApprove } = await db.transaction(async (tx) => {
    const before = await tx.select({ number: vigieEcos.number, status: vigieEcos.status }).from(vigieEcos);
    const count = await upsertMirror(tx, records, new Date(), { prune: true });
    return { n: count, toApprove: ecosToAnnounce(new Map(before.map((e) => [e.number, e.status])), records) };
  });
  g.__ksVigieRefreshedAt = Date.now();
  if (toApprove.length) await notifyEcosToApprove(toApprove).catch((e) => logError('Vigie ECO notices', e, { component: 'vigie' }));
  return n;
}

/** Refresh unless one succeeded less than a minute ago (one refresh at a time per process). */
async function refreshIfStale(): Promise<void> {
  if (g.__ksVigieRefreshedAt && Date.now() - g.__ksVigieRefreshedAt < REFRESH_EVERY_MS) return;
  const running = (g.__ksVigieRefreshing ??= refreshFromVigie().then(
    () => undefined,
    (e) => logWarning('Vigie ECO refresh (the local mirror is used)', e, { component: 'vigie' }),
  ).finally(() => { g.__ksVigieRefreshing = undefined; }));
  await running;
}

/** TODO(vigie): POST /api/ecos/:number/progress — one outbox entry; Vigie answers { id }. */
async function deliverOutbox(): Promise<{ delivered: number; failed: number; pending: number }> {
  const db = await getDb();
  // D-7a: a connector IT disabled exchanges nothing; the entries stay pending until it is enabled again.
  if (!(await connectorEnabled(VIGIE_CONNECTOR_NAME))) return { delivered: 0, failed: 0, pending: (await undeliveredProgress(db)).length };
  let delivered = 0;
  let failed = 0;
  for (const e of await undeliveredProgress(db)) {
    if (!(await claimProgressDelivery(db, e.id))) continue; // another delivery is sending it (R-010)
    try {
      const res = await vigieFetch(`/api/ecos/${encodeURIComponent(e.ecoNumber)}/progress`, {
        method: 'POST',
        body: JSON.stringify({
          kind: e.kind, approvalKey: e.approvalKey, decision: e.decision, targetStatus: e.targetStatus, comment: e.comment,
          actor: { name: e.actorName, role: e.actorRole }, recordedAt: e.recordedAt, keystoneId: e.id,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      await markDelivery(db, e.id, { ok: true, vigieRef: body.id ?? null });
      delivered++;
    } catch (err) {
      await markDelivery(db, e.id, { ok: false, error: err instanceof Error ? err.message : String(err) });
      failed++;
    }
  }
  return { delivered, failed, pending: (await undeliveredProgress(db)).length };
}

/** HTTP connector: refreshes the mirror before reading (at most once a minute; stale mirror when Vigie is unreachable). */
export const httpEcoConnector: VigieEcoConnector = {
  mode: 'http',
  async listEcos(filter?: EcoListFilter) {
    await refreshIfStale();
    return readMirror(await getDb(), filter);
  },
  async getEco(number: string) {
    return (await this.listEcos({ numbers: [number] }))[0] ?? null;
  },
  async recordProgress(number: string, input: EcoProgressInput, actor: EcoProgressActor) {
    const receipt = await record(number, input, actor);
    await deliverOutbox().catch(() => null);
    return { ...receipt, syncStatus: (await progressSyncStatus(await getDb(), receipt.id)) ?? receipt.syncStatus };
  },
  async sync() {
    const d = await deliverOutbox();
    const refreshed = await refreshFromVigie().catch(() => 0);
    return { ...d, refreshed };
  },
};

/** The connector in use (http when VIGIE_API_URL is set, else the mock). */
export function getVigieEcoConnector(): VigieEcoConnector {
  return vigieConnectorMode() === 'http' ? httpEcoConnector : mockEcoConnector;
}

/**
 * Outbox redelivery of the worker (R-006, job "vigie-outbox"): with Vigie's API configured, every entry not yet sent (pending
 * or failed) is delivered again — only those, so a run never sends an entry twice; the mock sends nothing and reports what
 * waits. The mirror is not refreshed here (reads refresh it).
 */
export async function redeliverEcoOutbox(): Promise<{ mode: 'mock' | 'http'; delivered: number; failed: number; pending: number }> {
  if (vigieConnectorMode() === 'http') return { mode: 'http', ...(await deliverOutbox()) };
  return { mode: 'mock', delivered: 0, failed: 0, pending: (await undeliveredProgress(await getDb())).length };
}
