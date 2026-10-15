import 'server-only';
// Connectors of Activity & integrations (docs/spec/10 §2) as the screen shows them: the connectors of integrations.ts
// (Vigie and Cursus already carry the live state of their connector layer) plus the Codex row read from Keystone's
// Codex index connector (src/server/dal/documents.ts). Without CODEX_API_URL its mode is "mock" (R-021: shown "Mock",
// without a last-sync date): the row shows the record count of Keystone's index, as the Documents screen does, and "Sync
// now" runs the index sync, recorded as a simulated run like every mock connector (integrations.ts `syncConnector`).
// Delivery 8 (R-033): with CODEX_API_URL the row is live — "Sync now" delivers the approval outbox
// (getCodexConnector().sync()) before reading Codex's index, and a failure of either marks the row.
import { codexConnectorMode } from '@/server/integrations/codex/config';
import { getCodexConnector } from '@/server/integrations/codex/connector';
import { getCodexSyncState, refreshCodexIndex, syncCodexIndex } from './documents';
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
      ? { ...c, lastVolume: codex ? withCodexRecords(c.lastVolume, codex.records) : c.lastVolume }
      : c,
  );
}

/**
 * "Sync now" (workspace check, refusals and run log in `syncConnector`). Codex: live (HTTP), the outbox is delivered, then
 * Codex's index is read, both inside the logged run; mock, the run is simulated and Keystone's index sync recorded.
 */
export async function syncAdminConnector(name: string, actor: Actor): Promise<{ ok: boolean; volume: string; error: string | null; simulated: boolean }> {
  if (name !== CODEX_CONNECTOR) return syncConnector(name, actor);
  if (codexConnectorMode() === 'http')
    return syncConnector(name, actor, {
      exchange: async () => {
        const out = await getCodexConnector().sync();
        const idx = await refreshCodexIndex(actor.name);
        if (!idx.read) return { ok: false, volume: '', error: 'Codex disabled' };
        const volume = `${out.delivered} sent · ${out.pending} pending · ${out.refreshed + idx.applied} refreshed`;
        return { ok: out.failed === 0, volume, error: out.failed ? `${out.failed} failed` : null };
      },
    });
  const r = await syncConnector(name, actor);
  if (!r.ok) return r;
  const records = await syncCodexIndex(actor.name);
  return { ok: true, volume: `${records} records`, error: null, simulated: r.simulated };
}
