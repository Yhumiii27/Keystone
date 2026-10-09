// Validation of forced stage changes (chapter 4, default L-1 — the product owner confirms it in the chapter-5
// questionnaire). A stage move forced on Projects (deliverables missing, or Annulé) waits in My approvals for the
// portfolio director:
// - Approve keeps the stage the project was forced into (the forced history row becomes "approved");
// - Reject sends the project back to the stage it left: the forced row becomes "rejected" and a 'revert' history row
//   (dated like every stage move, at the status date) records the way back, with the director's comment.
// Both decisions are audited, written to the activity feed and notified to whoever forced the move and to the
// project manager. Every rule a questionnaire answer may change is a constant or a function of this module.
import type { RoleKey } from '@/config/screens';

/** Roles that decide forced stage changes (My approvals "Forced stage change"). L-1: the portfolio director only. */
export const FORCED_STAGE_DECIDER_ROLES: readonly RoleKey[] = ['director'];

export const isForcedStageDecider = (role: RoleKey) => FORCED_STAGE_DECIDER_ROLES.includes(role);

/** L-1: what Reject does — the project goes back to the stage it left. */
export const FORCED_STAGE_REJECT_EFFECT = 'revert_to_previous' as const;

/** L-1: the director's comment is optional on both decisions (shown in the history and the notification). */
export const FORCED_STAGE_REJECT_COMMENT_REQUIRED = false;

/** Longest comment kept. */
export const FORCED_STAGE_COMMENT_MAX = 500;

/** History reason of the 'revert' row when the director gave no comment (EN source string). */
export const DEFAULT_REVERT_REASON = 'Forced stage change rejected by the portfolio director';

/** Reason written on the 'revert' history row. */
export const revertReason = (comment: string | null | undefined) => (comment ?? '').trim().slice(0, FORCED_STAGE_COMMENT_MAX) || DEFAULT_REVERT_REASON;

/**
 * Can Reject revert this forced move? Only while the project still stands in the stage it was forced into and the
 * forced move is the project's last move (otherwise reverting would also undo the later moves — the director then
 * approves it, or moves the project on Projects). The stage it left must be known.
 */
export function revertBlocker(
  forced: { toStage: string; fromStage: string | null; seq: number },
  project: { stage: string; lastSeq: number },
): 'moved_on' | 'no_previous' | null {
  if (!forced.fromStage) return 'no_previous';
  if (project.stage !== forced.toStage || project.lastSeq !== forced.seq) return 'moved_on';
  return null;
}

/** EN messages of the blockers (shown in a toast). */
export const REVERT_BLOCKER_MESSAGE: Record<'moved_on' | 'no_previous', string> = {
  moved_on: 'The project has moved to another stage since — it can no longer be reverted from here',
  no_previous: 'The stage the project left is unknown — it cannot be reverted',
};
