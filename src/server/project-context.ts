import 'server-only';
// Project context and access rules for screens (docs/spec/01 §3.3 gating, §5.2 project read-only; delivery 7 lot "rights").
// Screens call `getProjectContext(code)` (project-scoped) or `getScreenAccess(screen)` (global) and hide their edit controls
// when `canEdit(screen)` is false. The shell (PageHeader) uses the same rules for the outside banner, the "Read-only" tag and
// the primary action.
// - R-041 (P-2): write rights on a project follow its named team (src/domain/rights.ts `projectAccess`): the PM of record,
//   co-PMs, deputies, referents and team members edit the screens of their workspace; everybody else reads. The PM rights
//   (L-4b, P-9a, P-9b) follow `isLead` (PMs and deputies, and the director).
// - R-044 (P-4): the Contract is edited by the director, Finance (every project) and the project's leads whose workspace has
//   it (`canEditContract`); Finance reads Budget, Hours and Billing even on its teams (`financeReadOnly`).
// - R-158: the Shipments are edited by the director, Logistics (every project) and the project's leads (`canEditShipments`);
//   Logistics reads the BOM, Site, Schedule and Deliveries (`roleReadOnly`).
// - Every role reads a screen outside its workspace (banner, read-only). The client's refusals (R-042) went with the Client
//   role (D9-06: clients never see Keystone).
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { ScreenId } from '@/config/screens';
import { PROJECT_EDITABLE, isOutside } from '@/components/app/shell/nav-model';
import {
  canEditContract, canEditShipments, projectAccess, roleReadOnly, type ProjectAccess, type TeamMember,
} from '@/domain/rights';
import { listProjectTeams } from '@/server/dal/project-team';
import { getProject, listProjects, type ProjectRow } from '@/server/dal/projects';
import { getViewer, type Viewer } from '@/server/session';

/** The viewer's rights on a project, given every project's team (`listProjectTeams`). */
export function accessOf(viewer: Viewer, p: Pick<ProjectRow, 'code' | 'pm' | 'pmPersonId'>, teams: Map<string, TeamMember[]>): ProjectAccess {
  return projectAccess(viewer, { pm: p.pm, pmPersonId: p.pmPersonId, team: teams.get(p.code) ?? [] });
}

/** Rights resolver for an explicit viewer (exports, imports, tests): one read of the teams, then a pure function per project. */
export async function projectAccessResolver(viewer: Viewer): Promise<(p: Pick<ProjectRow, 'code' | 'pm' | 'pmPersonId'>) => ProjectAccess> {
  const teams = await listProjectTeams();
  return (p) => accessOf(viewer, p, teams);
}

/**
 * The project is "mine" (`isMineP`, R-041): the director → all; anybody else → they are on its named team. `teams` = `listProjectTeams()`.
 */
export function isMineProject(viewer: Viewer, p: Pick<ProjectRow, 'code' | 'pm' | 'pmPersonId'>, teams: Map<string, TeamMember[]>): boolean {
  return accessOf(viewer, p, teams).member;
}

export interface ProjectScope {
  /** Switcher pool: projects with data. */
  pool: ProjectRow[];
  /** Projects of the pool the viewer is on the team of. */
  mineCount: number;
  /** "My projects | Whole portfolio" control available (`scopeAvail`): internal role ≠ director and 0 < mine < pool. */
  scopeAvail: boolean;
  /** On the project's team (director: all). */
  isMine: (p: ProjectRow) => boolean;
  /** PM rights on the project (PM of record, co-PM, deputy, director). */
  isLead: (p: ProjectRow) => boolean;
  /** Project read-only for this viewer (`projReadOnly`, R-041: not on its team). */
  readOnly: (p: ProjectRow) => boolean;
  /** Full rights on a project. */
  access: (p: ProjectRow) => ProjectAccess;
}

export const getProjectScope = cache(async (): Promise<ProjectScope> => {
  const [viewer, all, teams] = await Promise.all([getViewer(), listProjects(), listProjectTeams()]);
  const access = (p: ProjectRow) => accessOf(viewer, p, teams);
  const pool = all.filter((p) => p.hasData);
  const isMine = (p: ProjectRow) => access(p).member;
  const mineCount = pool.filter(isMine).length;
  const scopeAvail = viewer.role !== 'director' && mineCount > 0 && mineCount < pool.length;
  return { pool, mineCount, scopeAvail, isMine, isLead: (p) => access(p).lead, readOnly: (p) => access(p).readOnly, access };
});

export interface ScreenAccess {
  viewer: Viewer;
  /** Screen outside the viewer's workspace (role gating) → banner, read-only, no primary action. */
  outside: boolean;
  /** Edit controls allowed on this screen. */
  canEdit: boolean;
}

/** Access to a global (non-project) screen. */
export async function getScreenAccess(screen: ScreenId): Promise<ScreenAccess> {
  const viewer = await getViewer();
  const outside = isOutside(viewer.role, screen);
  return { viewer, outside, canEdit: !outside };
}

export interface ProjectContext {
  project: ProjectRow;
  viewer: Viewer;
  /** The viewer is on the project's named team (`isMineP`, R-041; director: all). */
  isMine: boolean;
  /** PM rights: PM of record, co-PM, deputy, or the director (L-4b, P-9a). */
  isLead: boolean;
  /** Full rights on the project (team role…). */
  access: ProjectAccess;
  /** The project's named team (PM of record first). */
  team: TeamMember[];
  /** Project read-only mode (not on the team, §5.2 / P-2) → "Read-only" tag, no edits. */
  readOnly: boolean;
  /** `outside` for the screen given to getProjectContext (false when none was given). */
  outside: boolean;
  /** Screen outside the viewer's workspace. */
  isOutside: (screen: ScreenId) => boolean;
  /**
   * Edits allowed on `screen` for this project: not outside and not read-only (docs ignore read-only, line 5176); the
   * Contract follows `canEditContract` (P-4) and Finance reads Budget, Hours and Billing (R-044).
   */
  canEdit: (screen?: ScreenId) => boolean;
}

/**
 * Loads a project and the viewer's access to it. Unknown code → notFound(). Projects without data are returned normally
 * (`project.hasData === false`): screens render their empty state.
 */
export const getProjectContext = cache(async (code: string, screen?: ScreenId): Promise<ProjectContext> => {
  const project = await getProject(code);
  if (!project) notFound();
  const [viewer, teams] = await Promise.all([getViewer(), listProjectTeams()]);
  const access = accessOf(viewer, project, teams);
  const readOnly = access.readOnly;
  const out = (s: ScreenId) => isOutside(viewer.role, s);
  const canEdit = (s: ScreenId | undefined = screen) => {
    if (!s) return !readOnly;
    if (s === 'contract') return canEditContract(viewer.role, access);
    // R-158: the shipments follow `canEditShipments` (Logistics and the director on every project, the project's leads).
    if (s === 'shipments') return canEditShipments(viewer.role, access);
    if (roleReadOnly(viewer.role, s)) return false;
    return !out(s) && !(readOnly && PROJECT_EDITABLE.includes(s));
  };
  return {
    project, viewer, isMine: access.member, isLead: access.lead, access, team: teams.get(project.code) ?? [], readOnly,
    outside: screen ? out(screen) : false, isOutside: out, canEdit,
  };
});
