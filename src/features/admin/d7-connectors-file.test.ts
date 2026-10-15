// Delivery 7 — R-020 (D-7a): connectors configured by IT outside Keystone. The connectors file (KEYSTONE_CONNECTORS_FILE)
// is applied when the connectors are read and again after each change; "Configure" shows the settings and their source
// read-only (server variables "set" / "not set", never their values); nothing in the app writes a connector.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const viewer = { role: 'director' as RoleKey, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }),
    getViewer: async () => PERSONA_BY_ROLE[viewer.role],
    getLastProject: async () => 'HLT-026',
  };
});

import { revalidatePath } from 'next/cache';
import { desc, eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activityEvents, auditEntries, connectors } from '@/server/db/schema';
import { listAdminConnectors } from '@/server/dal/admin-connectors';
import { IT_FILE_ACTOR } from '@/server/dal/connector-config';
import { readConnectorsFile } from '@/server/integrations/connectors-file';
import { syncConnectorAction } from './actions';
import { connectorConfigAction, saveConnectorConfigAction } from './interchange-actions';

const as = (role: RoleKey, lang: 'en' | 'fr' = 'en') => {
  viewer.role = role;
  viewer.lang = lang;
};
let dir = '';
let file = '';
let stamp = Date.now() / 1000;
/** Writes the connectors file with a new modification time (the reader keys its cache on it). */
const writeFile = (json: unknown) => {
  fs.writeFileSync(file, typeof json === 'string' ? json : JSON.stringify(json));
  stamp += 10;
  fs.utimesSync(file, stamp, stamp);
};
const row = async (name: string) => (await (await getDb()).select().from(connectors).where(eq(connectors.name, name)))[0];

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-connectors-'));
  file = path.join(dir, 'connectors.json');
  setDb(await openDatabase());
}, 60_000);
afterAll(() => {
  delete process.env.KEYSTONE_CONNECTORS_FILE;
  delete process.env.CURSUS_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('R-020 — the connectors file', () => {
  it('without KEYSTONE_CONNECTORS_FILE the stored settings stay, shown as such', async () => {
    delete process.env.KEYSTONE_CONNECTORS_FILE;
    expect(readConnectorsFile()).toEqual({ status: 'none' });
    const r = await connectorConfigAction('Sage X3');
    expect(r).toMatchObject({ ok: true, config: { source: { kind: 'stored' }, fileErrors: null, env: [] } });
  });

  it('applies the file: settings changed and audited as IT, a new connector added, the rest untouched', async () => {
    process.env.KEYSTONE_CONNECTORS_FILE = file;
    writeFile({
      connectors: {
        'Sage X3': { enabled: true, frequency: 'Daily 06:00', direction: 'both', owner: 'IT · finance systems' },
        'microsoft teams': { enabled: false },
        'SolidWorks 3DX': { frequency: 'Daily', direction: 'import', dataScope: 'Parts and BOM revisions' },
      },
    });
    const list = await listAdminConnectors();
    expect(list.find((c) => c.name === 'Sage X3')).toMatchObject({ frequency: 'Daily 06:00', direction: 'both', owner: 'IT · finance systems', enabled: true });
    expect(list.find((c) => c.name === 'Microsoft Teams')).toMatchObject({ enabled: false });
    // R-021: no connector code exists behind an added name — "Not connected", no volume, no sync offered.
    expect(list.at(-1)).toMatchObject({ name: 'SolidWorks 3DX', state: 'not_connected', canSync: false, lastVolume: '', frequency: 'Daily', direction: 'import', addedInKeystone: true, enabled: true });
    // NEW-CURSUS-4: Lucca is retired, no longer listed.
    expect(list.find((c) => c.name === 'Lucca')).toBeUndefined();
    expect((await row('Sage X3')).configuredByName).toBe(IT_FILE_ACTOR);
    const db = await getDb();
    const audit = await db.select().from(auditEntries).where(eq(auditEntries.actorName, IT_FILE_ACTOR)).orderBy(desc(auditEntries.occurredAt));
    expect(audit.map((a) => [a.objectRef, a.change]).sort()).toEqual([
      ['Connector Microsoft Teams', 'disabled'],
      ['Connector Sage X3', 'frequency: Every 2 h → Daily 06:00 · direction: — → both · owner: — → IT · finance systems'],
      ['Connector SolidWorks 3DX', 'added'],
    ]);
    expect((await db.select().from(activityEvents).where(eq(activityEvents.actorName, IT_FILE_ACTOR)))[0].text).toBe('Connector SolidWorks 3DX added by IT · not connected yet');
    // Read again: nothing new is written (applied once per file version).
    await listAdminConnectors();
    expect((await db.select().from(auditEntries).where(eq(auditEntries.actorName, IT_FILE_ACTOR))).length).toBe(3);
  });

  it('a connector IT disables in the file is not synchronised; enabling it again lets "Sync now" run', async () => {
    as('director');
    expect(await syncConnectorAction('Microsoft Teams')).toEqual({ error: 'Connector Microsoft Teams is disabled — IT configures connectors outside Keystone' });
    // R-021: Teams has no connector code — enabled again it is "Not connected" (nothing to synchronise); Vigie (mock) runs.
    writeFile({ connectors: { 'Microsoft Teams': { enabled: true }, Vigie: { enabled: false } } });
    expect(await syncConnectorAction('Microsoft Teams')).toEqual({ error: 'Microsoft Teams is not connected — nothing to synchronise' });
    expect(await syncConnectorAction('Vigie')).toEqual({ error: 'Connector Vigie is disabled — IT configures connectors outside Keystone' });
    writeFile({ connectors: { 'Microsoft Teams': { enabled: true }, Vigie: { enabled: true } } });
    expect(await syncConnectorAction('Vigie')).toMatchObject({ ok: true });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('Configure shows the source and the server variables (set or not, never their values)', async () => {
    process.env.CURSUS_API_KEY = 'super-secret-key';
    writeFile({ connectors: { Cursus: { owner: 'IT · HR applications' } } });
    const r = await connectorConfigAction('Cursus');
    expect(r).toMatchObject({ ok: true, config: { owner: 'IT · HR applications', source: { kind: 'file', file: 'connectors.json' }, fileErrors: null } });
    if (!r.ok) throw new Error('unreachable');
    expect(r.config.env.map((v) => [v.name, v.set])).toEqual([['CURSUS_API_URL', false], ['CURSUS_API_KEY', true], ['NEXT_PUBLIC_CURSUS_URL', false]]);
    expect(JSON.stringify(r)).not.toContain('super-secret-key');
    expect(JSON.stringify(r)).not.toContain(dir);
    expect(await connectorConfigAction('Sage X3')).toMatchObject({ ok: true, config: { source: { kind: 'stored' }, frequency: 'Daily 06:00' } });
  });

  it('an invalid file (credential, unknown key, bad JSON, missing file) is not applied at all and its errors are shown', async () => {
    writeFile({ connectors: { 'Sage X3': { enabled: false, apiKey: 'abc' }, Lucca: { enabled: 'no' } } });
    const r = await connectorConfigAction('Sage X3');
    expect(r).toMatchObject({ ok: true, config: { enabled: true, source: { kind: 'stored' } } });
    if (!r.ok) throw new Error('unreachable');
    expect(r.config.fileErrors).toEqual([
      'Sage X3: "apiKey" looks like a credential — keep addresses, keys and tokens in the server environment',
      'Lucca: "enabled" must be true or false',
    ]);
    writeFile('{ not json');
    expect(readConnectorsFile()).toMatchObject({ status: 'invalid' });
    process.env.KEYSTONE_CONNECTORS_FILE = path.join(dir, 'missing.json');
    expect(readConnectorsFile()).toMatchObject({ status: 'invalid', errors: ['The file named by KEYSTONE_CONNECTORS_FILE does not exist'] });
    expect((await listAdminConnectors()).find((c) => c.name === 'Sage X3')).toMatchObject({ enabled: true });
    process.env.KEYSTONE_CONNECTORS_FILE = file;
  });

  it('nothing in the app writes a connector: Configure save refused for every role, Configure read refused outside the workspace', async () => {
    for (const role of ['director', 'pm'] as RoleKey[]) {
      as(role);
      expect(await saveConnectorConfigAction('Sage X3', { frequency: 'Hourly', dataScope: 'x', direction: 'import', enabled: false })).toEqual({ ok: false, error: 'Connectors are configured by IT outside Keystone' });
    }
    for (const role of ['depthead', 'member', 'englead', 'quality', 'procurement'] as RoleKey[]) {
      as(role);
      expect(await connectorConfigAction('Sage X3')).toEqual({ ok: false, error: 'Activity & integrations is read-only for you' });
      expect(await saveConnectorConfigAction('Sage X3', { frequency: 'Hourly', dataScope: 'x', direction: 'import', enabled: false })).toEqual({ ok: false, error: 'Activity & integrations is read-only for you' });
    }
    // R-042: the client is sent home from a screen outside their workspace.
    as('client');
    await expect(connectorConfigAction('Sage X3')).rejects.toThrow('NEXT_REDIRECT');
    await expect(saveConnectorConfigAction('Sage X3', { frequency: 'Hourly', dataScope: 'x', direction: 'import', enabled: false })).rejects.toThrow('NEXT_REDIRECT');
    as('director');
    expect(await connectorConfigAction(42)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await connectorConfigAction('Nope')).toEqual({ ok: false, error: 'Invalid request' });
    const actions = await import('./actions');
    expect('addConnectorAction' in actions).toBe(false);
  });
});
