-- Custom SQL migration file, put your code below! --
-- Delivery 8 (lot connectors), R-031 / R-173 (NEW-CURSUS-4 "a"): Keystone keeps two simple leave types and never the reason
-- of an absence — Leave (paid leave CP, RTT) and Absence (sick leave, training, anything else). A database that already has
-- leave types (demo or production seed) gets the two types, its absences mapped onto them (days unchanged), and the old
-- types removed. A new database has no leave type yet: nothing runs here, the seed writes the two types.
INSERT INTO "leave_types" ("code", "label", "days_per_week", "position")
SELECT v.code, v.label, 5, v.position
FROM (VALUES ('leave', 'Leave', 1), ('absence', 'Absence', 2)) AS v(code, label, position)
WHERE EXISTS (SELECT 1 FROM "leave_types")
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
UPDATE "leave_entries" SET "leave_type" = 'leave' WHERE "leave_type" IN ('cp', 'rtt');
--> statement-breakpoint
UPDATE "leave_entries" SET "leave_type" = 'absence' WHERE "leave_type" NOT IN ('leave', 'absence');
--> statement-breakpoint
DELETE FROM "leave_types" WHERE "code" NOT IN ('leave', 'absence');
