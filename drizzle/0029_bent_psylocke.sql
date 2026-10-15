CREATE TABLE "itp_plan_systems" (
	"plan_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "itp_plan_systems_plan_id_position_pk" PRIMARY KEY("plan_id","position"),
	CONSTRAINT "itp_plan_systems_plan_id_name_unique" UNIQUE("plan_id","name")
);
--> statement-breakpoint
CREATE TABLE "site_conflict_arbitrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"conflict_key" text NOT NULL,
	"person_name" text NOT NULL,
	"kind" text NOT NULL,
	"comment" text NOT NULL,
	"arbitrated_by_name" text NOT NULL,
	"arbitrated_by_person_id" uuid,
	"arbitrated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_conflict_arbitrations_project_id_conflict_key_unique" UNIQUE("project_id","conflict_key")
);
--> statement-breakpoint
ALTER TABLE "punch_items" DROP CONSTRAINT "punch_items_project_id_register_number_unique";--> statement-breakpoint
ALTER TABLE "itp_plan_systems" ADD CONSTRAINT "itp_plan_systems_plan_id_itp_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."itp_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_conflict_arbitrations" ADD CONSTRAINT "site_conflict_arbitrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_conflict_arbitrations" ADD CONSTRAINT "site_conflict_arbitrations_arbitrated_by_person_id_persons_id_fk" FOREIGN KEY ("arbitrated_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_items" ADD CONSTRAINT "punch_items_project_id_number_unique" UNIQUE("project_id","number");