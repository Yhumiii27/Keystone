// File storage (chapter 4): allowlists, size and content checks, store / read / stream / delete, orphans. Uses a temporary
// folder and an in-memory database — never ./.data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, acceptOf } from '@/domain/ch4-defaults';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import {
  FileRejectedError, ORPHAN_GRACE_MS, checkUpload, contentDisposition, deleteStoredFile, fileResponse, filesRoot, getStoredFile, listStoredFiles, pruneOrphanFiles, readStoredFile,
  readFormDataCapped, readStoredText, safeFileName, setFileOwner, setFilesRoot, storeFile, storeUploadedFile, streamStoredFile,
} from './files';

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const actor = { name: 'Marie Lefebvre' };
let dir = '';

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-files-'));
  setFilesRoot(dir);
  setDb(await openDatabase());
}, 60_000);
afterAll(() => {
  setFilesRoot(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('checks', () => {
  it('sanitises names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\temp\\Plan "v2".pdf')).toBe('Plan v2.pdf');
    expect(safeFileName('   ')).toBe('file');
    expect(safeFileName('a'.repeat(300) + '.pdf')).toHaveLength(180);
  });
  it('size, type and content per purpose', () => {
    expect(checkUpload('attachment', 'Report.PDF', 10, PDF)).toEqual({ ext: 'pdf', mime: 'application/pdf', name: 'Report.PDF' });
    expect(() => checkUpload('attachment', 'a.pdf', 0)).toThrow(FileRejectedError);
    expect(() => checkUpload('attachment', 'a.pdf', MAX_FILE_BYTES + 1)).toThrow('The file is larger than 20 MB');
    expect(() => checkUpload('attachment', 'run.exe', 10)).toThrow('File type not accepted');
    expect(() => checkUpload('transcript', 'notes.pdf', 10)).toThrow('File type not accepted');
    expect(() => checkUpload('attachment', 'fake.pdf', 4, new Uint8Array([1, 2, 3, 4]))).toThrow('The file content does not match its extension');
    expect(() => checkUpload('transcript', 'call.vtt', 4, new Uint8Array([0x57, 0, 0x45, 0x42]))).toThrow(FileRejectedError);
    expect(checkUpload('import', 'plan.xer', 3, new TextEncoder().encode('ERM')).mime).toBe('text/plain');
    expect(acceptOf('transcript')).toBe('.txt,.vtt,.srt');
  });
  it('content disposition carries an ASCII fallback and the UTF-8 name', () => {
    expect(contentDisposition('Réception "BL" 2026.pdf')).toBe(`attachment; filename="Reception BL 2026.pdf"; filename*=UTF-8''R%C3%A9ception%20BL%202026.pdf`);
  });
});

describe('store, read, delete', () => {
  it('stores under the files root and records the metadata', async () => {
    const f = await storeFile({ purpose: 'attachment', name: 'Spec.pdf', data: PDF, ownerType: 'task_attachment', actor });
    expect(f).toMatchObject({ purpose: 'attachment', name: 'Spec.pdf', mime: 'application/pdf', sizeBytes: PDF.byteLength, createdByName: 'Marie Lefebvre' });
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(filesRoot()).toBe(dir);
    const back = await readStoredFile(f.id);
    expect(Buffer.from(back!.data).equals(Buffer.from(PDF))).toBe(true);
    const files = fs.readdirSync(dir, { recursive: true }).map(String).filter((p) => p.endsWith('.pdf'));
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain('Spec');
    await setFileOwner(f.id, { ownerType: 'task_attachment', ownerId: '00000000-0000-4000-8000-000000000001' });
    expect((await listStoredFiles('task_attachment', '00000000-0000-4000-8000-000000000001')).map((x) => x.id)).toEqual([f.id]);
    const s = await streamStoredFile(f.id);
    const chunks: Uint8Array[] = [];
    for await (const c of s!.stream as unknown as AsyncIterable<Uint8Array>) chunks.push(c);
    expect(Buffer.concat(chunks).length).toBe(PDF.byteLength);
    const res = fileResponse(f, back!.data as BodyInit);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('filename="Spec.pdf"');
    expect(await deleteStoredFile(f.id)).toBe(true);
    expect(await getStoredFile(f.id)).toBeNull();
    expect(await readStoredFile(f.id)).toBeNull();
    expect(fs.readdirSync(dir, { recursive: true }).map(String).filter((p) => p.endsWith('.pdf'))).toHaveLength(0);
  });

  it('stores an uploaded File and reads text without its BOM', async () => {
    const file = new File(['\uFEFFWEBVTT\n\n00:00.000 --> 00:02.000\n<v Romain>On valide le planning.'], 'Réunion.vtt', { type: 'text/vtt' });
    const f = await storeUploadedFile(file, { purpose: 'transcript', actor });
    expect(f.name).toBe('Réunion.vtt');
    expect((await readStoredText(f.id))!.text.startsWith('WEBVTT')).toBe(true);
  });

  it('refuses before writing anything', async () => {
    const before = fs.readdirSync(dir, { recursive: true }).length;
    await expect(storeFile({ purpose: 'import', name: 'macro.xlsm', data: PDF, actor })).rejects.toBeInstanceOf(FileRejectedError);
    expect(fs.readdirSync(dir, { recursive: true }).length).toBe(before);
    expect(await getStoredFile('not-a-uuid')).toBeNull();
  });

  it('prunes files without a record once they are older than the grace period (R-010)', async () => {
    fs.mkdirSync(path.join(dir, '2026', '10'), { recursive: true });
    fs.writeFileSync(path.join(dir, '2026', '10', 'orphan.txt'), 'x');
    // Just written: its transaction may not have committed yet — kept.
    expect(await pruneOrphanFiles()).toBe(0);
    expect(fs.existsSync(path.join(dir, '2026', '10', 'orphan.txt'))).toBe(true);
    expect(await pruneOrphanFiles({ now: Date.now() + ORPHAN_GRACE_MS + 1000 })).toBe(1);
    expect(fs.existsSync(path.join(dir, '2026', '10', 'orphan.txt'))).toBe(false);
  });
});

describe('readFormDataCapped (security review: chunked uploads)', () => {
  const chunked = (parts: Uint8Array[], type: string) =>
    new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': type },
      body: new ReadableStream<Uint8Array>({ pull(c) { const p = parts.shift(); if (p) c.enqueue(p); else c.close(); } }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

  it('parses a form under the cap and refuses a body without Content-Length as soon as it exceeds it', async () => {
    const form = new FormData();
    form.set('file', new File([PDF], 'a.pdf', { type: 'application/pdf' }));
    const multipart = new Response(form);
    const body = new Uint8Array(await multipart.arrayBuffer());
    const type = multipart.headers.get('content-type')!;
    const ok = await readFormDataCapped(chunked([body.slice(0, 50), body.slice(50)], type), body.byteLength);
    expect((ok!.get('file') as File).size).toBe(PDF.byteLength);
    let pulled = 0;
    const big = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': type },
      body: new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024 * 1024)); } }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    expect(await readFormDataCapped(big, 3 * 1024 * 1024)).toBeNull();
    expect(pulled).toBeLessThan(8);
    const declared = new Request('http://localhost/upload', { method: 'POST', headers: { 'content-type': type, 'content-length': String(10 ** 9) }, body });
    expect(await readFormDataCapped(declared, 1024)).toBeNull();
  });
});
