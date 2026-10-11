// Administration seed (docs/spec/11 §8.1, §8.5): the Settings reference lists (SETTINGS0 3467 — locations are the
// storage locations of seed/catalogue.ts), the project health thresholds, the connectors (CONNECTORS 3570, plus Vigie,
// whose ECO / NCR / HSE connector Keystone runs) and the import / export formats (IMPORTS 3571).
import { PROTO } from '@/server/prototype';
import {
  APP_SETTING_HEALTH, HEALTH_DEFAULTS, connectorStatus, deliverableType, isoOfDisplayDate, locationType, parseStampText, riskCategory, slugOf, stage,
  type ReferenceListKey,
} from '../codes';
import { appSettings, connectors, importFormats, referenceValues } from '../schema';
import type { Tx } from '../types';
import { mirrorSeedInstant } from '@/server/integrations/vigie/prototype-snapshot';

/** "14 Jul · Fête nationale" → 2026-07-14 (the list is "Public holidays 2026 — France"). */
export const holidayCode = (label: string) => isoOfDisplayDate(label.split(' · ')[0]) ?? slugOf(label);

/** Code of a Settings list entry: the stable domain code where one exists, else a slug of the label. */
export function referenceCodeOf(list: ReferenceListKey, label: string): string {
  switch (list) {
    case 'statuses': return stage.code(label);
    case 'riskCats': return riskCategory.code(label);
    case 'delivTypes': return deliverableType.code(label);
    case 'locTypes': return locationType.code(label);
    case 'holidays': return holidayCode(label);
    default: return slugOf(label);
  }
}

/** The SETTINGS0 lists stored in reference_values, in Settings order. */
export function defaultReferenceValues(): { listKey: ReferenceListKey; code: string; label: string; position: number }[] {
  const s = PROTO.SETTINGS0 as Record<string, unknown>;
  const lists: ReferenceListKey[] = ['skills', 'costCats', 'statuses', 'riskCats', 'delivTypes', 'holidays', 'locTypes'];
  return lists.flatMap((listKey) => (s[listKey] as string[]).map((label, position) => ({ listKey, code: referenceCodeOf(listKey, label), label, position })));
}

/** Vigie's row in the connectors table (not in the prototype's CONNECTORS: Vigie owns ECOs, NCRs and site HSE). */
export const VIGIE_CONNECTOR = {
  name: 'Vigie',
  dataScope: 'Engineering change orders, non-conformities (NCR, 8D) and site HSE (prevention plans, permits) — managed in Vigie, Keystone records progress',
  frequency: 'Every minute (on read)',
};

/**
 * Settings lists, health thresholds, connectors and import / export formats. `demo` (default) keeps the prototype's connector
 * states (status, last sync, volume); the production seed (R-011) lists the same connectors as "Ready", never synced.
 */
export async function seedSettings(tx: Tx, opts: { demo: boolean } = { demo: true }): Promise<void> {
  await tx.insert(referenceValues).values(defaultReferenceValues().map((v) => ({ ...v, active: true, isDefault: true })));
  await tx.insert(appSettings).values({ key: APP_SETTING_HEALTH, value: { risk: HEALTH_DEFAULTS.risk, off: HEALTH_DEFAULTS.off } });
  const rows: (Omit<typeof connectors.$inferInsert, 'direction'>)[] = (PROTO.CONNECTORS as [string, string, string, string, string, string][]).map(([name, what, freq, status, last, vol], position) => ({
    name, kind: name === 'Cursus' ? 'cursus' : 'static', dataScope: what, frequency: freq,
    ...(opts.demo ? { status: connectorStatus.code(status), lastSyncAt: parseStampText(last), lastVolume: vol } : { status: 'ready' as const, lastSyncAt: null, lastVolume: '' }),
    position,
  }));
  rows.push({
    name: VIGIE_CONNECTOR.name, kind: 'vigie', dataScope: VIGIE_CONNECTOR.dataScope, frequency: VIGIE_CONNECTOR.frequency,
    status: opts.demo ? 'ok' : 'ready', lastSyncAt: opts.demo ? mirrorSeedInstant() : null, lastVolume: '', position: rows.length,
  });
  await tx.insert(connectors).values(rows.map((r) => ({ ...r, direction: r.kind === 'static' ? null : 'both' as const })));
  await tx.insert(importFormats).values((PROTO.IMPORTS as [string, string, string][]).map(([name, description, icon], position) => ({
    position, name, description, icon, direction: name.startsWith('Export') ? 'export' as const : 'import' as const,
  })));
}
