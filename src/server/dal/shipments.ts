import 'server-only';
// R-158 lot A — Shipments DAL (docs/delivery-9/notes-r158-shipments.md): the project's shipments with their equipment lines,
// transport steps (from the contract's Incoterm), loads, content lines and gap reasons; the packing control computed from the
// project BOM (src/domain/shipments.ts `packingControl`); and the writers of the Shipments screen. Every writer re-checks the
// rights server-side (`editsShipments`: the director, Logistics, the project's leads), the shipment's status, writes in one
// transaction and records the audit row and the activity event (system messages, R-184). The Server Functions validate the
// input first (src/domain/shipment-input.ts) and revalidate the app.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { INCOTERM_STEP_LABEL, isIncotermStep, readSplit, type IncotermSplit } from '@/domain/incoterms';
import type { ItemInput, LoadInput, ShipmentInput, StepInput } from '@/domain/shipment-input';
import {
  SHIPMENT_STATUS_LABEL, contentEditable, nextShipmentRef, nextShipmentStatus, packingBlocker, packingControl, packingDeliverableBlocker,
  type ControlBomLine, type ControlItem, type GapJustification, type LoadType, type PackingControl, type ShipmentMode, type ShipmentStatus,
} from '@/domain/shipments';
import { systemMessage } from '@/domain/system-messages';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { nameOf } from '@/server/db/helpers';
import {
  contracts, incoterms, parts, persons, projectEquipments, projects, shipmentEquipments, shipmentGapReasons, shipmentItems, shipmentLoads, shipments, shipmentSteps,
} from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { getProjectBom } from './bom';
import { trace, whoIs, type Actor } from './ops-common';
import { editsShipments } from './team-guard';

type Q = DB | Tx;

// ── Reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ShipmentItemRow {
  id: string;
  partRef: string | null;
  /** Catalogue name of a part, or the free item's description (typed). */
  description: string;
  free: boolean;
  hsCode: string | null;
  quantity: number;
  /** € per unit as the control values it (BOM valuation, catalogue price, typed value). */
  unitValueEur: number | null;
  packages: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  netKg: number | null;
  grossKg: number | null;
  originCountry: string | null;
  exportRestriction: string | null;
}

export interface ShipmentLoadRow {
  id: string;
  number: number;
  type: LoadType;
  identifier: string | null;
  seal: string | null;
  grossKg: number | null;
  note: string | null;
  items: ShipmentItemRow[];
}

export interface ShipmentRow {
  id: string;
  ref: string;
  label: string | null;
  status: ShipmentStatus;
  mode: ShipmentMode | null;
  forwarder: string | null;
  origin: string | null;
  destination: string | null;
  etd: string | null;
  eta: string | null;
  atd: string | null;
  ata: string | null;
  note: string | null;
  equipment: { id: string; ref: string }[];
  steps: { step: string; plannedOn: string | null; actualOn: string | null; note: string | null }[];
  loads: ShipmentLoadRow[];
  justifications: GapJustification[];
  packingValidatedAt: string | null;
  packingValidatedBy: string | null;
  control: PackingControl;
}

export interface ProjectShipments {
  projectId: string;
  /** The project's equipment lines (R-185), in order. */
  equipment: { id: string; ref: string; machineTypeCode: string; quantity: number; label: string | null }[];
  hasContract: boolean;
  incoterm: { code: string; nameEn: string; nameFr: string; descriptionEn: string; descriptionFr: string; modes: 'any' | 'sea'; split: IncotermSplit; active: boolean } | null;
  incotermPlace: string | null;
  shipments: ShipmentRow[];
  /** The project's BOM articles (content form choices): ref, name, equipment line ref (null = common). */
  bom: { ref: string; name: string; equipmentRef: string | null; quantity: number }[];
}

const num = (v: number | null) => (v == null ? null : Number(v));

type Bom = Awaited<ReturnType<typeof getProjectBom>>;

/** Everything the Shipments screen and the rules need for one project; null for an unknown project. */
export async function getProjectShipments(projectCode: string): Promise<ProjectShipments | null> {
  return readShipments(await getDb(), projectCode, await getProjectBom(projectCode));
}

/**
 * `getProjectShipments` on `db` (a transaction of a writer) with the project BOM read beforehand — the BOM valuation reads
 * outside any transaction (PGlite runs one at a time: a read outside the open transaction would wait for it).
 */
async function readShipments(db: Q, projectCode: string, bom: Bom): Promise<ProjectShipments | null> {
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, projectCode));
  if (!p) return null;
  const [equipment, [contract], rows] = await Promise.all([
    db.select({ id: projectEquipments.id, ref: projectEquipments.ref, machineTypeCode: projectEquipments.machineTypeCode, quantity: projectEquipments.quantity, label: projectEquipments.label })
      .from(projectEquipments).where(eq(projectEquipments.projectId, p.id)).orderBy(asc(projectEquipments.position), asc(projectEquipments.ref)),
    db.select({ incotermId: contracts.incotermId, place: contracts.incotermPlace }).from(contracts).where(eq(contracts.projectId, p.id)),
    db.select().from(shipments).where(eq(shipments.projectId, p.id)).orderBy(asc(shipments.ref)),
  ]);
  const [inc] = contract?.incotermId ? await db.select().from(incoterms).where(eq(incoterms.id, contract.incotermId)) : [];
  const ids = rows.map((r) => r.id);
  const [eqRows, stepRows, loadRows, reasonRows, validators] = ids.length
    ? await Promise.all([
      db.select({ shipmentId: shipmentEquipments.shipmentId, id: projectEquipments.id, ref: projectEquipments.ref })
        .from(shipmentEquipments).innerJoin(projectEquipments, eq(projectEquipments.id, shipmentEquipments.equipmentId)).where(inArray(shipmentEquipments.shipmentId, ids))
        .orderBy(asc(projectEquipments.position)),
      db.select().from(shipmentSteps).where(inArray(shipmentSteps.shipmentId, ids)),
      db.select().from(shipmentLoads).where(inArray(shipmentLoads.shipmentId, ids)).orderBy(asc(shipmentLoads.number)),
      db.select({ r: shipmentGapReasons, by: persons.fullName, byShort: persons.shortName }).from(shipmentGapReasons)
        .leftJoin(persons, eq(persons.id, shipmentGapReasons.byPersonId)).where(inArray(shipmentGapReasons.shipmentId, ids)),
      db.select({ id: persons.id, fullName: persons.fullName, shortName: persons.shortName }).from(persons)
        .where(inArray(persons.id, rows.map((r) => r.packingValidatedByPersonId).filter((x): x is string => !!x).concat(['00000000-0000-0000-0000-000000000000']))),
    ])
    : [[], [], [], [], []];
  const loadIds = loadRows.map((l) => l.id);
  const itemRows = loadIds.length
    ? await db.select({ i: shipmentItems, ref: parts.ref, name: parts.name, hs: parts.hsCode, na: parts.hsNotApplicable, price: parts.listPriceEur, restr: parts.exportRestriction })
      .from(shipmentItems).leftJoin(parts, eq(parts.id, shipmentItems.partId)).where(inArray(shipmentItems.loadId, loadIds)).orderBy(asc(shipmentItems.position))
    : [];

  const eqById = new Map(equipment.map((e) => [e.ref, e.id]));
  const bomLines: ControlBomLine[] = (bom?.lines ?? []).map((l) => ({
    partRef: l.ref, name: l.name, equipmentId: l.equipmentRef ? eqById.get(l.equipmentRef) ?? null : null, quantity: l.quantity, unitValueEur: l.unitPriceEur,
    hsCode: l.hsCode, hsNotApplicable: l.hsNotApplicable, exportRestriction: l.exportRestriction,
  }));
  const bomByRef = new Map(bomLines.map((b) => [b.partRef, b]));
  const loadsOf = new Map<string, ShipmentLoadRow[]>();
  const shipmentOfLoad = new Map<string, string>();
  for (const l of loadRows) {
    shipmentOfLoad.set(l.id, l.shipmentId);
    const list = loadsOf.get(l.shipmentId) ?? [];
    list.push({ id: l.id, number: l.number, type: l.type, identifier: l.identifier, seal: l.seal, grossKg: num(l.grossKg), note: l.note, items: [] });
    loadsOf.set(l.shipmentId, list);
  }
  const loadById = new Map([...loadsOf.values()].flat().map((l) => [l.id, l]));
  // Quantity of each part per shipment (the "earlier shipments" of the control).
  const packedBy = new Map<string, Map<string, number>>();
  for (const { i, ref, name, hs, price, restr } of itemRows) {
    const b = ref ? bomByRef.get(ref) : undefined;
    const load = loadById.get(i.loadId)!;
    load.items.push({
      id: i.id, partRef: ref, description: ref ? (b?.name ?? name ?? ref) : (i.description ?? ''), free: !ref, hsCode: ref ? (b ? b.hsCode : hs) : i.hsCode,
      quantity: Number(i.quantity), unitValueEur: ref ? (b ? b.unitValueEur : num(price)) : num(i.unitValueEur), packages: i.packages,
      lengthCm: num(i.lengthCm), widthCm: num(i.widthCm), heightCm: num(i.heightCm), netKg: num(i.netKg), grossKg: num(i.grossKg), originCountry: i.originCountry,
      exportRestriction: ref ? (b ? b.exportRestriction : restr) : null,
    });
    if (ref) {
      const sid = shipmentOfLoad.get(i.loadId)!;
      const m = packedBy.get(sid) ?? new Map<string, number>();
      m.set(ref, (m.get(ref) ?? 0) + Number(i.quantity));
      packedBy.set(sid, m);
    }
  }
  const naByItem = new Map(itemRows.map((r) => [r.i.id, !!r.na]));
  const validatorName = new Map(validators.map((v) => [v.id, nameOf(v)]));
  const numberOf = new Map(rows.map((r) => [r.id, parseInt(r.ref.slice(4), 10)]));
  const out: ShipmentRow[] = rows.map((r) => {
    const loads = loadsOf.get(r.id) ?? [];
    const items: ControlItem[] = loads.flatMap((l) => l.items.map((it) => ({
      id: it.id, partRef: it.partRef, description: it.description, quantity: it.quantity, hsCode: it.hsCode, hsNotApplicable: naByItem.get(it.id) ?? false,
      unitValueEur: it.unitValueEur, exportRestriction: it.exportRestriction, originCountry: it.originCountry, netKg: it.netKg, grossKg: it.grossKg,
      loadLabel: `#${l.number}`,
    })));
    const elsewhere = new Map<string, number>();
    // The project's EARLIER shipments (lower EXP number): a later shipment never changes the control of a validated one.
    for (const [sid, m] of packedBy) if (numberOf.get(sid)! < numberOf.get(r.id)!) for (const [ref, n] of m) elsewhere.set(ref, (elsewhere.get(ref) ?? 0) + n);
    const justifications: GapJustification[] = reasonRows.filter((x) => x.r.shipmentId === r.id).map((x) => ({
      key: x.r.gapKey, delta: Number(x.r.delta), reason: x.r.reason, by: x.by ?? x.byShort ?? null, at: x.r.at.toISOString(),
    }));
    const eqs = eqRows.filter((e) => e.shipmentId === r.id).map((e) => ({ id: e.id, ref: e.ref }));
    const control = packingControl({ bom: bomLines, equipmentIds: eqs.map((e) => e.id), items, packedElsewhere: elsewhere, justifications });
    return {
      id: r.id, ref: r.ref, label: r.label, status: r.status, mode: r.mode, forwarder: r.forwarder, origin: r.origin, destination: r.destination,
      etd: r.etd, eta: r.eta, atd: r.atd, ata: r.ata, note: r.note, equipment: eqs,
      steps: stepRows.filter((s) => s.shipmentId === r.id).map((s) => ({ step: s.step, plannedOn: s.plannedOn, actualOn: s.actualOn, note: s.note })),
      loads, justifications, packingValidatedAt: r.packingValidatedAt?.toISOString() ?? null,
      packingValidatedBy: r.packingValidatedByPersonId ? validatorName.get(r.packingValidatedByPersonId) ?? null : null, control,
    };
  });
  return {
    projectId: p.id, equipment, hasContract: !!contract,
    incoterm: inc ? { code: inc.code, nameEn: inc.nameEn, nameFr: inc.nameFr, descriptionEn: inc.descriptionEn, descriptionFr: inc.descriptionFr, modes: inc.modes, split: readSplit(inc.split), active: inc.active } : null,
    incotermPlace: contract?.place ?? null, shipments: out,
    bom: (bom?.lines ?? []).map((l) => ({ ref: l.ref, name: l.name, equipmentRef: l.equipmentRef ?? null, quantity: l.quantity })),
  };
}

/**
 * R-158 (decision 4): why « Colisage & documents douaniers » cannot be ticked on the project (EN source), null when it can —
 * `packingDeliverableBlocker` on the project's shipments (packing list validated and control still cleared).
 */
export async function packingDeliverableRefusal(projectCode: string, target: { stage: string; position: number; done: boolean }): Promise<string | null> {
  // Only the tick of « Colisage & documents douaniers » is ruled (no read otherwise).
  if (packingDeliverableBlocker(target, []) === null) return null;
  const data = await getProjectShipments(projectCode);
  if (!data) return null;
  return packingDeliverableBlocker(target, data.shipments.map((s) => ({ validated: !!s.packingValidatedAt, cleared: s.control.cleared })));
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────────────────

const READ_ONLY = 'The shipments are read-only for you';
export const SHIPMENT_ERRORS = [
  READ_ONLY, 'Unknown shipment', 'Unknown load', 'Unknown item', 'Unknown equipment line', 'Unknown part', 'Unknown gap',
  'The content of a shipment picked up is frozen', 'Only a draft shipment can be removed', 'The status has changed meanwhile',
  'This step is the buyer’s under the contract’s Incoterm', 'The project has no contract Incoterm yet', 'Validate the packing list first',
  'Nothing is packed yet', 'An item has no HS code: complete the part in the PLM (or the item) first', 'Justify each gap of the packing control first',
  'This gap is already cleared', 'A closed shipment is read-only',
] as const;

interface Ctx {
  project: { id: string; code: string };
  who: { personId: string | null; who: string };
}

/** The project and the actor's right to write its shipments (re-checked here, in the transaction). */
async function writer(tx: Tx, projectCode: string, actor: Actor): Promise<Ctx> {
  const [p] = await tx.select({ id: projects.id, code: projects.code }).from(projects).where(eq(projects.code, projectCode));
  if (!p) throw new Error('Unknown shipment');
  if (!(await editsShipments(tx, actor, p.id))) throw new Error(READ_ONLY);
  return { project: p, who: await whoIs(tx, actor) };
}

async function shipmentOf(tx: Tx, projectId: string, ref: string) {
  const [s] = await tx.select().from(shipments).where(and(eq(shipments.projectId, projectId), eq(shipments.ref, ref)));
  if (!s) throw new Error('Unknown shipment');
  return s;
}

async function equipmentIds(tx: Tx, projectId: string, refs: readonly string[]): Promise<{ id: string; ref: string }[]> {
  const rows = await tx.select({ id: projectEquipments.id, ref: projectEquipments.ref }).from(projectEquipments)
    .where(and(eq(projectEquipments.projectId, projectId), inArray(projectEquipments.ref, [...refs])));
  if (rows.length !== refs.length) throw new Error('Unknown equipment line');
  return refs.map((r) => rows.find((x) => x.ref === r)!);
}

/** A content change: refused once picked up; a prepared shipment goes back to draft (its packing list must be validated again). */
async function touchContent(tx: Tx, s: typeof shipments.$inferSelect, c: Ctx): Promise<void> {
  if (!contentEditable(s.status)) throw new Error('The content of a shipment picked up is frozen');
  await tx.update(shipments).set({ status: 'draft', packingValidatedAt: null, packingValidatedByPersonId: null, updatedAt: new Date() }).where(eq(shipments.id, s.id));
  if (s.status === 'prepared') {
    const message = systemMessage('shipment.status', { project: c.project.code, ref: s.ref, from: SHIPMENT_STATUS_LABEL.prepared, to: SHIPMENT_STATUS_LABEL.draft });
    await trace(tx, c.who, { objectRef: `Shipment ${s.ref}`, area: 'Shipments', entityType: 'shipment', entityId: s.id, projectId: c.project.id, message, before: { status: 'prepared' }, after: { status: 'draft' } });
  }
}

const contentTrace = (tx: Tx, c: Ctx, s: { id: string; ref: string }, what: string, item: string, extra: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null } = {}) => {
  const message = systemMessage('shipment.content', { project: c.project.code, ref: s.ref, what, item });
  return trace(tx, c.who, { objectRef: `Shipment ${s.ref}`, area: 'Shipments', entityType: 'shipment', entityId: s.id, projectId: c.project.id, message, ...extra, activity: { kind: 'change', message } });
};

const headerOf = (i: ShipmentInput) => ({
  label: i.label, mode: i.mode, forwarder: i.forwarder, origin: i.origin, destination: i.destination, etd: i.etd, eta: i.eta, atd: i.atd, ata: i.ata, note: i.note,
});

/** "New shipment": EXP-nn, draft, its equipment lines. Returns the reference. */
export async function createShipment(projectCode: string, input: ShipmentInput, actor: Actor): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const eqs = await equipmentIds(tx, c.project.id, input.equipment);
    const refs = (await tx.select({ ref: shipments.ref }).from(shipments).where(eq(shipments.projectId, c.project.id))).map((r) => r.ref);
    const ref = nextShipmentRef(refs);
    const [s] = await tx.insert(shipments).values({ projectId: c.project.id, ref, status: 'draft', ...headerOf(input), createdByPersonId: c.who.personId }).returning({ id: shipments.id });
    await tx.insert(shipmentEquipments).values(eqs.map((e) => ({ shipmentId: s.id, equipmentId: e.id })));
    const message = systemMessage('shipment.created', { project: c.project.code, ref, equipment: eqs.map((e) => e.ref) });
    await trace(tx, c.who, {
      objectRef: `Shipment ${ref}`, area: 'Shipments', entityType: 'shipment', entityId: s.id, projectId: c.project.id, message, after: { ...headerOf(input), equipment: input.equipment },
      activity: { kind: 'change', message },
    });
    return ref;
  });
}

/** "Edit shipment": header fields any time before closure; the equipment lines while the content is editable. */
export async function updateShipment(projectCode: string, ref: string, input: ShipmentInput, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    if (s.status === 'closed') throw new Error('A closed shipment is read-only');
    const eqs = await equipmentIds(tx, c.project.id, input.equipment);
    const cur = (await tx.select({ id: shipmentEquipments.equipmentId }).from(shipmentEquipments).where(eq(shipmentEquipments.shipmentId, s.id))).map((r) => r.id);
    const changedEq = cur.length !== eqs.length || eqs.some((e) => !cur.includes(e.id));
    if (changedEq) {
      // The equipment lines decide the BOM the content is controlled against: a change reopens the packing list.
      await touchContent(tx, s, c);
      await tx.delete(shipmentEquipments).where(eq(shipmentEquipments.shipmentId, s.id));
      await tx.insert(shipmentEquipments).values(eqs.map((e) => ({ shipmentId: s.id, equipmentId: e.id })));
    }
    const before = headerOf({ ...s, equipment: [] } as unknown as ShipmentInput);
    await tx.update(shipments).set({ ...headerOf(input), updatedAt: new Date() }).where(eq(shipments.id, s.id));
    const message = systemMessage('shipment.edited', { project: c.project.code, ref });
    await trace(tx, c.who, {
      objectRef: `Shipment ${ref}`, area: 'Shipments', entityType: 'shipment', entityId: s.id, projectId: c.project.id, message, before, after: { ...headerOf(input), equipment: input.equipment },
      activity: { kind: 'change', message },
    });
  });
}

/** "Remove" a draft shipment (its loads, content, steps and reasons with it). */
export async function removeShipment(projectCode: string, ref: string, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    if (s.status !== 'draft') throw new Error('Only a draft shipment can be removed');
    await tx.delete(shipments).where(eq(shipments.id, s.id));
    const message = systemMessage('shipment.removed', { project: c.project.code, ref });
    await trace(tx, c.who, { objectRef: `Shipment ${ref}`, area: 'Shipments', entityType: 'shipment', entityId: s.id, projectId: c.project.id, message, before: { status: s.status }, activity: { kind: 'change', message } });
  });
}

const loadAfter = (i: LoadInput) => ({ type: i.type, identifier: i.identifier, seal: i.seal, grossKg: i.grossKg, note: i.note });

/** "Add load" (truck or container); returns its number. */
export async function addLoad(projectCode: string, ref: string, input: LoadInput, actor: Actor): Promise<number> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    await touchContent(tx, s, c);
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${shipmentLoads.number}), 0)::int` }).from(shipmentLoads).where(eq(shipmentLoads.shipmentId, s.id));
    await tx.insert(shipmentLoads).values({ shipmentId: s.id, number: max + 1, ...loadAfter(input) });
    await contentTrace(tx, c, s, 'Load added', `#${max + 1}${input.identifier ? ` ${input.identifier}` : ''}`, { after: loadAfter(input) });
    return max + 1;
  });
}

async function loadOf(tx: Tx, shipmentId: string, number: number) {
  const [l] = await tx.select().from(shipmentLoads).where(and(eq(shipmentLoads.shipmentId, shipmentId), eq(shipmentLoads.number, number)));
  if (!l) throw new Error('Unknown load');
  return l;
}

/** "Edit load". */
export async function updateLoad(projectCode: string, ref: string, number: number, input: LoadInput, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    const l = await loadOf(tx, s.id, number);
    await touchContent(tx, s, c);
    await tx.update(shipmentLoads).set({ ...loadAfter(input), updatedAt: new Date() }).where(eq(shipmentLoads.id, l.id));
    await contentTrace(tx, c, s, 'Load edited', `#${number}`, { before: loadAfter({ ...l, grossKg: num(l.grossKg) }), after: loadAfter(input) });
  });
}

/** "Remove load" (and its content). */
export async function removeLoad(projectCode: string, ref: string, number: number, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    const l = await loadOf(tx, s.id, number);
    await touchContent(tx, s, c);
    await tx.delete(shipmentLoads).where(eq(shipmentLoads.id, l.id));
    await contentTrace(tx, c, s, 'Load removed', `#${number}`, { before: loadAfter({ ...l, grossKg: num(l.grossKg) }) });
  });
}

const itemAfter = (i: Omit<ItemInput, 'partRef'> & { partId: string | null }) => ({
  partId: i.partId, description: i.description, hsCode: i.hsCode, unitValueEur: i.unitValueEur, quantity: i.quantity, packages: i.packages,
  lengthCm: i.lengthCm, widthCm: i.widthCm, heightCm: i.heightCm, netKg: i.netKg, grossKg: i.grossKg, originCountry: i.originCountry,
});

async function partIdOf(tx: Tx, ref: string | null): Promise<string | null> {
  if (!ref) return null;
  const [p] = await tx.select({ id: parts.id }).from(parts).where(eq(parts.ref, ref));
  if (!p) throw new Error('Unknown part');
  return p.id;
}

/** "Add content" to load `number`: a catalogue part or a free item. Returns the content line id. */
export async function addItem(projectCode: string, ref: string, number: number, input: ItemInput, actor: Actor): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    const l = await loadOf(tx, s.id, number);
    await touchContent(tx, s, c);
    const partId = await partIdOf(tx, input.partRef);
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${shipmentItems.position}), -1)::int` }).from(shipmentItems).where(eq(shipmentItems.loadId, l.id));
    const values = itemAfter({ ...input, partId });
    const [row] = await tx.insert(shipmentItems).values({ loadId: l.id, ...values, position: max + 1 }).returning({ id: shipmentItems.id });
    await contentTrace(tx, c, s, 'Item added', `${input.partRef ?? input.description ?? ''} × ${input.quantity}`, { after: { load: number, ...values } });
    return row.id;
  });
}

async function itemOf(tx: Tx, shipmentId: string, id: string) {
  const [r] = await tx.select({ i: shipmentItems, number: shipmentLoads.number, ref: parts.ref }).from(shipmentItems)
    .innerJoin(shipmentLoads, eq(shipmentLoads.id, shipmentItems.loadId)).leftJoin(parts, eq(parts.id, shipmentItems.partId))
    .where(and(eq(shipmentItems.id, id), eq(shipmentLoads.shipmentId, shipmentId)));
  if (!r) throw new Error('Unknown item');
  return r;
}

/** "Edit content" (a content line moves to another load with `number`). */
export async function updateItem(projectCode: string, ref: string, id: string, number: number, input: ItemInput, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    const cur = await itemOf(tx, s.id, id);
    const l = await loadOf(tx, s.id, number);
    await touchContent(tx, s, c);
    const partId = await partIdOf(tx, input.partRef);
    const values = itemAfter({ ...input, partId });
    await tx.update(shipmentItems).set({ ...values, loadId: l.id, updatedAt: new Date() }).where(eq(shipmentItems.id, id));
    const b = cur.i;
    await contentTrace(tx, c, s, 'Item edited', `${input.partRef ?? input.description ?? ''} × ${input.quantity}`, {
      before: { load: cur.number, partId: b.partId, description: b.description, quantity: Number(b.quantity), netKg: num(b.netKg), grossKg: num(b.grossKg) },
      after: { load: number, ...values },
    });
  });
}

/** "Remove content". */
export async function removeItem(projectCode: string, ref: string, id: string, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    const cur = await itemOf(tx, s.id, id);
    await touchContent(tx, s, c);
    await tx.delete(shipmentItems).where(eq(shipmentItems.id, id));
    await contentTrace(tx, c, s, 'Item removed', `${cur.ref ?? cur.i.description ?? ''} × ${Number(cur.i.quantity)}`, { before: { load: cur.number, quantity: Number(cur.i.quantity) } });
  });
}

/** The control of one shipment as the screen computes it, in the writer's transaction (`bom` read before it). */
async function controlNow(projectCode: string, shipmentId: string, tx: Tx, bom: Bom) {
  const data = await readShipments(tx, projectCode, bom);
  const s = data?.shipments.find((x) => x.id === shipmentId);
  if (!s) throw new Error('Unknown shipment');
  return s;
}

/** "Justify" a packing-control gap: the reason holds for the gap's current difference. */
export async function justifyGap(projectCode: string, ref: string, key: string, reason: string, actor: Actor): Promise<void> {
  const db = await getDb();
  const bom = await getProjectBom(projectCode);
  await db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    if (!contentEditable(s.status)) throw new Error('The content of a shipment picked up is frozen');
    const line = (await controlNow(projectCode, s.id, tx, bom)).control.lines.find((l) => l.key === key);
    if (!line || !line.gap) throw new Error('Unknown gap');
    await tx.insert(shipmentGapReasons).values({ shipmentId: s.id, gapKey: key, delta: line.delta, reason, byPersonId: c.who.personId, at: new Date() })
      .onConflictDoUpdate({ target: [shipmentGapReasons.shipmentId, shipmentGapReasons.gapKey], set: { delta: line.delta, reason, byPersonId: c.who.personId, at: new Date() } });
    const message = systemMessage('shipment.gapJustified', { project: c.project.code, ref, item: line.partRef ? `${line.partRef} · ${line.name}` : line.name, reason });
    await trace(tx, c.who, {
      objectRef: `Shipment ${ref}`, area: 'Shipments', entityType: 'shipment', entityId: s.id, projectId: c.project.id, message, reason,
      after: { gap: line.gap, key, expected: line.expected, packed: line.packed, delta: line.delta }, activity: { kind: 'change', message },
    });
  });
}

/** "Validate packing list": the control must be cleared (decision 4) → status prepared. */
export async function validatePacking(projectCode: string, ref: string, actor: Actor): Promise<void> {
  const db = await getDb();
  const bom = await getProjectBom(projectCode);
  await db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    if (s.status !== 'draft') throw new Error('The status has changed meanwhile');
    const blocker = packingBlocker((await controlNow(projectCode, s.id, tx, bom)).control);
    if (blocker) throw new Error(blocker);
    await tx.update(shipments).set({ status: 'prepared', packingValidatedAt: new Date(), packingValidatedByPersonId: c.who.personId, updatedAt: new Date() }).where(eq(shipments.id, s.id));
    const message = systemMessage('shipment.status', { project: c.project.code, ref, from: SHIPMENT_STATUS_LABEL.draft, to: SHIPMENT_STATUS_LABEL.prepared });
    await trace(tx, c.who, { objectRef: `Shipment ${ref}`, area: 'Shipments', entityType: 'shipment', entityId: s.id, projectId: c.project.id, message, before: { status: 'draft' }, after: { status: 'prepared' }, activity: { kind: 'change', message } });
  });
}

/** "Reopen packing list": prepared → draft. */
export async function reopenPacking(projectCode: string, ref: string, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    if (s.status !== 'prepared') throw new Error('The status has changed meanwhile');
    await touchContent(tx, s, c);
  });
}

/**
 * "Advance" one status (prepared → picked up → in transit → arrived → received → closed). `from` is the status the viewer saw
 * (a stale click is refused). Picking up records the actual departure, arriving the actual arrival, when not entered (today).
 */
export async function advanceShipment(projectCode: string, ref: string, from: ShipmentStatus, actor: Actor): Promise<ShipmentStatus> {
  const db = await getDb();
  const today = await businessToday();
  return db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    const to = nextShipmentStatus(s.status);
    if (s.status !== from || !to) throw new Error(s.status === 'draft' ? 'Validate the packing list first' : 'The status has changed meanwhile');
    const set: Partial<typeof shipments.$inferInsert> = { status: to, updatedAt: new Date() };
    if (to === 'picked_up' && !s.atd) set.atd = today;
    if (to === 'arrived' && !s.ata) set.ata = today;
    await tx.update(shipments).set(set).where(eq(shipments.id, s.id));
    const message = systemMessage('shipment.status', { project: c.project.code, ref, from: SHIPMENT_STATUS_LABEL[s.status], to: SHIPMENT_STATUS_LABEL[to] });
    await trace(tx, c.who, {
      objectRef: `Shipment ${ref}`, area: 'Shipments', entityType: 'shipment', entityId: s.id, projectId: c.project.id, message,
      before: { status: s.status, atd: s.atd, ata: s.ata }, after: { status: to, atd: set.atd ?? s.atd, ata: set.ata ?? s.ata }, activity: { kind: 'change', message },
    });
    return to;
  });
}

/** "Edit step": planned / actual date and note of a step EPC2i organises under the contract's Incoterm. */
export async function setShipmentStep(projectCode: string, ref: string, input: StepInput, actor: Actor): Promise<void> {
  if (!isIncotermStep(input.step)) throw new Error('Unknown shipment');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    if (s.status === 'closed') throw new Error('A closed shipment is read-only');
    const [ct] = await tx.select({ split: incoterms.split }).from(contracts).innerJoin(incoterms, eq(incoterms.id, contracts.incotermId)).where(eq(contracts.projectId, c.project.id));
    if (!ct) throw new Error('The project has no contract Incoterm yet');
    if (readSplit(ct.split)[input.step] !== 'seller') throw new Error('This step is the buyer’s under the contract’s Incoterm');
    const [cur] = await tx.select().from(shipmentSteps).where(and(eq(shipmentSteps.shipmentId, s.id), eq(shipmentSteps.step, input.step)));
    const values = { plannedOn: input.plannedOn, actualOn: input.actualOn, note: input.note };
    await tx.insert(shipmentSteps).values({ shipmentId: s.id, step: input.step, ...values })
      .onConflictDoUpdate({ target: [shipmentSteps.shipmentId, shipmentSteps.step], set: { ...values, updatedAt: new Date() } });
    const message = systemMessage('shipment.step', { project: c.project.code, ref, step: INCOTERM_STEP_LABEL[input.step] });
    await trace(tx, c.who, {
      objectRef: `Shipment ${ref}`, area: 'Shipments', entityType: 'shipment', entityId: s.id, projectId: c.project.id, message,
      before: cur ? { step: input.step, plannedOn: cur.plannedOn, actualOn: cur.actualOn, note: cur.note } : null, after: { step: input.step, ...values },
      activity: { kind: 'change', message },
    });
  });
}
