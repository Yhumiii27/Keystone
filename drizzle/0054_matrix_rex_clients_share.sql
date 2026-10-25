-- Custom SQL migration file, put your code below! --
-- Matrix D22 and D21 (REQUESTS.md entries "Publier les leçons apprises des projets (vue pub_rex, D22)" and "Relier les clients
-- filiales au code de la filiale de Matrix (D21)" of 23 Oct 2026, approved by the owner on 25 Oct 2026;
-- docs/delivery-9/notes-matrix-d21-d22.md).
-- Same rules as 0035_share / 0038_share_followup / 0052_internal_client_share: a view is a contract — a column is never removed,
-- renamed or moved, new columns go at the end (CREATE OR REPLACE VIEW accepts exactly that); unqualified names ("public" on
-- PGlite, "keystone" on the shared server through search_path); WITH (security_barrier); the readers' grants are in Matrix
-- (partage/90-droits.sql), and Matrix's partage/30-keystone.sql is to be refreshed with these definitions.
--
-- pub_rex (D22): the projects' lessons learned at Matrix's common REX contract (the same 15 columns as arche.pub_rex_v2, read by
-- matrix.rex_unifie, partage/96-matrix-rex-unifie.sql). Only the lessons validated or applied are published: a "proposed" lesson
-- is still to be validated by the project (as Arche publishes only its published REX entries). titre: the table has no title —
-- the number and the start of the finding (80 characters at most, spaces collapsed). categorie = the theme code (engineering,
-- procurement, site, client, planning, quality, hse), statut = the status code (validated, applied). Personal data: the author's
-- name only. maj_le = lessons_learned.updated_at (index lessons_learned_updated_at_idx, 0053, K-11), moved by every status change.
CREATE OR REPLACE VIEW pub_rex WITH (security_barrier) AS
SELECT 'lessons_learned:' || l.id::text AS ref_source,
       'keystone'::text                 AS outil,
       p.code                           AS projet_code,
       p.capex_code,
       l.number                         AS numero,
       l.theme                          AS categorie,
       l.number || ' · ' || CASE
         WHEN char_length(regexp_replace(btrim(l.what_happened), '\s+', ' ', 'g')) <= 80 THEN regexp_replace(btrim(l.what_happened), '\s+', ' ', 'g')
         ELSE left(regexp_replace(btrim(l.what_happened), '\s+', ' ', 'g'), 79) || '…'
       END                              AS titre,
       l.what_happened                  AS constat,
       l.impact,
       l.recommendation                 AS recommandation,
       l.applies_to                     AS portee,
       l.status                         AS statut,
       l.raised_by_name                 AS auteur,
       l.created_at                     AS cree_le,
       l.updated_at                     AS maj_le
FROM lessons_learned l
JOIN projects p ON p.id = l.project_id
WHERE l.status IN ('validated', 'applied');
--> statement-breakpoint
COMMENT ON VIEW pub_rex IS 'Contrat commun du REX de Matrix (D22) : leçons apprises des projets EPC2i, validées ou appliquées (une leçon proposée n''est pas publiée), mêmes colonnes que arche.pub_rex_v2. Lecteurs : matrix_app.';
--> statement-breakpoint
-- pub_clients (D21): D16 v1 (0035_share, kept column for column) + filiale_code at the end — the group subsidiary's code as
-- Matrix publishes it (matrix.pub_filiales.code) for an internal client (clients.subsidiary_code, 0051_internal_clients; only on
-- an internal client, database check clients_subsidiary_internal_check), null for an external client. An internal client's
-- code3 is its subsidiary's code (src/server/dal/internal-client.ts).
CREATE OR REPLACE VIEW pub_clients WITH (security_barrier) AS
SELECT c.id,
       c.name,
       c.code3,
       c.subsidiary_code AS filiale_code
FROM clients c;
--> statement-breakpoint
COMMENT ON VIEW pub_clients IS 'Contrat D16 v1 + filiale_code (D21, en fin de vue : code de la filiale de Matrix pour un client interne, vide pour un client extérieur) : clients Keystone. Lecteurs : codex_app, cursus_app, vigie_app, matrix_app.';
