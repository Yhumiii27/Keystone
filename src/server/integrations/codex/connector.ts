import 'server-only';
// Approval connector to Codex (Delivery 7, R-124 / R-106; P-7b = a, D-1b = a, P-7c = a). Codex owns the documents,
// their approval circuits and their status; Keystone records the named approvers' decisions and the start of the
// engineering deliverables' circuits in an outbox (outbox.ts) and shows them "pending sync with Codex" over the mirrored
// circuit until Codex answers.
//
// Codex has no approval API yet, hence two implementations behind one interface (the Vigie ECO connector's pattern):
// - mock (default): entries stay "pending sync with Codex"; the index is never changed;
// - http (when CODEX_API_URL is set): delivers the outbox, then refreshes the records concerned from Codex
//   (mirror.ts, the only writer of their status and approval proof) — TODO(codex): the endpoints below are a proposal
//   until Codex publishes its API (OPEN QUESTION D-1). Delivery 8 (R-033): it also reads Codex's index (`readCodexIndex`,
//   "Sync now" and the hourly "codex-index" job).
import { getDb } from '@/server/db/client';
import { CODEX_CONNECTOR_NAME, connectorEnabled } from '@/server/integrations/connector-enabled';
import type { CodexSyncStatus } from '@/server/db/codes';
import { log, logWarning } from '@/server/log';
import { codexApiUrl, codexConnectorMode, type CodexConnectorMode } from './config';
import { applyCodexDocumentStates, applyCodexIndex, isCodexDocumentState, type CodexDocumentState, type CodexIndexResult } from './mirror';
import { claimCodexDelivery, codexEntrySyncStatus, markCodexDelivery, openCodexEntries, undeliveredCodexEntries } from './outbox';

export type { CodexDocumentState };

export interface CodexSyncResult {
  delivered: number;
  failed: number;
  /** Entries still waiting for delivery. */
  pending: number;
  /** Records refreshed from Codex. */
  refreshed: number;
}

export interface CodexApprovalConnector {
  mode: CodexConnectorMode;
  /** After an entry was queued: tries to deliver it (http) and returns its delivery state. */
  afterRecord(entryId: string): Promise<CodexSyncStatus>;
  /** "Sync now": delivers the outbox and refreshes the records concerned. */
  sync(): Promise<CodexSyncResult>;
}

/** Mock connector: Codex has no API yet — the entries wait in the outbox. */
export const mockCodexConnector: CodexApprovalConnector = {
  mode: 'mock',
  async afterRecord(entryId: string) {
    return (await codexEntrySyncStatus(await getDb(), entryId)) ?? 'pending';
  },
  async sync() {
    return { delivered: 0, failed: 0, pending: (await undeliveredCodexEntries(await getDb())).length, refreshed: 0 };
  },
};

// ── HTTP (TODO(codex): endpoints to confirm with Codex, OPEN QUESTION D-1) ──────────────────────────────

const HTTP_TIMEOUT_MS = 5000;

async function codexFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = codexApiUrl();
  if (!base) throw new Error('CODEX_API_URL is not set');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, { ...init, signal: ctrl.signal, headers: { 'content-type': 'application/json', accept: 'application/json', ...init?.headers } });
    if (!res.ok) throw new Error(`Codex ${init?.method ?? 'GET'} ${path} → ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TODO(codex): POST /api/documents/:number/approvals (a step decision) or /api/documents/:number/circuit (start of an
 * engineering deliverable's circuit); Codex answers { id }. Returns the numbers delivered.
 */
async function deliverOutbox(): Promise<{ delivered: number; failed: number; numbers: string[] }> {
  const db = await getDb();
  // D-7a: a connector IT disabled exchanges nothing; the entries stay pending until it is enabled again.
  if (!(await connectorEnabled(CODEX_CONNECTOR_NAME))) return { delivered: 0, failed: 0, numbers: [] };
  let delivered = 0;
  let failed = 0;
  const numbers = new Set<string>();
  for (const e of await undeliveredCodexEntries(db)) {
    if (!(await claimCodexDelivery(db, e.id))) continue; // another delivery is sending it (R-010)
    const actor = { name: e.actorName, role: e.actorRole };
    const path = `/api/documents/${encodeURIComponent(e.documentNumber)}/${e.kind === 'approval' ? 'approvals' : 'circuit'}`;
    const body = e.kind === 'approval'
      ? { revision: e.revision, step: e.stepPosition, role: e.role, decision: e.decision, comment: e.comment, actor, recordedAt: e.recordedAt, keystoneId: e.id }
      : { revision: e.revision, actor, recordedAt: e.recordedAt, keystoneId: e.id };
    try {
      const res = await codexFetch(path, { method: 'POST', body: JSON.stringify(body) });
      const ack = (await res.json().catch(() => ({}))) as { id?: unknown };
      await markCodexDelivery(db, e.id, { ok: true, codexRef: typeof ack.id === 'string' ? ack.id : null });
      numbers.add(e.documentNumber);
      delivered++;
    } catch (err) {
      await markCodexDelivery(db, e.id, { ok: false, error: err instanceof Error ? err.message : String(err) });
      failed++;
    }
  }
  return { delivered, failed, numbers: [...numbers] };
}

/** TODO(codex): GET /api/documents/state?numbers=… — the state of the records (CodexDocumentState[]). */
async function refreshFromCodex(numbers: readonly string[]): Promise<number> {
  if (!numbers.length || !(await connectorEnabled(CODEX_CONNECTOR_NAME))) return 0;
  const res = await codexFetch(`/api/documents/state?numbers=${numbers.map(encodeURIComponent).join(',')}`);
  const records = (await res.json()) as unknown;
  if (!Array.isArray(records)) throw new Error('Codex: unexpected document payload');
  const db = await getDb();
  return db.transaction((tx) => applyCodexDocumentStates(tx, records.filter(isCodexDocumentState)));
}

/**
 * Index read (Delivery 8, R-033; D-2 scope) — TODO(codex): `GET /api/documents?since=…[&project=…]` returning the records
 * changed since the last read (the whole index without `since`), each with its current revision and current circuit
 * (mirror.ts `CodexIndexRecord`). A proposal until Codex publishes its API (OPEN QUESTION D-1); the HTTP connector only.
 * Unknown projects and types are skipped and logged (A-15: never a phantom QMS record). `onlyNew`: the re-read of records
 * that waited for a project or type of Keystone writes only those, when not indexed yet (`applyCodexIndex`).
 */
/** Null when IT disabled the connector (D-7a): nothing is asked. */
export async function readCodexIndex(
  opts: { since?: Date | null; project?: string | null; onlyNew?: ReadonlySet<string> } = {}, at = new Date(),
): Promise<CodexIndexResult | null> {
  if (codexConnectorMode() !== 'http') throw new Error('The Codex index is read from Codex only when CODEX_API_URL is set');
  if (!(await connectorEnabled(CODEX_CONNECTOR_NAME))) return null;
  const q = new URLSearchParams();
  if (opts.since) q.set('since', opts.since.toISOString());
  if (opts.project) q.set('project', opts.project);
  const res = await codexFetch(`/api/documents${q.size ? `?${q}` : ''}`);
  const records = (await res.json()) as unknown;
  if (!Array.isArray(records)) throw new Error('Codex: unexpected index payload');
  const db = await getDb();
  const r = await db.transaction((tx) => applyCodexIndex(tx, records, at, { onlyNew: opts.onlyNew }));
  if (r.skipped.length)
    log.warn('Codex index: records skipped', { component: 'codex', skipped: r.skipped.length, sample: r.skipped.slice(0, 10).map((x) => `${x.number}: ${x.reason}`).join(' · ') });
  return r;
}

/** Numbers of the records with open entries (delivered and not reflected yet included). */
async function numbersAwaitingCodex(): Promise<string[]> {
  return [...new Set((await openCodexEntries(await getDb())).map((e) => e.documentNumber))];
}

/** HTTP connector: delivers at once, then reads Codex's answer back (a failure leaves the entry to the next sync). */
export const httpCodexConnector: CodexApprovalConnector = {
  mode: 'http',
  async afterRecord(entryId: string) {
    const d = await deliverOutbox().catch(() => ({ delivered: 0, failed: 0, numbers: [] as string[] }));
    await refreshFromCodex(d.numbers).catch((e) => logWarning('Codex refresh (the decision stays pending)', e, { component: 'codex' }));
    return (await codexEntrySyncStatus(await getDb(), entryId)) ?? 'pending';
  },
  async sync() {
    const d = await deliverOutbox();
    const refreshed = await refreshFromCodex(await numbersAwaitingCodex()).catch(() => 0);
    return { delivered: d.delivered, failed: d.failed, pending: (await undeliveredCodexEntries(await getDb())).length, refreshed };
  },
};

/** The connector in use (http when CODEX_API_URL is set, else the mock). */
export function getCodexConnector(): CodexApprovalConnector {
  return codexConnectorMode() === 'http' ? httpCodexConnector : mockCodexConnector;
}

/**
 * Outbox redelivery of the worker (R-006, job "codex-outbox"): with Codex's API configured, the approval decisions and
 * circuit starts not yet sent are delivered again and Codex's answer read back; the mock sends nothing and reports what waits.
 */
export async function redeliverCodexOutbox(): Promise<{ mode: 'mock' | 'http'; delivered: number; failed: number; pending: number }> {
  if (codexConnectorMode() === 'http') {
    const d = await httpCodexConnector.sync();
    return { mode: 'http', delivered: d.delivered, failed: d.failed, pending: d.pending };
  }
  return { mode: 'mock', delivered: 0, failed: 0, pending: (await undeliveredCodexEntries(await getDb())).length };
}
