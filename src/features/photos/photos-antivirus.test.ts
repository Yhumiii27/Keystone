// R-175 — antivirus on photos (POST /api/photos, GET /api/photos/<id>) for the personas, with a fake clamd and the real
// project context: the rights (photo gate) come first and a refused persona's photo never reaches clamd; for every persona
// allowed to add a daily-report photo, an infected image is refused 422 and any image 503 while the antivirus is unavailable;
// a photo a rescan flagged answers 410 to every persona who may see it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: () => {
    throw new Error('REDIRECT');
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

import { eq } from 'drizzle-orm';
import { GET } from '@/app/api/photos/[id]/route';
import { POST } from '@/app/api/photos/route';
import { PERSONAS } from '@/config/personas';
import type { PhotoOwnerKey } from '@/domain/photos';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { storedFiles } from '@/server/db/schema';
import { listProjectPhotos } from '@/server/dal/photos';
import { resetRateLimits } from '@/server/http/request-guard';
import { setFilesRoot } from '@/server/storage/files';
import { listQuarantine, setQuarantineRoot } from '@/server/storage/quarantine';
import { EICAR, clamdEnv, startFakeClamd, type FakeClamd } from '@/test/fake-clamd';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const REPORT: PhotoOwnerKey = { kind: 'daily_report', code: 'HLT-026', ref: 'DR-001' };
let dir: string;
let fake: FakeClamd;

const png = (extra: string, name = 'joint.png') => new File([new Uint8Array([...PNG, ...new TextEncoder().encode(extra)])], name, { type: 'image/png' });
function upload(o: PhotoOwnerKey, file: File) {
  const body = new FormData();
  body.set('kind', o.kind);
  body.set('code', o.code);
  body.set('ref', o.ref);
  body.set('file', file);
  return POST(new Request('http://127.0.0.1:3315/api/photos', { method: 'POST', body, headers: { host: '127.0.0.1:3315' } }));
}
const image = (id: string) => GET(new Request(`http://127.0.0.1:3315/api/photos/${id}`), { params: Promise.resolve({ id }) });
const answer = async (r: Response) => ({ status: r.status, ...((await r.json()) as { ok: boolean; id?: string; error?: string }) });

beforeAll(async () => {
  setDb(await openDatabase());
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-r175-photos-'));
  setFilesRoot(path.join(dir, 'files'));
  setQuarantineRoot(path.join(dir, 'quarantine'));
  fake = await startFakeClamd();
}, 60_000);
afterAll(async () => {
  await fake.close();
  setFilesRoot(null);
  setQuarantineRoot(null);
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
  resetRateLimits();
  for (const [k, v] of Object.entries(clamdEnv(fake))) vi.stubEnv(k, v);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fake.mode = 'scan';
});

describe('photos with the antivirus on (R-175)', { timeout: 60_000 }, () => {
  it('every persona: rights first; allowed → clean 200, infected 422, scanner down 503; refused → the same refusal, nothing scanned', async () => {
    const allowed: string[] = [];
    for (const p of PERSONAS) {
      session.role = p.role;
      resetRateLimits();
      const scanned = fake.scanned.length;
      const quarantined = (await listQuarantine()).length;
      const clean = await answer(await upload(REPORT, png(`by ${p.role}`)));
      const infected = await answer(await upload(REPORT, png(EICAR, 'scan.png')));
      fake.mode = 'error';
      const down = await answer(await upload(REPORT, png('later')));
      fake.mode = 'scan';
      if (clean.status === 200) {
        allowed.push(p.role);
        expect([infected.status, infected.error]).toEqual([422, 'The file was refused by the antivirus']);
        expect([down.status, down.error]).toEqual([503, 'The antivirus check is unavailable, try again later']);
        expect((await listQuarantine()).length).toBe(quarantined + 1);
      } else {
        expect([infected.status, down.status]).toEqual([clean.status, clean.status]);
        expect(fake.scanned.length).toBe(scanned);
        expect((await listQuarantine()).length).toBe(quarantined);
      }
    }
    // Site daily reports: the project's leads and the director (R-126 rights); never the client.
    expect(allowed).toContain('director');
    expect(allowed).not.toContain('client');
    const photos = (await listProjectPhotos('HLT-026', 'daily_report')).get('DR-001') ?? [];
    expect(photos).toHaveLength(allowed.length);
  });

  it('a flagged photo answers 410 instead of the image', async () => {
    const { id } = await answer(await upload(REPORT, png('flag me', 'flag.png')));
    expect((await image(id!)).status).toBe(200);
    await (await getDb()).update(storedFiles).set({ scanStatus: 'infected', scanSignature: 'Test.Sig' }).where(eq(storedFiles.id, id!));
    const r = await image(id!);
    expect([r.status, await r.text()]).toEqual([410, 'This file was blocked by the antivirus']);
    expect(r.headers.get('content-type')).toContain('text/plain');
  });
});
