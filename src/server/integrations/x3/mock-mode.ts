import 'server-only';
// R-034 (A-15 "données réelles seulement", R-021 as built): Keystone has no Sage X3 connector yet — the Activity &
// integrations row says "Not connected". The three X3 actions of the screens ("Import from X3" on Stock, "Push to X3" in
// the stock-line and purchase-order drawers) are a simulation over the prototype's snapshot, so:
// - on a demo database (the prototype data set, R-011) they keep working, and every toast, audit row and activity line says
//   "simulated (Sage X3 not connected)" — the SolidWorks PDM precedent;
// - on a production database they are hidden and refused (Server Functions, then the writers), so no snapshot line, no
//   x3_sync_runs row, no pushedToX3At and no fake "X3-…" reference ever reaches real data;
// - IT can switch the simulation off on a demo database too by disabling "Sage X3" in the connectors file (D-7a).
// The gate follows the data, not the environment (R-011). The real connector (daily extracts, I-3b) replaces this file.
import { getDb } from '@/server/db/client';
import { databaseSeedMode } from '@/server/db/seed/mode';
import { connectorEnabled } from '@/server/integrations/connector-enabled';

/** Name of the Sage X3 row of the connectors table (and of IT's connectors file). */
export const SAGE_X3_CONNECTOR_NAME = 'Sage X3';
/** Refusal of an X3 action when the simulation is not available (EN source string). */
export const X3_NOT_CONNECTED = 'Sage X3 is not connected';

/** The simulated X3 actions are available: a demo database whose "Sage X3" connector IT did not disable. */
export async function x3Simulated(): Promise<boolean> {
  if ((await databaseSeedMode(await getDb())) !== 'demo') return false;
  return connectorEnabled(SAGE_X3_CONNECTOR_NAME);
}

/** Writers' second check (before their transaction): throws "Sage X3 is not connected" when the simulation is not available. */
export async function requireX3Simulation(): Promise<void> {
  if (!(await x3Simulated())) throw new Error(X3_NOT_CONNECTED);
}
