// R-189 (Arche K-04): which schedule milestone is which CAPEX milestone of Arche's pub_jalons_projets contract. A planning
// milestone may carry one of the eight CAPEX codes (milestones.capex_milestone_code, unique per project); the view then publishes
// the BL1 date of that milestone as `reference_le` (docs/delivery-9/notes-r189-reference-dates.md).
//
// The code is set automatically from the milestone's name when the rule is unambiguous (seed, schedule import, migration
// 0056_capex_milestone_backfill), and the project's leads correct it on the Schedule screen. The patterns below are written in
// the regular-expression syntax common to JavaScript and PostgreSQL (no backslash, no look-around, no quote) because the
// backfill migration applies the very same strings with `~*` (checked by capex-milestones.test.ts).

/** Arche's eight CAPEX milestones, in contract order. */
export const CAPEX_MILESTONE_CODES = ['commande', 'fin_etudes', 'fat', 'expedition', 'arrivee_site', 'sat', 'pv_reception', 'fin_garantie'] as const;
export type CapexMilestoneCode = (typeof CAPEX_MILESTONE_CODES)[number];

/** Labels (EN source strings, translated through t()). */
export const CAPEX_MILESTONE_LABELS: Record<CapexMilestoneCode, string> = {
  commande: 'Order',
  fin_etudes: 'End of engineering',
  fat: 'FAT',
  expedition: 'Shipment',
  arrivee_site: 'Arrival on site',
  sat: 'SAT',
  pv_reception: 'Acceptance certificate',
  fin_garantie: 'End of warranty',
};

/** Label of "no CAPEX code" (select option, audit trail). */
export const NO_CAPEX_MILESTONE = 'Not a CAPEX milestone';

export const isCapexMilestoneCode = (v: unknown): v is CapexMilestoneCode => typeof v === 'string' && (CAPEX_MILESTONE_CODES as readonly string[]).includes(v);

// Word boundaries that work alike in both engines (JavaScript's \b ignores accented letters; PostgreSQL has no \b).
const B = '(^|[^a-z0-9])';
const E = '([^a-z0-9]|$)';
const word = (alternatives: string) => `${B}(${alternatives})${E}`;

/**
 * Name patterns, matched case-insensitively against the milestone's name (French and English). A generic word (an order, a
 * delivery) only counts as the whole name; "PV" only as a "PV de réception" (a photovoltaic "PV modules" is not one).
 */
export const CAPEX_MILESTONE_PATTERNS: Record<CapexMilestoneCode, string> = {
  commande:
    `^ *(commande|order|purchase order|po)( (client|ferme|re[cç]ue|sign[eé]e|received|signed|placed)){0,2} *$|` +
    word('contract (signed|signature|award|awarded)|signature (du |of )?(contrat|contract)|notification (du )?march[eé]|kick[ -]?off|notice to proceed'),
  fin_etudes: word(
    'fin (des |d.)?[eé]tudes|[eé]tudes termin[eé]es|design (complete|completed|freeze|frozen|approved)|engineering (complete|completed|freeze|frozen)|' +
      'gel (de la )?conception|conception termin[eé]e|bon pour ex[eé]cution|issued for construction',
  ),
  fat: word('fat|factory acceptance|essais? (en )?usine|r[eé]ception (en )?usine'),
  expedition: word('exp[eé]dition|shipment|shipping|shipped|dispatch|dispatched|d[eé]part usine|ex[ -]?works'),
  arrivee_site: word(
    'arriv[eé]e (sur |au |du mat[eé]riel sur )?(site|chantier)|site arrival|arrival (on|at) site|delivered (to|on) site|delivery (to|on|at) site|' +
      'livraison (sur |au )?(site|chantier)|on[ -]site delivery',
  ),
  sat: word('sat|site acceptance|commissioning|mise en service|essais (sur site|de mise en service)'),
  pv_reception: `^ *pv *$|` + word(
    'pv (de |d.)?r[eé]ception|proc[eè]s[ -]verbal|r[eé]ception provisoire|r[eé]ception client|handover|hand[ -]over|taking[ -]over|' +
      'provisional acceptance|customer acceptance|client acceptance|remise (au client|de l.ouvrage)',
  ),
  fin_garantie: word(
    'fin (de |de la |d.)?garantie|warranty (end|ends|expiry|expiration|expires)|end of (the )?warranty|r[eé]ception d[eé]finitive|final acceptance|' +
      'defects liability|dlp',
  ),
};

const COMPILED = CAPEX_MILESTONE_CODES.map((code) => [code, new RegExp(CAPEX_MILESTONE_PATTERNS[code], 'i')] as const);

/** The CAPEX codes a milestone name matches (none, one, or several when the name is ambiguous). */
export function capexCodesOfName(name: string): CapexMilestoneCode[] {
  return COMPILED.filter(([, re]) => re.test(name)).map(([code]) => code);
}

export interface TaggableMilestone {
  id: string;
  name: string;
  capexCode: CapexMilestoneCode | null;
}

/**
 * The automatic mapping rule (R-189), for the milestones of ONE project: a milestone without a code takes code C when its name
 * matches C and no other code, no other untagged milestone of the project matches only C, and no milestone of the project
 * already carries C. Anything ambiguous stays untagged for the project's leads. Returns milestone id → code for the ones to tag.
 */
export function autoCapexMilestoneCodes(miles: readonly TaggableMilestone[]): Map<string, CapexMilestoneCode> {
  const taken = new Set(miles.map((m) => m.capexCode).filter((c): c is CapexMilestoneCode => !!c));
  const single = miles.flatMap((m) => {
    if (m.capexCode) return [];
    const codes = capexCodesOfName(m.name);
    return codes.length === 1 ? [{ id: m.id, code: codes[0] }] : [];
  });
  const out = new Map<string, CapexMilestoneCode>();
  for (const s of single) if (!taken.has(s.code) && single.filter((o) => o.code === s.code).length === 1) out.set(s.id, s.code);
  return out;
}

export type CapexMilestoneParse = { ok: true; value: CapexMilestoneCode | null } | { ok: false; error: string };

/** The code chosen on the Schedule screen: '' clears; anything else must be one of the eight codes. */
export function parseCapexMilestoneCode(v: unknown): CapexMilestoneParse {
  if (v === '' || v == null) return { ok: true, value: null };
  return isCapexMilestoneCode(v) ? { ok: true, value: v } : { ok: false, error: 'Invalid request' };
}
