// Cursus links settings (Cursus = the group's HR / training application, which owns individual site clearances and the
// people Go / No Go per site). Pure module, safe in client components: NEXT_PUBLIC_CURSUS_URL is inlined in browser bundles
// at build time.
//   NEXT_PUBLIC_CURSUS_URL  base URL of the Cursus web app the links open (default http://localhost:5173, `npm run dev`)
// The API settings (CURSUS_API_URL, CURSUS_API_KEY) are server-only: ./connection.ts, through src/server/config (R-007).

/** Cursus's local development address (Vite dev server; `npm start` serves the app on the API port, 3210). */
export const DEFAULT_CURSUS_URL = 'http://localhost:5173';

const trimSlash = (u: string) => u.trim().replace(/\/+$/, '');

/** Base URL of the Cursus web app (links that open Cursus). */
export function cursusPublicUrl(): string {
  return trimSlash(process.env.NEXT_PUBLIC_CURSUS_URL || DEFAULT_CURSUS_URL);
}
