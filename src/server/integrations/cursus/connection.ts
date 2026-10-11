import 'server-only';
// Server-side Cursus connection settings, from the validated configuration (src/server/config, R-007):
//   CURSUS_API_URL  base URL of Cursus's API (e.g. http://localhost:3210); when set, the HTTP connector is used
//   CURSUS_API_KEY  key sent as X-Api-Key (Cursus checks it against its KEYSTONE_API_KEY); KEYSTONE_API_KEY is accepted too.
//                   Outside production the Cursus demo key ("demo-keystone") is the default; production refuses it.
// The public URL of the Cursus web app (links) stays in ./config.ts, which is safe in client components.
import { getConfig } from '@/server/config';

export type CursusConnectorMode = 'mock' | 'http';

/** Base URL of Cursus's API, or null when not configured (the mock connector over the local mirror is used). */
export const cursusApiUrl = (): string | null => getConfig().cursus.apiUrl;

/** API key Keystone presents to Cursus (header X-Api-Key); null in production when none is configured. */
export const cursusApiKey = (): string | null => getConfig().cursus.apiKey;

/** Which Cursus connector runs: `http` when CURSUS_API_URL is set, else `mock`. */
export const cursusConnectorMode = (): CursusConnectorMode => (cursusApiUrl() ? 'http' : 'mock');
