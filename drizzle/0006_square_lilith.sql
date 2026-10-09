CREATE TABLE "plan_trash" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"activity_count" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by_person_id" uuid,
	"deleted_by_name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_trash" ADD CONSTRAINT "plan_trash_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_trash" ADD CONSTRAINT "plan_trash_deleted_by_person_id_persons_id_fk" FOREIGN KEY ("deleted_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_trash_project_idx" ON "plan_trash" USING btree ("project_id","deleted_at");