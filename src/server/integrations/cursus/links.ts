// Links from Keystone to Cursus (pure, client-safe). Cursus's web app routes its views by path (`/chantiers`,
// `/habilitations`, `/voyages`, `/collaborateurs` — client/src/state/store.tsx) and has no parameter selecting one site or
// one employee yet: OPEN QUESTION C-1 (the `chantier` parameter below is a proposal Cursus ignores today). Every Cursus
// URL of Keystone is built here. Render the links with CURSUS_LINK_ATTRS (the Mac app hands target=_blank links to the browser).
import { cursusPublicUrl } from './config';

/** Anchor attributes of every link to Cursus (opens outside Keystone). */
export const CURSUS_LINK_ATTRS = { target: '_blank', rel: 'noopener noreferrer' } as const;

const qs = (params: Record<string, string | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && String(v).trim()) p.set(k, String(v).trim());
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** "Open Cursus" on a site: Cursus's Go / No Go per site screen (OPEN QUESTION C-1 for selecting the site). */
export function cursusChantierUrl(chantierId?: string | null): string {
  return `${cursusPublicUrl()}/chantiers${qs({ chantier: chantierId })}`;
}

/** Cursus's clearances & training matrix. */
export function cursusClearancesUrl(): string {
  return `${cursusPublicUrl()}/habilitations`;
}

/** Cursus's travel formalities (visa, vaccinations). */
export function cursusTravelUrl(): string {
  return `${cursusPublicUrl()}/voyages`;
}
