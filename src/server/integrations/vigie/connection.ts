import 'server-only';
// Server-side Vigie connection settings, from the validated configuration (src/server/config, R-007):
//   VIGIE_SOURCE  `server`: Vigie's pub_ views are read and its pub_ functions called on the shared PostgreSQL server, through
//                 Keystone's own connection (role keystone_app; the links are Matrix's, M-17 / M-18) — D12 (ECOs) and D13 (NCRs,
//                 site HSE); `simulation`: the local mirrors seeded from the demo data, progress kept "pending sync with Vigie".
//                 Default `server` with DATABASE_URL, else `simulation`.
// Vigie exposes no API to Keystone any more (D12, D13): VIGIE_API_URL / VIGIE_API_KEY are not read.
// The public URL of the Vigie web app (links) stays in ./config.ts, which is safe in client components.
import { getConfig } from '@/server/config';
import type { VigieSource } from '@/server/config/parse';

export type { VigieSource };

/** `sql`: Vigie's views and functions on the shared server; `mock`: the local mirrors (demo data, simulation). */
export type VigieConnectorMode = 'mock' | 'sql';

export const vigieSource = (): VigieSource => getConfig().vigie.source;

/** Which Vigie connector runs: `sql` when VIGIE_SOURCE is `server`, else `mock`. */
export const vigieConnectorMode = (): VigieConnectorMode => (vigieSource() === 'server' ? 'sql' : 'mock');
