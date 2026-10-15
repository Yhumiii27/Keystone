// Who sees and edits what on My work / Task (docs/spec/10 §6.1, §7.1; 00 §8.3 "?person= for managers";
// 00 §7.16 / 10 OQ17: My work shows the viewer, not a fixed Hélène Sauvage). Pure — used by pages, islands, actions.
import type { RoleKey } from '@/config/screens';
import { clientRefusedScreen } from '@/domain/rights';

// Someone else's My work (`?person=`, R-049 / R-9 answer b): by hierarchy and projects — src/domain/rights.ts
// `canViewPersonWork`, applied by src/server/dal/mywork-data.ts `myWorkAccess` (page, task back link, export).

/**
 * Status, %, checklist, time log of a task: its assignee, or the portfolio director (manager view, as the
 * prototype's director could), and never outside the workspace.
 */
export const canEditTask = (viewer: { role: RoleKey; name: string }, assignee: string, outside: boolean) =>
  !outside && (viewer.role === 'director' || viewer.name === assignee);

/**
 * P-8b (R-089) "Name the person" on a sourcing task (created from a contract-role request, not named yet): procurement and the
 * portfolio director, inside the workspace. The writer re-checks the roles held (src/server/dal/requests.ts nameSourcedPerson).
 */
export const canNameSourcedPerson = (viewer: { role: RoleKey }, outside: boolean) => !outside && (viewer.role === 'procurement' || viewer.role === 'director');

/** Comments: anyone whose workspace includes My work (the seed has colleagues commenting on each other's tasks). */
export const canCommentTask = (outside: boolean) => !outside;

/**
 * Chapter 4 (R-8 default): attaching and removing task files follows the task's other edits — the assignee or the
 * portfolio director, inside the workspace. Change it here (the upload route, the remove Server Function and the sheet
 * read it).
 */
export const canAttachTaskFiles = canEditTask;

/**
 * Chapter 4 (R-8 default) and R-042 (P-1): who may download a task's files — whoever may open the task sheet (internal
 * viewers outside their workspace read it); never a client, the task sheet being outside the client's workspace.
 */
export const canDownloadTaskFiles = (viewer: { role: RoleKey }) => !clientRefusedScreen(viewer.role, 'task');
