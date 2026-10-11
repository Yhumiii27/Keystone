CREATE TABLE "change_request_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_request_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"amount_keur" numeric NOT NULL,
	"bac_before_keur" numeric NOT NULL,
	"bac_after_keur" numeric NOT NULL,
	"allocations" jsonb NOT NULL,
	"amendment_outcome" text NOT NULL,
	"amendment_id" uuid,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by_person_id" uuid,
	"posted_by_name" text NOT NULL,
	CONSTRAINT "change_request_postings_change_request_id_unique" UNIQUE("change_request_id")
);
--> statement-breakpoint
ALTER TABLE "risks" ALTER COLUMN "emv_keur" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contingency_draws" ADD COLUMN "status" text DEFAULT 'validated' NOT NULL;--> statement-breakpoint
ALTER TABLE "contingency_draws" ADD COLUMN "requested_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "contingency_draws" ADD COLUMN "requested_by_name" text;--> statement-breakpoint
ALTER TABLE "contingency_draws" ADD COLUMN "decided_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "contingency_draws" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contingency_draws" ADD COLUMN "decision_comment" text;--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "cost_keur" numeric;--> statement-breakpoint
ALTER TABLE "change_request_postings" ADD CONSTRAINT "change_request_postings_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request_postings" ADD CONSTRAINT "change_request_postings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request_postings" ADD CONSTRAINT "change_request_postings_amendment_id_contract_amendments_id_fk" FOREIGN KEY ("amendment_id") REFERENCES "public"."contract_amendments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request_postings" ADD CONSTRAINT "change_request_postings_posted_by_person_id_persons_id_fk" FOREIGN KEY ("posted_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contingency_draws" ADD CONSTRAINT "contingency_draws_requested_by_person_id_persons_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contingency_draws" ADD CONSTRAINT "contingency_draws_decided_by_person_id_persons_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;