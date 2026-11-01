// R-198: who edits the Schedule screen's interactive Gantt. The Gantt is another way to make the Plan's structure edits (start,
// duration, relationships), so it follows the Plan's rule (P-9a, R-041: the project's PMs — PM of record, co-PMs, deputies — and
// the director, on a plan they may edit, never the client) and the Schedule screen must be editable for the viewer (not outside
// the workspace, not a read-only project, not a role that reads the Schedule only, such as Logistics — R-158).
// Shared by the page (which renders the edit handles) and the Server Functions (which re-check on the server).
import { canEditPlan, canEditStructure } from '@/features/plan/rights';
import type { ProjectContext } from '@/server/project-context';

type Ctx = Pick<ProjectContext, 'canEdit' | 'viewer' | 'isLead'>;

/** The Gantt is editable at all (the Plan and the Schedule screen both editable for the viewer). */
export const ganttEditable = (ctx: Ctx) => canEditPlan(ctx) && ctx.canEdit('schedule');

/** Moves, durations and relationships on the Gantt. */
export const canEditGantt = (ctx: Ctx) => ganttEditable(ctx) && canEditStructure(ctx);
