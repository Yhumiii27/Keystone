// Catch-all for project-scoped registry screens not built yet (/projects/[code]/<slug>). Unknown slugs → 404.
// The project layout has already validated the code.
import { notFound } from 'next/navigation';
import { ComingSoon } from '@/components/app/shell/coming-soon';
import { matchScreen } from '@/components/app/shell/nav-model';

export default async function NotBuiltProjectPage({ params }: { params: Promise<{ code: string; rest: string[] }> }) {
  const { code, rest } = await params;
  const m = matchScreen(`/projects/${encodeURIComponent(code)}/${rest.map(encodeURIComponent).join('/')}`, 'exact');
  if (!m) notFound();
  return <ComingSoon screen={m.id} projectCode={code} />;
}
