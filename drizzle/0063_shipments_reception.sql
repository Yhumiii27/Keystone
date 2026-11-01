CREATE TABLE "shipment_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"document_id" uuid,
	"number" text NOT NULL,
	"revision" text NOT NULL,
	"stored_file_id" uuid,
	"sha256" text,
	"lang" text NOT NULL,
	"generated_by_person_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_documents_version_unique" UNIQUE("shipment_id","kind","revision"),
	CONSTRAINT "shipment_documents_kind_check" CHECK ("shipment_documents"."kind" in ('packing_list', 'container_packing_list', 'delivery_note', 'marking', 'cmr', 'shipping_instructions', 'origin_request', 'export_declaration'))
);
--> statement-breakpoint
CREATE TABLE "shipment_punch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"punch_item_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"item_id" uuid,
	"gap" text NOT NULL,
	"quantity" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_punch_items_punch_item_id_unique" UNIQUE("punch_item_id"),
	CONSTRAINT "shipment_punch_items_gap_unique" UNIQUE NULLS NOT DISTINCT("load_id","item_id","gap"),
	CONSTRAINT "shipment_punch_items_gap_check" CHECK ("shipment_punch_items"."gap" in ('missing', 'damaged'))
);
--> statement-breakpoint
CREATE TABLE "shipment_reception_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"load_id" uuid NOT NULL,
	"item_id" uuid,
	"load_state" text,
	"received_qty" numeric,
	"missing_qty" numeric,
	"damaged_qty" numeric,
	"note" text,
	"by_person_id" uuid,
	"pointed_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_reception_lines_line_unique" UNIQUE NULLS NOT DISTINCT("load_id","item_id"),
	CONSTRAINT "shipment_reception_lines_state_check" CHECK ("shipment_reception_lines"."load_state" is null or "shipment_reception_lines"."load_state" in ('received', 'missing', 'damaged')),
	CONSTRAINT "shipment_reception_lines_kind_check" CHECK (("shipment_reception_lines"."item_id" is null) = ("shipment_reception_lines"."load_state" is not null))
);
--> statement-breakpoint
ALTER TABLE "codex_document_outbox" ADD COLUMN "stored_file_id" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "received_on" date;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "closed_on" date;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "close_reason" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "risk_id" uuid;--> statement-breakpoint
ALTER TABLE "shipment_documents" ADD CONSTRAINT "shipment_documents_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_documents" ADD CONSTRAINT "shipment_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_documents" ADD CONSTRAINT "shipment_documents_stored_file_id_stored_files_id_fk" FOREIGN KEY ("stored_file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_documents" ADD CONSTRAINT "shipment_documents_generated_by_person_id_persons_id_fk" FOREIGN KEY ("generated_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_punch_items" ADD CONSTRAINT "shipment_punch_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_punch_items" ADD CONSTRAINT "shipment_punch_items_punch_item_id_punch_items_id_fk" FOREIGN KEY ("punch_item_id") REFERENCES "public"."punch_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_punch_items" ADD CONSTRAINT "shipment_punch_items_load_id_shipment_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."shipment_loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_punch_items" ADD CONSTRAINT "shipment_punch_items_item_id_shipment_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shipment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_reception_lines" ADD CONSTRAINT "shipment_reception_lines_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_reception_lines" ADD CONSTRAINT "shipment_reception_lines_load_id_shipment_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."shipment_loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_reception_lines" ADD CONSTRAINT "shipment_reception_lines_item_id_shipment_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shipment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_reception_lines" ADD CONSTRAINT "shipment_reception_lines_by_person_id_persons_id_fk" FOREIGN KEY ("by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipment_documents_document_id_idx" ON "shipment_documents" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "shipment_documents_stored_file_id_idx" ON "shipment_documents" USING btree ("stored_file_id");--> statement-breakpoint
CREATE INDEX "shipment_punch_items_shipment_id_idx" ON "shipment_punch_items" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_punch_items_item_id_idx" ON "shipment_punch_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "shipment_reception_lines_shipment_id_idx" ON "shipment_reception_lines" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_reception_lines_item_id_idx" ON "shipment_reception_lines" USING btree ("item_id");--> statement-breakpoint
ALTER TABLE "codex_document_outbox" ADD CONSTRAINT "codex_document_outbox_stored_file_id_stored_files_id_fk" FOREIGN KEY ("stored_file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "codex_document_outbox_stored_file_id_idx" ON "codex_document_outbox" USING btree ("stored_file_id");--> statement-breakpoint
CREATE INDEX "shipments_updated_at_idx" ON "shipments" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "shipments_risk_id_idx" ON "shipments" USING btree ("risk_id");