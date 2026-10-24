CREATE TABLE "capex_mirror" (
	"code" text PRIMARY KEY NOT NULL,
	"subsidiary_code" text,
	"subsidiary_name" text,
	"zone" text,
	"site" text,
	"country_iso2" text,
	"title" text NOT NULL,
	"investment_type" text,
	"status" text,
	"phase_code" text,
	"typology" text,
	"sponsor_name" text,
	"lead_name" text,
	"g1_on" date,
	"g2_on" date,
	"g3_on" date,
	"commissioning_on" date,
	"source_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capex_needs" (
	"need_ref" text PRIMARY KEY NOT NULL,
	"capex_code" text NOT NULL,
	"line" text NOT NULL,
	"catalogue_code" text,
	"catalogue_version" integer,
	"free_label" text,
	"quantity" integer NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_capacity" numeric,
	"capacity_unit" text,
	"needed_on" date,
	"site" text,
	"status" text NOT NULL,
	"comment" text,
	"submitted_at" timestamp with time zone,
	"ordered_on" date,
	"source_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capex_needs_status_check" CHECK ("capex_needs"."status" in ('submitted', 'withdrawn', 'ordered')),
	CONSTRAINT "capex_needs_quantity_check" CHECK ("capex_needs"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "capex_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"trigger" text NOT NULL,
	"ok" boolean NOT NULL,
	"capex_count" integer DEFAULT 0 NOT NULL,
	"need_count" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"error" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "need_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"need_ref" text NOT NULL,
	"capex_code" text NOT NULL,
	"nature" text NOT NULL,
	"qualification" text NOT NULL,
	"reason" text,
	"estimate_class" text,
	"central_keur" numeric,
	"low_keur" numeric,
	"high_keur" numeric,
	"lead_time_weeks" integer,
	"valid_until" date,
	"document_ref" text,
	"project_id" uuid,
	"status" text DEFAULT 'en_cours' NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_by_person_id" uuid,
	"answered_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "need_answers_number_unique" UNIQUE("number"),
	CONSTRAINT "need_answers_number_check" CHECK ("need_answers"."number" ~ '^RB-[0-9]{3,}$'),
	CONSTRAINT "need_answers_nature_check" CHECK ("need_answers"."nature" in ('qualification', 'indicatif', 'devis', 'offre_ferme')),
	CONSTRAINT "need_answers_qualification_check" CHECK ("need_answers"."qualification" in ('faisable', 'a_etudier', 'refuse')),
	CONSTRAINT "need_answers_status_check" CHECK ("need_answers"."status" in ('en_cours', 'remise', 'acceptee', 'caduque')),
	CONSTRAINT "need_answers_class_check" CHECK ("need_answers"."estimate_class" is null or "need_answers"."estimate_class" in ('E50', 'E30', 'E10')),
	CONSTRAINT "need_answers_firm_offer_check" CHECK ("need_answers"."nature" <> 'offre_ferme' or "need_answers"."estimate_class" = 'E10'),
	CONSTRAINT "need_answers_priced_check" CHECK (("need_answers"."nature" = 'qualification' and "need_answers"."central_keur" is null and "need_answers"."estimate_class" is null) or ("need_answers"."nature" <> 'qualification' and "need_answers"."central_keur" is not null and "need_answers"."estimate_class" is not null and "need_answers"."low_keur" is not null and "need_answers"."high_keur" is not null))
);
--> statement-breakpoint
ALTER TABLE "need_answers" ADD CONSTRAINT "need_answers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "need_answers" ADD CONSTRAINT "need_answers_answered_by_person_id_persons_id_fk" FOREIGN KEY ("answered_by_person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capex_needs_capex_code_idx" ON "capex_needs" USING btree ("capex_code");--> statement-breakpoint
CREATE INDEX "capex_sync_runs_synced_at_idx" ON "capex_sync_runs" USING btree ("synced_at");--> statement-breakpoint
CREATE INDEX "need_answers_need_ref_idx" ON "need_answers" USING btree ("need_ref");--> statement-breakpoint
CREATE INDEX "need_answers_updated_at_idx" ON "need_answers" USING btree ("updated_at");