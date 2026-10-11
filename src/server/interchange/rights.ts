// Who may import what (chapter 4 defaults, Activity & integrations › Imports). Pure — the integrations page uses it to make the
// drop zones active, the Server Functions and the upload route re-check it on every step.
//
// - Schedules (MS Project XML, P6 XER): the portfolio director (any project, or a new one) and the project manager (their own
//   projects, or a new project they will manage).
// - Budget lines: director and PM (own projects).
// - Project BOM and parts catalogue: director, engineering lead, procurement.
// - Resource assignments: director, PM (own projects), head of department.
// R-041 (P-2): on an existing project every role but the director imports only into a project whose named team they are on, and
// the schedule and budget imports need the project's PM rights (PM of record, co-PM, deputy). A head of department staffs
// every project from their department, so their resource assignments are not limited to their teams. The client never imports.
// Questionnaire: these lists may change here only.
import type { RoleKey } from '@/config/screens';
import type { ImportKind } from '@/server/db/codes';

export const IMPORT_ROLES: Readonly<Record<ImportKind, readonly RoleKey[]>> = {
  mspdi: ['director', 'pm'],
  xer: ['director', 'pm'],
  budget_lines: ['director', 'pm'],
  bom: ['director', 'englead', 'procurement'],
  parts: ['director', 'englead', 'procurement'],
  assignments: ['director', 'pm', 'depthead'],
};

/** Kinds that need the project's PM rights on an existing project (R-041); the others need its team. */
export const LEAD_KINDS: readonly ImportKind[] = ['mspdi', 'xer', 'budget_lines'];

/** The viewer's relation to the target project (src/domain/rights.ts `projectAccess`). */
export interface ImportProjectRel {
  member: boolean;
  lead: boolean;
}

/** Import kinds a role may run (on at least one project). */
export const importKindsOf = (role: RoleKey): ImportKind[] => (Object.keys(IMPORT_ROLES) as ImportKind[]).filter((k) => IMPORT_ROLES[k].includes(role));

/** Kinds of the "Excel / CSV" card. */
export const TABLE_IMPORT_KINDS: readonly ImportKind[] = ['budget_lines', 'bom', 'parts', 'assignments'];

/** May `role` import `kind` into a project (`rel` = the viewer's rights on it; null = no project: parts catalogue or a new project)? */
export function canImport(role: RoleKey, kind: ImportKind, rel: ImportProjectRel | null): boolean {
  if (!IMPORT_ROLES[kind].includes(role)) return false;
  if (rel === null) return true;
  if (kind === 'assignments' && role === 'depthead') return true;
  return LEAD_KINDS.includes(kind) ? rel.lead : rel.member;
}

/** Import cards of Activity & integrations (IMPORTS names) → the kinds they cover. */
export const CARD_KINDS: Readonly<Record<string, readonly ImportKind[]>> = {
  'MS Project XML': ['mspdi'],
  'Excel / CSV': TABLE_IMPORT_KINDS,
  'Primavera P6 XER': ['xer'],
};
