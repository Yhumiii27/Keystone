import 'server-only';
// Daily antivirus rescan of the stored files (R-175, job "files-rescan"): the files never scanned (stored while scanning was
// off, or before R-175), the files flagged earlier and those stored in the last RESCAN_WINDOW_DAYS days are read again with
// the current signatures (src/domain/file-scan.ts `filesToRescan`). A file newly flagged is blocked (scan_status 'infected':
// downloads answer 410), noted in the quarantine folder, logged and audited — and KEPT until IT acts, since a false positive
// must not destroy a business record. A flagged file clamd now passes (IT allowed the signature) is released the same way.
// Each file's status change and its audit row are one transaction (a failed audit leaves the status for the next run).
// The run also purges the quarantine copies of uploads refused more than QUARANTINE_RETENTION_DAYS ago.
// Scanning off: nothing is read (the purge still runs). clamd unavailable: the run stops and reports it (a warning).
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { filesToRescan } from '@/domain/file-scan';
import { getConfig } from '@/server/config';
import { getDb } from '@/server/db/client';
import { writeAudit } from '@/server/db/helpers';
import { storedFiles } from '@/server/db/schema';
import { log } from '@/server/log';
import { filesRoot } from './files';
import { purgeQuarantine, quarantineFlaggedFile } from './quarantine';
import { clamdScan } from './scan';

export interface RescanOutcome {
  /** 'off': scanning is off; 'stopped': clamd stopped answering during the run. */
  state: 'done' | 'off' | 'stopped';
  scanned: number;
  clean: number;
  flagged: number;
  released: number;
  missing: number;
  purged: number;
}

const SYSTEM_ACTOR = 'Keystone antivirus';

/** One rescan run (see the header). */
export async function rescanStoredFiles(now = new Date()): Promise<RescanOutcome> {
  const out: RescanOutcome = { state: 'done', scanned: 0, clean: 0, flagged: 0, released: 0, missing: 0, purged: 0 };
  out.purged = await purgeQuarantine(now);
  const cfg = getConfig().fileScan;
  if (cfg.mode !== 'clamav' || !cfg.clamd) return { ...out, state: 'off' };
  const db = await getDb();
  const rows = await db
    .select({ id: storedFiles.id, scanStatus: storedFiles.scanStatus, createdAt: storedFiles.createdAt, storagePath: storedFiles.storagePath })
    .from(storedFiles);
  const root = path.resolve(/*turbopackIgnore: true*/ filesRoot());
  for (const f of filesToRescan(rows, now)) {
    const abs = path.resolve(/*turbopackIgnore: true*/ root, f.storagePath);
    if (!abs.startsWith(root + path.sep)) continue;
    let data: Buffer;
    try {
      data = await fs.readFile(abs);
    } catch {
      out.missing++;
      continue;
    }
    const v = await clamdScan(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), cfg.clamd);
    if (v.status === 'unavailable') {
      log.error('Antivirus unavailable: rescan stopped', { component: 'files', reason: v.message, scanned: out.scanned });
      return { ...out, state: 'stopped' };
    }
    out.scanned++;
    // Clean or infected (an error reply from clamd is 'unavailable' above: fail-closed, the file keeps its status).
    const verdict = v.status === 'clean' ? { scanStatus: 'clean' as const, signature: null } : { scanStatus: 'infected' as const, signature: v.signature };
    // The status change and its audit row commit together (R-168): when the audit write fails, the file keeps its previous
    // status, so the next run sees the change again and audits it. The quarantine note and the logs come after the commit.
    const res = await db.transaction(async (tx) => {
      const [cur] = await tx.select().from(storedFiles).where(eq(storedFiles.id, f.id)).for('update');
      if (!cur) return null; // deleted meanwhile
      await tx.update(storedFiles).set({ scanStatus: verdict.scanStatus, scannedAt: new Date(), scanSignature: verdict.signature }).where(eq(storedFiles.id, f.id));
      const released = verdict.scanStatus === 'clean' && cur.scanStatus === 'infected';
      const newlyFlagged = verdict.scanStatus === 'infected' && cur.scanStatus !== 'infected';
      if (released) await writeAudit(tx, { actorName: SYSTEM_ACTOR, objectRef: cur.name, change: `file released by the antivirus rescan: ${cur.name}`, area: 'Files', entityType: 'file', entityId: cur.id, projectId: cur.projectId });
      if (newlyFlagged) await writeAudit(tx, { actorName: SYSTEM_ACTOR, objectRef: cur.name, change: `file blocked by the antivirus: ${cur.name}`, area: 'Files', entityType: 'file', entityId: cur.id, projectId: cur.projectId });
      return { cur, released, newlyFlagged };
    });
    if (!res) continue;
    const { cur } = res;
    if (verdict.scanStatus === 'clean') {
      out.clean++;
      if (res.released) {
        out.released++;
        log.warn('Stored file released by the antivirus rescan', { component: 'files', file: f.id, previous: cur.scanSignature });
      }
      continue;
    }
    if (!res.newlyFlagged) continue;
    out.flagged++;
    const signature = verdict.signature;
    const note = await quarantineFlaggedFile({ id: cur.id, purpose: cur.purpose, name: cur.name, sizeBytes: cur.sizeBytes, sha256: cur.sha256, storagePath: cur.storagePath, signature }).catch((e) => {
      log.error('Quarantine note failed', { component: 'files', file: cur.id, err: e });
      return null;
    });
    log.warn('Stored file blocked by the antivirus rescan', { component: 'files', file: cur.id, purpose: cur.purpose, signature, quarantine: note });
  }
  return out;
}
