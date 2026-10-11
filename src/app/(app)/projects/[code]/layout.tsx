// Project scope (docs/spec/00 §8.3): validates the project code (404 if unknown) and remembers it as the
// last project. Projects without data render normally; each screen shows its own empty state.
// Screens get the project and access rules from getProjectContext(code) (src/server/project-context.ts).
// R-042 (P-10a): a client opening another organisation's project is sent home before any of its screens renders (each
// screen's getProjectContext refuses it too, so a client-side navigation between screens is covered).
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { RememberProject } from '@/components/app/shell/remember-project';
import { clientRefusedProject } from '@/domain/rights';
import { getProject } from '@/server/dal/projects';
import { refuseClient } from '@/server/project-context';
import { getViewer } from '@/server/session';

export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [project, viewer] = await Promise.all([getProject(code), getViewer()]);
  if (!project) notFound();
  if (clientRefusedProject(viewer, project)) refuseClient();
  return (
    <>
      <RememberProject code={project.code} />
      {children}
    </>
  );
}
