-- Custom SQL migration file, put your code below! --
-- Delivery 8, R-083 (A-10, R-4a): the rate grid becomes dated (rate_role_rates, rate_multiplier_rates — the single source of a
-- rate once the next migration retires rate_roles.base_rate_eur / effective_from and rate_multipliers.factor). On a database
-- that already has a grid, each role's current base rate becomes its first version, effective on the role's former "effective
-- from" date, else 1 Jan 2026 (the seed grid's date); each multiplier's current factor becomes its first version on 1 Jan 2026.
-- A person gets the grid role whose name is exactly their job title (no match = "not valued"). Idempotent; a new database
-- (empty tables) is untouched — the seed writes the versions itself.
INSERT INTO "rate_role_rates" ("rate_role_id", "effective_from", "base_rate_eur")
SELECT "id", COALESCE("effective_from", DATE '2026-01-01'), "base_rate_eur" FROM "rate_roles"
ON CONFLICT ("rate_role_id", "effective_from") DO NOTHING;
--> statement-breakpoint
INSERT INTO "rate_multiplier_rates" ("key", "effective_from", "factor")
SELECT "key", DATE '2026-01-01', "factor" FROM "rate_multipliers"
ON CONFLICT ("key", "effective_from") DO NOTHING;
--> statement-breakpoint
UPDATE "persons" AS p SET "rate_role_id" = r."id"
FROM "rate_roles" AS r
WHERE p."rate_role_id" IS NULL AND p."job_title" IS NOT NULL AND r."role" = p."job_title";
