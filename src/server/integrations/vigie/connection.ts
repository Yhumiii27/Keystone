import 'server-only';
// Server-side Vigie connection settings, from the validated configuration (src/server/config, R-007):
//   VIGIE_API_URL  base URL of Vigie's API; when set, the HTTP connectors are used instead of the mocks
//   VIGIE_API_KEY  sent as X-Api-Key when set — provisional: Vigie's API authentication is open question V-3 (DELIVERY-5 §8);
//                  the header follows the Cursus convention until Vigie publishes its contract.
// The public URL of the Vigie web app (links) stays in ./config.ts, which is safe in client components.
import { getConfig } from '@/server/config';

export type VigieConnectorMode = 'mock' | 'http';

/** Base URL of Vigie's API, or null when not configured (the mock connector over the local mirror is used). */
export const vigieApiUrl = (): string | null => getConfig().vigie.apiUrl;

/** Headers authenticating Keystone to Vigie ({} until VIGIE_API_KEY is set). */
export function vigieAuthHeaders(): Record<string, string> {
  const key = getConfig().vigie.apiKey;
  return key ? { 'x-api-key': key } : {};
}

/** Which Vigie connector runs: `http` when VIGIE_API_URL is set, else `mock`. */
export const vigieConnectorMode = (): VigieConnectorMode => (vigieApiUrl() ? 'http' : 'mock');
