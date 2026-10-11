// Incident identifiers of the error pages (R-176). Pure module, safe in client components.
// - An error raised on the server (Server Component, Server Function, Route Handler) reaches the error page with Next.js's
//   `digest`: the hash Next prints with the error in the server log (and that the structured log line of R-009 carries as
//   `err.digest`). The page shows it as is, so IT can find the stack trace from what the user reads them.
// - An error raised in the browser has no digest: the page makes a "C-" identifier and reports it to the server, which
//   logs it with the message and the path (./actions.ts), so it can be found the same way.

/** Identifier made in the browser: "C-" and 8 hex digits. */
export const CLIENT_INCIDENT_RE = /^C-[0-9a-f]{8}$/;

/** A new browser-side incident identifier. */
export function newClientIncidentId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return 'C-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Next's digest of a server error, when there is one (a short token of digits, letters, dashes). */
export function serverIncidentOf(error: unknown): string | null {
  const d = (error as { digest?: unknown } | null)?.digest;
  return typeof d === 'string' && /^[\w-]{1,64}$/.test(d) ? d : null;
}

export interface ClientIncident {
  incident: string;
  /** The error message, single line, at most 300 characters. */
  message: string;
  /** Path of the page (no query string), at most 200 characters. */
  path: string;
}

/** Validates what a browser reports (anything may arrive): identifier format, text lengths, control characters removed. */
export function parseClientIncident(input: unknown): ClientIncident | null {
  if (!input || typeof input !== 'object') return null;
  const { incident, message, path } = input as Record<string, unknown>;
  if (typeof incident !== 'string' || !CLIENT_INCIDENT_RE.test(incident)) return null;
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
  return { incident, message: typeof message === 'string' ? clean(message, 300) : '', path: clean(path.split(/[?#]/)[0], 200) };
}
