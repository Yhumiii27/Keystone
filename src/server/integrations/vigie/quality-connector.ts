import 'server-only';
// Quality / HSE connector to Vigie (user decision, Delivery 5). Vigie owns the project non-conformities (NCR, 8D,
// causes, action plans) and the site HSE register (prevention plans, permits, co-activity). Keystone lists them, opens
// them in Vigie (links.ts) and records the viewer's step decisions on NCRs, which are deposited in Vigie.
//
// D13 (Vigie, 05/11/2026; M-17, M-18): no API — two implementations behind one interface (same pattern as the ECO connector):
// - mock (VIGIE_SOURCE=simulation, the default without DATABASE_URL): reads the local read-only mirrors (seeded from the
//   prototype's HLT_NCRS and SITE_HSE, numbered as Vigie numbers them, CV-07) and queues NCR progress in the outbox, where it
//   stays "pending sync with Vigie";
// - sql (VIGIE_SOURCE=server): refreshes the mirrors from vigie.pub_non_conformites and vigie.pub_hse_projet, deposits the
//   outbox through vigie.pub_signaler_avancement_nc and reads the outcome of each request in vigie.pub_demandes_recues
//   (./server.ts).
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { VIGIE_CONNECTOR_NAME, connectorEnabled } from '@/server/integrations/connector-enabled';
import { giveBackRefresh, mayRefresh } from '@/server/integrations/refresh-claims';
import { projects, vigieNcrs } from '@/server/db/schema';
import { ncrsToAnnounce } from '@/domain/vigie-events';
import { hseRecordsOf, ncrRecordsOf, parseRequestRow } from '@/domain/vigie-views';
import { log, logError, logWarning } from '@/server/log';
import { vigieConnectorMode, type VigieConnectorMode } from './connection';
import { notifyNewNcrs } from './notices';
import { isPermanentVigieError, sqlMessageOf } from './outbox-state';
import {
  applyNcrProgressOutcomes, claimNcrDelivery, markNcrDelivery, ncrProgressSyncStatus, readHseMirror, readNcrMirror, undeliveredNcrProgress, unprocessedNcrProgress,
  upsertHseMirror, upsertNcrMirror,
} from './quality-mirror';
import { recordNcrProgressEntry } from './quality-progress';
import { depositNcrProgress, readVigieQualityViews, readVigieRequestRows } from './server';
import type { EcoProgressActor, NcrListFilter, NcrProgressInput, NcrProgressReceipt, VigieQualityConnector } from './types';

export type { NcrListFilter, NcrProgressEntry, NcrProgressInput, NcrProgressReceipt, VigieHseItem, VigieNcr, VigieQualityConnector } from './types';

async function readOne(projectCode: string, number: string) {
  return (await readNcrMirror(await getDb(), { projectCodes: [projectCode] })).find((n) => n.number === number) ?? null;
}

async function record(projectCode: string, number: string, input: NcrProgressInput, actor: EcoProgressActor): Promise<NcrProgressReceipt> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [exists] = await tx.select({ id: vigieNcrs.id }).from(vigieNcrs).where(and(eq(vigieNcrs.projectCode, projectCode), eq(vigieNcrs.number, number)));
    if (!exists) throw new Error(`Unknown NCR ${number} on ${projectCode}`);
    const ncr = (await readNcrMirror(tx, { projectCodes: [projectCode] })).find((n) => n.number === number)!;
    const e = await recordNcrProgressEntry(tx, ncr, input, actor);
    return { id: e.id, projectCode: e.projectCode, ncrNumber: e.ncrNumber, kind: e.kind, targetStatus: e.targetStatus, syncStatus: e.syncStatus, recordedAt: e.recordedAt };
  });
}

/** Mock connector: the local mirrors are the source; NCR progress waits in the outbox (simulation: nothing reaches Vigie). */
export const mockQualityConnector: VigieQualityConnector = {
  mode: 'mock',
  async listNcrs(filter?: NcrListFilter) {
    return readNcrMirror(await getDb(), filter);
  },
  getNcr: readOne,
  recordNcrProgress: record,
  async listHse(projectCode: string) {
    return readHseMirror(await getDb(), projectCode);
  },
  async sync() {
    const pending = (await undeliveredNcrProgress(await getDb())).length;
    return { delivered: 0, failed: 0, pending, refreshed: 0 };
  },
};

// ── Vigie's views and function on the shared server (D13) ──────────────────────────────────────────────

const REFRESH_EVERY_MS = 60_000;
// R-010: concurrent reads share the refresh in flight; one refresh per minute across instances (slot "vigie-quality", see
// eco-connector.ts and src/server/integrations/refresh-claims.ts).
const g = globalThis as unknown as { __ksVigieQualityRefreshedAt?: number; __ksVigieQualityRefreshing?: Promise<void> };

/** Forgets the last refresh time (tests). */
export function resetVigieQualityRefreshThrottle(): void {
  g.__ksVigieQualityRefreshedAt = undefined;
  g.__ksVigieQualityRefreshing = undefined;
}

/**
 * Reads vigie.pub_non_conformites and vigie.pub_hse_projet and replaces both mirrors (only the NCRs and registers of Keystone's
 * projects are kept; malformed rows skipped and logged). Throws when a view cannot be read: the mirrors are kept.
 */
async function refreshFromVigie(): Promise<number> {
  if (!(await connectorEnabled(VIGIE_CONNECTOR_NAME))) return 0; // D-7a: disabled by IT — the local mirror is read
  const db = await getDb();
  const raw = await readVigieQualityViews(db);
  const codes = new Set((await db.select({ code: projects.code }).from(projects)).map((p) => p.code));
  const ncr = ncrRecordsOf(raw.ncrs);
  const hse = hseRecordsOf(raw.hse);
  const ncrs = ncr.records.filter((r) => codes.has(r.projectCode));
  const items = hse.records.filter((r) => codes.has(r.projectCode));
  if (ncr.skipped || hse.skipped) log.warn('Vigie NCR / HSE rows skipped (malformed)', { component: 'vigie', skipped: ncr.skipped + hse.skipped });
  const at = new Date();
  // R-015 (X-6a): the NCRs the mirror did not hold, read in the same transaction as the refresh and returned from it (the callback
  // may run twice, R-010); notified after the commit. The first refresh of an empty mirror is the baseline (nothing announced) and
  // a closed NCR is never announced (`ncrsToAnnounce`).
  const { n, raised } = await db.transaction(async (tx) => {
    const before = await tx.select({ projectCode: vigieNcrs.projectCode, number: vigieNcrs.number }).from(vigieNcrs);
    const count = (await upsertNcrMirror(tx, ncrs, at, { prune: true })) + (await upsertHseMirror(tx, items, at, { prune: true }));
    return { n: count, raised: ncrsToAnnounce(before, ncrs) };
  });
  g.__ksVigieQualityRefreshedAt = Date.now();
  if (raised.length) await notifyNewNcrs(raised).catch((e) => logError('Vigie NCR notices', e, { component: 'vigie' }));
  return n;
}

const REFRESH_SLOT = 'vigie-quality';

async function refreshIfStale(): Promise<void> {
  if (g.__ksVigieQualityRefreshedAt && Date.now() - g.__ksVigieQualityRefreshedAt < REFRESH_EVERY_MS) return;
  const running = (g.__ksVigieQualityRefreshing ??= (async () => {
    if (!(await mayRefresh(REFRESH_SLOT, REFRESH_EVERY_MS))) {
      g.__ksVigieQualityRefreshedAt = Date.now(); // another instance refreshed the shared mirror within the minute
      return;
    }
    await refreshFromVigie().then(
      () => undefined,
      async (e) => {
        await giveBackRefresh(REFRESH_SLOT);
        logWarning('Vigie NCR / HSE views not read (the local mirror is used)', e, { component: 'vigie' });
      },
    );
  })().finally(() => { g.__ksVigieQualityRefreshing = undefined; }));
  await running;
}

/** Outcome of the deposited NCR requests not processed yet (vigie.pub_demandes_recues, D13 CV-08) — as the ECO connector. */
async function readOutcomes(): Promise<number> {
  const db = await getDb();
  const ids = (await unprocessedNcrProgress(db)).map((e) => e.id);
  if (!ids.length) return 0;
  try {
    const states = (await readVigieRequestRows(db, ids)).map(parseRequestRow).filter((x): x is NonNullable<typeof x> => !!x);
    return await applyNcrProgressOutcomes(db, states);
  } catch (e) {
    logWarning('Vigie request states not read (pub_demandes_recues)', e, { component: 'vigie' });
    return 0;
  }
}

/**
 * Deposits each pending NCR entry (`select vigie.pub_signaler_avancement_nc(…)`): Vigie's request number kept as vigieRef;
 * P0V01 / P0V02 → `failed`, never resent as is; any other error keeps the entry pending with its last error.
 */
async function deliverOutbox(): Promise<{ delivered: number; failed: number; pending: number }> {
  const db = await getDb();
  // D-7a: a connector IT disabled exchanges nothing; the entries stay pending until it is enabled again.
  if (!(await connectorEnabled(VIGIE_CONNECTOR_NAME))) return { delivered: 0, failed: 0, pending: (await undeliveredNcrProgress(db)).length };
  let delivered = 0;
  let failed = 0;
  for (const e of await undeliveredNcrProgress(db)) {
    if (!(await claimNcrDelivery(db, e.id))) continue; // another delivery is sending it (R-010)
    try {
      const ref = await depositNcrProgress(db, e);
      await markNcrDelivery(db, e.id, { ok: true, vigieRef: ref });
      delivered++;
    } catch (err) {
      await markNcrDelivery(db, e.id, { ok: false, error: sqlMessageOf(err), retry: !isPermanentVigieError(err) });
      failed++;
    }
  }
  return { delivered, failed, pending: (await undeliveredNcrProgress(db)).length };
}

/** Sql connector: refreshes the mirrors before reading (at most once a minute; stale mirror when Vigie cannot be read). */
export const sqlQualityConnector: VigieQualityConnector = {
  mode: 'sql',
  async listNcrs(filter?: NcrListFilter) {
    await refreshIfStale();
    return readNcrMirror(await getDb(), filter);
  },
  async getNcr(projectCode: string, number: string) {
    await refreshIfStale();
    return readOne(projectCode, number);
  },
  async recordNcrProgress(projectCode: string, number: string, input: NcrProgressInput, actor: EcoProgressActor) {
    const receipt = await record(projectCode, number, input, actor);
    await deliverOutbox().catch(() => null);
    return { ...receipt, syncStatus: (await ncrProgressSyncStatus(await getDb(), receipt.id)) ?? receipt.syncStatus };
  },
  async listHse(projectCode: string) {
    await refreshIfStale();
    return readHseMirror(await getDb(), projectCode);
  },
  async sync() {
    const d = await deliverOutbox();
    await readOutcomes();
    const refreshed = await refreshFromVigie().catch((e) => {
      logWarning('Vigie NCR / HSE views not read (the local mirror is used)', e, { component: 'vigie' });
      return 0;
    });
    return { ...d, refreshed };
  },
};

/** The quality / HSE connector in use (sql when VIGIE_SOURCE is `server`, else the mock). */
export function getVigieQualityConnector(): VigieQualityConnector {
  return vigieConnectorMode() === 'sql' ? sqlQualityConnector : mockQualityConnector;
}

/** Outbox redelivery of the worker (R-006, job "vigie-outbox"): the NCR progress not yet deposited, as `redeliverEcoOutbox`. */
export async function redeliverNcrOutbox(mode: VigieConnectorMode = vigieConnectorMode()): Promise<{ mode: VigieConnectorMode; delivered: number; failed: number; pending: number }> {
  if (mode === 'sql') {
    const d = await deliverOutbox();
    await readOutcomes();
    return { mode: 'sql', ...d };
  }
  return { mode: 'mock', delivered: 0, failed: 0, pending: (await undeliveredNcrProgress(await getDb())).length };
}
