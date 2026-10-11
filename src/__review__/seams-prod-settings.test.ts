// Throwaway review test (seams): R-011 production seed × R-170 "Reset to defaults" document.
import { beforeAll, describe, expect, it } from 'vitest';
import { asc } from 'drizzle-orm';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import type { DB } from '@/server/db/types';
import { storageLocations } from '@/server/db/schema';
import { addLocation, resetSettings } from '@/server/dal/settings';

let db: DB;
beforeAll(async () => {
  db = await openDatabase(undefined, undefined, { seed: 'production' });
  setDb(db);
}, 120_000);

describe('production Reset to defaults', () => {
  it('restores the prototype storage locations and deactivates EPC2i’s own', async () => {
    const before = await db.select({ name: storageLocations.name, active: storageLocations.active }).from(storageLocations).orderBy(asc(storageLocations.position));
    await addLocation('Dépôt Saint-Nazaire', 'central_warehouse', { name: 'IT admin', role: 'director' });
    await resetSettings({ name: 'IT admin', role: 'director' });
    const after = await db.select({ name: storageLocations.name, active: storageLocations.active }).from(storageLocations).orderBy(asc(storageLocations.position));
    (await import('node:fs')).writeFileSync('/tmp/claude-0/-home-user-Keystone/daa84d35-0be7-57a3-895a-75069f5e62a4/scratchpad/rv/prod-settings.json', JSON.stringify({ before, after }));
    expect(before).toEqual([]);
  }, 300_000);
});
