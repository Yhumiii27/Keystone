CREATE TABLE "machine_catalogue_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" integer NOT NULL,
	"machine_type_code" text NOT NULL,
	"variant" text,
	"label" text NOT NULL,
	"description" text,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nominal_capacity" numeric,
	"capacity_unit" text,
	"indicative_price_keur" numeric,
	"lead_time_weeks" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_catalogue_entries_code_version_unique" UNIQUE("code","version"),
	CONSTRAINT "machine_catalogue_entries_code_check" CHECK ("machine_catalogue_entries"."code" ~ '^[A-Z0-9][A-Z0-9-]{1,29}$'),
	CONSTRAINT "machine_catalogue_entries_version_check" CHECK ("machine_catalogue_entries"."version" >= 1),
	CONSTRAINT "machine_catalogue_entries_status_check" CHECK ("machine_catalogue_entries"."status" in ('draft', 'published', 'retired')),
	CONSTRAINT "machine_catalogue_entries_options_check" CHECK (jsonb_typeof("machine_catalogue_entries"."options") = 'array'),
	CONSTRAINT "machine_catalogue_entries_published_check" CHECK ("machine_catalogue_entries"."status" = 'draft' or ("machine_catalogue_entries"."published_at" is not null and "machine_catalogue_entries"."indicative_price_keur" is not null and "machine_catalogue_entries"."lead_time_weeks" is not null))
);
--> statement-breakpoint
ALTER TABLE "project_equipments" ADD COLUMN "catalogue_code" text;--> statement-breakpoint
ALTER TABLE "machine_catalogue_entries" ADD CONSTRAINT "machine_catalogue_entries_machine_type_code_machine_types_code_fk" FOREIGN KEY ("machine_type_code") REFERENCES "public"."machine_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "machine_catalogue_entries_one_draft_idx" ON "machine_catalogue_entries" USING btree ("code") WHERE "machine_catalogue_entries"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "machine_catalogue_entries_one_published_idx" ON "machine_catalogue_entries" USING btree ("code") WHERE "machine_catalogue_entries"."status" = 'published';--> statement-breakpoint
CREATE INDEX "machine_catalogue_entries_updated_at_idx" ON "machine_catalogue_entries" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "project_equipments" ADD CONSTRAINT "project_equipments_catalogue_fk" FOREIGN KEY ("catalogue_code","catalogue_version") REFERENCES "public"."machine_catalogue_entries"("code","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_equipments" ADD CONSTRAINT "project_equipments_catalogue_check" CHECK (("project_equipments"."catalogue_code" is null) = ("project_equipments"."catalogue_version" is null));