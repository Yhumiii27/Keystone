-- Custom SQL migration file, put your code below! --
-- Delivery 9, R-189 (Arche K-04: BL1 dates of the CAPEX milestones). Runs AFTER 0055, which adds milestones.capex_milestone_code.
-- Tags the schedule milestones recorded before R-189 by the automatic rule of src/domain/capex-milestones.ts
-- (`autoCapexMilestoneCodes`, same patterns, applied case-insensitively to the milestone's name; capex-milestones.test.ts checks
-- that this file carries exactly the TypeScript patterns): a milestone takes code C when its name matches C and no other code,
-- no other milestone of the project matches only C, and no milestone of the project carries C yet. Anything ambiguous stays null
-- for the project's leads (Schedule screen). Only null codes are filled and `updated_at` is left alone (the milestone itself did
-- not change), so the file can run again. A new database has no milestone yet: the seed and the schedule import tag their own.
WITH candidates AS (
  SELECT m."id", m."project_id",
    array_remove(ARRAY[
        CASE WHEN m."name" ~* '^ *(commande|order|purchase order|po)( (client|ferme|re[cç]ue|sign[eé]e|received|signed|placed)){0,2} *$|(^|[^a-z0-9])(contract (signed|signature|award|awarded)|signature (du |of )?(contrat|contract)|notification (du )?march[eé]|kick[ -]?off|notice to proceed)([^a-z0-9]|$)' THEN 'commande' END,
        CASE WHEN m."name" ~* '(^|[^a-z0-9])(fin (des |d.)?[eé]tudes|[eé]tudes termin[eé]es|design (complete|completed|freeze|frozen|approved)|engineering (complete|completed|freeze|frozen)|gel (de la )?conception|conception termin[eé]e|bon pour ex[eé]cution|issued for construction)([^a-z0-9]|$)' THEN 'fin_etudes' END,
        CASE WHEN m."name" ~* '(^|[^a-z0-9])(fat|factory acceptance|essais? (en )?usine|r[eé]ception (en )?usine)([^a-z0-9]|$)' THEN 'fat' END,
        CASE WHEN m."name" ~* '(^|[^a-z0-9])(exp[eé]dition|shipment|shipping|shipped|dispatch|dispatched|d[eé]part usine|ex[ -]?works)([^a-z0-9]|$)' THEN 'expedition' END,
        CASE WHEN m."name" ~* '(^|[^a-z0-9])(arriv[eé]e (sur |au |du mat[eé]riel sur )?(site|chantier)|site arrival|arrival (on|at) site|delivered (to|on) site|delivery (to|on|at) site|livraison (sur |au )?(site|chantier)|on[ -]site delivery)([^a-z0-9]|$)' THEN 'arrivee_site' END,
        CASE WHEN m."name" ~* '(^|[^a-z0-9])(sat|site acceptance|commissioning|mise en service|essais (sur site|de mise en service))([^a-z0-9]|$)' THEN 'sat' END,
        CASE WHEN m."name" ~* '^ *pv *$|(^|[^a-z0-9])(pv (de |d.)?r[eé]ception|proc[eè]s[ -]verbal|r[eé]ception provisoire|r[eé]ception client|handover|hand[ -]over|taking[ -]over|provisional acceptance|customer acceptance|client acceptance|remise (au client|de l.ouvrage))([^a-z0-9]|$)' THEN 'pv_reception' END,
        CASE WHEN m."name" ~* '(^|[^a-z0-9])(fin (de |de la |d.)?garantie|warranty (end|ends|expiry|expiration|expires)|end of (the )?warranty|r[eé]ception d[eé]finitive|final acceptance|defects liability|dlp)([^a-z0-9]|$)' THEN 'fin_garantie' END
    ]::text[], NULL) AS codes
  FROM "milestones" m
  WHERE m."capex_milestone_code" IS NULL
), single AS (
  SELECT c."id", c."project_id", c.codes[1] AS code FROM candidates c WHERE cardinality(c.codes) = 1
), chosen AS (
  SELECT s."id", s.code FROM single s
  WHERE (SELECT count(*) FROM single o WHERE o."project_id" = s."project_id" AND o.code = s.code) = 1
    AND NOT EXISTS (SELECT 1 FROM "milestones" t WHERE t."project_id" = s."project_id" AND t."capex_milestone_code" = s.code)
)
UPDATE "milestones" SET "capex_milestone_code" = chosen.code
FROM chosen
WHERE "milestones"."id" = chosen."id";
