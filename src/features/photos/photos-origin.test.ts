// R-117 (A-6 'a') × R-126 (X-15): a punch item's photos follow the item's STORED origin. The item is found by its number in the
// project (one list); a `register` sent with the request is ignored, so a client claiming "itp" for an item raised on site
// still gets 403, and adding a photo to an item raised on site needs the Site screen's edit right — 9 personas, on the seeded
// in-memory database with files in a temporary folder and the real project context.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`);
  },
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
  };
});

import { GET } from '@/app/api/photos/[id]/route';
import { POST } from '@/app/api/photos/route';
import { PERSONAS } from '@/config/personas';
import { clientSeesPhotos, type PhotoOwnerKey } from '@/domain/photos';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { addPhoto, listProjectPhotos, photoOwnerOf } from '@/server/dal/photos';
import { setFilesRoot } from '@/server/storage/files';
import { removePhotoAction } from './actions';
import { photoGate } from './access';

const ROLES = PERSONAS.map((p) => p.role);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
/** HLT-026's P-06 is raised on site (the Site register's former P-01, NCR-029); P-02 is raised by inspection I-03. */
const SITE_ITEM_FORGED: PhotoOwnerKey = { kind: 'punch_item', code: 'HLT-026', ref: 'P-06', register: 'itp' };
const SITE_ITEM: PhotoOwnerKey = { kind: 'punch_item', code: 'HLT-026', ref: 'P-06' };
const ITP_ITEM_FORGED: PhotoOwnerKey = { kind: 'punch_item', code: 'HLT-026', ref: 'P-02', register: 'site' };
let dir: string;

function upload(o: PhotoOwnerKey) {
  const body = new FormData();
  body.set('kind', o.kind);
  body.set('code', o.code);
  body.set('ref', o.ref);
  if (o.register) body.set('register', o.register);
  body.set('file', new File([PNG], 'site.png', { type: 'image/png' }));
  return POST(new Request('http://127.0.0.1:3315/api/photos', { method: 'POST', body, headers: { host: '127.0.0.1:3315' } }));
}
const image = (id: string) => GET(new Request(`http://127.0.0.1:3315/api/photos/${id}`), { params: Promise.resolve({ id }) });
const perRole = async (f: () => Promise<number>) => {
  const out: Record<string, number> = {};
  for (const role of ROLES) {
    session.role = role;
    out[role] = await f();
  }
  return out;
};

beforeAll(async () => {
  setDb(await openDatabase());
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-d8-photos-'));
  setFilesRoot(dir);
}, 60_000);
afterAll(() => {
  setFilesRoot(null);
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('R-117 · punch photos follow the stored origin', () => {
  it('adding to an item raised on site needs the Site edit right, whatever register the request claims', async () => {
    // Site editors on HLT-026's team: director, PM (of record), member (Julien Wagner); the department head is off the team (R-041).
    const site = { director: 200, pm: 200, depthead: 403, member: 200, englead: 403, quality: 403, procurement: 403, finance: 403, logistics: 403, client: 403 };
    expect(await perRole(async () => (await upload(SITE_ITEM_FORGED)).status)).toEqual(site);
    expect(await perRole(async () => (await upload(SITE_ITEM)).status)).toEqual(site);
    // An item raised by an inspection follows Inspections & punch list, even when the request claims "site".
    expect(await perRole(async () => (await upload(ITP_ITEM_FORGED)).status)).toEqual({
      director: 200, pm: 200, depthead: 403, member: 403, englead: 200, quality: 200, procurement: 403, finance: 403, logistics: 403, client: 403,
    });
  });

  it('seeing: internal viewers see both; the client sees the inspection item’s photos only, never the Site item’s (X-15)', async () => {
    const [sitePhoto] = (await listProjectPhotos('HLT-026', 'punch_item')).get('P-06')!;
    const [itpPhoto] = (await listProjectPhotos('HLT-026', 'punch_item')).get('P-02')!;
    const internal = { director: 200, pm: 200, depthead: 200, member: 200, englead: 200, quality: 200, procurement: 200, finance: 200, logistics: 200 };
    expect(await perRole(async () => (await image(sitePhoto.id)).status)).toEqual({ ...internal, client: 403 });
    expect(await perRole(async () => (await image(itpPhoto.id)).status)).toEqual({ ...internal, client: 200 });
    // The gate itself: a forged owner resolves to the stored origin.
    session.role = 'client';
    expect(await photoGate(SITE_ITEM_FORGED, 'view')).toEqual({ ok: false, status: 403, error: 'You cannot open this file' });
    expect(await photoOwnerOf(sitePhoto.id)).toEqual({ kind: 'punch_item', code: 'HLT-026', ref: 'P-06', register: 'site' });
    expect([clientSeesPhotos({ kind: 'punch_item', register: 'itp' }), clientSeesPhotos({ kind: 'punch_item', register: 'site' }), clientSeesPhotos({ kind: 'punch_item' })])
      .toEqual([true, false, false]);
  });

  it('removing a Site item’s photo: the Site editors only (9 personas)', async () => {
    const out: Record<string, string> = {};
    for (const role of ROLES) {
      const id = await addPhoto(SITE_ITEM, { name: `${role}.png`, data: PNG }, 'Marie Lefebvre');
      session.role = role;
      const r = await removePhotoAction(id);
      out[role] = r.ok ? 'ok' : r.error;
    }
    expect(out).toEqual({
      director: 'ok', pm: 'ok', depthead: 'Photos are read-only for you', member: 'ok', englead: 'Photos are read-only for you', quality: 'Photos are read-only for you',
      procurement: 'Photos are read-only for you', finance: 'Photos are read-only for you', logistics: 'Photos are read-only for you', client: 'Photos are read-only for you',
    });
  });

  it('the listing gives every origin, or one', async () => {
    expect([...(await listProjectPhotos('HLT-026', 'punch_item', 'site')).keys()]).toEqual(['P-06']);
    expect([...(await listProjectPhotos('HLT-026', 'punch_item', 'itp')).keys()]).toEqual(['P-02']);
    expect([...(await listProjectPhotos('HLT-026', 'punch_item')).keys()].sort()).toEqual(['P-02', 'P-06']);
  });
});
