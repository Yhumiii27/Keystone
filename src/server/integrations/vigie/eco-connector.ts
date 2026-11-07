import 'server-only';
// ECO connector to Vigie. Vigie owns the engineering change orders (creation, editing, dispositions,
// interchangeability, effectivity, release, workflow); Keystone lists the ECOs relevant to its parts and projects,
// opens them in Vigie (links.ts) and records progress — the viewer's approval-key decision (engineering lead, PMs) and the
// step advancements the prototype offered — which is deposited in Vigie.
//
// D12 (Vigie, 06/11/2026; M-17, M-18): no API — two implementations behind one interface:
// - mock (VIGIE_SOURCE=simulation, the default without DATABASE_URL): reads the local read-only mirror (seeded from the
//   prototype's ECOS) and queues progress in the outbox, where it stays "pending sync with Vigie";
// - sql (VIGIE_SOURCE=server): refreshes the mirror from vigie.pub_ordres_modification, pub_eco_approbations and
//   pub_eco_effectivite, deposits the outbox through vigie.pub_signaler_avancement_eco and reads the outcome of each request in
//   vigie.pub_demandes_recues (./server.ts).
import { ecosToAnnounce } from '@/domain/vigie-events';
import { ecoRecordsOf, parseRequestRow } from '@/domain/vigie-views';
import { getDb } from '@/server/db/client';
import { vigieEcos } from '@/server/db/schema';
import { VIGIE_CONNECTOR_NAME, connectorEnabled } from '@/server/integrations/connector-enabled';
import { giveBackRefresh, mayRefresh } from '@/server/integrations/refresh-claims';
import { log, logError, logWarning } from '@/server/log';
import { vigieConnectorMode, type VigieConnectorMode } from './connection';
import {
  applyProgressOutcomes, claimProgressDelivery, markDelivery, progressSyncStatus, readMirror, undeliveredProgress, unprocessedProgress, upsertMirror,
} from './mirror';
import { notifyEcosToApprove } from './notices';
import { isPermanentVigieError, sqlMessageOf } from './outbox-state';
import { recordProgressEntry } from './progress';
import { depositEcoProgress, readVigieEcoViews, readVigieRequestRows } from './server';
import type { EcoListFilter, EcoProgressActor, EcoProgressInput, EcoProgressReceipt, VigieEcoConnector } from './types';

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

/** Mock connector: the local mirror is the source; progress waits in the outbox (simulation: nothing reaches Vigie). */
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

// ── Vigie's views and function on the shared server (D12) ──────────────────────────────────────────────

/** Reads refresh the mirror at most once a minute (a failed refresh is retried at the next read). */
const REFRESH_EVERY_MS = 60_000;
// R-010: concurrent reads of one process share the refresh in flight; with several instances on the PostgreSQL server, one of
// them refreshes the shared mirror per minute (the slot "vigie-ecos", src/server/integrations/refresh-claims.ts), the others
// read it. The time kept here only spares the slot's query on every read.
const g = globalThis as unknown as { __ksVigieRefreshedAt?: number; __ksVigieRefreshing?: Promise<void> };

/** Forgets the last refresh time (tests). */
export function resetVigieRefreshThrottle(): void {
  g.__ksVigieRefreshedAt = undefined;
  g.__ksVigieRefreshing = undefined;
}

/**
 * Reads Vigie's three change-order views and replaces the mirror (malformed rows skipped and logged). Throws when a view cannot be
 * read (view or link missing, server down): the mirror is kept.
 */
async function refreshFromVigie(): Promise<number> {
  if (!(await connectorEnabled(VIGIE_CONNECTOR_NAME))) return 0; // D-7a: disabled by IT — the local mirror is read
  const db = await getDb();
  const { records, skipped } = ecoRecordsOf(await readVigieEcoViews(db));
  if (skipped) log.warn('Vigie ECO rows skipped (malformed)', { component: 'vigie', skipped });
  // R-015 (X-6a): the ECOs entering "In approval", from the statuses read in the refresh's transaction and returned from it (the
  // callback may run twice, R-010); notified after the commit. The first refresh of an empty mirror is the baseline: nothing
  // announced (`ecosToAnnounce`).
  const { n, toApprove } = await db.transaction(async (tx) => {
    const before = await tx.select({ number: vigieEcos.number, status: vigieEcos.status }).from(vigieEcos);
    const count = await upsertMirror(tx, records, new Date(), { prune: true });
    return { n: count, toApprove: ecosToAnnounce(new Map(before.map((e) => [e.number, e.status])), records) };
  });
  g.__ksVigieRefreshedAt = Date.now();
  if (toApprove.length) await notifyEcosToApprove(toApprove).catch((e) => logError('Vigie ECO notices', e, { component: 'vigie' }));
  return n;
}

const REFRESH_SLOT = 'vigie-ecos';

/** Refresh unless one succeeded less than a minute ago (one refresh at a time per process, one per minute across instances). */
async function refreshIfStale(): Promise<void> {
  if (g.__ksVigieRefreshedAt && Date.now() - g.__ksVigieRefreshedAt < REFRESH_EVERY_MS) return;
  const running = (g.__ksVigieRefreshing ??= (async () => {
    if (!(await mayRefresh(REFRESH_SLOT, REFRESH_EVERY_MS))) {
      g.__ksVigieRefreshedAt = Date.now(); // another instance refreshed the shared mirror within the minute
      return;
    }
    await refreshFromVigie().then(
      () => undefined,
      async (e) => {
        await giveBackRefresh(REFRESH_SLOT); // a failed refresh is retried at the next read, on any instance
        logWarning('Vigie ECO views not read (the local mirror is used)', e, { component: 'vigie' });
      },
    );
  })().finally(() => { g.__ksVigieRefreshing = undefined; }));
  await running;
}

/**
 * Reads the outcome of the deposited requests not processed yet (vigie.pub_demandes_recues, D13 CV-08): applied, or rejected
 * (the entry becomes `refused`: end of the resends). The view missing (Matrix's publication not applied yet) leaves the entries
 * `sent`, their outcome unknown. Returns how many entries changed.
 */
async function readOutcomes(): Promise<number> {
  const db = await getDb();
  const ids = (await unprocessedProgress(db)).map((e) => e.id);
  if (!ids.length) return 0;
  try {
    const states = (await readVigieRequestRows(db, ids)).map(parseRequestRow).filter((x): x is NonNullable<typeof x> => !!x);
    return await applyProgressOutcomes(db, states);
  } catch (e) {
    logWarning('Vigie request states not read (pub_demandes_recues)', e, { component: 'vigie' });
    return 0;
  }
}

/**
 * Deposits each pending outbox entry in Vigie (`select vigie.pub_signaler_avancement_eco(…)`): Vigie's request number kept as
 * the entry's vigieRef; P0V01 / P0V02 → `failed`, never sent again as is; any other error (function or link missing, server
 * down) keeps the entry pending with its last error, deposited again later (the same `p_id_externe`: the same request).
 */
async function deliverOutbox(): Promise<{ delivered: number; failed: number; pending: number }> {
  const db = await getDb();
  // D-7a: a connector IT disabled exchanges nothing; the entries stay pending until it is enabled again.
  if (!(await connectorEnabled(VIGIE_CONNECTOR_NAME))) return { delivered: 0, failed: 0, pending: (await undeliveredProgress(db)).length };
  let delivered = 0;
  let failed = 0;
  for (const e of await undeliveredProgress(db)) {
    if (!(await claimProgressDelivery(db, e.id))) continue; // another delivery is sending it (R-010)
    try {
      const ref = await depositEcoProgress(db, e);
      await markDelivery(db, e.id, { ok: true, vigieRef: ref });
      delivered++;
    } catch (err) {
      await markDelivery(db, e.id, { ok: false, error: sqlMessageOf(err), retry: !isPermanentVigieError(err) });
      failed++;
    }
  }
  return { delivered, failed, pending: (await undeliveredProgress(db)).length };
}

/** Sql connector: refreshes the mirror before reading (at most once a minute; stale mirror when Vigie cannot be read). */
export const sqlEcoConnector: VigieEcoConnector = {
  mode: 'sql',
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
    await readOutcomes();
    const refreshed = await refreshFromVigie().catch((e) => {
      logWarning('Vigie ECO views not read (the local mirror is used)', e, { component: 'vigie' });
      return 0;
    });
    return { ...d, refreshed };
  },
};

/** The connector in use (sql when VIGIE_SOURCE is `server`, else the mock). */
export function getVigieEcoConnector(): VigieEcoConnector {
  return vigieConnectorMode() === 'sql' ? sqlEcoConnector : mockEcoConnector;
}

/**
 * Outbox redelivery of the worker (R-006, job "vigie-outbox"): with Vigie on the shared server, every pending entry is deposited
 * (only those, so a run never sends an entry twice) and the outcome of the deposited ones read; the mock sends nothing and
 * reports what waits. The mirror is not refreshed here (reads refresh it).
 */
export async function redeliverEcoOutbox(mode: VigieConnectorMode = vigieConnectorMode()): Promise<{ mode: VigieConnectorMode; delivered: number; failed: number; pending: number }> {
  if (mode === 'sql') {
    const d = await deliverOutbox();
    await readOutcomes();
    return { mode: 'sql', ...d };
  }
  return { mode: 'mock', delivered: 0, failed: 0, pending: (await undeliveredProgress(await getDb())).length };
}
