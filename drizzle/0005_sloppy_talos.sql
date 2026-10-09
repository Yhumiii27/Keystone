CREATE TABLE "baseline_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"baseline_id" uuid NOT NULL,
	"activity_id" uuid,
	"activity_code" text NOT NULL,
	"name" text NOT NULL,
	"wbs_code" text,
	"start_date" date,
	"finish_date" date,
	"start_text" text,
	"finish_text" text,
	"duration_days" integer,
	"budget_keur" numeric,
	"percent_complete" integer,
	"total_float_days" integer,
	"position" integer NOT NULL,
	CONSTRAINT "baseline_activities_baseline_id_activity_code_unique" UNIQUE("baseline_id","activity_code")
);
--> statement-breakpoint
CREATE TABLE "whatif_scenario_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"activity_id" uuid,
	"person_id" uuid,
	"department_id" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"occurred_on" date NOT NULL,
	"channel" text NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"contact_name" text NOT NULL,
	"contact_person_id" uuid,
	"subject" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"follow_up_owner_name" text,
	"follow_up_owner_person_id" uuid,
	"follow_up_due_on" date,
	"follow_up_done_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_communications_project_id_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "calendar_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_code" text NOT NULL,
	"date" date NOT NULL,
	"working" boolean DEFAULT false NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_exceptions_calendar_code_date_unique" UNIQUE("calendar_code","date")
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"work_days" integer[] NOT NULL,
	"hours_per_day" numeric NOT NULL,
	"holiday_set" text,
	"use_settings_holidays" boolean DEFAULT true NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"project_id" uuid,
	"external_uid" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ran_by_person_id" uuid,
	"ran_by_name" text NOT NULL,
	"data_date" date NOT NULL,
	"outcome" text NOT NULL,
	"previous_finish_date" date,
	"finish_date" date,
	"changed_activities" integer DEFAULT 0 NOT NULL,
	"critical_activities" integer DEFAULT 0 NOT NULL,
	"constraint_violations" integer DEFAULT 0 NOT NULL,
	"message" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screen" text NOT NULL,
	"format" text NOT NULL,
	"variant" text,
	"project_id" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"file_name" text NOT NULL,
	"by_person_id" uuid,
	"by_name" text NOT NULL,
	"by_role" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_job_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"status" text NOT NULL,
	"action" text NOT NULL,
	"key" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"messages" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"project_id" uuid,
	"file_id" uuid,
	"file_name" text NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_by_person_id" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"previewed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"applied_by_name" text
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_path" text NOT NULL,
	"project_id" uuid,
	"owner_type" text,
	"owner_id" uuid,
	"created_by_person_id" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_files_storage_path_unique" UNIQUE("storage_path")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "data_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "displayed_baseline_code" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "planned_start_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "planned_finish_date" date;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD COLUMN "decision_comment" text;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD COLUMN "reverts_transition_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "calendar_code" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "remaining_days" integer;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "early_start_date" date;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "early_finish_date" date;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "late_start_date" date;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "late_finish_date" date;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "free_float_days" integer;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "external_uid" text;--> statement-breakpoint
ALTER TABLE "activity_assignments" ADD COLUMN "planned_hours" numeric;--> statement-breakpoint
ALTER TABLE "activity_assignments" ADD COLUMN "actual_hours" numeric;--> statement-breakpoint
ALTER TABLE "activity_assignments" ADD COLUMN "resource_count" numeric;--> statement-breakpoint
ALTER TABLE "activity_assignments" ADD COLUMN "hours_per_day" numeric;--> statement-breakpoint
ALTER TABLE "activity_assignments" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_assignments" ADD COLUMN "external_uid" text;--> statement-breakpoint
ALTER TABLE "activity_links" ADD COLUMN "is_driving" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wbs_nodes" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "wbs_nodes" ADD COLUMN "finish_date" date;--> statement-breakpoint
ALTER TABLE "wbs_nodes" ADD COLUMN "external_uid" text;--> statement-breakpoint
ALTER TABLE "baselines" ADD COLUMN "source" text DEFAULT 'snapshot' NOT NULL;--> statement-breakpoint
ALTER TABLE "baselines" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "baselines" ADD COLUMN "data_date" date;--> statement-breakpoint
ALTER TABLE "baselines" ADD COLUMN "created_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "baselines" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "baselines" ADD COLUMN "approver_person_id" uuid;--> statement-breakpoint
ALTER TABLE "baselines" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD COLUMN "scenario_id" uuid;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD COLUMN "mime" text;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "whatif_scenarios" ADD COLUMN "created_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "whatif_scenarios" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "whatif_scenarios" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "whatif_scenarios" ADD COLUMN "computed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatif_scenarios" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatif_scenarios" ADD COLUMN "applied_by_name" text;--> statement-breakpoint
ALTER TABLE "meeting_transcript_proposals" ADD COLUMN "status" text DEFAULT 'proposed' NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_transcript_proposals" ADD COLUMN "speaker" text;--> statement-breakpoint
ALTER TABLE "meeting_transcript_proposals" ADD COLUMN "quote" text;--> statement-breakpoint
ALTER TABLE "meeting_transcript_proposals" ADD COLUMN "reviewed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "meeting_transcript_proposals" ADD COLUMN "reviewed_by_name" text;--> statement-breakpoint
ALTER TABLE "meeting_transcript_proposals" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting_transcript_proposals" ADD COLUMN "applied_ref" text;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD COLUMN "analyzer" text;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD COLUMN "analyzer_model" text;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD COLUMN "analysis_notice" text;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD COLUMN "imported_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD COLUMN "imported_by_name" text;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "configured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "configured_by_name" text;--> statement-breakpoint
ALTER TABLE "baseline_activities" ADD CONSTRAINT "baseline_activities_baseline_id_baselines_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."baselines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_activities" ADD CONSTRAINT "baseline_activities_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatif_scenario_actions" ADD CONSTRAINT "whatif_scenario_actions_scenario_id_whatif_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."whatif_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatif_scenario_actions" ADD CONSTRAINT "whatif_scenario_actions_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatif_scenario_actions" ADD CONSTRAINT "whatif_scenario_actions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatif_scenario_actions" ADD CONSTRAINT "whatif_scenario_actions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_communications" ADD CONSTRAINT "client_communications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_communications" ADD CONSTRAINT "client_communications_contact_person_id_persons_id_fk" FOREIGN KEY ("contact_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_communications" ADD CONSTRAINT "client_communications_follow_up_owner_person_id_persons_id_fk" FOREIGN KEY ("follow_up_owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_communications" ADD CONSTRAINT "client_communications_created_by_person_id_persons_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_exceptions" ADD CONSTRAINT "calendar_exceptions_calendar_code_calendars_code_fk" FOREIGN KEY ("calendar_code") REFERENCES "public"."calendars"("code") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_runs" ADD CONSTRAINT "schedule_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_runs" ADD CONSTRAINT "schedule_runs_ran_by_person_id_persons_id_fk" FOREIGN KEY ("ran_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_log" ADD CONSTRAINT "export_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_log" ADD CONSTRAINT "export_log_by_person_id_persons_id_fk" FOREIGN KEY ("by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_person_id_persons_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_created_by_person_id_persons_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_reverts_transition_id_stage_transitions_id_fk" FOREIGN KEY ("reverts_transition_id") REFERENCES "public"."stage_transitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_assignments" ADD CONSTRAINT "activity_assignments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_created_by_person_id_persons_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_approver_person_id_persons_id_fk" FOREIGN KEY ("approver_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_requests" ADD CONSTRAINT "resource_requests_scenario_id_whatif_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."whatif_scenarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatif_scenarios" ADD CONSTRAINT "whatif_scenarios_created_by_person_id_persons_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_transcript_proposals" ADD CONSTRAINT "meeting_transcript_proposals_reviewed_by_person_id_persons_id_fk" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD CONSTRAINT "meeting_transcripts_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD CONSTRAINT "meeting_transcripts_imported_by_person_id_persons_id_fk" FOREIGN KEY ("imported_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;