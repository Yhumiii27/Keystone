// R-185 part 2 (multi-equipment projects, framing docs/delivery-9/cadrage-r185-r186.md § 3 step 3): which equipment line of a
// project a record belongs to — an ITP plan (one per line, choice 4), a punch item, a commissioning system, a BOM line, a
// machine of the installed base. Null = common to the project. Pure rules: choice of a line in a form, URL filters, grouping of
// a screen by line, and the rule for removing a line. The screens show the line only when the project has more than one.

/** Value of the "Common to the project" option of an Equipment select, and of the `?equipment=common` filter. */
export const COMMON_EQUIPMENT = 'common';

export interface ScopedLine {
  /** "EQ-02". */
  ref: string;
  /** 0 = the main line. */
  position: number;
}

/** A project shows the equipment of its records (column, filter, selector, groups) only with more than one line. */
export const showsEquipment = (lines: readonly unknown[]) => lines.length > 1;

/** The main line: the lowest position (then reference); null without line. */
export function mainLineOf<L extends ScopedLine>(lines: readonly L[]): L | null {
  if (!lines.length) return null;
  return [...lines].sort((a, b) => a.position - b.position || a.ref.localeCompare(b.ref))[0];
}

/** The line a reference names, or the main line when no reference is given; null for an unknown reference (or no line). */
export function lineOfRef<L extends ScopedLine>(lines: readonly L[], ref?: string | null): L | null {
  if (ref === undefined || ref === null || ref === '') return mainLineOf(lines);
  return lines.find((l) => l.ref === ref) ?? null;
}

export type EquipmentChoice = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * The Equipment select of a form: absent, empty or "common" → common to the project (null); a reference of the project's
 * lines → that line; anything else is refused.
 */
export function equipmentChoiceOf(value: string | null | undefined, refs: readonly string[]): EquipmentChoice {
  const v = (value ?? '').trim();
  if (!v || v === COMMON_EQUIPMENT) return { ok: true, value: null };
  return refs.includes(v) ? { ok: true, value: v } : { ok: false, error: 'Unknown equipment line' };
}

/** `?equipment=` of a list: 'all' (default, also for anything unknown), 'common', or a reference of the project's lines. */
export type EquipmentFilter = 'all' | typeof COMMON_EQUIPMENT | string;
export function equipmentFilterOf(v: string | string[] | null | undefined, refs: readonly string[]): EquipmentFilter {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === COMMON_EQUIPMENT) return COMMON_EQUIPMENT;
  return s && refs.includes(s) ? s : 'all';
}

/** The rows a filter keeps. */
export function filterByEquipment<R extends { equipmentRef: string | null }>(rows: readonly R[], f: EquipmentFilter): R[] {
  if (f === 'all') return [...rows];
  if (f === COMMON_EQUIPMENT) return rows.filter((r) => r.equipmentRef === null);
  return rows.filter((r) => r.equipmentRef === f);
}

export interface EquipmentGroup<R> {
  /** Null = common to the project. */
  ref: string | null;
  rows: R[];
}

/**
 * Rows grouped by line, in the order of the lines (main first), the common rows last; empty groups are left out. A row whose
 * line is not in `lines` (removed meanwhile) counts as common.
 */
export function groupByEquipment<R extends { equipmentRef: string | null }>(rows: readonly R[], lines: readonly ScopedLine[]): EquipmentGroup<R>[] {
  const ordered = [...lines].sort((a, b) => a.position - b.position || a.ref.localeCompare(b.ref)).map((l) => l.ref);
  const known = new Set(ordered);
  const groups: EquipmentGroup<R>[] = ordered.map((ref) => ({ ref, rows: rows.filter((r) => r.equipmentRef === ref) }));
  groups.push({ ref: null, rows: rows.filter((r) => r.equipmentRef === null || !known.has(r.equipmentRef)) });
  return groups.filter((g) => g.rows.length);
}

/** Two records may concern each other: same line, or one of them is common to the project. */
export const sameEquipment = (a: string | null | undefined, b: string | null | undefined) => !a || !b || a === b;

/**
 * Removing a line (R-185 part 2): refused while its ITP plan has inspections (the plan and its inspections would go with the
 * line); otherwise the plan without inspection goes with it and the line's punch items, commissioning systems, BOM lines and
 * machines become common to the project. The last line is refused by the caller (a project keeps one line).
 */
export function equipmentRemovalBlocker(facts: { inspections: number }): string | null {
  return facts.inspections > 0 ? 'This equipment line has inspections in its inspection plan' : null;
}
