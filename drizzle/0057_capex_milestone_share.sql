-- Custom SQL migration file, put your code below! --
-- Delivery 9, R-189 (Arche K-04): pub_jalons_projets publishes the BL1 date of each CAPEX milestone (`reference_le`, null until
-- now). Same rules as 0035_share / 0038_share_followup: unqualified names, security_barrier, no grant (Matrix's
-- partage/90-droits.sql). CREATE OR REPLACE keeps the six columns of the contract, in place and with their types; only how they
-- are computed changes (docs/delivery-9/notes-r189-reference-dates.md):
-- - the schedule milestone of the project tagged with the code (milestones.capex_milestone_code, 0055/0056) is the CAPEX
--   milestone in the schedule; anchored on an activity (milestones.activity_id: imports, every Reschedule), its dates are that
--   activity's: current finish, actual finish once complete, and the finish of the same activity in the BL1 snapshot
--   (baseline_activities, matched by activity, else by code). Not anchored yet (a seeded milestone before its first roll-up),
--   its dates are its month positions read as the Schedule screen reads them (`dateOf`: project start month + position, day =
--   round(fraction × 30), at least 1, at most the month's last day); the baseline position counts as BL1 only while the project
--   has a BL1;
-- - reference_le = that BL1 date; null without a tagged milestone, without a BL1 (or a BL1 still proposed) or when the BL1
--   snapshot lacks the anchor activity (added after BL1);
-- - prevu_le = the module's planned date as before (ITP, site sheet, SAT, PV, warranty), else the tagged milestone's current
--   date, else the actual date; reel_le = the module's actual date as before, else the tagged milestone's actual date
--   (anchor activity complete, or a milestone marked done);
-- - maj_le also follows the tagged milestone, its activity and the project's BL1.
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
       coalesce(j.prevu, cm.prevu, j.reel) AS prevu_le,
       cm.reference        AS reference_le,
       coalesce(j.reel, cm.reel) AS reel_le,
       greatest(p.updated_at, e.changed, j.changed, cm.changed) AS maj_le
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
) AS j(jalon_code, prevu, reel, changed)
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
COMMENT ON VIEW pub_jalons_projets IS 'Contrat R-189 v1 : une ligne par projet et jalon CAPEX (commande, fin_etudes, fat, expedition, arrivee_site, sat, pv_reception, fin_garantie) ; reel_le null tant que le jalon n''est pas atteint ; reference_le = date BL1 du jalon du planning portant ce code (milestones.capex_milestone_code), null sans BL1 ni jalon codé. Lecteurs : arche_app, matrix_app.';
