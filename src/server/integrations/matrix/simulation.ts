// Simulated source of the subsidiaries connector (Matrix D21): what Matrix's view matrix.pub_filiales would return for the demo —
// the two fictitious subsidiaries the sibling apps' demo data sets already use (Arche src/server/db/seed/demo.ts: Atlas Process
// Maroc, APM, North Africa; Sahel Agro Industries, SAI, West Africa — the codes of the CAPEX CPX-APM-2026-01 and CPX-SAI-2026-01
// mirrored from Arche, src/server/integrations/capex/simulation.ts). Rows use the view's column names, so the simulation goes
// through the same parsing as a real read. Used on a demo database only (MATRIX_SOURCE=simulation; a production database never
// receives it) and by the demo seed.

type Row = Record<string, unknown>;

export const SIMULATED_PUB_FILIALES: readonly Row[] = [
  { code: 'APM', nom: 'Atlas Process Maroc', pays_iso2: 'MA', zone_code: 'AFN', devise: 'MAD', ordre: 1, actif: true },
  { code: 'SAI', nom: 'Sahel Agro Industries', pays_iso2: 'SN', zone_code: 'AFO', devise: 'XOF', ordre: 2, actif: true },
];

/** The simulated read, as `select to_jsonb(v) from matrix.pub_filiales v` would return it. */
export const simulatedMatrixSubsidiaries = (): Row[] => SIMULATED_PUB_FILIALES.map((r) => ({ ...r }));
