// HR action forms (prototype AF catalogue `rates`, `skills`, `hours`, design line 3674–3700; docs/spec/06
// §2.4e, §3.4e, §5.4f; the `leave` form "Sync Lucca" is retired, NEW-CURSUS-7) and the validation of what they submit. Pure module shared by the client buttons
// (FormDialog, `translate`) and the Server Functions. Labels are the prototype's English source strings; select
// values are stable codes.
import type { FormDef, FormValues } from '@/components/app/form-def';
import { parseDateInput } from '@/domain/contract';
import { parseEffectiveDate } from '@/domain/hr';

type Opt<C extends string> = { value: C; label: string };

// ── Add role (AF.rates) ────────────────────────────────────────────────────────────────────────────────

export type CostCenter = 'engineering' | 'site' | 'automation' | 'project_management';
export const COST_CENTERS: Opt<CostCenter>[] = [
  { value: 'engineering', label: 'Engineering' },
  { value: 'site', label: 'Site' },
  { value: 'automation', label: 'Automation' },
  { value: 'project_management', label: 'Project management' },
];
export type Grade = 'junior' | 'confirmed' | 'senior' | 'expert';
export const GRADES: Opt<Grade>[] = [
  { value: 'junior', label: 'Junior' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'senior', label: 'Senior' },
  { value: 'expert', label: 'Expert' },
];

export const ADD_ROLE_FORM: FormDef = {
  title: 'Add role',
  submit: 'Add role',
  kind: 'create',
  fields: [
    { id: 'role', label: 'Role', type: 'text', required: true },
    { id: 'rate', label: 'Hourly rate (€)', type: 'number', required: true },
    { id: 'cc', label: 'Cost center', type: 'select', options: COST_CENTERS },
    { id: 'grade', label: 'Grade', type: 'select', options: GRADES },
  ],
};

/**
 * R-083 (A-10, R-4a): "Add role" with the explicit date the role's first rate takes effect — the prototype's form plus an
 * "Effective from" field defaulting to the date the rate card shows (the business date unless another one is chosen).
 * `defaultDate` = that date as shown ("25 Sep 2026", translated).
 */
export function addRoleForm(defaultDate: string): FormDef {
  return {
    ...ADD_ROLE_FORM,
    fields: [...ADD_ROLE_FORM.fields, { id: 'from', label: 'Effective from', type: 'text', required: true, defaultValue: defaultDate, placeholder: 'e.g. 1 Nov 2026' }],
  };
}
/** AF_RESULT.rates */
export const ADD_ROLE_RESULT = 'Role added to the rate card';

// ── Add skill (AF.skills) ──────────────────────────────────────────────────────────────────────────────

export type SkillCategory = 'engineering' | 'site' | 'automation' | 'management' | 'safety';
export const SKILL_CATEGORIES: Opt<SkillCategory>[] = [
  { value: 'engineering', label: 'Engineering' },
  { value: 'site', label: 'Site' },
  { value: 'automation', label: 'Automation' },
  { value: 'management', label: 'Management' },
  { value: 'safety', label: 'Safety' },
];
// R-5a (R-087): one 1–5 scale for every skill — the prototype's "Levels" field (1–4, 1–3, Yes / No; never stored) is removed.
export const ADD_SKILL_FORM: FormDef = {
  title: 'Add skill',
  submit: 'Add skill',
  kind: 'create',
  fields: [
    { id: 'name', label: 'Skill', type: 'text', required: true },
    { id: 'cat', label: 'Category', type: 'select', options: SKILL_CATEGORIES },
  ],
};
/** AF_RESULT.skills */
export const ADD_SKILL_RESULT = 'Skill added';

// "Sync Lucca" (AF.leave) is gone: absences arrive from Cursus by themselves (R-031, NEW-CURSUS-7 "a"; Lucca unplugged,
// NEW-CURSUS-4).

// ── Import Lucca hours (AF.hours) ──────────────────────────────────────────────────────────────────────

export type ImportPeriod = '2026-09' | '2026-08' | '2026-q3';
export const IMPORT_PERIODS: Opt<ImportPeriod>[] = [
  { value: '2026-09', label: 'September 2026' },
  { value: '2026-08', label: 'August 2026' },
  { value: '2026-q3', label: 'Q3 2026' },
];
export type ImportMatching = 'resource_wp' | 'resource';
export const IMPORT_MATCHING: Opt<ImportMatching>[] = [
  { value: 'resource_wp', label: 'Resource × work package (planning)' },
  { value: 'resource', label: 'Resource only' },
];

/** The analytic code defaults to the project's own code (the prototype hard-codes "HAV004", 06 OQ9). */
export function importHoursForm(analyticCode: string | null): FormDef {
  return {
    title: 'Import Lucca hours',
    submit: 'Import',
    kind: 'run',
    fields: [
      { id: 'period', label: 'Period', type: 'select', options: IMPORT_PERIODS },
      { id: 'code', label: 'Analytic code', type: 'text', defaultValue: analyticCode ?? '' },
      { id: 'mode', label: 'Matching', type: 'select', options: IMPORT_MATCHING },
    ],
  };
}

/** The import period contains the month of an import (`monthIso` = first day, "2026-09-01"). */
export function periodCovers(period: ImportPeriod, monthIso: string): boolean {
  const [y, m] = [monthIso.slice(0, 4), +monthIso.slice(5, 7)];
  if (period === '2026-q3') return y === '2026' && m >= 7 && m <= 9;
  return monthIso.slice(0, 7) === period;
}

/** Toast: AF_RESULT.hours with the real counts ("Lucca hours imported · 12 lines matched · 2 to assign"). */
export const importHoursResult = (matched: number, toAssign: number) =>
  `Lucca hours imported · ${matched} line${matched === 1 ? '' : 's'} matched · ${toAssign} to assign`;

// ── Validation (untrusted input; errors are EN source strings rendered through t()) ────────────────────

export type Parse<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const rec = (values: unknown) => (values && typeof values === 'object' ? values : {}) as Record<string, unknown>;
const pick = <C extends string>(opts: Opt<C>[], raw: string): C | null => (raw ? (opts.find((o) => o.value === raw)?.value ?? null) : opts[0].value);

export const NAME_MAX = 80;
export const RATE_MAX = 10_000;
export const FACTOR_MAX = 10;

/** A €/h rate typed in a field: finite, 0 ≤ v ≤ 10 000. */
export function parseRate(v: unknown): Parse<number> {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a valid hourly rate' };
  if (n < 0 || n > RATE_MAX) return { ok: false, error: 'Hourly rate out of range' };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** A multiplier: finite, 0 ≤ v ≤ 10. */
export function parseFactor(v: unknown): Parse<number> {
  const n = typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a valid multiplier' };
  if (n < 0 || n > FACTOR_MAX) return { ok: false, error: 'Multiplier out of range' };
  return { ok: true, value: Math.round(n * 1000) / 1000 };
}

export interface AddRoleInput {
  role: string;
  rateEur: number;
  costCenter: CostCenter;
  grade: Grade;
  /** ISO date the first rate takes effect (R-083). */
  effectiveFrom: string;
}

export function parseAddRole(values: FormValues | unknown, existing: string[] = []): Parse<AddRoleInput> {
  const v = rec(values);
  const role = str(v.role).replace(/\s+/g, ' ');
  if (!role) return { ok: false, error: 'Role is required' };
  if (role.length > NAME_MAX) return { ok: false, error: 'Role name is too long' };
  if (existing.some((r) => r.toLowerCase() === role.toLowerCase())) return { ok: false, error: 'This role is already on the rate card' };
  const rate = parseRate(str(v.rate));
  if (!rate.ok) return rate;
  const costCenter = pick(COST_CENTERS, str(v.cc));
  if (!costCenter) return { ok: false, error: 'Unknown cost center' };
  const grade = pick(GRADES, str(v.grade));
  if (!grade) return { ok: false, error: 'Unknown grade' };
  // R-083: an explicit effective date ("1 Nov 2026", "1 nov. 2026", "01/11/2026" or ISO).
  const effectiveFrom = parseEffectiveDate(parseDateInput(str(v.from)));
  if (!effectiveFrom) return { ok: false, error: 'Enter a valid effective date' };
  return { ok: true, value: { role, rateEur: rate.value, costCenter, grade, effectiveFrom } };
}

export interface AddSkillInput {
  name: string;
  category: SkillCategory;
}

export function parseAddSkill(values: FormValues | unknown, existing: string[] = []): Parse<AddSkillInput> {
  const v = rec(values);
  const name = str(v.name).replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Skill is required' };
  if (name.length > NAME_MAX) return { ok: false, error: 'Skill name is too long' };
  if (existing.some((s) => s.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'This skill is already in the matrix' };
  const category = pick(SKILL_CATEGORIES, str(v.cat));
  if (!category) return { ok: false, error: 'Unknown category' };
  return { ok: true, value: { name, category } };
}

export interface ImportHoursInput {
  period: ImportPeriod;
  analyticCode: string;
  matchingMode: ImportMatching;
}

/** `projectCode` = the project's analytic code: a blank code falls back to it, another code is refused. */
export function parseImportHours(values: FormValues | unknown, projectAnalytic: string | null): Parse<ImportHoursInput> {
  const v = rec(values);
  const period = pick(IMPORT_PERIODS, str(v.period));
  if (!period) return { ok: false, error: 'Unknown period' };
  const code = (str(v.code) || projectAnalytic || '').toUpperCase();
  if (!code) return { ok: false, error: 'Analytic code is required' };
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) return { ok: false, error: 'Invalid analytic code' };
  if (projectAnalytic && code !== projectAnalytic.toUpperCase()) return { ok: false, error: 'This analytic code does not belong to the project' };
  const matchingMode = pick(IMPORT_MATCHING, str(v.mode));
  if (!matchingMode) return { ok: false, error: 'Unknown matching mode' };
  return { ok: true, value: { period, analyticCode: code, matchingMode } };
}
