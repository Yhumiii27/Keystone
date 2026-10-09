// "New project" primary action (docs/spec/01 §10, 03 §0.2 / §5.8) used by Home, Portfolio overview and Projects:
// `<PageHeader … primary={<NewProjectButton />} />`. Server Component: loads the wizard's reference data (templates,
// cost categories, numbering inputs, client codes) and renders the client launcher. Renders nothing for roles that
// may not create projects; the header already hides it outside the viewer's workspace.
import { getNewProjectSetup } from '@/server/dal/projects-register';
import { getViewer } from '@/server/session';
import { NewProjectLauncher } from './new-project-launcher';
import { canCreateProject } from './permissions';

export async function NewProjectButton() {
  const viewer = await getViewer();
  if (!canCreateProject(viewer.role)) return null;
  const setup = await getNewProjectSetup({ name: viewer.name, role: viewer.role });
  return <NewProjectLauncher setup={setup} />;
}
