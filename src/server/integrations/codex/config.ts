// Codex connection settings (Codex = the group's document management application, which stores the document files).
// Pure module, safe in client components: NEXT_PUBLIC_CODEX_URL is inlined in browser bundles at build time, while
// CODEX_API_URL is only read on the server (undefined in the browser).
//   NEXT_PUBLIC_CODEX_URL  base URL of the Codex web app the links open (default http://localhost:3100)
//   CODEX_API_URL          base URL of Codex's API; when set, the HTTP connector delivers the approval outbox and
//                          refreshes the index records it concerns (Delivery 7, R-124), else the mock keeps the
//                          decisions "pending sync with Codex"
// Deep links to a given document or selection are open question D-1: until they exist, Keystone links to Codex's home
// (e.g. the "Download zip" toast of the document vault, chapter 4 exports).

/** Codex's local development address. */
export const DEFAULT_CODEX_URL = 'http://localhost:3100';

const trimSlash = (u: string) => u.trim().replace(/\/+$/, '');

/** Base URL of the Codex web app. */
export function codexPublicUrl(): string {
  return trimSlash(process.env.NEXT_PUBLIC_CODEX_URL || DEFAULT_CODEX_URL);
}

/** Base URL of Codex's API, or null when not configured (the mock connector is used). */
export function codexApiUrl(): string | null {
  const u = process.env.CODEX_API_URL;
  return u && u.trim() ? trimSlash(u) : null;
}

export type CodexConnectorMode = 'mock' | 'http';

/**
 * Which Codex connector runs (R-021, R-124): `http` when CODEX_API_URL is set (the approval outbox is delivered to Codex),
 * else `mock` — Keystone's own index of the Codex records, shown as "Mock", never as a real sync, until Codex publishes its API
 * (R-033).
 */
export const codexConnectorMode = (): CodexConnectorMode => (codexApiUrl() ? 'http' : 'mock');
