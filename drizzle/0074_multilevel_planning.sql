CREATE TABLE "activity_code_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"value_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_code_assignments_activity_id_type_id_unique" UNIQUE("activity_id","type_id")
);
--> statement-breakpoint
CREATE TABLE "activity_code_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_code_types_project_id_name_unique" UNIQUE("project_id","name"),
	CONSTRAINT "activity_code_types_kind_check" CHECK ("activity_code_types"."kind" in ('site', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "activity_code_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_code_values_type_id_code_unique" UNIQUE("type_id","code")
);
--> statement-breakpoint
CREATE TABLE "supplier_schedule_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"duration_days" integer NOT NULL,
	"committed_start" date,
	"committed_finish" date,
	"actual_start" date,
	"actual_finish" date,
	"percent_complete" integer DEFAULT 0 NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_schedule_activities_schedule_id_code_unique" UNIQUE("schedule_id","code"),
	CONSTRAINT "supplier_schedule_activities_pct_check" CHECK ("supplier_schedule_activities"."percent_complete" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "supplier_schedule_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"predecessor_id" uuid NOT NULL,
	"successor_id" uuid NOT NULL,
	"type" text NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "supplier_schedule_links_predecessor_id_successor_id_unique" UNIQUE("predecessor_id","successor_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_schedule_ties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"supplier_activity_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "supplier_schedule_ties_supplier_activity_id_activity_id_unique" UNIQUE("supplier_activity_id","activity_id"),
	CONSTRAINT "supplier_schedule_ties_direction_check" CHECK ("supplier_schedule_ties"."direction" in ('to_project', 'from_project'))
);
--> statement-breakpoint
CREATE TABLE "supplier_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_schedules_po_id_unique" UNIQUE("po_id")
);
--> statement-breakpoint
ALTER TABLE "activity_code_assignments" ADD CONSTRAINT "activity_code_assignments_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_code_assignments" ADD CONSTRAINT "activity_code_assignments_type_id_activity_code_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."activity_code_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_code_assignments" ADD CONSTRAINT "activity_code_assignments_value_id_activity_code_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."activity_code_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_code_types" ADD CONSTRAINT "activity_code_types_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_code_values" ADD CONSTRAINT "activity_code_values_type_id_activity_code_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."activity_code_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_schedule_activities" ADD CONSTRAINT "supplier_schedule_activities_schedule_id_supplier_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."supplier_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_schedule_links" ADD CONSTRAINT "supplier_schedule_links_schedule_id_supplier_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."supplier_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_schedule_links" ADD CONSTRAINT "supplier_schedule_links_predecessor_id_supplier_schedule_activities_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."supplier_schedule_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_schedule_links" ADD CONSTRAINT "supplier_schedule_links_successor_id_supplier_schedule_activities_id_fk" FOREIGN KEY ("successor_id") REFERENCES "public"."supplier_schedule_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_schedule_ties" ADD CONSTRAINT "supplier_schedule_ties_schedule_id_supplier_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."supplier_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_schedule_ties" ADD CONSTRAINT "supplier_schedule_ties_supplier_activity_id_supplier_schedule_activities_id_fk" FOREIGN KEY ("supplier_activity_id") REFERENCES "public"."supplier_schedule_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_schedule_ties" ADD CONSTRAINT "supplier_schedule_ties_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_schedules" ADD CONSTRAINT "supplier_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_schedules" ADD CONSTRAINT "supplier_schedules_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_schedules" ADD CONSTRAINT "supplier_schedules_created_by_person_id_persons_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_code_assignments_value_id_idx" ON "activity_code_assignments" USING btree ("value_id");--> statement-breakpoint
CREATE INDEX "activity_code_assignments_type_id_idx" ON "activity_code_assignments" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "supplier_schedule_links_schedule_id_idx" ON "supplier_schedule_links" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "supplier_schedule_links_successor_id_idx" ON "supplier_schedule_links" USING btree ("successor_id");--> statement-breakpoint
CREATE INDEX "supplier_schedule_ties_schedule_id_idx" ON "supplier_schedule_ties" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "supplier_schedule_ties_activity_id_idx" ON "supplier_schedule_ties" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "supplier_schedules_project_id_idx" ON "supplier_schedules" USING btree ("project_id");