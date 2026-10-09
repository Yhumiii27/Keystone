// Catch-all for project-scoped registry screens not built yet (/projects/[code]/<slug>). Unknown slugs → 404.
// Since Delivery 5 every project screen has its own route: this only 404s unknown slugs (and sub-paths of built ones).
// The project layout has already validated the code.
import { notFound } from 'next/navigation';
import { ComingSoon } from '@/components/app/shell/coming-soon';
import { matchScreen } from '@/components/app/shell/nav-model';
import { SCREEN_BY_ID } from '@/config/screens';

export default async function NotBuiltProjectPage({ params }: { params: Promise<{ code: string; rest: string[] }> }) {
  const { code, rest } = await params;
  const m = matchScreen(`/projects/${encodeURIComponent(code)}/${rest.map(encodeURIComponent).join('/')}`, 'exact');
  if (!m || SCREEN_BY_ID[m.id].built) notFound();
  return <ComingSoon screen={m.id} projectCode={code} />;
}
