import 'server-only';
// Daily antivirus rescan of the stored files (R-175, job "files-rescan"): the files never scanned (stored while scanning was
// off, or before R-175), the files flagged earlier and those stored in the last RESCAN_WINDOW_DAYS days are read again with
// the current signatures (src/domain/file-scan.ts `filesToRescan`). A file newly flagged is blocked (scan_status 'infected':
// downloads answer 410), noted in the quarantine folder, logged and audited — and KEPT until IT acts, since a false positive
// must not destroy a business record. A flagged file clamd now passes (IT allowed the signature) is released the same way.
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
    const [cur] = await db.select().from(storedFiles).where(eq(storedFiles.id, f.id));
    if (!cur) continue; // deleted meanwhile
    if (v.status === 'clean') {
      out.clean++;
      await db.update(storedFiles).set({ scanStatus: 'clean', scannedAt: new Date(), scanSignature: null }).where(eq(storedFiles.id, f.id));
      if (cur.scanStatus === 'infected') {
        out.released++;
        log.warn('Stored file released by the antivirus rescan', { component: 'files', file: f.id, previous: cur.scanSignature });
        await writeAudit(db, { actorName: SYSTEM_ACTOR, objectRef: cur.name, change: `file released by the antivirus rescan: ${cur.name}`, area: 'Files', entityType: 'file', entityId: cur.id, projectId: cur.projectId });
      }
      continue;
    }
    // Infected (an error reply from clamd is 'unavailable' above: fail-closed, the file keeps its status).
    const signature = v.signature;
    const newlyFlagged = cur.scanStatus !== 'infected';
    await db.update(storedFiles).set({ scanStatus: 'infected', scannedAt: new Date(), scanSignature: signature }).where(eq(storedFiles.id, f.id));
    if (!newlyFlagged) continue;
    out.flagged++;
    const note = await quarantineFlaggedFile({ id: cur.id, purpose: cur.purpose, name: cur.name, sizeBytes: cur.sizeBytes, sha256: cur.sha256, storagePath: cur.storagePath, signature }).catch((e) => {
      log.error('Quarantine note failed', { component: 'files', file: cur.id, err: e });
      return null;
    });
    log.warn('Stored file blocked by the antivirus rescan', { component: 'files', file: cur.id, purpose: cur.purpose, signature, quarantine: note });
    await writeAudit(db, { actorName: SYSTEM_ACTOR, objectRef: cur.name, change: `file blocked by the antivirus: ${cur.name}`, area: 'Files', entityType: 'file', entityId: cur.id, projectId: cur.projectId });
  }
  return out;
}
