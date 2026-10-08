CREATE TABLE "contingency_draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"register_id" uuid NOT NULL,
	"drawn_on" date NOT NULL,
	"amount_keur" numeric NOT NULL,
	"reason" text NOT NULL,
	"link_ref" text,
	"linked_entity_type" text,
	"linked_entity_id" uuid,
	"approved_by_person_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contingency_registers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"initial_keur" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contingency_registers_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"probability" integer NOT NULL,
	"impact" integer NOT NULL,
	"owner_person_id" uuid,
	"response" text NOT NULL,
	"response_plan" text NOT NULL,
	"activity_id" uuid,
	"emv_keur" numeric NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"trend" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risks_project_id_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "status_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"period" text NOT NULL,
	"audience" text NOT NULL,
	"sections" text NOT NULL,
	"note" text,
	"status_date" date NOT NULL,
	"generated_by_person_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"week_code" text NOT NULL,
	"status_date" date NOT NULL,
	"cpi" numeric NOT NULL,
	"spi" numeric NOT NULL,
	"eac_keur" numeric NOT NULL,
	"float_days" integer NOT NULL,
	"risk_emv_keur" numeric NOT NULL,
	"milestone_slip_days" integer NOT NULL,
	"frozen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_snapshots_project_id_week_code_unique" UNIQUE("project_id","week_code")
);
--> statement-breakpoint
CREATE TABLE "request_activity_choices" (
	"project_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "request_activity_choices_project_id_activity_id_pk" PRIMARY KEY("project_id","activity_id")
);
--> statement-breakpoint
CREATE TABLE "resource_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"action" text NOT NULL,
	"on_date" date NOT NULL,
	"by_person_id" uuid,
	"note" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"requested_by_person_id" uuid NOT NULL,
	"person_id" uuid,
	"contract_role" text,
	"department_id" uuid NOT NULL,
	"title" text NOT NULL,
	"activity_id" uuid,
	"hours" numeric NOT NULL,
	"start_date" date NOT NULL,
	"due_date" date NOT NULL,
	"priority" text NOT NULL,
	"status" text NOT NULL,
	"sent_on" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"response" text DEFAULT '' NOT NULL,
	"proposed_start" date,
	"proposed_due" date,
	"task_id" uuid,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_requests_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "task_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"name" text NOT NULL,
	"size_text" text NOT NULL,
	"uploaded_by_person_id" uuid,
	"uploaded_on" date NOT NULL,
	"kind" text NOT NULL,
	"storage_ref" text,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"done" boolean NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_person_id" uuid NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"text" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"assignee_person_id" uuid,
	"contract_role" text,
	"title" text NOT NULL,
	"description" text,
	"project_id" uuid NOT NULL,
	"activity_id" uuid,
	"status" text NOT NULL,
	"priority" text NOT NULL,
	"start_date" date NOT NULL,
	"due_date" date NOT NULL,
	"estimate_h" numeric NOT NULL,
	"logged_h" numeric NOT NULL,
	"percent_complete" integer NOT NULL,
	"labels" text[] NOT NULL,
	"checklist_done" integer DEFAULT 0 NOT NULL,
	"checklist_total" integer DEFAULT 0 NOT NULL,
	"is_fresh" boolean DEFAULT false NOT NULL,
	"department_id" uuid,
	"source_request_id" uuid,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"person_id" uuid,
	"work_date" date NOT NULL,
	"hours" numeric NOT NULL,
	"note" text NOT NULL,
	"source" text DEFAULT 'keystone' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"load_pct" numeric NOT NULL,
	"project_id" uuid,
	CONSTRAINT "allocations_person_id_week_start_project_id_unique" UNIQUE NULLS NOT DISTINCT("person_id","week_start","project_id")
);
--> statement-breakpoint
CREATE TABLE "certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"expires_on" date,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hours_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"analytic_code" text NOT NULL,
	"period_start" date NOT NULL,
	"imported_on" date NOT NULL,
	"source" text DEFAULT 'lucca' NOT NULL,
	"matching_mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hours_imports_project_id_period_start_unique" UNIQUE("project_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "hours_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"wbs_node_id" uuid,
	"wbs_label" text NOT NULL,
	"planned_h" numeric NOT NULL,
	"declared_h" numeric NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_title_rates" (
	"job_title" text PRIMARY KEY NOT NULL,
	"rate_eur" numeric NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"leave_type" text NOT NULL,
	"week_start" date NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"source" text DEFAULT 'lucca' NOT NULL,
	"external_id" text
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"days_per_week" integer NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_skills" (
	"person_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"level" integer NOT NULL,
	CONSTRAINT "person_skills_person_id_skill_id_pk" PRIMARY KEY("person_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text DEFAULT 'FR' NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "public_holidays_country_code_date_unique" UNIQUE("country_code","date")
);
--> statement-breakpoint
CREATE TABLE "rate_multipliers" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"factor" numeric NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"base_rate_eur" numeric NOT NULL,
	"is_external" boolean NOT NULL,
	"cost_center" text,
	"grade" text,
	"effective_from" date,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_roles_role_unique" UNIQUE("role")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"position" integer NOT NULL,
	CONSTRAINT "skills_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "unassigned_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"hours" numeric NOT NULL,
	"reason" text NOT NULL,
	"assigned_wbs_node_id" uuid,
	"assigned_at" timestamp with time zone,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatif_auto_levers" (
	"priority" text NOT NULL,
	"lever_code" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "whatif_auto_levers_priority_lever_code_pk" PRIMARY KEY("priority","lever_code")
);
--> statement-breakpoint
CREATE TABLE "whatif_contexts" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"peak_load" integer[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatif_levers" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"float_days" integer NOT NULL,
	"cost_keur" numeric NOT NULL,
	"peak_pts" integer NOT NULL,
	"over_people" integer NOT NULL,
	"side_effect" text,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatif_scenario_levers" (
	"scenario_id" uuid NOT NULL,
	"lever_code" text NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "whatif_scenario_levers_scenario_id_lever_code_pk" PRIMARY KEY("scenario_id","lever_code")
);
--> statement-breakpoint
CREATE TABLE "whatif_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" text NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"basis" text,
	"horizon_months" integer,
	"hypotheses" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatif_scenarios_project_id_name_unique" UNIQUE("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_person_id" uuid,
	"actor_name" text NOT NULL,
	"text" text NOT NULL,
	"kind" text NOT NULL,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_person_id" uuid,
	"actor_name" text NOT NULL,
	"object_ref" text NOT NULL,
	"change" text NOT NULL,
	"area" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"project_id" uuid
);
--> statement-breakpoint
CREATE TABLE "notification_recipients" (
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notification_recipients_notification_id_user_id_pk" PRIMARY KEY("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"project_id" uuid,
	"target_screen" text NOT NULL,
	"target_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audience_roles" text[] NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "resource_pool_position" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "short_name" text;--> statement-breakpoint
ALTER TABLE "change_request_steps" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contingency_draws" ADD CONSTRAINT "contingency_draws_register_id_contingency_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."contingency_registers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contingency_draws" ADD CONSTRAINT "contingency_draws_approved_by_person_id_persons_id_fk" FOREIGN KEY ("approved_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contingency_registers" ADD CONSTRAINT "contingency_registers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_reports" ADD CONSTRAINT "status_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_reports" ADD CONSTRAINT "status_reports_generated_by_person_id_persons_id_fk" FOREIGN KEY ("generated_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_snapshots" ADD CONSTRAINT "status_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_activity_choices" ADD CONSTRAINT "request_activity_choices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_activity_choices" ADD CONSTRAINT "request_activity_choices_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_request_events" ADD CONSTRAINT "resource_request_events_request_id_resource_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."resource_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_request_events" ADD CONSTRAINT "resource_request_events_by_person_id_persons_id_fk" FOREIGN KEY ("by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_requested_by_person_id_persons_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_uploaded_by_person_id_persons_id_fk" FOREIGN KEY ("uploaded_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_person_id_persons_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_person_id_persons_id_fk" FOREIGN KEY ("assignee_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_request_id_resource_requests_id_fk" FOREIGN KEY ("source_request_id") REFERENCES "public"."resource_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hours_imports" ADD CONSTRAINT "hours_imports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hours_lines" ADD CONSTRAINT "hours_lines_import_id_hours_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."hours_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hours_lines" ADD CONSTRAINT "hours_lines_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hours_lines" ADD CONSTRAINT "hours_lines_wbs_node_id_wbs_nodes_id_fk" FOREIGN KEY ("wbs_node_id") REFERENCES "public"."wbs_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_leave_type_leave_types_code_fk" FOREIGN KEY ("leave_type") REFERENCES "public"."leave_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_skills" ADD CONSTRAINT "person_skills_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_skills" ADD CONSTRAINT "person_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unassigned_hours" ADD CONSTRAINT "unassigned_hours_import_id_hours_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."hours_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unassigned_hours" ADD CONSTRAINT "unassigned_hours_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unassigned_hours" ADD CONSTRAINT "unassigned_hours_assigned_wbs_node_id_wbs_nodes_id_fk" FOREIGN KEY ("assigned_wbs_node_id") REFERENCES "public"."wbs_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatif_auto_levers" ADD CONSTRAINT "whatif_auto_levers_lever_code_whatif_levers_code_fk" FOREIGN KEY ("lever_code") REFERENCES "public"."whatif_levers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatif_contexts" ADD CONSTRAINT "whatif_contexts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatif_scenario_levers" ADD CONSTRAINT "whatif_scenario_levers_scenario_id_whatif_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."whatif_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatif_scenario_levers" ADD CONSTRAINT "whatif_scenario_levers_lever_code_whatif_levers_code_fk" FOREIGN KEY ("lever_code") REFERENCES "public"."whatif_levers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatif_scenarios" ADD CONSTRAINT "whatif_scenarios_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;