CREATE TABLE "ce_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ce_checklist_items_kind_code_unique" UNIQUE("kind","code"),
	CONSTRAINT "ce_checklist_items_kind_check" CHECK ("ce_checklist_items"."kind" in ('ehsr', 'techfile'))
);
--> statement-breakpoint
CREATE TABLE "ce_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"regime" text,
	"category" text,
	"route" text,
	"risk_assessment_ref" text,
	"standards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"instructions_ref" text,
	"declaration_signatory" text,
	"declaration_on" date,
	"declaration_ref" text,
	"ce_marking_on" date,
	"ehsr" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tech_file" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ce_files_equipment_unique" UNIQUE("equipment_id"),
	CONSTRAINT "ce_files_regime_check" CHECK ("ce_files"."regime" is null or "ce_files"."regime" in ('machinery', 'partly_completed')),
	CONSTRAINT "ce_files_category_check" CHECK ("ce_files"."category" is null or "ce_files"."category" in ('not_listed', 'annex_i_a', 'annex_i_b')),
	CONSTRAINT "ce_files_route_check" CHECK ("ce_files"."route" is null or "ce_files"."route" in ('module_a', 'module_b_c', 'module_h', 'module_g')),
	CONSTRAINT "ce_files_partly_completed_check" CHECK ("ce_files"."regime" is distinct from 'partly_completed' or ("ce_files"."route" is null and "ce_files"."ce_marking_on" is null))
);
--> statement-breakpoint
ALTER TABLE "ce_files" ADD CONSTRAINT "ce_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ce_files" ADD CONSTRAINT "ce_files_equipment_id_project_equipments_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."project_equipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ce_files_project_id_idx" ON "ce_files" USING btree ("project_id");