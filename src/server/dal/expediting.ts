import 'server-only';
// R-159 (P1, D9-31) — expediting of the purchase orders (src/domain/expediting.ts): the supplier's fabrication progress, the
// inspections at the supplier's works (a FAT tied to an ITP FAT point of the project), the NCR of a failed inspection (owned by
// Vigie: Keystone reads the number Vigie echoes in its NCR mirror, or keeps the one typed — it never writes Vigie's tables) and
// the release notes that authorise the supplier to ship. Every writer re-checks the right (`canEditExpediting`,
// `canIssueRelease`) and the workspace, works in one transaction with the order locked, writes an audit row with the values
// before / after (and the reason of a withdrawal) and an activity event.
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { actorSees } from './team-guard';
import {
  EXPEDITING_STATE_LABEL, activeRelease, deliveryWithoutRelease, expeditingState, inspectionLate, inspectionRef, isLongLead, nextInspection, nextInspectionNumber,
  nextReleaseNumber, parseFabricationProgress, parseInspectionPlan, parseInspectionResult, parseReason, parseReleaseNote, releaseBlockers, releaseRequired,
  type ExpeditingError, type ExpeditingState, type PoInspectionFacts, type PoInspectionKind, type PoInspectionResult, type ReleaseBlocker, type ReleaseNoteFacts,
} from '@/domain/expediting';
import { canEditExpediting, canIssueRelease } from '@/domain/rights';
import { getDb, type DB, type Tx } from '@/server/db/client';
import type { PoStatus, ReceiptStatus } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import {
  goodsReceipts, itpInspections, itpPlans, poExpediting, poInspections, poReleaseNotes, purchaseOrders, vigieNcrs,
} from '@/server/db/schema';
import { vigieNcrUrl } from '@/server/integrations/vigie/links';
import type { Actor } from './ops-common';

type Q = DB | Tx;

export interface PoInspectionRow extends PoInspectionFacts {
  name: string;
  location: string | null;
  inspector: string | null;
  comment: string | null;
  /** NCR number typed in Keystone. */
  ncrRef: string | null;
  /** NCRs Vigie reported from this inspection (its `inspection` echo = "PO-1078/I-2"). */
  ncrs: { number: string; vigieUrl: string }[];
  /** The project's ITP FAT point this FAT stands for. */
  itp: { id: string; number: string; name: string } | null;
  /** "PO-1078/I-2". */
  ref: string;
  late: boolean;
  recordedBy: string | null;
}

export interface ReleaseNoteRow extends ReleaseNoteFacts {
  issuedBy: string;
  inspector: string | null;
  scope: string;
  reserves: string | null;
  withdrawnBy: string | null;
  withdrawReason: string | null;
}

export interface OrderExpediting {
  po: string;
  poStatus: PoStatus;
  longLead: boolean;
  progress: { pct: number; reportedOn: string | null; note: string | null; by: string | null } | null;
  inspections: PoInspectionRow[];
  releases: ReleaseNoteRow[];
  required: boolean;
  release: ReleaseNoteRow | null;
  blockers: ReleaseBlocker[];
  state: ExpeditingState;
  stateLabel: string;
  next: PoInspectionRow | null;
  /** Deliveries of the order flagged for want of a release note (flag only, never blocked). */
  flaggedDeliveries: { number: string; status: ReceiptStatus; on: string | null }[];
  /** ITP FAT points of the project a FAT may be tied to. */
  itpFatPoints: { id: string; number: string; name: string }[];
}

async function orderRow(q: Q, projectId: string, po: string, lock = false) {
  const base = q
    .select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, orderedOn: purchaseOrders.orderedOn, expectedOn: purchaseOrders.expectedOn })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.projectId, projectId), eq(purchaseOrders.number, po)));
  const [row] = lock ? await base.for('update') : await base;
  return row ?? null;
}

const releaseFacts = (r: typeof poReleaseNotes.$inferSelect): ReleaseNoteRow => ({
  number: r.number, issuedOn: r.issuedOn, withdrawn: !!r.withdrawnAt, issuedBy: r.issuedByName, inspector: r.inspectorName, scope: r.scope, reserves: r.reserves,
  withdrawnBy: r.withdrawnByName, withdrawReason: r.withdrawReason,
});

/** The project's ITP FAT points (stage 'fat' of every plan of the project). */
async function itpFatPointsOf(q: Q, projectId: string) {
  return q
    .select({ id: itpInspections.id, number: itpInspections.number, name: itpInspections.name })
    .from(itpInspections)
    .innerJoin(itpPlans, eq(itpPlans.id, itpInspections.planId))
    .where(and(eq(itpPlans.projectId, projectId), eq(itpInspections.stage, 'fat')))
    .orderBy(asc(itpInspections.position));
}

/** The expediting of one order (drawer section); null for an unknown order. */
export async function getOrderExpediting(projectCode: string, po: string, today: string, q?: Q): Promise<OrderExpediting | null> {
  const db = q ?? (await getDb());
  const project = await requireProject(db, projectCode).catch(() => null);
  if (!project) return null;
  const order = await orderRow(db, project.id, po);
  if (!order) return null;
  const [[prog], rows, notes, receipts, fat] = await Promise.all([
    db.select().from(poExpediting).where(eq(poExpediting.poId, order.id)),
    db
      .select({ i: poInspections, itpNumber: itpInspections.number, itpName: itpInspections.name })
      .from(poInspections)
      .leftJoin(itpInspections, eq(itpInspections.id, poInspections.itpInspectionId))
      .where(eq(poInspections.poId, order.id))
      .orderBy(asc(poInspections.position)),
    db.select().from(poReleaseNotes).where(eq(poReleaseNotes.poId, order.id)).orderBy(asc(poReleaseNotes.createdAt)),
    db.select({ number: goodsReceipts.number, status: goodsReceipts.status, receivedOn: goodsReceipts.receivedOn, expectedOn: goodsReceipts.expectedOn })
      .from(goodsReceipts).where(eq(goodsReceipts.poId, order.id)).orderBy(asc(goodsReceipts.position)),
    itpFatPointsOf(db, project.id),
  ]);
  const refs = rows.map(({ i }) => inspectionRef(order.number, i.number));
  const ncrRows = refs.length
    ? await db.select({ number: vigieNcrs.number, vigieRef: vigieNcrs.vigieRef, inspection: vigieNcrs.inspectionNumber }).from(vigieNcrs)
      .where(and(eq(vigieNcrs.projectCode, project.code), inArray(vigieNcrs.inspectionNumber, refs))).orderBy(asc(vigieNcrs.position))
    : [];
  const inspections: PoInspectionRow[] = rows.map(({ i, itpNumber, itpName }) => {
    const ref = inspectionRef(order.number, i.number);
    return {
      number: i.number, kind: i.kind, plannedOn: i.plannedOn, result: i.result, resultOn: i.resultOn, position: i.position, name: i.name, location: i.location,
      inspector: i.inspectorName, comment: i.resultComment, ncrRef: i.ncrRef, ref, late: inspectionLate(i, today), recordedBy: i.resultRecordedByName,
      ncrs: ncrRows.filter((n) => n.inspection === ref).map((n) => ({ number: n.number, vigieUrl: vigieNcrUrl({ number: n.number, vigieRef: n.vigieRef }) })),
      itp: i.itpInspectionId && itpNumber ? { id: i.itpInspectionId, number: itpNumber, name: itpName ?? '' } : null,
    };
  });
  const releases = notes.map(releaseFacts);
  const required = releaseRequired(inspections);
  const state = expeditingState(inspections, releases, today);
  return {
    po: order.number, poStatus: order.status, longLead: isLongLead(order),
    progress: prog ? { pct: prog.fabricationPct, reportedOn: prog.reportedOn, note: prog.note, by: prog.updatedByName } : null,
    inspections, releases, required, release: activeRelease(releases), blockers: releaseBlockers(inspections), state, stateLabel: EXPEDITING_STATE_LABEL[state],
    next: nextInspection(inspections),
    flaggedDeliveries: receipts
      .filter((r) => deliveryWithoutRelease({ required, notes: releases }, r, today))
      .map((r) => ({ number: r.number, status: r.status, on: r.receivedOn ?? r.expectedOn })),
    itpFatPoints: fat,
  };
}

/**
 * The deliveries (goods receipts) of a project flagged for want of a release note — by delivery number (Deliveries screen).
 * Read only; [] when no order of the project has an inspection.
 */
export async function deliveriesWithoutRelease(projectCode: string, today: string, q?: Q): Promise<Set<string>> {
  const db = q ?? (await getDb());
  const project = await requireProject(db, projectCode).catch(() => null);
  if (!project) return new Set();
  const projectId = project.id;
  const withInspections = await db.selectDistinct({ poId: poInspections.poId }).from(poInspections).where(eq(poInspections.projectId, projectId));
  if (!withInspections.length) return new Set();
  const poIds = withInspections.map((r) => r.poId);
  const [notes, receipts] = await Promise.all([
    db.select().from(poReleaseNotes).where(inArray(poReleaseNotes.poId, poIds)).orderBy(asc(poReleaseNotes.createdAt)),
    db.select({ poId: goodsReceipts.poId, number: goodsReceipts.number, receivedOn: goodsReceipts.receivedOn, expectedOn: goodsReceipts.expectedOn })
      .from(goodsReceipts).where(inArray(goodsReceipts.poId, poIds)),
  ]);
  const out = new Set<string>();
  for (const r of receipts) {
    const facts = notes.filter((n) => n.poId === r.poId).map(releaseFacts);
    if (deliveryWithoutRelease({ required: true, notes: facts }, r, today)) out.add(r.number);
  }
  return out;
}

/** R-159: the supplier FATs tied to the ITP FAT points of a project — by ITP inspection id ("PO-1078/I-2" and its result). */
export async function supplierFatsOfItp(projectId: string, q?: Q): Promise<Map<string, { ref: string; result: PoInspectionResult; resultOn: string | null }[]>> {
  const db = q ?? (await getDb());
  const rows = await db
    .select({ itp: poInspections.itpInspectionId, number: poInspections.number, result: poInspections.result, resultOn: poInspections.resultOn, po: purchaseOrders.number })
    .from(poInspections)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poInspections.poId))
    .where(and(eq(poInspections.projectId, projectId), isNotNull(poInspections.itpInspectionId)))
    .orderBy(asc(purchaseOrders.number), asc(poInspections.position));
  const out = new Map<string, { ref: string; result: PoInspectionResult; resultOn: string | null }[]>();
  for (const r of rows) out.set(r.itp!, [...(out.get(r.itp!) ?? []), { ref: inspectionRef(r.po, r.number), result: r.result, resultOn: r.resultOn }]);
  return out;
}

// ── Writers ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export class ExpeditingWriteError extends Error {
  constructor(readonly code: ExpeditingError | 'unknownOrder' | 'unknownInspection' | 'unknownRelease' | 'closedOrder' | 'rights' | 'releaseRights' | 'itp' | 'recorded' | 'withdrawn', readonly detail?: ReleaseBlocker[]) {
    super(code);
  }
}

interface Ctx {
  tx: Tx;
  project: { id: string; code: string };
  po: NonNullable<Awaited<ReturnType<typeof orderRow>>>;
  who: { name: string; personId: string | null };
}

async function context(tx: Tx, projectCode: string, po: string, actor: Actor, right: 'edit' | 'release'): Promise<Ctx> {
  const ok = right === 'release' ? canIssueRelease(actor.role) : canEditExpediting(actor.role);
  if (!ok || !actorSees(actor, 'orders')) throw new ExpeditingWriteError(right === 'release' ? 'releaseRights' : 'rights');
  const project = await requireProject(tx, projectCode);
  const order = await orderRow(tx, project.id, po, true);
  if (!order) throw new ExpeditingWriteError('unknownOrder');
  const person = await findPerson(tx, actor.name);
  return { tx, project, po: order, who: { name: person ? nameOf(person) : actor.name, personId: person?.id ?? null } };
}

const audit = (c: Ctx, entityType: string, change: string, v: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; reason?: string; entityId?: string }) =>
  writeAudit(c.tx, {
    actorName: c.who.name, actorPersonId: c.who.personId, objectRef: `${c.project.code} · ${c.po.number}`, change, area: 'Purchase orders', entityType, entityId: v.entityId,
    projectId: c.project.id, before: v.before ?? null, after: v.after ?? null, reason: v.reason,
  });

const activity = (c: Ctx, text: string) => recordActivity(c.tx, { actorName: c.who.name, actorPersonId: c.who.personId, text, kind: 'change', projectId: c.project.id });

/** An open order: neither a draft nor cancelled. */
function requireOpen(c: Ctx) {
  if (c.po.status === 'cancelled' || c.po.status === 'draft') throw new ExpeditingWriteError('closedOrder');
}

async function inspectionOf(c: Ctx, number: string) {
  const [i] = await c.tx.select().from(poInspections).where(and(eq(poInspections.poId, c.po.id), eq(poInspections.number, number)));
  if (!i) throw new ExpeditingWriteError('unknownInspection');
  return i;
}

/** The ITP FAT point of the project with that id (null for ''); throws when it is not one. */
async function itpPointOf(c: Ctx, id: string | null): Promise<string | null> {
  if (!id) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ExpeditingWriteError('itp');
  const points = await itpFatPointsOf(c.tx, c.project.id);
  if (!points.some((p) => p.id === id)) throw new ExpeditingWriteError('itp');
  return id;
}

/** The supplier's fabrication progress of an order (% and reported date, note). */
export async function setFabricationProgress(projectCode: string, po: string, input: Record<string, unknown>, today: string, actor: Actor): Promise<void> {
  const parsed = parseFabricationProgress(input, today);
  if (!parsed.ok) throw new ExpeditingWriteError(parsed.error);
  const v = parsed.value;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await context(tx, projectCode, po, actor, 'edit');
    requireOpen(c);
    const [cur] = await tx.select().from(poExpediting).where(eq(poExpediting.poId, c.po.id));
    const before = cur ? { pct: cur.fabricationPct, reportedOn: cur.reportedOn, note: cur.note } : null;
    const after = { pct: v.pct, reportedOn: v.reportedOn, note: v.note };
    if (before && before.pct === after.pct && before.reportedOn === after.reportedOn && before.note === after.note) return;
    const set = { fabricationPct: v.pct, reportedOn: v.reportedOn, note: v.note, updatedByName: c.who.name, updatedByPersonId: c.who.personId, updatedAt: new Date() };
    await tx.insert(poExpediting).values({ poId: c.po.id, projectId: c.project.id, ...set }).onConflictDoUpdate({ target: poExpediting.poId, set });
    await audit(c, 'po_expediting', `fabrication progress ${before?.pct ?? 0} % → ${v.pct} %`, { before, after, entityId: c.po.id });
    await activity(c, `Fabrication progress · ${c.po.number} · ${v.pct} %`);
  });
}

/** Plans an inspection (`existing` null) or edits a planned one: kind, name, place, date, inspector, ITP FAT point. */
export async function saveInspection(projectCode: string, po: string, existing: string | null, input: Record<string, unknown>, actor: Actor): Promise<string> {
  const parsed = parseInspectionPlan(input);
  if (!parsed.ok) throw new ExpeditingWriteError(parsed.error);
  const v = parsed.value;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const c = await context(tx, projectCode, po, actor, 'edit');
    requireOpen(c);
    const itpId = await itpPointOf(c, v.itp);
    const fields = { kind: v.kind as PoInspectionKind, name: v.name, location: v.location, plannedOn: v.plannedOn, inspectorName: v.inspector, itpInspectionId: itpId };
    if (!existing) {
      const all = await tx.select({ number: poInspections.number, position: poInspections.position }).from(poInspections).where(eq(poInspections.poId, c.po.id));
      const number = nextInspectionNumber(all.map((r) => r.number));
      const [row] = await tx.insert(poInspections).values({
        poId: c.po.id, projectId: c.project.id, number, ...fields, createdByName: c.who.name, position: all.reduce((m, r) => Math.max(m, r.position + 1), 0),
      }).returning({ id: poInspections.id });
      await audit(c, 'po_inspection', `inspection ${number} planned · ${v.name}`, { after: { number, ...fields }, entityId: row.id });
      await activity(c, `Inspection planned · ${inspectionRef(c.po.number, number)} · ${v.name}`);
      return number;
    }
    const cur = await inspectionOf(c, existing);
    if (cur.result !== 'planned') throw new ExpeditingWriteError('recorded');
    const before = { kind: cur.kind, name: cur.name, location: cur.location, plannedOn: cur.plannedOn, inspectorName: cur.inspectorName, itpInspectionId: cur.itpInspectionId };
    const changed = Object.fromEntries(Object.entries(fields).filter(([k, val]) => before[k as keyof typeof before] !== val));
    if (!Object.keys(changed).length) return cur.number;
    await tx.update(poInspections).set({ ...fields, updatedAt: new Date() }).where(eq(poInspections.id, cur.id));
    await audit(c, 'po_inspection', `inspection ${cur.number} edited`, {
      before: Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof typeof before]])), after: changed, entityId: cur.id,
    });
    await activity(c, `Inspection edited · ${inspectionRef(c.po.number, cur.number)}`);
    return cur.number;
  });
}

/** Removes a planned inspection (a recorded one is kept: it is a quality record). */
export async function removeInspection(projectCode: string, po: string, number: string, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await context(tx, projectCode, po, actor, 'edit');
    const cur = await inspectionOf(c, number);
    if (cur.result !== 'planned') throw new ExpeditingWriteError('recorded');
    await tx.delete(poInspections).where(eq(poInspections.id, cur.id));
    await audit(c, 'po_inspection', `inspection ${number} removed`, { before: { number, kind: cur.kind, name: cur.name, plannedOn: cur.plannedOn }, entityId: cur.id });
    await activity(c, `Inspection removed · ${inspectionRef(c.po.number, number)}`);
  });
}

/** Records (or corrects) the result of an inspection: result, date, inspector, comment, and the NCR number Vigie gave when failed. */
export async function recordInspectionResult(projectCode: string, po: string, number: string, input: Record<string, unknown>, today: string, actor: Actor): Promise<void> {
  const parsed = parseInspectionResult(input, today);
  if (!parsed.ok) throw new ExpeditingWriteError(parsed.error);
  const v = parsed.value;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await context(tx, projectCode, po, actor, 'edit');
    requireOpen(c);
    const cur = await inspectionOf(c, number);
    const before = { result: cur.result, resultOn: cur.resultOn, inspectorName: cur.inspectorName, resultComment: cur.resultComment, ncrRef: cur.ncrRef };
    const after = { result: v.result, resultOn: v.resultOn, inspectorName: v.inspector, resultComment: v.comment, ncrRef: v.ncr };
    if (Object.entries(after).every(([k, val]) => before[k as keyof typeof before] === val)) return;
    await tx.update(poInspections).set({ ...after, resultRecordedByName: c.who.name, resultRecordedAt: new Date(), updatedAt: new Date() }).where(eq(poInspections.id, cur.id));
    await audit(c, 'po_inspection', `inspection ${number} result: ${cur.result} → ${v.result}`, { before, after, entityId: cur.id });
    await activity(c, `Inspection result · ${inspectionRef(c.po.number, number)} · ${v.result}`);
  });
}

/** Issues the order's release note (quality): refused while a blocker remains or a note is already in force. */
export async function issueReleaseNote(projectCode: string, po: string, input: Record<string, unknown>, today: string, actor: Actor): Promise<string> {
  const parsed = parseReleaseNote(input);
  if (!parsed.ok) throw new ExpeditingWriteError(parsed.error);
  const v = parsed.value;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const c = await context(tx, projectCode, po, actor, 'release');
    requireOpen(c);
    const [ins, notes] = await Promise.all([
      tx.select().from(poInspections).where(eq(poInspections.poId, c.po.id)),
      tx.select().from(poReleaseNotes).where(eq(poReleaseNotes.poId, c.po.id)).orderBy(asc(poReleaseNotes.createdAt)),
    ]);
    if (!ins.length) throw new ExpeditingWriteError('noInspection');
    if (activeRelease(notes.map(releaseFacts))) throw new ExpeditingWriteError('released');
    const blockers = releaseBlockers(ins);
    if (blockers.length) throw new ExpeditingWriteError('blocked', blockers);
    const number = nextReleaseNumber(c.po.number, notes.length);
    const [row] = await tx.insert(poReleaseNotes).values({
      poId: c.po.id, projectId: c.project.id, number, issuedOn: today, issuedByName: c.who.name, issuedByPersonId: c.who.personId, inspectorName: v.inspector, scope: v.scope,
      reserves: v.reserves,
    }).returning({ id: poReleaseNotes.id });
    await audit(c, 'po_release_note', `release note ${number} issued`, { after: { number, issuedOn: today, scope: v.scope, reserves: v.reserves, inspector: v.inspector }, entityId: row.id });
    await activity(c, `Release note issued · ${number}`);
    return number;
  });
}

/** Withdraws the release note in force (quality), with a reason; the note is kept, marked withdrawn. */
export async function withdrawReleaseNote(projectCode: string, po: string, number: string, reason: unknown, actor: Actor): Promise<void> {
  const r = parseReason(reason);
  if (!r.ok) throw new ExpeditingWriteError(r.error);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await context(tx, projectCode, po, actor, 'release');
    const [note] = await tx.select().from(poReleaseNotes).where(and(eq(poReleaseNotes.poId, c.po.id), eq(poReleaseNotes.number, number)));
    if (!note) throw new ExpeditingWriteError('unknownRelease');
    if (note.withdrawnAt) throw new ExpeditingWriteError('withdrawn');
    await tx.update(poReleaseNotes).set({ withdrawnAt: new Date(), withdrawnByName: c.who.name, withdrawReason: r.value }).where(eq(poReleaseNotes.id, note.id));
    await audit(c, 'po_release_note', `release note ${number} withdrawn`, { before: { withdrawn: false }, after: { withdrawn: true }, reason: r.value, entityId: note.id });
    await activity(c, `Release note withdrawn · ${number}`);
  });
}

