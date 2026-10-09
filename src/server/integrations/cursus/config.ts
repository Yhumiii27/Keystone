// Cursus connection settings (Cursus = the group's HR / training application, which owns individual site clearances
// and the people Go / No Go per site). Pure module, safe in client components: NEXT_PUBLIC_CURSUS_URL is inlined in
// browser bundles at build time, while CURSUS_API_URL and the API key are only read on the server.
//   NEXT_PUBLIC_CURSUS_URL  base URL of the Cursus web app the links open (default http://localhost:5173, `npm run dev`)
//   CURSUS_API_URL          base URL of Cursus's API (e.g. http://localhost:3210); when set, the HTTP connector is used
//   CURSUS_API_KEY          key sent as X-Api-Key (Cursus checks it against its KEYSTONE_API_KEY; default "demo-keystone")

/** Cursus's local development address (Vite dev server; `npm start` serves the app on the API port, 3210). */
export const DEFAULT_CURSUS_URL = 'http://localhost:5173';
/** Cursus's demo API key (Cursus README: KEYSTONE_API_KEY, default "demo-keystone"). */
export const DEFAULT_CURSUS_API_KEY = 'demo-keystone';

const trimSlash = (u: string) => u.trim().replace(/\/+$/, '');

/** Base URL of the Cursus web app (links that open Cursus). */
export function cursusPublicUrl(): string {
  return trimSlash(process.env.NEXT_PUBLIC_CURSUS_URL || DEFAULT_CURSUS_URL);
}

/** Base URL of Cursus's API, or null when not configured (the mock connector over the local mirror is used). */
export function cursusApiUrl(): string | null {
  const u = process.env.CURSUS_API_URL;
  return u && u.trim() ? trimSlash(u) : null;
}

/** API key Keystone presents to Cursus (header X-Api-Key). */
export function cursusApiKey(): string {
  return process.env.CURSUS_API_KEY || process.env.KEYSTONE_API_KEY || DEFAULT_CURSUS_API_KEY;
}

export type CursusConnectorMode = 'mock' | 'http';

/** Which Cursus connector runs: `http` when CURSUS_API_URL is set, else `mock`. */
export const cursusConnectorMode = (): CursusConnectorMode => (cursusApiUrl() ? 'http' : 'mock');
