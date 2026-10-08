// WP collapse map of the Plan tables (`collapsed`, prototype state 3767): global (not per project), kept in a
// cookie so the server renders the same rows as the client. Shared by the page (server) and the table (client).
import { DEFAULT_COLLAPSED } from '@/domain/schedule';

export const COLLAPSE_COOKIE = 'ks-plan-collapsed';

/** Parses the cookie value; the default map (1.1–1.3 collapsed) when absent or malformed. */
export function parseCollapsed(raw: string | undefined | null): Record<string, boolean> {
  if (!raw) return { ...DEFAULT_COLLAPSED };
  for (const text of [raw, safeDecode(raw)]) {
    try {
      const v: unknown = JSON.parse(text);
      if (v && typeof v === 'object' && !Array.isArray(v))
        return Object.fromEntries(Object.entries(v).filter(([k, b]) => /^\d+(\.\d+)*$/.test(k) && typeof b === 'boolean'));
    } catch {
      // try the next form
    }
  }
  return { ...DEFAULT_COLLAPSED };
}

/** Cookie value written by the client. */
export const serializeCollapsed = (map: Record<string, boolean>) => encodeURIComponent(JSON.stringify(map));

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
