// R-175 — antivirus on uploaded files (platform default, owner to confirm): the clamd client against a fake clamd on a random
// port and on a unix socket (OK, FOUND for the EICAR test string, ERROR, size limit while writing, timeout, reset, silent
// close, PING), then scanUpload + storeFile on an in-memory database with files and quarantine in temporary folders —
// fail-closed verdicts, the quarantine copy and note, the audit entry, the mark storeFile requires while scanning is on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries, storedFiles } from '@/server/db/schema';
import { EICAR, EICAR_SIGNATURE, clamdEnv, startFakeClamd, type FakeClamd } from '@/test/fake-clamd';
import { FileRejectedError, readStoredFile, setFilesRoot, storeFile, uploadRefusalStatus } from './files';
import { listQuarantine, purgeQuarantine, setQuarantineRoot } from './quarantine';
import { clamdPing, clamdScan, scanUpload } from './scan';
import { scanMarkOf } from './scan-mark';

const enc = (s: string) => new TextEncoder().encode(s);
const actor = { name: 'Marie Lefebvre' };
let fake: FakeClamd;
let dir: string;

beforeAll(async () => {
  setDb(await openDatabase());
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-r175-'));
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
});
const scanOn = () => {
  for (const [k, v] of Object.entries(clamdEnv(fake))) vi.stubEnv(k, v);
};
const quiet = () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
};

describe('clamd client (zINSTREAM)', () => {
  const target = () => ({ host: fake.host, port: fake.port });

  it('never uses port 3310 (Keystone smoke tests on the Mac) nor another EPC2i port', () => {
    expect([3000, 3100, 3110, 3200, 3210, 3217, 3310, 5173]).not.toContain(fake.port);
  });

  it('OK for clean bytes, FOUND with the signature for EICAR; the stream is sent whole in chunks', async () => {
    expect(await clamdScan(enc('%PDF-1.4 clean'), target())).toEqual({ status: 'clean' });
    expect(await clamdScan(enc(`header ${EICAR} trailer`), target())).toEqual({ status: 'infected', signature: EICAR_SIGNATURE });
    const big = new Uint8Array(300 * 1024).fill(65);
    expect(await clamdScan(big, target())).toEqual({ status: 'clean' });
    expect(fake.scanned.at(-1)).toBe(big.byteLength);
  });

  it('fail-closed: an ERROR reply, the size limit while writing, a timeout, a reset, a silent close, a closed port are "unavailable"', async () => {
    fake.mode = 'error';
    expect(await clamdScan(enc('x'), target())).toMatchObject({ status: 'unavailable', message: expect.stringContaining('ERROR') });
    fake.mode = 'size-limit';
    const r = await clamdScan(new Uint8Array(2 * 1024 * 1024), target());
    expect(r.status).toBe('unavailable');
    expect(r.status === 'unavailable' && r.message).toMatch(/size limit exceeded|ECONNRESET|EPIPE|closed/);
    fake.mode = 'timeout';
    const t0 = Date.now();
    expect(await clamdScan(enc('x'), target(), { connectMs: 1000, scanMs: 200 })).toEqual({ status: 'unavailable', message: 'scan timeout' });
    expect(Date.now() - t0).toBeLessThan(2000);
    fake.mode = 'reset';
    expect((await clamdScan(enc('x'), target())).status).toBe('unavailable');
    fake.mode = 'silent-close';
    expect(await clamdScan(enc('x'), target())).toEqual({ status: 'unavailable', message: 'connection closed without a reply' });
    // Nothing listens there (a port freed just now).
    const gone = await startFakeClamd();
    const port = gone.port;
    await gone.close();
    expect((await clamdScan(enc('x'), { host: '127.0.0.1', port })).status).toBe('unavailable');
  });

  it('works over a unix socket; PING answers PONG, a dead scanner does not', async () => {
    const sock = path.join(dir, 'clamd.sock');
    const unix = await startFakeClamd({ socket: sock });
    try {
      expect(await clamdScan(enc(EICAR), { socket: sock })).toEqual({ status: 'infected', signature: EICAR_SIGNATURE });
      expect(await clamdPing({ socket: sock })).toBe(true);
    } finally {
      await unix.close();
    }
    expect(await clamdPing({ socket: sock }, 300)).toBe(false);
    expect(await clamdPing(target())).toBe(true);
  });
});

describe('scanUpload + storeFile', () => {
  it('scanning off (development, tests): the bytes are marked unscanned and stored with that verdict; an ArrayBuffer is normalised once', async () => {
    const buf = enc('%PDF-1.4 off').buffer as ArrayBuffer;
    const bytes = await scanUpload(buf, { purpose: 'attachment', name: 'a.pdf', actor, objectRef: 'T-2314' });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(scanMarkOf(bytes)).toEqual({ status: 'unscanned', at: null });
    const meta = await storeFile({ purpose: 'attachment', name: 'a.pdf', data: bytes, actor });
    expect(meta.scanStatus).toBe('unscanned');
    // Unmarked bytes are still accepted while scanning is off (seeds, scripts, existing tests).
    expect((await storeFile({ purpose: 'attachment', name: 'b.pdf', data: enc('%PDF-1.4 b'), actor })).scanStatus).toBe('unscanned');
  });

  it('clean: stored with scan_status clean and its time; the mark is on the very Uint8Array returned', async () => {
    scanOn();
    const input = enc('%PDF-1.4 clean upload');
    const bytes = await scanUpload(input, { purpose: 'attachment', name: 'clean.pdf', actor, objectRef: 'T-2314' });
    expect(bytes).toBe(input);
    expect(scanMarkOf(bytes)).toMatchObject({ status: 'clean', at: expect.any(Date) });
    const meta = await storeFile({ purpose: 'attachment', name: 'clean.pdf', data: bytes, actor });
    const [row] = await (await getDb()).select().from(storedFiles).where(eq(storedFiles.id, meta.id));
    expect([row.scanStatus, !!row.scannedAt, row.scanSignature]).toEqual(['clean', true, null]);
  });

  it('while scanning is on, storeFile refuses bytes that were not checked (a new upload path that forgot the scan)', async () => {
    scanOn();
    await expect(storeFile({ purpose: 'attachment', name: 'raw.pdf', data: enc('%PDF-1.4 raw'), actor })).rejects.toThrow(/not checked by the antivirus/);
    // A copy of checked bytes is not checked either: the mark belongs to the object.
    const bytes = await scanUpload(enc('%PDF-1.4 copy'), { purpose: 'attachment', name: 'c.pdf', actor, objectRef: 'T-2314' });
    await expect(storeFile({ purpose: 'attachment', name: 'c.pdf', data: bytes.slice(), actor })).rejects.toThrow(/not checked/);
  });

  it('infected: refused with a generic message (422), a quarantine copy and note, a warning with the signature, an audit entry', async () => {
    scanOn();
    quiet();
    const warn = vi.spyOn(console, 'warn');
    const before = (await listQuarantine()).length;
    const err = await scanUpload(enc(EICAR), { purpose: 'photo', name: '../evil "x".png', actor, objectRef: 'HLT-026 · DR-001', projectId: null }).catch((e) => e);
    expect(err).toBeInstanceOf(FileRejectedError);
    expect([err.code, err.message, uploadRefusalStatus(err)]).toEqual(['infected', 'The file was refused by the antivirus', 422]);
    expect(err.message).not.toContain(EICAR_SIGNATURE);
    const q = await listQuarantine();
    expect(q.length).toBe(before + 1);
    const entry = q.find((e) => e.note.name === 'evil x.png')!;
    expect(entry.note).toMatchObject({ kind: 'refused-upload', signature: EICAR_SIGNATURE, purpose: 'photo', objectRef: 'HLT-026 · DR-001', actor: 'Marie Lefebvre' });
    const copy = fs.readFileSync(path.join(dir, 'quarantine', entry.note.bytesFile!), 'utf8');
    expect(copy).toBe(EICAR);
    // Outside the files folder (never served, never pruned as an orphan).
    expect(fs.existsSync(path.join(dir, 'files', entry.note.bytesFile!))).toBe(false);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain(EICAR_SIGNATURE);
    const audit = await (await getDb()).select().from(auditEntries).where(eq(auditEntries.area, 'Files'));
    expect(audit.map((a) => [a.actorName, a.objectRef, a.change])).toContainEqual(['Marie Lefebvre', 'HLT-026 · DR-001', 'upload refused by the antivirus: evil x.png']);
  });

  it('scanner unavailable: refused (503) whatever the file — fail-closed — with an error line for IT, nothing quarantined', async () => {
    scanOn();
    quiet();
    const error = vi.spyOn(console, 'error');
    const before = (await listQuarantine()).length;
    fake.mode = 'error';
    const err = await scanUpload(enc('%PDF-1.4 fine'), { purpose: 'attachment', name: 'fine.pdf', actor, objectRef: 'T-2314' }).catch((e) => e);
    expect([err.code, err.message, uploadRefusalStatus(err)]).toEqual(['scan_unavailable', 'The antivirus check is unavailable, try again later', 503]);
    expect((await listQuarantine()).length).toBe(before);
    expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toContain('Antivirus unavailable');
  });

  it('a stored file flagged later is blocked: readStoredFile returns { blocked } and never its bytes', async () => {
    const meta = await storeFile({ purpose: 'attachment', name: 'later.pdf', data: enc('%PDF-1.4 later'), actor });
    await (await getDb()).update(storedFiles).set({ scanStatus: 'infected', scanSignature: 'X' }).where(eq(storedFiles.id, meta.id));
    const r = await readStoredFile(meta.id);
    expect(r).toMatchObject({ blocked: true, meta: { id: meta.id, scanStatus: 'infected' } });
    expect(r && 'data' in r).toBe(false);
  });
});

describe('quarantine purge', () => {
  it('purges refused uploads after 30 days, never the notes of flagged stored files', async () => {
    const q = await listQuarantine();
    expect(q.some((e) => e.kind === 'refused-upload')).toBe(true);
    const later = new Date(Date.now() + 31 * 86_400_000);
    const refused = q.filter((e) => e.kind === 'refused-upload').length;
    expect(await purgeQuarantine(later)).toBe(refused);
    expect((await listQuarantine()).filter((e) => e.kind === 'refused-upload')).toEqual([]);
    expect(fs.readdirSync(path.join(dir, 'quarantine')).filter((n) => n.endsWith('.bin'))).toEqual([]);
  });
});
