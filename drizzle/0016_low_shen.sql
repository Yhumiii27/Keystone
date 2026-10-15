ALTER TABLE "audit_entries" DROP CONSTRAINT "audit_entries_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "message_key" text;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "message_params" jsonb;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "actor_user_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "before" jsonb;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "after" jsonb;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "message_key" text;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "message_params" jsonb;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;