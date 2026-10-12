// R-175 — the antivirus beyond the upload routes, with a fake clamd: the import upload (startImport; imports are switched on
// for this test, D-7b keeps them off in the app) refused before anything is stored and a flagged import file never parsed;
// the daily "files-rescan" job (never-scanned files checked, a stored file newly flagged is blocked, noted in the
// quarantine, audited and kept; a false positive allowed by IT is released; clamd down stops the run; expired refused
// uploads purged; scanning off reads nothing), run through the job runner and its lease; the health report's antivirus line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('@/domain/ch4-defaults', async (orig) => ({ ...(await orig<typeof import('@/domain/ch4-defaults')>()), IMPORTS_ENABLED: true }));

import { eq } from 'drizzle-orm';
import { checkHealth } from '@/server/health';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries, importJobs, storedFiles } from '@/server/db/schema';
import { startImport, tableMapping } from '@/server/interchange/jobs';
import { jobDefinition } from '@/server/jobs/definitions';
import { runJob } from '@/server/jobs/runner';
import { listJobLocks } from '@/server/dal/job-locks';
import { EICAR, EICAR_SIGNATURE, clamdEnv, startFakeClamd, type FakeClamd } from '@/test/fake-clamd';
import { readStoredFile, setFilesRoot, storeFile } from './files';
import { listQuarantine, setQuarantineRoot } from './quarantine';
import { rescanStoredFiles } from './rescan';
import { scanUpload } from './scan';

const enc = (s: string) => new TextEncoder().encode(s);
const director = { name: 'Marie Lefebvre', short: 'M. Lefebvre', role: 'director' as const };
let fake: FakeClamd;
let dir: string;

beforeAll(async () => {
  setDb(await openDatabase());
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-r175-jobs-'));
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
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fake.mode = 'scan';
  fake.detect = true;
});
const scanOn = () => {
  for (const [k, v] of Object.entries(clamdEnv(fake))) vi.stubEnv(k, v);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
};
const counts = async () => {
  const db = await getDb();
  return { files: (await db.select().from(storedFiles)).length, jobs: (await db.select().from(importJobs)).length };
};
const CSV = 'Reference;Name;Unit price\nPRT-9001;Bolt M12;0.4\n';

describe('import upload (startImport)', () => {
  it('infected or scanner down: refused with the message, nothing stored, no job; clean: stored (clean) and parsed', async () => {
    scanOn();
    const before = await counts();
    const input = (body: string) => ({ kind: 'parts' as const, mode: 'update' as const, projectCode: null, fileName: 'parts.csv', data: enc(body) });
    expect(await startImport(input(`${CSV}${EICAR}\n`), director)).toEqual({ ok: false, error: 'The file was refused by the antivirus' });
    fake.mode = 'error';
    expect(await startImport(input(CSV), director)).toEqual({ ok: false, error: 'The antivirus check is unavailable, try again later' });
    fake.mode = 'scan';
    expect(await counts()).toEqual(before);
    const ok = await startImport(input(CSV), director);
    expect(ok).toMatchObject({ ok: true, step: 'mapping' });
    const jobId = ok.ok && ok.step === 'mapping' ? ok.mapping.jobId : '';
    const [job] = await (await getDb()).select().from(importJobs).where(eq(importJobs.id, jobId));
    const [file] = await (await getDb()).select().from(storedFiles).where(eq(storedFiles.id, job.fileId!));
    expect(file.scanStatus).toBe('clean');
    // Flagged afterwards (rescan): the next step never parses it.
    await (await getDb()).update(storedFiles).set({ scanStatus: 'infected', scanSignature: 'Test.Sig' }).where(eq(storedFiles.id, file.id));
    expect(await tableMapping(jobId, null, director)).toEqual({ ok: false, error: 'This file was blocked by the antivirus' });
  });
});

describe('files-rescan job', () => {
  it('scanning off: nothing is read; the summary says so', async () => {
    const before = fake.scanned.length;
    const out = await jobDefinition('files-rescan').run();
    expect(out.summary).toMatch(/^antivirus off · nothing rescanned · \d+ quarantine entries purged$/);
    expect(fake.scanned.length).toBe(before);
  });

  it('never-scanned files are checked; one newly flagged is blocked, noted, audited and kept; a second run flags nothing more', async () => {
    // Stored while scanning was off (or before R-175): unscanned.
    const clean = await storeFile({ purpose: 'attachment', name: 'clean.txt', data: enc('just text'), actor: { name: 'Julien Wagner' } });
    const bad = await storeFile({ purpose: 'attachment', name: 'old-invoice.txt', data: enc(`legacy ${EICAR}`), actor: { name: 'Julien Wagner' } });
    expect([clean.scanStatus, bad.scanStatus]).toEqual(['unscanned', 'unscanned']);
    scanOn();
    const r = await rescanStoredFiles();
    // released 1: the import file flagged by hand in the test above passes clamd (it never was infected).
    expect(r).toMatchObject({ state: 'done', flagged: 1, released: 1, missing: 0 });
    expect(r.scanned).toBeGreaterThanOrEqual(2);
    const db = await getDb();
    const [b] = await db.select().from(storedFiles).where(eq(storedFiles.id, bad.id));
    const [c] = await db.select().from(storedFiles).where(eq(storedFiles.id, clean.id));
    expect([b.scanStatus, b.scanSignature, !!b.scannedAt, c.scanStatus]).toEqual(['infected', EICAR_SIGNATURE, true, 'clean']);
    // Blocked, never deleted: the record and the bytes stay until IT acts.
    expect(await readStoredFile(bad.id)).toMatchObject({ blocked: true });
    expect(fs.existsSync(path.join(dir, 'files', b.storagePath))).toBe(true);
    const note = (await listQuarantine()).find((e) => e.kind === 'flagged-stored-file' && e.note.fileId === bad.id);
    expect(note?.note).toMatchObject({ signature: EICAR_SIGNATURE, name: 'old-invoice.txt', storagePath: b.storagePath });
    const audit = await db.select().from(auditEntries).where(eq(auditEntries.entityId, bad.id));
    expect(audit.map((a) => [a.actorName, a.area, a.change])).toEqual([['Keystone antivirus', 'Files', 'file blocked by the antivirus: old-invoice.txt']]);
    expect((await rescanStoredFiles()).flagged).toBe(0);
  });

  it('a false positive IT allowed in clamd is released by the next rescan (audited)', async () => {
    scanOn();
    fake.detect = false;
    const r = await rescanStoredFiles();
    expect(r.released).toBe(1);
    const db = await getDb();
    const [b] = await db.select().from(storedFiles).where(eq(storedFiles.name, 'old-invoice.txt'));
    expect([b.scanStatus, b.scanSignature]).toEqual(['clean', null]);
    expect(await readStoredFile(b.id)).toMatchObject({ meta: { scanStatus: 'clean' } });
    expect((await db.select().from(auditEntries).where(eq(auditEntries.entityId, b.id))).map((a) => a.change)).toContain('file released by the antivirus rescan: old-invoice.txt');
  });

  it('clamd down stops the run (warning); a file missing on disk is counted; through the runner the outcome is leased and recorded', async () => {
    scanOn();
    const gone = await storeFile({ purpose: 'attachment', name: 'gone.txt', data: await scanUpload(enc('gone'), { purpose: 'attachment', name: 'gone.txt', actor: { name: 'x' }, objectRef: 'T' }), actor: { name: 'x' } });
    const [g] = await (await getDb()).select().from(storedFiles).where(eq(storedFiles.id, gone.id));
    fs.rmSync(path.join(dir, 'files', g.storagePath));
    expect((await rescanStoredFiles()).missing).toBe(1);
    fake.mode = 'error';
    const stopped = await rescanStoredFiles();
    expect([stopped.state, stopped.scanned]).toEqual(['stopped', 0]);
    const out = await jobDefinition('files-rescan').run();
    expect([out.warn, out.summary.startsWith('antivirus unavailable · stopped after')]).toEqual([true, true]);
    fake.mode = 'scan';
    expect((await runJob(jobDefinition('files-rescan'), 'test-holder', { force: true })).status).toBe('ok');
    const [lock] = (await listJobLocks()).filter((l) => l.job === 'files-rescan');
    expect([lock.lastOk, lock.lastSummary]).toEqual([true, expect.stringMatching(/files rescanned · 0 blocked/)]);
  });

  it('purges refused uploads older than 30 days (not the flagged files\' notes)', async () => {
    scanOn();
    await scanUpload(enc(EICAR), { purpose: 'attachment', name: 'evil.txt', actor: { name: 'x' }, objectRef: 'T-1' }).catch(() => null);
    const q = await listQuarantine();
    const refused = q.filter((e) => e.kind === 'refused-upload').length;
    expect(refused).toBeGreaterThan(0);
    const r = await rescanStoredFiles(new Date(Date.now() + 31 * 86_400_000));
    expect(r.purged).toBe(refused);
    expect((await listQuarantine()).filter((e) => e.kind === 'flagged-stored-file').length).toBe(q.filter((e) => e.kind === 'flagged-stored-file').length);
  });
});

describe('health report', () => {
  it('antivirus on: fileScan ok or unavailable, the status still follows the database only; off: no fileScan line', async () => {
    expect((await checkHealth()).checks.fileScan).toBeUndefined();
    scanOn();
    expect(await checkHealth()).toMatchObject({ status: 'ok', checks: { database: { status: 'ok' }, fileScan: { status: 'ok' } } });
    const gone = await startFakeClamd();
    vi.stubEnv('CLAMAV_PORT', String(gone.port));
    await gone.close();
    expect(await checkHealth()).toMatchObject({ status: 'ok', checks: { fileScan: { status: 'unavailable' } } });
  });
});
