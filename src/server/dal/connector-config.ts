import 'server-only';
// Connector configuration (chapter 4 "Configure"; Delivery 7, R-020 / D-7a): IT configures the connectors outside Keystone.
//   - The connectors file (KEYSTONE_CONNECTORS_FILE, src/server/integrations/connectors-file.ts) is applied to the
//     connectors table when Keystone first needs the connectors and again after each change of the file: enabled,
//     frequency, direction, data scope, technical owner; a name that is not a connector yet adds it. Every change is
//     audited as "IT · configuration file".
//   - Addresses and keys stay in the server environment (Vigie, Cursus, Codex: src/server/integrations/<app>/config.ts).
//   - The Configure dialog shows the settings and where they come from, read-only (`getConnectorConfig`).
// `updateConnectorConfig` remains the validated writer behind the file (and the tests); no Server Function calls it while
// CONNECTOR_SETTINGS_BY_IT is on.
import { eq } from 'drizzle-orm';
import { connectorChanges, connectorEnvState, type ConnectorFileEntry } from '@/domain/connector-config';
import { getDb } from '@/server/db/client';
import { connectorDirection, type ConnectorDirection } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { connectors } from '@/server/db/schema';
import type { DB } from '@/server/db/types';
import { connectorsFileLabel, readConnectorsFile, type ConnectorsFileState } from '@/server/integrations/connectors-file';

/** Who the audit names for a change made by the connectors file. */
export const IT_FILE_ACTOR = 'IT · configuration file';

/** Where the settings shown come from. */
export type ConnectorConfigSource =
  /** Listed in the connectors file currently applied. */
  | { kind: 'file'; file: string }
  /** Not listed (or no file): the stored settings — the initial data, or a file applied earlier. */
  | { kind: 'stored' };

export interface ConnectorConfig {
  name: string;
  frequency: string;
  dataScope: string;
  direction: ConnectorDirection | null;
  enabled: boolean;
  owner: string | null;
  config: Record<string, unknown>;
  configuredAt: Date | null;
  configuredByName: string | null;
  source: ConnectorConfigSource;
  /** The connectors file is set but cannot be applied: its errors (English), nothing of it is applied. */
  fileErrors: string[] | null;
  /** Server variables the connector reads (Vigie, Cursus, Codex), "set" or not — values never leave the server. */
  env: { name: string; purpose: string; set: boolean; whenUnset: string }[];
}

// ── Applying the connectors file ──────────────────────────────────────────────────────────────────────────────────────

const applied = new WeakMap<DB, { signature: string; done: Promise<void> }>();

/** Writes the file's settings into the connectors table, in one transaction (only what differs; new names added). */
async function applyEntries(db: DB, entries: readonly ConnectorFileEntry[]): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(connectors);
    let position = rows.reduce((m, c) => Math.max(m, c.position + 1), 0);
    const now = new Date();
    for (const e of entries) {
      const row = rows.find((c) => c.name.toLowerCase() === e.name.toLowerCase());
      if (row) {
        const { set, changes } = connectorChanges(row, e);
        if (!changes.length) continue;
        await tx.update(connectors).set({ ...set, configuredAt: now, configuredByName: IT_FILE_ACTOR, updatedAt: now }).where(eq(connectors.id, row.id));
        await writeAudit(tx, { actorName: IT_FILE_ACTOR, objectRef: `Connector ${row.name}`, change: changes.join(' · '), area: 'Integrations', entityType: 'connector', entityId: row.id });
      } else {
        const [c] = await tx.insert(connectors).values({
          name: e.name, kind: 'static', dataScope: e.dataScope ?? '', frequency: e.frequency ?? 'Manual', direction: e.direction ?? null, status: 'ready', lastSyncAt: null,
          // R-021: no connector code exists behind a name IT adds — listed "Not connected", nothing scheduled.
          lastVolume: '', ownerName: e.owner ?? null, addedInKeystone: true, enabled: e.enabled ?? true, position: position++,
          configuredAt: now, configuredByName: IT_FILE_ACTOR,
        }).returning({ id: connectors.id });
        await writeAudit(tx, { actorName: IT_FILE_ACTOR, objectRef: `Connector ${e.name}`, change: `added${e.enabled === false ? ' · disabled' : ''}`, area: 'Integrations', entityType: 'connector', entityId: c.id });
        await recordActivity(tx, { actorName: IT_FILE_ACTOR, text: `Connector ${e.name} added by IT · not connected yet`, kind: 'sync', occurredAt: now });
      }
    }
  });
}

/**
 * Applies the connectors file to the database when it is new or changed (once per file version and database; concurrent
 * callers wait for the same run). A failure is logged and leaves the stored settings as they were. Returns the file state.
 */
export async function ensureConnectorsFileApplied(): Promise<ConnectorsFileState> {
  const state = readConnectorsFile();
  if (state.status !== 'ok') return state;
  const db = await getDb();
  let run = applied.get(db);
  if (run?.signature !== state.signature) {
    run = { signature: state.signature, done: applyEntries(db, state.entries) };
    applied.set(db, run);
    run.done.catch((e) => {
      console.error('[connectors] applying the connectors file failed:', e);
      if (applied.get(db) === run) applied.delete(db);
    });
  }
  await run.done.catch(() => undefined);
  return state;
}

// ── Reading ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Settings of a connector and where they come from (the Configure dialog); null for an unknown connector. */
export async function getConnectorConfig(name: string): Promise<ConnectorConfig | null> {
  const file = await ensureConnectorsFileApplied();
  const db = await getDb();
  const [c] = await db.select().from(connectors).where(eq(connectors.name, name));
  if (!c) return null;
  const listed = file.status === 'ok' && file.entries.some((e) => e.name.toLowerCase() === c.name.toLowerCase());
  return {
    name: c.name, frequency: c.frequency, dataScope: c.dataScope, direction: c.direction, enabled: c.enabled, owner: c.ownerName, config: c.config,
    configuredAt: c.configuredAt, configuredByName: c.configuredByName,
    source: listed ? { kind: 'file', file: connectorsFileLabel(file)! } : { kind: 'stored' },
    fileErrors: file.status === 'invalid' ? file.errors : null,
    env: connectorEnvState(c.name, process.env),
  };
}

// ── Validated writer (the file's path, tests) ─────────────────────────────────────────────────────────────────────────

export interface ConnectorConfigPatch {
  frequency?: string;
  dataScope?: string;
  direction?: ConnectorDirection | null;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

/** Saves the Keystone-side settings (validated, audited: one "field: old → new" per change). */
export async function updateConnectorConfig(name: string, patch: ConnectorConfigPatch, actorName: string): Promise<void> {
  const freq = patch.frequency?.trim();
  const scope = patch.dataScope?.trim();
  if (patch.frequency !== undefined && (!freq || freq.length > 60)) throw new Error('Enter a frequency (60 characters at most)');
  if (patch.dataScope !== undefined && (!scope || scope.length > 300)) throw new Error('Enter the data scope (300 characters at most)');
  if (patch.direction != null && !connectorDirection.isCode(patch.direction)) throw new Error('Unknown direction');
  if (patch.config !== undefined && (typeof patch.config !== 'object' || Array.isArray(patch.config) || JSON.stringify(patch.config).length > 4000)) throw new Error('Invalid options');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(connectors).where(eq(connectors.name, name));
    if (!c) throw new Error(`Unknown connector ${name}`);
    const changes: string[] = [];
    const set: Partial<typeof connectors.$inferInsert> = {};
    if (freq !== undefined && freq !== c.frequency) {
      set.frequency = freq;
      changes.push(`frequency: ${c.frequency} → ${freq}`);
    }
    if (scope !== undefined && scope !== c.dataScope) {
      set.dataScope = scope;
      changes.push('data scope changed');
    }
    if (patch.direction !== undefined && patch.direction !== c.direction) {
      set.direction = patch.direction;
      changes.push(`direction: ${c.direction ?? '—'} → ${patch.direction ?? '—'}`);
    }
    if (patch.enabled !== undefined && patch.enabled !== c.enabled) {
      set.enabled = patch.enabled;
      changes.push(patch.enabled ? 'enabled' : 'disabled');
    }
    if (patch.config !== undefined && JSON.stringify(patch.config) !== JSON.stringify(c.config)) {
      set.config = patch.config;
      changes.push('options changed');
    }
    if (!changes.length) return;
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    await tx.update(connectors).set({ ...set, configuredAt: new Date(), configuredByName: who, updatedAt: new Date() }).where(eq(connectors.id, c.id));
    await writeAudit(tx, { actorName: who, actorPersonId: actor?.id, objectRef: `Connector ${name}`, change: changes.join(' · '), area: 'Integrations', entityType: 'connector', entityId: c.id });
  });
}

