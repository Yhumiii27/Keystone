// Baseline policy (chapter 4, S-3 = a; L-2 = a). Successive baselines BL0, BL1, BL2…; "Set baseline" snapshots freely only
// while the next code is BL0 or BL1 (BL1 is frozen at the end of APD, L-2). From BL2 on, a new baseline goes through a change
// request: the CR carries a proposed baseline, which is filled with the activity snapshot and becomes current when the CR is
// approved (src/server/dal/changes.ts). Pure module shared by the Plan / Schedule pages and their Server Functions.
// Delivery 8: after BL1 a cost category's amount is frozen (R-081, C-3a) and the APD deliverable « Planning BL1 posé » is ticked by
// BL1 itself (R-054, L-2 "a" — the option detail of the owner's answer closes DELIVERY-6 §8 L-2).
import { nextBaselineCode } from './ch4-defaults';

/** Highest baseline number "Set baseline" may create without a change request (BL1, L-2). */
export const LAST_FREE_BASELINE = 1;

/** Number of a baseline code ("BL3" → 3), NaN when it is not BLn. */
export const baselineNumber = (code: string) => {
  const m = /^BL(\d+)$/i.exec(code.trim());
  return m ? parseInt(m[1], 10) : NaN;
};

/**
 * True while the project's next baseline (`nextBaselineCode` of the existing codes, any state) is BL0 or BL1: "Set baseline"
 * snapshots directly. False once the project has BL1 (or any higher BLn): the next baseline needs a change request.
 */
export const canSnapshotFreely = (existingCodes: readonly string[]) => baselineNumber(nextBaselineCode(existingCodes)) <= LAST_FREE_BASELINE;

// ── Delivery 8 (R-081, C-3a): cost category amounts frozen after BL1 ─────────────────────────────────────────────────

/**
 * A project's cost category amounts are frozen once it has BL1 or any higher BLn, in any state (the same "after BL1" test as
 * "Set baseline", S-3): from then on a category's amount changes only through an approved change request (A-4).
 */
export const categoryAmountFrozen = (existingCodes: readonly string[]) => !canSnapshotFreely(existingCodes);

/** Refusal of a category amount change after BL1 (Budget dialogs, Excel/CSV budget lines). */
export const CATEGORY_FROZEN_MESSAGE = 'After BL1 the amount changes only through an approved change request';

// ── Delivery 8 (R-054, L-2 "a"): the APD deliverable « Planning BL1 posé » follows the real BL1 ─────────────────────────

/** « Planning BL1 posé »: the second deliverable (0-based position 1) of APD (STAGE_DELIVS.APD). */
export const BL1_STAGE_DELIVERABLE = { stage: 'apd', position: 1 } as const;

/** The project has BL1: a baseline numbered 1 or more that is current or superseded (a proposed one does not count). */
export const hasBl1 = (baselines: readonly { code: string; state: string }[]) =>
  baselines.some((b) => baselineNumber(b.code) >= 1 && (b.state === 'current' || b.state === 'superseded'));

/** Toast segment after "Set baseline" / "Re-baseline" when BL1 ticked the deliverable (only when the tick changed). */
export const BL1_TICKED = '“Planning BL1 posé” ticked';

/** Refusal of a manual tick (without BL1) or untick (with BL1) of « Planning BL1 posé »; a forced stage change stays possible. */
export const BL1_DELIVERABLE_MESSAGE = 'Set BL1 first (Plan › Set baseline, up to BL1) — or force the stage change';

/** A manual change of « Planning BL1 posé » the rule refuses: ticking it without BL1, unticking it while BL1 exists. */
export const bl1TickRefused = (target: { stage: string; position: number; done: boolean }, bl1: boolean) =>
  target.stage === BL1_STAGE_DELIVERABLE.stage && target.position === BL1_STAGE_DELIVERABLE.position && target.done !== bl1;
