// Who may do what on the Plan (docs/spec/05 §0.4, chapter 4 S-1; P-9a, R-061). Shared by the page (which controls to render)
// and the Server Functions (which re-check on the server).
import { canEditActivityProgress, canEditPlanStructure } from '@/domain/rights';
import type { ProjectContext } from '@/server/project-context';

type Ctx = Pick<ProjectContext, 'canEdit' | 'viewer' | 'isLead'>;

/**
 * The Plan is editable for the viewer at all: not outside the workspace, on the project's team (not a read-only project,
 * R-041), never the client. What they may change then depends on `canEditStructure` / `canEditProgress`.
 */
export const canEditPlan = (ctx: Ctx) => ctx.canEdit('plan') && ctx.viewer.role !== 'client';

/**
 * Structure (P-9a): add / rename / re-order / remove work packages and activities, names, owners, durations, budgets, links,
 * calendars, to-dos — the project's PMs (PM of record, co-PMs, deputies) and the director.
 */
export const canEditStructure = (ctx: Ctx) => canEditPlanStructure(canEditPlan(ctx), { lead: ctx.isLead });

/** % complete of one activity (P-9a): the PM team and the director, and the activity's owner for their own activities. */
export const canEditProgress = (ctx: Ctx, ownsActivity: boolean) => canEditActivityProgress(canEditPlan(ctx), { lead: ctx.isLead }, ownsActivity);

/**
 * Scheduling decisions — Reschedule, Set baseline, the Baseline and Calendar chips, removal and restore: the director or the
 * project's PMs (S-1 default, R-041: PM of record, co-PMs and deputies).
 */
export const canSchedulePlan = canEditStructure;
