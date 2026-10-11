CREATE TABLE "deliverable_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"revision" text,
	"submitted_on" date,
	"decision" text NOT NULL,
	"decided_on" date NOT NULL,
	"decided_by_name" text NOT NULL,
	"decided_by_person_id" uuid,
	"comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD COLUMN "result_on" date;--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD COLUMN "inspector_name" text;--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD COLUMN "inspector_person_id" uuid;--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD COLUMN "client_witness" text;--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD COLUMN "result_comment" text;--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD COLUMN "result_recorded_by_name" text;--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD COLUMN "result_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "receipt_attachments" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "vigie_ncrs" ADD COLUMN "inspection_number" text;--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "done_on" date;--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "report" text;--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "part_ref" text;--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "part_revision" text;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD COLUMN "diagnosis" text;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD COLUMN "closed_on" date;--> statement-breakpoint
ALTER TABLE "client_issues" ADD COLUMN "handled_by_name" text;--> statement-breakpoint
ALTER TABLE "client_issues" ADD COLUMN "handled_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "client_issues" ADD COLUMN "taken_on" date;--> statement-breakpoint
ALTER TABLE "client_issues" ADD COLUMN "answered_on" date;--> statement-breakpoint
ALTER TABLE "client_issues" ADD COLUMN "closed_on" date;--> statement-breakpoint
ALTER TABLE "deliverable_reviews" ADD CONSTRAINT "deliverable_reviews_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_reviews" ADD CONSTRAINT "deliverable_reviews_decided_by_person_id_persons_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itp_inspections" ADD CONSTRAINT "itp_inspections_inspector_person_id_persons_id_fk" FOREIGN KEY ("inspector_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_attachments" ADD CONSTRAINT "receipt_attachments_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_issues" ADD CONSTRAINT "client_issues_handled_by_person_id_persons_id_fk" FOREIGN KEY ("handled_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;