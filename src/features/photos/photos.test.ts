// R-126 (X-15 "split", SC-4a "a"): photos of goods receipts, site daily reports and punch items stored by Keystone. Pure
// rules, then the upload / image Route Handlers and the remove Server Function on the seeded in-memory database with files
// in a temporary folder and the real project context: rights of the 8 personas per screen (Deliveries, Site, ITP), the
// client (sees only the ITP punch list's photos of their project, never adds), a PM on another project, type / content /
// size / count limits, the CSRF guard, the receipt's photo count, the audit trail and the galleries' render.
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
  usePathname: () => '/',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
  };
});

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GET } from '@/app/api/photos/[id]/route';
import { POST } from '@/app/api/photos/route';
import { MAX_PHOTOS_PER_OWNER, clientSeesPhotos, parsePhotoOwner, photoScreenOf, type PhotoOwnerKey } from '@/domain/photos';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getReceipt, listReceipts } from '@/server/dal/deliveries';
import { listAudit } from '@/server/dal/notifications';
import { addPhoto, legacyReceiptPhotoCount, listProjectPhotos } from '@/server/dal/photos';
import { setFilesRoot } from '@/server/storage/files';
import { removePhotoAction } from './actions';
import { photoViews } from './model';
import { PhotoGallery } from './photo-gallery';

const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'] as const;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const RECEIPT: PhotoOwnerKey = { kind: 'goods_receipt', code: 'HLT-026', ref: 'BL-2026-0521' };
const REPORT: PhotoOwnerKey = { kind: 'daily_report', code: 'HLT-026', ref: 'DR-001' };
const ITP_PUNCH: PhotoOwnerKey = { kind: 'punch_item', code: 'HLT-026', ref: 'P-02', register: 'itp' };
const SITE_PUNCH: PhotoOwnerKey = { kind: 'punch_item', code: 'HLT-026', ref: 'P-01', register: 'site' };
let dir: string;

function upload(o: PhotoOwnerKey, file: File | null, headers: Record<string, string> = {}) {
  const body = new FormData();
  body.set('kind', o.kind);
  body.set('code', o.code);
  body.set('ref', o.ref);
  if (o.register) body.set('register', o.register);
  if (file) body.set('file', file);
  return POST(new Request('http://127.0.0.1:3315/api/photos', { method: 'POST', body, headers: { host: '127.0.0.1:3315', ...headers } }));
}
const image = (id: string, q = '') => GET(new Request(`http://127.0.0.1:3315/api/photos/${id}${q}`), { params: Promise.resolve({ id }) });
const png = (name = 'rail-joint.png') => new File([PNG], name, { type: 'image/png' });
const json = async (r: Response) => ({ status: r.status, ...((await r.json()) as { ok: boolean; id?: string; error?: string }) });

beforeAll(async () => {
  setDb(await openDatabase());
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-d7-photos-'));
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

describe('R-126 rules', () => {
  it('owner parsing, the governing screen, what the client sees', () => {
    expect(parsePhotoOwner({ kind: 'goods_receipt', code: 'HLT-026', ref: 'bl-2026-0521' })).toEqual({ kind: 'goods_receipt', code: 'HLT-026', ref: 'BL-2026-0521', register: null });
    expect(parsePhotoOwner({ kind: 'punch_item', code: 'HLT-026', ref: 'P-02', register: 'itp' })).toEqual(ITP_PUNCH);
    expect([
      parsePhotoOwner({ kind: 'invoice', code: 'HLT-026', ref: 'X' }), parsePhotoOwner({ kind: 'daily_report', code: 'HLT-026', ref: 'BL-1' }),
      parsePhotoOwner({ kind: 'punch_item', code: 'HLT-026', ref: 'P-02' }), parsePhotoOwner({ kind: 'daily_report', code: '../etc', ref: 'DR-001' }),
    ]).toEqual([null, null, null, null]);
    expect([RECEIPT, REPORT, ITP_PUNCH, SITE_PUNCH].map(photoScreenOf)).toEqual(['deliveries', 'site', 'itp', 'site']);
    expect([RECEIPT, REPORT, ITP_PUNCH, SITE_PUNCH].map(clientSeesPhotos)).toEqual([false, false, true, false]);
  });
});

describe('R-126 upload, image, remove', () => {
  it('who may add, per screen (8 personas): Deliveries, Site, ITP punch list — never the client', async () => {
    const add = async (o: PhotoOwnerKey) => {
      const out: Record<string, number> = {};
      for (const role of ROLES) {
        session.role = role;
        out[role] = (await upload(o, png(`${role}.png`))).status;
      }
      return out;
    };
    expect(await add(RECEIPT)).toEqual({ director: 200, pm: 200, depthead: 403, member: 403, englead: 403, quality: 200, procurement: 200, client: 403 });
    // R-041: the department head is not on HLT-026's team, so the project is read-only for them.
    expect(await add(REPORT)).toEqual({ director: 200, pm: 200, depthead: 403, member: 200, englead: 403, quality: 403, procurement: 403, client: 403 });
    expect(await add(ITP_PUNCH)).toEqual({ director: 200, pm: 200, depthead: 403, member: 403, englead: 200, quality: 200, procurement: 403, client: 403 });
    // A PM on another PM's project (read-only there); an unknown record of that project is 404.
    session.role = 'pm';
    const [ndc] = await listReceipts('NDC-031');
    expect(await json(await upload({ kind: 'goods_receipt', code: 'NDC-031', ref: ndc.number }, png()))).toMatchObject({ status: 403, error: 'Photos are read-only for you' });
    expect((await upload({ kind: 'punch_item', code: 'NDC-031', ref: 'P-99', register: 'site' }, png())).status).toBe(404);
    expect((await listProjectPhotos('NDC-031', 'goods_receipt')).size).toBe(0);
    expect((await listProjectPhotos('HLT-026', 'goods_receipt')).get('BL-2026-0521')!.map((p) => p.uploadedBy)).toEqual(['Marie Lefebvre', 'Romain Aubert', 'Gabriel Comte', 'Fabien Bertrand']);
  });

  it('a receipt photo is a receipt attachment (the photo count includes it); audited; served inline or as a download', async () => {
    const before = (await getReceipt('BL-2026-0521'))!.photoCount;
    const legacy = await legacyReceiptPhotoCount('BL-2026-0521');
    const r = await json(await upload(RECEIPT, new File([JPG], 'Drum 2 sheath.JPG', { type: 'image/jpeg' })));
    expect([r.status, r.ok]).toEqual([200, true]);
    expect((await getReceipt('BL-2026-0521'))!.photoCount).toBe(before + 1);
    expect(await legacyReceiptPhotoCount('BL-2026-0521')).toBe(legacy);
    const [audit] = await listAudit({ limit: 1 });
    expect([audit.who, audit.object, audit.area, audit.change]).toEqual(['Marie Lefebvre', 'BL-2026-0521', 'Deliveries', 'photo added: Drum 2 sheath.JPG']);
    const got = await image(r.id!);
    expect([got.status, got.headers.get('content-type'), got.headers.get('content-disposition'), got.headers.get('x-content-type-options')]).toEqual([
      200, 'image/jpeg', `inline; filename="Drum 2 sheath.JPG"; filename*=UTF-8''Drum%202%20sheath.JPG`, 'nosniff',
    ]);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(JPG);
    expect((await image(r.id!, '?download=1')).headers.get('content-disposition')).toMatch(/^attachment;/);
  });

  it('who may see: internal viewers; the client only the ITP punch list of their project', async () => {
    const [receipt] = (await listProjectPhotos('HLT-026', 'goods_receipt')).get('BL-2026-0521')!;
    const [report] = (await listProjectPhotos('HLT-026', 'daily_report')).get('DR-001')!;
    const [punch] = (await listProjectPhotos('HLT-026', 'punch_item', 'itp')).get('P-02')!;
    const see = async (id: string) => {
      const out: Record<string, number> = {};
      for (const role of ROLES) {
        session.role = role;
        out[role] = (await image(id)).status;
      }
      return out;
    };
    const internal = { director: 200, pm: 200, depthead: 200, member: 200, englead: 200, quality: 200, procurement: 200 };
    expect(await see(receipt.id)).toEqual({ ...internal, client: 403 });
    expect(await see(report.id)).toEqual({ ...internal, client: 403 });
    expect(await see(punch.id)).toEqual({ ...internal, client: 200 });
    expect((await image('00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await image('nope')).status).toBe(404);
  });

  it('refuses wrong types, mismatched content, cross-site posts, malformed owners, empty requests (translated) and beyond the limit', async () => {
    expect(await json(await upload(REPORT, new File([PNG], 'scan.pdf')))).toMatchObject({ status: 415, error: 'File type not accepted' });
    expect(await json(await upload(REPORT, new File([JPG], 'fake.png')))).toMatchObject({ status: 415, error: 'The file content does not match its extension' });
    expect((await upload(REPORT, png(), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await upload({ ...REPORT, ref: 'DR-999' }, png())).status).toBe(404);
    expect((await upload({ ...REPORT, ref: 'X' }, png())).status).toBe(400);
    session.lang = 'fr';
    expect(await json(await upload(REPORT, null))).toMatchObject({ status: 400, error: 'Choisissez une photo à ajouter' });
    session.lang = 'en';
    // The limit per record.
    const item: PhotoOwnerKey = { kind: 'punch_item', code: 'HLT-026', ref: 'P-03', register: 'itp' };
    for (let i = 0; i < MAX_PHOTOS_PER_OWNER; i++) await addPhoto(item, { name: `p${i}.png`, data: PNG }, 'Marie Lefebvre');
    expect(await json(await upload(item, png()))).toMatchObject({ status: 409, error: `Too many photos · max ${MAX_PHOTOS_PER_OWNER}` });
  });

  it('"Remove photo": the screen’s editors only; the file, its receipt attachment and the count go; audited', async () => {
    const [first] = (await listProjectPhotos('HLT-026', 'goods_receipt')).get('BL-2026-0521')!;
    const count = (await getReceipt('BL-2026-0521'))!.photoCount;
    for (const role of ['depthead', 'member', 'englead', 'client']) {
      session.role = role;
      expect(await removePhotoAction(first.id)).toEqual({ ok: false, error: 'Photos are read-only for you' });
    }
    session.role = 'procurement';
    expect(await removePhotoAction('nope')).toEqual({ ok: false, error: 'Invalid request' });
    expect(await removePhotoAction(first.id)).toEqual({ ok: true });
    expect((await getReceipt('BL-2026-0521'))!.photoCount).toBe(count - 1);
    expect((await image(first.id)).status).toBe(404);
    const [audit] = await listAudit({ limit: 1 });
    expect([audit.who, audit.object, audit.change]).toEqual(['Fabien Bertrand', 'BL-2026-0521', 'photo removed: director.png']);
  });

  it('gallery render: thumbnails link to the image, download and remove for editors, the empty caption, legacy photos', async () => {
    const rows = (await listProjectPhotos('HLT-026', 'daily_report')).get('DR-001')!;
    const html = (canEdit: boolean, photos = photoViews(rows), legacyCount = 0) =>
      renderToStaticMarkup(h(I18nProvider, { lang: 'fr', children: h(PhotoGallery, { owner: REPORT, photos, canEdit, empty: 'Aucune photo', legacyCount }) }));
    const edit = html(true);
    expect(edit).toContain(`src="/api/photos/${rows[0].id}"`);
    expect(edit).toContain(`href="/api/photos/${rows[0].id}?download=1"`);
    expect(edit).toContain('loading="lazy"');
    expect(edit).toContain('Ajouter des photos');
    expect(edit).toMatch(/accept="\.jpg,\.jpeg,\.png,\.webp,\.gif"/);
    expect(edit).toContain(`aria-label="Retirer ${rows[0].name}"`);
    const read = html(false);
    expect(read).not.toContain('Ajouter des photos');
    expect(read).not.toContain('aria-label="Retirer');
    const empty = html(false, [], 3);
    expect(empty).toContain('Aucune photo');
    expect(empty).toContain('3 photos enregistrées sans fichier stocké');
  });
});
