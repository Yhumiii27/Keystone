import 'server-only';
// Project context and access rules for screens (docs/spec/01 §3.3 gating, §5.2 project read-only).
// Screens call `getProjectContext(code)` (project-scoped) or `getScreenAccess(screen)` (global) and hide
// their edit controls when `canEdit(screen)` is false. The shell (PageHeader) uses the same rules for
// the outside banner, the "Read-only" tag and the primary action.
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { CLIENT_ORG } from '@/config/personas';
import type { ScreenId } from '@/config/screens';
import { PROJECT_EDITABLE, isOutside } from '@/components/app/shell/nav-model';
import { getProject, listProjects, type ProjectRow } from '@/server/dal/projects';
import { getViewer, type Viewer } from '@/server/session';

/** `isMineP` (line 4164): director → all; client → client org; others → project manager = "R. Aubert" form of the name. */
export function isMineProject(viewer: Viewer, p: Pick<ProjectRow, 'pm' | 'client'>): boolean {
  if (viewer.role === 'director') return true;
  if (viewer.role === 'client') return p.client === CLIENT_ORG;
  return p.pm === viewer.short;
}

export interface ProjectScope {
  /** Switcher pool: projects with data (6). */
  pool: ProjectRow[];
  mineCount: number;
  /** "My projects | Whole portfolio" control available (`scopeAvail`): role ≠ director and 0 < mine < pool. In practice pm and client. */
  scopeAvail: boolean;
  isMine: (p: ProjectRow) => boolean;
  /** Project read-only for this viewer (`projReadOnly`): scope available and not theirs. */
  readOnly: (p: ProjectRow) => boolean;
}

export const getProjectScope = cache(async (): Promise<ProjectScope> => {
  const viewer = await getViewer();
  const pool = (await listProjects()).filter((p) => p.hasData);
  const isMine = (p: ProjectRow) => isMineProject(viewer, p);
  const mineCount = pool.filter(isMine).length;
  const scopeAvail = viewer.role !== 'director' && mineCount > 0 && mineCount < pool.length;
  return { pool, mineCount, scopeAvail, isMine, readOnly: (p) => scopeAvail && !isMine(p) };
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
  /** The viewer owns the project (`isMineP`). */
  isMine: boolean;
  /** Project read-only mode (pm/client on a project that is not theirs, §5.2) → "Read-only" tag, no edits. */
  readOnly: boolean;
  /** `outside` for the screen given to getProjectContext (false when none was given). */
  outside: boolean;
  /** Screen outside the viewer's workspace. */
  isOutside: (screen: ScreenId) => boolean;
  /** Edits allowed on `screen` for this project: not outside and not read-only (client/docs ignore read-only, line 5176). */
  canEdit: (screen?: ScreenId) => boolean;
}

/**
 * Loads a project and the viewer's access to it. Unknown code → notFound().
 * Projects without data are returned normally (`project.hasData === false`): screens render their empty state.
 */
export const getProjectContext = cache(async (code: string, screen?: ScreenId): Promise<ProjectContext> => {
  const project = await getProject(code);
  if (!project) notFound();
  const [viewer, scope] = await Promise.all([getViewer(), getProjectScope()]);
  const readOnly = scope.readOnly(project);
  const out = (s: ScreenId) => isOutside(viewer.role, s);
  const canEdit = (s: ScreenId | undefined = screen) => {
    if (!s) return !readOnly;
    return !out(s) && !(readOnly && PROJECT_EDITABLE.includes(s));
  };
  return { project, viewer, isMine: scope.isMine(project), readOnly, outside: screen ? out(screen) : false, isOutside: out, canEdit };
});
