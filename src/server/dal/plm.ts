import 'server-only';
// PLM screen DAL (docs/spec/09 §2–§3): what the parts catalogue (/reference/parts) and the shared part record drawer
// read, composed from the catalogue, BOM, stock, drawings, Codex, Vigie and installed-base data layers. Read-only:
// the writers are `createPart` / `registerEquivalent` (parts.ts). ECOs come from the Vigie connector (Vigie owns them);
// the installed base is read from the prototype data until phase 8 (machines.ts, TODO(db)).
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { revisionEventsOf, parentChains, type PartRevisionEvent } from '@/domain/parts';
import { assemblyLinks, drawingRevisions, drawings as drawingsTable, parts, revisionDiffLines, revisionDiffs } from '@/server/db/schema';
import { listVaultDocuments, type VaultDocument } from './documents';
import { listDrawings, type DrawingRow } from './drawings';
import { listEcos, openEcoByPart, type EcoView } from './eco';
import { machinesCarryingPart, type FittedMachine } from './machines';
import { getPartRecord, listParts, type PartRecord, type PartRow } from './parts';
import { listStock, type StockRow } from './stock';

// ── Catalogue ──────────────────────────────────────────────────────────────────────────────────────────

export interface PlmCatalogue {
  /** Catalogue order (PARTS order; parts created in Keystone appended). */
  parts: PartRow[];
  /** First open Vigie ECO touching each part (`ecoOpenFor`): ref → ECO number. */
  openEco: Record<string, string>;
}

export async function getPlmCatalogue(): Promise<PlmCatalogue> {
  const [rows, openEco] = await Promise.all([listParts(), openEcoByPart()]);
  return { parts: rows, openEco };
}

// ── Part record drawer ─────────────────────────────────────────────────────────────────────────────────

export interface PartDrawing extends DrawingRow {
  /** Newest first: the current revision then the superseded ones (as the vault reports them). */
  revisions: { revision: string; isCurrent: boolean; checkedInOn: string | null; ecoNumber: string | null }[];
}

export interface PartDrawerData {
  record: PartRecord;
  /** Codex records citing the part (relations or classification tags, `partDocs` 5062), vault order. */
  documents: VaultDocument[];
  /** Vigie ECOs listing the part, Vigie's order (rejected ones included — the view drops them, as the prototype). */
  ecos: EcoView[];
  /** Machines in service carrying the part, with the state of the part (TODO(db): prototype FLEET / AS_MAINT). */
  machines: FittedMachine[];
  /** Stock positions of the part (every location, STOCK0 order). */
  stock: StockRow[];
  /** PDM drawings of the part. */
  drawings: PartDrawing[];
  /** Revision comparisons (REV_DIFF) where the part is the assembly or a line's old / new part. */
  revisions: PartRevisionEvent[];
  /** Assembly chains above the part in the product structure (top-level assembly → direct parent). */
  usedInAssemblies: string[][];
}

async function revisionDiffsOf(ref: string): Promise<PartRevisionEvent[]> {
  const db = await getDb();
  const diffs = await db
    .select({ id: revisionDiffs.id, assemblyRef: parts.ref, from: revisionDiffs.fromRevision, to: revisionDiffs.toRevision, date: revisionDiffs.diffDate, eco: revisionDiffs.ecoNumber })
    .from(revisionDiffs).innerJoin(parts, eq(parts.id, revisionDiffs.assemblyPartId)).orderBy(asc(revisionDiffs.diffDate));
  if (!diffs.length) return [];
  const lines = await db.select().from(revisionDiffLines).where(inArray(revisionDiffLines.diffId, diffs.map((d) => d.id))).orderBy(asc(revisionDiffLines.position));
  return revisionEventsOf(
    ref,
    diffs.map((d) => ({
      assemblyRef: d.assemblyRef, fromRevision: d.from, toRevision: d.to, date: d.date, ecoNumber: d.eco,
      lines: lines.filter((l) => l.diffId === d.id).map((l) => ({ path: l.path, name: l.name, qtyFrom: l.qtyFrom, qtyTo: l.qtyTo, kind: l.kind })),
    })),
  );
}

async function assemblyChainsOf(ref: string): Promise<string[][]> {
  const db = await getDb();
  const links = await db
    .select({ parent: sql<string>`p.ref`, child: sql<string>`c.ref` })
    .from(assemblyLinks)
    .innerJoin(sql`${parts} as p`, sql`p.id = ${assemblyLinks.parentPartId}`)
    .innerJoin(sql`${parts} as c`, sql`c.id = ${assemblyLinks.childPartId}`)
    .orderBy(asc(assemblyLinks.position));
  return parentChains(ref, links);
}

async function drawingsOf(ref: string): Promise<PartDrawing[]> {
  const rows = (await listDrawings()).filter((d) => d.partRef === ref);
  if (!rows.length) return [];
  const db = await getDb();
  const revs = await db
    .select({ number: drawingsTable.number, r: drawingRevisions })
    .from(drawingRevisions).innerJoin(drawingsTable, eq(drawingsTable.id, drawingRevisions.drawingId))
    .where(inArray(drawingsTable.number, rows.map((d) => d.number)));
  return rows.map((d) => ({
    ...d,
    revisions: revs
      .filter((x) => x.number === d.number)
      .map((x) => ({ revision: x.r.revision, isCurrent: x.r.isCurrent, checkedInOn: x.r.checkedInOn, ecoNumber: x.r.ecoNumber }))
      .sort((a, b) => b.revision.localeCompare(a.revision)),
  }));
}

/** Everything the part record drawer shows for a reference; null for an unknown reference. */
export async function getPartDrawer(ref: string): Promise<PartDrawerData | null> {
  const record = await getPartRecord(ref);
  if (!record) return null;
  const [vault, ecos, machines, stock, drawingRows, revisions, usedInAssemblies] = await Promise.all([
    listVaultDocuments(),
    listEcos({ partRefs: [ref] }),
    machinesCarryingPart(ref),
    listStock(),
    drawingsOf(ref),
    revisionDiffsOf(ref),
    assemblyChainsOf(ref),
  ]);
  return {
    record,
    documents: vault.filter((d) => d.links.some((l) => l.ref === ref) || d.tags.includes(ref)),
    ecos: ecos.filter((e) => e.parts.includes(ref)),
    machines,
    stock: stock.filter((s) => s.ref === ref),
    drawings: drawingRows,
    revisions,
    usedInAssemblies,
  };
}

/** Parts a reference may be declared equivalent to ("Register equivalent"): the catalogue minus itself and its equivalents. */
export async function listEquivalentCandidates(ref: string): Promise<{ ref: string; name: string }[]> {
  const all = await listParts();
  const self = all.find((p) => p.ref === ref);
  if (!self) return [];
  const taken = new Set([ref, ...self.equivalents]);
  return all.filter((p) => !taken.has(p.ref)).map((p) => ({ ref: p.ref, name: p.name }));
}
