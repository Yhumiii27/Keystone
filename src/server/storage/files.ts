import 'server-only';
// File storage of Keystone (chapter 4): task attachments, meeting transcripts and imported files are stored by Keystone —
// not by Codex — under <data dir>/files, where <data dir> is KEYSTONE_DATA_DIR or ./.data (the database's folder). The
// `stored_files` table holds the metadata; the bytes live in `<root>/<yyyy>/<mm>/<uuid>.<ext>` (never the uploaded name).
//
// Checks on every upload: size (MAX_FILE_BYTES, 20 MB), non-empty, extension allowlist per purpose (FILE_EXTENSIONS) and a
// content sniff (PDF / image / Office / ZIP signatures; text files must not contain NUL bytes). Callers check the viewer's
// rights before storing, reading or deleting (the storage layer does not know who may see a task or a meeting).
// Antivirus (R-175, ./scan.ts): the upload paths scan the bytes before their transaction and pass the marked bytes here;
// storeFile records the verdict, and refuses unchecked bytes while scanning is on. A stored file a rescan flagged is blocked:
// readStoredFile / streamStoredFile return { blocked: true } (the download routes answer 410), never its bytes.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { and, asc, eq } from 'drizzle-orm';
import { FILE_EXTENSIONS, MAX_FILE_BYTES, MAX_FILE_TEXT } from '@/domain/ch4-defaults';
import { getConfig } from '@/server/config';
import { getDb, type DB, type Tx } from '@/server/db/client';
import type { StoredFilePurpose } from '@/server/db/codes';
import { orphanFilesToPrune } from '@/domain/jobs';
import type { FileScanStatus } from '@/domain/file-scan';
import { storedFiles } from '@/server/db/schema';
import { FileRejectedError } from './file-errors';
import { scanMarkOf } from './scan-mark';

export { FileRejectedError, uploadRefusalStatus } from './file-errors';

type Q = DB | Tx;

/** Metadata of a stored file. */
export interface StoredFileMeta {
  id: string;
  purpose: StoredFilePurpose;
  name: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  projectId: string | null;
  ownerType: string | null;
  ownerId: string | null;
  createdByName: string;
  createdByPersonId: string | null;
  createdAt: Date;
  /** Antivirus verdict (R-175); 'infected' files are blocked. */
  scanStatus: FileScanStatus;
}

/** A stored file the antivirus flagged (R-175): its record, never its bytes — the download routes answer 410. */
export interface BlockedStoredFile {
  blocked: true;
  meta: StoredFileMeta;
}

// ── Root folder ───────────────────────────────────────────────────────────────────────────────────────────────────────
const g = globalThis as unknown as { __ksFilesRoot?: string | null };

/** <KEYSTONE_DATA_DIR or ./.data>/files (or the folder set by setFilesRoot). */
export function filesRoot(): string {
  if (g.__ksFilesRoot) return g.__ksFilesRoot;
  // turbopackIgnore: the folder is chosen at run time (data dir, src/server/config), it is not part of the build output.
  return path.join(/*turbopackIgnore: true*/ getConfig().dataDir, 'files');
}

/** Points the storage at another folder (tests and scripts use a temporary directory); null restores the default. */
export function setFilesRoot(dir: string | null): void {
  g.__ksFilesRoot = dir;
}

// ── Types and checks ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Canonical MIME type per extension. */
export const MIME_OF_EXT: Readonly<Record<string, string>> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  txt: 'text/plain', csv: 'text/csv', vtt: 'text/vtt', srt: 'application/x-subrip', xml: 'application/xml', xer: 'text/plain',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', dwg: 'image/vnd.dwg', dxf: 'image/vnd.dxf',
  zip: 'application/zip', msg: 'application/vnd.ms-outlook', eml: 'message/rfc822',
};
const TEXT_EXT = new Set(['txt', 'csv', 'vtt', 'srt', 'xml', 'xer', 'eml', 'dxf']);
const ZIP_EXT = new Set(['xlsx', 'docx', 'pptx', 'zip']);
const OLE_EXT = new Set(['xls', 'doc', 'msg']);

/** Lower-case extension of a file name ('' when none). */
export const extensionOf = (name: string) => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
};

/** File name safe to store and to send back in Content-Disposition (no path, no control characters, ≤ 180 chars). */
export function safeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').replace(/\s+/g, ' ').trim();
  if (!base || base === '.' || base === '..') return 'file';
  if (base.length <= 180) return base;
  const ext = extensionOf(base);
  return base.slice(0, 180 - ext.length - 1) + (ext ? '.' + ext : '');
}

function startsWith(data: Uint8Array, sig: number[], offset = 0): boolean {
  if (data.length < offset + sig.length) return false;
  return sig.every((b, i) => data[offset + i] === b);
}

/** Does the content match the extension? (signatures for binary formats; no NUL byte in the first 8 KB of text formats) */
export function contentMatches(ext: string, data: Uint8Array): boolean {
  if (TEXT_EXT.has(ext)) return !data.subarray(0, 8192).includes(0);
  if (ext === 'pdf') return startsWith(data, [0x25, 0x50, 0x44, 0x46]);
  if (ext === 'png') return startsWith(data, [0x89, 0x50, 0x4e, 0x47]);
  if (ext === 'jpg' || ext === 'jpeg') return startsWith(data, [0xff, 0xd8, 0xff]);
  if (ext === 'gif') return startsWith(data, [0x47, 0x49, 0x46, 0x38]);
  if (ext === 'webp') return startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8);
  if (ZIP_EXT.has(ext)) return startsWith(data, [0x50, 0x4b, 0x03, 0x04]) || startsWith(data, [0x50, 0x4b, 0x05, 0x06]);
  if (OLE_EXT.has(ext)) return startsWith(data, [0xd0, 0xcf, 0x11, 0xe0]);
  if (ext === 'dwg') return startsWith(data, [0x41, 0x43]); // "AC10xx"
  return true;
}

/**
 * Validates an upload for a purpose and returns its extension and canonical MIME type. Throws FileRejectedError.
 * Exposed so Server Functions can refuse early (before reading the bytes) on size and type.
 */
export function checkUpload(purpose: StoredFilePurpose, name: string, size: number, data?: Uint8Array): { ext: string; mime: string; name: string } {
  const clean = safeFileName(name);
  const ext = extensionOf(clean);
  if (!(size > 0)) throw new FileRejectedError('empty', 'The file is empty');
  if (size > MAX_FILE_BYTES) throw new FileRejectedError('too_large', `The file is larger than ${MAX_FILE_TEXT}`); // "The file is larger than 20 MB"
  const allowed = FILE_EXTENSIONS[purpose];
  if (!ext || !allowed.includes(ext)) throw new FileRejectedError('type', 'File type not accepted');
  if (data && !contentMatches(ext, data)) throw new FileRejectedError('content', 'The file content does not match its extension');
  return { ext, mime: MIME_OF_EXT[ext] ?? 'application/octet-stream', name: clean };
}

// ── Store / read / delete ─────────────────────────────────────────────────────────────────────────────────────────────
export interface StoreFileInput {
  purpose: StoredFilePurpose;
  /** Uploaded file name. */
  name: string;
  data: Uint8Array | ArrayBuffer;
  projectId?: string | null;
  ownerType?: string | null;
  ownerId?: string | null;
  actor: { name: string; personId?: string | null };
  /** When the file was stored (default: now) — a seed dates the files it stores (L9-X3: the demo's filed shipping documents). */
  at?: Date;
}

const toMeta = (r: typeof storedFiles.$inferSelect): StoredFileMeta => ({
  id: r.id, purpose: r.purpose, name: r.name, mime: r.mime, sizeBytes: r.sizeBytes, sha256: r.sha256, projectId: r.projectId, ownerType: r.ownerType,
  ownerId: r.ownerId, createdByName: r.createdByName, createdByPersonId: r.createdByPersonId, createdAt: r.createdAt, scanStatus: r.scanStatus,
});

/**
 * Checks and stores a file, then records it. Pass the writer's transaction as `q` to record it atomically with the owner;
 * if that transaction rolls back, the bytes stay on disk until `pruneOrphanFiles()`. With the antivirus on (R-175) the
 * bytes must be the Uint8Array `scanUpload` returned (scanned before the transaction); its verdict is recorded.
 */
export async function storeFile(input: StoreFileInput, q?: Q): Promise<StoredFileMeta> {
  const data = input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data);
  const mark = scanMarkOf(data);
  // Fail-closed: a new upload path that forgot the scan stores nothing while the antivirus is on.
  if (!mark && getConfig().fileScan.mode === 'clamav') throw new Error('storeFile: the bytes were not checked by the antivirus (call scanUpload first)');
  const { ext, mime, name } = checkUpload(input.purpose, input.name, data.byteLength, data);
  const id = randomUUID();
  const now = input.at ?? new Date();
  const rel = path.posix.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), `${id}.${ext}`);
  const abs = path.join(/*turbopackIgnore: true*/ filesRoot(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.part`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, abs);
  const sha256 = createHash('sha256').update(data).digest('hex');
  try {
    const db = q ?? (await getDb());
    const [row] = await db
      .insert(storedFiles)
      .values({
        id, purpose: input.purpose, name, mime, sizeBytes: data.byteLength, sha256, storagePath: rel, projectId: input.projectId ?? null,
        ownerType: input.ownerType ?? null, ownerId: input.ownerId ?? null, createdByName: input.actor.name, createdByPersonId: input.actor.personId ?? null, createdAt: now,
        scanStatus: mark?.status ?? 'unscanned', scannedAt: mark?.at ?? null,
      })
      .returning();
    return toMeta(row);
  } catch (e) {
    await fs.rm(abs, { force: true });
    throw e;
  }
}

/** Metadata of a stored file, or null. */
export async function getStoredFile(id: string, q?: Q): Promise<StoredFileMeta | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = q ?? (await getDb());
  const [r] = await db.select().from(storedFiles).where(eq(storedFiles.id, id));
  return r ? toMeta(r) : null;
}

async function absPathOf(id: string, q?: Q): Promise<{ meta: StoredFileMeta; abs: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = q ?? (await getDb());
  const [r] = await db.select().from(storedFiles).where(eq(storedFiles.id, id));
  if (!r) return null;
  const root = filesRoot();
  const abs = path.resolve(/*turbopackIgnore: true*/ root, r.storagePath);
  if (!abs.startsWith(path.resolve(/*turbopackIgnore: true*/ root) + path.sep)) return null;
  return { meta: toMeta(r), abs };
}

/** Bytes and metadata of a stored file; `{ blocked: true }` when the antivirus flagged it (R-175); null when unknown or missing on disk. */
export async function readStoredFile(id: string, q?: Q): Promise<{ blocked?: false; meta: StoredFileMeta; data: Buffer } | BlockedStoredFile | null> {
  const f = await absPathOf(id, q);
  if (!f) return null;
  if (f.meta.scanStatus === 'infected') return { blocked: true, meta: f.meta };
  try {
    return { meta: f.meta, data: await fs.readFile(f.abs) };
  } catch {
    return null;
  }
}

/** Text content of a stored text file (transcripts, CSV, XML, XER), UTF-8 with the BOM removed; `{ blocked: true }` when flagged. */
export async function readStoredText(id: string, q?: Q): Promise<{ blocked?: false; meta: StoredFileMeta; text: string } | BlockedStoredFile | null> {
  const f = await readStoredFile(id, q);
  if (!f || f.blocked) return f;
  return { meta: f.meta, text: f.data.toString('utf8').replace(/^\uFEFF/, '') };
}

/** Streams a stored file (large downloads); `{ blocked: true }` when the antivirus flagged it (R-175). */
export async function streamStoredFile(id: string, q?: Q): Promise<{ blocked?: false; meta: StoredFileMeta; stream: ReadableStream<Uint8Array> } | BlockedStoredFile | null> {
  const f = await absPathOf(id, q);
  if (!f) return null;
  if (f.meta.scanStatus === 'infected') return { blocked: true, meta: f.meta };
  try {
    await fs.access(f.abs);
  } catch {
    return null;
  }
  return { meta: f.meta, stream: Readable.toWeb(createReadStream(f.abs)) as ReadableStream<Uint8Array> };
}

/** Sets what a file belongs to (e.g. after the owner row is created). */
export async function setFileOwner(id: string, owner: { ownerType: string; ownerId: string; projectId?: string | null }, q?: Q): Promise<void> {
  const db = q ?? (await getDb());
  await db
    .update(storedFiles)
    .set({ ownerType: owner.ownerType, ownerId: owner.ownerId, ...(owner.projectId !== undefined ? { projectId: owner.projectId } : {}) })
    .where(eq(storedFiles.id, id));
}

/** Files attached to an owner, oldest first. */
export async function listStoredFiles(ownerType: string, ownerId: string, q?: Q): Promise<StoredFileMeta[]> {
  const db = q ?? (await getDb());
  const rows = await db.select().from(storedFiles).where(and(eq(storedFiles.ownerType, ownerType), eq(storedFiles.ownerId, ownerId))).orderBy(asc(storedFiles.createdAt));
  return rows.map(toMeta);
}

/** Deletes the record and the bytes (a missing file on disk is not an error). */
export async function deleteStoredFile(id: string, q?: Q): Promise<boolean> {
  const f = await absPathOf(id, q);
  if (!f) return false;
  const db = q ?? (await getDb());
  await db.delete(storedFiles).where(eq(storedFiles.id, id));
  await fs.rm(f.abs, { force: true });
  return true;
}

/**
 * A file younger than this is never pruned (R-010): storeFile writes the bytes before the transaction recording them commits,
 * so a file just written may not be visible yet to the prune's read.
 */
export const ORPHAN_GRACE_MS = 60 * 60_000;

/**
 * Removes files on disk that no stored_files row references (left by rolled-back transactions). Returns their count.
 * `graceMs` (R-006 worker job "orphan-files-prune": 24 h) spares recent files, never less than ORPHAN_GRACE_MS: an upload
 * writes its bytes before its record is committed, so a file younger than that may still be on its way. The records are read
 * after the files are listed, so a record committed meanwhile protects its file.
 */
export async function pruneOrphanFiles(opts: { graceMs?: number; now?: number } = {}): Promise<number> {
  const root = filesRoot();
  const now = opts.now ?? Date.now();
  const files: { rel: string; abs: string; mtimeMs: number }[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(/*turbopackIgnore: true*/ dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile()) {
        const st = await fs.stat(abs).catch(() => null);
        if (st) files.push({ rel: path.relative(root, abs).split(path.sep).join('/'), abs, mtimeMs: st.mtimeMs });
      }
    }
  };
  await walk(root);
  const db = await getDb();
  const known = new Set((await db.select({ p: storedFiles.storagePath }).from(storedFiles)).map((r) => r.p));
  let removed = 0;
  for (const f of orphanFilesToPrune(files, known, now, Math.max(opts.graceMs ?? 0, ORPHAN_GRACE_MS))) {
    await fs.rm(f.abs, { force: true });
    removed++;
  }
  return removed;
}

/** HTTP response serving a file (attachment by default; `inline` for PDFs and images shown in the browser). */
/**
 * Multipart body of an upload request read with a byte cap: `request.formData()` alone buffers the whole body, and a chunked
 * request has no Content-Length to check first. Returns null as soon as the body exceeds `maxBytes` (the stream is
 * cancelled), else the parsed form. Throws on a malformed body, like `formData()`.
 */
export async function readFormDataCapped(request: Request, maxBytes: number): Promise<FormData | null> {
  const declared = Number(request.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return request.formData();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.byteLength;
  }
  return new Response(body, { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData();
}

export function fileResponse(meta: Pick<StoredFileMeta, 'name' | 'mime' | 'sizeBytes'>, body: BodyInit, opts: { inline?: boolean } = {}): Response {
  return new Response(body, {
    headers: {
      'Content-Type': meta.mime,
      'Content-Length': String(meta.sizeBytes),
      'Content-Disposition': contentDisposition(meta.name, opts.inline ? 'inline' : 'attachment'),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

/** RFC 6266 Content-Disposition with an ASCII fallback and the UTF-8 name. */
export function contentDisposition(name: string, type: 'attachment' | 'inline' = 'attachment'): string {
  const clean = safeFileName(name);
  const ascii = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}
