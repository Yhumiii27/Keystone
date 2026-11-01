import 'server-only';
// R-204 — activity codes of a project (src/domain/activity-codes.ts): the dictionary (derived equipment and purchasing package
// types, stored site and custom types with their values), the codes of each activity, and the writers of the dictionary and of
// the assignments (the Server Functions check the rights: the project's leads and the director). Every write is audited.
import { and, asc, eq, max } from 'drizzle-orm';
import {
  DERIVED_CODE_TYPE_NAMES, parseCodeType, parseCodeValue, type ActivityCodeError, type ActivityCodeMap, type CodeType,
} from '@/domain/activity-codes';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import {
  activities, activityCodeAssignments, activityCodeTypes, activityCodeValues, projectEquipments, projects, purchaseOrders, suppliers, supplierScheduleTies, supplierSchedules,
} from '@/server/db/schema';
import type { Actor } from './ops-common';

type Q = DB | Tx;

export interface ActivityCodes {
  types: CodeType[];
  /** Activity code ("A1250") → type key → value keys. */
  map: ActivityCodeMap;
}

/** The project's activity code dictionary and the codes of its activities; null for an unknown project. */
export async function getActivityCodes(projectCode: string, q?: Q): Promise<ActivityCodes | null> {
  const db = q ?? (await getDb());
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, projectCode));
  if (!p) return null;
  const [acts, eqs, pos, ties, types, values, assigned] = await Promise.all([
    db.select({ id: activities.id, code: activities.code, equipmentId: activities.equipmentId }).from(activities).where(eq(activities.projectId, p.id)),
    db
      .select({ id: projectEquipments.id, ref: projectEquipments.ref, type: projectEquipments.machineTypeCode, qty: projectEquipments.quantity, label: projectEquipments.label })
      .from(projectEquipments)
      .where(eq(projectEquipments.projectId, p.id))
      .orderBy(asc(projectEquipments.position)),
    db
      .select({ number: purchaseOrders.number, activityId: purchaseOrders.neededForActivityId, supplier: suppliers.name, position: purchaseOrders.position })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(eq(purchaseOrders.projectId, p.id))
      .orderBy(asc(purchaseOrders.position)),
    db
      .select({ number: purchaseOrders.number, activityId: supplierScheduleTies.activityId })
      .from(supplierScheduleTies)
      .innerJoin(supplierSchedules, eq(supplierSchedules.id, supplierScheduleTies.scheduleId))
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, supplierSchedules.poId))
      .where(eq(supplierSchedules.projectId, p.id)),
    db.select().from(activityCodeTypes).where(eq(activityCodeTypes.projectId, p.id)).orderBy(asc(activityCodeTypes.position)),
    db
      .select({ v: activityCodeValues })
      .from(activityCodeValues)
      .innerJoin(activityCodeTypes, eq(activityCodeTypes.id, activityCodeValues.typeId))
      .where(eq(activityCodeTypes.projectId, p.id))
      .orderBy(asc(activityCodeValues.position)),
    db
      .select({ activityId: activityCodeAssignments.activityId, typeId: activityCodeAssignments.typeId, valueId: activityCodeAssignments.valueId })
      .from(activityCodeAssignments)
      .innerJoin(activityCodeTypes, eq(activityCodeTypes.id, activityCodeAssignments.typeId))
      .where(eq(activityCodeTypes.projectId, p.id)),
  ]);
  const codeOf = new Map(acts.map((a) => [a.id, a.code]));
  const map: ActivityCodeMap = Object.fromEntries(acts.map((a) => [a.code, {}]));
  const add = (activityId: string | null, type: string, value: string) => {
    const code = activityId ? codeOf.get(activityId) : undefined;
    if (!code) return;
    const list = (map[code][type] ??= []);
    if (!list.includes(value)) list.push(value);
  };
  const out: CodeType[] = [];
  if (eqs.length) {
    out.push({
      key: 'equipment', kind: 'equipment', name: DERIVED_CODE_TYPE_NAMES.equipment, derived: true,
      values: eqs.map((e) => ({ key: e.id, code: e.ref, label: `${e.qty} × ${e.type.toUpperCase()}${e.label ? ` · ${e.label}` : ''}` })),
    });
    for (const a of acts) if (a.equipmentId) add(a.id, 'equipment', a.equipmentId);
  }
  const packages = pos.filter((x) => x.activityId) as typeof pos;
  const tiedNumbers = new Set(ties.map((t) => t.number));
  const pkgValues = pos.filter((x) => x.activityId || tiedNumbers.has(x.number));
  if (pkgValues.length) {
    out.push({ key: 'purchase_package', kind: 'purchase_package', name: DERIVED_CODE_TYPE_NAMES.purchase_package, derived: true, values: pkgValues.map((x) => ({ key: x.number, code: x.number, label: x.supplier })) });
    for (const x of packages) add(x.activityId, 'purchase_package', x.number);
    for (const t of ties) add(t.activityId, 'purchase_package', t.number);
  }
  for (const t of types)
    out.push({ key: t.id, kind: t.kind, name: t.name, derived: false, values: values.filter((v) => v.v.typeId === t.id).map(({ v }) => ({ key: v.id, code: v.code, label: v.label })) });
  for (const a of assigned) add(a.activityId, a.typeId, a.valueId);
  return { types: out, map };
}

export class ActivityCodeWriteError extends Error {
  constructor(readonly code: ActivityCodeError | 'unknownActivity') {
    super(code);
  }
}

async function who(tx: Tx, actor: Actor) {
  const person = await findPerson(tx, actor.name);
  return { name: person ? nameOf(person) : actor.name, personId: person?.id ?? null };
}

/** Adds a stored code type (site or custom) at the end of the dictionary. Returns its id. */
export async function addActivityCodeType(projectCode: string, input: { name?: unknown; kind?: unknown }, actor: Actor): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const existing = await tx.select({ name: activityCodeTypes.name, kind: activityCodeTypes.kind }).from(activityCodeTypes).where(eq(activityCodeTypes.projectId, p.id)).for('update');
    const parsed = parseCodeType(input, existing);
    if (!parsed.ok) throw new ActivityCodeWriteError(parsed.error);
    const [{ last }] = await tx.select({ last: max(activityCodeTypes.position) }).from(activityCodeTypes).where(eq(activityCodeTypes.projectId, p.id));
    const [row] = await tx.insert(activityCodeTypes).values({ projectId: p.id, kind: parsed.value.kind, name: parsed.value.name, position: (last ?? -1) + 1 }).returning({ id: activityCodeTypes.id });
    const w = await who(tx, actor);
    await writeAudit(tx, {
      actorName: w.name, actorPersonId: w.personId, objectRef: projectCode, change: `activity code type added: ${parsed.value.name} (${parsed.value.kind})`,
      area: 'Planning', entityType: 'activity_code_type', entityId: row.id, projectId: p.id, after: parsed.value,
    });
    return row.id;
  });
}

async function typeOf(tx: Tx, projectId: string, typeId: string) {
  const [t] = await tx.select().from(activityCodeTypes).where(and(eq(activityCodeTypes.id, typeId), eq(activityCodeTypes.projectId, projectId)));
  if (!t) throw new ActivityCodeWriteError('unknownType');
  return t;
}

/** Removes a stored code type with its values and assignments. */
export async function removeActivityCodeType(projectCode: string, typeId: string, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const t = await typeOf(tx, p.id, typeId);
    const values = await tx.select({ code: activityCodeValues.code }).from(activityCodeValues).where(eq(activityCodeValues.typeId, t.id));
    await tx.delete(activityCodeTypes).where(eq(activityCodeTypes.id, t.id));
    const w = await who(tx, actor);
    await writeAudit(tx, {
      actorName: w.name, actorPersonId: w.personId, objectRef: projectCode, change: `activity code type removed: ${t.name}`,
      area: 'Planning', entityType: 'activity_code_type', entityId: t.id, projectId: p.id, before: { name: t.name, kind: t.kind, values: values.map((v) => v.code) },
    });
  });
}

/** Adds a value to a stored code type. Returns its id. */
export async function addActivityCodeValue(projectCode: string, typeId: string, input: { code?: unknown; label?: unknown }, actor: Actor): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const t = await typeOf(tx, p.id, typeId);
    const existing = await tx.select({ code: activityCodeValues.code, position: activityCodeValues.position }).from(activityCodeValues).where(eq(activityCodeValues.typeId, t.id)).for('update');
    const parsed = parseCodeValue(input, existing);
    if (!parsed.ok) throw new ActivityCodeWriteError(parsed.error);
    const position = existing.reduce((m, v) => Math.max(m, v.position), -1) + 1;
    const [row] = await tx.insert(activityCodeValues).values({ typeId: t.id, code: parsed.value.code, label: parsed.value.label, position }).returning({ id: activityCodeValues.id });
    const w = await who(tx, actor);
    await writeAudit(tx, {
      actorName: w.name, actorPersonId: w.personId, objectRef: projectCode, change: `activity code ${t.name}: value ${parsed.value.code} added`,
      area: 'Planning', entityType: 'activity_code_value', entityId: row.id, projectId: p.id, after: parsed.value,
    });
    return row.id;
  });
}

/** Removes a value (the activities that had it lose it). */
export async function removeActivityCodeValue(projectCode: string, valueId: string, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const [v] = await tx
      .select({ id: activityCodeValues.id, code: activityCodeValues.code, label: activityCodeValues.label, type: activityCodeTypes.name })
      .from(activityCodeValues)
      .innerJoin(activityCodeTypes, eq(activityCodeTypes.id, activityCodeValues.typeId))
      .where(and(eq(activityCodeValues.id, valueId), eq(activityCodeTypes.projectId, p.id)));
    if (!v) throw new ActivityCodeWriteError('unknownValue');
    const used = await tx.select({ code: activities.code }).from(activityCodeAssignments).innerJoin(activities, eq(activities.id, activityCodeAssignments.activityId)).where(eq(activityCodeAssignments.valueId, v.id));
    await tx.delete(activityCodeValues).where(eq(activityCodeValues.id, v.id));
    const w = await who(tx, actor);
    await writeAudit(tx, {
      actorName: w.name, actorPersonId: w.personId, objectRef: projectCode, change: `activity code ${v.type}: value ${v.code} removed`,
      area: 'Planning', entityType: 'activity_code_value', entityId: v.id, projectId: p.id, before: { code: v.code, label: v.label, activities: used.map((u) => u.code) },
    });
  });
}

/**
 * Sets (null clears) the value of one type on one activity. The equipment type writes the activity's equipment line (R-185);
 * the purchasing package is derived from the orders and cannot be set here.
 */
export async function setActivityCode(projectCode: string, activityCode: string, typeKey: string, valueKey: string | null, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const [a] = await tx.select({ id: activities.id, code: activities.code, equipmentId: activities.equipmentId }).from(activities).where(and(eq(activities.projectId, p.id), eq(activities.code, activityCode))).for('update');
    if (!a) throw new ActivityCodeWriteError('unknownActivity');
    const w = await who(tx, actor);
    if (typeKey === 'purchase_package') throw new ActivityCodeWriteError('derived');
    if (typeKey === 'equipment') {
      const lines = await tx.select({ id: projectEquipments.id, ref: projectEquipments.ref }).from(projectEquipments).where(eq(projectEquipments.projectId, p.id));
      const to = valueKey ? lines.find((l) => l.id === valueKey) : null;
      if (valueKey && !to) throw new ActivityCodeWriteError('unknownValue');
      if ((to?.id ?? null) === a.equipmentId) return;
      const from = lines.find((l) => l.id === a.equipmentId);
      await tx.update(activities).set({ equipmentId: to?.id ?? null, updatedAt: new Date() }).where(eq(activities.id, a.id));
      await writeAudit(tx, {
        actorName: w.name, actorPersonId: w.personId, objectRef: `${projectCode} · ${a.code}`, change: `equipment: ${from?.ref ?? '—'} → ${to?.ref ?? '—'}`,
        area: 'Planning', entityType: 'activity', entityId: a.id, projectId: p.id, before: { equipment: from?.ref ?? null }, after: { equipment: to?.ref ?? null },
      });
      return;
    }
    const t = await typeOf(tx, p.id, typeKey).catch(() => {
      throw new ActivityCodeWriteError('unknownType');
    });
    const [cur] = await tx
      .select({ id: activityCodeAssignments.id, valueId: activityCodeAssignments.valueId, code: activityCodeValues.code })
      .from(activityCodeAssignments)
      .innerJoin(activityCodeValues, eq(activityCodeValues.id, activityCodeAssignments.valueId))
      .where(and(eq(activityCodeAssignments.activityId, a.id), eq(activityCodeAssignments.typeId, t.id)));
    let to: { id: string; code: string } | null = null;
    if (valueKey) {
      const [v] = await tx.select({ id: activityCodeValues.id, code: activityCodeValues.code }).from(activityCodeValues).where(and(eq(activityCodeValues.id, valueKey), eq(activityCodeValues.typeId, t.id)));
      if (!v) throw new ActivityCodeWriteError('unknownValue');
      to = v;
    }
    if ((cur?.valueId ?? null) === (to?.id ?? null)) return;
    if (cur) await tx.delete(activityCodeAssignments).where(eq(activityCodeAssignments.id, cur.id));
    if (to) await tx.insert(activityCodeAssignments).values({ activityId: a.id, typeId: t.id, valueId: to.id });
    await writeAudit(tx, {
      actorName: w.name, actorPersonId: w.personId, objectRef: `${projectCode} · ${a.code}`, change: `${t.name}: ${cur?.code ?? '—'} → ${to?.code ?? '—'}`,
      area: 'Planning', entityType: 'activity', entityId: a.id, projectId: p.id, before: { [t.name]: cur?.code ?? null }, after: { [t.name]: to?.code ?? null },
    });
    await recordActivity(tx, { actorName: w.name, actorPersonId: w.personId, text: `${a.code} · ${t.name}: ${to?.code ?? '—'}`, kind: 'change', projectId: p.id });
  });
}
