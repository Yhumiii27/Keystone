import 'server-only';
// Antivirus check of uploaded files (R-175, platform default — owner and IT to confirm). KEYSTONE_FILE_SCAN chooses the
// adapter (src/server/config): 'off' (default outside production) or 'clamav', a clamd service reached over TCP
// (CLAMAV_HOST + CLAMAV_PORT) or a unix socket (CLAMAV_SOCKET) with node:net — no new dependency.
//
// Protocol (clamd INSTREAM in 'z' mode): "zINSTREAM\0", then the bytes in chunks each preceded by its length as a 4-byte
// big-endian integer, then a zero length; clamd answers one NUL-terminated line — "stream: OK", "stream: <signature> FOUND"
// or "<message> ERROR" (src/domain/file-scan.ts parses it). clamd may answer "INSTREAM size limit exceeded. ERROR" and
// close the connection while Keystone is still writing: the write error (EPIPE / ECONNRESET) is ignored when a reply was
// read, and the reply decides. Connect timeout 5 s, scan timeout 30 s.
//
// Fail-closed: every upload path calls `scanUpload` BEFORE its transaction (task attachments, photos, meeting transcripts,
// imports). It returns the bytes as one Uint8Array marked as checked; `storeFile` (./files.ts) records the verdict and,
// while scanning is on, refuses bytes that were not checked — the mark is kept in a WeakMap on that very Uint8Array (a mark
// on an ArrayBuffer the caller passed would be lost, since storeFile wraps it in a new view). Verdicts:
//   clean → stored with scan_status 'clean';
//   infected → FileRejectedError('infected'): a quarantine copy and its .json note (./quarantine.ts), a warning log line with
//     the signature, an audit entry (area "Files") — the uploader gets a generic message, never the signature;
//   scanner unavailable or in error → FileRejectedError('scan_unavailable'): nothing stored, an error log line IT can alert on.
import net from 'node:net';
import { parseClamdReply, type ClamdVerdict } from '@/domain/file-scan';
import { getConfig, type ClamdTarget } from '@/server/config';
import { getDb } from '@/server/db/client';
import type { StoredFilePurpose } from '@/server/db/codes';
import { writeAudit } from '@/server/db/helpers';
import { log } from '@/server/log';
import { FileRejectedError } from './file-errors';
import { safeFileName } from './files';
import { quarantineUpload } from './quarantine';
import { markScanned } from './scan-mark';

export const CLAMD_TIMEOUTS = { connectMs: 5_000, scanMs: 30_000 } as const;
/** Bytes per INSTREAM chunk (clamd's StreamMaxLength applies to the total, not to a chunk). */
const CHUNK = 64 * 1024;

/** EN source messages of the refusals (French in src/i18n/extra/d8-platform-ops.json). */
export const SCAN_MESSAGES = {
  infected: 'The file was refused by the antivirus',
  unavailable: 'The antivirus check is unavailable, try again later',
  blocked: 'This file was blocked by the antivirus',
} as const;

/** clamd's verdict, or 'unavailable' (connection, timeout, or an error reply such as the size limit: fail-closed). */
export type ScanResult = Exclude<ClamdVerdict, { status: 'error' }> | { status: 'unavailable'; message: string };

/** Scans bytes with clamd. Never throws: a connection problem, a timeout or a protocol error is 'unavailable'. */
export function clamdScan(data: Uint8Array, target: ClamdTarget, timeouts: { connectMs: number; scanMs: number } = CLAMD_TIMEOUTS): Promise<ScanResult> {
  return new Promise<ScanResult>((resolve) => {
    let settled = false;
    let reply = '';
    const socket = 'socket' in target ? net.createConnection({ path: target.socket }) : net.createConnection({ host: target.host, port: target.port });
    let timer: ReturnType<typeof setTimeout> = setTimeout(() => finish({ status: 'unavailable', message: 'connect timeout' }), timeouts.connectMs);
    function finish(r: ScanResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(r);
    }
    const fromReply = (): ScanResult => {
      const v = parseClamdReply(reply);
      return v.status === 'error' ? { status: 'unavailable', message: v.message } : v;
    };
    socket.on('connect', () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish({ status: 'unavailable', message: 'scan timeout' }), timeouts.scanMs);
      socket.write('zINSTREAM\0');
      for (let at = 0; at < data.byteLength && !socket.destroyed; at += CHUNK) {
        const chunk = data.subarray(at, Math.min(at + CHUNK, data.byteLength));
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.byteLength, 0);
        socket.write(len);
        socket.write(chunk);
      }
      if (!socket.destroyed) socket.write(Buffer.alloc(4));
    });
    socket.on('data', (b: Buffer) => {
      reply += b.toString('utf8');
      if (reply.includes('\0')) finish(fromReply());
    });
    // A reply without the trailing NUL (clamd closed the connection after it) still decides.
    const closed = () => finish(reply ? fromReply() : { status: 'unavailable', message: 'connection closed without a reply' });
    socket.on('end', closed);
    socket.on('close', closed);
    socket.on('error', (e: NodeJS.ErrnoException) => {
      // EPIPE / ECONNRESET while writing after clamd answered (size limit): the reply read so far decides.
      if (reply) return finish(fromReply());
      finish({ status: 'unavailable', message: e.code ?? e.message });
    });
  });
}

/** Is clamd answering? (zPING → PONG) — for the health report; never throws. */
export function clamdPing(target: ClamdTarget, timeoutMs = 2_000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let reply = '';
    const socket = 'socket' in target ? net.createConnection({ path: target.socket }) : net.createConnection({ host: target.host, port: target.port });
    const done = (ok: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.on('connect', () => socket.write('zPING\0'));
    socket.on('data', (b: Buffer) => {
      reply += b.toString('utf8');
      if (reply.includes('\0')) done(reply.replace(/\0+$/, '').trim() === 'PONG');
    });
    socket.on('error', () => done(false));
    socket.on('close', () => done(reply.replace(/\0+$/, '').trim() === 'PONG'));
  });
}

export interface ScanUploadContext {
  purpose: StoredFilePurpose;
  /** Uploaded file name (sanitised by the caller or here). */
  name: string;
  actor: { name: string; personId?: string | null };
  /** What the upload was for, for the audit entry and the quarantine note: "T-2318", "Photo · DR-003", "MTG-129", "Import". */
  objectRef: string;
  projectId?: string | null;
}

/**
 * Checks uploaded bytes before they are stored (see the header). Returns them as ONE Uint8Array carrying the verdict mark —
 * pass that very object to storeFile. Throws FileRejectedError('infected' | 'scan_unavailable').
 */
export async function scanUpload(input: Uint8Array | ArrayBuffer, ctx: ScanUploadContext): Promise<Uint8Array> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const cfg = getConfig().fileScan;
  if (cfg.mode !== 'clamav' || !cfg.clamd) return markScanned(bytes, { status: 'unscanned', at: null });
  const name = safeFileName(ctx.name);
  const started = Date.now();
  const verdict = await clamdScan(bytes, cfg.clamd);
  const fields = { component: 'files', purpose: ctx.purpose, object: ctx.objectRef, bytes: bytes.byteLength, durationMs: Date.now() - started };
  if (verdict.status === 'clean') return markScanned(bytes, { status: 'clean', at: new Date() });
  if (verdict.status === 'infected') {
    const entry = await quarantineUpload(bytes, { ...ctx, name, signature: verdict.signature }).catch((e) => {
      log.error('Quarantine copy failed', { ...fields, err: e });
      return null;
    });
    log.warn('Upload refused by the antivirus', { ...fields, signature: verdict.signature, quarantine: entry });
    try {
      const db = await getDb();
      await writeAudit(db, {
        actorName: ctx.actor.name, actorPersonId: ctx.actor.personId ?? null, objectRef: ctx.objectRef, change: `upload refused by the antivirus: ${name}`,
        area: 'Files', entityType: 'file', projectId: ctx.projectId ?? null,
      });
    } catch (e) {
      log.error('Audit of a refused upload failed', { ...fields, err: e });
    }
    throw new FileRejectedError('infected', SCAN_MESSAGES.infected);
  }
  log.error('Antivirus unavailable: upload refused', { ...fields, reason: verdict.message });
  throw new FileRejectedError('scan_unavailable', SCAN_MESSAGES.unavailable);
}
