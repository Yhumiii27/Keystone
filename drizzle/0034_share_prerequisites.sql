ALTER TABLE "countries" ADD COLUMN "iso2" char(2);--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "org_code" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "kind" text DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "vigie_ecos" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vigie_ncrs" ADD COLUMN "closed_on" date;--> statement-breakpoint
ALTER TABLE "vigie_ncrs" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "vigie_ncrs" ADD COLUMN "owner_matricule" text;--> statement-breakpoint
CREATE INDEX "activity_events_occurred_at_idx" ON "activity_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_entries_occurred_at_idx" ON "audit_entries" USING btree ("occurred_at");--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_iso2_unique" UNIQUE("iso2");--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_code_unique" UNIQUE("org_code");--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_iso2_check" CHECK ("countries"."iso2" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_code_check" CHECK ("departments"."org_code" ~ '^[A-Z]{3}(-[A-Z0-9]{2,12}){0,2}$');--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_kind_check" CHECK ("projects"."kind" in ('client', 'internal'));