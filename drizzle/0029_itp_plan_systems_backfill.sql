-- Custom SQL migration file, put your code below! --
-- Delivery 8 (lot site-quality), R-057 (E-9 'a': machine-type changes apply to projects created afterwards). Runs AFTER the
-- generated migration that creates itp_plan_systems: every existing inspection plan without frozen systems gets the current
-- ITP systems of its machine type — AUTRE's when that type has none — in their order (a name listed twice is kept once, at
-- its first position). Plans that already have rows are left alone, so the file can run again. A new database has no plan
-- yet: the seed freezes the template systems itself.
WITH "plans" AS (
  SELECT p."id",
    CASE WHEN EXISTS (SELECT 1 FROM "machine_type_itp_systems" m WHERE m."machine_type_code" = p."machine_type_code")
      THEN p."machine_type_code" ELSE 'AUTRE' END AS "code"
  FROM "itp_plans" p
  WHERE NOT EXISTS (SELECT 1 FROM "itp_plan_systems" s WHERE s."plan_id" = p."id")
), "systems" AS (
  SELECT pl."id" AS "plan_id", m."name", min(m."position") AS "first"
  FROM "plans" pl JOIN "machine_type_itp_systems" m ON m."machine_type_code" = pl."code"
  GROUP BY pl."id", m."name"
)
INSERT INTO "itp_plan_systems" ("plan_id", "position", "name")
SELECT "plan_id", (row_number() OVER (PARTITION BY "plan_id" ORDER BY "first", "name") - 1)::int, "name" FROM "systems"
ON CONFLICT DO NOTHING;
