// Reference queries of Keystone's publications asked of Matrix after M-18 (Matrix defines and applies every `pub_` view; no
// Keystone migration creates one — src/server/db/pub-views-owned-by-matrix.test.ts). Each query is written once here, run on a
// migrated, seeded database by src/server/publications/definitions.test.ts, and copied by Matrix into its deposit
// (data/publications-depot.json) with `schema = 'keystone.'`. A published column is never removed or renamed; new ones at the end.
//
// ING-29 (owner, 27 Nov 2026; docs/delivery-9/notes-confidentiality.md):
// - pub_projets: the definition of 0071_project_category_share, column for column, plus `confidentialite` at the end
//   ('normal' | 'confidentiel') — « c'est Keystone qui donnera le niveau de confidentialité à Ingenium et aux autres softs ».
// - pub_equipes_projets (new): who is on each project's team — the named team (R-041, origin 'equipe'), the people assigned to
//   its tasks or named on its planning activities ('affectation'), its stakeholders who are internal persons ('partie_prenante').
//   Confidential projects included: the readers filter on membership (a confidential project is shown only to its team).
//   Internal directory data only (matricule, name, professional e-mail, Clavis person id); never an external contact.

/** `schema` = '' (PGlite tests, search_path) or 'keystone.' (the shared server, Matrix's deposit). */
export function pubProjetsDefinition(schema = ''): string {
  const s = schema;
  return `SELECT p.code,
       p.number             AS numero,
       p.analytic_code      AS code_analytique,
       p.kind               AS nature,
       p.name               AS nom,
       p.client_id,
       c.name               AS client,
       c.code3              AS client_code3,
       p.stage              AS phase_code,
       ls.label             AS phase,
       (p.stage NOT IN ('clos', 'annule')) AS imputable,
       pm.matricule         AS chef_projet_matricule,
       coalesce(pm.full_name, pm.short_name) AS chef_projet_nom,
       ps.city              AS ville,
       ps.country_name      AS pays,
       (SELECT string_agg(DISTINCT su.name, ' · ' ORDER BY su.name)
          FROM ${s}purchase_orders po
          JOIN ${s}suppliers su ON su.id = po.supplier_id
         WHERE po.project_id = p.id AND po.status NOT IN ('draft', 'cancelled')) AS fournisseurs,
       p.updated_at         AS maj_le,
       p.capex_code,
       p.besoin_ref,
       coalesce(c.is_internal, false) AS client_interne,
       c.subsidiary_code    AS filiale_code,
       p.category           AS categorie,
       (CASE p.confidentiality WHEN 'confidential' THEN 'confidentiel' ELSE 'normal' END)::text AS confidentialite
FROM ${s}projects p
LEFT JOIN ${s}clients c           ON c.id = p.client_id
LEFT JOIN ${s}persons pm          ON pm.id = p.pm_person_id
LEFT JOIN ${s}lifecycle_stages ls ON ls.code = p.stage
LEFT JOIN ${s}project_sites ps    ON ps.project_id = p.id`;
}

/** Columns of pub_projets, in order (0071's + confidentialite). */
export const PUB_PROJETS_COLUMNS = [
  'code', 'numero', 'code_analytique', 'nature', 'nom', 'client_id', 'client', 'client_code3', 'phase_code', 'phase', 'imputable', 'chef_projet_matricule',
  'chef_projet_nom', 'ville', 'pays', 'fournisseurs', 'maj_le', 'capex_code', 'besoin_ref', 'client_interne', 'filiale_code', 'categorie', 'confidentialite',
] as const;

export function pubEquipesProjetsDefinition(schema = ''): string {
  const s = schema;
  return `SELECT p.code                                AS projet_code,
       pe.matricule,
       coalesce(pe.full_name, pe.short_name) AS personne_nom,
       pe.email,
       e.origine,
       e.activite,
       u.entra_object_id                     AS personne_clavis_id,
       e.role,
       max(e.maj_le)                         AS maj_le
FROM (SELECT p0.id AS project_id, p0.pm_person_id AS person_id, 'equipe'::text AS origine, NULL::text AS activite, 'pm'::text AS role, p0.updated_at AS maj_le
        FROM ${s}projects p0
       WHERE p0.pm_person_id IS NOT NULL
      UNION ALL
      SELECT m.project_id, m.person_id, 'equipe', NULL, m.project_role, p1.updated_at
        FROM ${s}project_members m
        JOIN ${s}projects p1 ON p1.id = m.project_id
      UNION ALL
      SELECT t.project_id, t.assignee_person_id, 'affectation', coalesce(a.name, t.title), NULL, t.updated_at
        FROM ${s}tasks t
        LEFT JOIN ${s}activities a ON a.id = t.activity_id
       WHERE t.assignee_person_id IS NOT NULL
      UNION ALL
      SELECT a2.project_id, aa.person_id, 'affectation', a2.name, NULL, p2.updated_at
        FROM ${s}activity_assignments aa
        JOIN ${s}activities a2 ON a2.id = aa.activity_id
        JOIN ${s}projects p2   ON p2.id = a2.project_id
       WHERE aa.person_id IS NOT NULL
      UNION ALL
      SELECT st.project_id, st.person_id, 'partie_prenante', NULL, st.role, st.updated_at
        FROM ${s}stakeholders st
       WHERE st.person_id IS NOT NULL) e
JOIN ${s}projects p   ON p.id = e.project_id
JOIN ${s}persons pe   ON pe.id = e.person_id
LEFT JOIN ${s}users u ON u.person_id = pe.id
WHERE pe.client_id IS NULL
  AND NOT pe.is_contract_role
GROUP BY p.code, pe.id, pe.matricule, pe.full_name, pe.short_name, pe.email, e.origine, e.activite, u.entra_object_id, e.role`;
}

/** Columns of pub_equipes_projets, in order. */
export const PUB_EQUIPES_PROJETS_COLUMNS = [
  'projet_code', 'matricule', 'personne_nom', 'email', 'origine', 'activite', 'personne_clavis_id', 'role', 'maj_le',
] as const;

/** Readers to grant (Matrix links, `lecture`). */
export const PUBLICATION_READERS = {
  pub_projets: ['codex_app', 'cursus_app', 'vigie_app', 'matrix_app', 'arche_app', 'crucible_app', 'ingenium_app', 'vector_app', 'modulus_app'],
  pub_equipes_projets: ['ingenium_app', 'codex_app', 'crucible_app', 'vigie_app', 'arche_app', 'vector_app', 'modulus_app', 'matrix_app'],
} as const;
