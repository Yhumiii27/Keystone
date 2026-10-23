CREATE TABLE "project_equipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"machine_type_code" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"label" text,
	"position" integer NOT NULL,
	"capacity_value" numeric,
	"capacity_unit" text,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"besoin_ref" text,
	"catalogue_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_equipments_project_ref_unique" UNIQUE("project_id","ref"),
	CONSTRAINT "project_equipments_ref_check" CHECK ("project_equipments"."ref" ~ '^EQ-[0-9]{2,}$'),
	CONSTRAINT "project_equipments_quantity_check" CHECK ("project_equipments"."quantity" >= 1),
	CONSTRAINT "project_equipments_besoin_ref_check" CHECK ("project_equipments"."besoin_ref" is null or "project_equipments"."besoin_ref" ~ '^CPX-[A-Z]{3}-[0-9]{4}-[0-9]{2,}/B[0-9]{2,}$'),
	CONSTRAINT "project_equipments_options_check" CHECK (jsonb_typeof("project_equipments"."options") = 'array')
);
--> statement-breakpoint
ALTER TABLE "machine_type_phases" ADD COLUMN "per_equipment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "equipment_id" uuid;--> statement-breakpoint
ALTER TABLE "wbs_nodes" ADD COLUMN "equipment_id" uuid;--> statement-breakpoint
ALTER TABLE "project_equipments" ADD CONSTRAINT "project_equipments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_equipments" ADD CONSTRAINT "project_equipments_machine_type_code_machine_types_code_fk" FOREIGN KEY ("machine_type_code") REFERENCES "public"."machine_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_equipment_id_project_equipments_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."project_equipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wbs_nodes" ADD CONSTRAINT "wbs_nodes_equipment_id_project_equipments_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."project_equipments"("id") ON DELETE set null ON UPDATE no action;