// R-190 (Arche K-05): a project's link to the subsidiary CAPEX it delivers — the CAPEX code and the first machine need at its
// origin, in Arche's formats (Arche decision N-9: CAPEX "CPX-<subsidiary>-<year>-<nn>", need "<CAPEX code>/B<nn>"). Pure rules
// of the Contract screen's "CAPEX link" card; the database checks the same formats (projects_capex_code_check,
// projects_besoin_ref_check). A cross-application reference: typed by the project's leads, published in pub_projets, never
// resolved against Arche here (Keystone does not read Arche's views yet — R-187).

export const CAPEX_CODE_RE = /^CPX-[A-Z]{3}-\d{4}-\d{2,}$/;
export const NEED_REF_RE = /^CPX-[A-Z]{3}-\d{4}-\d{2,}\/B\d{2,}$/;

export interface CapexLink {
  capexCode: string | null;
  needRef: string | null;
}

export type CapexLinkParse = { ok: true; value: CapexLink } | { ok: false; error: string };

/** What was typed, trimmed and upper-cased; '' → null. */
const clean = (v: unknown): string | null | undefined => {
  if (v == null) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toUpperCase();
  return s ? s : null;
};

/**
 * The CAPEX code and need reference as typed (EN error messages, translated by the caller). Empty clears; a need reference
 * needs the CAPEX code and must be one of its needs.
 */
export function parseCapexLink(input: { capexCode?: unknown; needRef?: unknown }): CapexLinkParse {
  const capexCode = clean(input.capexCode);
  const needRef = clean(input.needRef);
  if (capexCode === undefined || needRef === undefined) return { ok: false, error: 'Invalid request' };
  if (capexCode && (capexCode.length > 40 || !CAPEX_CODE_RE.test(capexCode))) return { ok: false, error: 'Enter a CAPEX code like CPX-SAI-2026-01' };
  if (needRef) {
    if (!capexCode) return { ok: false, error: 'Enter the CAPEX code first' };
    if (needRef.length > 50 || !NEED_REF_RE.test(needRef)) return { ok: false, error: 'Enter a need reference like CPX-SAI-2026-01/B01' };
    if (!needRef.startsWith(`${capexCode}/`)) return { ok: false, error: 'The need belongs to another CAPEX' };
  }
  return { ok: true, value: { capexCode, needRef } };
}
