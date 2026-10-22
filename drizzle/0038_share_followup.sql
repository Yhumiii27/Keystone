-- Custom SQL migration file, put your code below! --
-- Share views, delivery 9 (docs/delivery-9/notes-share-views.md; REQUESTS.md entries of 22 Oct 2026 from Crucible and Arche):
-- pub_jalons (Crucible, R-195), pub_projets + capex_code, besoin_ref (Arche K-05, R-190), pub_jalons_projets,
-- pub_avancement_projets, pub_avenants, pub_reserves (Arche K-04, R-189) and pub_livrables + type, accepte_le, maj_le (Arche
-- K-06). Same rules as 0035_share: each pub_ view is a contract — a column is never removed, renamed or moved, new columns go
-- at the end (CREATE OR REPLACE VIEW accepts exactly that); unqualified names ("public" on PGlite, "keystone" on the shared
-- server through search_path); WITH (security_barrier); the readers' grants are in Matrix (partage/90-droits.sql), and Matrix's
-- partage/30-keystone.sql is to be refreshed with these definitions. The prerequisite columns and the progress table are in
-- 0037_share_followup_columns (declared in the Drizzle schema).
-- Sales side only (open question P-05 / Arche AC-2): no internal cost, rate card, actual cost, budget, CPI, EAC or margin is
-- published. Contract amounts are in thousands of euros, converted from the contract's currency at the project's budget rate
-- like every consolidation in Keystone (src/domain/currency.ts `eurRate`: 1 for EUR, the budget rate for the project currency,
-- 1 for a stale row without a rate).
CREATE OR REPLACE VIEW pub_jalons WITH (security_barrier) AS
SELECT p.code               AS projet_code,
       m.id                 AS jalon_id,
       m.name               AS nom,
       m.position,
       m.baseline_month     AS mois_reference,
       m.forecast_month     AS mois_prevu,
       m.status             AS statut,
       a.code               AS activite_code,
       a.finish_date        AS date_fin_activite,
       greatest(m.updated_at, a.updated_at, a.scheduled_at) AS maj_le
FROM milestones m
JOIN projects p        ON p.id = m.project_id
LEFT JOIN activities a ON a.id = m.activity_id;
--> statement-breakpoint
COMMENT ON VIEW pub_jalons IS 'Contrat R-195 v1 : jalons du planning des projets (mois depuis le début du projet), avec la fin de l''activité liée quand elle est datée. Lecteurs : crucible_app, matrix_app.';
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
       p.updated_at         AS maj_le,
       p.capex_code,
       p.besoin_ref
FROM projects p
LEFT JOIN clients c           ON c.id = p.client_id
LEFT JOIN persons pm          ON pm.id = p.pm_person_id
LEFT JOIN lifecycle_stages ls ON ls.code = p.stage
LEFT JOIN project_sites ps    ON ps.project_id = p.id;
--> statement-breakpoint
COMMENT ON VIEW pub_projets IS 'Contrat D02 v1 + capex_code, besoin_ref (R-190, en fin de vue) : tous les projets Keystone, internes compris (nature). Lecteurs : codex_app, cursus_app, vigie_app, matrix_app, arche_app, crucible_app.';
--> statement-breakpoint
CREATE OR REPLACE VIEW pub_livrables WITH (security_barrier) AS
SELECT p.code   AS project_code,
       d.number,
       d.title,
       d.status,
       d.deliverable_type AS type,
       d.accepted_on      AS accepte_le,
       d.updated_at       AS maj_le
FROM deliverables d
JOIN projects p ON p.id = d.project_id;
--> statement-breakpoint
COMMENT ON VIEW pub_livrables IS 'Contrat D13 v1 + type, accepte_le, maj_le (R-189, en fin de vue) : livrables contractuels, pour la fiche NC et les PV de réception (type client_acceptance). Lecteurs : vigie_app, matrix_app, arche_app.';
--> statement-breakpoint
-- One row per project and CAPEX milestone. Mapping to Keystone's data (notes-share-views.md § 3): a reached milestone is the
-- first entry, still standing (neither reverted nor rejected), into a lifecycle stage of the given order or later; its planned
-- date comes from the module that plans it when Keystone has one, else it is the actual date. No BL1 date is published yet:
-- Keystone's schedule milestones carry no CAPEX milestone code (reference_le is null, open point).
CREATE OR REPLACE VIEW pub_jalons_projets WITH (security_barrier) AS
WITH standing AS (
  SELECT t.project_id, s.seq, t.effective_on, t.created_at
  FROM stage_transitions t
  JOIN lifecycle_stages s ON s.code = t.to_stage
  WHERE t.mode <> 'revert'
    AND t.validation_status IS DISTINCT FROM 'rejected'
    AND s.seq IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM stage_transitions r WHERE r.reverts_transition_id = t.id)
)
SELECT p.code              AS projet_code,
       j.jalon_code,
       coalesce(j.prevu, j.reel) AS prevu_le,
       NULL::date          AS reference_le,
       j.reel              AS reel_le,
       greatest(p.updated_at, e.changed, j.changed) AS maj_le
FROM projects p
LEFT JOIN contracts c    ON c.project_id = p.id
LEFT JOIN site_sheets ss ON ss.project_id = p.id
CROSS JOIN LATERAL (
  SELECT min(st.effective_on) FILTER (WHERE st.seq >= 4)  AS etudes,
         min(st.effective_on) FILTER (WHERE st.seq >= 5)  AS approvisionnements,
         min(st.effective_on) FILTER (WHERE st.seq >= 8)  AS expedition,
         min(st.effective_on) FILTER (WHERE st.seq >= 9)  AS chantier,
         min(st.effective_on) FILTER (WHERE st.seq >= 12) AS clos,
         max(st.created_at) AS changed
  FROM standing st WHERE st.project_id = p.id
) e
CROSS JOIN LATERAL (
  SELECT max(i.planned_on) AS planned, max(i.updated_at) AS changed
  FROM itp_plans ip JOIN itp_inspections i ON i.plan_id = ip.id
  WHERE ip.project_id = p.id AND i.stage = 'fat'
) fat
CROSS JOIN LATERAL (
  SELECT max(cs.date_on) AS planned,
         CASE WHEN count(*) > 0 AND bool_and(cs.status = 'done') THEN max(cs.date_on) END AS done
  FROM commissioning_systems sy JOIN commissioning_steps cs ON cs.system_id = sy.id
  WHERE sy.project_id = p.id AND cs.step = 'sat'
) sat
CROSS JOIN LATERAL (
  SELECT max(sp.planned_on) AS planned, max(sp.created_at) AS changed FROM sat_plans sp WHERE sp.project_id = p.id
) satp
CROSS JOIN LATERAL (
  SELECT max(d.due_on) AS due,
         CASE WHEN count(*) > 0 AND bool_and(d.status = 'accepted') THEN max(d.accepted_on) END AS accepted,
         max(d.updated_at) AS changed
  FROM deliverables d WHERE d.project_id = p.id AND d.deliverable_type = 'client_acceptance'
) pv
CROSS JOIN LATERAL (
  SELECT max(coalesce(mc.extended_until, mc.warranty_end_on)) AS ends, max(mc.updated_at) AS changed
  FROM machines mc WHERE mc.project_id = p.id
) w
CROSS JOIN LATERAL (VALUES
  ('commande',     NULL::date,                         coalesce(c.signed_on, e.etudes), c.updated_at),
  ('fin_etudes',   NULL::date,                         e.approvisionnements,            NULL::timestamptz),
  ('fat',          fat.planned,                        e.expedition,                    fat.changed),
  ('expedition',   NULL::date,                         e.expedition,                    NULL::timestamptz),
  ('arrivee_site', ss.start_on,                        e.chantier,                      ss.updated_at),
  ('sat',          coalesce(sat.planned, satp.planned), sat.done,                       satp.changed),
  ('pv_reception', pv.due,                             pv.accepted,                     pv.changed),
  ('fin_garantie', w.ends,                             e.clos,                          w.changed)
) AS j(jalon_code, prevu, reel, changed);
--> statement-breakpoint
COMMENT ON VIEW pub_jalons_projets IS 'Contrat R-189 v1 : une ligne par projet et jalon CAPEX (commande, fin_etudes, fat, expedition, arrivee_site, sat, pv_reception, fin_garantie) ; reel_le null tant que le jalon n''est pas atteint. Lecteurs : arche_app, matrix_app.';
--> statement-breakpoint
-- One row per project. Progress and SPI are computed in TypeScript (earned value at the data date) and kept in
-- share_project_progress by the scheduled job share-progress (null until its first run); the rest is read live.
CREATE OR REPLACE VIEW pub_avancement_projets WITH (security_barrier) AS
SELECT p.code              AS projet_code,
       sp.situation_on     AS date_situation,
       sp.progress_pct     AS avancement_physique_pct,
       sp.spi,
       coalesce((SELECT max(coalesce(a.finish_date, a.early_finish_date)) FROM activities a WHERE a.project_id = p.id),
                p.planned_finish_date) AS fin_prevue_le,
       CASE WHEN c.id IS NOT NULL THEN round(c.base_amount_keur * fx.rate, 3) ELSE bp.contract_value_keur END AS montant_contrat_keur,
       CASE WHEN c.id IS NOT NULL THEN round(coalesce(av.signed, 0) * fx.rate, 3) END AS montant_avenants_keur,
       CASE WHEN c.id IS NOT NULL OR bp.project_id IS NOT NULL THEN round(coalesce(inv.amount, 0) + coalesce(lg.amount, 0), 3) END AS facture_keur,
       greatest(p.updated_at, sp.updated_at, c.updated_at, bp.updated_at, av.changed, inv.changed, lg.changed) AS maj_le
FROM projects p
LEFT JOIN share_project_progress sp ON sp.project_id = p.id
LEFT JOIN contracts c               ON c.project_id = p.id
LEFT JOIN billing_plans bp          ON bp.project_id = p.id
CROSS JOIN LATERAL (
  SELECT CASE WHEN coalesce(c.currency, 'EUR') = 'EUR' THEN 1::numeric
              WHEN c.currency = p.currency AND p.budget_rate > 0 THEN p.budget_rate
              ELSE 1::numeric END AS rate
) fx
CROSS JOIN LATERAL (
  SELECT sum(am.amount_keur) FILTER (WHERE am.status = 'signed') AS signed, max(am.updated_at) AS changed
  FROM contract_amendments am WHERE am.contract_id = c.id
) av
CROSS JOIN LATERAL (
  SELECT sum(ci.amount_keur * CASE WHEN coalesce(ci.currency, 'EUR') = 'EUR' THEN 1::numeric
                                   WHEN ci.currency = p.currency AND p.budget_rate > 0 THEN p.budget_rate
                                   ELSE 1::numeric END) AS amount,
         max(ci.created_at) AS changed
  FROM customer_invoices ci JOIN payment_milestones pm ON pm.id = ci.payment_milestone_id
  WHERE pm.project_id = p.id
) inv
CROSS JOIN LATERAL (
  SELECT sum(pm.amount_keur) FILTER (WHERE pm.status <> 'planned') AS amount, max(pm.updated_at) AS changed
  FROM payment_milestones pm WHERE pm.project_id = p.id AND pm.contract_id IS NULL
) lg;
--> statement-breakpoint
COMMENT ON VIEW pub_avancement_projets IS 'Contrat R-189 v1 : situation courante de chaque projet, côté vente seulement (aucun coût interne, taux, coût réel, CPI, EAC ni marge — P-05 / AC-2) ; montants en k€. Avancement et SPI : table share_project_progress, rafraîchie par la tâche share-progress. Lecteurs : arche_app, matrix_app.';
--> statement-breakpoint
-- Amendments sent to the client (drafts are internal and not published): proposed until signed; refused when the change
-- request it carries was rejected. Number = order in the contract (AV-01…); time extension = the change request's days.
CREATE OR REPLACE VIEW pub_avenants WITH (security_barrier) AS
SELECT p.code              AS projet_code,
       'AV-' || lpad((a.position + 1)::text, 2, '0') AS numero,
       a.subject           AS objet,
       round(a.amount_keur * CASE WHEN coalesce(c.currency, 'EUR') = 'EUR' THEN 1::numeric
                                  WHEN c.currency = p.currency AND p.budget_rate > 0 THEN p.budget_rate
                                  ELSE 1::numeric END, 3) AS montant_keur,
       cr.schedule_days    AS delai_jours,
       CASE WHEN a.status = 'signed' THEN 'signe'
            WHEN cr.status = 'rejected' THEN 'refuse'
            ELSE 'propose' END AS statut,
       a.signed_on         AS signe_le,
       greatest(a.updated_at, cr.updated_at) AS maj_le
FROM contract_amendments a
JOIN contracts c             ON c.id = a.contract_id
JOIN projects p              ON p.id = c.project_id
LEFT JOIN change_requests cr ON cr.id = a.change_request_id
WHERE a.status <> 'draft';
--> statement-breakpoint
COMMENT ON VIEW pub_avenants IS 'Contrat R-189 v1 : avenants au contrat envoyés au client (brouillons exclus), montant en k€. Lecteurs : arche_app, matrix_app.';
--> statement-breakpoint
-- Punch items (réserves): one list per project (R-117). The NCR number, the owner's name and the description stay in Keystone.
-- Opened on = the Paris day the item was recorded (Keystone stores no separate raised date).
CREATE OR REPLACE VIEW pub_reserves WITH (security_barrier) AS
SELECT p.code              AS projet_code,
       pi.number           AS numero,
       pi.category         AS categorie,
       pi.register         AS origine,
       pi.status           AS statut,
       pi.owner_party      AS responsable,
       (pi.created_at AT TIME ZONE 'Europe/Paris')::date AS ouverte_le,
       pi.closed_on        AS levee_le,
       pi.updated_at       AS maj_le
FROM punch_items pi
JOIN projects p ON p.id = pi.project_id;
--> statement-breakpoint
COMMENT ON VIEW pub_reserves IS 'Contrat R-189 v1 : réserves (liste unique du projet) — catégorie A/B/C, origine itp/site, statut open/in_progress/closed, responsable client/keystone. Lecteurs : arche_app, matrix_app.';
