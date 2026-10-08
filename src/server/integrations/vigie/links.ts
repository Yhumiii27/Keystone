// Links from Keystone to Vigie (pure, client-safe). Vigie has no ECO module yet, so the URL patterns below are a
// proposal — OPEN QUESTION V-1: Vigie defines the routes of its ECO register (list, record, creation form with a
// prefilled part / project / title). Every Vigie URL of Keystone is built here, so adopting Vigie's real routes is a
// one-file change. Links open outside Keystone: render them with VIGIE_LINK_ATTRS (the Mac app hands target=_blank
// links to the browser).
import { vigiePublicUrl } from './config';

/** OPEN QUESTION V-1: path of the ECO register in Vigie (Vigie's routes are French: /evenements, /actions…). */
export const VIGIE_ECO_PATH = '/modifications-techniques';
/** OPEN QUESTION V-1: path of Vigie's "new ECO" form. */
export const VIGIE_NEW_ECO_PATH = `${VIGIE_ECO_PATH}/nouvelle`;

/** Anchor attributes of every link to Vigie (opens outside Keystone). */
export const VIGIE_LINK_ATTRS = { target: '_blank', rel: 'noopener noreferrer' } as const;

const qs = (params: Record<string, string | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && String(v).trim()) p.set(k, String(v).trim());
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** The ECO record in Vigie ("ECO-2026-015"). */
export function vigieEcoUrl(id: string): string {
  return `${vigiePublicUrl()}${VIGIE_ECO_PATH}/${encodeURIComponent(id)}`;
}

/**
 * Vigie's "new ECO" form, prefilled with what Keystone knows ("Raise ECO" from a BOM node or a part record). The
 * parameter names are part of OPEN QUESTION V-1; `source=keystone` lets Vigie link back.
 */
export function vigieNewEcoUrl(ctx: { partRef?: string | null; projectCode?: string | null; title?: string | null } = {}): string {
  return `${vigiePublicUrl()}${VIGIE_NEW_ECO_PATH}${qs({ part: ctx.partRef, project: ctx.projectCode, title: ctx.title, source: 'keystone' })}`;
}

/** Vigie's ECO register, optionally filtered on a part or a project (OPEN QUESTION V-1). */
export function vigieEcoListUrl(filter: { partRef?: string | null; projectCode?: string | null } = {}): string {
  return `${vigiePublicUrl()}${VIGIE_ECO_PATH}${qs({ part: filter.partRef, project: filter.projectCode })}`;
}
