// R-008 — the guards on the real Route Handlers and Server Functions: cross-site requests refused on every state-changing
// route (upload, import, logged export, MS Project export), and the rate limits (429 + Retry-After, translated) on uploads,
// exports, the audit CSV, transcript imports and analyses. In-memory seeded database; session and access mocked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const state = { role: 'director' as RoleKey, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getI18n: async () => ({ lang: state.lang, t: makeT(state.lang) }),
    getViewer: async () => PERSONA_BY_ROLE[state.role],
    getZone: async () => null,
    getLang: async () => state.lang,
  };
});
vi.mock('@/server/project-context', async (orig) => {
  const actual = await orig<typeof import('@/server/project-context')>();
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  const { isOutside } = await import('@/components/app/shell/nav-model');
  return {
    ...actual,
    getScreenAccess: async (screen: 'task' | 'plumbing') => {
      const outside = isOutside(state.role, screen);
      return { viewer: PERSONA_BY_ROLE[state.role], outside, canEdit: !outside };
    },
    // The director, on the project's team with the PM's rights (delivery 7 rights: R-041, R-050).
    getProjectContext: async () => ({
      viewer: PERSONA_BY_ROLE[state.role], canEdit: () => true,
      access: { member: true, lead: true, pm: true, client: false, readOnly: false, refused: false },
    }),
  };
});

import { GET as auditCsv } from '@/app/(app)/admin/integrations/audit.csv/route';
import { GET as exportRoute } from '@/app/api/export/[screen]/route';
import { POST as importRoute } from '@/app/api/import/route';
import { GET as mspdiRoute } from '@/app/api/interchange/mspdi/[code]/route';
import { POST as uploadRoute } from '@/app/api/tasks/[taskId]/files/route';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { analyseTranscriptAction, importTranscriptAction } from '@/features/meetings/actions';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listTaskFiles } from '@/server/dal/task-files';
import { setFilesRoot } from '@/server/storage/files';
import { RATE_LIMITS, hitRateLimit, resetRateLimits, type RateBucket } from './request-guard';

const BASE = 'http://127.0.0.1:3315';
const FR_429 = 'Trop de requêtes — patientez une minute puis réessayez';
const EN_429 = 'Too many requests — please wait a minute and try again';
let dir: string;

/** Uses up the window of the current viewer at `address` for `bucket`. */
const exhaust = (bucket: RateBucket, address = 'local') => {
  for (let i = 0; i < RATE_LIMITS[bucket].limit; i++) hitRateLimit(bucket, `${address}|${PERSONA_BY_ROLE[state.role].name}`);
};
const upload = (headers: Record<string, string> = {}) => {
  const body = new FormData();
  body.set('file', new File([new TextEncoder().encode('%PDF-1.4 x')], 'Report.pdf', { type: 'application/pdf' }));
  return uploadRoute(new Request(`${BASE}/api/tasks/T-2314/files`, { method: 'POST', body, headers: { host: '127.0.0.1:3315', ...headers } }), { params: Promise.resolve({ taskId: 'T-2314' }) });
};
const exportCsv = (headers: Record<string, string> = {}) =>
  exportRoute(new Request(`${BASE}/api/export/risks?format=csv&code=HLT-026`, { headers: { host: '127.0.0.1:3315', ...headers } }), { params: Promise.resolve({ screen: 'risks' }) });
const form = (v: Record<string, string>) => {
  const f = new FormData();
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
};

beforeAll(async () => {
  setDb(await openDatabase());
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-r008-'));
  setFilesRoot(dir);
}, 60_000);
afterAll(() => {
  setFilesRoot(null);
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  state.role = 'director';
  state.lang = 'en';
  resetRateLimits();
});

describe('same origin on state-changing Route Handlers', () => {
  it('upload, import, export and MS Project XML refuse another site (403) before doing anything', async () => {
    const before = (await listTaskFiles('T-2314')).length;
    expect((await upload({ 'sec-fetch-site': 'same-site' })).status).toBe(403);
    expect((await upload({ origin: 'http://127.0.0.1:3100' })).status).toBe(403);
    expect((await listTaskFiles('T-2314')).length).toBe(before);
    const imp = await importRoute(new Request(`${BASE}/api/import`, { method: 'POST', body: new FormData(), headers: { host: '127.0.0.1:3315', origin: 'https://evil.example' } }));
    expect([imp.status, await imp.json()]).toEqual([403, { ok: false, error: 'Invalid request' }]);
    const exp = await exportCsv({ 'sec-fetch-site': 'cross-site' });
    expect([exp.status, await exp.text()]).toEqual([403, 'Invalid request']);
    const xml = await mspdiRoute(new Request(`${BASE}/api/interchange/mspdi/HLT-026`, { headers: { 'sec-fetch-site': 'cross-site' } }), { params: Promise.resolve({ code: 'HLT-026' }) });
    expect(xml.status).toBe(403);
  });

  it('the same requests from Keystone pages go through', async () => {
    expect((await upload({ origin: BASE, 'sec-fetch-site': 'same-origin' })).status).toBe(200);
    const exp = await exportCsv({ 'sec-fetch-site': 'same-origin' });
    expect([exp.status, exp.headers.get('content-type')]).toEqual([200, 'text/csv; charset=utf-8']);
    const xml = await mspdiRoute(new Request(`${BASE}/api/interchange/mspdi/HLT-026`, { headers: { 'sec-fetch-site': 'same-origin' } }), { params: Promise.resolve({ code: 'HLT-026' }) });
    expect(xml.status).toBe(200);
  });
});

describe('rate limits', () => {
  it('uploads: 429 with Retry-After once the window is full, nothing stored; another viewer is not affected', async () => {
    const before = (await listTaskFiles('T-2314')).length;
    exhaust('upload');
    const r = await upload();
    expect([r.status, Number(r.headers.get('retry-after')) > 0, await r.json()]).toEqual([429, true, { ok: false, error: EN_429 }]);
    expect((await listTaskFiles('T-2314')).length).toBe(before);
    // The limit is per address too: the same viewer from another address still uploads.
    expect((await upload({ 'x-forwarded-for': '10.1.2.3' })).status).toBe(200);
  });

  it('exports (screen files, MS Project XML, audit CSV) share the export window, in the viewer language', async () => {
    state.lang = 'fr';
    exhaust('export');
    const r = await exportCsv();
    expect([r.status, await r.text()]).toEqual([429, FR_429]);
    expect((await mspdiRoute(new Request(`${BASE}/api/interchange/mspdi/HLT-026`), { params: Promise.resolve({ code: 'HLT-026' }) })).status).toBe(429);
    expect((await auditCsv(new Request(`${BASE}/admin/integrations/audit.csv`))).status).toBe(429);
    resetRateLimits();
    expect((await auditCsv(new Request(`${BASE}/admin/integrations/audit.csv`))).status).toBe(200);
  });

  it('a refused viewer is refused before the limit is consulted (403 stays 403)', async () => {
    state.role = 'member';
    exhaust('export');
    expect((await auditCsv(new Request(`${BASE}/admin/integrations/audit.csv`))).status).toBe(403);
  });

  it('transcript import and analysis Server Functions are limited per viewer (translated refusal, nothing written)', async () => {
    state.role = 'pm';
    exhaust('upload');
    expect(await importTranscriptAction(form({ code: 'HLT-026', meeting: 'MTG-119', text: 'Romain: we agree.' }))).toEqual({ ok: false, error: EN_429 });
    state.lang = 'fr';
    exhaust('analysis');
    expect(await analyseTranscriptAction({ code: 'HLT-026', meeting: 'MTG-119', engine: 'local' })).toEqual({ ok: false, error: FR_429 });
  });
});
