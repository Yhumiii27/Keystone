import 'server-only';
// Excel / CSV table imports (chapter 4): the database half of ./table.ts. `planTableImport` matches the normalised rows against
// the project (or the catalogue) and returns the preview rows — create / update / skip with OK, warning or error — without writing
// anything; `writeTableImport` writes the same plan in the caller's transaction.
//
// Targets and keys: budget lines → the project's cost categories (Code, else Category name); BOM → the project BOM lines (part
// Reference — the part must be in the catalogue); parts → the catalogue (Reference); resource assignments → the activities'
// assignments (Activity ID + Resource). Mode 'update' = add and update; mode 'new' = add only (rows already there are skipped).
// Cells left empty never erase a value on update.
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { DEFAULT_PROJECT_CALENDAR } from '@/domain/ch4-defaults';
import { BUILTIN_CALENDAR_BY_CODE } from '@/domain/calendar';
import type { DB, Tx } from '@/server/db/client';
import type { BomScope, CostType, ImportMode, PartMakeBuy, PartStatus, PartType, PartUnit, WearSpare } from '@/server/db/codes';
import { findPerson, nameOf, requireProject, writeAudit } from '@/server/db/helpers';
import { activities, activityAssignments, calendars, costCategories, parts, persons, projectBomLines, projects, suppliers } from '@/server/db/schema';
import type { ImportPreviewRow } from '@/server/dal/import-jobs';
import { INTERCHANGE_DEFAULTS } from './defaults';
import { fmt } from './messages';
import { round2 } from './model';
import type { NormalisedRow, TableKind } from './table';

type Q = DB | Tx;

export interface TableSummary {
  kind: TableKind;
  mode: ImportMode;
  projectCode: string | null;
  rows: number;
  create: number;
  update: number;
  skip: number;
  error: number;
  warning: number;
  /** Suppliers the parts import registers. */
  newSuppliers: string[];
  blocking: string[];
}

interface PlannedRow {
  row: NormalisedRow;
  action: 'create' | 'update' | 'skip';
  /** Id of the matched record. */
  targetId: string | null;
  values: Record<string, string | number | null>;
}

export interface TablePlan {
  rows: ImportPreviewRow[];
  summary: TableSummary;
  blocking: string[];
  planned: PlannedRow[];
}

const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();

/** Dry run: matches every row and returns the preview (nothing is written). */
export async function planTableImport(kind: TableKind, input: NormalisedRow[], opts: { mode: ImportMode; projectCode: string | null }, q: Q): Promise<TablePlan> {
  const project = kind === 'parts' ? null : opts.projectCode ? await requireProject(q, opts.projectCode) : null;
  if (kind !== 'parts' && !project) throw new Error(fmt('Choose the project to update'));
  const rows: ImportPreviewRow[] = [];
  const planned: PlannedRow[] = [];
  const newSuppliers = new Set<string>();
  const seen = new Set<string>();

  // Reference data per kind.
  const cats = kind === 'budget_lines' ? await q.select({ id: costCategories.id, code: costCategories.code, name: costCategories.name }).from(costCategories).where(eq(costCategories.projectId, project!.id)) : [];
  const refs = [...new Set(input.map((r) => r.values.ref).filter((x): x is string => typeof x === 'string'))];
  const partRows = (kind === 'bom' || kind === 'parts') && refs.length ? await q.select({ id: parts.id, ref: parts.ref }).from(parts).where(inArray(parts.ref, refs)) : [];
  const partByRef = new Map(partRows.map((p) => [p.ref, p.id]));
  const bomLines = kind === 'bom' ? await q.select({ id: projectBomLines.id, partId: projectBomLines.partId }).from(projectBomLines).where(eq(projectBomLines.projectId, project!.id)) : [];
  const actRows = kind === 'bom' || kind === 'assignments' ? await q.select({ id: activities.id, code: activities.code }).from(activities).where(eq(activities.projectId, project!.id)) : [];
  const actByCode = new Map(actRows.map((a) => [a.code.toUpperCase(), a.id]));
  const assignRows = kind === 'assignments' && actRows.length
    ? await q.select({ id: activityAssignments.id, activityId: activityAssignments.activityId, resource: activityAssignments.resource }).from(activityAssignments).where(inArray(activityAssignments.activityId, actRows.map((a) => a.id)))
    : [];
  const supplierNames = kind === 'parts' ? new Set((await q.select({ name: suppliers.name }).from(suppliers)).map((s) => lc(s.name))) : new Set<string>();
  const people = kind === 'assignments' ? await q.select({ fullName: persons.fullName, shortName: persons.shortName }).from(persons) : [];

  for (const r of input) {
    const messages = [...r.errors, ...r.warnings];
    let action: PlannedRow['action'] = 'create';
    let targetId: string | null = null;
    let error = r.errors.length > 0;
    let warning = r.warnings.length > 0;
    const v = r.values;
    const key = r.key ? lc(r.key) : null;
    if (!error && key) {
      if (seen.has(key)) {
        messages.push(fmt('Duplicate row for {0} — the first one is kept', r.key!));
        error = true;
      } else seen.add(key);
    }
    if (!error) {
      if (kind === 'budget_lines') {
        const m = (v.code ? cats.find((c) => lc(c.code) === lc(v.code)) : undefined) ?? cats.find((c) => lc(c.name) === lc(v.name));
        targetId = m?.id ?? null;
      } else if (kind === 'bom') {
        const partId = partByRef.get(String(v.ref));
        if (!partId) {
          messages.push(fmt('{0} is not in the catalogue', String(v.ref)));
          error = true;
        } else targetId = bomLines.find((b) => b.partId === partId)?.id ?? null;
        if (typeof v.activity === 'string' && !actByCode.has(v.activity)) {
          messages.push(fmt('Unknown activity {0}', v.activity));
          error = true;
        }
      } else if (kind === 'parts') {
        targetId = partByRef.get(String(v.ref)) ?? null;
        if (!targetId && !v.type) {
          messages.push(fmt('{0} is required', 'Type'));
          error = true;
        }
        if (typeof v.supplier === 'string' && !supplierNames.has(lc(v.supplier))) {
          newSuppliers.add(v.supplier);
          messages.push(fmt('New supplier {0} will be registered', v.supplier));
          warning = true;
        }
      } else {
        const actId = actByCode.get(String(v.activity));
        if (!actId) {
          messages.push(fmt('Unknown activity {0}', String(v.activity)));
          error = true;
        } else targetId = assignRows.find((a) => a.activityId === actId && lc(a.resource) === lc(v.resource))?.id ?? null;
        if (!people.some((p) => lc(p.fullName) === lc(v.resource) || lc(p.shortName) === lc(v.resource))) messages.push(fmt('Unknown person — the resource is kept as text'));
      }
    }
    if (error) action = 'skip';
    else if (targetId) action = opts.mode === 'new' ? 'skip' : 'update';
    if (!error && targetId && opts.mode === 'new') {
      messages.push(fmt('Already there — skipped (Add only)'));
      warning = true;
    }
    planned.push({ row: r, action, targetId, values: v });
    rows.push({ status: error ? 'error' : warning ? 'warning' : 'ok', action, key: r.key, data: { line: r.line, ...v }, messages });
  }
  const count = (a: PlannedRow['action']) => planned.filter((p) => p.action === a && !(a === 'skip' && p.row.errors.length)).length;
  const errors = rows.filter((r) => r.status === 'error').length;
  const blocking = planned.some((p) => p.action !== 'skip') ? [] : [fmt('Nothing to import')];
  const summary: TableSummary = {
    kind, mode: opts.mode, projectCode: project?.code ?? null, rows: input.length, create: count('create'), update: count('update'),
    skip: planned.filter((p) => p.action === 'skip').length - errors, error: errors, warning: rows.filter((r) => r.status === 'warning').length, newSuppliers: [...newSuppliers], blocking,
  };
  return { rows, summary, blocking, planned };
}

const num = (v: unknown) => (typeof v === 'number' ? v : null);
const txt = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Writes a planned table import in the caller's transaction. Returns the counts written. */
export async function writeTableImport(kind: TableKind, plan: TablePlan, projectCode: string | null, actorName: string, tx: Tx): Promise<{ created: number; updated: number }> {
  if (plan.blocking.length) throw new Error(plan.blocking[0]);
  const actor = await findPerson(tx, actorName);
  const who = actor ? nameOf(actor) : actorName;
  const project = projectCode ? await requireProject(tx, projectCode) : null;
  let created = 0;
  let updated = 0;
  const todo = plan.planned.filter((p) => p.action !== 'skip');

  if (kind === 'budget_lines') {
    const existing = await tx.select({ code: costCategories.code, position: costCategories.position }).from(costCategories).where(eq(costCategories.projectId, project!.id));
    const codes = new Set(existing.map((c) => c.code.toUpperCase()));
    let pos = Math.max(0, ...existing.map((c) => c.position));
    let n = Math.max(0, ...existing.map((c) => (/^C(\d+)$/i.exec(c.code) ? +/^C(\d+)$/i.exec(c.code)![1] : 0)));
    for (const p of todo) {
      const v = p.values;
      if (p.action === 'update') {
        await tx
          .update(costCategories)
          .set({
            name: String(v.name), costType: v.costType as CostType, budgetKeur: round2(num(v.budget)!), ...(num(v.actual) != null ? { actualKeur: round2(num(v.actual)!) } : {}),
            ...(num(v.committed) != null ? { committedKeur: round2(num(v.committed)!) } : {}), ...(num(v.forecast) != null ? { forecastKeur: round2(num(v.forecast)!) } : {}), updatedAt: new Date(),
          })
          .where(eq(costCategories.id, p.targetId!));
        updated++;
      } else {
        let code = txt(v.code)?.toUpperCase() ?? null;
        if (!code || codes.has(code)) {
          do code = 'C' + String(++n).padStart(2, '0');
          while (codes.has(code));
        }
        codes.add(code);
        await tx.insert(costCategories).values({
          projectId: project!.id, code, name: String(v.name), costType: v.costType as CostType, budgetKeur: round2(num(v.budget)!), actualKeur: round2(num(v.actual) ?? 0),
          committedKeur: round2(num(v.committed) ?? 0), forecastKeur: round2(num(v.forecast) ?? num(v.budget)!), position: ++pos,
        });
        created++;
      }
    }
  } else if (kind === 'bom') {
    const refs = todo.map((p) => String(p.values.ref));
    const partRows = refs.length ? await tx.select({ id: parts.id, ref: parts.ref }).from(parts).where(inArray(parts.ref, refs)) : [];
    const partByRef = new Map(partRows.map((p) => [p.ref, p.id]));
    const acts = await tx.select({ id: activities.id, code: activities.code }).from(activities).where(eq(activities.projectId, project!.id));
    const actByCode = new Map(acts.map((a) => [a.code.toUpperCase(), a.id]));
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${projectBomLines.position}), -1)::int` }).from(projectBomLines).where(eq(projectBomLines.projectId, project!.id));
    let position = pos;
    for (const p of todo) {
      const v = p.values;
      const activityId = txt(v.activity) ? (actByCode.get(String(v.activity)) ?? null) : undefined;
      if (p.action === 'update') {
        await tx
          .update(projectBomLines)
          .set({
            quantity: num(v.quantity)!, ...(txt(v.scope) ? { scope: v.scope as BomScope } : {}), ...(txt(v.note) ? { note: String(v.note) } : {}),
            ...(activityId !== undefined ? { activityId } : {}), updatedAt: new Date(),
          })
          .where(eq(projectBomLines.id, p.targetId!));
        updated++;
      } else {
        const partId = partByRef.get(String(v.ref));
        if (!partId) throw new Error(fmt('{0} is not in the catalogue', String(v.ref)));
        await tx.insert(projectBomLines).values({
          projectId: project!.id, partId, quantity: num(v.quantity)!, activityId: activityId ?? null, scope: (txt(v.scope) as BomScope | null) ?? 'keystone', note: txt(v.note),
          position: ++position, addedByPersonId: actor?.id ?? null,
        });
        created++;
      }
    }
  } else if (kind === 'parts') {
    const supplierRows = await tx.select({ id: suppliers.id, name: suppliers.name, isInternal: suppliers.isInternal, position: suppliers.position }).from(suppliers);
    const supplierOf = new Map(supplierRows.map((s) => [lc(s.name), s]));
    let supplierPos = Math.max(-1, ...supplierRows.map((s) => s.position));
    const supplier = async (name: string | null) => {
      if (!name) return null;
      const known = supplierOf.get(lc(name));
      if (known) return known;
      const [s] = await tx.insert(suppliers).values({ name, position: ++supplierPos, isInternal: name.startsWith('Keystone ') }).returning({ id: suppliers.id, name: suppliers.name, isInternal: suppliers.isInternal, position: suppliers.position });
      supplierOf.set(lc(name), s);
      return s;
    };
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${parts.position}), -1)::int` }).from(parts);
    let position = pos;
    for (const p of todo) {
      const v = p.values;
      const s = await supplier(txt(v.supplier));
      const common = {
        ...(txt(v.type) ? { type: v.type as PartType } : {}), ...(txt(v.makeBuy) ? { makeBuy: v.makeBuy as PartMakeBuy } : {}), ...(txt(v.unit) ? { unit: v.unit as PartUnit } : {}),
        ...(num(v.price) != null ? { listPriceEur: round2(num(v.price)!) } : {}), ...(s ? { manufacturerId: s.id } : {}), ...(txt(v.manufacturerRef) ? { manufacturerRef: String(v.manufacturerRef) } : {}),
        ...(txt(v.hsCode) ? { hsCode: String(v.hsCode) } : {}), ...(num(v.leadWeeks) != null ? { leadWeeks: num(v.leadWeeks)! } : {}), ...(txt(v.revision) ? { revision: String(v.revision) } : {}),
        ...(txt(v.status) ? { status: v.status as PartStatus } : {}), ...(v.wearSpare !== null && v.wearSpare !== undefined ? { wearSpare: v.wearSpare as WearSpare } : {}),
      };
      if (p.action === 'update') {
        await tx.update(parts).set({ name: String(v.name), ...common, updatedAt: new Date() }).where(eq(parts.id, p.targetId!));
        updated++;
      } else {
        await tx.insert(parts).values({
          ref: String(v.ref), name: String(v.name), makeBuy: s?.isInternal ? 'manufactured' : 'purchased', type: v.type as PartType, listPriceEur: 0, status: INTERCHANGE_DEFAULTS.newPartStatus, revision: 'A',
          unit: 'pc', position: ++position, createdByPersonId: actor?.id ?? null, ...common,
        });
        created++;
      }
    }
  } else {
    const [proj] = await tx.select({ calendar: projects.calendar }).from(projects).where(eq(projects.id, project!.id));
    const calCode = proj?.calendar ?? DEFAULT_PROJECT_CALENDAR;
    const [cal] = await tx.select({ hours: calendars.hoursPerDay }).from(calendars).where(eq(calendars.code, calCode));
    const defaultHours = cal?.hours ?? BUILTIN_CALENDAR_BY_CODE[DEFAULT_PROJECT_CALENDAR].hoursPerDay;
    const acts = await tx.select({ id: activities.id, code: activities.code }).from(activities).where(eq(activities.projectId, project!.id));
    const actByCode = new Map(acts.map((a) => [a.code.toUpperCase(), a.id]));
    const people = await tx.select({ id: persons.id, fullName: persons.fullName, shortName: persons.shortName, title: persons.jobTitle, dept: persons.departmentId }).from(persons);
    const fmtH = (h: number) => Math.round(h).toLocaleString('en-US');
    for (const p of todo) {
      const v = p.values;
      const activityId = actByCode.get(String(v.activity))!;
      const person = people.find((x) => lc(x.fullName) === lc(v.resource) || lc(x.shortName) === lc(v.resource)) ?? null;
      const [cur] = p.targetId ? await tx.select().from(activityAssignments).where(eq(activityAssignments.id, p.targetId)) : [];
      const count = num(v.count) ?? cur?.resourceCount ?? 1;
      const hpd = num(v.hoursPerDay) ?? cur?.hoursPerDay ?? defaultHours;
      const planned = num(v.plannedHours) ?? cur?.plannedHours ?? null;
      const actual = num(v.actualHours) ?? cur?.actualHours ?? null;
      const values = {
        resource: String(v.resource).slice(0, 200), personId: person?.id ?? cur?.personId ?? null, detail: txt(v.detail) ?? cur?.detail ?? person?.title ?? '',
        units: `${round2(count)} × ${round2(hpd)} h/d`, progressText: planned != null ? `${fmtH(actual ?? 0)} / ${fmtH(planned)} h` : '—',
        resourceCount: round2(count), hoursPerDay: round2(hpd), plannedHours: planned != null ? round2(planned) : null, actualHours: actual != null ? round2(actual) : null,
        departmentId: person?.dept ?? cur?.departmentId ?? null,
      };
      if (p.action === 'update') {
        await tx.update(activityAssignments).set(values).where(eq(activityAssignments.id, p.targetId!));
        updated++;
      } else {
        const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${activityAssignments.position}), -1)::int` }).from(activityAssignments).where(eq(activityAssignments.activityId, activityId));
        await tx.insert(activityAssignments).values({ activityId, position: pos + 1, ...values });
        created++;
      }
    }
  }
  const area = kind === 'budget_lines' ? 'Budget' : kind === 'bom' ? 'BOM' : kind === 'parts' ? 'PLM' : 'Planning';
  const label = kind === 'budget_lines' ? 'budget lines' : kind === 'bom' ? 'BOM lines' : kind === 'parts' ? 'parts' : 'resource assignments';
  await writeAudit(tx, {
    actorName: who, actorPersonId: actor?.id, objectRef: project ? `${project.code} ${label}` : 'Parts catalogue', change: `imported · ${created} created · ${updated} updated`, area,
    entityType: 'import', projectId: project?.id ?? null,
  });
  return { created, updated };
}

/** Projects a table import may target, with their activity count (dialog select). */
export async function listImportTargets(q: Q): Promise<{ code: string; name: string; activities: number }[]> {
  const rows = await q
    .select({ code: projects.code, name: projects.name, n: sql<number>`(select count(*)::int from ${activities} where ${activities.projectId} = ${projects.id})` })
    .from(projects)
    .orderBy(asc(projects.sortOrder));
  return rows.map((r) => ({ code: r.code, name: r.name, activities: r.n }));
}

