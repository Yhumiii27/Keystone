// R-204 — activity codes: a dictionary per project to filter and group the activities of the Plan and the Gantt. Pure.
//
// Types:
// - derived (never stored, read-only values): 'equipment' — the activity's equipment line (R-185, activities.equipment_id);
//   'purchase_package' — the purchase orders that need the activity (purchase_orders.needed_for_activity_id) or whose supplier
//   schedule is tied to it (R-204): an activity can be in several packages;
// - stored: 'site' (one per project) and 'custom' types the project's leads add with their values; one value per type and
//   activity.
// URL state: `?code=<type key>~<value key>` filters (value "-" = activities without a value of that type), `?group=<type key>`
// groups (Plan: read-only grouped view; Gantt: rows grouped by value).
export type CodeTypeKind = 'equipment' | 'purchase_package' | 'site' | 'custom';
export const DERIVED_CODE_TYPES = ['equipment', 'purchase_package'] as const;
export type DerivedCodeType = (typeof DERIVED_CODE_TYPES)[number];
export const isDerivedCodeType = (v: unknown): v is DerivedCodeType => typeof v === 'string' && (DERIVED_CODE_TYPES as readonly string[]).includes(v);

/** English source names of the derived types and of the "no value" group (translated by the screens). */
export const DERIVED_CODE_TYPE_NAMES: Record<DerivedCodeType, string> = { equipment: 'Equipment', purchase_package: 'Purchasing package' };
export const NO_CODE_VALUE = '-';
export const NO_CODE_VALUE_LABEL = 'No value';

export interface CodeValue {
  /** Value key: the stored value's id, the equipment line's id, the purchase order number. */
  key: string;
  /** Short code shown in group headers and exports ("Z1", "EQ-02", "PO-1082"). */
  code: string;
  /** Description ("Hall A", "3 × MEMU", "Steel plates · Acme"). */
  label: string;
}

export interface CodeType {
  /** Derived kind ('equipment', 'purchase_package') or the stored type's id. */
  key: string;
  kind: CodeTypeKind;
  /** Stored types: as typed; derived types: the English source name (`DERIVED_CODE_TYPE_NAMES`). */
  name: string;
  derived: boolean;
  values: CodeValue[];
}

/** Activity code → type key → value keys (derived types may hold several; stored types one). */
export type ActivityCodeMap = Record<string, Record<string, string[]>>;

export interface CodeFilter {
  type: string;
  /** Value key, or NO_CODE_VALUE. */
  value: string;
}

/** `?code=` → filter, when the type and the value exist. */
export function parseCodeFilter(param: string | null | undefined, types: readonly CodeType[]): CodeFilter | null {
  if (!param) return null;
  const i = param.indexOf('~');
  if (i <= 0) return null;
  const type = param.slice(0, i);
  const value = param.slice(i + 1);
  const t = types.find((x) => x.key === type);
  if (!t || !(value === NO_CODE_VALUE || t.values.some((v) => v.key === value))) return null;
  return { type, value };
}

export const codeFilterParam = (f: CodeFilter) => `${f.type}~${f.value}`;

/** `?group=` → the type, when it exists. */
export const parseCodeGroup = (param: string | null | undefined, types: readonly CodeType[]): CodeType | null => (param ? (types.find((t) => t.key === param) ?? null) : null);

export const valuesOf = (map: ActivityCodeMap, activity: string, type: string): string[] => map[activity]?.[type] ?? [];

export function matchesCodeFilter(map: ActivityCodeMap, activity: string, f: CodeFilter | null): boolean {
  if (!f) return true;
  const vs = valuesOf(map, activity, f.type);
  return f.value === NO_CODE_VALUE ? vs.length === 0 : vs.includes(f.value);
}

/** Group of an activity: its first value in the type's order, else NO_CODE_VALUE. */
export function groupKeyOf(map: ActivityCodeMap, activity: string, type: CodeType): string {
  const vs = new Set(valuesOf(map, activity, type.key));
  return type.values.find((v) => vs.has(v.key))?.key ?? NO_CODE_VALUE;
}

export interface CodeGroup {
  /** Value key, or NO_CODE_VALUE. */
  key: string;
  /** Header code ("Z1"; "—" for the no-value group). */
  code: string;
  /** Header label (the value's label; NO_CODE_VALUE_LABEL for the no-value group, to translate). */
  label: string;
  none: boolean;
}

/**
 * Activities grouped by a code type: the groups in the type's value order (empty groups left out), then the activities without a
 * value; each activity once (first value). Keeps the activities' order inside a group.
 */
export function groupByCode<A extends { id: string }>(acts: readonly A[], map: ActivityCodeMap, type: CodeType): { group: CodeGroup; activities: A[] }[] {
  const buckets = new Map<string, A[]>();
  for (const a of acts) {
    const k = groupKeyOf(map, a.id, type);
    buckets.set(k, [...(buckets.get(k) ?? []), a]);
  }
  const out: { group: CodeGroup; activities: A[] }[] = [];
  for (const v of type.values) {
    const list = buckets.get(v.key);
    if (list?.length) out.push({ group: { key: v.key, code: v.code, label: v.label, none: false }, activities: list });
  }
  const none = buckets.get(NO_CODE_VALUE);
  if (none?.length) out.push({ group: { key: NO_CODE_VALUE, code: '—', label: NO_CODE_VALUE_LABEL, none: true }, activities: none });
  return out;
}

/** Export cell of an activity for a type: its value codes, comma separated ('' when none). */
export function codeCell(map: ActivityCodeMap, activity: string, type: CodeType): string {
  const vs = new Set(valuesOf(map, activity, type.key));
  return type.values.filter((v) => vs.has(v.key)).map((v) => v.code).join(', ');
}

// ── Validation of the dictionary ────────────────────────────────────────────────────────────────────────────────

export const CODE_TYPE_NAME_MAX = 40;
export const CODE_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;
export const CODE_LABEL_MAX = 80;

export const ACTIVITY_CODE_ERRORS = {
  typeName: 'Name: 1 to 40 characters',
  typeKind: 'Unknown code type',
  typeTaken: 'A code type with this name already exists',
  siteTaken: 'The project already has a site code type',
  valueCode: 'Code: 1 to 20 letters, digits, ., - or _',
  valueLabel: 'Description: up to 80 characters',
  valueTaken: 'This code already exists in this type',
  unknownType: 'Unknown code type',
  unknownValue: 'Unknown code value',
  derived: 'This code type is derived from the project’s links',
} as const;
export type ActivityCodeError = keyof typeof ACTIVITY_CODE_ERRORS;

type R<T> = { ok: true; value: T } | { ok: false; error: ActivityCodeError };
const str = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

export function parseCodeType(v: { name?: unknown; kind?: unknown }, existing: readonly { name: string; kind: string }[]): R<{ name: string; kind: 'site' | 'custom' }> {
  const kind = v.kind ?? 'custom';
  if (kind !== 'site' && kind !== 'custom') return { ok: false, error: 'typeKind' };
  const name = str(v.name);
  if (!name || name.length > CODE_TYPE_NAME_MAX) return { ok: false, error: 'typeName' };
  if (kind === 'site' && existing.some((t) => t.kind === 'site')) return { ok: false, error: 'siteTaken' };
  if (existing.some((t) => t.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'typeTaken' };
  return { ok: true, value: { name, kind } };
}

export function parseCodeValue(v: { code?: unknown; label?: unknown }, existing: readonly { code: string }[]): R<{ code: string; label: string }> {
  const code = str(v.code);
  if (!CODE_VALUE_RE.test(code)) return { ok: false, error: 'valueCode' };
  const label = str(v.label) || code;
  if (label.length > CODE_LABEL_MAX) return { ok: false, error: 'valueLabel' };
  if (existing.some((x) => x.code.toLowerCase() === code.toLowerCase())) return { ok: false, error: 'valueTaken' };
  return { ok: true, value: { code, label } };
}
