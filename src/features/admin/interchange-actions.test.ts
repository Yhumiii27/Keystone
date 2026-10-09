// Server Functions and Route Handlers of the import / export cards and the connector "Configure" (chapter 4) against an
// in-memory database with a mocked session: what the dialogs offer per role, the upload route (POST /api/import) through the
// confirmation (applyImportAction) and its refusals, the MS Project XML export route, and "Configure" / "Sync now" of a
// disabled connector.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { eq } from 'drizzle-orm';
import { POST as upload } from '@/app/api/import/route';
import { GET as exportMspdi } from '@/app/api/interchange/mspdi/[code]/route';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries, connectors } from '@/server/db/schema';
import { parseMspdi } from '@/server/interchange/mspdi';
import type { ImportStep } from '@/server/interchange/jobs';
import { setFilesRoot } from '@/server/storage/files';
import {
  applyImportAction, cancelImportAction, connectorConfigAction, exportSetupAction, importSetupAction, previewTableAction, saveConnectorConfigAction, syncEnabledConnectorAction,
} from './interchange-actions';

const as = (role: RoleKey, lang: 'en' | 'fr' = 'en') => {
  viewer.role = role;
  viewer.lang = lang;
};
const fixture = (name: string) => fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/ch4', name));
let filesDir = '';

async function post(fields: Record<string, string>, file?: { name: string; data: Uint8Array | Buffer }, headers: Record<string, string> = {}): Promise<{ status: number; body: ImportStep }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set('file', new File([new Uint8Array(file.data)], file.name));
  const res = await upload(new Request('http://localhost:3000/api/import', { method: 'POST', body: form, headers }));
  return { status: res.status, body: (await res.json()) as ImportStep };
}

beforeAll(async () => {
  filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-interchange-actions-'));
  setFilesRoot(filesDir);
  setDb(await openDatabase());
}, 60_000);
afterAll(() => {
  setFilesRoot(null);
  fs.rmSync(filesDir, { recursive: true, force: true });
});
beforeEach(() => {
  as('director');
  vi.mocked(revalidatePath).mockClear();
});

describe('import dialogs', () => {
  it('offer each role its kinds and projects', async () => {
    const director = await importSetupAction();
    expect(director.kinds).toEqual(['mspdi', 'xer', 'budget_lines', 'bom', 'parts', 'assignments']);
    expect(director.selfManager).toBeNull();
    expect(director.managers.map((m) => m.name)).toContain('S. Perrin');
    as('pm');
    const pm = await importSetupAction();
    expect(pm.selfManager).toBe('R. Aubert');
    expect(pm.projects.mspdi.map((p) => p.code)).toEqual(['HLT-026']);
    expect(pm.projects.bom).toEqual([]);
    as('englead');
    expect((await importSetupAction()).kinds).toEqual(['bom', 'parts']);
  });

  it('upload route → preview → confirmation, with revalidation and the Plan link', async () => {
    as('pm');
    const r = await post({ kind: 'schedule', mode: 'new', projectName: 'Upgrade via route' }, { name: 'sample.mspdi.xml', data: fixture('sample.mspdi.xml') });
    expect(r.status).toBe(200);
    if (!r.body.ok || r.body.step !== 'preview') throw new Error(JSON.stringify(r.body));
    const done = await applyImportAction(r.body.preview.jobId);
    expect(done).toMatchObject({ ok: true, step: 'done', created: 5 });
    if (!done.ok || done.step !== 'done') throw new Error('done expected');
    expect(done.href).toBe(`/projects/${done.projectCode}/plan`);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('upload route refusals: cross-site, wrong type, missing file, rights', async () => {
    expect((await post({ kind: 'bom', code: 'HLT-026' }, { name: 'b.csv', data: fixture('bom.en.csv') }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ kind: 'bom', code: 'HLT-026' }, { name: 'b.exe', data: Buffer.from('MZ') })).body).toEqual({ ok: false, error: 'File type not accepted' });
    expect((await post({ kind: 'bom', code: 'HLT-026' })).status).toBe(400);
    as('member');
    expect((await post({ kind: 'bom', code: 'HLT-026' }, { name: 'b.csv', data: fixture('bom.en.csv') })).body).toEqual({ ok: false, error: 'You may not import this file into this project' });
  });

  it('a job is continued only by its author; cancel', async () => {
    as('englead');
    const r = await post({ kind: 'bom', mode: 'update', code: 'HLT-026' }, { name: 'b.csv', data: fixture('bom.en.csv') });
    if (!r.body.ok || r.body.step !== 'mapping') throw new Error(JSON.stringify(r.body));
    const jobId = r.body.mapping.jobId;
    as('procurement');
    expect(await previewTableAction(jobId, r.body.mapping.mapping, null)).toEqual({ ok: false, error: 'Unknown import' });
    expect(await cancelImportAction(jobId)).toEqual({ ok: false, error: 'Unknown import' });
    as('englead');
    expect((await previewTableAction(jobId, { ref: 'Reference' }, null))).toEqual({ ok: false, error: '{0} is required'.replace('{0}', 'Quantity') });
    expect(await previewTableAction('nope', {}, null)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await cancelImportAction(jobId)).toEqual({ ok: true });
  });
});

describe('exports', () => {
  it('Excel / PDF targets of the workspace; the MS Project XML route with its rights, audit and connector stamp', async () => {
    const xlsx = await exportSetupAction('xlsx');
    expect(xlsx.targets.map((x) => x.screen)).toEqual(expect.arrayContaining(['projects', 'budget']));
    expect((await exportSetupAction('pdf')).targets.every((x) => x.screen !== 'projects')).toBe(true);
    const res = await exportMspdi(new Request('http://localhost/api/interchange/mspdi/HLT-026'), { params: Promise.resolve({ code: 'HLT-026' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="HLT-026-schedule-\d{4}-\d{2}-\d{2}\.xml"/);
    const parsed = parseMspdi(await res.text());
    expect(parsed.activities.length).toBeGreaterThan(20);
    const db = await getDb();
    expect((await db.select().from(connectors).where(eq(connectors.name, 'MS Project')))[0].lastVolume).toBe('HLT-026 exported · BL1');
    expect((await db.select().from(auditEntries).where(eq(auditEntries.objectRef, 'HLT-026'))).some((a) => a.change.startsWith('MS Project XML exported'))).toBe(true);
    as('client');
    expect((await exportMspdi(new Request('http://localhost/x'), { params: Promise.resolve({ code: 'NDC-031' }) })).status).toBe(403);
    expect((await exportMspdi(new Request('http://localhost/x'), { params: Promise.resolve({ code: 'HLT-026' }) })).status).toBe(200);
    expect((await exportMspdi(new Request('http://localhost/x'), { params: Promise.resolve({ code: 'XXX-999' }) })).status).toBe(404);
    // The client sees their organisation's projects only (HLT-026, and the project imported above for "Port authority").
    const mine = (await exportSetupAction('xml')).projects.map((p) => p.code);
    expect(mine).toContain('HLT-026');
    expect(mine).not.toContain('NDC-031');
  });
});

describe('connector Configure', () => {
  it('saves the Keystone-side settings (audited), refuses outside the workspace; a disabled connector is not synced', async () => {
    const r = await connectorConfigAction('Sage X3');
    expect(r).toMatchObject({ ok: true, config: { name: 'Sage X3', frequency: 'Every 2 h', enabled: true } });
    expect(await saveConnectorConfigAction('Sage X3', { frequency: 'Hourly', dataScope: 'Stock positions', direction: 'import', enabled: false })).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/integrations');
    const after = await connectorConfigAction('Sage X3');
    expect(after).toMatchObject({ ok: true, config: { frequency: 'Hourly', dataScope: 'Stock positions', direction: 'import', enabled: false, configuredByName: 'Marie Lefebvre' } });
    expect(await syncEnabledConnectorAction('Sage X3')).toEqual({ error: 'Connector Sage X3 is disabled — enable it in Configure' });
    as('director', 'fr');
    expect(await syncEnabledConnectorAction('Sage X3')).toEqual({ error: 'Le connecteur Sage X3 est désactivé — activez-le dans Configurer' });
    expect(await saveConnectorConfigAction('Sage X3', { frequency: 'Hourly', dataScope: 'x', direction: 'sideways', enabled: true })).toEqual({ ok: false, error: 'Invalid direction' });
    expect(await saveConnectorConfigAction('Sage X3', { frequency: '', dataScope: 'x', direction: '', enabled: true })).toMatchObject({ ok: false });
    as('member');
    expect(await connectorConfigAction('Sage X3')).toEqual({ ok: false, error: 'Activity & integrations is read-only for you' });
    expect(await saveConnectorConfigAction('Sage X3', { frequency: 'Daily', dataScope: 'x', direction: '', enabled: true })).toEqual({ ok: false, error: 'Activity & integrations is read-only for you' });
  });
});
