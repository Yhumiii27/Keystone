// Who may do what on the Plan (docs/spec/05 §0.4, chapter 4 S-1). Shared by the page (which controls to render) and the
// Server Functions (which re-check on the server).
import type { ProjectContext } from '@/server/project-context';

type Ctx = Pick<ProjectContext, 'canEdit' | 'viewer' | 'isMine'>;

/** Activity edits (inline cells, relationships, calendar override, to-dos): not outside, not a read-only project, never the client. */
export const canEditPlan = (ctx: Ctx) => ctx.canEdit('plan') && ctx.viewer.role !== 'client';

/**
 * Scheduling decisions — Reschedule, Set baseline, the Baseline and Calendar chips: the director or the project's own manager
 * (S-1 default), on top of the edit rights.
 */
export const canSchedulePlan = (ctx: Ctx) => canEditPlan(ctx) && (ctx.viewer.role === 'director' || ctx.isMine);
