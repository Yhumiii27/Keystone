// Vigie connection settings (Vigie = the group's QHSE application, which owns the engineering change orders).
// Pure module, safe in client components: NEXT_PUBLIC_VIGIE_URL is inlined in browser bundles at build time, while
// VIGIE_API_URL is only read on the server (undefined in the browser).
//   NEXT_PUBLIC_VIGIE_URL  base URL of the Vigie web app the links open (default http://localhost:3200)
//   VIGIE_API_URL          base URL of Vigie's API; when set, the HTTP connector is used instead of the mock

/** Vigie's local development address. */
export const DEFAULT_VIGIE_URL = 'http://localhost:3200';

const trimSlash = (u: string) => u.trim().replace(/\/+$/, '');

/** Base URL of the Vigie web app (links that open an ECO in Vigie). */
export function vigiePublicUrl(): string {
  return trimSlash(process.env.NEXT_PUBLIC_VIGIE_URL || DEFAULT_VIGIE_URL);
}

/** Base URL of Vigie's API, or null when not configured (the mock connector over the local mirror is used). */
export function vigieApiUrl(): string | null {
  const u = process.env.VIGIE_API_URL;
  return u && u.trim() ? trimSlash(u) : null;
}

export type VigieConnectorMode = 'mock' | 'http';

/** Which ECO connector runs: `http` when VIGIE_API_URL is set, else `mock`. */
export const vigieConnectorMode = (): VigieConnectorMode => (vigieApiUrl() ? 'http' : 'mock');
