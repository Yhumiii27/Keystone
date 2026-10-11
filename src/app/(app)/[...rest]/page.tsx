// Catch-all for global registry screens not built yet ("Module en cours de construction"). Unknown paths → 404.
// Since Delivery 5 every registry screen is built and has its own route, so this only answers unknown paths (404)
// and /projects/<code> (redirect to the project's Plan); the "being built" page stays for a future unbuilt screen.
import { notFound, redirect } from 'next/navigation';
import { SCREEN_BY_ID, screenHref } from '@/config/screens';
import { ComingSoon } from '@/components/app/shell/coming-soon';
import { matchScreen } from '@/components/app/shell/nav-model';
import { clientRefusedProject } from '@/domain/rights';
import { getProject } from '@/server/dal/projects';
import { refuseClient } from '@/server/project-context';
import { getViewer } from '@/server/session';

export default async function NotBuiltPage({ params }: { params: Promise<{ rest: string[] }> }) {
  const { rest } = await params;
  // /projects/<code> → the project's Plan (the prototype opens Plan when a project is picked from the map); a client → their
  // portal (the Plan is outside their workspace, R-042), never another organisation's project.
  if (rest[0] === 'projects' && rest.length === 2) {
    const [p, viewer] = await Promise.all([getProject(rest[1]), getViewer()]);
    if (p && clientRefusedProject(viewer, p)) refuseClient();
    if (p) redirect(screenHref(viewer.role === 'client' ? 'client' : 'plan', { code: p.code }));
    notFound();
  }
  const m = matchScreen('/' + rest.map(encodeURIComponent).join('/'), 'exact');
  if (!m || SCREEN_BY_ID[m.id].scope === 'project' || SCREEN_BY_ID[m.id].built) notFound();
  return <ComingSoon screen={m.id} taskId={m.taskId} />;
}
