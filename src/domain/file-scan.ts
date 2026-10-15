// Antivirus on the files Keystone stores (R-175, platform default — owner and IT to confirm) — the pure rules: the verdict
// of a clamd reply, which stored files the daily rescan reads, and which quarantine entries expire. The scanner, the
// quarantine folder and the job are in src/server/storage (scan.ts, quarantine.ts, rescan.ts).
//
// Defaults:
// - fail-closed: an upload is stored only when clamd answered "OK"; an infected file is refused (HTTP 422) and an unavailable
//   scanner refuses every upload (HTTP 503) — the uploader never sees the signature name;
// - a refused upload is kept 30 days in the quarantine folder (outside the files folder) for IT, then purged;
// - the daily rescan reads the files never scanned, the files stored in the last 30 days (newer signatures) and the files
//   already flagged (a false positive IT allows in clamd is released by the next rescan). A stored file a rescan flags is
//   blocked (downloads answer 410) and kept until IT acts: a false positive must never destroy a business record.

/** Antivirus verdict of a stored file. */
export type FileScanStatus = 'unscanned' | 'clean' | 'infected';

/** Stored files created within this many days are rescanned every day (signatures are updated meanwhile). */
export const RESCAN_WINDOW_DAYS = 30;
/** Quarantine copies of refused uploads are purged after this many days. */
export const QUARANTINE_RETENTION_DAYS = 30;
/** Most files one rescan run reads (the rest waits for the next run, oldest first). */
export const RESCAN_BATCH = 2000;

export type ClamdVerdict =
  | { status: 'clean' }
  | { status: 'infected'; signature: string }
  /** clamd answered with an error (including "INSTREAM size limit exceeded"): the file could not be checked. */
  | { status: 'error'; message: string };

/**
 * Verdict of a clamd INSTREAM reply ("stream: OK", "stream: Eicar-Test-Signature FOUND", "INSTREAM size limit exceeded.
 * ERROR"…). The reply is NUL-terminated in the 'z' command mode; anything unexpected is an error (fail-closed).
 */
export function parseClamdReply(reply: string): ClamdVerdict {
  const text = reply.replace(/\0+$/, '').trim();
  const body = text.replace(/^(?:\d+:\s*)?stream:\s*/, '');
  if (/^OK$/.test(body) && text !== body) return { status: 'clean' };
  const found = /^(.+?)\s+FOUND$/.exec(body);
  if (found && text !== body) return { status: 'infected', signature: found[1].slice(0, 200) };
  if (/ERROR$/.test(text)) return { status: 'error', message: text.slice(0, 200) };
  return { status: 'error', message: text ? `unexpected reply: ${text.slice(0, 120)}` : 'empty reply' };
}

export interface ScanCandidate {
  id: string;
  scanStatus: FileScanStatus;
  createdAt: Date;
}

/**
 * Files the daily rescan reads: never scanned, flagged (so a false positive allowed by IT is released), and stored within the
 * window. Never-scanned files first (oldest first), then flagged, then the recent clean ones; at most `limit`.
 */
export function filesToRescan<F extends ScanCandidate>(files: readonly F[], now: Date, windowDays = RESCAN_WINDOW_DAYS, limit = RESCAN_BATCH): F[] {
  const since = now.getTime() - windowDays * 86_400_000;
  const rank = (f: F) => (f.scanStatus === 'unscanned' ? 0 : f.scanStatus === 'infected' ? 1 : 2);
  return files
    .filter((f) => f.scanStatus !== 'clean' || f.createdAt.getTime() >= since)
    .sort((a, b) => rank(a) - rank(b) || a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, Math.max(0, limit));
}

/** What a quarantine entry holds: an upload refused at upload time (bytes kept), or a stored file a rescan flagged (note only). */
export type QuarantineKind = 'refused-upload' | 'flagged-stored-file';

export interface QuarantineEntry {
  /** Entry name (the sidecar's base name). */
  name: string;
  kind: QuarantineKind;
  at: Date;
}

/**
 * Quarantine entries to purge: refused uploads older than the retention. A stored file flagged by a rescan is never purged
 * here — its note stays until IT has dealt with the file.
 */
export function quarantineToPurge<E extends QuarantineEntry>(entries: readonly E[], now: Date, days = QUARANTINE_RETENTION_DAYS): E[] {
  const cutoff = now.getTime() - days * 86_400_000;
  return entries.filter((e) => e.kind === 'refused-upload' && e.at.getTime() < cutoff);
}
