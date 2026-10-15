// R-175 — antivirus on task attachments (POST /api/tasks/<T>/files, GET …/files/<id>) for the personas, with a fake clamd:
// the rights are checked before the scan (a refused persona's file never reaches clamd nor the quarantine); for every
// persona allowed to attach, an infected file is refused 422 and a file is refused 503 while the antivirus is unavailable
// (fail-closed), with generic translated messages; a file a rescan flagged answers 410 instead of its bytes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const state = { role: 'director' as RoleKey, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return { getI18n: async () => ({ lang: state.lang, t: makeT(state.lang) }), getViewer: async () => PERSONA_BY_ROLE[state.role] };
});
vi.mock('@/server/project-context', async (orig) => {
  const actual = await orig<typeof import('@/server/project-context')>();
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  const { isOutside } = await import('@/components/app/shell/nav-model');
  return {
    ...actual,
    getScreenAccess: async (screen: 'mywork' | 'task') => {
      const outside = isOutside(state.role, screen);
      return { viewer: PERSONA_BY_ROLE[state.role], outside, canEdit: !outside };
    },
  };
});

import { eq } from 'drizzle-orm';
import { GET } from '@/app/api/tasks/[taskId]/files/[fileId]/route';
import { POST } from '@/app/api/tasks/[taskId]/files/route';
import { PERSONAS } from '@/config/personas';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { storedFiles, taskAttachments } from '@/server/db/schema';
import { listTaskFiles } from '@/server/dal/task-files';
import { resetRateLimits } from '@/server/http/request-guard';
import { setFilesRoot } from '@/server/storage/files';
import { listQuarantine, setQuarantineRoot } from '@/server/storage/quarantine';
import { EICAR, clamdEnv, startFakeClamd, type FakeClamd } from '@/test/fake-clamd';

let dir: string;
let fake: FakeClamd;
const TASK = 'T-2314';

function upload(taskId: string, file: File) {
  const body = new FormData();
  body.set('file', file);
  return POST(new Request(`http://127.0.0.1:3315/api/tasks/${taskId}/files`, { method: 'POST', body, headers: { host: '127.0.0.1:3315' } }), { params: Promise.resolve({ taskId }) });
}
const download = (taskId: string, fileId: string) => GET(new Request(`http://127.0.0.1:3315/api/tasks/${taskId}/files/${fileId}`), { params: Promise.resolve({ taskId, fileId }) });
const answer = async (r: Response) => ({ status: r.status, ...((await r.json()) as { ok: boolean; id?: string; error?: string }) });
const txt = (body: string, name = 'notes.txt') => new File([body], name, { type: 'text/plain' });

beforeAll(async () => {
  setDb(await openDatabase());
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-r175-tasks-'));
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
  state.role = 'director';
  state.lang = 'en';
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

describe('task attachments with the antivirus on (R-175)', { timeout: 60_000 }, () => {
  it('every persona: rights first; allowed → clean 200 (scan_status clean), infected 422, scanner down 503; refused → same refusal, nothing scanned', async () => {
    const outcomes: Record<string, number[]> = {};
    for (const p of PERSONAS) {
      state.role = p.role;
      resetRateLimits();
      const scannedBefore = fake.scanned.length;
      const quarantined = (await listQuarantine()).length;
      const clean = await answer(await upload(TASK, txt(`clean note by ${p.role}`)));
      const infected = await answer(await upload(TASK, txt(`attached ${EICAR}`, 'invoice.txt')));
      fake.mode = 'error';
      const down = await answer(await upload(TASK, txt('another note')));
      fake.mode = 'scan';
      outcomes[p.role] = [clean.status, infected.status, down.status];
      if (clean.status === 200) {
        expect(infected).toEqual({ status: 422, ok: false, error: 'The file was refused by the antivirus' });
        expect(down).toEqual({ status: 503, ok: false, error: 'The antivirus check is unavailable, try again later' });
        expect((await listQuarantine()).length).toBe(quarantined + 1);
        const [row] = await (await getDb()).select().from(storedFiles).innerJoin(taskAttachments, eq(taskAttachments.fileId, storedFiles.id)).where(eq(taskAttachments.id, clean.id!));
        expect(row.stored_files.scanStatus).toBe('clean');
      } else {
        // Refused by the rights before anything is read or scanned.
        expect([infected.status, down.status]).toEqual([clean.status, clean.status]);
        expect(fake.scanned.length).toBe(scannedBefore);
        expect((await listQuarantine()).length).toBe(quarantined);
      }
    }
    // The director attaches (any task); the other personas are not this task's assignee (or are outside their workspace).
    expect(outcomes.director).toEqual([200, 422, 503]);
    expect(Object.entries(outcomes).filter(([, o]) => o[0] === 200).map(([r]) => r)).toEqual(['director']);
    // Only the clean files were stored.
    expect((await listTaskFiles(TASK)).filter((f) => f.hasFile).map((f) => f.name)).toEqual(['notes.txt']);
  });

  it('French messages for the refusals', async () => {
    state.lang = 'fr';
    expect((await answer(await upload(TASK, txt(EICAR, 'x.txt')))).error).toBe('Le fichier a été refusé par l’antivirus');
    fake.mode = 'error';
    expect((await answer(await upload(TASK, txt('y'))))).toMatchObject({ status: 503, error: 'Le contrôle antivirus est indisponible, réessayez plus tard' });
  });

  it('a stored file a rescan flagged answers 410 (not its bytes, not 404); an unknown one stays 404', async () => {
    const { id } = await answer(await upload(TASK, txt('to be flagged', 'flag.txt')));
    expect((await download(TASK, id!)).status).toBe(200);
    const [a] = await (await getDb()).select({ fileId: taskAttachments.fileId }).from(taskAttachments).where(eq(taskAttachments.id, id!));
    await (await getDb()).update(storedFiles).set({ scanStatus: 'infected', scanSignature: 'Test.Sig' }).where(eq(storedFiles.id, a.fileId!));
    const r = await download(TASK, id!);
    expect([r.status, await r.text()]).toEqual([410, 'This file was blocked by the antivirus']);
    expect((await download(TASK, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    state.lang = 'fr';
    expect(await (await download(TASK, id!)).text()).toBe('Ce fichier a été bloqué par l’antivirus');
  });
});
