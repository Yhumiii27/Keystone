// Project scope (docs/spec/00 §8.3): validates the project code (404 if unknown) and remembers it as the
// last project. Projects without data render normally; each screen shows its own empty state.
// Screens get the project and access rules from getProjectContext(code) (src/server/project-context.ts).
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { RememberProject } from '@/components/app/shell/remember-project';
import { getProject } from '@/server/dal/projects';

export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ code: string }> }) {
  const { code } = await params;
  const project = await getProject(code);
  if (!project) notFound();
  return (
    <>
      <RememberProject code={project.code} />
      {children}
    </>
  );
}
