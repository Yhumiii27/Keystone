-- Custom SQL migration file, put your code below! --
-- Delivery 9, R-158 lot B (shipments, owner's decisions of 25 Oct 2026; docs/delivery-9/notes-r158-shipments.md § Lot B). Runs AFTER
-- 0063_shipments_reception (reception lines, punch links, shipping documents, shipments.received_on / closed_on / risk_id and the
-- index shipments_updated_at_idx). Same rules as 0035_share / 0038_share_followup / 0057: unqualified names ("public" on PGlite,
-- "keystone" on the shared server through search_path), WITH (security_barrier), no grant (Matrix's partage/90-droits.sql; Matrix's
-- partage/30-keystone.sql is to be refreshed with these definitions).
--
-- 1. pub_jalons_projets (contract R-189 v1, its six columns kept in place with their types): the shipments feed two milestones.
--    - expedition: reel_le = the first actual pick-up date (atd) of the project's shipments, else as before (lifecycle stage, tagged
--      schedule milestone); prevu_le = as before (tagged milestone), else the earliest ETD, else reel_le;
--    - arrivee_site: once the project has a shipment sent (any status but draft), reel_le = the last actual arrival (ata) when every
--      such shipment has arrived, else null — the shipments decide; without one, as before. prevu_le = the site sheet's start (as
--      before), else the tagged milestone, else the latest ETA, else reel_le;
--    - maj_le also follows the project's shipments (max updated_at).
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
       coalesce(j.prevu, cm.prevu, j.ship_prevu, CASE WHEN j.ship_decides THEN j.ship_reel ELSE coalesce(j.ship_reel, j.reel, cm.reel) END) AS prevu_le,
       cm.reference        AS reference_le,
       CASE WHEN j.ship_decides THEN j.ship_reel ELSE coalesce(j.ship_reel, j.reel, cm.reel) END AS reel_le,
       greatest(p.updated_at, e.changed, j.changed, cm.changed, shp.changed) AS maj_le
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
CROSS JOIN LATERAL (
  SELECT min(sh.atd) AS depart, min(sh.etd) AS etd, max(sh.eta) AS eta,
         count(*) FILTER (WHERE sh.status <> 'draft') AS sent,
         CASE WHEN count(*) FILTER (WHERE sh.status <> 'draft') > 0 AND bool_and(sh.ata IS NOT NULL) FILTER (WHERE sh.status <> 'draft')
              THEN max(sh.ata) FILTER (WHERE sh.status <> 'draft') END AS arrivee,
         max(sh.updated_at) AS changed
  FROM shipments sh WHERE sh.project_id = p.id
) shp
CROSS JOIN LATERAL (VALUES
  ('commande',     NULL::date,                         coalesce(c.signed_on, e.etudes), c.updated_at,       NULL::date, NULL::date,  false),
  ('fin_etudes',   NULL::date,                         e.approvisionnements,            NULL::timestamptz, NULL::date, NULL::date,  false),
  ('fat',          fat.planned,                        e.expedition,                    fat.changed,       NULL::date, NULL::date,  false),
  ('expedition',   NULL::date,                         e.expedition,                    NULL::timestamptz, shp.etd,    shp.depart,  false),
  ('arrivee_site', ss.start_on,                        e.chantier,                      ss.updated_at,     shp.eta,    shp.arrivee, shp.sent > 0),
  ('sat',          coalesce(sat.planned, satp.planned), sat.done,                       satp.changed,      NULL::date, NULL::date,  false),
  ('pv_reception', pv.due,                             pv.accepted,                     pv.changed,        NULL::date, NULL::date,  false),
  ('fin_garantie', w.ends,                             e.clos,                          w.changed,         NULL::date, NULL::date,  false)
) AS j(jalon_code, prevu, reel, changed, ship_prevu, ship_reel, ship_decides)
LEFT JOIN LATERAL (
  SELECT CASE WHEN a.id IS NOT NULL THEN a.finish_date
              ELSE fm.d0 + (least(greatest(1, fm.day), extract(day FROM fm.d0 + interval '1 month - 1 day')::int) - 1) END AS prevu,
         CASE WHEN a.id IS NOT NULL THEN CASE WHEN a.finish_actual OR a.percent_complete >= 100 THEN a.finish_date END
              WHEN m.status = 'done' THEN fm.d0 + (least(greatest(1, fm.day), extract(day FROM fm.d0 + interval '1 month - 1 day')::int) - 1) END AS reel,
         CASE WHEN bl1.id IS NULL THEN NULL
              WHEN a.id IS NOT NULL THEN bla.finish_date
              ELSE bm.d0 + (least(greatest(1, bm.day), extract(day FROM bm.d0 + interval '1 month - 1 day')::int) - 1) END AS reference,
         greatest(m.updated_at, a.updated_at, a.scheduled_at, bl1.updated_at) AS changed
  FROM milestones m
  LEFT JOIN activities a ON a.id = m.activity_id
  LEFT JOIN baselines bl1 ON bl1.project_id = m.project_id AND bl1.code = 'BL1' AND bl1.state <> 'proposed'
  LEFT JOIN LATERAL (
    SELECT ba.finish_date FROM baseline_activities ba
    WHERE ba.baseline_id = bl1.id AND (ba.activity_id = a.id OR ba.activity_code = a.code)
    ORDER BY (ba.activity_id = a.id) DESC NULLS LAST
    LIMIT 1
  ) bla ON true
  LEFT JOIN project_controls pc ON pc.project_id = m.project_id
  LEFT JOIN LATERAL (
    SELECT make_date((floor(v.x)::int + 1200) / 12 + 1926, (floor(v.x)::int + 1200) % 12 + 1, 1) AS d0,
           floor((v.x - floor(v.x)) * 30 + 0.5)::int AS day
    FROM (SELECT pc.start_month + m.baseline_month AS x) v
  ) bm ON true
  LEFT JOIN LATERAL (
    SELECT make_date((floor(v.x)::int + 1200) / 12 + 1926, (floor(v.x)::int + 1200) % 12 + 1, 1) AS d0,
           floor((v.x - floor(v.x)) * 30 + 0.5)::int AS day
    FROM (SELECT pc.start_month + m.forecast_month AS x) v
  ) fm ON true
  WHERE m.project_id = p.id AND m.capex_milestone_code = j.jalon_code
) cm ON true;
--> statement-breakpoint
COMMENT ON VIEW pub_jalons_projets IS 'Contrat R-189 v1 : une ligne par projet et jalon CAPEX (commande, fin_etudes, fat, expedition, arrivee_site, sat, pv_reception, fin_garantie) ; reel_le null tant que le jalon n''est pas atteint ; reference_le = date BL1 du jalon du planning portant ce code (milestones.capex_milestone_code), null sans BL1 ni jalon codé ; R-158 : expedition = premier enlèvement réel des expéditions, arrivee_site = dernière arrivée réelle une fois toutes les expéditions envoyées arrivées (ETD / ETA en date prévue à défaut d''autre source). Lecteurs : arche_app, matrix_app.';
--> statement-breakpoint
-- 2. pub_expeditions (Arche, owner's decision 6: the subsidiary follows the shipments in Arche, nothing in Keystone): one row per
--    shipment — no value, no price, no forwarder (an external party, its contact data stay in Keystone). The contract's Incoterm and
--    named place are read live; maj_le = shipments.updated_at, which every change of the shipment, its content, its reception and
--    its punch items moves (Arche K-11: index shipments_updated_at_idx). nb_reserves_ouvertes = the punch items its reception raised
--    that are not closed.
CREATE OR REPLACE VIEW pub_expeditions WITH (security_barrier) AS
SELECT p.code              AS projet_code,
       s.ref               AS expedition_ref,
       (SELECT string_agg(pe.ref || ' · ' || CASE WHEN pe.quantity > 1 THEN pe.quantity::text || ' × ' ELSE '' END || pe.machine_type_code, ', ' ORDER BY pe.position, pe.ref)
          FROM shipment_equipments se JOIN project_equipments pe ON pe.id = se.equipment_id
         WHERE se.shipment_id = s.id) AS equipements,
       s.status            AS statut,
       s.mode,
       i.code              AS incoterm,
       c.incoterm_place    AS incoterm_lieu,
       s.origin            AS origine,
       s.destination,
       s.etd,
       s.eta,
       s.atd               AS depart_reel_le,
       s.ata               AS arrivee_reelle_le,
       s.received_on       AS receptionnee_le,
       (SELECT count(*)::int FROM shipment_loads sl WHERE sl.shipment_id = s.id) AS nb_chargements,
       (SELECT count(*)::int FROM shipment_punch_items sp JOIN punch_items pi ON pi.id = sp.punch_item_id
         WHERE sp.shipment_id = s.id AND pi.status <> 'closed') AS nb_reserves_ouvertes,
       s.updated_at        AS maj_le
FROM shipments s
JOIN projects p          ON p.id = s.project_id
LEFT JOIN contracts c    ON c.project_id = p.id
LEFT JOIN incoterms i    ON i.id = c.incoterm_id;
--> statement-breakpoint
COMMENT ON VIEW pub_expeditions IS 'Contrat R-158 v1 : une ligne par expédition du matériel EPC2i vers le site — équipements, statut (draft, prepared, picked_up, in_transit, arrived, received, closed), mode, Incoterm et lieu du contrat, origine, destination, ETD / ETA, départ et arrivée réels, réception sur site, nombre de chargements et de réserves ouvertes ; aucune valeur, aucun prix, aucun contact du transitaire. Lecteurs : arche_app.';
