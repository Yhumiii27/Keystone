import 'server-only';
// Project cost categories (chapter 4, A-14 — Budget › Structure & changes "Add category" / "Edit category", which the
// prototype left without behaviour, 04 §1.7 Q4). Categories are per project ("Per-project overrides allowed"): "Add"
// offers Settings › Cost categories and maps each to its cost type (src/domain/settings-rules.ts); the name, type and
// budget can be edited. The budget baseline (BAC) is not touched: it changes only through an approved change request.
// Numbering C01, C02… per project. Writers record audit + activity; the Server Functions check the viewer first.
import { and, asc, eq } from 'drizzle-orm';
import { CATEGORY_FROZEN_MESSAGE, categoryAmountFrozen } from '@/domain/baseline-policy';
import { getDb } from '@/server/db/client';
import { costType, type CostType } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { baselines, costCategories } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';

/** Largest budget a category accepts, k€ (a typo guard: €1bn). */
export const MAX_CATEGORY_BUDGET_KEUR = 1_000_000;

export interface CostCategoryInput {
  name: string;
  type: CostType;
  budgetKeur: number;
}

function validName(name: string): string {
  const n = (name ?? '').trim();
  if (!n) throw new Error('Category name is required');
  if (n.length > 120) throw new Error('Category name is too long');
  return n;
}

function validBudget(v: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_CATEGORY_BUDGET_KEUR) throw new Error('Enter a budget in k€ (0 or more)');
  return Math.round(v * 100) / 100;
}

function validType(t: string): CostType {
  if (!costType.isCode(t)) throw new Error('Unknown cost type');
  return t;
}

/** "C07" after C01…C06 (highest number + 1). */
export function nextCategoryCode(codes: readonly string[]): string {
  const max = codes.reduce((m, c) => {
    const x = /^C(\d+)$/.exec(c);
    return x ? Math.max(m, parseInt(x[1], 10)) : m;
  }, 0);
  return 'C' + String(max + 1).padStart(2, '0');
}

async function actorOf(tx: Tx, actorName: string) {
  const p = await findPerson(tx, actorName);
  return { actorName: p ? nameOf(p) : actorName, actorPersonId: p?.id ?? null };
}

/** R-081 (C-3a): the project's category amounts are frozen — it has BL1 or a later BLn, any state (read inside the writer's transaction). */
export async function categoryAmountsFrozen(q: DB | Tx, projectId: string): Promise<boolean> {
  const rows = await q.select({ code: baselines.code }).from(baselines).where(eq(baselines.projectId, projectId));
  return categoryAmountFrozen(rows.map((r) => r.code));
}

/**
 * "Add category": appended with the next code; actual and committed 0, forecast = budget. Same name twice is refused.
 * Delivery 8 (R-081): after BL1 the category is created at 0 k€ (forecast 0) whatever budget is given — its amount then moves only
 * through an approved change request.
 */
export async function addProjectCostCategory(projectCode: string, input: CostCategoryInput, actorName: string): Promise<string> {
  const name = validName(input.name);
  const type = validType(input.type);
  const asked = validBudget(input.budgetKeur);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const budget = (await categoryAmountsFrozen(tx, p.id)) ? 0 : asked;
    const rows = await tx.select().from(costCategories).where(eq(costCategories.projectId, p.id)).orderBy(asc(costCategories.position));
    if (rows.some((r) => r.name.toLowerCase() === name.toLowerCase())) throw new Error(`"${name}" is already a cost category of this project`);
    const code = nextCategoryCode(rows.map((r) => r.code));
    await tx.insert(costCategories).values({
      projectId: p.id, code, name, costType: type, budgetKeur: budget, actualKeur: 0, committedKeur: 0, forecastKeur: budget,
      position: rows.reduce((m, r) => Math.max(m, r.position), 0) + 1,
    });
    const who = await actorOf(tx, actorName);
    await writeAudit(tx, { ...who, objectRef: `${p.code} · ${code}`, change: `cost category added: ${name} · ${costType.label(type)} · ${budget} k€`, area: 'Budget', entityType: 'cost_category', projectId: p.id });
    await recordActivity(tx, { ...who, text: `${p.code} · cost category ${code} ${name} added`, kind: 'change', projectId: p.id });
    return code;
  });
}

/**
 * "Edit category": name, type and budget. While nothing is spent or committed on it the forecast follows the budget;
 * afterwards the forecast is left to the cost forecast. Delivery 8 (R-081, C-3a): once the project has BL1 a budget change is
 * refused (CATEGORY_FROZEN_MESSAGE), the director included; an absent budget means "unchanged" (name and type stay editable).
 */
export async function updateProjectCostCategory(projectCode: string, categoryCode: string, patch: Partial<CostCategoryInput>, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const [c] = await tx.select().from(costCategories).where(and(eq(costCategories.projectId, p.id), eq(costCategories.code, categoryCode)));
    if (!c) throw new Error('Unknown cost category');
    const set: Partial<typeof costCategories.$inferInsert> = {};
    const changes: string[] = [];
    if (patch.name !== undefined) {
      const name = validName(patch.name);
      if (name !== c.name) {
        const others = await tx.select({ name: costCategories.name, code: costCategories.code }).from(costCategories).where(eq(costCategories.projectId, p.id));
        if (others.some((o) => o.code !== c.code && o.name.toLowerCase() === name.toLowerCase())) throw new Error(`"${name}" is already a cost category of this project`);
        set.name = name;
        changes.push(`name: ${c.name} → ${name}`);
      }
    }
    if (patch.type !== undefined) {
      const type = validType(patch.type);
      if (type !== c.costType) {
        set.costType = type;
        changes.push(`type: ${costType.label(c.costType)} → ${costType.label(type)}`);
      }
    }
    if (patch.budgetKeur !== undefined) {
      const budget = validBudget(patch.budgetKeur);
      if (budget !== c.budgetKeur && (await categoryAmountsFrozen(tx, p.id))) throw new Error(CATEGORY_FROZEN_MESSAGE);
      if (budget !== c.budgetKeur) {
        set.budgetKeur = budget;
        if (!c.actualKeur && !c.committedKeur) set.forecastKeur = budget;
        changes.push(`budget: ${c.budgetKeur} → ${budget} k€`);
      }
    }
    if (!changes.length) return;
    await tx.update(costCategories).set({ ...set, updatedAt: new Date() }).where(eq(costCategories.id, c.id));
    const who = await actorOf(tx, actorName);
    await writeAudit(tx, { ...who, objectRef: `${p.code} · ${c.code}`, change: changes.join(' · '), area: 'Budget', entityType: 'cost_category', entityId: c.id, projectId: p.id });
    await recordActivity(tx, { ...who, text: `${p.code} · cost category ${c.code} edited`, kind: 'change', projectId: p.id });
  });
}
