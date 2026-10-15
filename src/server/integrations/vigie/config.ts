// Vigie links settings (Vigie = the group's QHSE application, which owns the engineering change orders, NCRs and site HSE).
// Pure module, safe in client components: NEXT_PUBLIC_VIGIE_URL is inlined in browser bundles at build time.
//   NEXT_PUBLIC_VIGIE_URL  base URL of the Vigie web app the links open (default http://localhost:3200)
// The API settings (VIGIE_API_URL, VIGIE_API_KEY) are server-only: ./connection.ts, through src/server/config (R-007).

/** Vigie's local development address. */
export const DEFAULT_VIGIE_URL = 'http://localhost:3200';

const trimSlash = (u: string) => u.trim().replace(/\/+$/, '');

/** Base URL of the Vigie web app (links that open an ECO in Vigie). */
export function vigiePublicUrl(): string {
  return trimSlash(process.env.NEXT_PUBLIC_VIGIE_URL || DEFAULT_VIGIE_URL);
}
