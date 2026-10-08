CREATE TABLE "document_acknowledgements" (
	"document_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"acknowledged_by_person_id" uuid,
	"acknowledged_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_acknowledgements_document_id_revision_pk" PRIMARY KEY("document_id","revision")
);
--> statement-breakpoint
CREATE TABLE "document_approvals" (
	"document_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"step_position" integer NOT NULL,
	"role" text NOT NULL,
	"approver_person_id" uuid,
	"approver_name" text,
	"signed_on" date,
	"signed_by_person_id" uuid,
	CONSTRAINT "document_approvals_document_id_revision_step_position_pk" PRIMARY KEY("document_id","revision","step_position")
);
--> statement-breakpoint
CREATE TABLE "document_approver_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"project_id" uuid,
	"person_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "document_approver_assignments_role_project_id_unique" UNIQUE NULLS NOT DISTINCT("role","project_id")
);
--> statement-breakpoint
CREATE TABLE "document_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type_code" text NOT NULL,
	"project_id" uuid,
	"linked_po_ref" text,
	"linked_part_ref" text,
	"context_document_id" uuid,
	"number" text NOT NULL,
	"document_id" uuid,
	"status" text NOT NULL,
	"requested_by_person_id" uuid,
	"requested_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"person_id" uuid,
	"person_name" text NOT NULL,
	"downloaded_on" date NOT NULL,
	"format" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_index_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"record_count" integer NOT NULL,
	"requested_by_person_id" uuid
);
--> statement-breakpoint
CREATE TABLE "document_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_ref" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"position" integer NOT NULL,
	"issued_on" date NOT NULL,
	"author_person_id" uuid,
	"author_name" text NOT NULL,
	"withdrawn_on" date,
	"working_versions" integer NOT NULL,
	CONSTRAINT "document_revisions_document_id_revision_unique" UNIQUE("document_id","revision")
);
--> statement-breakpoint
CREATE TABLE "document_type_circuit_steps" (
	"type_code" text NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "document_type_circuit_steps_type_code_position_pk" PRIMARY KEY("type_code","position")
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"family" text NOT NULL,
	"retention" text NOT NULL,
	"iso_clause" text NOT NULL,
	"is_client_deliverable" boolean NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"type_code" text NOT NULL,
	"title" text NOT NULL,
	"project_id" uuid,
	"service" text NOT NULL,
	"current_revision" text NOT NULL,
	"status" text NOT NULL,
	"issued_on" date NOT NULL,
	"author_person_id" uuid,
	"author_name" text NOT NULL,
	"confidentiality" text NOT NULL,
	"tags" text[] NOT NULL,
	"recipients" text[] NOT NULL,
	"last_withdrawn_revision" text,
	"last_withdrawn_on" date,
	"is_new" boolean DEFAULT false NOT NULL,
	"codex_id" text,
	"codex_url" text,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "billing_plans" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"contract_value_keur" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"subject" text NOT NULL,
	"change_request_ref" text,
	"change_request_id" uuid,
	"amount_keur" numeric NOT NULL,
	"status" text NOT NULL,
	"signed_on" date,
	"document_ref" text,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_bonds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"issuer" text,
	"amount_keur" numeric NOT NULL,
	"valid_until" date,
	"released_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"document_id" uuid,
	"client_name" text NOT NULL,
	"client_id" uuid,
	"type" text NOT NULL,
	"signed_on" date,
	"base_amount_keur" numeric NOT NULL,
	"payment_terms" text NOT NULL,
	"retention_pct" numeric NOT NULL,
	"retention_note" text NOT NULL,
	"liquidated_damages" text NOT NULL,
	"warranty" text NOT NULL,
	"governing_law" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_project_id_unique" UNIQUE("project_id"),
	CONSTRAINT "contracts_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "customer_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_milestone_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issued_on" date NOT NULL,
	"amount_keur" numeric NOT NULL,
	"paid_on" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_invoices_payment_milestone_id_unique" UNIQUE("payment_milestone_id"),
	CONSTRAINT "customer_invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "payment_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"contract_id" uuid,
	"number" text,
	"label" text NOT NULL,
	"share_pct" numeric,
	"amount_keur" numeric,
	"contractual_due" date,
	"condition" text,
	"status" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_milestones_project_id_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "portfolio_cash_forecasts" (
	"month" date PRIMARY KEY NOT NULL,
	"cash_in_keur" numeric NOT NULL,
	"cash_out_keur" numeric NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"asked_by_name" text NOT NULL,
	"asked_by_person_id" uuid,
	"department" text NOT NULL,
	"owner_name" text NOT NULL,
	"owner_person_id" uuid,
	"state" text NOT NULL,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_agenda_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	CONSTRAINT "meeting_agenda_points_meeting_id_position_unique" UNIQUE("meeting_id","position")
);
--> statement-breakpoint
CREATE TABLE "meeting_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agenda_point_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"text" text NOT NULL,
	"owner_name" text,
	"owner_person_id" uuid,
	"due_text" text,
	"due_date" date,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"task_id" uuid,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_lines_agenda_point_id_position_unique" UNIQUE("agenda_point_id","position")
);
--> statement-breakpoint
CREATE TABLE "meeting_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"person_id" uuid,
	"name" text NOT NULL,
	"present" boolean DEFAULT false NOT NULL,
	"minutes_recipient" boolean DEFAULT false NOT NULL,
	"minutes_read_on" date,
	CONSTRAINT "meeting_participants_meeting_id_name_unique" UNIQUE("meeting_id","name")
);
--> statement-breakpoint
CREATE TABLE "meeting_transcript_proposals" (
	"meeting_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"text" text NOT NULL,
	"owner_name" text,
	"owner_person_id" uuid,
	"due_text" text,
	"due_date" date,
	CONSTRAINT "meeting_transcript_proposals_meeting_id_position_pk" PRIMARY KEY("meeting_id","position")
);
--> statement-breakpoint
CREATE TABLE "meeting_transcripts" (
	"meeting_id" uuid PRIMARY KEY NOT NULL,
	"raw_text" text NOT NULL,
	"source" text NOT NULL,
	"summary" text NOT NULL,
	"analysed_at" timestamp with time zone,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"series" text NOT NULL,
	"type" text NOT NULL,
	"starts_on" date NOT NULL,
	"start_time" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_min" integer NOT NULL,
	"location" text NOT NULL,
	"organizer_person_id" uuid,
	"organizer_name" text NOT NULL,
	"status" text NOT NULL,
	"minutes_number" text,
	"minutes_document_id" uuid,
	"minutes_sent_on" date,
	"external_calendar_id" text,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "raci_cells" (
	"row_id" uuid NOT NULL,
	"column_position" integer NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "raci_cells_row_id_column_position_pk" PRIMARY KEY("row_id","column_position")
);
--> statement-breakpoint
CREATE TABLE "raci_columns" (
	"matrix_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "raci_columns_matrix_id_position_pk" PRIMARY KEY("matrix_id","position")
);
--> statement-breakpoint
CREATE TABLE "raci_matrices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raci_matrices_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "raci_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matrix_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "raci_rows_matrix_id_position_unique" UNIQUE("matrix_id","position")
);
--> statement-breakpoint
CREATE TABLE "stakeholders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"organisation" text NOT NULL,
	"role" text NOT NULL,
	"type" text NOT NULL,
	"influence" integer DEFAULT 0 NOT NULL,
	"interest" integer DEFAULT 0 NOT NULL,
	"attitude" text DEFAULT '' NOT NULL,
	"contact_email" text,
	"owner_person_id" uuid,
	"owner_name" text NOT NULL,
	"last_contact_on" date NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"person_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_interfaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"keystone_side" text NOT NULL,
	"other_party" text NOT NULL,
	"data_expected" text NOT NULL,
	"needed_by" date NOT NULL,
	"provided_on" date,
	"status" text NOT NULL,
	"owner_person_id" uuid,
	"owner_name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_interfaces_project_id_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "capacity_demand_rates" (
	"department_id" uuid PRIMARY KEY NOT NULL,
	"hours_per_meur" numeric NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_scores" (
	"project_id" uuid NOT NULL,
	"axis" text NOT NULL,
	"score" integer NOT NULL,
	"scored_by_person_id" uuid,
	"scored_at" timestamp with time zone,
	"comment" text,
	CONSTRAINT "portfolio_scores_project_id_axis_pk" PRIMARY KEY("project_id","axis")
);
--> statement-breakpoint
CREATE TABLE "score_axes" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"default_weight" numeric NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_weights" (
	"user_id" uuid NOT NULL,
	"axis" text NOT NULL,
	"weight" numeric NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_weights_user_id_axis_pk" PRIMARY KEY("user_id","axis")
);
--> statement-breakpoint
ALTER TABLE "project_controls" ADD COLUMN "orders_placed_keur" numeric;--> statement-breakpoint
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_acknowledged_by_person_id_persons_id_fk" FOREIGN KEY ("acknowledged_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_approver_person_id_persons_id_fk" FOREIGN KEY ("approver_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_signed_by_person_id_persons_id_fk" FOREIGN KEY ("signed_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_approver_assignments" ADD CONSTRAINT "document_approver_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_approver_assignments" ADD CONSTRAINT "document_approver_assignments_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_deposits" ADD CONSTRAINT "document_deposits_type_code_document_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "public"."document_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_deposits" ADD CONSTRAINT "document_deposits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_deposits" ADD CONSTRAINT "document_deposits_context_document_id_documents_id_fk" FOREIGN KEY ("context_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_deposits" ADD CONSTRAINT "document_deposits_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_deposits" ADD CONSTRAINT "document_deposits_requested_by_person_id_persons_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_downloads" ADD CONSTRAINT "document_downloads_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_downloads" ADD CONSTRAINT "document_downloads_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_index_syncs" ADD CONSTRAINT "document_index_syncs_requested_by_person_id_persons_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_author_person_id_persons_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_type_circuit_steps" ADD CONSTRAINT "document_type_circuit_steps_type_code_document_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "public"."document_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_code_document_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "public"."document_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_author_person_id_persons_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_plans" ADD CONSTRAINT "billing_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_bonds" ADD CONSTRAINT "contract_bonds_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_payment_milestone_id_payment_milestones_id_fk" FOREIGN KEY ("payment_milestone_id") REFERENCES "public"."payment_milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_questions" ADD CONSTRAINT "client_questions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_questions" ADD CONSTRAINT "client_questions_asked_by_person_id_persons_id_fk" FOREIGN KEY ("asked_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_questions" ADD CONSTRAINT "client_questions_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_agenda_points" ADD CONSTRAINT "meeting_agenda_points_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_lines" ADD CONSTRAINT "meeting_lines_agenda_point_id_meeting_agenda_points_id_fk" FOREIGN KEY ("agenda_point_id") REFERENCES "public"."meeting_agenda_points"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_lines" ADD CONSTRAINT "meeting_lines_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_lines" ADD CONSTRAINT "meeting_lines_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_transcript_proposals" ADD CONSTRAINT "meeting_transcript_proposals_meeting_id_meeting_transcripts_meeting_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting_transcripts"("meeting_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_transcript_proposals" ADD CONSTRAINT "meeting_transcript_proposals_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_transcripts" ADD CONSTRAINT "meeting_transcripts_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizer_person_id_persons_id_fk" FOREIGN KEY ("organizer_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_minutes_document_id_documents_id_fk" FOREIGN KEY ("minutes_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raci_cells" ADD CONSTRAINT "raci_cells_row_id_raci_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."raci_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raci_columns" ADD CONSTRAINT "raci_columns_matrix_id_raci_matrices_id_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."raci_matrices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raci_matrices" ADD CONSTRAINT "raci_matrices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raci_rows" ADD CONSTRAINT "raci_rows_matrix_id_raci_matrices_id_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."raci_matrices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stakeholders" ADD CONSTRAINT "stakeholders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stakeholders" ADD CONSTRAINT "stakeholders_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stakeholders" ADD CONSTRAINT "stakeholders_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_interfaces" ADD CONSTRAINT "project_interfaces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_interfaces" ADD CONSTRAINT "project_interfaces_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_demand_rates" ADD CONSTRAINT "capacity_demand_rates_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_scores" ADD CONSTRAINT "portfolio_scores_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_scores" ADD CONSTRAINT "portfolio_scores_axis_score_axes_code_fk" FOREIGN KEY ("axis") REFERENCES "public"."score_axes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_scores" ADD CONSTRAINT "portfolio_scores_scored_by_person_id_persons_id_fk" FOREIGN KEY ("scored_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_weights" ADD CONSTRAINT "score_weights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_weights" ADD CONSTRAINT "score_weights_axis_score_axes_code_fk" FOREIGN KEY ("axis") REFERENCES "public"."score_axes"("code") ON DELETE no action ON UPDATE no action;