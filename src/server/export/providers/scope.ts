import 'server-only';
// Row visibility of the exports (chapter 4): a client exports only the rows of their organisation's projects — on every
// screen, including the portfolio and global lists the screen itself shows read-only — while the other roles export what
// the screen shows. Rows that belong to no project (a stock line, a person) are kept.
import { listProjects } from '@/server/dal/projects';
import { isMineProject } from '@/server/project-context';
import type { ExportContext } from '../types';

export type ProjectFilter = (code: string | null | undefined) => boolean;

/** Predicate on a project code (full "HLT-026" or short "HLT"): true when the viewer may export rows of that project. */
export async function projectFilter(ctx: Pick<ExportContext, 'viewer'>): Promise<ProjectFilter> {
  if (ctx.viewer.role !== 'client') return () => true;
  const mine = (await listProjects()).filter((p) => isMineProject(ctx.viewer, p));
  const codes = new Set(mine.flatMap((p) => [p.code, p.shortCode]));
  return (code) => !code || codes.has(code) || codes.has(code.slice(0, 3));
}
