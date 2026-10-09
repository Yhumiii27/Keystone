// Administration (docs/spec/11 §3.1 ReferenceList / ReferenceValue / AppSetting, §3.12 Connector / SyncRun /
// ImportFormat; screens 10 §1 Settings and 10 §2 Activity & integrations). Stock locations are `storage_locations`
// (suppliers.ts); the activity feed and the audit trail are platform.ts.
import { boolean, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { ConnectorDirection, ConnectorKind, ConnectorStatus, ImportFormatDirection, ReferenceListKey } from '../codes';
import { id, timestamps } from './_common';
import { persons } from './organisation';

/**
 * Company reference lists edited in Settings (SETTINGS0 3467): skills 10, cost categories 6, project statuses 13, risk
 * categories 7, deliverable types 8, public holidays 11, location types 5. "Remove" deactivates the value (records that
 * use it keep their code, OPEN QUESTION A-14); "Reset to defaults" restores the seed list.
 */
export const referenceValues = pgTable(
  'reference_values',
  {
    id: id(),
    listKey: text('list_key').$type<ReferenceListKey>().notNull(),
    /** Stable code (risk category, stage, deliverable type… codes; slug for custom entries; ISO date for holidays). */
    code: text('code').notNull(),
    /** Label as listed ("Supplier / delivery", "14 Jul · Fête nationale"). */
    label: text('label').notNull(),
    position: integer('position').notNull(),
    active: boolean('active').notNull().default(true),
    /** Part of SETTINGS0 (restored by "Reset to defaults"); false for entries added in Settings. */
    isDefault: boolean('is_default').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.listKey, t.code)],
);

/** Key / value settings ("health.thresholds" = { risk: 0.97, off: 0.9 }) with the last editor. */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedByName: text('updated_by_name'),
  updatedByPersonId: uuid('updated_by_person_id').references(() => persons.id),
});

/**
 * Connectors to the systems of record (CONNECTORS 3570: 9) plus Vigie. Rows of kind `vigie` / `cursus` show the live
 * state of Keystone's connector layer (src/server/integrations); the others keep the recorded state of their last sync.
 */
export const connectors = pgTable('connectors', {
  id: id(),
  name: text('name').notNull().unique(),
  kind: text('kind').$type<ConnectorKind>().notNull(),
  /** What the connector exchanges (EN source text). */
  dataScope: text('data_scope').notNull(),
  /** "Real time (webhooks)", "Daily 06:30", "Every 2 h" (EN source text). */
  frequency: text('frequency').notNull(),
  direction: text('direction').$type<ConnectorDirection>(),
  status: text('status').$type<ConnectorStatus>().notNull(),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  /** "312 h · 8 people", "Token expires in 3 days" (EN source text). */
  lastVolume: text('last_volume').notNull(),
  ownerName: text('owner_name'),
  /** Connector added in Keystone ("Add connector"): waiting for its first sync. */
  addedInKeystone: boolean('added_in_keystone').notNull().default(false),
  position: integer('position').notNull(),
  // ── Chapter 4 (D-7 "Configure"): Keystone-side settings only — remote credentials stay in the remote system. ──
  enabled: boolean('enabled').notNull().default(true),
  /** Extra Keystone-side options (data scope items, filters…). */
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  configuredAt: timestamp('configured_at', { withTimezone: true }),
  configuredByName: text('configured_by_name'),
  ...timestamps,
});

/** Synchronisations run from "Sync now" (simulated for connectors without an implementation). */
export const connectorSyncRuns = pgTable('connector_sync_runs', {
  id: id(),
  connectorId: uuid('connector_id').notNull().references(() => connectors.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  ok: boolean('ok').notNull(),
  volume: text('volume').notNull(),
  error: text('error'),
  requestedByName: text('requested_by_name'),
});

/** File import / export formats (IMPORTS 3571: 6). */
export const importFormats = pgTable('import_formats', {
  position: integer('position').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  /** Phosphor class ("ph ph-file-xls"). */
  icon: text('icon').notNull(),
  direction: text('direction').$type<ImportFormatDirection>().notNull(),
});
