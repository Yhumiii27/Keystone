// "New request" / "Request resource" primary action (docs/spec/01 §5.9, §12; 08 §5.5) used by Resource requests,
// Resources and Project resources: `<PageHeader … primary={<NewRequestButton label="New request" />} />`.
// Server Component: picks the project (the given one, else the last project used when the viewer may request on it,
// else their first own project with data), loads the dialog's reference data and renders the client launcher.
// Renders nothing for roles that may not send requests, on a project that is read-only for the viewer, or on a
// project without planning data. The header already hides it outside the viewer's workspace.
import { canSee } from '@/config/screens';
import { getProject, type ProjectRow } from '@/server/dal/projects';
import { getNewRequestSetup } from '@/server/dal/requests-screens';
import { getProjectScope } from '@/server/project-context';
import { getLastProject, getViewer } from '@/server/session';
import { NewRequestLauncher } from './new-request-launcher';
import { canSendRequests } from './permissions';

export interface NewRequestButtonProps {
  /** EN label (translated inside). Default "Request resource"; Resource requests passes "New request". */
  label?: string;
  /** Project of the request (project-scoped screens). Default: the last project used. */
  projectCode?: string;
  /** Preselected activity code / person full name. */
  defaults?: Partial<{ act: string; person: string }>;
}

export async function NewRequestButton({ label = 'Request resource', projectCode, defaults }: NewRequestButtonProps) {
  const viewer = await getViewer();
  if (!canSendRequests(viewer.role)) return null;
  const scope = await getProjectScope();
  const usable = (p: ProjectRow | null): p is ProjectRow => !!p && p.hasData && !scope.readOnly(p);
  let project: ProjectRow | null;
  if (projectCode) {
    project = await getProject(projectCode);
    if (!usable(project)) return null;
  } else {
    const last = await getProject(await getLastProject());
    project = usable(last) ? last : (scope.pool.find((p) => scope.isMine(p) && usable(p)) ?? scope.pool.find(usable) ?? null);
  }
  if (!project) return null;
  const setup = await getNewRequestSetup(project);
  if (!setup) return null;
  // Keyed by project: the draft (kept between openings, as `nr`) never carries another project's activity.
  return <NewRequestLauncher key={setup.project.code} label={label} setup={setup} defaults={defaults} sender={viewer.short} openRequests={canSee(viewer.role, 'requests')} />;
}
