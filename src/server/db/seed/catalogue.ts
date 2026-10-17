// Technical reference seed (docs/spec/11 §8.5): suppliers and manufacturers, storage locations (SETTINGS0.locations),
// the parts catalogue (PARTS 3343, WEAR_SPARE 3341) with equivalents and last purchase prices (LAST_PRICE 3428), the
// product structure (TREE 3421), the wear & spare lists (SPARE_LISTS 3399), the project BOM lines (`PARTS.usage`), the
// assembly configured per project (TREES 3426), the revision comparison (REV_DIFF 3427) and the PDM drawings
// (DRAWINGS 3439, revision history A…current as `dwgVals` shows it) with the vault sync state ("07:40 · 1 248").
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { PROTO } from '@/server/prototype';
import {
  exportControlOf, isoOfDemoDate, locationType, parisInstant, partMakeBuy, partStatus, partType, revisionDiffKind,
  type DrawingState, type WearSpare,
} from '../codes';
import {
  assemblyLinks, drawingRevisions, drawings, parts, partEquivalents, partLastPrices, pdmVaultSyncs, projectAssemblyRoots, projectBomLines, revisionDiffLines,
  revisionDiffs, spareListLines, storageLocations, suppliers,
} from '../schema';
import type { Tx } from '../types';
import { must, newId, personIdOrNull, projectCodeOfShort, type SeedCtx } from './context';

/** Prototype part (PARTS 3343). */
export interface ProtoPart {
  ref: string; name: string; mb: string; type: string; price: number; mfr: string; mfrRef: string; equiv: string[]; hs: string; restr: string;
  status: string; rev: string; lead: number; usage: Record<string, number>; pu: string;
}
interface TreeNode { ref: string; q: number; c?: TreeNode[] }

/** Put-away location of the prototype's generated receipts that Settings does not list (genDeliv 4449; 11 §7 #23). */
export const UNCONFIGURED_SITE_STORE = 'Magasin chantier — Lyon';
/** Drawings in the whole PDM vault and time of the last vault sync (dwgKpis 4376: "1 248", "07:40"). */
export const PDM_VAULT_DRAWINGS = 1248;
export const PDM_LAST_SYNC = '07:40';
const DRAWING_FORMATS = 'SLDDRW · PDF · DXF';
const DRAWING_STATE: Record<string, DrawingState> = { Released: 'released', WIP: 'wip', 'Under review': 'under_review', Obsolete: 'obsolete' };

/** Every company the data set cites, scorecard suppliers first (SUPPLIERS order), then manufacturers, RFQ bidders, invoice issuers. */
export function supplierNames(): string[] {
  const names: string[] = [];
  const add = (n: string) => { if (n && !names.includes(n)) names.push(n); };
  for (const [n] of PROTO.SUPPLIERS as [string][]) add(n);
  for (const p of PROTO.PARTS as ProtoPart[]) add(p.mfr);
  for (const r of PROTO.RFQS as { quotes: [string][] }[]) for (const [n] of r.quotes) add(n);
  for (const i of PROTO.INVOICES as { supplier: string }[]) add(i.supplier);
  for (const o of PROTO.HLT_POS as { supplier: string }[]) add(o.supplier);
  return names;
}

export async function seedCatalogue(tx: Tx, ctx: SeedCtx): Promise<void> {
  // Suppliers & manufacturers.
  const scorecard = new Map((PROTO.SUPPLIERS as [string, number, number, number, 'A' | 'B' | 'C', number][]).map((s, i) => [s[0], { s, i }]));
  const supplierRows = supplierNames().map((name, position) => {
    const sc = scorecard.get(name);
    const id = newId();
    ctx.supplierByName.set(name, id);
    return {
      id, name, position, isInternal: name.startsWith('Keystone '),
      onTimeDeliveryPct: sc?.s[1] ?? null, qualityAcceptancePct: sc?.s[2] ?? null, ncrRatePct: sc?.s[3] ?? null, grade: sc?.s[4] ?? null,
      openPoCount: sc?.s[5] ?? null, scorecardPosition: sc ? sc.i : null,
    };
  });
  await tx.insert(suppliers).values(supplierRows);

  // Storage locations (Settings order) + the unconfigured site store of the generated receipts.
  const locs = (PROTO.SETTINGS0.locations as [string, string][]).map(([name, type], position) => ({ name, type: locationType.code(type), position, active: true }));
  locs.push({ name: UNCONFIGURED_SITE_STORE, type: 'site_store', position: locs.length, active: false });
  await tx.insert(storageLocations).values(locs.map((l) => {
    const id = newId();
    ctx.locationByName.set(l.name, id);
    return { id, ...l };
  }));

  // Parts.
  const all = PROTO.PARTS as ProtoPart[];
  const wear = PROTO.WEAR_SPARE as Record<string, WearSpare>;
  await tx.insert(parts).values(all.map((p, position) => {
    const id = newId();
    ctx.partByRef.set(p.ref, id);
    const restr = p.restr && p.restr !== 'None' ? p.restr : null;
    return {
      id, ref: p.ref, name: p.name, makeBuy: partMakeBuy.code(p.mb), type: partType.code(p.type), listPriceEur: p.price,
      manufacturerId: must(ctx.supplierByName, p.mfr, 'manufacturer'), manufacturerRef: p.mfrRef || null,
      hsCode: p.hs && p.hs !== 'n/a' ? p.hs : null, exportRestriction: restr, exportControl: exportControlOf(restr), status: partStatus.code(p.status),
      revision: p.rev && p.rev !== '—' ? p.rev : null, leadWeeks: p.lead || null, wearSpare: wear[p.ref] ?? (p.pu ? (p.pu as WearSpare) : null), position,
    };
  }));
  const equiv = all.flatMap((p) => p.equiv.map((r, position) => ({ partId: must(ctx.partByRef, p.ref, 'part'), equivalentPartId: must(ctx.partByRef, r, 'part'), position })));
  if (equiv.length) await tx.insert(partEquivalents).values(equiv);
  await tx.insert(partLastPrices).values(Object.entries(PROTO.LAST_PRICE as Record<string, number>).map(([ref, unitPriceEur]) => ({ partId: must(ctx.partByRef, ref, 'part'), unitPriceEur })));

  // Product structure (TREE) and the per-project roots (TREES).
  const links: (typeof assemblyLinks.$inferInsert)[] = [];
  const seen = new Set<string>();
  const walk = (n: TreeNode) => {
    (n.c ?? []).forEach((c, position) => {
      const key = `${n.ref}>${c.ref}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ id: newId(), parentPartId: must(ctx.partByRef, n.ref, 'part'), childPartId: must(ctx.partByRef, c.ref, 'part'), quantity: c.q, position });
      }
      walk(c);
    });
  };
  for (const root of Object.values(PROTO.TREES as Record<string, TreeNode>)) walk(root);
  if (links.length) await tx.insert(assemblyLinks).values(links);
  await tx.insert(projectAssemblyRoots).values(Object.entries(PROTO.TREES as Record<string, TreeNode>).map(([p3, root], position) => ({
    id: newId(), projectId: must(ctx.projectByCode, projectCodeOfShort(ctx, p3), 'project'), rootPartId: must(ctx.partByRef, root.ref, 'part'), quantity: root.q, position,
  })));

  // Wear & spare lists of the systems.
  await tx.insert(spareListLines).values(Object.entries(PROTO.SPARE_LISTS as Record<string, [string, WearSpare, number, string][]>).flatMap(([sys, lines]) =>
    lines.map(([ref, kind, qtyPerSystem, note], position) => ({
      id: newId(), systemPartId: must(ctx.partByRef, sys, 'part'), partId: must(ctx.partByRef, ref, 'part'), kind, qtyPerSystem, note: note || null, position,
    }))));

  // Project BOM lines (`usage`), PARTS order within each project.
  const perProject = new Map<string, number>();
  const bom: (typeof projectBomLines.$inferInsert)[] = [];
  for (const p of all) {
    for (const [p3, qty] of Object.entries(p.usage)) {
      if (!(qty > 0)) continue;
      const code = projectCodeOfShort(ctx, p3);
      const position = perProject.get(code) ?? 0;
      perProject.set(code, position + 1);
      bom.push({ id: newId(), projectId: must(ctx.projectByCode, code, 'project'), partId: must(ctx.partByRef, p.ref, 'part'), quantity: qty, position });
    }
  }
  await tx.insert(projectBomLines).values(bom);

  // Revision comparisons.
  for (const [asm, d] of Object.entries(PROTO.REV_DIFF as Record<string, { from: string; to: string; date: string; eco: string; rows: [string, string, string, string, string][] }>)) {
    const diffId = newId();
    await tx.insert(revisionDiffs).values({ id: diffId, assemblyPartId: must(ctx.partByRef, asm, 'part'), fromRevision: d.from, toRevision: d.to, diffDate: isoOfDemoDate(d.date)!, ecoNumber: d.eco || null });
    const qty = (s: string) => (/^\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : null);
    await tx.insert(revisionDiffLines).values(d.rows.map(([path, name, a, b, kind], position) => ({
      id: newId(), diffId, path, name, qtyFrom: qty(a), qtyTo: qty(b), kind: revisionDiffKind.code(kind), position,
    })));
  }

  // PDM drawings and their revision history (A…current, A–D as the prototype shows it).
  const LETTERS = ['A', 'B', 'C', 'D'];
  for (const [position, d] of (PROTO.DRAWINGS as { no: string; title: string; part: string; rev: string; state: string; path: string; by: string; date: string; eco: string }[]).entries()) {
    const id = newId();
    const checkedInOn = isoOfDemoDate(d.date)!;
    await tx.insert(drawings).values({
      id, number: d.no, title: d.title, partId: ctx.partByRef.get(d.part) ?? null, revision: d.rev, state: must(new Map(Object.entries(DRAWING_STATE)), d.state, 'drawing state'),
      vaultPath: d.path, checkedInByName: d.by, checkedInByPersonId: personIdOrNull(ctx, d.by), checkedInOn, ecoNumber: d.eco || null, formats: DRAWING_FORMATS, position,
    });
    const upTo = LETTERS.indexOf(d.rev);
    const revs = upTo >= 0 ? LETTERS.slice(0, upTo + 1) : [d.rev];
    await tx.insert(drawingRevisions).values(revs.map((r) => {
      const current = r === d.rev;
      return { drawingId: id, revision: r, isCurrent: current, checkedInOn: current ? checkedInOn : null, ecoNumber: current ? d.eco || null : null };
    }));
  }
  await tx.insert(pdmVaultSyncs).values({ id: newId(), syncedAt: parisInstant(DEMO_TODAY_ISO, PDM_LAST_SYNC), drawingsInVault: PDM_VAULT_DRAWINGS, drawingsUpdated: 0 });
}
