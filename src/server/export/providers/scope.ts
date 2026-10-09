import 'server-only';
// Row visibility of the exports (chapter 4): a client exports only the rows of their organisation's projects — on every
// screen, including the portfolio and global lists the screen itself shows read-only — while the other roles export what
// the screen shows. Rows that belong to no project (a stock line, a person) are kept.
import { listProjects } from '@/server/dal/projects';
import { isMineProject } from '@/server/project-context';
import type { ExportContext } from '../types';
import { param } from './common';

export type ProjectFilter = (code: string | null | undefined) => boolean;

/** Predicate on a project code (full "HLT-026" or short "HLT"): true when the viewer may export rows of that project. */
export async function projectFilter(ctx: Pick<ExportContext, 'viewer'>): Promise<ProjectFilter> {
  if (ctx.viewer.role !== 'client') return () => true;
  const mine = (await listProjects()).filter((p) => isMineProject(ctx.viewer, p));
  const codes = new Set(mine.flatMap((p) => [p.code, p.shortCode]));
  return (code) => !code || codes.has(code) || codes.has(code.slice(0, 3));
}

/**
 * Current project of a global screen (the header passes the shell's project as `?code=`): that code, else `fallback`. A
 * client never gets another organisation's project this way: an unknown or foreign code falls back to the first of their
 * own projects (projects with data first), or '' when they have none (the provider then shows no project figures).
 */
export async function currentProjectCode(ctx: Pick<ExportContext, 'viewer' | 'params'>, fallback: string): Promise<string> {
  const asked = param(ctx, 'code')?.toUpperCase() ?? null;
  if (ctx.viewer.role !== 'client') return asked ?? fallback;
  const mine = (await listProjects()).filter((p) => isMineProject(ctx.viewer, p)).sort((a, b) => Number(b.hasData) - Number(a.hasData));
  return mine.find((p) => p.code === asked)?.code ?? mine.find((p) => p.code === fallback)?.code ?? mine[0]?.code ?? '';
}
