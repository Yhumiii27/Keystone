-- Custom SQL migration file, put your code below! --
-- Delivery 9, R-188 (estimate class, DIG-PRODI ±50 % / ±30 % / +10 −5 %). Runs AFTER 0047, which adds baselines.estimate_class.
-- Classifies the baselines recorded before R-188 (src/domain/estimate-class.ts `legacyBaselineClass`, same rule):
-- - BL1 and later (BLn, n >= 1): E10 — BL1 is frozen at the end of APD (L-2), whose precision is +10 / −5 %, and every later
--   baseline is a re-baseline of an approved budget;
-- - BL0: E30 — the proposal estimate (budgetary quote, APS precision ±30 %), E50 while the project is still at Initiative;
-- - any other code: left null (not classified).
-- Only a null class is filled, so the file can run again. A new database has no row yet: the seed writes the classes itself.
UPDATE "baselines" b SET "estimate_class" = CASE
    WHEN b."code" ~ '^BL[0-9]+$' AND substring(b."code" from 3)::int >= 1 THEN 'E10'
    WHEN b."code" = 'BL0' AND p."stage" = 'initiative' THEN 'E50'
    WHEN b."code" = 'BL0' THEN 'E30'
    ELSE NULL
  END
FROM "projects" p
WHERE p."id" = b."project_id"
  AND b."estimate_class" IS NULL;
