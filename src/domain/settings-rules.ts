// Settings-driven modules (chapter 4, A-14) — the rules the product owner confirms in the chapter-5 questionnaire, kept
// in one place so an answer changes one constant. Pure module (Server Components, client islands, DAL, tests).
//
//   Who edits      the portfolio director only (the other workspace roles read the lists); every change is audited.
//   Remove         a value still used by records (or a SETTINGS0 default, restored by "Reset to defaults") is
//                  DEACTIVATED — it disappears from the forms and filters, records keep it; an unused custom value is DELETED.
//   Duplicates     refused (case-insensitive); thresholds: numbers in ]0, 2], "Off track below" < "At risk below".
//   Modules        risk categories → risk register form + chips; cost categories → project budget "Add category" and the
//                  wizard; project statuses → the lifecycle stages a project can move to (an inactive stage is skipped);
//                  skills → the skills matrix columns; public holidays → work calendars (CPM) and the leave calendar;
//                  deliverable types → the deliverable register labels (no form creates deliverables yet).
import type { CostType, ReferenceListKey, StageCode } from '@/server/db/codes';

// ── Who may edit ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Roles that edit Settings (lists, thresholds, Reset). Other roles of the Settings workspace see them read-only. */
export const SETTINGS_EDIT_ROLES: readonly string[] = ['director'];
export const canEditSettings = (role: string) => SETTINGS_EDIT_ROLES.includes(role);
/** Refusal shown to a workspace role that may not edit (EN source; FR in src/i18n/extra/ch4-settings.json). */
export const SETTINGS_DIRECTOR_ONLY = 'Settings are edited by the portfolio director';

// ── Removal ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export type RemovalMode = 'deleted' | 'deactivated';

/** A value in use or a default of SETTINGS0 is deactivated; an unused custom value is deleted. */
export const removalModeOf = (v: { inUse: number; isDefault: boolean }): RemovalMode => (v.inUse > 0 || v.isDefault ? 'deactivated' : 'deleted');

/** What "in use" means per list (documentation of the DAL's usage counts). */
export const USAGE_OF: Readonly<Partial<Record<ReferenceListKey, string>>> = {
  riskCats: 'risks of that category',
  costCats: 'project cost categories of that name',
  statuses: 'projects at that stage',
  delivTypes: 'deliverables of that type',
  skills: 'people rated on that skill (level ≥ 1)',
};

// ── Project statuses (lifecycle stages) ───────────────────────────────────────────────────────────────────────────────
/** Stages that cannot be deactivated: creation (the wizard creates at Initiative), closure and cancellation. */
export const REQUIRED_STAGES: readonly StageCode[] = ['initiative', 'clos', 'annule'];
/** A custom status is refused: a lifecycle stage needs its deliverables and gate, defined with the lifecycle. */
export const CUSTOM_STATUSES_ALLOWED = false;
export const CUSTOM_STATUS_REFUSED = 'Project statuses are the lifecycle stages — a new stage needs a lifecycle definition';
export const REQUIRED_STAGE_REFUSED = 'This stage is required by the lifecycle';

// ── Cost categories ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Cost type of the SETTINGS0 cost categories (Settings codes); a custom category defaults to Labor (editable). */
export const SETTINGS_COST_TYPE: Readonly<Record<string, CostType>> = {
  labor: 'labor', materials: 'material', equipment: 'equipment', subcontractors: 'subcontract', permits_fees: 'fees', contingency: 'reserve',
};
export const DEFAULT_CUSTOM_COST_TYPE: CostType = 'labor';
export const costTypeOfSettingsCategory = (code: string): CostType => SETTINGS_COST_TYPE[code] ?? DEFAULT_CUSTOM_COST_TYPE;

// ── Option lists ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ListOption {
  code: string;
  label: string;
}

/**
 * Options of a form fed by a Settings list: the form's own order for the values it knew (the prototype's defaults first),
 * then the Settings additions in Settings order; inactive values are not offered.
 */
export function orderedOptions(active: readonly ListOption[], preferred: readonly string[]): ListOption[] {
  const byCode = new Map(active.map((o) => [o.code, o]));
  const first = preferred.map((c) => byCode.get(c)).filter((o): o is ListOption => !!o);
  return [...first, ...active.filter((o) => !preferred.includes(o.code))];
}

/** Label of a code from a Settings list (active or not), else the fallback (a known code's label), else the code. */
export function labelFrom(list: readonly ListOption[], code: string, fallback?: (code: string) => string | null): string {
  return list.find((o) => o.code === code)?.label ?? fallback?.(code) ?? code;
}

// ── Lifecycle with Settings statuses ──────────────────────────────────────────────────────────────────────────────────
/**
 * Next stage of `order` after `from`, skipping the stages deactivated in Settings (`inactive`); null at the end.
 * Required stages are never skipped.
 */
export function nextActiveStage(order: readonly StageCode[], from: StageCode, inactive: ReadonlySet<string>): StageCode | null {
  const i = order.indexOf(from);
  if (i < 0) return null;
  for (let j = i + 1; j < order.length; j++) if (!inactive.has(order[j]) || REQUIRED_STAGES.includes(order[j])) return order[j];
  return null;
}
