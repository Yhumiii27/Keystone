-- D9-06, D9-22, D9-23, D9-25, D9-26 (owner, 10 Nov 2026; docs/delivery-9/notes-d9-noclient.md): clients never see Keystone.
-- No pub_ view reads any column or table dropped here (checked against every migration up to 0082).
-- 1. The client portal's issues (R-137) go with the portal.
ALTER TABLE "client_issues" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "client_issues" CASCADE;--> statement-breakpoint
-- 2. The Client role goes: a user holding only it is deactivated, every user loses it; the client organisation of a user account
--    (users.client_id) is dropped (a contact person keeps persons.client_id).
UPDATE "users" SET "active" = false WHERE 'client' = ANY("roles") AND cardinality(array_remove("roles", 'client')) = 0;--> statement-breakpoint
UPDATE "users" SET "roles" = array_remove("roles", 'client'), "role" = CASE WHEN "role" = 'client' THEN NULL ELSE "role" END WHERE 'client' = ANY("roles") OR "role" = 'client';--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_client_id_clients_id_fk";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "client_id";--> statement-breakpoint
-- 3. D9-25: "client present" on the meeting; the external meetings were the client meetings until now.
ALTER TABLE "meetings" ADD COLUMN "client_present" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "meetings" SET "client_present" = true WHERE "type" = 'external';--> statement-breakpoint
-- 4. D9-06: the project's lead records the client's decision on a deliverable with the reference of the signed document.
ALTER TABLE "deliverable_reviews" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "acceptance_ref" text;--> statement-breakpoint
-- 5. D9-26: stakeholders are defined by their roles and responsibilities only — no power / interest grid.
ALTER TABLE "stakeholders" DROP COLUMN "influence";--> statement-breakpoint
ALTER TABLE "stakeholders" DROP COLUMN "interest";--> statement-breakpoint
ALTER TABLE "stakeholders" DROP COLUMN "attitude";