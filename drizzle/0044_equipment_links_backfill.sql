-- Custom SQL migration file, put your code below! --
-- Delivery 9, R-185 part 2 (multi-equipment projects: ITP, punch list, commissioning, BOM, installed base per equipment line).
-- Runs AFTER 0043, which adds the equipment_id columns and replaces the one-plan-per-project key of itp_plans by one plan per
-- equipment line. Every statement only fills a null equipment_id, so the file can run again. A new database has no row yet:
-- the seed writes the links itself. "Main line" = the project's line of lowest position (EQ-01 for every project migrated by
-- 0042).
-- 1. Each existing inspection plan (one per project before R-185) belongs to its project's main line. A project without line
--    (no machine type) keeps its plan without line.
UPDATE "itp_plans" ip SET "equipment_id" = m."id"
FROM (
  SELECT DISTINCT ON (e."project_id") e."project_id", e."id"
  FROM "project_equipments" e
  ORDER BY e."project_id", e."position", e."ref"
) m
WHERE ip."equipment_id" IS NULL
  AND m."project_id" = ip."project_id"
  AND NOT EXISTS (SELECT 1 FROM "itp_plans" o WHERE o."equipment_id" = m."id");
--> statement-breakpoint
-- 2. A punch item raised by an inspection belongs to the inspection's plan's line; the others stay common (null).
UPDATE "punch_items" pi SET "equipment_id" = ip."equipment_id"
FROM "itp_inspections" i JOIN "itp_plans" ip ON ip."id" = i."plan_id"
WHERE pi."equipment_id" IS NULL
  AND pi."source_inspection_id" = i."id"
  AND ip."equipment_id" IS NOT NULL;
--> statement-breakpoint
-- 3. The commissioning systems of a project with a single line belong to it; with several lines nothing says which one, they
--    stay common (null) until the project manager's data say otherwise.
UPDATE "commissioning_systems" cs SET "equipment_id" = e."id"
FROM "project_equipments" e
WHERE cs."equipment_id" IS NULL
  AND e."project_id" = cs."project_id"
  AND (SELECT count(*) FROM "project_equipments" x WHERE x."project_id" = cs."project_id") = 1;
--> statement-breakpoint
-- 4. A machine of the installed base delivered by a project belongs to the project's line of its machine type (the first such
--    line), else to the project's main line.
UPDATE "machines" mc SET "equipment_id" = coalesce(
  (SELECT e."id" FROM "project_equipments" e
   WHERE e."project_id" = mc."project_id" AND e."machine_type_code" = mc."machine_type_code"
   ORDER BY e."position", e."ref" LIMIT 1),
  (SELECT e."id" FROM "project_equipments" e
   WHERE e."project_id" = mc."project_id"
   ORDER BY e."position", e."ref" LIMIT 1))
WHERE mc."equipment_id" IS NULL
  AND mc."project_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "project_equipments" e WHERE e."project_id" = mc."project_id");
