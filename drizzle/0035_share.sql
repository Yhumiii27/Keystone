-- Custom SQL migration file, put your code below! --
-- Share views of the EPC2I data sharing convention (Matrix: infra/postgres/partage/30-keystone.sql, decisions D02-D05, D12,
-- D13, D16, D18; plan docs/architecture-postgres.md § 4.9). The prerequisite columns and indexes are in 0034_share_prerequisites
-- (declared in the Drizzle schema). Each pub_ view is a contract read by the other tools: a column is never removed nor renamed
-- (a change goes to a new pub_<name>_v2 view), new columns go at the end. The definitions are those of 30-keystone.sql without
-- the schema prefix: unqualified names resolve in "public" on PGlite and in "keystone" on the shared server (search_path), so
-- replaying 30-keystone.sql on the server changes nothing. The readers' grants are not here: partage/90-droits.sql (Matrix).
-- No rate, cost or supplier price column is published (open question P-05). Column-by-column readers: 30-keystone.sql.
-- A later migration that drops or retypes a column read here must first CREATE OR REPLACE (or drop and recreate) the view:
-- PostgreSQL refuses "cannot drop column … because other objects depend on it".
--
-- D17: ISO code of the countries already in the database (the seeds write it for a new one).
UPDATE "countries" AS c SET "iso2" = v.iso2
FROM (VALUES ('France', 'FR'), ('United Kingdom', 'GB'), ('Netherlands', 'NL'), ('Germany', 'DE'), ('Belgium', 'BE'),
             ('Spain', 'ES'), ('Italy', 'IT'), ('Canada', 'CA'), ('United States', 'US'), ('Morocco', 'MA'),
             ('Côte d’Ivoire', 'CI'), ('Senegal', 'SN'), ('Kenya', 'KE'), ('South Africa', 'ZA'), ('Egypt', 'EG'),
             ('Australia', 'AU'), ('Malaysia', 'MY'), ('Singapore', 'SG'), ('Indonesia', 'ID'), ('Vietnam', 'VN'),
             ('Japan', 'JP'), ('India', 'IN'), ('Ghana', 'GH'), ('Brazil', 'BR'), ('Saudi Arabia', 'SA')) AS v(name, iso2)
WHERE c."name" = v.name AND c."iso2" IS NULL;
--> statement-breakpoint
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
       p.updated_at         AS maj_le
FROM projects p
LEFT JOIN clients c           ON c.id = p.client_id
LEFT JOIN persons pm          ON pm.id = p.pm_person_id
LEFT JOIN lifecycle_stages ls ON ls.code = p.stage
LEFT JOIN project_sites ps    ON ps.project_id = p.id;
--> statement-breakpoint
COMMENT ON VIEW pub_projets IS 'Contrat D02 v1 : tous les projets Keystone, internes compris (nature). Lecteurs : codex_app, cursus_app, vigie_app, matrix_app.';
--> statement-breakpoint
CREATE OR REPLACE VIEW pub_chantiers WITH (security_barrier) AS
SELECT p.code               AS projet_code,
       p.name               AS projet_nom,
       c.name               AS client,
       s.site_name          AS lieu,
       ps.city              AS ville,
       s.country            AS pays,
       co.iso2              AS pays_iso2,
       s.start_on           AS debut,
       s.end_on             AS fin,
       pm.matricule         AS chef_projet_matricule,
       coalesce(pm.full_name, pm.short_name) AS chef_projet_nom,
       s.updated_at         AS maj_le
FROM site_sheets s
JOIN projects p            ON p.id = s.project_id
LEFT JOIN clients c        ON c.id = p.client_id
LEFT JOIN persons pm       ON pm.id = p.pm_person_id
LEFT JOIN project_sites ps ON ps.project_id = p.id
LEFT JOIN countries co     ON co.name = s.country;
--> statement-breakpoint
COMMENT ON VIEW pub_chantiers IS 'Contrat D03 v1 : une ligne par fiche chantier. Les exigences (habilitations, certifications) restent dans cursus.chantiers. Lecteurs : cursus_app, matrix_app.';
--> statement-breakpoint
CREATE OR REPLACE VIEW pub_affectations WITH (security_barrier) AS
SELECT 'rotation'::text      AS source,
       r.id                  AS affectation_id,
       pe.matricule,
       coalesce(pe.full_name, r.person_name) AS personne_nom,
       p.code                AS projet_code,
       p.name                AS projet_nom,
       c.name                AS client,
       NULL::text            AS activite_code,
       r.role_on_site        AS activite,
       r.from_on             AS du,
       r.to_on               AS au,
       coalesce(s.site_name, ps.city) AS lieu,
       coalesce(s.country, ps.country_name) AS pays,
       co.iso2               AS pays_iso2,
       NULL::numeric         AS heures_prevues
FROM site_rotations r
JOIN projects p            ON p.id = r.project_id
JOIN persons pe            ON pe.id = r.person_id
LEFT JOIN clients c        ON c.id = p.client_id
LEFT JOIN site_sheets s    ON s.project_id = r.project_id
LEFT JOIN project_sites ps ON ps.project_id = r.project_id
LEFT JOIN countries co     ON co.name = coalesce(s.country, ps.country_name)
WHERE pe.matricule IS NOT NULL
UNION ALL
SELECT 'planning', aa.id, pe.matricule, coalesce(pe.full_name, pe.short_name), p.code, p.name, c.name,
       a.code, a.name,
       coalesce(a.start_date, a.early_start_date), coalesce(a.finish_date, a.early_finish_date),
       ps.city, ps.country_name, co.iso2, aa.planned_hours
FROM activity_assignments aa
JOIN activities a          ON a.id = aa.activity_id
JOIN projects p            ON p.id = a.project_id
JOIN persons pe            ON pe.id = aa.person_id
LEFT JOIN clients c        ON c.id = p.client_id
LEFT JOIN project_sites ps ON ps.project_id = p.id
LEFT JOIN countries co     ON co.name = ps.country_name
WHERE pe.matricule IS NOT NULL
  AND coalesce(a.start_date, a.early_start_date) IS NOT NULL
  AND coalesce(a.finish_date, a.early_finish_date) IS NOT NULL;
--> statement-breakpoint
COMMENT ON VIEW pub_affectations IS 'Contrat D04 v1 : rotations de chantier et affectations du planning des salariés (matricule renseigné). Les lecteurs filtrent sur au >= current_date. Lecteurs : cursus_app, vigie_app, matrix_app.';
--> statement-breakpoint
CREATE OR REPLACE VIEW pub_taches_jours WITH (security_barrier) AS
SELECT t.number              AS tache_numero,
       pe.matricule,
       p.code                AS projet_code,
       p.name                AS projet_nom,
       p.kind                AS projet_nature,
       a.code                AS activite_code,
       t.title               AS titre,
       t.status              AS statut,
       g.jour::date          AS jour,
       date_trunc('week', g.jour)::date AS semaine,
       round(t.estimate_h / nullif(n.jours, 0), 2) AS heures_prevues
FROM tasks t
JOIN projects p   ON p.id = t.project_id
JOIN persons pe   ON pe.id = t.assignee_person_id
LEFT JOIN activities a ON a.id = t.activity_id
CROSS JOIN LATERAL (
  SELECT count(*) AS jours
  FROM generate_series(t.start_date, t.due_date, interval '1 day') AS d(x)
  WHERE extract(isodow FROM d.x) < 6
) n
CROSS JOIN LATERAL generate_series(t.start_date, t.due_date, interval '1 day') AS g(jour)
WHERE pe.matricule IS NOT NULL
  AND extract(isodow FROM g.jour) < 6;
--> statement-breakpoint
COMMENT ON VIEW pub_taches_jours IS 'Contrat D05 v1 : une ligne par tâche et jour ouvré, salariés seulement. Lecture : WHERE matricule = $1 AND semaine = $2. Lecteurs : cursus_app, matrix_app.';
--> statement-breakpoint
CREATE OR REPLACE VIEW pub_fournisseurs WITH (security_barrier) AS
SELECT s.id,
       s.name,
       s.x3_code,
       s.is_internal
FROM suppliers s;
--> statement-breakpoint
COMMENT ON VIEW pub_fournisseurs IS 'Contrat D16 v1 : fournisseurs Keystone (sans les indicateurs de performance). Lecteurs : vigie_app, matrix_app.';
--> statement-breakpoint
CREATE OR REPLACE VIEW pub_clients WITH (security_barrier) AS
SELECT c.id,
       c.name,
       c.code3
FROM clients c;
--> statement-breakpoint
COMMENT ON VIEW pub_clients IS 'Contrat D16 v1 : clients Keystone. Lecteurs : codex_app, cursus_app, vigie_app, matrix_app.';
--> statement-breakpoint
CREATE OR REPLACE VIEW pub_articles WITH (security_barrier) AS
SELECT pa.ref,
       pa.name,
       pa.revision,
       pa.status,
       pa.part_type,
       pa.make_buy
FROM parts pa;
--> statement-breakpoint
COMMENT ON VIEW pub_articles IS 'Contrat D12 v1 : articles (sans prix, fabricant ni contrôle export). Lecteurs : vigie_app, matrix_app.';
--> statement-breakpoint
CREATE OR REPLACE VIEW pub_nomenclatures WITH (security_barrier) AS
SELECT p.code             AS project_code,
       p.stage,
       pa.ref             AS part_ref,
       sum(b.quantity)    AS quantity
FROM project_bom_lines b
JOIN projects p ON p.id = b.project_id
JOIN parts pa   ON pa.id = b.part_id
GROUP BY p.code, p.stage, pa.ref;
--> statement-breakpoint
COMMENT ON VIEW pub_nomenclatures IS 'Contrat D12 v1 : cas d''emploi des articles par projet. Lecteurs : vigie_app, matrix_app.';
--> statement-breakpoint
CREATE OR REPLACE VIEW pub_parc_machines WITH (security_barrier) AS
SELECT m.number,
       m.name,
       m.client_name,
       m.site_text,
       coalesce(p.code, m.project_code) AS project_code,
       m.warranty_status,
       r.part_ref,
       r.revision         AS fitted_revision
FROM machines m
LEFT JOIN projects p ON p.id = m.project_id
LEFT JOIN machine_part_revisions r ON r.machine_id = m.id;
--> statement-breakpoint
COMMENT ON VIEW pub_parc_machines IS 'Contrat D12 v1 : parc installé, une ligne par machine et article monté. Lecteurs : vigie_app, matrix_app.';
--> statement-breakpoint
CREATE OR REPLACE VIEW pub_activites WITH (security_barrier) AS
SELECT p.code   AS project_code,
       a.code,
       a.name
FROM activities a
JOIN projects p ON p.id = a.project_id;
--> statement-breakpoint
COMMENT ON VIEW pub_activites IS 'Contrat D13 v1 : activités du planning, pour la fiche NC. Lecteurs : vigie_app, matrix_app.';
--> statement-breakpoint
CREATE OR REPLACE VIEW pub_livrables WITH (security_barrier) AS
SELECT p.code   AS project_code,
       d.number,
       d.title,
       d.status
FROM deliverables d
JOIN projects p ON p.id = d.project_id;
--> statement-breakpoint
COMMENT ON VIEW pub_livrables IS 'Contrat D13 v1 : livrables contractuels, pour la fiche NC. Lecteurs : vigie_app, matrix_app.';
--> statement-breakpoint
CREATE OR REPLACE VIEW pub_journal WITH (security_barrier) AS
SELECT 'audit_entries:' || a.id::text AS ref_source,
       'audit'::text           AS nature,
       a.occurred_at           AS quand,
       a.actor_name            AS qui,
       a.actor_person_id::text AS qui_ref,
       NULL::text              AS qui_role,
       a.area                  AS action,
       a.object_ref            AS objet,
       a.change                AS detail,
       p.code                  AS projet,
       pe.matricule            AS qui_matricule
FROM audit_entries a
LEFT JOIN projects p ON p.id = a.project_id
LEFT JOIN persons pe ON pe.id = a.actor_person_id
UNION ALL
SELECT 'activity_events:' || e.id::text, 'activite', e.occurred_at, e.actor_name, e.actor_person_id::text, NULL,
       'activity.' || e.kind, NULL, e.text, p.code, pe.matricule
FROM activity_events e
LEFT JOIN projects p ON p.id = e.project_id
LEFT JOIN persons pe ON pe.id = e.actor_person_id;
--> statement-breakpoint
COMMENT ON VIEW pub_journal IS 'Contrat D18 v1 : journal d''audit et fil d''activité de Keystone aux colonnes communes. Lecteur : matrix_app (matrix.journal_unifie).';
