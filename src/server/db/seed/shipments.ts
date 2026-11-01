// R-158 lot A — Incoterms (reference data of both seeds, owner's decision 9) and the demo shipment (docs/delivery-9/
// notes-r158-shipments.md § 7): HLT-026's contract on DAP « Le Havre — terminal site », and EXP-01 carrying its EQ-02 line
// (3 × MEMU) by road in two 40′ HC containers, packing list validated with one small gap justified (a spare kit outside the BOM).
// HLT-026's BOM lines are all common to the project (R-185 part 2): the content lines are common BOM lines, so the packing control
// shows their quantities against the BOM, the export-restriction alert of the OCR cameras and the per-HS-code summary.
// Lot B (R-158): the shipment dated so that it has happened at the demo date (validated 17 Sep, picked up 21 Sep, arrived 22 Sep
// 2026), a partial site reception pointed on 23 Sep by the site team (the second container's OCR cameras: one damaged → one punch
// item). Its eight shipping documents are generated on demand.
// L9-X3 (owner, 31 Oct 2026): three of them are filed in Codex in the demo data set — the packing list when the packing was
// validated, the CMR and the delivery note at the pick-up — through the real filing (`fileShippingDocumentOn`: PDF generated and
// kept as filed, Codex index record SHP-HLT-0nn rev A released, deposit pending in the Codex outbox), after the seed's transaction.
import { and, eq, sql } from 'drizzle-orm';
import type { ShippingDocKind } from '@/domain/shipping-documents';
import { makeT } from '@/i18n/translate';
import { isoOfDemoDate, parisInstant } from '../codes';
import { nextBusinessNumber } from '../codes';
import { demoFloor } from '../helpers';
import { STANDARD_INCOTERMS } from '@/domain/incoterms';
import { itemKey } from '@/domain/shipments';
import { findPerson } from '../helpers';
import {
  contracts, incoterms, parts, projectEquipments, projects, punchItems, shipmentDocuments, shipmentEquipments,
  shipmentGapReasons, shipmentItems, shipmentLoads, shipmentPunchItems, shipmentReceptionLines, shipments, shipmentSteps,
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
  // R-158 lot B: dated before the demo date (Fri 25 Sep 2026) — the shipment has left and arrived (lot A: 12 → 14 Oct).
  etd: '2026-09-21',
  eta: '2026-09-22',
  atd: '2026-09-21',
  ata: '2026-09-22',
  validatedAt: '2026-09-17T15:00:00Z',
  reasonAt: '2026-09-17T14:30:00Z',
  /** Logistics coordinator (src/config/personas.ts). */
  by: 'Camille Verdier',
  steps: [
    ['export_packaging', '2026-09-15', '2026-09-17', 'Crates and moisture barrier per module'],
    ['loading_origin', '2026-09-21', '2026-09-21', null],
    ['export_clearance', null, null, 'Domestic shipment: no export declaration'],
    ['pre_carriage', '2026-09-21', '2026-09-21', null],
    ['main_carriage', '2026-09-21', '2026-09-22', 'Two trucks, convoy'],
    ['insurance', '2026-09-18', '2026-09-18', 'Ad valorem cover requested from the broker'],
    ['on_carriage', '2026-09-22', '2026-09-22', null],
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
  /** Lot B: the partial reception pointed by the site team (the fuse kits of load 2 not pointed yet). */
  reception: {
    by: 'Julien Wagner',
    on: '2026-09-23',
    /** The OCR cameras of load 2: 11 received, 1 damaged (category B chosen: the camera works, its housing is replaced before the SAT). */
    damaged: { part: 'CTL-CAM-OCR', quantity: 1, note: 'Cracked housing on one camera (crate 2, forklift impact)', category: 'B' as const },
  },
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
  const validatedAt = new Date(d.validatedAt);
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
    await tx.insert(shipmentGapReasons).values({ shipmentId: s.id, gapKey: itemKey(freeItem), delta: free.quantity, reason: d.gapReason, byPersonId: who?.id ?? null, at: new Date(d.reasonAt) });
  }
  await seedDemoShipmentLotB(tx);
}

/**
 * R-158 lot B — EXP-01 picked up and arrived, its partial reception (one damaged camera → one punch item on EQ-02). Runs after the lot A demo (demo seed, and once on a demo database whose EXP-01 has not left yet).
 */
export async function seedDemoShipmentLotB(tx: Tx): Promise<void> {
  const d = DEMO_SHIPMENT;
  const [row] = await tx.select({ s: shipments, code: projects.code, projectId: projects.id }).from(shipments).innerJoin(projects, eq(projects.id, shipments.projectId))
    .where(and(eq(projects.code, d.project), eq(shipments.ref, d.ref)));
  if (!row || row.s.status !== 'prepared') return;
  const s = row.s;
  await tx.update(shipments).set({ status: 'arrived', etd: d.etd, eta: d.eta, atd: d.atd, ata: d.ata, packingValidatedAt: new Date(d.validatedAt), updatedAt: new Date() })
    .where(eq(shipments.id, s.id));
  for (const [step, plannedOn, actualOn, note] of d.steps)
    await tx.insert(shipmentSteps).values({ shipmentId: s.id, step, plannedOn, actualOn, note })
      .onConflictDoUpdate({ target: [shipmentSteps.shipmentId, shipmentSteps.step], set: { plannedOn, actualOn, note } });
  await tx.update(shipmentGapReasons).set({ at: new Date(d.reasonAt) }).where(eq(shipmentGapReasons.shipmentId, s.id));
  // The reception: both loads received; their lines pointed but the fuse kits; one OCR camera damaged.
  const site = await findPerson(tx, d.reception.by);
  const loads = await tx.select().from(shipmentLoads).where(eq(shipmentLoads.shipmentId, s.id));
  const items = await tx.select({ i: shipmentItems, ref: parts.ref, name: parts.name }).from(shipmentItems).leftJoin(parts, eq(parts.id, shipmentItems.partId))
    .where(sql`${shipmentItems.loadId} in (${sql.join(loads.map((l) => sql`${l.id}`), sql`, `)})`);
  const on = d.reception.on;
  for (const l of loads) {
    await tx.insert(shipmentReceptionLines).values({ shipmentId: s.id, loadId: l.id, itemId: null, loadState: 'received', byPersonId: site?.id ?? null, pointedOn: on });
    for (const { i, ref } of items.filter((x) => x.i.loadId === l.id)) {
      if (!ref) continue; // the free item (fuse kits) is not pointed yet: the reception is partial
      const damaged = ref === d.reception.damaged.part ? d.reception.damaged.quantity : 0;
      await tx.insert(shipmentReceptionLines).values({
        shipmentId: s.id, loadId: l.id, itemId: i.id, receivedQty: Number(i.quantity) - damaged, missingQty: 0, damagedQty: damaged,
        note: damaged ? d.reception.damaged.note : null, byPersonId: site?.id ?? null, pointedOn: on,
      });
      if (!damaged) continue;
      const existing = await tx.select({ n: punchItems.number, pos: punchItems.position }).from(punchItems).where(eq(punchItems.projectId, row.projectId));
      const number = nextBusinessNumber(existing.map((e) => e.n), 'P-', 2, await demoFloor(tx, 9));
      const [eq02] = await tx.select({ id: projectEquipments.id }).from(projectEquipments).where(and(eq(projectEquipments.projectId, row.projectId), eq(projectEquipments.ref, d.equipment)));
      const load = `#${l.number}${l.identifier ? ` ${l.identifier}` : ''}`;
      const [pi] = await tx.insert(punchItems).values({
        projectId: row.projectId, register: 'site', number, description: `${d.ref} · Reception · Damaged ${damaged} × ${ref}${items.find((x) => x.i.id === i.id)?.name ? ` ${items.find((x) => x.i.id === i.id)!.name}` : ''} — ${d.reception.damaged.note}`,
        location: `Shipment ${d.ref} · Load ${load}`, category: d.reception.damaged.category, source: 'reception', ownerParty: 'keystone', status: 'open',
        position: existing.reduce((m, e) => Math.max(m, e.pos + 1), 0), equipmentId: eq02?.id ?? null,
      }).returning({ id: punchItems.id });
      await tx.insert(shipmentPunchItems).values({ shipmentId: s.id, punchItemId: pi.id, loadId: l.id, itemId: i.id, gap: 'damaged', quantity: damaged });
    }
  }
}

/** A demo database seeded with lot A only: EXP-01 still "prepared" and nothing pointed. Backfilled once (index.ts). */
export async function demoShipmentLotBToBackfill(db: DB | Tx): Promise<boolean> {
  const [r] = await db.select({ status: shipments.status }).from(shipments).innerJoin(projects, eq(projects.id, shipments.projectId))
    .where(and(eq(projects.code, DEMO_SHIPMENT.project), eq(shipments.ref, DEMO_SHIPMENT.ref)));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(shipmentReceptionLines);
  return r?.status === 'prepared' && n === 0;
}

/** A demo database seeded before R-158: no shipment yet. Backfilled once (index.ts). */
export async function demoShipmentsToBackfill(db: DB | Tx): Promise<boolean> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(shipments);
  return n === 0;
}

/**
 * L9-X3 — EXP-01's documents already filed in Codex in the demo, by the logistics coordinator (`DEMO_SHIPMENT.by`), in French
 * (the default language): the packing list once the packing was validated (17 Sep), the CMR and the delivery note on the pick-up
 * day (21 Sep). The other five stay generated on demand.
 */
export const DEMO_FILED_SHIPPING_DOCUMENTS: readonly { kind: ShippingDocKind; on: string; time: string }[] = [
  { kind: 'packing_list', on: '17 Sep', time: '17:30' },
  { kind: 'cmr', on: '21 Sep', time: '07:40' },
  { kind: 'delivery_note', on: '21 Sep', time: '07:45' },
];

/**
 * Files `DEMO_FILED_SHIPPING_DOCUMENTS` through the real filing, dated on their day (demo seed, after its transaction; and once on
 * a demo database whose EXP-01 has none filed). Each filing runs in its own transaction: the PDF is generated, passed to the
 * antivirus and stored, the Codex index record created and its deposit queued; the deposit is left pending (as the mock connector
 * does — with the HTTP connector the "codex-outbox" job delivers it). Returns how many were filed.
 */
export async function fileDemoShippingDocuments(db: DB): Promise<number> {
  const d = DEMO_SHIPMENT;
  // Loaded at call time: the filing reaches the PDF export and the Codex connector, which the seed's modules never load otherwise.
  const { fileShippingDocumentOn } = await import('@/server/dal/shipment-documents');
  const { getProjectShipmentsOn } = await import('@/server/dal/shipments');
  const actor = { name: d.by, role: 'logistics' };
  const lang = 'fr' as const;
  let n = 0;
  for (const f of DEMO_FILED_SHIPPING_DOCUMENTS) {
    const on = isoOfDemoDate(f.on)!;
    const data = await getProjectShipmentsOn(db, d.project);
    if (!data?.shipments.some((s) => s.ref === d.ref)) return n;
    await fileShippingDocumentOn(db, d.project, d.ref, f.kind, actor, { t: makeT(lang), lang }, { today: on, at: parisInstant(on, f.time), data });
    n++;
  }
  return n;
}

/** A demo database whose EXP-01 has left (lot B) but has no document filed: the L9-X3 documents are filed once (index.ts). */
export async function demoShippingDocumentsToBackfill(db: DB | Tx): Promise<boolean> {
  const [r] = await db.select({ id: shipments.id, status: shipments.status }).from(shipments).innerJoin(projects, eq(projects.id, shipments.projectId))
    .where(and(eq(projects.code, DEMO_SHIPMENT.project), eq(shipments.ref, DEMO_SHIPMENT.ref)));
  if (!r || r.status === 'draft' || r.status === 'prepared') return false;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(shipmentDocuments).where(eq(shipmentDocuments.shipmentId, r.id));
  return n === 0;
}
