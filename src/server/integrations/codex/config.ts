// Codex connection settings (Codex = the group's document management application, which stores the document files).
// Pure module, safe in client components: NEXT_PUBLIC_CODEX_URL is inlined in browser bundles at build time.
//   NEXT_PUBLIC_CODEX_URL  base URL of the Codex web app the links open (default http://localhost:3100)
// Deep links to a given document or selection are open question D-1: until they exist, Keystone links to Codex's home
// (e.g. the "Download zip" toast of the document vault, chapter 4 exports).

/** Codex's local development address. */
export const DEFAULT_CODEX_URL = 'http://localhost:3100';

const trimSlash = (u: string) => u.trim().replace(/\/+$/, '');

/** Base URL of the Codex web app. */
export function codexPublicUrl(): string {
  return trimSlash(process.env.NEXT_PUBLIC_CODEX_URL || DEFAULT_CODEX_URL);
}

export type CodexConnectorMode = 'mock';

/**
 * Which Codex connector runs (R-021): always the mock — Keystone's own index of the Codex records — until Codex publishes an
 * API and the connector is built (R-033). Screens show it as "Mock", never as a real sync.
 */
export const codexConnectorMode = (): CodexConnectorMode => 'mock';
