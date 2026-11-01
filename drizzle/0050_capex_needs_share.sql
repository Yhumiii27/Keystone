-- Custom SQL migration file, put your code below! --
-- R-187 (Arche K-02, K-03, K-10; REQUESTS.md entry "Catalogue machines et réponses aux besoins des filiales" of 22 Oct 2026;
-- docs/delivery-9/notes-r187-capex-needs.md): Keystone's answers to the subsidiaries' machine needs (table need_answers, migration
-- 0049) published to the CAPEX application.
-- View pub_reponses_besoins, contract K-02 column by column (Arche docs/CONTRATS.md § 2.2): one row per answer, the most recent
-- (repondu_le, then numero) is authoritative. Same rules as 0035_share / 0038_share_followup / 0046_catalogue_share: the view is a
-- contract — a column is never removed, renamed or moved, new columns go at the end; unqualified names ("public" on PGlite,
-- "keystone" on the shared server through search_path); WITH (security_barrier); the reader's grant (arche_app) is in Matrix
-- (partage/90-droits.sql), and Matrix's partage/30-keystone.sql is to be refreshed with this definition.
-- montant_bas_keur / montant_haut_keur are computed from the class when the answer is written (src/domain/estimate-class.ts
-- estimateRange: E50 ±50 %, E30 ±30 %, E10 −5 / +10 %) and stored, so a published answer never moves. projet_code = the EPC2i
-- project created (or completed) at the order (K-10), null before. maj_le = need_answers.updated_at (index
-- need_answers_updated_at_idx, K-11): moved by every write of the answer (edit, status, project at the order).
CREATE OR REPLACE VIEW pub_reponses_besoins WITH (security_barrier) AS
SELECT a.need_ref                   AS besoin_ref,
       a.capex_code,
       a.number                     AS numero,
       a.nature,
       a.qualification,
       a.reason                     AS motif,
       a.estimate_class             AS classe_estimation,
       a.central_keur               AS montant_central_keur,
       a.low_keur                   AS montant_bas_keur,
       a.high_keur                  AS montant_haut_keur,
       a.lead_time_weeks            AS delai_semaines,
       a.valid_until                AS valide_jusqu_au,
       a.document_ref,
       p.code                       AS projet_code,
       a.status                     AS statut,
       a.answered_at                AS repondu_le,
       a.updated_at                 AS maj_le
FROM need_answers a
LEFT JOIN projects p ON p.id = a.project_id;
--> statement-breakpoint
COMMENT ON VIEW pub_reponses_besoins IS 'Contrat K-02 v1 (R-187) : réponses d''EPC2i aux besoins machines des filiales, une ligne par réponse, la plus récente (repondu_le, puis numero) fait foi ; classe d''estimation et fourchette (K-03, offre ferme = E10) ; projet EPC2i créé à la commande (K-10). Lecteurs : arche_app.';
