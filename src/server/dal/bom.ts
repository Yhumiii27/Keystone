import 'server-only';
// Project BOM DAL (docs/spec/09 §1; 11 §3.9 ProjectBomLine, AssemblyLink, ProjectAssemblyRoot, RevisionDiff, SpareListLine).
// The flat list of a project's articles, the costed assembly tree, where-used, the revision comparison and the
// recommended wear & spare parts package, plus "Add article". Fixes of 00 §7.16 / 09 OQ settled here:
// - the BOM value counts every physical article once: an assembly whose components are listed in the same BOM is valued
//   through its components (`valueEur`; the prototype added both, `listValueEur` keeps its figure);
// - the PU/PR "in stock" quantity is Σ on hand of the part across every location (the prototype always found 0);
// - "Under change" and the open-ECO tags follow the ECO status Vigie reports;
// - Delivery 7 (E-2a = a, A-11, R-103): the flat list, the tree, a node's roll-up and the revision comparison are valued
//   with one rule — the project's ordered price (its approved orders' lines), else the last purchase price, else the
//   catalogue price — and each price says where it comes from (`priceSource`). An ordered price is converted from the
//   order's currency to euros at the project's budget rate (C-9, R-075).
// Projects without a BOM get empty data (no Harbor Line fallback).
// The rules themselves (value, roll-up, paths, where-used resolution, deltas, system quantity) are the pure functions of
// src/domain/bom.ts, golden-tested against the prototype.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  ORDERED_PO_STATUSES, assemblyPaths, assemblyRows, bomSummary, bomUnitPrice, buildAssembly, defaultWhereUsedRef, diffCostDelta, diffNewRef, diffOldRef, isValuedByComponents, possibleDuplicates,
  orderedUnitPrice, pathQuantity, resolvePartQuery, systemQuantity, type AssemblyLink, type AssemblyNode, type BomPriceSource,
} from '@/domain/bom';
import { projectFxOf, toEur } from '@/domain/currency';
import { getDb } from '@/server/db/client';
import { bomScope, revisionDiffKind, stage as stageCodec, type BomScope, type PartStatus, type RevisionDiffKind, type StageCode, type WearSpare } from '@/server/db/codes';
import { findPerson, nameOf, requireProject, writeAudit } from '@/server/db/helpers';
import type { Tx } from '@/server/db/types';
import {
  activities, assemblyLinks, parts, poLines, projectAssemblyRoots, projectBomLines, projects, purchaseOrders, revisionDiffLines, revisionDiffs, spareListLines,
} from '@/server/db/schema';
import { installedBasePins, openEcoByPart, partsUnderChange, pinSummary, type InstalledBasePin } from './eco';
import { getPartsByRef, listParts, type PartRow } from './parts';
import { listPurchaseOrdersWithParts } from './purchasing';
import { stockOnHandByRef } from './stock';

// ── Flat list ──────────────────────────────────────────────────────────────────────────────────────────

export interface BomLine extends PartRow {
  /** Quantity in the project (`usage[p3]`). */
  quantity: number;
  /** Valuation unit price (E-2a: ordered, else last purchase, else catalogue), € — and where it comes from. */
  unitPriceEur: number;
  priceSource: BomPriceSource;
  /** unit price × quantity, €. */
  totalEur: number;
  /** The part is an assembly whose components are listed in this BOM (valued through them). */
  valuedByComponents: boolean;
  scope: BomScope;
  scopeLabel: string;
  /** Activity of the line (Add article form); null for the seed. */
  activityCode: string | null;
  note: string | null;
  /** Other projects whose BOM lists the part (3-letter keys, "Also used in"). */
  alsoUsedIn: string[];
  /** First open Vigie ECO touching the part; null when none. */
  openEco: string | null;
  /** R-111 (NEW-D4-5 = c): lines this one may duplicate (a purchased line and an assembly line), to be checked; [] when none. */
  possibleDuplicateOf: string[];
}

export interface ProjectBom {
  projectCode: string;
  shortCode: string;
  lines: BomLine[];
  summary: {
    articles: number;
    /** Σ quantities ("2,042 units in total"). */
    units: number;
    /** Each physical article once (assemblies valued through their components). */
    valueEur: number;
    /** The prototype's sum over every line (assemblies and components both counted, 09 OQ6). */
    listValueEur: number;
    notValidated: number;
    outdatedOrObsolete: number;
    exportRestricted: number;
    /** R-111: pairs of lines that may be the same article counted twice (never an amount). */
    possibleDuplicates: number;
  };
  /** A multi-level structure is configured (Assembly tree, Compare revisions, PU/PR list). */
  hasTree: boolean;
}

/** A part's valuation in a project (E-2a): unit price and its source. */
export type PartValuation = { unitEur: number; source: BomPriceSource };

/**
 * The valuation of parts in a project (E-2a = a): the quantity-weighted price of the project's ordered lines (orders
 * approved, partly or fully received), else the last purchase price, else the catalogue price. Unknown refs are left out.
 * A line price is in its order's currency (C-9, R-075): converted to euros at the project's budget rate first.
 */
export async function projectPartValuation(projectId: string, refs: readonly string[]): Promise<Map<string, PartValuation>> {
  if (!refs.length) return new Map();
  const db = await getDb();
  const [ordered, info, [project]] = await Promise.all([
    db.select({ ref: parts.ref, qty: poLines.orderedQty, unitPrice: poLines.unitPriceEur, currency: purchaseOrders.currency })
      .from(poLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId)).innerJoin(parts, eq(parts.id, poLines.partId))
      .where(and(eq(purchaseOrders.projectId, projectId), inArray(purchaseOrders.status, [...ORDERED_PO_STATUSES]), inArray(parts.ref, [...refs]))),
    getPartsByRef([...refs]),
    db.select({ currency: projects.currency, budgetRate: projects.budgetRate }).from(projects).where(eq(projects.id, projectId)),
  ]);
  const fx = projectFxOf(project ?? {});
  const byRef = new Map<string, { qty: number; unitPriceEur: number }[]>();
  for (const o of ordered) byRef.set(o.ref, [...(byRef.get(o.ref) ?? []), { qty: o.qty, unitPriceEur: toEur(o.unitPrice, o.currency, fx) }]);
  return new Map(info.map((p) => [p.ref, bomUnitPrice({
    orderedEur: orderedUnitPrice(byRef.get(p.ref) ?? []), lastPurchaseEur: p.hasLastPrice ? p.lastPriceEur : null, listPriceEur: p.listPriceEur,
  })]));
}

/** Parent → children links of the whole catalogue. */
async function childrenMap(): Promise<Map<string, AssemblyLink[]>> {
  const db = await getDb();
  const rows = await db
    .select({ parent: sql<string>`p.ref`, child: sql<string>`c.ref`, q: assemblyLinks.quantity, position: assemblyLinks.position })
    .from(assemblyLinks)
    .innerJoin(sql`${parts} as p`, sql`p.id = ${assemblyLinks.parentPartId}`)
    .innerJoin(sql`${parts} as c`, sql`c.id = ${assemblyLinks.childPartId}`)
    .orderBy(asc(assemblyLinks.position));
  const m = new Map<string, AssemblyLink[]>();
  for (const r of rows) m.set(r.parent, [...(m.get(r.parent) ?? []), { ref: r.child, q: r.q }]);
  return m;
}

export async function getProjectBom(projectCode: string): Promise<ProjectBom | null> {
  const db = await getDb();
  const [p] = await db.select({ id: projects.id, code: projects.code, short: projects.shortCode }).from(projects).where(eq(projects.code, projectCode));
  if (!p) return null;
  const lines = await db
    .select({ ref: parts.ref, qty: projectBomLines.quantity, scope: projectBomLines.scope, note: projectBomLines.note, act: activities.code })
    .from(projectBomLines).innerJoin(parts, eq(parts.id, projectBomLines.partId)).leftJoin(activities, eq(activities.id, projectBomLines.activityId))
    .where(eq(projectBomLines.projectId, p.id)).orderBy(asc(parts.position), asc(projectBomLines.position));
  const [rows, kids, ecoFor, roots, value] = await Promise.all([
    getPartsByRef(lines.map((l) => l.ref)), childrenMap(), openEcoByPart(),
    db.select({ id: projectAssemblyRoots.id }).from(projectAssemblyRoots).where(eq(projectAssemblyRoots.projectId, p.id)),
    projectPartValuation(p.id, lines.map((l) => l.ref)),
  ]);
  const byRef = new Map(rows.map((r) => [r.ref, r]));
  const inBom = new Set(lines.map((l) => l.ref));
  const childrenOf = (ref: string) => kids.get(ref) ?? [];
  const dup = possibleDuplicates(lines.map((l) => ({ ...byRef.get(l.ref)!, quantity: l.qty })), childrenOf);
  const out: BomLine[] = lines.map((l) => {
    const r = byRef.get(l.ref)!;
    const v = value.get(l.ref) ?? { unitEur: r.listPriceEur, source: 'catalogue' as const };
    return {
      ...r, quantity: l.qty, unitPriceEur: v.unitEur, priceSource: v.source, totalEur: v.unitEur * l.qty, valuedByComponents: isValuedByComponents(l.ref, childrenOf, inBom),
      scope: l.scope, scopeLabel: bomScope.label(l.scope), activityCode: l.act ?? null, note: l.note,
      alsoUsedIn: r.usage.filter((u) => u.projectCode !== projectCode).map((u) => u.shortCode), openEco: ecoFor[l.ref] ?? null,
      possibleDuplicateOf: dup.partners[l.ref] ?? [],
    };
  });
  return { projectCode: p.code, shortCode: p.short, lines: out, summary: { ...bomSummary(out), possibleDuplicates: dup.pairs }, hasTree: roots.length > 0 };
}

/**
 * R-111 (NEW-D4-5 = c): the lines of the project's BOM that `ref` may duplicate (the part drawer opened on a project screen);
 * [] when none, the part is not in the BOM, or the project is unknown. Same rule as the BOM screen (`possibleDuplicates`).
 */
export async function bomDuplicatePartners(projectCode: string, ref: string): Promise<string[]> {
  const db = await getDb();
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, projectCode));
  if (!p) return [];
  const lines = await db
    .select({ ref: parts.ref, makeBuy: parts.makeBuy, type: parts.type, hsCode: parts.hsCode, listPriceEur: parts.listPriceEur, quantity: projectBomLines.quantity })
    .from(projectBomLines).innerJoin(parts, eq(parts.id, projectBomLines.partId)).where(eq(projectBomLines.projectId, p.id));
  if (!lines.some((l) => l.ref === ref)) return [];
  const kids = await childrenMap();
  return possibleDuplicates(lines, (r) => kids.get(r) ?? []).partners[ref] ?? [];
}

// ── Assembly tree ──────────────────────────────────────────────────────────────────────────────────────

export interface BomTreeNode {
  ref: string;
  name: string;
  /** Quantity per parent (`q`). */
  qty: number;
  /** Total units in the project (q × parent extended). */
  extended: number;
  depth: number;
  /** Rolled-up unit cost: leaf = its valuation (E-2a); assembly = Σ child q × roll-up (`rollup` 4231). */
  unitCostEur: number;
  /** Source of a leaf's price (E-2a); 'rollup' for an assembly. */
  priceSource: BomPriceSource | 'rollup';
  /** unit × extended. */
  extendedCostEur: number;
  listPriceEur: number;
  makeBuyLabel: string;
  wearSpare: WearSpare | null;
  revision: string | null;
  status: PartStatus;
  statusLabel: string;
  manufacturer: string | null;
  manufacturerRef: string | null;
  leadWeeks: number | null;
  /** Leaf parts below the node ("N parts · M direct children"). */
  leafCount: number;
  children: BomTreeNode[];
  /** Ancestor refs from the root (empty for the root). */
  path: string[];
}

export interface ProjectAssembly {
  root: BomTreeNode;
  /** Depth-first list of every node (the table rows, all unfolded). */
  rows: BomTreeNode[];
  /** The bare structure (refs × q) for the domain rules (paths, system quantities). */
  structure: AssemblyNode;
}

/** The costed multi-level structure configured for the project (TREES: Harbor Line only); null when none. */
export async function getProjectAssembly(projectCode: string): Promise<ProjectAssembly | null> {
  const db = await getDb();
  const [root] = await db
    .select({ ref: parts.ref, q: projectAssemblyRoots.quantity, projectId: projects.id })
    .from(projectAssemblyRoots).innerJoin(projects, eq(projects.id, projectAssemblyRoots.projectId)).innerJoin(parts, eq(parts.id, projectAssemblyRoots.rootPartId))
    .where(eq(projects.code, projectCode)).orderBy(asc(projectAssemblyRoots.position)).limit(1);
  if (!root) return null;
  const kids = await childrenMap();
  const structure = buildAssembly(root.ref, root.q, (r) => kids.get(r) ?? []);
  const refs = new Set<string>();
  const collect = (n: AssemblyNode) => { refs.add(n.ref); n.children.forEach(collect); };
  collect(structure);
  const [infoRows, value] = await Promise.all([getPartsByRef([...refs]), projectPartValuation(root.projectId, [...refs])]);
  const info = new Map(infoRows.map((p) => [p.ref, p]));
  // E-2a: a leaf is valued at the project's ordered price, else its last purchase price, else the catalogue price.
  const flat = assemblyRows(structure, (r) => value.get(r)?.unitEur ?? info.get(r)?.listPriceEur ?? 0);
  const rows: BomTreeNode[] = [];
  let i = 0;
  // assemblyRows walks depth-first in the same order as this build, so row i is the i-th node visited.
  const build = (n: AssemblyNode): BomTreeNode => {
    const a = flat[i++];
    const p = info.get(n.ref);
    const node: BomTreeNode = {
      ref: n.ref, name: p?.name ?? n.ref, qty: a.qty, extended: a.extended, depth: a.depth, unitCostEur: a.unitCostEur, extendedCostEur: a.extendedCostEur,
      priceSource: n.children.length ? 'rollup' : (value.get(n.ref)?.source ?? 'catalogue'),
      listPriceEur: p?.listPriceEur ?? 0, makeBuyLabel: p?.makeBuyLabel ?? '', wearSpare: p?.wearSpare ?? null, revision: p?.revision ?? null,
      status: p?.status ?? 'validated', statusLabel: p?.statusLabel ?? '', manufacturer: p?.manufacturer ?? null, manufacturerRef: p?.manufacturerRef ?? null,
      leadWeeks: p?.leadWeeks ?? null, leafCount: a.leafCount, children: [], path: a.path,
    };
    rows.push(node);
    node.children = n.children.map(build);
    return node;
  };
  return { root: build(structure), rows, structure };
}

// ── Where-used ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Part of the Where-used search (`usedPart` 4248): exact reference, else first ref / name containing the query, else the
 * part of the project used by the most projects (R-169, `defaultWhereUsedRef`; the prototype's constant was CR-BRG-SKF).
 */
export async function resolveWhereUsedQuery(query: string, projectCode: string | null = null): Promise<string> {
  const all = await listParts();
  const part = resolvePartQuery(all, query, defaultWhereUsedRef(all, projectCode));
  if (!part) throw new Error('The parts catalogue is empty');
  return part.ref;
}

export interface WhereUsed {
  part: PartRow;
  /** Paths in the project's assembly ("ASM-RMG-250 ×2 › ASM-STR-100 ×1 › ASM-BOG-300 ×4") and Π q per project (leaf included). */
  paths: { chain: { ref: string; qty: number }[]; perProject: number }[];
  projects: { code: string; shortCode: string; name: string; stage: StageCode; stageLabel: string; quantity: number }[];
  /** Orders of any project with a line on the part (all statuses, as the prototype lists them). */
  purchaseOrders: { number: string; projectCode: string; supplier: string; status: string; statusLabel: string }[];
}

export async function getWhereUsed(ref: string, projectCode: string): Promise<WhereUsed | null> {
  const [part] = await getPartsByRef([ref]);
  if (!part) return null;
  const db = await getDb();
  const [asm, pos, projs] = await Promise.all([
    getProjectAssembly(projectCode),
    listPurchaseOrdersWithParts([ref]),
    part.usage.length
      ? db.select({ code: projects.code, short: projects.shortCode, name: projects.name, stage: projects.stage }).from(projects)
        .where(inArray(projects.code, part.usage.map((u) => u.projectCode))).orderBy(asc(projects.sortOrder))
      : Promise.resolve([]),
  ]);
  const paths: WhereUsed['paths'] = asm
    ? assemblyPaths(asm.structure, ref).map((p) => ({ chain: p.slice(0, -1).map((x) => ({ ref: x.ref, qty: x.q })), perProject: pathQuantity(p) }))
    : [];
  return {
    part, paths,
    projects: projs.map((p) => ({ code: p.code, shortCode: p.short, name: p.name, stage: p.stage, stageLabel: stageCodec.label(p.stage), quantity: part.usage.find((u) => u.projectCode === p.code)!.quantity })),
    purchaseOrders: pos.map((o) => ({ number: o.number, projectCode: o.projectCode, supplier: o.supplier, status: o.status, statusLabel: o.statusLabel })),
  };
}

// ── Compare revisions ──────────────────────────────────────────────────────────────────────────────────

export interface RevisionComparison {
  assemblyRef: string;
  fromRevision: string;
  toRevision: string;
  date: string;
  ecoNumber: string | null;
  /**
   * `unitPriceEur`: the new part's valuation (E-2a: ordered, else last purchase, else catalogue) and its source; `old*`: the
   * old part's (R-104, E-2b — the same part on a quantity or added line).
   */
  lines: {
    path: string; name: string; qtyFrom: number | null; qtyTo: number | null; kind: RevisionDiffKind; kindLabel: string; newRef: string;
    unitPriceEur: number | null; priceSource: BomPriceSource | null; deltaEur: number;
    oldRef: string; oldUnitPriceEur: number | null; oldPriceSource: BomPriceSource | null;
  }[];
  /** Σ line deltas (new qty × new price − old qty × old price, E-2b), per root unit — "per crane". */
  totalDeltaEur: number;
}

/** Revision comparison of the project's root assembly (REV_DIFF); null when none. */
export async function getRevisionComparison(projectCode: string): Promise<RevisionComparison | null> {
  const asm = await getProjectAssembly(projectCode);
  if (!asm) return null;
  const db = await getDb();
  const [d] = await db.select({ d: revisionDiffs }).from(revisionDiffs).innerJoin(parts, eq(parts.id, revisionDiffs.assemblyPartId)).where(eq(parts.ref, asm.root.ref));
  if (!d) return null;
  const lines = await db.select().from(revisionDiffLines).where(eq(revisionDiffLines.diffId, d.d.id)).orderBy(asc(revisionDiffLines.position));
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, projectCode));
  // E-2b (R-104): the old and the new part of each line valued once, by the same E-2a rule.
  const prices = await projectPartValuation(p.id, [...new Set(lines.flatMap((l) => [diffNewRef(l.path), diffOldRef(l.path)]))]);
  const out = lines.map((l) => {
    const ref = diffNewRef(l.path);
    const oldRef = diffOldRef(l.path);
    const v = prices.get(ref) ?? null;
    const o = prices.get(oldRef) ?? null;
    // An unknown price on either side keeps the quantity-only rule (never the whole new price).
    const delta = diffCostDelta(l.qtyFrom, l.qtyTo, v?.unitEur ?? null, v && o ? o.unitEur : null);
    return {
      path: l.path, name: l.name, qtyFrom: l.qtyFrom, qtyTo: l.qtyTo, kind: l.kind, kindLabel: revisionDiffKind.label(l.kind), newRef: ref,
      unitPriceEur: v?.unitEur ?? null, priceSource: v?.source ?? null, deltaEur: delta, oldRef, oldUnitPriceEur: o?.unitEur ?? null, oldPriceSource: o?.source ?? null,
    };
  });
  return { assemblyRef: asm.root.ref, fromRevision: d.d.fromRevision, toRevision: d.d.toRevision, date: d.d.diffDate, ecoNumber: d.d.ecoNumber, lines: out, totalDeltaEur: out.reduce((s, l) => s + l.deltaEur, 0) };
}

// ── Wear & spare parts (PU/PR) ─────────────────────────────────────────────────────────────────────────

export interface SpareRow {
  ref: string;
  name: string;
  kind: WearSpare;
  qtyPerSystem: number;
  /** q × systems in the project. */
  recommendedQty: number;
  note: string | null;
  lastPriceEur: number;
  totalEur: number;
  leadWeeks: number | null;
  status: PartStatus;
  statusLabel: string;
  /** Σ on hand across every location. */
  inStock: number;
  /** Part of an open ECO ("Under change"). */
  underChange: boolean;
  /** "Keep for the installed base" pins (Vigie effectivity), empty when none. */
  pins: InstalledBasePin[];
  pinSummary: ReturnType<typeof pinSummary>;
}

export interface SpareList {
  /** Systems with a list in the project's structure: the root first ("Complete system"), then by list order. */
  systems: { ref: string; name: string; isRoot: boolean }[];
  system: string;
  systemName: string;
  /** Systems in the project (root q, or Π q down to the system incl. its own). */
  systemQty: number;
  rows: SpareRow[];
}

/** PU/PR list of a system of the project (default: the complete system); null without a structure. */
export async function getSpareList(projectCode: string, systemRef?: string | null): Promise<SpareList | null> {
  const asm = await getProjectAssembly(projectCode);
  if (!asm) return null;
  const db = await getDb();
  const lists = await db
    .select({ sys: sql<string>`s.ref`, ref: sql<string>`c.ref`, kind: spareListLines.kind, q: spareListLines.qtyPerSystem, note: spareListLines.note, position: spareListLines.position })
    .from(spareListLines)
    .innerJoin(sql`${parts} as s`, sql`s.id = ${spareListLines.systemPartId}`)
    .innerJoin(sql`${parts} as c`, sql`c.id = ${spareListLines.partId}`)
    .orderBy(sql`s.position`, asc(spareListLines.position));
  const node = new Map(asm.rows.map((n) => [n.ref, n]));
  const systems = [...new Set(lists.map((l) => l.sys))].filter((s) => node.has(s))
    .map((s) => ({ ref: s, name: node.get(s)!.name, isRoot: s === asm.root.ref }));
  // Only the systems of the segment can be selected (`spSeg`); any other reference (stale link, an assembly without a
  // list) falls back to the complete system instead of an empty list with no option selected.
  const system = systemRef && systems.some((s) => s.ref === systemRef) ? systemRef : asm.root.ref;
  const n = node.get(system)!;
  const systemQty = systemQuantity(asm.structure, system);
  const mine = lists.filter((l) => l.sys === system);
  const [info, stock, frozen, pins] = await Promise.all([getPartsByRef(mine.map((l) => l.ref)), stockOnHandByRef(), partsUnderChange(), installedBasePins()]);
  const byRef = new Map(info.map((p) => [p.ref, p]));
  const frozenSet = new Set(frozen);
  return {
    systems, system, systemName: n.name, systemQty,
    rows: mine.map((l) => {
      const p = byRef.get(l.ref)!;
      const qty = l.q * systemQty;
      return {
        ref: l.ref, name: p.name, kind: l.kind, qtyPerSystem: l.q, recommendedQty: qty, note: l.note, lastPriceEur: p.lastPriceEur, totalEur: p.lastPriceEur * qty,
        leadWeeks: p.leadWeeks, status: p.status, statusLabel: p.statusLabel, inStock: stock[l.ref] ?? 0, underChange: frozenSet.has(l.ref),
        pins: pins[l.ref] ?? [], pinSummary: pinSummary(pins[l.ref]),
      };
    }),
  };
}

// ── Add article ────────────────────────────────────────────────────────────────────────────────────────

/** Activities offered by the Add article form (`AF.bom`: the project's first 12 activities, "A1250 · name"). */
export async function listBomActivityOptions(projectCode: string, limit = 12): Promise<{ code: string; name: string; label: string }[]> {
  const db = await getDb();
  const rows = await db.select({ code: activities.code, name: activities.name }).from(activities).innerJoin(projects, eq(projects.id, activities.projectId))
    .where(eq(projects.code, projectCode)).orderBy(asc(activities.position)).limit(limit);
  return rows.map((r) => ({ ...r, label: `${r.code} · ${r.name}` }));
}

export interface NewBomLineInput {
  ref: string;
  quantity: number;
  activityCode?: string | null;
  scope?: BomScope;
  note?: string | null;
}

/**
 * "Add to BOM" (AF.bom): a catalogue article added to the project BOM (once per article). Returns the reference. R-108: with
 * `tx`, the line is added inside the caller's transaction (the P&ID tag drawer's "Link and add to the BOM").
 */
export async function addBomLine(projectCode: string, input: NewBomLineInput, actorName: string, tx?: Tx): Promise<string> {
  if (tx) return insertBomLine(tx, projectCode, input, actorName);
  const db = await getDb();
  return db.transaction((t) => insertBomLine(t, projectCode, input, actorName));
}

async function insertBomLine(tx: Tx, projectCode: string, input: NewBomLineInput, actorName: string): Promise<string> {
  const p = await requireProject(tx, projectCode);
  const ref = input.ref.trim().toUpperCase();
  if (!ref) throw new Error('The article reference is required');
  const [part] = await tx.select({ id: parts.id }).from(parts).where(eq(parts.ref, ref));
  if (!part) throw new Error(`${ref} is not in the catalogue`);
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error('Invalid quantity');
  const scope = input.scope ?? 'keystone';
  if (!bomScope.isCode(scope)) throw new Error('Invalid scope');
  const [dup] = await tx.select({ id: projectBomLines.id, qty: projectBomLines.quantity }).from(projectBomLines).where(and(eq(projectBomLines.projectId, p.id), eq(projectBomLines.partId, part.id)));
  // R-108: a line at quantity 0 (possible through the table import) reads "Not in BOM" on the P&ID: say how to fix it.
  if (dup) throw new Error(dup.qty > 0 ? `${ref} is already in the project BOM` : `${ref} is in the project BOM with quantity 0 — change its quantity on the BOM screen`);
  let activityId: string | null = null;
  if (input.activityCode) {
    const [a] = await tx.select({ id: activities.id }).from(activities).where(and(eq(activities.projectId, p.id), eq(activities.code, input.activityCode)));
    if (!a) throw new Error(`Unknown activity ${input.activityCode}`);
    activityId = a.id;
  }
  const actor = await findPerson(tx, actorName);
  const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${projectBomLines.position}), -1)::int` }).from(projectBomLines).where(eq(projectBomLines.projectId, p.id));
  const [line] = await tx.insert(projectBomLines).values({
    projectId: p.id, partId: part.id, quantity: input.quantity, activityId, scope, note: input.note?.trim() || null, position: pos + 1, addedByPersonId: actor?.id ?? null,
  }).returning({ id: projectBomLines.id });
  await writeAudit(tx, {
    actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: `${p.code} BOM`,
    change: `${ref} × ${input.quantity} added · ${bomScope.label(scope)}${input.activityCode ? ` · ${input.activityCode}` : ''}`, area: 'BOM', entityType: 'project_bom_line', entityId: line.id, projectId: p.id,
  });
  return ref;
}
