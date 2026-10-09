import 'server-only';
// Drawings — PDM vault DAL (docs/spec/09 §5; 11 §3.9 Drawing). A read-only mirror of the SolidWorks PDM vault: drawings
// linked to catalogue parts with revision, state, last check-in and the Vigie ECO that drives them. "Sync vault" is a
// simulated hand-off until the PDM connector exists (OPEN QUESTION E-7): it records the run, changes no drawing.
import { asc, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { drawingState, parisParts, partStatus, vaultSyncScope, vaultSyncSource, type DrawingState, type PartStatus, type VaultSyncScope, type VaultSyncSource } from '@/server/db/codes';
import { findPerson, nameOf, requireProject, writeAudit } from '@/server/db/helpers';
import { drawingRevisions, drawings, parts, pdmVaultSyncs } from '@/server/db/schema';
import type { DB } from '@/server/db/types';
import { latestVaultRun } from './kpis';

export interface DrawingRow {
  number: string;
  title: string;
  partRef: string | null;
  partName: string | null;
  partStatus: PartStatus | null;
  partStatusLabel: string | null;
  revision: string;
  state: DrawingState;
  /** "Under review". */
  stateLabel: string;
  vaultPath: string;
  /** "Cranes/RMG-250/DWG-AS-9000.SLDDRW". */
  vaultFile: string;
  checkedInBy: string;
  checkedInOn: string;
  /** Vigie ECO number; null = "—". */
  ecoNumber: string | null;
  /** "SLDDRW · PDF · DXF". */
  formats: string;
  pdmUrl: string | null;
  previewRef: string | null;
  position: number;
}

async function loadDrawings(db: DB, number?: string): Promise<DrawingRow[]> {
  const rows = await db
    .select({ d: drawings, ref: parts.ref, name: parts.name, status: parts.status })
    .from(drawings).leftJoin(parts, eq(parts.id, drawings.partId))
    .where(number ? eq(drawings.number, number) : undefined)
    .orderBy(asc(drawings.position));
  return rows.map(({ d, ref, name, status }) => ({
    number: d.number, title: d.title, partRef: ref ?? null, partName: name ?? null, partStatus: status ?? null, partStatusLabel: status ? partStatus.label(status) : null,
    revision: d.revision, state: d.state, stateLabel: drawingState.label(d.state), vaultPath: d.vaultPath, vaultFile: `${d.vaultPath}${d.number}.SLDDRW`,
    checkedInBy: d.checkedInByName, checkedInOn: d.checkedInOn, ecoNumber: d.ecoNumber, formats: d.formats, pdmUrl: d.pdmUrl, previewRef: d.previewRef, position: d.position,
  }));
}

/** The drawing register, DRAWINGS order. */
export async function listDrawings(): Promise<DrawingRow[]> {
  return loadDrawings(await getDb());
}

export interface DrawingDetail extends DrawingRow {
  /** Newest first: the current revision (check-in date, ECO) then the superseded ones. */
  revisions: { revision: string; isCurrent: boolean; checkedInOn: string | null; ecoNumber: string | null }[];
}

export async function getDrawing(number: string): Promise<DrawingDetail | null> {
  const db = await getDb();
  const [row] = await loadDrawings(db, number);
  if (!row) return null;
  const [d] = await db.select({ id: drawings.id }).from(drawings).where(eq(drawings.number, number));
  const revs = await db.select().from(drawingRevisions).where(eq(drawingRevisions.drawingId, d.id)).orderBy(desc(drawingRevisions.revision));
  return { ...row, revisions: revs.map((r) => ({ revision: r.revision, isCurrent: r.isCurrent, checkedInOn: r.checkedInOn, ecoNumber: r.ecoNumber })) };
}

export interface VaultSyncState {
  /** "07:40" (Paris). */
  time: string;
  syncedAt: string;
  /** Drawings in the whole vault ("1 248"). */
  drawingsInVault: number;
  /** Drawings linked to catalogue parts (the register). */
  linkedDrawings: number;
  /** Drawings changed by the last sync. */
  drawingsUpdated: number;
}

/**
 * Vault state of the KPI tiles. A-12 (chapter 4): the latest of the PDM connector row's last run (Activity &
 * integrations, its volume gives the vault count) and Keystone's last "Sync vault" (`latestVaultRun`) — the prototype
 * printed "1 248" and "07:40".
 */
export async function getVaultSyncState(): Promise<VaultSyncState | null> {
  const db = await getDb();
  const [[s], run] = await Promise.all([db.select().from(pdmVaultSyncs).orderBy(desc(pdmVaultSyncs.syncedAt)).limit(1), latestVaultRun()]);
  if (!run) return null;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(drawings);
  const p = parisParts(new Date(run.at));
  return { time: `${p.hh}:${p.mm}`, syncedAt: run.at, drawingsInVault: run.drawingsInVault ?? s?.drawingsInVault ?? 0, linkedDrawings: n, drawingsUpdated: s?.drawingsUpdated ?? 0 };
}

export interface VaultSyncInput {
  source: VaultSyncSource;
  scope: VaultSyncScope;
  /** Project of a "Current project" sync. */
  projectCode?: string | null;
}

/**
 * "Synchronise" (Sync vault form AF.drawings): records the run at the real clock time (simulated connector: no drawing
 * changes, 0 updated — the prototype's toast said 6). Returns the new sync state.
 */
export async function syncPdmVault(input: VaultSyncInput, actorName: string, at: Date = new Date()): Promise<VaultSyncState> {
  if (!vaultSyncSource.isCode(input.source)) throw new Error('Invalid source');
  if (!vaultSyncScope.isCode(input.scope)) throw new Error('Invalid scope');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [last] = await tx.select().from(pdmVaultSyncs).orderBy(desc(pdmVaultSyncs.syncedAt)).limit(1);
    const project = input.scope === 'current_project' && input.projectCode ? await requireProject(tx, input.projectCode) : null;
    const actor = await findPerson(tx, actorName);
    await tx.insert(pdmVaultSyncs).values({
      syncedAt: at, drawingsInVault: last?.drawingsInVault ?? 0, drawingsUpdated: 0, source: input.source, scope: input.scope, projectId: project?.id ?? null,
      requestedByPersonId: actor?.id ?? null,
    });
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: 'SolidWorks PDM',
      change: `vault sync · ${vaultSyncSource.label(input.source)} · ${vaultSyncScope.label(input.scope)}${project ? ` ${project.code}` : ''} · 0 drawings updated`, area: 'Drawings', projectId: project?.id ?? null, occurredAt: at,
    });
  });
  return (await getVaultSyncState())!;
}
