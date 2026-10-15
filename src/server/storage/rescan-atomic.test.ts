// R-168 / R-175 — the daily "files-rescan" job changes a stored file's scan status and writes its audit row in one
// transaction: when the audit write fails, the status stays as it was, so the next run sees the change again and audits it
// (a block or a release is never left without its audit line). Fake clamd; writeAudit made to fail once.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const auditFault = vi.hoisted(() => ({ failNext: false }));
vi.mock('@/server/db/helpers', async (orig) => {
  const m = await orig<typeof import('@/server/db/helpers')>();
  return {
    ...m,
    writeAudit: async (...args: Parameters<typeof m.writeAudit>) => {
      if (auditFault.failNext) {
        auditFault.failNext = false;
        throw new Error('audit write failed');
      }
      return m.writeAudit(...args);
    },
  };
});

import { eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries, storedFiles } from '@/server/db/schema';
import { EICAR, EICAR_SIGNATURE, clamdEnv, startFakeClamd, type FakeClamd } from '@/test/fake-clamd';
import { setFilesRoot, storeFile } from './files';
import { listQuarantine, setQuarantineRoot } from './quarantine';
import { rescanStoredFiles } from './rescan';

const enc = (s: string) => new TextEncoder().encode(s);
let fake: FakeClamd;
let dir: string;

beforeAll(async () => {
  setDb(await openDatabase());
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-rescan-atomic-'));
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
  auditFault.failNext = false;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fake.detect = true;
});
const scanOn = () => {
  for (const [k, v] of Object.entries(clamdEnv(fake))) vi.stubEnv(k, v);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
};
const fileRow = async (id: string) => (await (await getDb()).select().from(storedFiles).where(eq(storedFiles.id, id)))[0];
const auditOf = async (id: string) => (await (await getDb()).select().from(auditEntries).where(eq(auditEntries.entityId, id))).map((a) => a.change);

describe('files-rescan: status change and audit row commit together', { timeout: 60_000 }, () => {
  it('a failed audit on a block leaves the file as it was; the next run blocks and audits it', async () => {
    const bad = await storeFile({ purpose: 'attachment', name: 'legacy-report.txt', data: enc(`legacy ${EICAR}`), actor: { name: 'Julien Wagner' } });
    expect(bad.scanStatus).toBe('unscanned');
    scanOn();
    auditFault.failNext = true;
    await expect(rescanStoredFiles()).rejects.toThrow('audit write failed');
    expect((await fileRow(bad.id)).scanStatus).toBe('unscanned');
    expect(await auditOf(bad.id)).toEqual([]);
    expect((await listQuarantine()).some((e) => e.kind === 'flagged-stored-file' && e.note.fileId === bad.id)).toBe(false);

    const r = await rescanStoredFiles();
    expect(r.flagged).toBe(1);
    const b = await fileRow(bad.id);
    expect([b.scanStatus, b.scanSignature]).toEqual(['infected', EICAR_SIGNATURE]);
    expect(await auditOf(bad.id)).toEqual(['file blocked by the antivirus: legacy-report.txt']);
    expect((await listQuarantine()).some((e) => e.kind === 'flagged-stored-file' && e.note.fileId === bad.id)).toBe(true);
  });

  it('a failed audit on a release leaves the file blocked; the next run releases and audits it', async () => {
    scanOn();
    fake.detect = false;
    const db = await getDb();
    const [bad] = await db.select().from(storedFiles).where(eq(storedFiles.name, 'legacy-report.txt'));
    expect(bad.scanStatus).toBe('infected');
    auditFault.failNext = true;
    await expect(rescanStoredFiles()).rejects.toThrow('audit write failed');
    const still = await fileRow(bad.id);
    expect([still.scanStatus, still.scanSignature]).toEqual(['infected', EICAR_SIGNATURE]);
    expect(await auditOf(bad.id)).toEqual(['file blocked by the antivirus: legacy-report.txt']);

    const r = await rescanStoredFiles();
    expect(r.released).toBe(1);
    const b = await fileRow(bad.id);
    expect([b.scanStatus, b.scanSignature]).toEqual(['clean', null]);
    expect(await auditOf(bad.id)).toEqual(['file blocked by the antivirus: legacy-report.txt', 'file released by the antivirus rescan: legacy-report.txt']);
  });
});
