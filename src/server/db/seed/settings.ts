// Administration seed (docs/spec/11 §8.1, §8.5): the Settings reference lists (SETTINGS0 3467 — locations are the
// storage locations of seed/catalogue.ts), the project health thresholds, the hours-variance threshold (R-088), the connectors (CONNECTORS 3570, plus Vigie,
// whose ECO / NCR / HSE connector Keystone runs) and the import / export formats (IMPORTS 3571).
import { PROTO } from '@/server/prototype';
import {
  APP_SETTING_CCB, APP_SETTING_HEALTH, APP_SETTING_HOURS_VARIANCE, HEALTH_DEFAULTS, connectorStatus, deliverableType, locationType, parseStampText, riskCategory, slugOf, stage,
  type ReferenceListKey,
} from '../codes';
import { DEFAULT_CCB_THRESHOLD_KEUR } from '@/domain/change-control';
import { HOURS_VARIANCE_DEFAULT } from '@/domain/hr';
import { APP_SETTING_DEFAULTS, holidayCode, type SettingsDefaults } from '@/domain/settings-defaults';
import { appSettings, connectors, importFormats, referenceValues } from '../schema';
import type { Tx } from '../types';
import { mirrorSeedInstant } from '@/server/integrations/vigie/prototype-snapshot';

export { holidayCode };

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

/**
 * What Settings › "Reset to defaults" restores (R-170), stored in app_settings "settings.defaults": the SETTINGS0 lists,
 * the six SETTINGS0 locations (demo data set only: a production database has EPC2i's own warehouses, which a reset must
 * never replace by the prototype's, A-15) and the default health thresholds. The DAL reads only this document at run time.
 */
export function settingsDefaultsDocument(opts: { demo: boolean } = { demo: true }): SettingsDefaults {
  return {
    lists: defaultReferenceValues().map(({ listKey, code, label }) => ({ listKey, code, label })),
    locations: opts.demo ? (PROTO.SETTINGS0.locations as [string, string][]).map(([name, type]) => ({ name, type: locationType.code(type) })) : [],
    health: { risk: HEALTH_DEFAULTS.risk, off: HEALTH_DEFAULTS.off },
    // R-088 (R-6b): the hours-variance threshold.
    hours: { pct: HOURS_VARIANCE_DEFAULT },
    // Delivery 8 (R-069, P-6c): the change control board threshold (the prototype's 50 k€ highlight, until management sets it).
    change: { ccbThresholdKeur: DEFAULT_CCB_THRESHOLD_KEUR },
  };
}

/** Stores the defaults document once (seed, and the Delivery 7 backfill of a demo database seeded before it). */
export async function seedSettingsDefaults(tx: Tx, opts: { demo: boolean } = { demo: true }): Promise<void> {
  await tx.insert(appSettings).values({ key: APP_SETTING_DEFAULTS, value: settingsDefaultsDocument(opts) }).onConflictDoNothing();
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
  // R-088 (R-6b): the hours-variance threshold (a database seeded earlier has no row: the reader falls back to the default).
  await tx.insert(appSettings).values({ key: APP_SETTING_HOURS_VARIANCE, value: { pct: HOURS_VARIANCE_DEFAULT } });
  // Delivery 8 (R-069, P-6c): both seeds store the board threshold (a database without it reads the same default).
  await tx.insert(appSettings).values({ key: APP_SETTING_CCB, value: { keur: DEFAULT_CCB_THRESHOLD_KEUR } });
  await seedSettingsDefaults(tx, opts);
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
