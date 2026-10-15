// Links from Keystone to Cursus (pure, client-safe). Cursus's web app routes its views by path (`/chantiers`,
// `/habilitations`, `/voyages`, `/collaborateurs` — client/src/state/store.tsx) and has no parameter selecting one site or
// one employee yet: OPEN QUESTION C-1. NEW-CURSUS-3 'a' (R-032) asks Cursus for targeted links: the `chantier` and
// `matricule` parameters below are PROPOSALS that Cursus ignores today (the page opens on its full list) — their names are to
// be confirmed with the Cursus team. Every Cursus URL of Keystone is built here. Render the links with CURSUS_LINK_ATTRS (the
// Mac app hands target=_blank links to the browser).
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

/**
 * An employee in Cursus (R-032, NEW-CURSUS-3 'a'): `/collaborateurs?matricule=<m>` — the parameter is a proposal Cursus ignores
 * today (C-1), so the link opens Cursus's staff list. Null without a matricule (the demo and the mock know names only).
 */
export function cursusEmployeeUrl(matricule?: string | null): string | null {
  if (!matricule || !matricule.trim()) return null;
  return `${cursusPublicUrl()}/collaborateurs${qs({ matricule })}`;
}

/** Cursus's clearances & training matrix. */
export function cursusClearancesUrl(): string {
  return `${cursusPublicUrl()}/habilitations`;
}

/** Cursus's travel formalities (visa, vaccinations). */
export function cursusTravelUrl(): string {
  return `${cursusPublicUrl()}/voyages`;
}
