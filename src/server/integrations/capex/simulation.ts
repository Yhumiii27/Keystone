// Simulated source of the capex connector (R-187): what Arche's views arche.pub_capex and arche.pub_besoins_machines would return
// on its demo data set (Arche src/server/db/seed/demo.ts `DEMO_CAPEX` and `seedNeeds`: CPX-APM-2026-01 "Second extrusion line" at
// Kénitra, after G1; CPX-SAI-2026-01 "New tomato processing plant" at Thiès, after G2; CPX-APM-2026-02 is a draft in Arche, never
// published). K-14 (Arche's request of 30 Oct 2026, approved 2 Nov 2026): Arche's three other demo CAPEX — CPX-APM-2025-01
// "Ageing oven and finishing line" at Kénitra, in its start-up phase (commissioning started on 1 Jul 2026), CPX-SAI-2026-02
// "Aseptic packaging line" at Kaolack (phase 1, framing) and CPX-SAI-2026-03 "Solar power plant for the Thiès site" (phase 2,
// after its G1 of 24 Sep 2026) — and the ageing oven need CPX-APM-2025-01/B01 (free label, ordered at the G2 of 15 Sep 2025,
// delivered by the demo project APM-008: src/server/db/seed/capex-k14.ts). The needs follow Arche's contract (docs/CONTRATS.md
// § 3) and choose Keystone's demo catalogue (EMP-40T v1, MEMU-16 v1, SPUR-2X v1 retired — src/server/db/seed/machine-catalogue.ts).
// `devise` (AR-039, added at the end of pub_capex on 29 Oct 2026) is the subsidiary's currency; Keystone's parsing ignores it.
// Rows use the views' column names, so the simulation goes through the same parsing as a real read. Used on a demo database only
// (ARCHE_SOURCE=simulation; a production database never receives it) and by the demo seed.

type Row = Record<string, unknown>;

export const SIMULATED_PUB_CAPEX: readonly Row[] = [
  {
    code: 'CPX-APM-2026-01', filiale_code: 'APM', filiale: 'Atlas Process Maroc', zone: 'AFN', site: 'Kénitra plant', pays_iso2: 'MA',
    intitule: 'Second extrusion line', type_investissement: 'new_line', statut: 'active', phase_code: 'avant_projet', typologie: 'light',
    sponsor_nom: 'Karim Benali', sponsor_email: 'k.benali@atlas-process.example', chef_projet_nom: 'Leïla Haddad', chef_projet_email: 'l.haddad@atlas-process.example',
    g1_le: '2026-05-12', g2_le: null, g3_le: null, debut_mes_le: null, maj_le: '2026-09-18T08:30:00Z', devise: 'MAD',
  },
  {
    code: 'CPX-SAI-2026-01', filiale_code: 'SAI', filiale: 'Sahel Agro Industries', zone: 'AFO', site: 'Thiès site', pays_iso2: 'SN',
    intitule: 'New tomato processing plant', type_investissement: 'new_plant', statut: 'active', phase_code: 'execution', typologie: 'strategic',
    sponsor_nom: 'Moussa Ndiaye', sponsor_email: 'm.ndiaye@sahel-agro.example', chef_projet_nom: 'Fatou Sarr', chef_projet_email: 'f.sarr@sahel-agro.example',
    g1_le: '2026-01-20', g2_le: '2026-07-08', g3_le: null, debut_mes_le: null, maj_le: '2026-07-08T15:00:00Z', devise: 'XOF',
  },
  // K-14: start-up phase — G1, G2 (the oven ordered), K3 (ready to start, not a G gate: no column), commissioning since 1 Jul 2026.
  {
    code: 'CPX-APM-2025-01', filiale_code: 'APM', filiale: 'Atlas Process Maroc', zone: 'AFN', site: 'Kénitra plant', pays_iso2: 'MA',
    intitule: 'Ageing oven and finishing line', type_investissement: 'new_line', statut: 'active', phase_code: 'demarrage', typologie: 'light',
    sponsor_nom: 'Karim Benali', sponsor_email: 'k.benali@atlas-process.example', chef_projet_nom: 'Leïla Haddad', chef_projet_email: 'l.haddad@atlas-process.example',
    g1_le: '2025-05-20', g2_le: '2025-09-15', g3_le: null, debut_mes_le: '2026-07-01', maj_le: '2026-07-01T10:00:00Z', devise: 'MAD',
  },
  // K-14: phase 1 (framing), its G1 still to come; no machine need published yet.
  {
    code: 'CPX-SAI-2026-02', filiale_code: 'SAI', filiale: 'Sahel Agro Industries', zone: 'AFO', site: 'Kaolack plant', pays_iso2: 'SN',
    intitule: 'Aseptic packaging line', type_investissement: 'new_line', statut: 'active', phase_code: 'cadrage', typologie: 'light',
    sponsor_nom: 'Moussa Ndiaye', sponsor_email: 'm.ndiaye@sahel-agro.example', chef_projet_nom: 'Fatou Sarr', chef_projet_email: 'f.sarr@sahel-agro.example',
    g1_le: null, g2_le: null, g3_le: null, debut_mes_le: null, maj_le: '2026-08-17T10:00:00Z', devise: 'XOF',
  },
  // K-14: phase 2 (preliminary design) after the G1 of 24 Sep 2026; no machine need (panels and inverters are not EPC2i's).
  {
    code: 'CPX-SAI-2026-03', filiale_code: 'SAI', filiale: 'Sahel Agro Industries', zone: 'AFO', site: 'Thiès site', pays_iso2: 'SN',
    intitule: 'Solar power plant for the Thiès site', type_investissement: 'other', statut: 'active', phase_code: 'avant_projet', typologie: 'light',
    sponsor_nom: 'Moussa Ndiaye', sponsor_email: 'm.ndiaye@sahel-agro.example', chef_projet_nom: 'Fatou Sarr', chef_projet_email: 'f.sarr@sahel-agro.example',
    g1_le: '2026-09-24', g2_le: null, g3_le: null, debut_mes_le: null, maj_le: '2026-09-24T10:00:00Z', devise: 'XOF',
  },
];

export const SIMULATED_PUB_BESOINS_MACHINES: readonly Row[] = [
  // Submitted after G1: answered with an indicative price (E50), then a budgetary quote (E30).
  {
    besoin_ref: 'CPX-APM-2026-01/B01', capex_code: 'CPX-APM-2026-01', ligne: 'B01', catalogue_code: 'EMP-40T', catalogue_version: 1, libelle_libre: null,
    quantite: 1, options: ['TELE'], capacite_visee: 40, unite_capacite: 't', date_besoin: '2027-09-01', site: 'Kénitra plant', statut: 'submitted',
    commentaire: 'Portique de manutention des filières, hall extrusion', soumis_le: '2026-09-01T09:00:00Z', commande_le: null, maj_le: '2026-09-01T09:00:00Z',
  },
  // Submitted, free need (no catalogue entry): waiting for Keystone's answer.
  {
    besoin_ref: 'CPX-APM-2026-01/B02', capex_code: 'CPX-APM-2026-01', ligne: 'B02', catalogue_code: null, catalogue_version: null,
    libelle_libre: 'Ligne de refroidissement en ligne des profilés', quantite: 1, options: [], capacite_visee: 1.2, unite_capacite: 't/h',
    date_besoin: '2027-09-01', site: 'Kénitra plant', statut: 'submitted', commentaire: 'Variante B retenue au COPIL du 18 sept.',
    soumis_le: '2026-09-20T10:15:00Z', commande_le: null, maj_le: '2026-09-20T10:15:00Z',
  },
  // Ordered at G2; Keystone's firm offer accepted, the project created at the order.
  {
    besoin_ref: 'CPX-SAI-2026-01/B01', capex_code: 'CPX-SAI-2026-01', ligne: 'B01', catalogue_code: 'MEMU-16', catalogue_version: 1, libelle_libre: null,
    quantite: 1, options: ['GEN'], capacite_visee: 16, unite_capacite: 't/h', date_besoin: '2027-06-01', site: 'Thiès site', statut: 'ordered',
    commentaire: null, soumis_le: '2026-06-29T08:00:00Z', commande_le: '2026-07-08', maj_le: '2026-07-08T15:00:00Z',
  },
  // Withdrawn by the subsidiary (the catalogue version was retired); Keystone had qualified it "to be studied".
  {
    besoin_ref: 'CPX-SAI-2026-01/B02', capex_code: 'CPX-SAI-2026-01', ligne: 'B02', catalogue_code: 'SPUR-2X', catalogue_version: 1, libelle_libre: null,
    quantite: 1, options: [], capacite_visee: null, unite_capacite: null, date_besoin: '2027-06-01', site: 'Thiès site', statut: 'withdrawn',
    commentaire: 'Remplacé par la station de traitement des eaux du lot utilités', soumis_le: '2026-03-10T08:00:00Z', commande_le: null, maj_le: '2026-07-30T11:00:00Z',
  },
  // Ordered at G2, firm offer accepted: the project is still to be created (or the line added) by the director.
  {
    besoin_ref: 'CPX-SAI-2026-01/B03', capex_code: 'CPX-SAI-2026-01', ligne: 'B03', catalogue_code: 'EMP-40T', catalogue_version: 1, libelle_libre: null,
    quantite: 2, options: ['TELE'], capacite_visee: 40, unite_capacite: 't', date_besoin: '2027-06-01', site: 'Thiès site', statut: 'ordered',
    commentaire: 'Portiques du hall de conditionnement', soumis_le: '2026-06-01T08:00:00Z', commande_le: '2026-07-08', maj_le: '2026-07-08T15:00:00Z',
  },
  // K-14: free need (no catalogue entry), ordered at the G2 of 15 Sep 2025; delivered by APM-008, in warranty (its machine MCH-045
  // is the one of Arche's ramp-up line "Ageing oven").
  {
    besoin_ref: 'CPX-APM-2025-01/B01', capex_code: 'CPX-APM-2025-01', ligne: 'B01', catalogue_code: null, catalogue_version: null,
    libelle_libre: 'Ageing oven 2 × 6 m', quantite: 1, options: [], capacite_visee: 2, unite_capacite: 't/h', date_besoin: '2026-07-01',
    site: 'Kénitra plant', statut: 'ordered', commentaire: null, soumis_le: '2025-06-02T10:00:00Z', commande_le: '2025-09-15', maj_le: '2025-09-15T10:00:00Z',
  },
];

/** The simulated read: both views, as `select to_jsonb(v) from arche.<view> v` would return them. */
export const simulatedArcheViews = () => ({ capex: SIMULATED_PUB_CAPEX.map((r) => ({ ...r })), needs: SIMULATED_PUB_BESOINS_MACHINES.map((r) => ({ ...r })) });
