import 'server-only';
// Machine catalogue DAL (R-186, AC-4; contract K-01 of the CAPEX application). One row per catalogue code and version
// (machine_catalogue_entries); rules in src/domain/machine-catalogue.ts. Read by the Machine catalogue screen (every entry, the
// rows published to the CAPEX application and the equipment lines that chose a version), the Machine types screen (the count
// behind its link), the equipment line forms (published versions) and the view pub_catalogue_machines (migration 0046). Written
// by the portfolio director and the engineering lead only (choice 5 of the framing, 23 Oct 2026): the writers re-check the
// Machine catalogue workspace and the role, record the audit row (system messages, R-184) and, on publish and retire, an
// activity event.
// A published version is frozen — here (only a draft is edited, published or discarded) and in the database (trigger
// machine_catalogue_entries_frozen).
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  CATALOGUE_EDITORS_ONLY, canEditCatalogue, catalogueActionBlocker, catalogueRef, latestVersion, nextCatalogueVersion, normaliseCatalogueCode,
  parseCatalogueContent, publishBlockers, supersededBy, CATALOGUE_CODE_RE, type CatalogueAction, type CatalogueContent, type CatalogueOption,
  type CatalogueStatus,
} from '@/domain/machine-catalogue';
import { systemMessage } from '@/domain/system-messages';
import { getDb } from '@/server/db/client';
import { machineType, type MachineTypeCode } from '@/server/db/codes';
import { machineCatalogueEntries, machineTypes, projectEquipments, projects } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { requireWorkspace, trace, whoIs, type Actor } from './ops-common';

type Q = DB | Tx;
type Row = typeof machineCatalogueEntries.$inferSelect;

export interface CatalogueEntryRow extends CatalogueContent {
  id: string;
  code: string;
  version: number;
  machineTypeCode: string;
  /** Display code of the type ("EMP", "R&D"). */
  typeLabel: string;
  status: CatalogueStatus;
  publishedAt: string | null;
  retiredAt: string | null;
  /** ISO timestamp of the last change (pub_catalogue_machines.maj_le). */
  updatedAt: string;
  /** Equipment lines of projects that chose this version. */
  projectLines: number;
}

const typeLabelOf = (code: string, label: string | null) => label ?? (machineType.isCode(code) ? machineType.label(code) : code);

const toRow = (r: Row, typeLabel: string | null, lines: number): CatalogueEntryRow => ({
  id: r.id, code: r.code, version: r.version, machineTypeCode: r.machineTypeCode, typeLabel: typeLabelOf(r.machineTypeCode, typeLabel), status: r.status,
  variant: r.variant, label: r.label, description: r.description, options: (r.options ?? []) as CatalogueOption[], nominalCapacity: r.nominalCapacity,
  capacityUnit: r.capacityUnit, indicativePriceKeur: r.indicativePriceKeur, leadTimeWeeks: r.leadTimeWeeks,
  publishedAt: r.publishedAt?.toISOString() ?? null, retiredAt: r.retiredAt?.toISOString() ?? null, updatedAt: r.updatedAt.toISOString(), projectLines: lines,
});

/** Every catalogue version (machine type order, then code, latest version first); `typeCode` narrows to one machine type. */
export async function listCatalogue(typeCode?: string): Promise<CatalogueEntryRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ e: machineCatalogueEntries, typeLabel: machineTypes.label })
    .from(machineCatalogueEntries)
    .innerJoin(machineTypes, eq(machineTypes.code, machineCatalogueEntries.machineTypeCode))
    .where(typeCode ? eq(machineCatalogueEntries.machineTypeCode, typeCode as MachineTypeCode) : undefined)
    .orderBy(asc(machineTypes.sortOrder), asc(machineCatalogueEntries.code), desc(machineCatalogueEntries.version));
  const uses = await db.select({ code: projectEquipments.catalogueCode, version: projectEquipments.catalogueVersion }).from(projectEquipments);
  const count = (code: string, version: number) => uses.filter((u) => u.code === code && u.version === version).length;
  return rows.map((r) => toRow(r.e, r.typeLabel, count(r.e.code, r.e.version)));
}

/** A row of pub_catalogue_machines as the CAPEX application reads it (published and retired versions; never a draft). */
export interface CataloguePublicationRow {
  code: string;
  version: number;
  statut: 'publie' | 'retire';
  /** ISO timestamp (maj_le). */
  majLe: string;
}

/** The rows of the shared view pub_catalogue_machines (code, version order) — what Arche reads, read back from the view itself. */
export async function listCataloguePublication(): Promise<CataloguePublicationRow[]> {
  const db = await getDb();
  const res = await db.execute(sql`select code, version, statut, maj_le from pub_catalogue_machines order by code, version`);
  return (res.rows as { code: string; version: number | string; statut: 'publie' | 'retire'; maj_le: Date | string }[]).map((r) => ({
    code: r.code, version: Number(r.version), statut: r.statut, majLe: new Date(r.maj_le).toISOString(),
  }));
}

/** A project's equipment line that chose a catalogue version (project_equipments.catalogue_code / catalogue_version). */
export interface CatalogueUseRow {
  code: string;
  version: number;
  projectCode: string;
  projectName: string | null;
  /** "EQ-01". */
  ref: string;
  quantity: number;
}

/** Every equipment line that references a catalogue version (project code, then line order). */
export async function listCatalogueUses(): Promise<CatalogueUseRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      code: projectEquipments.catalogueCode, version: projectEquipments.catalogueVersion, projectCode: projects.code, projectName: projects.shortName,
      ref: projectEquipments.ref, quantity: projectEquipments.quantity,
    })
    .from(projectEquipments)
    .innerJoin(projects, eq(projects.id, projectEquipments.projectId))
    .where(and(isNotNull(projectEquipments.catalogueCode), isNotNull(projectEquipments.catalogueVersion)))
    .orderBy(asc(projects.code), asc(projectEquipments.position));
  return rows.map((r) => ({ ...r, code: r.code!, version: r.version! }));
}

/** A catalogue version an equipment line may choose. */
export interface CatalogueChoice {
  code: string;
  version: number;
  label: string;
  machineTypeCode: string;
  status: CatalogueStatus;
}

/** The published versions (one per code), machine type order: the equipment line forms' list. */
export async function listCatalogueChoices(q?: Q): Promise<CatalogueChoice[]> {
  const db = q ?? (await getDb());
  return db
    .select({ code: machineCatalogueEntries.code, version: machineCatalogueEntries.version, label: machineCatalogueEntries.label, machineTypeCode: machineCatalogueEntries.machineTypeCode, status: machineCatalogueEntries.status })
    .from(machineCatalogueEntries)
    .innerJoin(machineTypes, eq(machineTypes.code, machineCatalogueEntries.machineTypeCode))
    .where(eq(machineCatalogueEntries.status, 'published'))
    .orderBy(asc(machineTypes.sortOrder), asc(machineCatalogueEntries.code));
}

/** One version (any status), or null. */
export async function findCatalogueVersion(q: Q, code: string, version: number): Promise<CatalogueChoice | null> {
  const [r] = await q
    .select({ code: machineCatalogueEntries.code, version: machineCatalogueEntries.version, label: machineCatalogueEntries.label, machineTypeCode: machineCatalogueEntries.machineTypeCode, status: machineCatalogueEntries.status })
    .from(machineCatalogueEntries)
    .where(and(eq(machineCatalogueEntries.code, code), eq(machineCatalogueEntries.version, version)));
  return r ?? null;
}

/** The catalogue writers' rights: the Machine catalogue workspace and, among its roles, the director and the engineering lead. */
function requireCatalogueEditor(actor: Actor): void {
  requireWorkspace('catalogue', actor, 'Machine catalogue');
  if (!canEditCatalogue(actor.role)) throw new Error(CATALOGUE_EDITORS_ONLY);
}

/** The versions of a code, locked for the transaction (rows) — empty for an unknown code. */
async function versionsOf(tx: Tx, code: string): Promise<Row[]> {
  return tx.select().from(machineCatalogueEntries).where(eq(machineCatalogueEntries.code, code)).orderBy(asc(machineCatalogueEntries.version)).for('update');
}

async function versionOf(tx: Tx, code: string, version: number, action: CatalogueAction): Promise<{ row: Row; all: Row[] }> {
  const all = await versionsOf(tx, code);
  const row = all.find((r) => r.version === version) ?? null;
  const blocker = catalogueActionBlocker(action, row, all);
  if (blocker) throw new Error(blocker);
  return { row: row!, all };
}

const contentOf = (r: Row | CatalogueContent): CatalogueContent => ({
  variant: r.variant, label: r.label, description: r.description, options: (r.options ?? []) as CatalogueOption[], nominalCapacity: r.nominalCapacity,
  capacityUnit: r.capacityUnit, indicativePriceKeur: r.indicativePriceKeur, leadTimeWeeks: r.leadTimeWeeks,
});

const audit = (r: { code: string; version: number; machineTypeCode: string; status: string } & CatalogueContent) => ({
  code: r.code, version: r.version, machineTypeCode: r.machineTypeCode, status: r.status, ...contentOf(r),
});

export interface NewCatalogueEntryInput extends Record<string, unknown> {
  code: string;
  machineTypeCode: string;
}

/** "New catalogue entry": version 1 of a new code, as a draft, on an active machine type. Returns the code. */
export async function createCatalogueEntry(input: NewCatalogueEntryInput, actor: Actor): Promise<string> {
  requireCatalogueEditor(actor);
  const code = normaliseCatalogueCode(typeof input.code === 'string' ? input.code : '');
  if (!code) throw new Error('Code is required');
  if (!CATALOGUE_CODE_RE.test(code)) throw new Error('A catalogue code reads like EMP-40T (capitals, digits and dashes)');
  const parsed = parseCatalogueContent(input);
  if (!parsed.ok) throw new Error(parsed.error);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [type] = await tx.select().from(machineTypes).where(eq(machineTypes.code, input.machineTypeCode as MachineTypeCode));
    if (!type || !type.active) throw new Error('Choose the machine type among the proposed types');
    if ((await versionsOf(tx, code)).length) throw new Error('This catalogue code is already used');
    const [row] = await tx.insert(machineCatalogueEntries).values({ code, version: 1, machineTypeCode: type.code, status: 'draft', ...parsed.value }).returning();
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Machine type ${type.label}`, message: systemMessage('catalogue.created', { ref: catalogueRef(code, 1), label: parsed.value.label }), area: 'Settings',
      entityType: 'machine_catalogue_entry', entityId: row.id, after: audit(row),
    });
    return code;
  });
}

/** "New version" of a code: a draft copied from its latest version, numbered one after the highest. Returns the version. */
export async function newCatalogueVersion(code: string, actor: Actor): Promise<number> {
  requireCatalogueEditor(actor);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const all = await versionsOf(tx, code);
    const last = latestVersion(all);
    if (!last) throw new Error('Unknown catalogue entry');
    const blocker = catalogueActionBlocker('newVersion', null, all);
    if (blocker) throw new Error(blocker);
    const version = nextCatalogueVersion(all);
    const [row] = await tx.insert(machineCatalogueEntries).values({ code, version, machineTypeCode: last.machineTypeCode, status: 'draft', ...contentOf(last) }).returning();
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Machine type ${typeLabelOf(last.machineTypeCode, null)}`, message: systemMessage('catalogue.versionCreated', { ref: catalogueRef(code, version) }),
      area: 'Settings', entityType: 'machine_catalogue_entry', entityId: row.id, after: audit(row),
    });
    return version;
  });
}

/** Saves a draft's content. No change → no write. */
export async function updateCatalogueDraft(code: string, version: number, input: Record<string, unknown>, actor: Actor): Promise<void> {
  requireCatalogueEditor(actor);
  const parsed = parseCatalogueContent(input);
  if (!parsed.ok) throw new Error(parsed.error);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { row } = await versionOf(tx, code, version, 'edit');
    const before = audit(row);
    const after = audit({ ...row, ...parsed.value });
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    await tx.update(machineCatalogueEntries).set({ ...parsed.value, updatedAt: new Date() }).where(eq(machineCatalogueEntries.id, row.id));
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Machine type ${typeLabelOf(row.machineTypeCode, null)}`, message: systemMessage('catalogue.draftSaved', { ref: catalogueRef(code, version) }),
      area: 'Settings', entityType: 'machine_catalogue_entry', entityId: row.id, before, after,
    });
  });
}

/**
 * Publishes a draft: it is frozen and offered to the subsidiaries; the code's published version (if any) is retired in the same
 * transaction — it stays in pub_catalogue_machines with statut 'retire' for the needs that chose it. Refused while the draft has
 * no indicative price or lead time.
 */
export async function publishCatalogueVersion(code: string, version: number, actor: Actor): Promise<{ retired: number[] }> {
  requireCatalogueEditor(actor);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { row, all } = await versionOf(tx, code, version, 'publish');
    const missing = publishBlockers(row);
    if (missing.length) throw new Error(missing[0]);
    const retired = supersededBy(row, all);
    const now = new Date();
    // Retire first: one published version per code (partial unique index).
    if (retired.length)
      await tx.update(machineCatalogueEntries).set({ status: 'retired', retiredAt: now, updatedAt: now })
        .where(and(eq(machineCatalogueEntries.code, code), inArray(machineCatalogueEntries.version, retired)));
    await tx.update(machineCatalogueEntries).set({ status: 'published', publishedAt: now, updatedAt: now }).where(eq(machineCatalogueEntries.id, row.id));
    const message = retired.length
      ? systemMessage('catalogue.publishedSuperseding', { ref: catalogueRef(code, version), previous: retired.map((v) => catalogueRef(code, v)).join(', ') })
      : systemMessage('catalogue.published', { ref: catalogueRef(code, version) });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Machine type ${typeLabelOf(row.machineTypeCode, null)}`, message, area: 'Settings', entityType: 'machine_catalogue_entry', entityId: row.id,
      before: { status: 'draft', retired: [] }, after: { status: 'published', retired }, activity: { kind: 'change', message },
    });
    return { retired };
  });
}

/** Retires the published version of a code: it leaves the catalogue offered to the subsidiaries (kept for the needs that chose it). */
export async function retireCatalogueVersion(code: string, version: number, actor: Actor): Promise<void> {
  requireCatalogueEditor(actor);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { row } = await versionOf(tx, code, version, 'retire');
    const now = new Date();
    await tx.update(machineCatalogueEntries).set({ status: 'retired', retiredAt: now, updatedAt: now }).where(eq(machineCatalogueEntries.id, row.id));
    const message = systemMessage('catalogue.retired', { ref: catalogueRef(code, version) });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Machine type ${typeLabelOf(row.machineTypeCode, null)}`, message, area: 'Settings', entityType: 'machine_catalogue_entry', entityId: row.id,
      before: { status: 'published' }, after: { status: 'retired' }, activity: { kind: 'change', message },
    });
  });
}

/** Discards a draft (deleted: it was never published). */
export async function discardCatalogueDraft(code: string, version: number, actor: Actor): Promise<void> {
  requireCatalogueEditor(actor);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { row } = await versionOf(tx, code, version, 'discard');
    await tx.delete(machineCatalogueEntries).where(eq(machineCatalogueEntries.id, row.id));
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Machine type ${typeLabelOf(row.machineTypeCode, null)}`, message: systemMessage('catalogue.discarded', { ref: catalogueRef(code, version) }),
      area: 'Settings', entityType: 'machine_catalogue_entry', entityId: row.id, before: audit(row),
    });
  });
}

/** pub_catalogue_machines.type_libelle follows the machine type's label: its published and retired rows' maj_le move with it. */
export async function touchCatalogueOfType(tx: Tx, typeCode: string): Promise<void> {
  await tx.update(machineCatalogueEntries).set({ updatedAt: new Date() })
    .where(and(eq(machineCatalogueEntries.machineTypeCode, typeCode as MachineTypeCode), inArray(machineCatalogueEntries.status, ['published', 'retired'])));
}
