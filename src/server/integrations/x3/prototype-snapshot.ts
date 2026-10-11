import 'server-only';
// Sage X3 mock connector (stock): what X3 reports until the real connector exists (R-034, I-3b — daily Sage extracts).
// The mock answers with the prototype's stock snapshot (STOCK0 3475, the data the demo database was seeded from), with
// reservations keyed by the 3-letter project code. R-170: this is the only run-time reader of the prototype data left
// outside the seed, kept on purpose in the connector folder (like the Vigie and Cursus snapshots) until the X3 extracts
// replace it.
import { isoOfDisplayDate } from '@/server/db/codes';
import { PROTO } from '@/server/prototype';

/** Time of the last X3 stock import of the snapshot (`x3Sync` initial state 3774: "07:15" on the status date). */
export const X3_LAST_IMPORT = '07:15';

/** One stock line as Sage X3 reports it. */
export interface X3StockLine {
  ref: string;
  location: string;
  onHand: number;
  reserved: number;
  /** 3-letter project key of the reservation ('' when none). */
  projectShort: string;
  minQty: number;
  /** ISO date of the last movement. */
  lastMovementOn: string;
}

interface ProtoStockLine { ref: string; loc: string; onHand: number; reserved: number; proj: string; min: number; last: string }

/** Stock positions as the X3 mock reports them. */
export function x3StockSnapshot(): X3StockLine[] {
  return (PROTO.STOCK0 as ProtoStockLine[]).map((r) => ({
    ref: r.ref, location: r.loc, onHand: r.onHand, reserved: r.reserved, projectShort: r.proj, minQty: r.min, lastMovementOn: isoOfDisplayDate(r.last)!,
  }));
}
