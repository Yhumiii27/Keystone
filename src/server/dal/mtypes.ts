import 'server-only';
// Standard machine types DAL (docs/spec/09 §9). One aggregate per machine type: label, description, default calendar,
// active flag, standard phases, reference cost categories (k€), ITP systems, the REX payment pattern and its reference
// projects (`MT_ALL` 5085). The new-project wizard instantiates the type (phases, cost categories, ITP plan — A-2); E-9 'a'
// (R-057): a type's changes apply to the projects created afterwards — an ITP plan keeps the systems frozen when it was
// created (itp_plan_systems, itp.ts); Budget still reads the REX pattern live (budget.ts).
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { calendar, costType, machineType, type CalendarCode, type CostType, type MachineTypeCode } from '@/server/db/codes';
import { machineTypeCostCategories, machineTypeItpSystems, machineTypePhases, machineTypes, projects, rexReferences } from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';

export type { Actor };

/** Calendars offered by the identity card (the prototype's three; "Site 6d · 10h" is the site calendar). */
export const MACHINE_TYPE_CALENDARS: readonly CalendarCode[] = ['standard_5x8', 'standard_5x8_workshop', 'site_6x10'];

export interface MachineTypeRow {
  code: MachineTypeCode;
  /** Display code ("EMP", "R&D"). */
  displayCode: string;
  /** Editable label (the display code until edited, as MT_ALL). */
  label: string;
  description: string;
  calendar: CalendarCode;
  calendarLabel: string;
  active: boolean;
  isStandard: boolean;
  phases: string[];
  costCategories: { name: string; type: CostType; typeLabel: string; budgetKeur: number }[];
  /** Σ reference budgets, k€. */
  costTotalKeur: number;
  itpSystems: string[];
  depositPct: number;
  deliveryPct: number;
  acceptancePct: number;
  /** Shares total 100 %. */
  termsOk: boolean;
  rexReferences: { analyticCode: string; projectName: string; year: string; pattern: string }[];
  /** Projects of this type (register order): code, name, stage — R-185: by main type (the first equipment line's), as the prototype. */
  projects: { code: string; name: string; number: string | null }[];
}

/** Every machine type (MACHINE_TYPES order, custom types after). */
export async function listMachineTypes(): Promise<MachineTypeRow[]> {
  const db = await getDb();
  const [types, phases, cats, itp, refs, projs] = await Promise.all([
    db.select().from(machineTypes).orderBy(asc(machineTypes.sortOrder)),
    db.select().from(machineTypePhases).orderBy(asc(machineTypePhases.position)),
    db.select().from(machineTypeCostCategories).orderBy(asc(machineTypeCostCategories.position)),
    db.select().from(machineTypeItpSystems).orderBy(asc(machineTypeItpSystems.position)),
    db.select().from(rexReferences).orderBy(asc(rexReferences.position)),
    db.select({ code: projects.code, name: projects.name, number: projects.number, mt: projects.machineTypeCode }).from(projects).orderBy(asc(projects.sortOrder)),
  ]);
  return types.map((t) => {
    const c = cats.filter((x) => x.machineTypeCode === t.code).map((x) => ({ name: x.name, type: x.costType, typeLabel: costType.label(x.costType), budgetKeur: x.budgetKeur }));
    const cal = t.calendar ?? 'standard_5x8';
    return {
      code: t.code, displayCode: t.label, label: t.name ?? t.label, description: t.description ?? '', calendar: cal, calendarLabel: calendar.label(cal), active: t.active,
      isStandard: t.isStandard, phases: phases.filter((x) => x.machineTypeCode === t.code).map((x) => x.name), costCategories: c,
      costTotalKeur: c.reduce((s, x) => s + x.budgetKeur, 0), itpSystems: itp.filter((x) => x.machineTypeCode === t.code).map((x) => x.name),
      depositPct: t.depositPct, deliveryPct: t.deliveryPct, acceptancePct: t.acceptancePct, termsOk: t.depositPct + t.deliveryPct + t.acceptancePct === 100,
      rexReferences: refs.filter((r) => r.machineTypeCode === t.code).map((r) => ({ analyticCode: r.analyticCode, projectName: r.projectName, year: r.year, pattern: r.pattern })),
      projects: projs.filter((p) => p.mt === t.code).map((p) => ({ code: p.code, name: p.name, number: p.number })),
    };
  });
}

/** R-185: the active machine types an equipment line may take (code, display code), in order. */
export async function listMachineTypeOptions(): Promise<{ code: string; label: string }[]> {
  const db = await getDb();
  const rows = await db.select({ code: machineTypes.code, label: machineTypes.label }).from(machineTypes).where(eq(machineTypes.active, true)).orderBy(asc(machineTypes.sortOrder));
  return rows;
}

/** One machine type by code ("EMP", "rnd" or "R&D"). */
export async function getMachineType(code: string): Promise<MachineTypeRow | null> {
  const c = machineType.labels.includes(code) ? machineType.code(code) : code;
  return (await listMachineTypes()).find((t) => t.code === c) ?? null;
}

const MT = (actor: Actor) => requireWorkspace('mtypes', actor, 'Machine types');

async function loadType(tx: Tx, code: string) {
  const c = machineType.labels.includes(code) ? machineType.code(code) : code;
  const [t] = await tx.select().from(machineTypes).where(eq(machineTypes.code, c));
  if (!t) throw new Error(`Unknown machine type ${code}`);
  return t;
}

const pct = (v: unknown, what: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error(`${what} must be a whole percentage (0–100)`);
  return n;
};

export interface MachineTypePatch {
  label?: string;
  description?: string;
  calendar?: CalendarCode;
  active?: boolean;
  depositPct?: number;
  deliveryPct?: number;
  acceptancePct?: number;
}

/**
 * Identity card and payment pattern edits (`mtOv`). Shares that do not total 100 % are saved and flagged, as the
 * prototype ("Shares must total 100 %" is a warning, not a block).
 */
export async function updateMachineType(code: string, patch: MachineTypePatch, actor: Actor): Promise<void> {
  MT(actor);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const t = await loadType(tx, code);
    const set: Partial<typeof machineTypes.$inferInsert> = { updatedAt: new Date() };
    const changes: string[] = [];
    if (patch.label !== undefined) { set.name = requiredText(patch.label, 'Label', 120); changes.push(`label: ${set.name}`); }
    if (patch.description !== undefined) { set.description = patch.description.trim().slice(0, 2000); changes.push('description'); }
    if (patch.calendar !== undefined) {
      if (!MACHINE_TYPE_CALENDARS.includes(patch.calendar)) throw new Error('Invalid calendar');
      set.calendar = patch.calendar;
      changes.push(`calendar: ${calendar.label(patch.calendar)}`);
    }
    if (patch.active !== undefined) { set.active = !!patch.active; changes.push(patch.active ? 'activated' : 'deactivated'); }
    if (patch.depositPct !== undefined) { set.depositPct = pct(patch.depositPct, 'Deposit'); changes.push(`deposit ${set.depositPct} %`); }
    if (patch.deliveryPct !== undefined) { set.deliveryPct = pct(patch.deliveryPct, 'Delivery'); changes.push(`delivery ${set.deliveryPct} %`); }
    if (patch.acceptancePct !== undefined) { set.acceptancePct = pct(patch.acceptancePct, 'Acceptance'); changes.push(`acceptance ${set.acceptancePct} %`); }
    if (!changes.length) return;
    await tx.update(machineTypes).set(set).where(eq(machineTypes.code, t.code));
    await trace(tx, await whoIs(tx, actor), { objectRef: `Machine type ${t.label}`, change: changes.join(' · '), area: 'Settings', entityType: 'machine_type' });
  });
}

/** Replaces the standard phases ("Add phase" appends "New phase"; names edited in place; remove). */
export async function setMachineTypePhases(code: string, phases: string[], actor: Actor): Promise<void> {
  MT(actor);
  const names = phases.map((p, i) => requiredText(p, `Phase ${i + 1}`, 120));
  const db = await getDb();
  await db.transaction(async (tx) => {
    const t = await loadType(tx, code);
    // R-185: a phase keeps its "specific to an equipment" flag while its name is kept (a new or renamed phase is common).
    const perEquipment = new Set((await tx.select({ name: machineTypePhases.name, flag: machineTypePhases.perEquipment }).from(machineTypePhases)
      .where(eq(machineTypePhases.machineTypeCode, t.code))).filter((p) => p.flag).map((p) => p.name));
    await tx.delete(machineTypePhases).where(eq(machineTypePhases.machineTypeCode, t.code));
    if (names.length) await tx.insert(machineTypePhases).values(names.map((name, position) => ({ machineTypeCode: t.code, position, name, perEquipment: perEquipment.has(name) })));
    await trace(tx, await whoIs(tx, actor), { objectRef: `Machine type ${t.label}`, change: `phases: ${names.length}`, area: 'Settings', entityType: 'machine_type' });
  });
}

/** Replaces the ITP systems ("Add system" appends "New system") — for the plans created afterwards (E-9 'a', R-057: existing plans keep theirs). */
export async function setMachineTypeItpSystems(code: string, systems: string[], actor: Actor): Promise<void> {
  MT(actor);
  const names = systems.map((s, i) => requiredText(s, `System ${i + 1}`, 120));
  if (new Set(names).size !== names.length) throw new Error('ITP systems must be distinct');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const t = await loadType(tx, code);
    await tx.delete(machineTypeItpSystems).where(eq(machineTypeItpSystems.machineTypeCode, t.code));
    if (names.length) await tx.insert(machineTypeItpSystems).values(names.map((name, position) => ({ machineTypeCode: t.code, position, name })));
    await trace(tx, await whoIs(tx, actor), { objectRef: `Machine type ${t.label}`, change: `ITP systems: ${names.length}`, area: 'Settings', entityType: 'machine_type' });
  });
}

/** Replaces the reference cost categories ("Add category" → New category · Labor · 0). Budgets in k€, ≥ 0. */
export async function setMachineTypeCostCategories(code: string, cats: { name: string; type: CostType; budgetKeur: number }[], actor: Actor): Promise<void> {
  MT(actor);
  const rows = cats.map((c, i) => {
    if (!costType.isCode(c.type) || c.type === 'reserve') throw new Error(`Category ${i + 1}: invalid type`);
    const b = Number(c.budgetKeur);
    if (!Number.isFinite(b) || b < 0) throw new Error(`Category ${i + 1}: invalid budget`);
    return { name: requiredText(c.name, `Category ${i + 1}`, 120), costType: c.type, budgetKeur: b };
  });
  const db = await getDb();
  await db.transaction(async (tx) => {
    const t = await loadType(tx, code);
    await tx.delete(machineTypeCostCategories).where(eq(machineTypeCostCategories.machineTypeCode, t.code));
    if (rows.length) await tx.insert(machineTypeCostCategories).values(rows.map((r, position) => ({ machineTypeCode: t.code, position, ...r })));
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Machine type ${t.label}`, change: `cost categories: ${rows.length} · ${rows.reduce((s, r) => s + r.budgetKeur, 0)} k€`, area: 'Settings', entityType: 'machine_type',
    });
  });
}

/** Removes a reference project from the financial REX of a machine type. */
export async function removeRexReference(code: string, analyticCode: string, actor: Actor): Promise<void> {
  MT(actor);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const t = await loadType(tx, code);
    const refs = await tx.select().from(rexReferences).where(eq(rexReferences.machineTypeCode, t.code));
    const r = refs.find((x) => x.analyticCode === analyticCode);
    if (!r) throw new Error(`Unknown reference project ${analyticCode}`);
    await tx.delete(rexReferences).where(eq(rexReferences.id, r.id));
    await trace(tx, await whoIs(tx, actor), { objectRef: `Machine type ${t.label}`, change: `REX reference removed: ${analyticCode} · ${r.projectName}`, area: 'Settings', entityType: 'machine_type' });
  });
}

export interface NewMachineTypeInput {
  code: string;
  label: string;
  /** Template copied ("EMP"…; 'blank' = no phases, no categories, ITP "General", 30 / 60 / 10). */
  base: string;
  calendar: CalendarCode;
  description?: string | null;
}

/** Code of a new machine type: trimmed, upper-cased, spaces → "-" (AF.mtype). */
export const normaliseMachineTypeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '-');

/** "New machine type": a custom (non-standard) active type copied from a template; refused when the code is taken. */
export async function createMachineType(input: NewMachineTypeInput, actor: Actor): Promise<string> {
  MT(actor);
  const code = normaliseMachineTypeCode(input.code ?? '');
  if (!code) throw new Error('Code is required');
  if (code.length > 20) throw new Error('Code is too long');
  const label = requiredText(input.label, 'Label', 120);
  if (!calendar.isCode(input.calendar)) throw new Error('Invalid calendar');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const all = await tx.select({ code: machineTypes.code, label: machineTypes.label, sortOrder: machineTypes.sortOrder }).from(machineTypes);
    if (all.some((t) => t.code.toUpperCase() === code || t.label.toUpperCase() === code)) throw new Error('Code already used');
    const blank = input.base === 'blank' || !input.base;
    const base = blank ? null : await loadType(tx, input.base);
    await tx.insert(machineTypes).values({
      code, label: code, name: label, description: (input.description ?? '').trim(), calendar: input.calendar, isStandard: false, active: true,
      depositPct: base?.depositPct ?? 30, deliveryPct: base?.deliveryPct ?? 60, acceptancePct: base?.acceptancePct ?? 10,
      sortOrder: all.reduce((m, t) => Math.max(m, t.sortOrder + 1), 1),
    });
    if (base) {
      const [ph, ca, it] = await Promise.all([
        tx.select().from(machineTypePhases).where(eq(machineTypePhases.machineTypeCode, base.code)),
        tx.select().from(machineTypeCostCategories).where(eq(machineTypeCostCategories.machineTypeCode, base.code)),
        tx.select().from(machineTypeItpSystems).where(eq(machineTypeItpSystems.machineTypeCode, base.code)),
      ]);
      if (ph.length) await tx.insert(machineTypePhases).values(ph.map((x) => ({ ...x, machineTypeCode: code })));
      if (ca.length) await tx.insert(machineTypeCostCategories).values(ca.map((x) => ({ ...x, machineTypeCode: code })));
      if (it.length) await tx.insert(machineTypeItpSystems).values(it.map((x) => ({ ...x, machineTypeCode: code })));
    } else await tx.insert(machineTypeItpSystems).values({ machineTypeCode: code, position: 0, name: 'General' });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Machine type ${code}`, change: `created · ${label} · from ${base ? base.label : 'Blank'}`, area: 'Settings', entityType: 'machine_type',
      activity: { text: `${code} · Machine type created`, kind: 'change' },
    });
    return code;
  });
}
