CREATE TABLE "machine_type_cost_categories" (
	"machine_type_code" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"cost_type" text NOT NULL,
	"budget_keur" numeric NOT NULL,
	CONSTRAINT "machine_type_cost_categories_machine_type_code_position_pk" PRIMARY KEY("machine_type_code","position")
);
--> statement-breakpoint
CREATE TABLE "machine_type_itp_systems" (
	"machine_type_code" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "machine_type_itp_systems_machine_type_code_position_pk" PRIMARY KEY("machine_type_code","position")
);
--> statement-breakpoint
CREATE TABLE "machine_type_phases" (
	"machine_type_code" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "machine_type_phases_machine_type_code_position_pk" PRIMARY KEY("machine_type_code","position")
);
--> statement-breakpoint
CREATE TABLE "closure_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"item" text NOT NULL,
	"owner_name" text NOT NULL,
	"owner_person_id" uuid,
	"status" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closure_items_project_id_position_unique" UNIQUE("project_id","position")
);
--> statement-breakpoint
CREATE TABLE "commissioning_steps" (
	"system_id" uuid NOT NULL,
	"step" text NOT NULL,
	"status" text NOT NULL,
	"date_on" date,
	"blocking_ref" text,
	"position" integer NOT NULL,
	CONSTRAINT "commissioning_steps_system_id_step_unique" UNIQUE("system_id","step")
);
--> statement-breakpoint
CREATE TABLE "commissioning_systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "commissioning_systems_project_id_name_unique" UNIQUE("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "handover_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"item" text NOT NULL,
	"document_type_code" text NOT NULL,
	"document_ref" text,
	"document_id" uuid,
	"status" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "handover_items_project_id_position_unique" UNIQUE("project_id","position")
);
--> statement-breakpoint
CREATE TABLE "itp_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"number" text NOT NULL,
	"system" text NOT NULL,
	"name" text NOT NULL,
	"point_type" text NOT NULL,
	"stage" text NOT NULL,
	"reference" text NOT NULL,
	"planned_on" date,
	"result" text NOT NULL,
	"record_ref" text,
	"record_document_id" uuid,
	"is_custom" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itp_inspections_plan_id_number_unique" UNIQUE("plan_id","number")
);
--> statement-breakpoint
CREATE TABLE "itp_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"machine_type_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itp_plans_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "lessons_learned" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"theme" text NOT NULL,
	"what_happened" text NOT NULL,
	"impact" text NOT NULL,
	"recommendation" text NOT NULL,
	"applies_to" text NOT NULL,
	"status" text NOT NULL,
	"raised_by_name" text,
	"raised_by_person_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_learned_project_id_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "punch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"register" text NOT NULL,
	"number" text NOT NULL,
	"description" text NOT NULL,
	"location" text NOT NULL,
	"category" text,
	"source" text,
	"source_inspection_id" uuid,
	"ncr_number" text,
	"owner_name" text,
	"owner_person_id" uuid,
	"owner_party" text,
	"due_on" date,
	"status" text NOT NULL,
	"closed_on" date,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "punch_items_project_id_register_number_unique" UNIQUE("project_id","register","number")
);
--> statement-breakpoint
CREATE TABLE "sat_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"system_name" text NOT NULL,
	"planned_on" date NOT NULL,
	"client_witnesses" text NOT NULL,
	"prerequisites" text NOT NULL,
	"planned_by_name" text NOT NULL,
	"planned_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "satisfaction_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"criterion" text NOT NULL,
	"score" numeric NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "satisfaction_scores_project_id_criterion_unique" UNIQUE("project_id","criterion")
);
--> statement-breakpoint
CREATE TABLE "vigie_hse_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_code" text NOT NULL,
	"vigie_ref" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"status_text" text,
	"date_on" date,
	"position" integer NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vigie_hse_items_project_code_position_unique" UNIQUE("project_code","position")
);
--> statement-breakpoint
CREATE TABLE "vigie_ncr_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ncr_id" uuid NOT NULL,
	"project_code" text NOT NULL,
	"ncr_number" text NOT NULL,
	"kind" text NOT NULL,
	"decision" text,
	"from_status" text NOT NULL,
	"target_status" text NOT NULL,
	"comment" text,
	"actor_name" text NOT NULL,
	"actor_person_id" uuid,
	"actor_role" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"sync_status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"vigie_ref" text
);
--> statement-breakpoint
CREATE TABLE "vigie_ncrs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_code" text NOT NULL,
	"number" text NOT NULL,
	"vigie_ref" text,
	"title" text NOT NULL,
	"severity" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"activity_code" text,
	"part_ref" text,
	"deliverable_number" text,
	"supplier_name" text,
	"raised_by_name" text NOT NULL,
	"raised_by_person_id" uuid,
	"raised_on" date NOT NULL,
	"owner_name" text NOT NULL,
	"owner_person_id" uuid,
	"root_cause" text NOT NULL,
	"action" text NOT NULL,
	"due_on" date,
	"cost_keur" numeric NOT NULL,
	"iso_clause" text NOT NULL,
	"position" integer NOT NULL,
	"vigie_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vigie_ncrs_project_code_number_unique" UNIQUE("project_code","number")
);
--> statement-breakpoint
CREATE TABLE "deliverable_raci" (
	"deliverable_id" uuid NOT NULL,
	"raci_role" text NOT NULL,
	"name" text NOT NULL,
	"person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliverable_raci_deliverable_id_raci_role_unique" UNIQUE("deliverable_id","raci_role")
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"deliverable_type" text NOT NULL,
	"wbs_code" text NOT NULL,
	"wbs_node_id" uuid,
	"due_on" date NOT NULL,
	"status" text NOT NULL,
	"revision" text,
	"issue_on" date,
	"submitted_on" date,
	"acceptance_due_on" date,
	"accepted_on" date,
	"accepted_by_person_id" uuid,
	"accepted_by_name" text,
	"rejected_on" date,
	"rejected_by_person_id" uuid,
	"review_comments" text,
	"document_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliverables_project_id_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"machine_id" uuid NOT NULL,
	"claim_id" uuid,
	"intervention_type" text NOT NULL,
	"type_detail" text,
	"scheduled_on" date NOT NULL,
	"technicians" text NOT NULL,
	"duration_days" numeric NOT NULL,
	"status" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interventions_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "machine_part_revisions" (
	"machine_id" uuid NOT NULL,
	"part_ref" text NOT NULL,
	"revision" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "machine_part_revisions_machine_id_part_ref_unique" UNIQUE("machine_id","part_ref")
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"machine_type_code" text NOT NULL,
	"name" text NOT NULL,
	"client_name" text NOT NULL,
	"client_id" uuid,
	"site_text" text NOT NULL,
	"project_code" text,
	"project_id" uuid,
	"delivered_on" date,
	"warranty_end_on" date,
	"warranty_status" text NOT NULL,
	"extended_until" date,
	"generation" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machines_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "warranty_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"machine_id" uuid NOT NULL,
	"issue" text NOT NULL,
	"description" text,
	"severity" text NOT NULL,
	"reported_on" date NOT NULL,
	"status" text NOT NULL,
	"coverage" text NOT NULL,
	"cost_keur" numeric NOT NULL,
	"eco_number" text,
	"owner_name" text NOT NULL,
	"owner_person_id" uuid,
	"next_step" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warranty_claims_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "daily_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"report_on" date NOT NULL,
	"activity_label" text NOT NULL,
	"activity_id" uuid,
	"percent_complete" numeric,
	"text" text NOT NULL,
	"link_ref" text,
	"author_name" text NOT NULL,
	"author_person_id" uuid,
	"weather" text,
	"headcount" integer,
	"hse_incident" text,
	"from_form" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_reports_project_id_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "mission_cost_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"budget_keur" numeric NOT NULL,
	"actual_keur" numeric NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "mission_cost_lines_project_id_position_unique" UNIQUE("project_id","position")
);
--> statement-breakpoint
CREATE TABLE "site_collisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"person_name" text NOT NULL,
	"person_id" uuid,
	"description" text NOT NULL,
	"kind" text NOT NULL,
	"proposed_fix" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"position" integer NOT NULL,
	CONSTRAINT "site_collisions_project_id_position_unique" UNIQUE("project_id","position")
);
--> statement-breakpoint
CREATE TABLE "site_equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"note" text NOT NULL,
	"confirmed_on" date,
	"confirmed_by_person_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_equipment_project_id_position_unique" UNIQUE("project_id","position")
);
--> statement-breakpoint
CREATE TABLE "site_prerequisites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"activity_code" text NOT NULL,
	"activity_id" uuid,
	"needed_by" date NOT NULL,
	"status" text NOT NULL,
	"evidence" text NOT NULL,
	"confirmed_on" date,
	"signed_on" date,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_prerequisites_project_id_position_unique" UNIQUE("project_id","position")
);
--> statement-breakpoint
CREATE TABLE "site_rotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"person_name" text NOT NULL,
	"person_id" uuid,
	"role_on_site" text NOT NULL,
	"from_on" date NOT NULL,
	"to_on" date NOT NULL,
	"lodging" text NOT NULL,
	"travel" text NOT NULL,
	"rotation_no" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "site_rotations_project_id_position_unique" UNIQUE("project_id","position")
);
--> statement-breakpoint
CREATE TABLE "site_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"site_name" text NOT NULL,
	"country" text NOT NULL,
	"time_zone" text NOT NULL,
	"language" text NOT NULL,
	"currency" text NOT NULL,
	"client_contact" text NOT NULL,
	"working_hours" text NOT NULL,
	"local_holidays" text NOT NULL,
	"access_constraints" text NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL,
	"done_days" integer NOT NULL,
	"plan_days" integer NOT NULL,
	"man_days_planned" integer NOT NULL,
	"cursus_chantier_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_sheets_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "cursus_clearances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_code" text NOT NULL,
	"chantier_id" text,
	"matricule" text,
	"person_name" text NOT NULL,
	"person_id" uuid,
	"visa" text NOT NULL,
	"vaccination" text NOT NULL,
	"clearance" text NOT NULL,
	"clearance_note" text NOT NULL,
	"verdict" text NOT NULL,
	"reason_codes" text[] DEFAULT '{}' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"position" integer NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cursus_clearances_project_code_person_name_unique" UNIQUE("project_code","person_name")
);
--> statement-breakpoint
CREATE TABLE "cursus_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_code" text NOT NULL,
	"kind" text NOT NULL,
	"person_name" text NOT NULL,
	"matricule" text,
	"clearance_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_name" text NOT NULL,
	"actor_person_id" uuid,
	"actor_role" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"requested_on" date NOT NULL,
	"sync_status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"cursus_ref" text
);
--> statement-breakpoint
CREATE TABLE "cursus_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_code" text NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"volume" integer NOT NULL,
	"mode" text NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "client_document_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"file_count_text" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "client_document_categories_project_id_position_unique" UNIQUE("project_id","position")
);
--> statement-breakpoint
CREATE TABLE "client_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"raised_on" date NOT NULL,
	"raised_by_name" text NOT NULL,
	"raised_by_person_id" uuid,
	"status" text NOT NULL,
	"response" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_issues_project_id_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "eng_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"changed_on" date NOT NULL,
	"text" text NOT NULL,
	"recipients" text[] NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eng_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"rule_pair" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"owner" text NOT NULL,
	"status" text NOT NULL,
	"resolution_note" text DEFAULT '' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_name" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eng_checks_project_id_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "eng_column_mappings" (
	"position" integer PRIMARY KEY NOT NULL,
	"source_column" text NOT NULL,
	"target_field" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eng_consistency_rules" (
	"pair" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eng_disciplines" (
	"code" text PRIMARY KEY NOT NULL,
	"icon" text NOT NULL,
	"lead_name" text NOT NULL,
	"lead_person_id" uuid,
	"tools" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eng_import_deltas" (
	"position" integer PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eng_import_tools" (
	"position" integer PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"discipline" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eng_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"consumer" text NOT NULL,
	"document_number" text NOT NULL,
	"revision" text NOT NULL,
	"tool_position" integer NOT NULL,
	"file_name" text NOT NULL,
	"rows" integer NOT NULL,
	"imported_by_name" text NOT NULL,
	"imported_by_person_id" uuid,
	"imported_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eng_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"consumer" text NOT NULL,
	"document_number" text NOT NULL,
	"document_id" uuid,
	"provider_party" text,
	"external_title" text,
	"revision_in_use" text NOT NULL,
	"acknowledged" boolean NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_person_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eng_inputs_project_id_consumer_document_number_unique" UNIQUE("project_id","consumer","document_number")
);
--> statement-breakpoint
CREATE TABLE "eng_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"discipline" text NOT NULL,
	"name" text NOT NULL,
	"recipients" text[] NOT NULL,
	"source" text NOT NULL,
	"state" text NOT NULL,
	"generated_at" timestamp with time zone,
	"generated_format" text,
	"generated_by_name" text,
	"position" integer NOT NULL,
	CONSTRAINT "eng_outputs_project_id_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "pid_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"document_number" text NOT NULL,
	"document_id" uuid,
	"revision" text NOT NULL,
	"issued_on" date NOT NULL,
	"sheet_count" integer NOT NULL,
	"author_name" text NOT NULL,
	"author_person_id" uuid,
	"checker_name" text NOT NULL,
	"checker_person_id" uuid,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pid_sheets_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "pid_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"description" text NOT NULL,
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"part_ref" text,
	"note" text NOT NULL,
	"activity_code" text NOT NULL,
	"activity_id" uuid,
	"plc_type" text,
	"state_feedback" text NOT NULL,
	"role" text NOT NULL,
	"sheet" integer NOT NULL,
	"mapped_at" timestamp with time zone,
	"mapped_by_name" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pid_tags_project_id_tag_unique" UNIQUE("project_id","tag")
);
--> statement-breakpoint
CREATE TABLE "pid_validation_steps" (
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"state" text NOT NULL,
	"date_on" date,
	"who" text NOT NULL,
	CONSTRAINT "pid_validation_steps_project_id_position_pk" PRIMARY KEY("project_id","position")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_name" text,
	"updated_by_person_id" uuid
);
--> statement-breakpoint
CREATE TABLE "connector_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean NOT NULL,
	"volume" text NOT NULL,
	"error" text,
	"requested_by_name" text
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"data_scope" text NOT NULL,
	"frequency" text NOT NULL,
	"direction" text,
	"status" text NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_volume" text NOT NULL,
	"owner_name" text,
	"added_in_keystone" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connectors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "import_formats" (
	"position" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text NOT NULL,
	"direction" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_key" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_default" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_values_list_key_code_unique" UNIQUE("list_key","code")
);
--> statement-breakpoint
ALTER TABLE "machine_types" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "machine_types" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "machine_types" ADD COLUMN "calendar" text;--> statement-breakpoint
ALTER TABLE "machine_type_cost_categories" ADD CONSTRAINT "machine_type_cost_categories_machine_type_code_machine_types_code_fk" FOREIGN KEY ("machine_type_code") REFERENCES "public"."machine_types"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_type_itp_systems" ADD CONSTRAINT "machine_type_itp_systems_machine_type_code_machine_types_code_fk" FOREIGN KEY ("machine_type_code") REFERENCES "public"."machine_types"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_type_phases" ADD CONSTRAINT "machine_type_phases_machine_type_code_machine_types_code_fk" FOREIGN KEY ("machine_type_code") REFERENCES "public"."machine_types"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closure_items" ADD CONSTRAINT "closure_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closure_items" ADD CONSTRAINT "closure_items_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissioning_steps" ADD CONSTRAINT "commissioning_steps_system_id_commissioning_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."commissioning_systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissioning_systems" ADD CONSTRAINT "commissioning_systems_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_items" ADD CONSTRAINT "handover_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_items" ADD CONSTRAINT "handover_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD CONSTRAINT "itp_inspections_plan_id_itp_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."itp_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD CONSTRAINT "itp_inspections_record_document_id_documents_id_fk" FOREIGN KEY ("record_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itp_plans" ADD CONSTRAINT "itp_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itp_plans" ADD CONSTRAINT "itp_plans_machine_type_code_machine_types_code_fk" FOREIGN KEY ("machine_type_code") REFERENCES "public"."machine_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons_learned" ADD CONSTRAINT "lessons_learned_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons_learned" ADD CONSTRAINT "lessons_learned_raised_by_person_id_persons_id_fk" FOREIGN KEY ("raised_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_items" ADD CONSTRAINT "punch_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_items" ADD CONSTRAINT "punch_items_source_inspection_id_itp_inspections_id_fk" FOREIGN KEY ("source_inspection_id") REFERENCES "public"."itp_inspections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_items" ADD CONSTRAINT "punch_items_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sat_plans" ADD CONSTRAINT "sat_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sat_plans" ADD CONSTRAINT "sat_plans_planned_by_person_id_persons_id_fk" FOREIGN KEY ("planned_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satisfaction_scores" ADD CONSTRAINT "satisfaction_scores_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vigie_ncr_progress" ADD CONSTRAINT "vigie_ncr_progress_ncr_id_vigie_ncrs_id_fk" FOREIGN KEY ("ncr_id") REFERENCES "public"."vigie_ncrs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vigie_ncr_progress" ADD CONSTRAINT "vigie_ncr_progress_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vigie_ncrs" ADD CONSTRAINT "vigie_ncrs_raised_by_person_id_persons_id_fk" FOREIGN KEY ("raised_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vigie_ncrs" ADD CONSTRAINT "vigie_ncrs_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_raci" ADD CONSTRAINT "deliverable_raci_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_raci" ADD CONSTRAINT "deliverable_raci_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_wbs_node_id_wbs_nodes_id_fk" FOREIGN KEY ("wbs_node_id") REFERENCES "public"."wbs_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_accepted_by_person_id_persons_id_fk" FOREIGN KEY ("accepted_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_rejected_by_person_id_persons_id_fk" FOREIGN KEY ("rejected_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_claim_id_warranty_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."warranty_claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_part_revisions" ADD CONSTRAINT "machine_part_revisions_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_machine_type_code_machine_types_code_fk" FOREIGN KEY ("machine_type_code") REFERENCES "public"."machine_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_author_person_id_persons_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_cost_lines" ADD CONSTRAINT "mission_cost_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_collisions" ADD CONSTRAINT "site_collisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_collisions" ADD CONSTRAINT "site_collisions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_equipment" ADD CONSTRAINT "site_equipment_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_equipment" ADD CONSTRAINT "site_equipment_confirmed_by_person_id_persons_id_fk" FOREIGN KEY ("confirmed_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_prerequisites" ADD CONSTRAINT "site_prerequisites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_prerequisites" ADD CONSTRAINT "site_prerequisites_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_rotations" ADD CONSTRAINT "site_rotations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_rotations" ADD CONSTRAINT "site_rotations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_sheets" ADD CONSTRAINT "site_sheets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cursus_clearances" ADD CONSTRAINT "cursus_clearances_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cursus_requests" ADD CONSTRAINT "cursus_requests_clearance_id_cursus_clearances_id_fk" FOREIGN KEY ("clearance_id") REFERENCES "public"."cursus_clearances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cursus_requests" ADD CONSTRAINT "cursus_requests_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_document_categories" ADD CONSTRAINT "client_document_categories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_issues" ADD CONSTRAINT "client_issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_issues" ADD CONSTRAINT "client_issues_raised_by_person_id_persons_id_fk" FOREIGN KEY ("raised_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_changes" ADD CONSTRAINT "eng_changes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_checks" ADD CONSTRAINT "eng_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_checks" ADD CONSTRAINT "eng_checks_rule_pair_eng_consistency_rules_pair_fk" FOREIGN KEY ("rule_pair") REFERENCES "public"."eng_consistency_rules"("pair") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_disciplines" ADD CONSTRAINT "eng_disciplines_lead_person_id_persons_id_fk" FOREIGN KEY ("lead_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_imports" ADD CONSTRAINT "eng_imports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_imports" ADD CONSTRAINT "eng_imports_imported_by_person_id_persons_id_fk" FOREIGN KEY ("imported_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_inputs" ADD CONSTRAINT "eng_inputs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_inputs" ADD CONSTRAINT "eng_inputs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_inputs" ADD CONSTRAINT "eng_inputs_acknowledged_by_person_id_persons_id_fk" FOREIGN KEY ("acknowledged_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_outputs" ADD CONSTRAINT "eng_outputs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pid_sheets" ADD CONSTRAINT "pid_sheets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pid_sheets" ADD CONSTRAINT "pid_sheets_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pid_sheets" ADD CONSTRAINT "pid_sheets_author_person_id_persons_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pid_sheets" ADD CONSTRAINT "pid_sheets_checker_person_id_persons_id_fk" FOREIGN KEY ("checker_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pid_tags" ADD CONSTRAINT "pid_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pid_tags" ADD CONSTRAINT "pid_tags_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pid_validation_steps" ADD CONSTRAINT "pid_validation_steps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_person_id_persons_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_sync_runs" ADD CONSTRAINT "connector_sync_runs_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;