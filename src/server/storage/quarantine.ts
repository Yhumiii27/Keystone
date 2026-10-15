import 'server-only';
// Quarantine of the antivirus (R-175): <data dir>/quarantine, outside the files folder (never served, never pruned as an
// orphan). Two kinds of entries, each with a .json note IT reads:
// - refused-upload: an upload clamd flagged — the bytes (<name>.bin) and the note; purged after QUARANTINE_RETENTION_DAYS
//   by the daily files-rescan job;
// - flagged-stored-file: a stored file a rescan flagged — the note only (the bytes stay in the files folder, blocked); kept
//   until IT deals with the file. A false positive must not destroy a business record.
// Kept behind this module so the quarantine can move with the files when storage leaves the local disk (R-005).
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { quarantineToPurge, type QuarantineEntry, type QuarantineKind } from '@/domain/file-scan';
import { getConfig } from '@/server/config';

const g = globalThis as unknown as { __ksQuarantineRoot?: string | null };

/** <KEYSTONE_DATA_DIR or ./.data>/quarantine (or the folder set by setQuarantineRoot). */
export function quarantineRoot(): string {
  if (g.__ksQuarantineRoot) return g.__ksQuarantineRoot;
  return path.join(/*turbopackIgnore: true*/ getConfig().dataDir, 'quarantine');
}

/** Points the quarantine at another folder (tests use a temporary directory); null restores the default. */
export function setQuarantineRoot(dir: string | null): void {
  g.__ksQuarantineRoot = dir;
}

export interface QuarantineNote {
  kind: QuarantineKind;
  /** ISO time. */
  at: string;
  signature: string;
  purpose: string;
  /** Uploaded or stored file name (sanitised). */
  name: string;
  sizeBytes: number;
  sha256: string;
  objectRef: string;
  actor?: string;
  /** Stored file (flagged-stored-file). */
  fileId?: string;
  storagePath?: string;
  /** The bytes kept next to the note (refused-upload). */
  bytesFile?: string;
}

const entryName = (at: Date) => `${at.toISOString().replace(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`;

async function writeNote(name: string, note: QuarantineNote): Promise<void> {
  const root = quarantineRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const file = path.join(/*turbopackIgnore: true*/ root, `${name}.json`);
  await fs.writeFile(`${file}.part`, JSON.stringify(note, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(`${file}.part`, file);
}

/** Keeps a refused upload (bytes + note). Returns the entry name. */
export async function quarantineUpload(
  data: Uint8Array,
  ctx: { purpose: string; name: string; signature: string; objectRef: string; actor: { name: string } },
): Promise<string> {
  const at = new Date();
  const name = entryName(at);
  const root = quarantineRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(/*turbopackIgnore: true*/ root, `${name}.bin`), data, { mode: 0o600 });
  await writeNote(name, {
    kind: 'refused-upload', at: at.toISOString(), signature: ctx.signature, purpose: ctx.purpose, name: ctx.name, sizeBytes: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'), objectRef: ctx.objectRef, actor: ctx.actor.name, bytesFile: `${name}.bin`,
  });
  return name;
}

/** Records that a stored file was flagged by a rescan (note only: the file stays where it is, blocked). Returns the entry name. */
export async function quarantineFlaggedFile(f: { id: string; purpose: string; name: string; sizeBytes: number; sha256: string; storagePath: string; signature: string }): Promise<string> {
  const at = new Date();
  const name = entryName(at);
  await writeNote(name, {
    kind: 'flagged-stored-file', at: at.toISOString(), signature: f.signature, purpose: f.purpose, name: f.name, sizeBytes: f.sizeBytes, sha256: f.sha256,
    objectRef: f.id, fileId: f.id, storagePath: f.storagePath,
  });
  return name;
}

/** The entries of the quarantine folder (notes that cannot be read are skipped). */
export async function listQuarantine(): Promise<(QuarantineEntry & { note: QuarantineNote })[]> {
  let names: string[];
  try {
    names = await fs.readdir(quarantineRoot());
  } catch {
    return [];
  }
  const out: (QuarantineEntry & { note: QuarantineNote })[] = [];
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    try {
      const note = JSON.parse(await fs.readFile(path.join(/*turbopackIgnore: true*/ quarantineRoot(), n), 'utf8')) as QuarantineNote;
      const at = new Date(note.at);
      if ((note.kind === 'refused-upload' || note.kind === 'flagged-stored-file') && !Number.isNaN(at.getTime())) out.push({ name: n.slice(0, -5), kind: note.kind, at, note });
    } catch {
      // a note being written, or not ours
    }
  }
  return out;
}

/** Removes the refused uploads older than the retention (bytes and note). Returns how many entries were removed. */
export async function purgeQuarantine(now = new Date()): Promise<number> {
  const root = quarantineRoot();
  let removed = 0;
  for (const e of quarantineToPurge(await listQuarantine(), now)) {
    if (e.note.bytesFile && /^[\w.-]+$/.test(e.note.bytesFile)) await fs.rm(path.join(/*turbopackIgnore: true*/ root, e.note.bytesFile), { force: true });
    await fs.rm(path.join(/*turbopackIgnore: true*/ root, `${e.name}.json`), { force: true });
    removed++;
  }
  return removed;
}
