import 'server-only';
// Connectors of Activity & integrations (docs/spec/10 §2) as the screen shows them: the connectors of integrations.ts
// (Vigie and Cursus already carry the live state of their connector layer) plus the Codex row read from Keystone's
// Codex index connector (src/server/dal/documents.ts: simulated index sync — Codex has no API yet, so its mode is
// "mock"): last sync and record count of the latest index sync, as the Documents screen shows them. "Sync now" on Codex
// runs that index sync, then records the run like every other connector (integrations.ts `syncConnector`).
import { getCodexSyncState, syncCodexIndex } from './documents';
import { listConnectors, syncConnector, type ConnectorRow } from './integrations';
import type { Actor } from './ops-common';

export type { ConnectorRow };

/** Name of the Codex row in the connectors table (CONNECTORS 3570). */
export const CODEX_CONNECTOR = 'Codex';

/** "412 records · 38 linked to HLT-026" with the live record count (the rest of the stored text is kept). */
export const withCodexRecords = (volume: string, records: number) =>
  /^\d[\d\s,]* records\b/.test(volume) ? volume.replace(/^\d[\d\s,]* records\b/, `${records} records`) : `${records} records${volume ? ' · ' + volume : ''}`;

/** Connectors in table order, Codex / Vigie / Cursus with the state of their connector layer. */
export async function listAdminConnectors(): Promise<ConnectorRow[]> {
  const [rows, codex] = await Promise.all([listConnectors(), getCodexSyncState()]);
  return rows.map((c) =>
    c.name === CODEX_CONNECTOR && c.kind === 'static'
      ? { ...c, mode: 'mock', lastSyncAt: codex?.syncedAt ?? c.lastSyncAt, lastVolume: codex ? withCodexRecords(c.lastVolume, codex.records) : c.lastVolume }
      : c,
  );
}

/** "Sync now" (workspace check and run log in `syncConnector`); Codex first syncs its index. */
export async function syncAdminConnector(name: string, actor: Actor): Promise<{ ok: boolean; volume: string; error: string | null }> {
  if (name !== CODEX_CONNECTOR) return syncConnector(name, actor);
  const r = await syncConnector(name, actor);
  if (!r.ok) return r;
  const records = await syncCodexIndex(actor.name);
  return { ok: true, volume: `${records} records`, error: null };
}
