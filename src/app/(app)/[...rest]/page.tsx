// Catch-all for global registry screens not built yet ("Module en cours de construction"). Unknown paths → 404.
// Since Delivery 5 every registry screen is built and has its own route, so this only answers unknown paths (404)
// and /projects/<code> (redirect to the project's Plan); the "being built" page stays for a future unbuilt screen.
import { notFound, redirect } from 'next/navigation';
import { SCREEN_BY_ID, screenHref } from '@/config/screens';
import { ComingSoon } from '@/components/app/shell/coming-soon';
import { matchScreen } from '@/components/app/shell/nav-model';
import { getProject } from '@/server/dal/projects';

export default async function NotBuiltPage({ params }: { params: Promise<{ rest: string[] }> }) {
  const { rest } = await params;
  // /projects/<code> → the project's Plan (the prototype opens Plan when a project is picked from the map).
  if (rest[0] === 'projects' && rest.length === 2) {
    const p = await getProject(rest[1]);
    if (p) redirect(screenHref('plan', { code: p.code }));
    notFound();
  }
  const m = matchScreen('/' + rest.map(encodeURIComponent).join('/'), 'exact');
  if (!m || SCREEN_BY_ID[m.id].scope === 'project' || SCREEN_BY_ID[m.id].built) notFound();
  return <ComingSoon screen={m.id} taskId={m.taskId} />;
}
