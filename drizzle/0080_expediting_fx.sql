CREATE TABLE "fx_reference_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"currency" text NOT NULL,
	"rate" numeric NOT NULL,
	"valid_from" date NOT NULL,
	"created_by_name" text NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_reference_rates_currency_valid_from_unique" UNIQUE("currency","valid_from")
);
--> statement-breakpoint
CREATE TABLE "po_expediting" (
	"po_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"fabrication_pct" integer DEFAULT 0 NOT NULL,
	"reported_on" date,
	"note" text,
	"updated_by_name" text,
	"updated_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"planned_on" date,
	"inspector_name" text,
	"result" text DEFAULT 'planned' NOT NULL,
	"result_on" date,
	"result_comment" text,
	"ncr_ref" text,
	"itp_inspection_id" uuid,
	"result_recorded_by_name" text,
	"result_recorded_at" timestamp with time zone,
	"created_by_name" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "po_inspections_po_id_number_unique" UNIQUE("po_id","number")
);
--> statement-breakpoint
CREATE TABLE "po_release_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issued_on" date NOT NULL,
	"issued_by_name" text NOT NULL,
	"issued_by_person_id" uuid,
	"inspector_name" text,
	"scope" text NOT NULL,
	"reserves" text,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_name" text,
	"withdraw_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "po_release_notes_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "fx_reference_rates" ADD CONSTRAINT "fx_reference_rates_created_by_person_id_persons_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_expediting" ADD CONSTRAINT "po_expediting_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_expediting" ADD CONSTRAINT "po_expediting_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_expediting" ADD CONSTRAINT "po_expediting_updated_by_person_id_persons_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_inspections" ADD CONSTRAINT "po_inspections_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_inspections" ADD CONSTRAINT "po_inspections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_inspections" ADD CONSTRAINT "po_inspections_itp_inspection_id_itp_inspections_id_fk" FOREIGN KEY ("itp_inspection_id") REFERENCES "public"."itp_inspections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_release_notes" ADD CONSTRAINT "po_release_notes_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_release_notes" ADD CONSTRAINT "po_release_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_release_notes" ADD CONSTRAINT "po_release_notes_issued_by_person_id_persons_id_fk" FOREIGN KEY ("issued_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "po_expediting_project_id_idx" ON "po_expediting" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "po_inspections_project_id_idx" ON "po_inspections" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "po_inspections_itp_inspection_id_idx" ON "po_inspections" USING btree ("itp_inspection_id");--> statement-breakpoint
CREATE INDEX "po_release_notes_po_id_idx" ON "po_release_notes" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "po_release_notes_project_id_idx" ON "po_release_notes" USING btree ("project_id");