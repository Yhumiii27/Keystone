import 'server-only';
// Settings of the capex connector (R-187), from the validated configuration (src/server/config, R-007):
//   ARCHE_URL     Arche's web app — the deep links (./links.ts); default http://localhost:3400 (Arche's port on the owner's Mac)
//   ARCHE_SOURCE  where Arche's views are read: `server` (arche.pub_capex and arche.pub_besoins_machines on the shared PostgreSQL
//                 server, through Keystone's own connection — keystone_app only SELECTs them, the grant is Matrix's), `simulation`
//                 (the demo source of ./simulation.ts, applied to a demo database only), `off`. Default: `server` with
//                 DATABASE_URL, else `simulation`.
// IT can also disable the "Arche" row of the connectors table (KEYSTONE_CONNECTORS_FILE, R-020): nothing is read then.
import { getConfig } from '@/server/config';
import type { ArcheSource } from '@/server/config/parse';

export type { ArcheSource };

/** Name of Arche's row in the connectors table (Activity & integrations). */
export const ARCHE_CONNECTOR_NAME = 'Arche';

export const archeUrl = (): string => getConfig().arche.url;
export const archeSource = (): ArcheSource => getConfig().arche.source;

/** Mode shown on the connector row: `sql` (read on the shared server), `mock` (simulation), null (off). */
export const archeConnectorMode = (): 'sql' | 'mock' | null => {
  const s = archeSource();
  return s === 'server' ? 'sql' : s === 'simulation' ? 'mock' : null;
};
