// Who sees and edits what on My work / Task (docs/spec/10 §6.1, §7.1; 00 §8.3 "?person= for managers";
// 00 §7.16 / 10 OQ17: My work shows the viewer, not a fixed Hélène Sauvage). Pure — used by pages, islands, actions.
import type { RoleKey } from '@/config/screens';

/**
 * Roles that may open someone else's My work with `?person=` (the person chip becomes a switcher): the roles whose
 * screens list people and link to their work — Resources rows (director, depthead, procurement), Approvals team
 * list (depthead, quality), project resources (pm). The team member and the client only ever see their own.
 * Outside their workspace (everyone but director and member) the page stays read-only.
 */
export const PERSON_PICKER_ROLES: readonly RoleKey[] = ['director', 'pm', 'depthead', 'quality', 'procurement'];

export const canPickPerson = (role: RoleKey) => PERSON_PICKER_ROLES.includes(role);

/**
 * Status, %, checklist, time log of a task: its assignee, or the portfolio director (manager view, as the
 * prototype's director could), and never outside the workspace.
 */
export const canEditTask = (viewer: { role: RoleKey; name: string }, assignee: string, outside: boolean) =>
  !outside && (viewer.role === 'director' || viewer.name === assignee);

/** Comments: anyone whose workspace includes My work (the seed has colleagues commenting on each other's tasks). */
export const canCommentTask = (outside: boolean) => !outside;

/**
 * Chapter 4 (R-8 default): attaching and removing task files follows the task's other edits — the assignee or the
 * portfolio director, inside the workspace. Change it here (the upload route, the remove Server Function and the sheet
 * read it).
 */
export const canAttachTaskFiles = canEditTask;

/**
 * Chapter 4 (R-8 default): who may download a task's files — whoever may open the task sheet (outside viewers read it),
 * except a client contact on another organisation's project (the exports' rule).
 */
export const canDownloadTaskFiles = (viewer: { role: RoleKey }, projectIsTheirs: boolean) => viewer.role !== 'client' || projectIsTheirs;
