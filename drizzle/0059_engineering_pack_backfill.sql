-- Custom SQL migration file, put your code below! --
-- Delivery 9, R-191 (Arche K-08: EPC2i's share of the engineering pack). Runs AFTER 0058, which adds machine_type_pack_families
-- and document_types.pack_family. Reference data of both seeds, written here for the databases created before R-191 (a new
-- database has no machine type nor document type yet when this runs: the seeds write the same values, src/domain/engineering-pack.ts).
-- 1. The PROVISIONAL standard list (owner, 25 Oct 2026, pending the real list, CDC point C-9): the five families at 20 % each and
--    one document expected per family, for every machine type that has no list yet.
-- 2. The provisional mapping of Codex's document types to the families (PACK_DOCUMENT_TYPES): PID → pid, BOM → bom,
--    GA → layout, SCH → electrique, FDS → analyse_fonctionnelle — only where the type is not classified yet.
-- Both statements can run again.
INSERT INTO "machine_type_pack_families" ("machine_type_code", "family", "weight", "min_expected")
SELECT mt."code", f.family, 20, 1
FROM "machine_types" mt
CROSS JOIN (VALUES ('pid'), ('bom'), ('layout'), ('electrique'), ('analyse_fonctionnelle')) AS f(family)
WHERE NOT EXISTS (SELECT 1 FROM "machine_type_pack_families" x WHERE x."machine_type_code" = mt."code")
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "document_types" t SET "pack_family" = m.family
FROM (VALUES ('PID', 'pid'), ('BOM', 'bom'), ('GA', 'layout'), ('SCH', 'electrique'), ('FDS', 'analyse_fonctionnelle')) AS m(code, family)
WHERE t."code" = m.code AND t."pack_family" IS NULL;
