// Who may import what (chapter 4 defaults, Activity & integrations › Imports). Pure — the integrations page uses it to make the
// drop zones active, the Server Functions and the upload route re-check it on every step.
//
// - Schedules (MS Project XML, P6 XER): the portfolio director (any project, or a new one) and the project manager (their own
//   projects, or a new project they will manage).
// - Budget lines: director and PM (own projects).
// - Project BOM and parts catalogue: director, engineering lead, procurement.
// - Resource assignments: director, PM (own projects), head of department.
// The roles other than the PM work on any project; the client never imports. Questionnaire: these lists may change here only.
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

/** Roles limited to the projects they manage (`isMineProject`). */
export const OWN_PROJECTS_ONLY: readonly RoleKey[] = ['pm'];

/** Import kinds a role may run (on at least one project). */
export const importKindsOf = (role: RoleKey): ImportKind[] => (Object.keys(IMPORT_ROLES) as ImportKind[]).filter((k) => IMPORT_ROLES[k].includes(role));

/** Kinds of the "Excel / CSV" card. */
export const TABLE_IMPORT_KINDS: readonly ImportKind[] = ['budget_lines', 'bom', 'parts', 'assignments'];

/** May `role` import `kind` into a project (`own` = the viewer manages it; null = no project: parts catalogue or a new project)? */
export function canImport(role: RoleKey, kind: ImportKind, own: boolean | null): boolean {
  if (!IMPORT_ROLES[kind].includes(role)) return false;
  if (own === null) return true;
  return !OWN_PROJECTS_ONLY.includes(role) || own;
}

/** Import cards of Activity & integrations (IMPORTS names) → the kinds they cover. */
export const CARD_KINDS: Readonly<Record<string, readonly ImportKind[]>> = {
  'MS Project XML': ['mspdi'],
  'Excel / CSV': TABLE_IMPORT_KINDS,
  'Primavera P6 XER': ['xer'],
};
