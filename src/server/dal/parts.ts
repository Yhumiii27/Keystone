import 'server-only';
// PLM — parts catalogue DAL (docs/spec/09 §2 part record, §3 PLM; 11 §3.9 Part). Catalogue rows with their customs and
// export data, equivalents, last purchase price and usage per project (BOM lines); the part record adds the projects
// equipped, the spare list of a system, the Codex documents citing the part, the Vigie ECOs and the installed base.
// Writers: "New part" (AF.plm) and "Register equivalent" (no handler in the prototype). HS code, quantities and values
// stay first-class for the future "Expédition & transport" module (docs/BACKLOG.md §1).
import { asc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import {
  PART_FAMILY_TYPE, PART_STATUS_NOTE, PART_UNITS, exportControl, partFamily, partMakeBuy, partStatus, partType, stage as stageCodec, wearSpare,
  type ExportControl, type PartFamily, type PartMakeBuy, type PartStatus, type PartType, type PartUnit, type StageCode, type WearSpare,
} from '@/server/db/codes';
import { findPerson, nameOf, writeAudit } from '@/server/db/helpers';
import { canSee } from '@/config/role-screens';
import type { RoleKey } from '@/config/screens';
import { canCompletePartRecord, canValidatePart, partValidationErrors, type PartQualificationInput } from '@/domain/parts';
import {
  documentLinks, documents, partEquivalents, partLastPrices, parts, persons, projectBomLines, projects, spareListLines, suppliers,
} from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';

type Q = DB | Tx;

// ── Read model ─────────────────────────────────────────────────────────────────────────────────────────

export interface PartUsage {
  /** "HLT-026". */
  projectCode: string;
  /** "HLT" — the prototype's usage key (`usage {HLT: 48}`). */
  shortCode: string;
  quantity: number;
}

export interface PartRow {
  ref: string;
  /** EN data text. */
  name: string;
  makeBuy: PartMakeBuy;
  /** "Manufactured" / "Purchased". */
  makeBuyLabel: string;
  type: PartType;
  /** "Electrical". */
  typeLabel: string;
  /** List / standard unit price, € (`price`). */
  listPriceEur: number;
  /** Last purchase price, € (`lastPrice(p)` = LAST_PRICE ?? list price). */
  lastPriceEur: number;
  hasLastPrice: boolean;
  /** Manufacturer / preferred supplier name; null when none. */
  manufacturer: string | null;
  manufacturerIsInternal: boolean;
  manufacturerRef: string | null;
  /** Customs (HS) code; null = "n/a". */
  hsCode: string | null;
  /** Restriction text (EN source); null = "None". */
  exportRestriction: string | null;
  exportControl: ExportControl | null;
  exportControlLabel: string | null;
  /** R-102: explicit "no customs code" / export restriction confirmed (None included) — see `partValidationErrors`. */
  hsNotApplicable: boolean;
  exportReviewed: boolean;
  /** R-102: who validated the part in Keystone and when (ISO); null for the seed's Validated parts and the others. */
  validatedBy: string | null;
  validatedAt: string | null;
  status: PartStatus;
  /** "Not validated". */
  statusLabel: string;
  /** Part drawer banner (STATUS_NOTE; EN source); null for validated parts. */
  statusNote: string | null;
  /** Letter / index; null = "—". */
  revision: string | null;
  /** Weeks; null = "—". */
  leadWeeks: number | null;
  wearSpare: WearSpare | null;
  /** "Wear part (PU)" / "Spare part (PR)" / null (PU_LABEL "—"). */
  wearSpareLabel: string | null;
  unit: PartUnit;
  /** Registered equivalents (refs, catalogue order of the record). */
  equivalents: string[];
  /** Projects whose BOM lists the part (project register order). */
  usage: PartUsage[];
  /** Σ usage quantities ("Total quantity"). */
  totalQuantity: number;
  /** Catalogue order. */
  position: number;
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** Last purchase price by reference (LAST_PRICE; parts without one fall back to their list price). */
export async function lastPriceByRef(q?: Q): Promise<Record<string, number>> {
  const db = q ?? (await getDb());
  const rows = await db.select({ ref: parts.ref, list: parts.listPriceEur, last: partLastPrices.unitPriceEur }).from(parts).leftJoin(partLastPrices, eq(partLastPrices.partId, parts.id));
  return Object.fromEntries(rows.map((r) => [r.ref, r.last ?? r.list]));
}

async function loadParts(q: Q, refs?: string[]): Promise<PartRow[]> {
  const where = refs ? inArray(parts.ref, refs.length ? refs : ['']) : undefined;
  const validator = sql<string | null>`(select coalesce(${persons.fullName}, ${persons.shortName}) from ${persons} where ${persons.id} = ${parts.validatedByPersonId})`;
  const rows = await q
    .select({ p: parts, mfr: suppliers.name, internal: suppliers.isInternal, last: partLastPrices.unitPriceEur, validator })
    .from(parts)
    .leftJoin(suppliers, eq(suppliers.id, parts.manufacturerId))
    .leftJoin(partLastPrices, eq(partLastPrices.partId, parts.id))
    .where(where)
    .orderBy(asc(parts.position));
  const ids = rows.map((r) => r.p.id);
  if (!ids.length) return [];
  const [equiv, usage] = await Promise.all([
    q.select({ partId: partEquivalents.partId, ref: parts.ref, position: partEquivalents.position }).from(partEquivalents)
      .innerJoin(parts, eq(parts.id, partEquivalents.equivalentPartId)).where(inArray(partEquivalents.partId, ids)).orderBy(asc(partEquivalents.position)),
    q.select({ partId: projectBomLines.partId, code: projects.code, short: projects.shortCode, qty: projectBomLines.quantity, order: projects.sortOrder })
      .from(projectBomLines).innerJoin(projects, eq(projects.id, projectBomLines.projectId)).where(inArray(projectBomLines.partId, ids)).orderBy(asc(projects.sortOrder)),
  ]);
  return rows.map(({ p, mfr, internal, last, validator: vBy }) => {
    const use = usage.filter((u) => u.partId === p.id && u.qty > 0).map((u) => ({ projectCode: u.code, shortCode: u.short, quantity: u.qty }));
    return {
      ref: p.ref, name: p.name, makeBuy: p.makeBuy, makeBuyLabel: partMakeBuy.label(p.makeBuy), type: p.type, typeLabel: partType.label(p.type),
      listPriceEur: p.listPriceEur, lastPriceEur: last ?? p.listPriceEur, hasLastPrice: last != null, manufacturer: mfr ?? null, manufacturerIsInternal: !!internal,
      manufacturerRef: p.manufacturerRef, hsCode: p.hsCode, exportRestriction: p.exportRestriction, exportControl: p.exportControl ?? null,
      exportControlLabel: p.exportControl ? exportControl.label(p.exportControl) : null, hsNotApplicable: p.hsNotApplicable, exportReviewed: p.exportReviewed,
      validatedBy: p.validatedAt ? vBy : null, validatedAt: p.validatedAt?.toISOString() ?? null, status: p.status, statusLabel: partStatus.label(p.status),
      statusNote: PART_STATUS_NOTE[p.status] ?? null, revision: p.revision, leadWeeks: p.leadWeeks, wearSpare: p.wearSpare ?? null,
      wearSpareLabel: p.wearSpare ? wearSpare.label(p.wearSpare) : null, unit: p.unit,
      equivalents: equiv.filter((e) => e.partId === p.id).map((e) => e.ref), usage: use, totalQuantity: use.reduce((s, u) => s + u.quantity, 0), position: p.position,
    };
  });
}

/** The catalogue, PARTS order (parts created in Keystone appended). */
export async function listParts(): Promise<PartRow[]> {
  return loadParts(await getDb());
}

/** Catalogue rows of some references (catalogue order); unknown refs are skipped. */
export async function getPartsByRef(refs: string[]): Promise<PartRow[]> {
  return loadParts(await getDb(), uniq(refs));
}

export async function getPart(ref: string): Promise<PartRow | null> {
  return (await loadParts(await getDb(), [ref]))[0] ?? null;
}

export interface PartProjectUse {
  code: string;
  shortCode: string;
  /** Full project name (`pr.name`). */
  name: string;
  /** PROJ_NAMES display name ("Harbor Line"); null when none. */
  shortName: string | null;
  stage: StageCode;
  /** French domain label ("Fabrication & Assemblage"). */
  stageLabel: string;
  pm: string | null;
  quantity: number;
}

/** Part record (drawer, 09 §2): catalogue data + linked records. ECOs and installed base come from eco.ts / machines.ts. */
export interface PartRecord extends PartRow {
  equivalentParts: { ref: string; name: string; status: PartStatus; statusLabel: string }[];
  /** Wear & spare list when the part is a system (SPARE_LISTS key). */
  spareList: { ref: string; name: string; kind: WearSpare; qtyPerSystem: number; note: string | null }[];
  projects: PartProjectUse[];
  /** Codex records citing the part (article relation), vault order. */
  documents: { number: string; title: string; status: string; revision: string }[];
  /** Σ list price × total quantity ("Committed value"). */
  committedValueEur: number;
}

export async function getPartRecord(ref: string): Promise<PartRecord | null> {
  const db = await getDb();
  const [row] = await loadParts(db, [ref]);
  if (!row) return null;
  const [p] = await db.select({ id: parts.id }).from(parts).where(eq(parts.ref, ref));
  const [equivParts, spares, projs, docs] = await Promise.all([
    loadParts(db, row.equivalents),
    db.select({ ref: parts.ref, name: parts.name, kind: spareListLines.kind, qty: spareListLines.qtyPerSystem, note: spareListLines.note })
      .from(spareListLines).innerJoin(parts, eq(parts.id, spareListLines.partId)).where(eq(spareListLines.systemPartId, p.id)).orderBy(asc(spareListLines.position)),
    row.usage.length
      ? db.select({ code: projects.code, short: projects.shortCode, name: projects.name, shortName: projects.shortName, stage: projects.stage, pm: persons.shortName })
        .from(projects).leftJoin(persons, eq(persons.id, projects.pmPersonId)).where(inArray(projects.code, row.usage.map((u) => u.projectCode))).orderBy(asc(projects.sortOrder))
      : Promise.resolve([]),
    // Codex records whose relations cite the part or whose classification tags carry it (`partDocs` 5062).
    db.select({ number: documents.number, title: documents.title, status: documents.status, revision: documents.currentRevision })
      .from(documents)
      .where(or(
        sql`${ref} = any(${documents.tags})`,
        inArray(documents.id, db.select({ id: documentLinks.documentId }).from(documentLinks).where(eq(documentLinks.targetRef, ref))),
      ))
      .orderBy(asc(documents.sortOrder)),
  ]);
  const byRef = new Map(equivParts.map((e) => [e.ref, e]));
  return {
    ...row,
    equivalentParts: row.equivalents.filter((r) => byRef.has(r)).map((r) => ({ ref: r, name: byRef.get(r)!.name, status: byRef.get(r)!.status, statusLabel: byRef.get(r)!.statusLabel })),
    spareList: spares.map((s) => ({ ref: s.ref, name: s.name, kind: s.kind, qtyPerSystem: s.qty, note: s.note })),
    projects: projs.map((pr) => ({
      code: pr.code, shortCode: pr.short, name: pr.name, shortName: pr.shortName, stage: pr.stage, stageLabel: stageCodec.label(pr.stage),
      pm: pr.pm ?? null, quantity: row.usage.find((u) => u.projectCode === pr.code)?.quantity ?? 0,
    })),
    documents: docs.map(({ number, title, status, revision }) => ({ number, title, status, revision })),
    committedValueEur: row.listPriceEur * row.totalQuantity,
  };
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────

export interface NewPartInput {
  ref: string;
  /** "Designation". */
  name: string;
  family: PartFamily;
  /** Preferred supplier (free text; a company unknown to Keystone is registered). */
  supplier?: string | null;
  priceEur?: number | null;
  unit?: PartUnit;
}

/**
 * "New part" (AF.plm): appended to the catalogue as Not validated (qualification pending), revision A. The Family
 * maps to a catalogue type (OPEN QUESTION E-1); make / buy follows the supplier (a Keystone workshop → Manufactured).
 * Returns the reference.
 */
export async function createPart(input: NewPartInput, actorName: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const ref = input.ref.trim().toUpperCase();
    const name = input.name.trim();
    if (!ref) throw new Error('The reference is required');
    if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(ref)) throw new Error('Invalid reference');
    if (!name) throw new Error('The designation is required');
    if (!partFamily.isCode(input.family)) throw new Error('Invalid family');
    const unit = input.unit ?? 'pc';
    if (!PART_UNITS.includes(unit)) throw new Error('Invalid unit');
    const price = input.priceEur ?? 0;
    if (!Number.isFinite(price) || price < 0) throw new Error('Invalid unit price');
    const [dup] = await tx.select({ id: parts.id }).from(parts).where(eq(parts.ref, ref));
    if (dup) throw new Error(`${ref} already exists in the catalogue`);
    const supplierName = input.supplier?.trim() || null;
    let supplier: { id: string; isInternal: boolean } | null = null;
    if (supplierName) {
      [supplier] = await tx.select({ id: suppliers.id, isInternal: suppliers.isInternal }).from(suppliers).where(eq(suppliers.name, supplierName));
      if (!supplier) {
        const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${suppliers.position}), -1)::int` }).from(suppliers);
        [supplier] = await tx.insert(suppliers).values({ name: supplierName, position: pos + 1, isInternal: supplierName.startsWith('Keystone ') })
          .returning({ id: suppliers.id, isInternal: suppliers.isInternal });
      }
    }
    const actor = await findPerson(tx, actorName);
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${parts.position}), -1)::int` }).from(parts);
    const [p] = await tx
      .insert(parts)
      .values({
        ref, name, makeBuy: supplier?.isInternal ? 'manufactured' : 'purchased', type: PART_FAMILY_TYPE[input.family], listPriceEur: price,
        manufacturerId: supplier?.id ?? null, status: 'not_validated', revision: 'A', unit, position: pos + 1, createdByPersonId: actor?.id ?? null,
      })
      .returning({ id: parts.id });
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: ref,
      change: `part created · ${partFamily.label(input.family)} · ${price} € / ${unit} · Not validated`, area: 'PLM', entityType: 'part', entityId: p.id,
    });
    return ref;
  });
}

// ── R-102: validation of parts by engineering (E-1a = a, E-1b = a) ─────────────────────────────────────

/** Refusal of a qualification write: `stale` = the part's status moved on since the drawer was rendered. */
export class PartQualificationError extends Error {
  constructor(readonly code: 'stale' | 'not_allowed' | 'incomplete' | 'unknown', message: string) {
    super(message);
    this.name = 'PartQualificationError';
  }
}

/** The viewer recording a qualification change: full name and active role (R-039: the role in force decides). */
export interface PartActor {
  name: string;
  role: string;
}

async function lockPart(tx: Tx, ref: string) {
  const [p] = await tx.select().from(parts).where(eq(parts.ref, ref)).for('update');
  if (!p) throw new PartQualificationError('unknown', `Unknown part ${ref}`);
  return p;
}

const show = (v: string | number | null) => (v == null || v === '' ? '—' : String(v));

/**
 * "Complete the record" (part drawer): HS code or an explicit "Not applicable", export restriction confirmed (None, or a text
 * with its export-control family), lead time in weeks, manufacturer reference. The catalogue's editors (PLM in their
 * workspace) while the part is Not validated; the engineering lead and the director once it is Validated
 * (`canCompletePartRecord`, re-checked here on the locked row). Never changes the status. Audited in PLM with the fields
 * that changed ("record completed · HS code — → 8504.40 · …"); nothing is written when nothing changed.
 */
export async function updatePartQualification(ref: string, input: PartQualificationInput, actor: PartActor): Promise<{ changed: boolean }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await lockPart(tx, ref);
    if (!canCompletePartRecord(p.status, actor.role, canSee(actor.role as RoleKey, 'plm')))
      throw new PartQualificationError('not_allowed', p.status === 'not_validated' ? 'The parts catalogue is read-only for you' : 'Only the engineering lead or the director changes a validated part');
    const changes = [
      p.hsCode !== input.hsCode || p.hsNotApplicable !== input.hsNotApplicable
        ? `HS code ${p.hsNotApplicable ? 'n/a' : show(p.hsCode)} → ${input.hsNotApplicable ? 'n/a' : show(input.hsCode)}` : null,
      p.exportRestriction !== input.exportRestriction || p.exportReviewed !== input.exportReviewed || (p.exportControl ?? null) !== input.exportControl
        ? `export ${input.exportReviewed ? (input.exportRestriction ?? 'None') : 'not confirmed'}` : null,
      p.leadWeeks !== input.leadWeeks ? `lead time ${show(p.leadWeeks)} → ${show(input.leadWeeks)} wk` : null,
      p.manufacturerRef !== input.manufacturerRef ? `manufacturer ref. ${show(p.manufacturerRef)} → ${show(input.manufacturerRef)}` : null,
    ].filter((x): x is string => !!x);
    if (!changes.length) return { changed: false };
    const at = new Date();
    await tx.update(parts).set({
      hsCode: input.hsCode, hsNotApplicable: input.hsNotApplicable, exportRestriction: input.exportRestriction, exportControl: input.exportControl,
      exportReviewed: input.exportReviewed, leadWeeks: input.leadWeeks, manufacturerRef: input.manufacturerRef, updatedAt: at,
    }).where(eq(parts.id, p.id));
    const who = await findPerson(tx, actor.name);
    await writeAudit(tx, {
      actorName: who ? nameOf(who) : actor.name, actorPersonId: who?.id, objectRef: ref, change: `record completed · ${changes.join(' · ')}`, area: 'PLM', entityType: 'part',
      entityId: p.id, occurredAt: at,
    });
    return { changed: true };
  });
}

/**
 * "Validate part" (E-1a): Not validated → Validated by the engineering lead or — default — the director (active role), once
 * the record is complete (`partValidationErrors`). The status and the record are re-read on the locked row; stores who and
 * when, audited "status: Not validated → Validated". No manual path to Outdated / Obsolete, nor back to Not validated.
 */
export async function validatePart(ref: string, actor: PartActor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await lockPart(tx, ref);
    if (p.status !== 'not_validated') throw new PartQualificationError('stale', `${ref} is not awaiting validation`);
    if (!canValidatePart(p.status, actor.role)) throw new PartQualificationError('not_allowed', 'Only the engineering lead or the director validates a part');
    const missing = partValidationErrors(p);
    if (missing.length) throw new PartQualificationError('incomplete', missing.join(' · '));
    const at = new Date();
    const who = await findPerson(tx, actor.name);
    await tx.update(parts).set({ status: 'validated', validatedAt: at, validatedByPersonId: who?.id ?? null, updatedAt: at }).where(eq(parts.id, p.id));
    await writeAudit(tx, {
      actorName: who ? nameOf(who) : actor.name, actorPersonId: who?.id, objectRef: ref, change: 'status: Not validated → Validated', area: 'PLM', entityType: 'part', entityId: p.id, occurredAt: at,
    });
  });
}

/** "Register equivalent": records the equivalence both ways (as the catalogue lists KS-STL-0450 ⇄ KS-STL-0450B). */
export async function registerEquivalent(ref: string, equivalentRef: string, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    if (ref === equivalentRef) throw new Error('A part cannot be its own equivalent');
    const found = await tx.select({ id: parts.id, ref: parts.ref }).from(parts).where(inArray(parts.ref, [ref, equivalentRef]));
    const a = found.find((x) => x.ref === ref);
    const b = found.find((x) => x.ref === equivalentRef);
    if (!a) throw new Error(`Unknown part ${ref}`);
    if (!b) throw new Error(`Unknown part ${equivalentRef}`);
    const add = async (from: string, to: string) => {
      const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${partEquivalents.position}), -1)::int` }).from(partEquivalents).where(eq(partEquivalents.partId, from));
      await tx.insert(partEquivalents).values({ partId: from, equivalentPartId: to, position: pos + 1 }).onConflictDoNothing();
    };
    await add(a.id, b.id);
    await add(b.id, a.id);
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: ref, change: `equivalent registered · ${equivalentRef}`, area: 'PLM', entityType: 'part', entityId: a.id });
  });
}
