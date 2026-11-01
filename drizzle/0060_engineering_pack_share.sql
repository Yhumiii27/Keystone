-- Custom SQL migration file, put your code below! --
-- R-191 (Arche K-08, REQUESTS.md entry of 22 Oct 2026 "Vues de suivi des projets pour les jalons CAPEX"; Arche's docs/CONTRATS.md;
-- docs/delivery-9/notes-r191-engineering-pack.md): EPC2i's share of the engineering pack, one row per project and family, read by
-- the CAPEX application for its G2 criterion "engineering pack above the threshold" (DIG-PRODI: > 80 %).
-- Same rules as 0035_share / 0038_share_followup: the view is a contract — a column is never removed, renamed or moved, new
-- columns go at the end; unqualified names ("public" on PGlite, "keystone" on the shared server through search_path);
-- WITH (security_barrier); the reader's grant (arche_app) is in Matrix (partage/90-droits.sql), and Matrix's partage/30-keystone.sql
-- is to be refreshed with this definition.
-- The rules are those of src/domain/engineering-pack.ts (`projectPackStandard`, `packCompleteness`; the DAL's card and this view
-- are compared on the demo data by engineering-pack.test.ts):
--   families   the union of the families weighed (> 0) by the types of the project's equipment lines (R-185; the project's own
--              machine type when it has no line); weight = that of the first line (by position: the main line first) whose type
--              weighs the family; minimum expected = the highest among those types. A project without a machine type has no row.
--   attendues  the project's Codex-index documents whose type maps to the family (document_types.pack_family), obsolete ones
--              excluded — and at least the minimum of the standard list;
--   validees   those of them Released (BPE);
--   poids      the family's weight (whole %);
--   pct_pondere Σ poids × validees / attendues ÷ Σ poids over the project's families with attendues > 0, × 100, rounded to 0.1;
--              0 when nothing is expected; the same value on every row of the project;
--   maj_le     the latest of the project, its equipment lines, its standard lists and its pack documents (a removed document or
--              line moves it only through the project's own updated_at).
CREATE OR REPLACE VIEW pub_pack_ingenierie WITH (security_barrier) AS
WITH lines AS (
  SELECT e.project_id, e.machine_type_code, e.position, e.updated_at
  FROM project_equipments e
  UNION ALL
  SELECT p.id, p.machine_type_code, -1, p.updated_at
  FROM projects p
  WHERE p.machine_type_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_equipments e WHERE e.project_id = p.id)
),
weighed AS (
  SELECT l.project_id, f.family, f.weight, f.min_expected, greatest(f.updated_at, l.updated_at) AS updated_at,
         row_number() OVER (PARTITION BY l.project_id, f.family ORDER BY l.position) AS rank_in_project
  FROM lines l
  JOIN machine_type_pack_families f ON f.machine_type_code = l.machine_type_code AND f.weight > 0
),
standard AS (
  SELECT project_id, family, max(weight) FILTER (WHERE rank_in_project = 1) AS weight, max(min_expected) AS min_expected,
         max(updated_at) AS updated_at
  FROM weighed
  GROUP BY project_id, family
),
docs AS (
  SELECT d.project_id, t.pack_family AS family,
         count(*) FILTER (WHERE d.status <> 'obsolete') AS indexed,
         count(*) FILTER (WHERE d.status = 'released') AS released,
         max(d.updated_at) AS updated_at
  FROM documents d
  JOIN document_types t ON t.code = d.type_code
  WHERE d.project_id IS NOT NULL AND t.pack_family IS NOT NULL
  GROUP BY d.project_id, t.pack_family
),
fam AS (
  SELECT s.project_id, s.family, s.weight,
         greatest(s.min_expected, coalesce(dc.indexed, 0))::int AS expected,
         coalesce(dc.released, 0)::int AS validated,
         greatest(s.updated_at, dc.updated_at) AS updated_at
  FROM standard s
  LEFT JOIN docs dc ON dc.project_id = s.project_id AND dc.family = s.family
)
SELECT p.code                                AS projet_code,
       r.family                              AS famille,
       r.expected                            AS attendues,
       r.validated                           AS validees,
       r.weight::numeric                     AS poids,
       coalesce(round(100 * sum(CASE WHEN r.expected > 0 THEN r.weight * r.validated::numeric / r.expected END) OVER w
                      / nullif(sum(CASE WHEN r.expected > 0 THEN r.weight END) OVER w, 0), 1), 0)::numeric AS pct_pondere,
       greatest(p.updated_at, max(r.updated_at) OVER w) AS maj_le
FROM fam r
JOIN projects p ON p.id = r.project_id
WINDOW w AS (PARTITION BY r.project_id);
--> statement-breakpoint
COMMENT ON VIEW pub_pack_ingenierie IS 'Contrat K-08 v1 (R-191) : part EPC2i du pack ingénierie, une ligne par projet et famille (pid, bom, layout, electrique, analyse_fonctionnelle) ; pièces attendues (documents de l''index Codex rattachés à la famille par leur type, hors obsolètes, au moins le minimum de la liste type) et validées (diffusées BPE), poids de la famille et % pondéré du projet (même valeur sur chaque ligne ; cible G2 > 80 %). Liste type provisoire (5 familles × 20 %) en attendant le point C-9. Lecteurs : arche_app.';
