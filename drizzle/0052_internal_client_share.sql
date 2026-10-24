-- Custom SQL migration file, put your code below! --
-- R-190 (Arche K-05, REQUESTS.md entry "Rattacher les projets EPC2i au CAPEX dans pub_projets" of 22 Oct 2026, remaining part;
-- docs/delivery-9/notes-r190-internal-client.md): pub_projets + client_interne, filiale_code at the end — the project's client is
-- a group subsidiary (clients.is_internal, clients.subsidiary_code, migration 0051_internal_clients).
-- Same rules as 0035_share / 0038_share_followup: the view is a contract — the definition of 0038 is kept column for column and
-- the two new columns are appended (CREATE OR REPLACE VIEW accepts exactly that); unqualified names ("public" on PGlite,
-- "keystone" on the shared server through search_path); WITH (security_barrier); the readers' grants are in Matrix
-- (partage/90-droits.sql), and Matrix's partage/30-keystone.sql is to be refreshed with this definition.
-- client_interne is false for a project without client (never null). maj_le stays projects.updated_at: a change of the client's
-- flag moves the updated_at of every project of that client (src/server/dal/internal-client.ts).
CREATE OR REPLACE VIEW pub_projets WITH (security_barrier) AS
SELECT p.code,
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
          FROM purchase_orders po
          JOIN suppliers su ON su.id = po.supplier_id
         WHERE po.project_id = p.id AND po.status NOT IN ('draft', 'cancelled')) AS fournisseurs,
       p.updated_at         AS maj_le,
       p.capex_code,
       p.besoin_ref,
       coalesce(c.is_internal, false) AS client_interne,
       c.subsidiary_code    AS filiale_code
FROM projects p
LEFT JOIN clients c           ON c.id = p.client_id
LEFT JOIN persons pm          ON pm.id = p.pm_person_id
LEFT JOIN lifecycle_stages ls ON ls.code = p.stage
LEFT JOIN project_sites ps    ON ps.project_id = p.id;
--> statement-breakpoint
COMMENT ON VIEW pub_projets IS 'Contrat D02 v1 + capex_code, besoin_ref (R-190, en fin de vue) + client_interne, filiale_code (R-190, client interne = filiale du groupe) : tous les projets Keystone, internes compris (nature). Lecteurs : codex_app, cursus_app, vigie_app, matrix_app, arche_app, crucible_app.';
