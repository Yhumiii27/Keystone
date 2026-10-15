import 'server-only';
// Quality / HSE connector to Vigie (user decision, Delivery 5). Vigie owns the project non-conformities (NCR, 8D,
// causes, action plans) and the site HSE register (prevention plans, permits, co-activity). Keystone lists them, opens
// them in Vigie (links.ts) and records the viewer's step decisions on NCRs, which are sent to Vigie.
//
// Vigie has no API yet, hence two implementations behind one interface (same pattern as the ECO connector):
// - mock (default): reads the local read-only mirrors (seeded from the prototype's HLT_NCRS and SITE_HSE) and queues
//   NCR progress in the outbox, where it stays "pending sync with Vigie";
// - http (VIGIE_API_URL set): refreshes the mirrors from Vigie and delivers the outbox — TODO(vigie): the endpoints
//   below are a proposal until Vigie publishes its API (OPEN QUESTION V-3).
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { VIGIE_CONNECTOR_NAME, connectorEnabled } from '@/server/integrations/connector-enabled';
import { vigieNcrs } from '@/server/db/schema';
import { ncrsToAnnounce } from '@/domain/vigie-events';
import { logError, logWarning } from '@/server/log';
import { vigieApiUrl, vigieAuthHeaders, vigieConnectorMode } from './connection';
import { notifyNewNcrs } from './notices';
import { claimNcrDelivery, markNcrDelivery, ncrProgressSyncStatus, readHseMirror, readNcrMirror, undeliveredNcrProgress, upsertHseMirror, upsertNcrMirror } from './quality-mirror';
import { recordNcrProgressEntry } from './quality-progress';
import type { EcoProgressActor, NcrListFilter, NcrProgressInput, NcrProgressReceipt, VigieHseRecord, VigieNcrRecord, VigieQualityConnector } from './types';

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

/** Mock connector: the local mirrors are the source; NCR progress waits in the outbox (Vigie has no API yet). */
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

// ── HTTP (TODO(vigie): endpoints to confirm with Vigie, OPEN QUESTION V-3) ─────────────────────────────

const HTTP_TIMEOUT_MS = 5000;
const REFRESH_EVERY_MS = 60_000;
// Per server process (R-010): concurrent reads share the refresh in flight (see eco-connector.ts).
const g = globalThis as unknown as { __ksVigieQualityRefreshedAt?: number; __ksVigieQualityRefreshing?: Promise<void> };

/** Forgets the last refresh time (tests). */
export function resetVigieQualityRefreshThrottle(): void {
  g.__ksVigieQualityRefreshedAt = undefined;
  g.__ksVigieQualityRefreshing = undefined;
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

/** TODO(vigie): GET /api/ncrs?source=keystone (VigieNcrRecord[]) and GET /api/hse?source=keystone (VigieHseRecord[]). */
async function refreshFromVigie(): Promise<number> {
  if (!(await connectorEnabled(VIGIE_CONNECTOR_NAME))) return 0; // D-7a: disabled by IT — the local mirror is read
  const [ncrRes, hseRes] = await Promise.all([vigieFetch('/api/ncrs?source=keystone'), vigieFetch('/api/hse?source=keystone')]);
  const ncrs = (await ncrRes.json()) as VigieNcrRecord[];
  const hse = (await hseRes.json()) as VigieHseRecord[];
  if (!Array.isArray(ncrs) || !Array.isArray(hse)) throw new Error('Vigie: unexpected NCR / HSE payload');
  const db = await getDb();
  const at = new Date();
  // R-015 (X-6a, dormant until V-3): the NCRs the mirror did not hold, read in the same transaction as the refresh and
  // returned from it (the callback may run twice, R-010); notified after the commit. The first refresh of an empty mirror is
  // the baseline (nothing announced) and a closed NCR is never announced (`ncrsToAnnounce`).
  const { n, raised } = await db.transaction(async (tx) => {
    const before = await tx.select({ projectCode: vigieNcrs.projectCode, number: vigieNcrs.number }).from(vigieNcrs);
    const count = (await upsertNcrMirror(tx, ncrs, at, { prune: true })) + (await upsertHseMirror(tx, hse, at, { prune: true }));
    return { n: count, raised: ncrsToAnnounce(before, ncrs) };
  });
  g.__ksVigieQualityRefreshedAt = Date.now();
  if (raised.length) await notifyNewNcrs(raised).catch((e) => logError('Vigie NCR notices', e, { component: 'vigie' }));
  return n;
}

async function refreshIfStale(): Promise<void> {
  if (g.__ksVigieQualityRefreshedAt && Date.now() - g.__ksVigieQualityRefreshedAt < REFRESH_EVERY_MS) return;
  const running = (g.__ksVigieQualityRefreshing ??= refreshFromVigie().then(
    () => undefined,
    (e) => logWarning('Vigie NCR / HSE refresh (the local mirror is used)', e, { component: 'vigie' }),
  ).finally(() => { g.__ksVigieQualityRefreshing = undefined; }));
  await running;
}

/** TODO(vigie): POST /api/ncrs/:project/:number/progress — one outbox entry; Vigie answers { id }. */
async function deliverOutbox(): Promise<{ delivered: number; failed: number; pending: number }> {
  const db = await getDb();
  // D-7a: a connector IT disabled exchanges nothing; the entries stay pending until it is enabled again.
  if (!(await connectorEnabled(VIGIE_CONNECTOR_NAME))) return { delivered: 0, failed: 0, pending: (await undeliveredNcrProgress(db)).length };
  let delivered = 0;
  let failed = 0;
  for (const e of await undeliveredNcrProgress(db)) {
    if (!(await claimNcrDelivery(db, e.id))) continue; // another delivery is sending it (R-010)
    try {
      const res = await vigieFetch(`/api/ncrs/${encodeURIComponent(e.projectCode)}/${encodeURIComponent(e.ncrNumber)}/progress`, {
        method: 'POST',
        body: JSON.stringify({
          kind: e.kind, decision: e.decision, fromStatus: e.fromStatus, targetStatus: e.targetStatus, comment: e.comment,
          actor: { name: e.actorName, role: e.actorRole }, recordedAt: e.recordedAt, keystoneId: e.id,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      await markNcrDelivery(db, e.id, { ok: true, vigieRef: body.id ?? null });
      delivered++;
    } catch (err) {
      await markNcrDelivery(db, e.id, { ok: false, error: err instanceof Error ? err.message : String(err) });
      failed++;
    }
  }
  return { delivered, failed, pending: (await undeliveredNcrProgress(db)).length };
}

/** HTTP connector: refreshes the mirrors before reading (at most once a minute; stale mirror when Vigie is unreachable). */
export const httpQualityConnector: VigieQualityConnector = {
  mode: 'http',
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
    const refreshed = await refreshFromVigie().catch(() => 0);
    return { ...d, refreshed };
  },
};

/** The quality / HSE connector in use (http when VIGIE_API_URL is set, else the mock). */
export function getVigieQualityConnector(): VigieQualityConnector {
  return vigieConnectorMode() === 'http' ? httpQualityConnector : mockQualityConnector;
}

/** Outbox redelivery of the worker (R-006, job "vigie-outbox"): the NCR progress not yet sent, as `redeliverEcoOutbox`. */
export async function redeliverNcrOutbox(): Promise<{ mode: 'mock' | 'http'; delivered: number; failed: number; pending: number }> {
  if (vigieConnectorMode() === 'http') return { mode: 'http', ...(await deliverOutbox()) };
  return { mode: 'mock', delivered: 0, failed: 0, pending: (await undeliveredNcrProgress(await getDb())).length };
}
