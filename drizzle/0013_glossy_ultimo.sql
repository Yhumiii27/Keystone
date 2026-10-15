CREATE TABLE "change_request_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_request_id" uuid NOT NULL,
	"activity_code" text NOT NULL,
	"new_duration_days" integer,
	"applied_at" timestamp with time zone,
	"applied_from_days" integer,
	"position" integer NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_request_activities_change_request_id_activity_code_unique" UNIQUE("change_request_id","activity_code")
);
--> statement-breakpoint
CREATE TABLE "codex_document_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"document_number" text NOT NULL,
	"revision" text NOT NULL,
	"kind" text NOT NULL,
	"step_position" integer,
	"role" text,
	"decision" text,
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
	"codex_ref" text,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "unit_cost_eur" numeric;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "value_eur" numeric;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "wbs_code" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "override_qty" numeric;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "override_from_project_id" uuid;--> statement-breakpoint
ALTER TABLE "change_request_activities" ADD CONSTRAINT "change_request_activities_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request_activities" ADD CONSTRAINT "change_request_activities_created_by_person_id_persons_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_document_outbox" ADD CONSTRAINT "codex_document_outbox_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codex_document_outbox" ADD CONSTRAINT "codex_document_outbox_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_override_from_project_id_projects_id_fk" FOREIGN KEY ("override_from_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;