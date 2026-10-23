-- Custom SQL migration file, put your code below! --
-- Share views, delivery 9, Arche K-07 (REQUESTS.md entry of 22 Oct 2026, R-193; docs/delivery-9/notes-share-views.md § 7):
-- pub_parc_machines + type_machine_code, livree_le, maj_le at the end of the view. Same rules as 0035_share: a column is never
-- removed, renamed or moved, new columns go at the end (CREATE OR REPLACE VIEW accepts exactly that); unqualified names
-- ("public" on PGlite, "keystone" on the shared server through search_path); WITH (security_barrier); the readers' grants are in
-- Matrix (partage/90-droits.sql), and Matrix's partage/30-keystone.sql is to be refreshed with this definition.
-- The view keeps one row per machine and fitted part; the three new columns are the machine's, identical on each of its rows, so
-- Arche's `DISTINCT number, name, project_code, site_text, type_machine_code, livree_le, maj_le` yields one row per machine.
-- maj_le = machines.updated_at, which the writers move when the machine record or its as-maintained configuration changes
-- (an intervention fitting a new revision, src/server/dal/claims.ts `completeIntervention`).
CREATE OR REPLACE VIEW pub_parc_machines WITH (security_barrier) AS
SELECT m.number,
       m.name,
       m.client_name,
       m.site_text,
       coalesce(p.code, m.project_code) AS project_code,
       m.warranty_status,
       r.part_ref,
       r.revision           AS fitted_revision,
       m.machine_type_code  AS type_machine_code,
       m.delivered_on       AS livree_le,
       m.updated_at         AS maj_le
FROM machines m
LEFT JOIN projects p ON p.id = m.project_id
LEFT JOIN machine_part_revisions r ON r.machine_id = m.id;
--> statement-breakpoint
COMMENT ON VIEW pub_parc_machines IS 'Contrat D12 v1 + type_machine_code, livree_le, maj_le (R-193, en fin de vue) : parc installé, une ligne par machine et article monté ; les colonnes ajoutées sont celles de la machine. Lecteurs : vigie_app, matrix_app, arche_app.';
