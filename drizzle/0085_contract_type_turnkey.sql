-- Contract type code `lump_sum_epc` renamed `lump_sum_turnkey` (owner, 27 Nov 2026: « remplace par clé en main »).
-- Order: drop the domain CHECK, rewrite the stored value, then the CHECK with the new list.
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_type_domain";--> statement-breakpoint
UPDATE "contracts" SET "type" = 'lump_sum_turnkey' WHERE "type" = 'lump_sum_epc';--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_type_domain" CHECK ("contracts"."type" in ('lump_sum_turnkey', 'unit_rates', 'cost_plus', 'framework'));
