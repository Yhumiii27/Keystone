-- Custom SQL migration file, put your code below! --
-- Delivery 8 (lot site-quality), R-117 (A-6 'a'): one punch list per project. Until now the ITP register and the Site
-- register were numbered separately, so a project with both had two P-01. This runs BEFORE the generated migration that
-- swaps the unique key (project_id, register, number) for (project_id, number):
-- 1. In every project where a Site item shares its number with an ITP item, the Site items are renumbered after the
--    project's highest ITP number (HLT-026: site P-01..P-03 → P-06..P-08), in their order, and placed after the ITP items.
--    Two steps (a temporary number first) so the old unique key is never hit mid-update. A project without a clash is left
--    as it is, so the file can run again without renumbering anything.
-- 2. Every item gets a category and an owner party: Site items without a category become B (before SAT), ITP items without
--    an owner party are Keystone's.
-- Photos stay attached (stored_files.owner_id is the item's id); a document relation "P-01" keeps pointing at the ITP P-01.
UPDATE "punch_items" s SET "number" = 'TMP-' || s."id"
WHERE s."register" = 'site' AND s."project_id" IN (
  SELECT x."project_id" FROM "punch_items" x
  JOIN "punch_items" i ON i."project_id" = x."project_id" AND i."register" = 'itp' AND i."number" = x."number"
  WHERE x."register" = 'site'
);
--> statement-breakpoint
WITH "itp_max" AS (
  SELECT "project_id",
    max(CASE WHEN "number" ~ '^P-[0-9]+$' THEN substring("number" FROM 3)::int ELSE 0 END) AS "n",
    max("position") AS "pos"
  FROM "punch_items" WHERE "register" = 'itp' GROUP BY "project_id"
), "renumber" AS (
  SELECT s."id",
    m."n" + row_number() OVER (PARTITION BY s."project_id" ORDER BY s."position", s."created_at", s."id") AS "k",
    m."pos" + row_number() OVER (PARTITION BY s."project_id" ORDER BY s."position", s."created_at", s."id") AS "pos"
  FROM "punch_items" s JOIN "itp_max" m ON m."project_id" = s."project_id"
  WHERE s."register" = 'site' AND s."number" LIKE 'TMP-%'
)
UPDATE "punch_items" p SET "number" = 'P-' || lpad(r."k"::text, greatest(2, length(r."k"::text)), '0'), "position" = r."pos"
FROM "renumber" r WHERE p."id" = r."id";
--> statement-breakpoint
UPDATE "punch_items" SET "category" = 'B' WHERE "register" = 'site' AND "category" IS NULL;
--> statement-breakpoint
UPDATE "punch_items" SET "owner_party" = 'keystone' WHERE "register" = 'itp' AND "owner_party" IS NULL;
