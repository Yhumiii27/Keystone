// Baseline policy (chapter 4, S-3 = a; L-2 = a). Successive baselines BL0, BL1, BL2…; "Set baseline" snapshots freely only
// while the next code is BL0 or BL1 (BL1 is frozen at the end of APD, L-2). From BL2 on, a new baseline goes through a change
// request: the CR carries a proposed baseline, which is filled with the activity snapshot and becomes current when the CR is
// approved (src/server/dal/changes.ts). Pure module shared by the Plan / Schedule pages and their Server Functions.
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
