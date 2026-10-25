// R-158 lot A — Incoterms (reference data of both seeds, owner's decision 9) and the demo shipment (docs/delivery-9/
// notes-r158-shipments.md § 7): HLT-026's contract on DAP « Le Havre — terminal site », and EXP-01 carrying its EQ-02 line
// (3 × MEMU) by road in two 40′ HC containers, packing list validated with one small gap justified (a spare kit outside the BOM).
// HLT-026's BOM lines are all common to the project (R-185 part 2): the content lines are common BOM lines, so the packing control
// shows their quantities against the BOM, the export-restriction alert of the OCR cameras and the per-HS-code summary.
import { and, eq, sql } from 'drizzle-orm';
import { STANDARD_INCOTERMS } from '@/domain/incoterms';
import { itemKey } from '@/domain/shipments';
import { findPerson } from '../helpers';
import {
  contracts, incoterms, parts, projectEquipments, projects, shipmentEquipments, shipmentGapReasons, shipmentItems, shipmentLoads, shipments, shipmentSteps,
} from '../schema';
import type { DB, Tx } from '../types';

/**
 * The 11 Incoterms 2020 (`STANDARD_INCOTERMS`), both seeds and once on a database seeded before R-158. Idempotent: a missing code
 * is added after the existing rows; an existing row (an administrator may have edited it) is never changed.
 */
export async function seedIncoterms(q: DB | Tx): Promise<number> {
  const have = new Set((await q.select({ code: incoterms.code }).from(incoterms)).map((r) => r.code));
  const missing = STANDARD_INCOTERMS.filter((i) => !have.has(i.code));
  if (!missing.length) return 0;
  const [{ max }] = await q.select({ max: sql<number>`coalesce(max(${incoterms.position}), -1)::int` }).from(incoterms);
  await q.insert(incoterms).values(missing.map((i, k) => ({ ...i, standard: true, active: true, position: max + 1 + k }))).onConflictDoNothing({ target: incoterms.code });
  return missing.length;
}

export const DEMO_SHIPMENT = {
  project: 'HLT-026',
  incoterm: 'DAP',
  place: 'Le Havre — terminal site',
  ref: 'EXP-01',
  equipment: 'EQ-02',
  label: 'Modules MEMU M1–M3',
  forwarder: 'Transports Delmas',
  origin: 'Atelier EPC2i — Lyon',
  destination: 'Le Havre — terminal site',
  etd: '2026-10-12',
  eta: '2026-10-14',
  /** Logistics coordinator (src/config/personas.ts). */
  by: 'Camille Verdier',
  steps: [
    ['export_packaging', '2026-09-22', '2026-09-24', 'Crates and moisture barrier per module'],
    ['loading_origin', '2026-10-12', null, null],
    ['export_clearance', null, null, 'Domestic shipment: no export declaration'],
    ['pre_carriage', '2026-10-12', null, null],
    ['main_carriage', '2026-10-12', null, 'Two trucks, convoy'],
    ['insurance', '2026-10-05', null, 'Ad valorem cover requested from the broker'],
    ['on_carriage', '2026-10-14', null, null],
  ] as [string, string | null, string | null, string | null][],
  loads: [
    { type: 'c40hc' as const, identifier: 'MSKU 482190-3', seal: 'SL-118204', grossKg: 9800, items: [
      { part: 'CTL-ANT-COL', quantity: 8, packages: 2, dims: [120, 80, 90], netKg: 96, grossKg: 140 },
      { part: 'CTL-WIND-SN', quantity: 2, packages: 1, dims: [60, 40, 40], netKg: 9, grossKg: 14 },
    ] },
    { type: 'c40hc' as const, identifier: 'TCLU 905514-8', seal: 'SL-118205', grossKg: 8650, items: [
      { part: 'CTL-CAM-OCR', quantity: 12, packages: 3, dims: [80, 60, 60], netKg: 54, grossKg: 78 },
      { description: 'Spare fuse kit — MEMU modules', hsCode: '8536.10', unitValueEur: 180, quantity: 3, packages: 1, dims: [40, 30, 20], netKg: 6, grossKg: 8 },
    ] },
  ],
  /** The free item is outside the BOM: its gap is justified. */
  gapReason: 'Spare kit shipped with the modules, one per module (contract annex — spare parts)',
} as const;

/** The demo contract Incoterm and shipment (demo seed, and once on a demo database seeded before R-158). */
export async function seedDemoShipments(tx: Tx): Promise<void> {
  const d = DEMO_SHIPMENT;
  const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, d.project));
  if (!p) return;
  const [inc] = await tx.select({ id: incoterms.id }).from(incoterms).where(eq(incoterms.code, d.incoterm));
  if (inc) await tx.update(contracts).set({ incotermId: inc.id, incotermPlace: d.place }).where(eq(contracts.projectId, p.id));
  const [eq02] = await tx.select({ id: projectEquipments.id }).from(projectEquipments).where(and(eq(projectEquipments.projectId, p.id), eq(projectEquipments.ref, d.equipment)));
  if (!eq02) return;
  const who = await findPerson(tx, d.by);
  const validatedAt = new Date('2026-09-24T15:00:00Z');
  const [s] = await tx.insert(shipments).values({
    projectId: p.id, ref: d.ref, label: d.label, status: 'prepared', mode: 'road', forwarder: d.forwarder, origin: d.origin, destination: d.destination,
    etd: d.etd, eta: d.eta, packingValidatedAt: validatedAt, packingValidatedByPersonId: who?.id ?? null, createdByPersonId: who?.id ?? null,
  }).returning({ id: shipments.id });
  await tx.insert(shipmentEquipments).values({ shipmentId: s.id, equipmentId: eq02.id });
  await tx.insert(shipmentSteps).values(d.steps.map(([step, plannedOn, actualOn, note]) => ({ shipmentId: s.id, step, plannedOn, actualOn, note })));
  const partId = new Map((await tx.select({ id: parts.id, ref: parts.ref }).from(parts)).map((r) => [r.ref, r.id]));
  let freeItem: string | null = null;
  for (const [i, l] of d.loads.entries()) {
    const [load] = await tx.insert(shipmentLoads).values({ shipmentId: s.id, number: i + 1, type: l.type, identifier: l.identifier, seal: l.seal, grossKg: l.grossKg }).returning({ id: shipmentLoads.id });
    for (const [k, it] of l.items.entries()) {
      const part = 'part' in it ? partId.get(it.part) ?? null : null;
      if ('part' in it && !part) continue;
      const [row] = await tx.insert(shipmentItems).values({
        loadId: load.id, partId: part, description: 'description' in it ? it.description : null, hsCode: 'hsCode' in it ? it.hsCode : null,
        unitValueEur: 'unitValueEur' in it ? it.unitValueEur : null, quantity: it.quantity, packages: it.packages, lengthCm: it.dims[0], widthCm: it.dims[1], heightCm: it.dims[2],
        netKg: it.netKg, grossKg: it.grossKg, originCountry: 'FR', position: k,
      }).returning({ id: shipmentItems.id });
      if (!part) freeItem = row.id;
    }
  }
  if (freeItem) {
    const free = d.loads[1].items[1];
    await tx.insert(shipmentGapReasons).values({ shipmentId: s.id, gapKey: itemKey(freeItem), delta: free.quantity, reason: d.gapReason, byPersonId: who?.id ?? null, at: new Date('2026-09-24T14:30:00Z') });
  }
}

/** A demo database seeded before R-158: no shipment yet. Backfilled once (index.ts). */
export async function demoShipmentsToBackfill(db: DB | Tx): Promise<boolean> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(shipments);
  return n === 0;
}
