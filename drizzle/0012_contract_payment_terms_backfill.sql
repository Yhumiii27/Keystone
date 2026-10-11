-- Custom SQL migration file, put your code below! --
-- Delivery 7, C-6 (R-076): the contracts that existed before 0007 keep their terms — the payment rule and N are read from
-- the stored text as `termsOfText` (src/domain/payment-terms.ts) reads it: first integer = N (default 45, at most 180);
-- "end of month" / "fin de mois" at the start = end of month + N days, elsewhere = N days end of month; else net N days.
UPDATE "contracts" SET
  "payment_days" = LEAST(180, COALESCE(substring("payment_terms" from '[0-9]{1,6}')::int, 45)),
  "payment_rule" = CASE
    WHEN lower(btrim("payment_terms")) ~ '^(end of month|fin de mois)' THEN 'eom_days'
    WHEN lower("payment_terms") ~ '(end of month|fin de mois|\meom\M|\mfdm\M)' THEN 'days_eom'
    ELSE 'net'
  END;
