import 'server-only';
// R-185 (AC-5): the equipment lines of a project — one machine type × a quantity each, EQ-01, EQ-02… (project_equipments).
// Read by the register, the shell, the Contract screen's "Equipment" card and the Budget's REX references; written by the
// New project wizard (insertEquipmentLines) and by the project's leads on the Contract screen (add / edit / remove). Every
// writer keeps projects.machine_type_code = the type of the first line (the "main type" the screens written before R-185
// read). Rules: src/domain/project-equipment.ts. Permission checks belong to the calling Server Function.
// R-185 part 2 (choice 4: one ITP plan per line): adding a line creates its plan (its type's ITP systems frozen); changing a
// line's type rebuilds its plan while it has no inspection; removing a line is refused while its plan has inspections
// (`equipmentRemovalBlocker`), else its plan goes with it and its punch items, commissioning systems, BOM lines and machines
// become common to the project (foreign keys `set null`; the counts are in the audit row).
import { and, asc, eq, inArray } from 'drizzle-orm';
import { equipmentRemovalBlocker } from '@/domain/equipment-scope';
import {
  MAX_EQUIPMENT_LINES, equipmentSummary, mainTypeOf, nextEquipmentRef, parseEquipmentLine, type EquipmentLineInput,
} from '@/domain/project-equipment';
import { catalogueChoiceBlocker, catalogueRef } from '@/domain/machine-catalogue';
import { systemMessage } from '@/domain/system-messages';
import { getDb } from '@/server/db/client';
import { machineType, type MachineTypeCode } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { activities, commissioningSystems, machineTypes, machines, projectBomLines, projectEquipments, projects, punchItems, wbsNodes } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { ensureEquipmentPlan, equipmentPlanInspections, rebuildEquipmentPlan } from './itp';
import { findCatalogueVersion } from './machine-catalogue';
import type { Actor } from './ops-common';

type Q = DB | Tx;

export interface EquipmentLine {
  id: string;
  /** "EQ-01". */
  ref: string;
  machineTypeCode: string;
  /** Display code of the type ("EMP", "R&D", a custom type's label). */
  typeLabel: string;
  quantity: number;
  /** Typed text (dataText), null = none. */
  label: string | null;
  position: number;
  capacityValue: number | null;
  capacityUnit: string | null;
  options: string[];
  besoinRef: string | null;
  catalogueVersion: number | null;
  /** R-186: the catalogue code chosen ("EMP-40T"), with catalogueVersion; null = none. */
  catalogueCode: string | null;
}

const typeLabelOf = (code: string, label: string | null) => label ?? (machineType.isCode(code) ? machineType.label(code) : code);

const lineSelect = {
  e: projectEquipments,
  typeLabel: machineTypes.label,
};

const toLine = (r: { e: typeof projectEquipments.$inferSelect; typeLabel: string | null }): EquipmentLine => ({
  id: r.e.id, ref: r.e.ref, machineTypeCode: r.e.machineTypeCode, typeLabel: typeLabelOf(r.e.machineTypeCode, r.typeLabel), quantity: r.e.quantity,
  label: r.e.label, position: r.e.position, capacityValue: r.e.capacityValue, capacityUnit: r.e.capacityUnit, options: r.e.options ?? [],
  besoinRef: r.e.besoinRef, catalogueVersion: r.e.catalogueVersion, catalogueCode: r.e.catalogueCode,
});

/** The lines of a project id, in order (the main line first). */
export async function equipmentLinesOf(q: Q, projectId: string): Promise<EquipmentLine[]> {
  const rows = await q
    .select(lineSelect)
    .from(projectEquipments)
    .leftJoin(machineTypes, eq(machineTypes.code, projectEquipments.machineTypeCode))
    .where(eq(projectEquipments.projectId, projectId))
    .orderBy(asc(projectEquipments.position), asc(projectEquipments.ref));
  return rows.map(toLine);
}

/** The lines of a project (empty for an unknown project or one without machine type). */
export async function listProjectEquipments(projectCode: string): Promise<EquipmentLine[]> {
  const db = await getDb();
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, projectCode));
  return p ? equipmentLinesOf(db, p.id) : [];
}

/** Every project's lines by project id (one query: the register, the shell). */
export async function equipmentLinesByProject(q?: Q): Promise<Map<string, EquipmentLine[]>> {
  const db = q ?? (await getDb());
  const rows = await db
    .select({ ...lineSelect })
    .from(projectEquipments)
    .leftJoin(machineTypes, eq(machineTypes.code, projectEquipments.machineTypeCode))
    .orderBy(asc(projectEquipments.projectId), asc(projectEquipments.position), asc(projectEquipments.ref));
  const out = new Map<string, EquipmentLine[]>();
  for (const r of rows) out.set(r.e.projectId, [...(out.get(r.e.projectId) ?? []), toLine(r)]);
  return out;
}

/** "3 × MEMU" (· its label) — the audit and activity texts. */
const lineText = (l: { quantity: number; typeLabel: string; label: string | null }) => `${l.quantity} × ${l.typeLabel}${l.label ? ` · ${l.label}` : ''}`;

/** Keeps projects.machine_type_code = the first line's type (null when the project has no line left). */
async function syncMainType(tx: Tx, projectId: string): Promise<void> {
  const lines = await tx.select({ machineTypeCode: projectEquipments.machineTypeCode, position: projectEquipments.position }).from(projectEquipments).where(eq(projectEquipments.projectId, projectId));
  const main = mainTypeOf(lines) as MachineTypeCode | null;
  const [p] = await tx.select({ mt: projects.machineTypeCode }).from(projects).where(eq(projects.id, projectId));
  if (p && p.mt !== main) await tx.update(projects).set({ machineTypeCode: main, updatedAt: new Date() }).where(eq(projects.id, projectId));
}

/**
 * Inserts the lines of a new project (the wizard, the register's createProject, the seed), numbered EQ-01… in order. The
 * caller validated them. Returns the rows (id, ref) in order. Does not write projects.machine_type_code: the creator sets it to
 * the first line's type in the same insert.
 */
export async function insertEquipmentLines(
  tx: Tx, projectId: string, lines: readonly (Pick<EquipmentLineInput, 'machineTypeCode' | 'quantity'> & Partial<EquipmentLineInput>)[],
): Promise<{ id: string; ref: string; machineTypeCode: string; quantity: number }[]> {
  if (!lines.length) return [];
  const refs: string[] = [];
  const values = lines.map((l, position) => {
    const ref = nextEquipmentRef(refs);
    refs.push(ref);
    return {
      projectId, ref, machineTypeCode: l.machineTypeCode as MachineTypeCode, quantity: l.quantity, position, label: l.label ?? null,
      capacityValue: l.capacityValue ?? null, capacityUnit: l.capacityUnit ?? null, options: l.options ?? [], besoinRef: l.besoinRef ?? null,
      catalogueCode: l.catalogueCode ?? null, catalogueVersion: l.catalogueVersion ?? null,
    };
  });
  return tx.insert(projectEquipments).values(values).returning({
    id: projectEquipments.id, ref: projectEquipments.ref, machineTypeCode: projectEquipments.machineTypeCode, quantity: projectEquipments.quantity,
  });
}

/** The machine type codes a line may take: the active types, plus `keep` (a line's current type, even if retired since). */
async function allowedTypes(q: Q, keep?: string): Promise<{ codes: string[]; label: (code: string) => string }> {
  const rows = await q.select({ code: machineTypes.code, label: machineTypes.label, active: machineTypes.active }).from(machineTypes);
  return {
    codes: rows.filter((r) => r.active || r.code === keep).map((r) => r.code),
    label: (code) => typeLabelOf(code, rows.find((r) => r.code === code)?.label ?? null),
  };
}

async function actorOf(tx: Tx, actor: Actor) {
  const person = await findPerson(tx, actor.name);
  return { actorName: person ? nameOf(person) : actor.name, actorPersonId: person?.id ?? null };
}

const plain = (l: Partial<EquipmentLineInput> & { ref?: string }) => ({
  ref: l.ref, machineTypeCode: l.machineTypeCode, quantity: l.quantity, label: l.label ?? null, capacityValue: l.capacityValue ?? null,
  capacityUnit: l.capacityUnit ?? null, options: l.options ?? [], besoinRef: l.besoinRef ?? null,
  catalogue: l.catalogueCode && l.catalogueVersion ? catalogueRef(l.catalogueCode, l.catalogueVersion) : null,
});

/**
 * R-186: the catalogue version chosen for a line must be published (or the line's current one, even retired since) and of the
 * line's machine type.
 */
export async function checkCatalogueChoice(
  q: Q, v: Pick<EquipmentLineInput, 'machineTypeCode' | 'catalogueCode' | 'catalogueVersion'>, current?: { code: string | null; version: number | null },
): Promise<void> {
  if (!v.catalogueCode || !v.catalogueVersion) return;
  const choice = { code: v.catalogueCode, version: v.catalogueVersion };
  const entry = await findCatalogueVersion(q, choice.code, choice.version);
  const blocker = catalogueChoiceBlocker(choice, entry, v.machineTypeCode, current);
  if (blocker) throw new Error(blocker);
}

/** Adds a line at the end of the project's list (the next reference). Returns its reference. */
export async function addProjectEquipment(
  projectCode: string, input: Record<string, unknown>, actor: Actor,
  opts: {
    /** R-187: the catalogue version of a subsidiary's need is kept even when retired since. */
    keepCatalogue?: boolean;
    /** R-187 (K-10): runs in the same transaction once the line, its ITP plan and its audit row are written. */
    afterAdd?: (tx: Tx, added: { projectId: string; ref: string; lineId: string; who: { actorName: string; actorPersonId: string | null } }) => Promise<void>;
  } = {},
): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, p.id)).for('update');
    const types = await allowedTypes(tx);
    const parsed = parseEquipmentLine(input, types.codes);
    if (!parsed.ok) throw new Error(parsed.error);
    const lines = await equipmentLinesOf(tx, p.id);
    if (lines.length >= MAX_EQUIPMENT_LINES) throw new Error(`A project has at most ${MAX_EQUIPMENT_LINES} equipment lines`);
    const v = parsed.value;
    await checkCatalogueChoice(tx, v, opts.keepCatalogue ? { code: v.catalogueCode, version: v.catalogueVersion } : undefined);
    const ref = nextEquipmentRef(lines.map((l) => l.ref));
    const position = lines.length ? Math.max(...lines.map((l) => l.position)) + 1 : 0;
    const [row] = await tx
      .insert(projectEquipments)
      .values({ projectId: p.id, ref, position, ...v, machineTypeCode: v.machineTypeCode as MachineTypeCode })
      .returning({ id: projectEquipments.id });
    await syncMainType(tx, p.id);
    // R-185 (choice 4): the line's inspection plan, its type's ITP systems of today frozen.
    await ensureEquipmentPlan(tx, p.id, row.id);
    const who = await actorOf(tx, actor);
    const message = systemMessage('project.equipmentAdded', { ref, equipment: lineText({ ...v, typeLabel: types.label(v.machineTypeCode) }) });
    await writeAudit(tx, { ...who, objectRef: `${projectCode} · ${ref}`, message, area: 'Contract', entityType: 'project_equipment', entityId: row.id, projectId: p.id, after: plain({ ref, ...v }) });
    await recordActivity(tx, { ...who, message, kind: 'change', projectId: p.id });
    if (opts.afterAdd) await opts.afterAdd(tx, { projectId: p.id, ref, lineId: row.id, who });
    return ref;
  });
}

/** Edits a line (type, quantity, label, capacity, options, machine need). No change → no write. */
export async function updateProjectEquipment(projectCode: string, ref: string, input: Record<string, unknown>, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const [cur] = (await equipmentLinesOf(tx, p.id)).filter((l) => l.ref === ref);
    if (!cur) throw new Error('Unknown equipment line');
    const types = await allowedTypes(tx, cur.machineTypeCode);
    const parsed = parseEquipmentLine(input, types.codes);
    if (!parsed.ok) throw new Error(parsed.error);
    const v = parsed.value;
    await checkCatalogueChoice(tx, v, { code: cur.catalogueCode, version: cur.catalogueVersion });
    const before = plain(cur);
    const after = plain({ ref, ...v });
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    await tx
      .update(projectEquipments)
      .set({ ...v, machineTypeCode: v.machineTypeCode as MachineTypeCode, updatedAt: new Date() })
      .where(and(eq(projectEquipments.id, cur.id), eq(projectEquipments.projectId, p.id)));
    await syncMainType(tx, p.id);
    // R-185: a new type rebuilds the line's plan while it has no inspection (else the plan keeps what was instantiated).
    if (v.machineTypeCode !== cur.machineTypeCode) await rebuildEquipmentPlan(tx, cur.id, v.machineTypeCode);
    const who = await actorOf(tx, actor);
    const message = systemMessage('project.equipmentChanged', { ref, from: lineText(cur), to: lineText({ ...v, typeLabel: types.label(v.machineTypeCode) }) });
    await writeAudit(tx, { ...who, objectRef: `${projectCode} · ${ref}`, message, area: 'Contract', entityType: 'project_equipment', entityId: cur.id, projectId: p.id, before, after });
    await recordActivity(tx, { ...who, message, kind: 'change', projectId: p.id });
  });
}

/**
 * Removes a line. The last line of a project is kept (a project supplies at least one equipment once it has one), and so is a
 * line whose ITP plan has inspections (R-185 part 2). The planning lots and activities, punch items, commissioning systems, BOM
 * lines and machines of the line stay, common to the project (equipment_id set null by the foreign keys); its plan without
 * inspection goes with it. The next line becomes the main one when the first is removed.
 */
export async function removeProjectEquipment(projectCode: string, ref: string, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, p.id)).for('update');
    const lines = await equipmentLinesOf(tx, p.id);
    const cur = lines.find((l) => l.ref === ref);
    if (!cur) throw new Error('Unknown equipment line');
    if (lines.length <= 1) throw new Error('A project keeps at least one equipment line');
    const blocker = equipmentRemovalBlocker({ inspections: await equipmentPlanInspections(tx, cur.id) });
    if (blocker) throw new Error(blocker);
    const [lots, acts, punch, systems, bom, fleet] = await Promise.all([
      tx.select({ id: wbsNodes.id }).from(wbsNodes).where(eq(wbsNodes.equipmentId, cur.id)),
      tx.select({ id: activities.id }).from(activities).where(eq(activities.equipmentId, cur.id)),
      tx.select({ id: punchItems.id }).from(punchItems).where(eq(punchItems.equipmentId, cur.id)),
      tx.select({ id: commissioningSystems.id }).from(commissioningSystems).where(eq(commissioningSystems.equipmentId, cur.id)),
      tx.select({ id: projectBomLines.id }).from(projectBomLines).where(eq(projectBomLines.equipmentId, cur.id)),
      tx.select({ id: machines.id }).from(machines).where(eq(machines.equipmentId, cur.id)),
    ]);
    await tx.delete(projectEquipments).where(eq(projectEquipments.id, cur.id));
    await syncMainType(tx, p.id);
    const who = await actorOf(tx, actor);
    const message = systemMessage('project.equipmentRemoved', { ref, equipment: lineText(cur) });
    await writeAudit(tx, {
      ...who, objectRef: `${projectCode} · ${ref}`, message, area: 'Contract', entityType: 'project_equipment', entityId: cur.id, projectId: p.id,
      before: {
        ...plain(cur), workPackages: lots.length, activities: acts.length, punchItems: punch.length, commissioningSystems: systems.length, bomLines: bom.length,
        machines: fleet.length,
      },
    });
    await recordActivity(tx, { ...who, message, kind: 'change', projectId: p.id });
  });
}

/** Summary of each project's lines by project code ("EMP" / "1 × EMP · 3 × MEMU"); tests and exports. */
export async function equipmentSummaries(codes?: string[]): Promise<Record<string, string | null>> {
  const db = await getDb();
  const ps = await db.select({ id: projects.id, code: projects.code }).from(projects).where(codes?.length ? inArray(projects.code, codes) : undefined);
  const lines = await equipmentLinesByProject(db);
  return Object.fromEntries(ps.map((p) => [p.code, equipmentSummary(lines.get(p.id) ?? [])]));
}
