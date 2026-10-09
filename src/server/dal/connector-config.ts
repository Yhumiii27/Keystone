import 'server-only';
// Connector "Configure" (chapter 4, D-7): the Keystone-side settings of a connector — frequency, data scope, direction,
// enabled, extra options. Remote credentials and the remote side stay in the remote system (out of scope).
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { connectorDirection, type ConnectorDirection } from '@/server/db/codes';
import { findPerson, nameOf, writeAudit } from '@/server/db/helpers';
import { connectors } from '@/server/db/schema';

export interface ConnectorConfig {
  name: string;
  frequency: string;
  dataScope: string;
  direction: ConnectorDirection | null;
  enabled: boolean;
  config: Record<string, unknown>;
  configuredAt: Date | null;
  configuredByName: string | null;
}

export async function getConnectorConfig(name: string): Promise<ConnectorConfig | null> {
  const db = await getDb();
  const [c] = await db.select().from(connectors).where(eq(connectors.name, name));
  return c
    ? { name: c.name, frequency: c.frequency, dataScope: c.dataScope, direction: c.direction, enabled: c.enabled, config: c.config, configuredAt: c.configuredAt, configuredByName: c.configuredByName }
    : null;
}

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
