-- Custom SQL migration file, put your code below! --
-- Delivery 9, R-185 (multi-equipment projects, framing validated by the product owner on 23 Oct 2026). Runs AFTER 0041, which
-- creates project_equipments and the per_equipment / equipment_id columns.
-- 1. Every existing project with a machine type gets its first equipment line: EQ-01, its machine type, quantity 1 (the main
--    type stays in projects.machine_type_code). Projects that already have a line are left alone, so the file can run again.
--    A new database has no project yet: the seed writes the lines itself.
INSERT INTO "project_equipments" ("project_id", "ref", "machine_type_code", "quantity", "position")
SELECT p."id", 'EQ-01', p."machine_type_code", 1, 0
FROM "projects" p
WHERE p."machine_type_code" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "project_equipments" e WHERE e."project_id" = p."id");
--> statement-breakpoint
-- 2. The standard phases specific to an equipment (generated once per equipment line by the wizard) — the same list as
--    PER_EQUIPMENT_PHASES (src/domain/project-equipment.ts), matched by name: a phase renamed on the Machine types screen
--    stays common to the project.
UPDATE "machine_type_phases" SET "per_equipment" = true
WHERE ("machine_type_code" = 'EMP' AND "name" IN ('Fabrication structure', 'Montage mécanique', 'Installation électrique & automatisme'))
   OR ("machine_type_code" = 'MEMU' AND "name" IN ('Fabrication modules', 'Assemblage & câblage', 'Essais plateforme'))
   OR ("machine_type_code" = 'SPUR' AND "name" IN ('Structures & supports', 'Équipements électriques'))
   OR ("machine_type_code" = 'AUTRE' AND "name" IN ('Réalisation', 'Essais'));
