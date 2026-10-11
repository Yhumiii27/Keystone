// R-011 (A-15 "Données réelles seulement"): KEYSTONE_SEED=production loads reference data only — no project, person or
// prototype record — and production databases number their registers from 1; the demo database keeps the prototype's floors.
import { eq, getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILTIN_CALENDARS } from '@/domain/calendar';
import { STAGES } from '@/server/db/codes';
import { setDb } from '../client';
import { openDatabase } from '../open';
import * as schema from '../schema';
import type { DB } from '../types';
import { SEED_SETTING_KEY, databaseSeedMode, demoFloor, readSeedRecord } from './mode';
import { NO_LEAD } from './reference';
import { seedIfEmpty } from './index';

const count = async (db: DB, table: PgTable) => (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0].n;

/** Every table of the schema with its row count. */
async function rowCounts(db: DB): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of Object.values(schema)) if (is(t, PgTable)) out[getTableName(t)] = await count(db, t);
  return out;
}

/** The tables the production seed fills — and nothing else (a new demo table must not leak into production). */
const REFERENCE_TABLES = [
  'app_settings', 'calendars', 'capacity_demand_rates', 'cities', 'connectors', 'countries', 'departments', 'document_type_circuit_steps', 'document_types',
  'eng_column_mappings', 'eng_consistency_rules', 'eng_disciplines', 'eng_import_tools', 'import_formats', 'leave_types', 'lifecycle_stages', 'lifecycle_transitions',
  'machine_type_cost_categories', 'machine_type_itp_systems', 'machine_type_phases', 'machine_types', 'project_template_cost_categories', 'project_template_phases',
  'project_templates', 'public_holidays', 'reference_values', 'score_axes', 'skills', 'stage_deliverable_defs', 'whatif_auto_levers', 'whatif_levers', 'zones',
].sort();

describe('production seed (KEYSTONE_SEED=production)', () => {
  let db: DB;
  beforeAll(async () => {
    db = await openDatabase(undefined, undefined, { seed: 'production' });
    setDb(db);
  }, 60_000);

  it('fills the reference tables only: no project, person, user, client, supplier, part or record of the prototype', async () => {
    const counts = await rowCounts(db);
    expect(Object.keys(counts).filter((t) => counts[t] > 0).sort()).toEqual(REFERENCE_TABLES);
    for (const t of ['projects', 'persons', 'users', 'clients', 'suppliers', 'parts', 'storage_locations', 'rate_roles', 'documents', 'notifications', 'audit_entries', 'activity_events', 'vigie_ecos', 'cursus_clearances', 'rex_references'])
      expect(counts[t], t).toBe(0);
  });

  it('reference content: stages, the 4 built-in calendars, Settings lists, document and machine types, departments and zones without people', async () => {
    expect(await count(db, schema.lifecycleStages)).toBe(STAGES.length);
    expect((await db.select({ c: schema.calendars.code }).from(schema.calendars)).map((r) => r.c).sort()).toEqual(BUILTIN_CALENDARS.map((c) => c.code).sort());
    expect(await count(db, schema.referenceValues)).toBeGreaterThan(20);
    expect(await count(db, schema.documentTypes)).toBeGreaterThan(5);
    expect(await count(db, schema.machineTypes)).toBeGreaterThan(3);
    const depts = await db.select().from(schema.departments);
    expect(depts.map((d) => d.name).sort()).toEqual(['Controls & planning', 'Engineering', 'MEP', 'Quality', 'Site operations']);
    expect(depts.every((d) => d.headPersonId === null)).toBe(true);
    const zones = await db.select().from(schema.zones);
    expect(zones.map((z) => z.code).sort()).toEqual(['afr', 'apac', 'euna']);
    expect(zones.every((z) => z.managerPersonId === null)).toBe(true);
    expect((await db.select().from(schema.engDisciplines)).every((d) => d.leadName === NO_LEAD && d.leadPersonId === null)).toBe(true);
  });

  it('"Reset to defaults" document: the Settings lists and thresholds, never the prototype\'s storage locations (A-15, R-170)', async () => {
    const [doc] = await db.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, 'settings.defaults'));
    const v = doc.value as { lists: unknown[]; locations: unknown[]; health: unknown };
    expect([v.lists.length > 20, v.locations, v.health != null]).toEqual([true, [], true]);
  });

  it('connectors are listed "Ready", never synced (no prototype sync state)', async () => {
    const rows = await db.select().from(schema.connectors);
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.every((r) => r.status === 'ready' && r.lastSyncAt === null && r.lastVolume === '')).toBe(true);
    expect(rows.map((r) => r.name)).toContain('Vigie');
  });

  it('records its seed; opening it again neither re-seeds nor runs the demo backfills', async () => {
    expect(await readSeedRecord(db)).toMatchObject({ mode: 'production' });
    expect(await databaseSeedMode(db)).toBe('production');
    const before = await rowCounts(db);
    expect(await seedIfEmpty(db, { mode: 'demo' })).toBe(false);
    expect(await rowCounts(db)).toEqual(before);
  });

  it('numbering from 1: no prototype floor (demoFloor → 0)', async () => {
    expect(await demoFloor(db, 20)).toBe(0);
    expect(await demoFloor(db, 0)).toBe(0);
  });
});

describe('demo seed (default) and databases seeded before delivery 7', () => {
  let db: DB;
  beforeAll(async () => {
    db = await openDatabase();
  }, 60_000);

  it('records the demo seed and keeps the prototype floors', async () => {
    expect(await readSeedRecord(db)).toMatchObject({ mode: 'demo' });
    expect(await demoFloor(db, 20)).toBe(20);
  });

  it('a database without record (seeded before delivery 7) is a demo database and adopts its record on open', async () => {
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, SEED_SETTING_KEY));
    expect(await readSeedRecord(db)).toBeNull();
    expect(await databaseSeedMode(db)).toBe('demo');
    expect(await seedIfEmpty(db, { mode: 'production' })).toBe(false);
    expect(await readSeedRecord(db)).toMatchObject({ mode: 'demo' });
  });
});
