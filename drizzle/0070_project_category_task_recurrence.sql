ALTER TABLE "projects" ADD COLUMN "category" text DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_kind" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_interval" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_anchor" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_until" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_previous_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_previous_task_id_tasks_id_fk" FOREIGN KEY ("recurrence_previous_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_recurrence_previous_task_id_unique" ON "tasks" USING btree ("recurrence_previous_task_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_category_check" CHECK ("projects"."category" in ('client', 'rd'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_kind_check" CHECK ("tasks"."recurrence_kind" in ('weekly', 'monthly', 'milestone'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_rule_check" CHECK (("tasks"."recurrence_kind" is null) = ("tasks"."recurrence_anchor" is null) and ("tasks"."recurrence_kind" is null) = ("tasks"."recurrence_interval" is null) and ("tasks"."recurrence_interval" is null or "tasks"."recurrence_interval" between 1 and 12));