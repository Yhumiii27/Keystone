// R-175 — antivirus on uploaded meeting transcripts (Server Function importTranscriptAction, GET /api/meetings/<n>/transcript)
// for the personas, with a fake clamd and the real project context: the minutes' writers (P-9b) are checked before the scan
// (a refused persona's file never reaches clamd); for the writers an infected file is refused with the generic translated
// message and a file is refused while the antivirus is unavailable; a pasted transcript is not a file and is not scanned;
// a transcript file a rescan flagged answers 410.
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
import { GET } from '@/app/api/meetings/[number]/transcript/route';
import { PERSONAS } from '@/config/personas';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { storedFiles } from '@/server/db/schema';
import { getTranscriptFileRef } from '@/server/dal/meetings-transcripts';
import { resetRateLimits } from '@/server/http/request-guard';
import { setFilesRoot } from '@/server/storage/files';
import { listQuarantine, setQuarantineRoot } from '@/server/storage/quarantine';
import { EICAR, clamdEnv, startFakeClamd, type FakeClamd } from '@/test/fake-clamd';
import { importTranscriptAction } from './actions';

const MEETING = 'MTG-119';
const VTT = 'WEBVTT\n\n00:00.000 --> 00:03.000\n<v Antoine Girard>On valide le plan de levage.\n';
let dir: string;
let fake: FakeClamd;

const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const vtt = (body: string, name = 'levage.vtt') => new File([body], name, { type: 'text/vtt' });
const transcriptFile = () => GET(new Request(`http://127.0.0.1:3315/api/meetings/${MEETING}/transcript`), { params: Promise.resolve({ number: MEETING }) });

beforeAll(async () => {
  setDb(await openDatabase());
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-r175-mtg-'));
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

describe('transcript upload with the antivirus on (R-175)', () => {
  it('every persona: the writers get the antivirus refusals; the others their rights refusal, nothing scanned', async () => {
    const writers: string[] = [];
    for (const p of PERSONAS) {
      session.role = p.role;
      resetRateLimits();
      const scanned = fake.scanned.length;
      const quarantined = (await listQuarantine()).length;
      const infected = await importTranscriptAction(form({ code: 'HLT-026', meeting: MEETING, file: vtt(`${VTT}${EICAR}\n`) }));
      fake.mode = 'error';
      const down = await importTranscriptAction(form({ code: 'HLT-026', meeting: MEETING, file: vtt(VTT) }));
      fake.mode = 'scan';
      if (infected.ok === false && infected.error === 'The file was refused by the antivirus') {
        writers.push(p.role);
        expect(down).toEqual({ ok: false, error: 'The antivirus check is unavailable, try again later' });
        expect((await listQuarantine()).length).toBe(quarantined + 1);
      } else {
        expect(infected.ok).toBe(false);
        expect(down).toEqual(infected);
        expect(fake.scanned.length).toBe(scanned);
        expect((await listQuarantine()).length).toBe(quarantined);
      }
    }
    // P-9b: the organiser (Antoine Girard, englead) and the project's PM (Romain Aubert) write the minutes.
    expect(writers).toEqual(['pm', 'englead']);
    // Nothing was stored for any refused file.
    expect(await getTranscriptFileRef(MEETING)).toBeNull();
  });

  it('French message; a pasted transcript is not scanned; a clean file is stored (clean) and served until a rescan flags it (410)', async () => {
    session.role = 'pm';
    session.lang = 'fr';
    expect(await importTranscriptAction(form({ code: 'HLT-026', meeting: MEETING, file: vtt(`${VTT}${EICAR}\n`) }))).toEqual({ ok: false, error: 'Le fichier a été refusé par l’antivirus' });
    session.lang = 'en';
    fake.mode = 'error';
    expect((await importTranscriptAction(form({ code: 'HLT-026', meeting: MEETING, text: 'A. Girard: Plan validé.' }))).ok).toBe(true);
    fake.mode = 'scan';
    expect((await importTranscriptAction(form({ code: 'HLT-026', meeting: MEETING, file: vtt(VTT) }))).ok).toBe(true);
    const ref = (await getTranscriptFileRef(MEETING))!;
    const [row] = await (await getDb()).select().from(storedFiles).where(eq(storedFiles.id, ref.fileId));
    expect(row.scanStatus).toBe('clean');
    expect((await transcriptFile()).status).toBe(200);
    await (await getDb()).update(storedFiles).set({ scanStatus: 'infected', scanSignature: 'Test.Sig' }).where(eq(storedFiles.id, ref.fileId));
    const r = await transcriptFile();
    expect([r.status, await r.text()]).toEqual([410, 'This file was blocked by the antivirus']);
  });
});
