CREATE TABLE "cities" (
	"name" text PRIMARY KEY NOT NULL,
	"country_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code3" text,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_name_unique" UNIQUE("name"),
	CONSTRAINT "clients_code3_unique" UNIQUE("code3")
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"name" text PRIMARY KEY NOT NULL,
	"zone_code" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "department_capacities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"weeks" integer NOT NULL,
	"capacity_h" numeric NOT NULL,
	"demand_h" numeric NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"head_person_id" uuid,
	"head_title" text,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text,
	"short_name" text NOT NULL,
	"initials" text NOT NULL,
	"owner_code" text,
	"job_title" text,
	"department_id" uuid,
	"client_id" uuid,
	"email" text,
	"is_contract_role" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_short_name_unique" UNIQUE("short_name"),
	CONSTRAINT "persons_owner_code_unique" UNIQUE("owner_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"person_id" uuid NOT NULL,
	"title" text NOT NULL,
	"client_id" uuid,
	"is_external" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_unique" UNIQUE("role")
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"manager_person_id" uuid,
	"bounds_w" double precision NOT NULL,
	"bounds_n" double precision NOT NULL,
	"bounds_e" double precision NOT NULL,
	"bounds_s" double precision NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifecycle_stages" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"short_label" text NOT NULL,
	"seq" integer,
	"sort_order" integer NOT NULL,
	"stage_group" text NOT NULL,
	"description" text NOT NULL,
	"entry_gate" text,
	CONSTRAINT "lifecycle_stages_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "lifecycle_transitions" (
	"from_stage" text NOT NULL,
	"to_stage" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "lifecycle_transitions_from_stage_to_stage_pk" PRIMARY KEY("from_stage","to_stage")
);
--> statement-breakpoint
CREATE TABLE "machine_types" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"deposit_pct" numeric NOT NULL,
	"delivery_pct" numeric NOT NULL,
	"acceptance_pct" numeric NOT NULL,
	"is_standard" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_types_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"project_role" text DEFAULT 'team' NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "project_members_project_id_person_id_pk" PRIMARY KEY("project_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "project_sites" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"country_name" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"zone_override" text
);
--> statement-breakpoint
CREATE TABLE "project_template_cost_categories" (
	"template_code" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"cost_type" text NOT NULL,
	"budget_keur" numeric NOT NULL,
	CONSTRAINT "project_template_cost_categories_template_code_position_pk" PRIMARY KEY("template_code","position")
);
--> statement-breakpoint
CREATE TABLE "project_template_phases" (
	"template_code" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "project_template_phases_template_code_position_pk" PRIMARY KEY("template_code","position")
);
--> statement-breakpoint
CREATE TABLE "project_templates" (
	"code" text PRIMARY KEY NOT NULL,
	"machine_type_code" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"wbs_summary" text NOT NULL,
	"activities_summary" text NOT NULL,
	"calendar" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"number" text,
	"short_code" text NOT NULL,
	"name" text NOT NULL,
	"client_id" uuid,
	"pm_person_id" uuid,
	"stage" text NOT NULL,
	"das" text,
	"machine_type_code" text,
	"analytic_code" text,
	"start_text" text NOT NULL,
	"finish_text" text NOT NULL,
	"start_month" double precision,
	"finish_month" double precision,
	"budget_keur" numeric NOT NULL,
	"actual_keur" numeric NOT NULL,
	"progress" numeric NOT NULL,
	"spi" numeric,
	"is_new" boolean DEFAULT false NOT NULL,
	"currency" text,
	"calendar" text,
	"contingency_pct" numeric,
	"template_code" text,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code"),
	CONSTRAINT "projects_number_unique" UNIQUE("number"),
	CONSTRAINT "projects_analytic_code_unique" UNIQUE("analytic_code")
);
--> statement-breakpoint
CREATE TABLE "rex_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_type_code" text NOT NULL,
	"position" integer NOT NULL,
	"analytic_code" text NOT NULL,
	"project_name" text NOT NULL,
	"year" text NOT NULL,
	"pattern" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_deliverable_checks" (
	"project_id" uuid NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"done" boolean NOT NULL,
	"done_at" timestamp with time zone,
	"done_by_person_id" uuid,
	CONSTRAINT "stage_deliverable_checks_project_id_deliverable_id_pk" PRIMARY KEY("project_id","deliverable_id")
);
--> statement-breakpoint
CREATE TABLE "stage_deliverable_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage" text NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "stage_deliverable_defs_stage_position_unique" UNIQUE("stage","position")
);
--> statement-breakpoint
CREATE TABLE "stage_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"effective_on" date NOT NULL,
	"mode" text NOT NULL,
	"reason" text,
	"missing_deliverables" text[],
	"requested_by_person_id" uuid,
	"validation_status" text,
	"validated_by_person_id" uuid,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stage_transitions_project_id_seq_unique" UNIQUE("project_id","seq")
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"wbs_node_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"duration_days" integer NOT NULL,
	"start_text" text NOT NULL,
	"start_actual" boolean NOT NULL,
	"finish_text" text NOT NULL,
	"finish_actual" boolean NOT NULL,
	"start_date" date,
	"finish_date" date,
	"baseline_finish_text" text NOT NULL,
	"baseline_finish_date" date,
	"variance_days" integer NOT NULL,
	"constraint_type" text,
	"constraint_date_text" text,
	"constraint_date" date,
	"constraint_violated" boolean DEFAULT false NOT NULL,
	"total_float_days" integer,
	"percent_complete" integer NOT NULL,
	"owner_person_id" uuid,
	"budget_keur" numeric NOT NULL,
	"actual_keur" numeric NOT NULL,
	"eac_keur" numeric NOT NULL,
	"package_name" text,
	"critical" boolean,
	"description" text,
	"is_added" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_project_id_code_unique" UNIQUE("project_id","code")
);
--> statement-breakpoint
CREATE TABLE "activity_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"resource" text NOT NULL,
	"person_id" uuid,
	"detail" text NOT NULL,
	"units" text NOT NULL,
	"progress_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"predecessor_id" uuid NOT NULL,
	"successor_id" uuid NOT NULL,
	"type" text NOT NULL,
	"lag_days" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "activity_links_successor_id_predecessor_id_unique" UNIQUE("successor_id","predecessor_id")
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"baseline_month" double precision NOT NULL,
	"forecast_month" double precision NOT NULL,
	"status" text NOT NULL,
	"activity_id" uuid
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"window" text NOT NULL,
	"start_month" double precision NOT NULL,
	"end_month" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_controls" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"start_month" integer NOT NULL,
	"t_now" double precision NOT NULL,
	"float_days" integer NOT NULL,
	"finish_text" text NOT NULL,
	"baseline_text" text NOT NULL,
	"float_text" text NOT NULL,
	"float_short" text NOT NULL,
	"crit_text" text NOT NULL,
	"miles_text" text NOT NULL,
	"miles_sub" text NOT NULL,
	"baseline_set" text NOT NULL,
	"recon_orig_keur" numeric NOT NULL,
	"recon_changes_keur" numeric NOT NULL,
	"recon_cr_count" integer NOT NULL,
	"recon_pending_keur" numeric NOT NULL,
	"recon_pending_sub" text NOT NULL,
	"contingency_keur" numeric NOT NULL,
	"contingency_used_keur" numeric NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_bars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"wbs_node_id" uuid,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"owner_person_id" uuid,
	"baseline_start" double precision NOT NULL,
	"baseline_end" double precision NOT NULL,
	"forecast_start" double precision NOT NULL,
	"forecast_end" double precision NOT NULL,
	"percent_complete" integer NOT NULL,
	"critical" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wbs_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"parent_id" uuid,
	"position" integer NOT NULL,
	"start_text" text,
	"finish_text" text,
	"baseline_finish_text" text,
	"total_float_days" integer,
	"owner_person_id" uuid,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wbs_nodes_project_id_code_unique" UNIQUE("project_id","code")
);
--> statement-breakpoint
CREATE TABLE "cost_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"cost_type" text NOT NULL,
	"budget_keur" numeric NOT NULL,
	"actual_keur" numeric NOT NULL,
	"committed_keur" numeric NOT NULL,
	"forecast_keur" numeric NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_categories_project_id_code_unique" UNIQUE("project_id","code")
);
--> statement-breakpoint
CREATE TABLE "cost_stream_periods" (
	"stream_id" uuid NOT NULL,
	"month_index" integer NOT NULL,
	"amount_keur" numeric NOT NULL,
	CONSTRAINT "cost_stream_periods_stream_id_month_index_pk" PRIMARY KEY("stream_id","month_index")
);
--> statement-breakpoint
CREATE TABLE "cost_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"basis" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evm_periods" (
	"project_id" uuid NOT NULL,
	"month_index" integer NOT NULL,
	"pv_keur" numeric NOT NULL,
	"ev_keur" numeric,
	"ac_keur" numeric,
	CONSTRAINT "evm_periods_project_id_month_index_pk" PRIMARY KEY("project_id","month_index")
);
--> statement-breakpoint
CREATE TABLE "offer_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"system" text NOT NULL,
	"supplier_name" text NOT NULL,
	"amount_keur" numeric NOT NULL,
	"terms" text NOT NULL,
	"deposit_pct" integer,
	"delivery_pct" integer,
	"acceptance_pct" integer,
	"order_month" integer NOT NULL,
	"delivery_month" integer NOT NULL,
	"acceptance_month" integer,
	"lead_weeks" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wp_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"wbs_node_id" uuid,
	"wbs_code" text NOT NULL,
	"name" text NOT NULL,
	"original_keur" numeric NOT NULL,
	"changes_keur" numeric NOT NULL,
	"actual_keur" numeric NOT NULL,
	"eac_keur" numeric NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"set_on" date,
	"bac_keur" numeric NOT NULL,
	"finish_date" date NOT NULL,
	"state" text NOT NULL,
	"change_request_id" uuid,
	"reason" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baselines_project_id_code_unique" UNIQUE("project_id","code")
);
--> statement-breakpoint
CREATE TABLE "budget_change_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"amount_keur" numeric NOT NULL,
	"schedule_days" integer NOT NULL,
	"status" text NOT NULL,
	"meta" text NOT NULL,
	"change_request_id" uuid,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_request_steps" (
	"change_request_id" uuid NOT NULL,
	"step" text NOT NULL,
	"decision" text NOT NULL,
	"position" integer NOT NULL,
	"decided_by_person_id" uuid,
	"comment" text,
	CONSTRAINT "change_request_steps_change_request_id_step_pk" PRIMARY KEY("change_request_id","step")
);
--> statement-breakpoint
CREATE TABLE "change_request_wbs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_request_id" uuid NOT NULL,
	"wbs_code" text NOT NULL,
	"wbs_node_id" uuid,
	"amount_keur" numeric,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"types" text[] NOT NULL,
	"amount_keur" numeric NOT NULL,
	"schedule_days" integer NOT NULL,
	"status" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_by_person_id" uuid,
	"requested_on_text" text NOT NULL,
	"requested_on" date,
	"baseline_code" text,
	"justification" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_requests_project_id_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_country_name_countries_name_fk" FOREIGN KEY ("country_name") REFERENCES "public"."countries"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_zone_code_zones_code_fk" FOREIGN KEY ("zone_code") REFERENCES "public"."zones"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_capacities" ADD CONSTRAINT "department_capacities_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_person_id_persons_id_fk" FOREIGN KEY ("head_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_manager_person_id_persons_id_fk" FOREIGN KEY ("manager_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_transitions" ADD CONSTRAINT "lifecycle_transitions_from_stage_lifecycle_stages_code_fk" FOREIGN KEY ("from_stage") REFERENCES "public"."lifecycle_stages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_transitions" ADD CONSTRAINT "lifecycle_transitions_to_stage_lifecycle_stages_code_fk" FOREIGN KEY ("to_stage") REFERENCES "public"."lifecycle_stages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_country_name_countries_name_fk" FOREIGN KEY ("country_name") REFERENCES "public"."countries"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_zone_override_zones_code_fk" FOREIGN KEY ("zone_override") REFERENCES "public"."zones"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_cost_categories" ADD CONSTRAINT "project_template_cost_categories_template_code_project_templates_code_fk" FOREIGN KEY ("template_code") REFERENCES "public"."project_templates"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_phases" ADD CONSTRAINT "project_template_phases_template_code_project_templates_code_fk" FOREIGN KEY ("template_code") REFERENCES "public"."project_templates"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_machine_type_code_machine_types_code_fk" FOREIGN KEY ("machine_type_code") REFERENCES "public"."machine_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_pm_person_id_persons_id_fk" FOREIGN KEY ("pm_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_stage_lifecycle_stages_code_fk" FOREIGN KEY ("stage") REFERENCES "public"."lifecycle_stages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_machine_type_code_machine_types_code_fk" FOREIGN KEY ("machine_type_code") REFERENCES "public"."machine_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_template_code_project_templates_code_fk" FOREIGN KEY ("template_code") REFERENCES "public"."project_templates"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rex_references" ADD CONSTRAINT "rex_references_machine_type_code_machine_types_code_fk" FOREIGN KEY ("machine_type_code") REFERENCES "public"."machine_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_deliverable_checks" ADD CONSTRAINT "stage_deliverable_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_deliverable_checks" ADD CONSTRAINT "stage_deliverable_checks_deliverable_id_stage_deliverable_defs_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."stage_deliverable_defs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_deliverable_checks" ADD CONSTRAINT "stage_deliverable_checks_done_by_person_id_persons_id_fk" FOREIGN KEY ("done_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_deliverable_defs" ADD CONSTRAINT "stage_deliverable_defs_stage_lifecycle_stages_code_fk" FOREIGN KEY ("stage") REFERENCES "public"."lifecycle_stages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_from_stage_lifecycle_stages_code_fk" FOREIGN KEY ("from_stage") REFERENCES "public"."lifecycle_stages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_to_stage_lifecycle_stages_code_fk" FOREIGN KEY ("to_stage") REFERENCES "public"."lifecycle_stages"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_requested_by_person_id_persons_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_validated_by_person_id_persons_id_fk" FOREIGN KEY ("validated_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_wbs_node_id_wbs_nodes_id_fk" FOREIGN KEY ("wbs_node_id") REFERENCES "public"."wbs_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_assignments" ADD CONSTRAINT "activity_assignments_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_assignments" ADD CONSTRAINT "activity_assignments_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_links" ADD CONSTRAINT "activity_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_links" ADD CONSTRAINT "activity_links_predecessor_id_activities_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_links" ADD CONSTRAINT "activity_links_successor_id_activities_id_fk" FOREIGN KEY ("successor_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage_plans" ADD CONSTRAINT "pipeline_stage_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_controls" ADD CONSTRAINT "project_controls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_bars" ADD CONSTRAINT "schedule_bars_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_bars" ADD CONSTRAINT "schedule_bars_wbs_node_id_wbs_nodes_id_fk" FOREIGN KEY ("wbs_node_id") REFERENCES "public"."wbs_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_bars" ADD CONSTRAINT "schedule_bars_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wbs_nodes" ADD CONSTRAINT "wbs_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wbs_nodes" ADD CONSTRAINT "wbs_nodes_parent_id_wbs_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."wbs_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wbs_nodes" ADD CONSTRAINT "wbs_nodes_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_categories" ADD CONSTRAINT "cost_categories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_stream_periods" ADD CONSTRAINT "cost_stream_periods_stream_id_cost_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."cost_streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_streams" ADD CONSTRAINT "cost_streams_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evm_periods" ADD CONSTRAINT "evm_periods_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_quotes" ADD CONSTRAINT "offer_quotes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wp_budgets" ADD CONSTRAINT "wp_budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wp_budgets" ADD CONSTRAINT "wp_budgets_wbs_node_id_wbs_nodes_id_fk" FOREIGN KEY ("wbs_node_id") REFERENCES "public"."wbs_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_change_lines" ADD CONSTRAINT "budget_change_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_change_lines" ADD CONSTRAINT "budget_change_lines_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request_steps" ADD CONSTRAINT "change_request_steps_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request_steps" ADD CONSTRAINT "change_request_steps_decided_by_person_id_persons_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request_wbs" ADD CONSTRAINT "change_request_wbs_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request_wbs" ADD CONSTRAINT "change_request_wbs_wbs_node_id_wbs_nodes_id_fk" FOREIGN KEY ("wbs_node_id") REFERENCES "public"."wbs_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_requested_by_person_id_persons_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;