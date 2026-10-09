import 'server-only';
// Settings lists as the modules read them (chapter 4, A-14; rules in src/domain/settings-rules.ts). A light module (db
// client + schema only) so the risks, budget, HR, lifecycle and calendar code can read the lists without importing the
// Settings writers. Labels are the stored EN source strings — render them through t().
import { and, asc, eq, sql } from 'drizzle-orm';
import { costTypeOfSettingsCategory, type ListOption } from '@/domain/settings-rules';
import { getDb } from '@/server/db/client';
import type { CostType, ReferenceListKey, StageCode } from '@/server/db/codes';
import {
  costCategories, deliverables, personSkills, projects, referenceValues, risks, skills,
} from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';

type Q = DB | Tx;

export type { ListOption };

export interface SettingsEntry extends ListOption {
  active: boolean;
  isDefault: boolean;
}

/** Every entry of a list (active or not), in Settings order. */
export async function settingsEntries(listKey: ReferenceListKey, q?: Q): Promise<SettingsEntry[]> {
  const db = q ?? (await getDb());
  return db
    .select({ code: referenceValues.code, label: referenceValues.label, active: referenceValues.active, isDefault: referenceValues.isDefault })
    .from(referenceValues)
    .where(eq(referenceValues.listKey, listKey))
    .orderBy(asc(referenceValues.position));
}

/** Active entries of a list (what forms and filters offer). */
export async function activeOptions(listKey: ReferenceListKey, q?: Q): Promise<ListOption[]> {
  return (await settingsEntries(listKey, q)).filter((e) => e.active).map(({ code, label }) => ({ code, label }));
}

/** Risk categories: `active` feeds the "New risk" form, `all` labels the risks that keep a deactivated category. */
export async function riskCategoryOptions(q?: Q): Promise<{ active: ListOption[]; all: ListOption[] }> {
  const all = await settingsEntries('riskCats', q);
  return { active: all.filter((e) => e.active).map(({ code, label }) => ({ code, label })), all: all.map(({ code, label }) => ({ code, label })) };
}

/** Cost categories offered by the budget "Add category" form, with the cost type each one maps to. */
export async function costCategoryOptions(q?: Q): Promise<(ListOption & { type: CostType })[]> {
  return (await activeOptions('costCats', q)).map((o) => ({ ...o, type: costTypeOfSettingsCategory(o.code) }));
}

/** Lifecycle stages deactivated in Settings › Project statuses (skipped by the "next stage" rule). */
export async function inactiveStageCodes(q?: Q): Promise<StageCode[]> {
  return (await settingsEntries('statuses', q)).filter((e) => !e.active).map((e) => e.code as StageCode);
}

/** Skill families removed in Settings (lower-cased names): the skills matrix hides their column (levels kept). */
export async function hiddenSkillNames(q?: Q): Promise<Set<string>> {
  const entries = await settingsEntries('skills', q);
  const active = new Set(entries.filter((e) => e.active).map((e) => e.label.toLowerCase()));
  return new Set(entries.filter((e) => !e.active && !active.has(e.label.toLowerCase())).map((e) => e.label.toLowerCase()));
}

/** Company public holidays of Settings (ISO date + name: "14 Jul · Fête nationale" → 2026-07-14, "Fête nationale"). */
export async function settingsHolidayRows(q?: Q): Promise<{ date: string; name: string }[]> {
  return (await activeOptions('holidays', q))
    .filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.code))
    .map((o) => ({ date: o.code, name: o.label.includes(' · ') ? o.label.slice(o.label.indexOf(' · ') + 3) : o.label }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Makes sure a value is offered by a list (case-insensitive label): reactivates a deactivated entry or appends a custom
 * one. Used when another screen creates the value (HR "Add skill" → Settings › Skills & levels). Returns its code.
 */
export async function ensureSettingsEntry(q: Q, listKey: ReferenceListKey, label: string, code: string): Promise<string> {
  const rows = await q.select().from(referenceValues).where(eq(referenceValues.listKey, listKey));
  const same = rows.find((r) => r.label.toLowerCase() === label.toLowerCase());
  if (same) {
    if (!same.active) await q.update(referenceValues).set({ active: true, updatedAt: new Date() }).where(eq(referenceValues.id, same.id));
    return same.code;
  }
  let c = code;
  for (let i = 2; rows.some((r) => r.code === c); i++) c = `${code}_${i}`;
  const position = rows.reduce((m, r) => Math.max(m, r.position + 1), 0);
  await q.insert(referenceValues).values({ listKey, code: c, label, position, active: true, isDefault: false });
  return c;
}

const count = (n: unknown) => Number(n ?? 0);

/**
 * Records that use a list value (A-14 "in use"): risks of the category, projects at the stage, deliverables of the type,
 * project cost categories of that name, people rated ≥ 1 on the skill. Holidays and location types: never in use.
 */
export async function referenceUsage(q: Q, listKey: ReferenceListKey, code: string, label: string): Promise<number> {
  switch (listKey) {
    case 'riskCats': {
      const [r] = await q.select({ n: sql<number>`count(*)::int` }).from(risks).where(eq(risks.category, code));
      return count(r?.n);
    }
    case 'statuses': {
      const [r] = await q.select({ n: sql<number>`count(*)::int` }).from(projects).where(eq(projects.stage, code as StageCode));
      return count(r?.n);
    }
    case 'delivTypes': {
      const [r] = await q.select({ n: sql<number>`count(*)::int` }).from(deliverables).where(eq(deliverables.type, code));
      return count(r?.n);
    }
    case 'costCats': {
      const [r] = await q.select({ n: sql<number>`count(*)::int` }).from(costCategories).where(sql`lower(${costCategories.name}) = ${label.toLowerCase()}`);
      return count(r?.n);
    }
    case 'skills': {
      const [r] = await q
        .select({ n: sql<number>`count(*)::int` })
        .from(personSkills)
        .innerJoin(skills, eq(skills.id, personSkills.skillId))
        .where(and(sql`lower(${skills.name}) = ${label.toLowerCase()}`, sql`${personSkills.level} > 0`));
      return count(r?.n);
    }
    default:
      return 0;
  }
}
