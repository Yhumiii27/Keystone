// Links from Keystone to Arche, the CAPEX application (R-187, Arche K-02). Pure and client-safe: the base URL (ARCHE_URL, read
// on the server by ./config.ts) is passed in, so a page builds the links on the server and hands strings to its client islands.
// Arche's deep links (Arche docs/DEMANDES-KEYSTONE.md K-02, docs/CONTRATS.md): `<ARCHE_URL>/capex/<code>` (the CAPEX sheet) and
// `<ARCHE_URL>/capex/<code>/machines` (its machine needs). Render them with ARCHE_LINK_ATTRS (the Mac app hands target=_blank
// links to the browser).

/** Anchor attributes of every link to Arche (opens outside Keystone). */
export const ARCHE_LINK_ATTRS = { target: '_blank', rel: 'noopener noreferrer' } as const;

const trimSlash = (u: string) => u.trim().replace(/\/+$/, '');

/** The CAPEX sheet in Arche. */
export const archeCapexUrl = (base: string, capexCode: string) => `${trimSlash(base)}/capex/${encodeURIComponent(capexCode)}`;

/** The machine needs of a CAPEX in Arche (the need's line is shown there). */
export const archeNeedsUrl = (base: string, capexCode: string) => `${archeCapexUrl(base, capexCode)}/machines`;
