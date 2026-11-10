// Who may import what (chapter 4 defaults, Activity & integrations › Imports). Pure — the integrations page uses it to make the
// drop zones active, the Server Functions and the upload route re-check it on every step.
//
// - Schedules (MS Project XML, GanttProject, P6 XER): the portfolio director (any project, or a new one); on an existing project
//   its leads — PM of record, co-PM, deputy (`projectAccess` lead), whatever their role (D9-08); a new project: the director and
//   the project managers (they will manage it).
// - Budget lines: director and PM (own projects).
// - Project BOM and parts catalogue: director, engineering lead, procurement.
// - Resource assignments: director, PM (own projects), head of department.
// R-041 (P-2): on an existing project every role but the director imports only into a project whose named team they are on, and
// the schedule and budget imports need the project's PM rights (PM of record, co-PM, deputy). A head of department staffs
// every project from their department, so their resource assignments are not limited to their teams.
// Questionnaire: these lists may change here only.
import type { RoleKey } from '@/config/screens';
import { ENABLED_IMPORT_KINDS } from '@/domain/ch4-defaults';
import type { ImportKind } from '@/server/db/codes';

export const IMPORT_ROLES: Readonly<Record<ImportKind, readonly RoleKey[]>> = {
  mspdi: ['director', 'pm'],
  xer: ['director', 'pm'],
  gan: ['director', 'pm'],
  budget_lines: ['director', 'pm'],
  bom: ['director', 'englead', 'procurement'],
  parts: ['director', 'englead', 'procurement'],
  assignments: ['director', 'pm', 'depthead'],
};

/** Kinds that need the project's PM rights on an existing project (R-041); the others need its team. */
export const LEAD_KINDS: readonly ImportKind[] = ['mspdi', 'xer', 'gan', 'budget_lines'];

/** Schedule kinds (D9-08: on an existing project, any internal role with the project's lead rights imports). */
const SCHEDULE_IMPORT_KINDS: readonly ImportKind[] = ['mspdi', 'xer', 'gan'];

/** The viewer's relation to the target project (src/domain/rights.ts `projectAccess`). */
export interface ImportProjectRel {
  member: boolean;
  lead: boolean;
}

/**
 * Import kinds a role may run (on at least one project), among the formats enabled (D9-08, ENABLED_IMPORT_KINDS). A deputy or
 * co-PM of another role imports the schedules of the projects they lead: the schedule kinds are offered to every internal role.
 */
export const importKindsOf = (role: RoleKey): ImportKind[] =>
  (Object.keys(IMPORT_ROLES) as ImportKind[])
    .filter((k) => ENABLED_IMPORT_KINDS.includes(k))
    .filter((k) => IMPORT_ROLES[k].includes(role) || SCHEDULE_IMPORT_KINDS.includes(k));

/** Kinds of the "Excel / CSV" card. */
export const TABLE_IMPORT_KINDS: readonly ImportKind[] = ['budget_lines', 'bom', 'parts', 'assignments'];

/** May `role` import `kind` into a project (`rel` = the viewer's rights on it; null = no project: parts catalogue or a new project)? */
export function canImport(role: RoleKey, kind: ImportKind, rel: ImportProjectRel | null): boolean {
  // D9-08: a schedule into an existing project — its leads (PM of record, co-PM, deputy) and the director, whatever the role.
  if (SCHEDULE_IMPORT_KINDS.includes(kind) && rel !== null) return rel.lead;
  if (!IMPORT_ROLES[kind].includes(role)) return false;
  if (rel === null) return true;
  if (kind === 'assignments' && role === 'depthead') return true;
  return LEAD_KINDS.includes(kind) ? rel.lead : rel.member;
}

/** Import cards of Activity & integrations (IMPORTS names) → the kinds they cover. */
export const CARD_KINDS: Readonly<Record<string, readonly ImportKind[]>> = {
  'MS Project XML': ['mspdi'],
  GanttProject: ['gan'],
  'Excel / CSV': TABLE_IMPORT_KINDS,
  'Primavera P6 XER': ['xer'],
};
