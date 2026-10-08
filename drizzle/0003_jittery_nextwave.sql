CREATE TABLE "storage_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"location_type" text NOT NULL,
	"position" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_locations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"x3_code" text,
	"on_time_delivery_pct" numeric,
	"quality_acceptance_pct" numeric,
	"ncr_rate_pct" numeric,
	"grade" text,
	"open_po_count" integer,
	"scorecard_position" integer,
	"is_internal" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "assembly_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_part_id" uuid NOT NULL,
	"child_part_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "assembly_links_parent_part_id_child_part_id_unique" UNIQUE("parent_part_id","child_part_id")
);
--> statement-breakpoint
CREATE TABLE "part_equivalents" (
	"part_id" uuid NOT NULL,
	"equivalent_part_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "part_equivalents_part_id_equivalent_part_id_pk" PRIMARY KEY("part_id","equivalent_part_id")
);
--> statement-breakpoint
CREATE TABLE "part_last_prices" (
	"part_id" uuid PRIMARY KEY NOT NULL,
	"unit_price_eur" numeric NOT NULL,
	"purchased_on" date,
	"supplier_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"name" text NOT NULL,
	"make_buy" text NOT NULL,
	"part_type" text NOT NULL,
	"list_price_eur" numeric NOT NULL,
	"manufacturer_id" uuid,
	"manufacturer_ref" text,
	"hs_code" text,
	"export_restriction" text,
	"export_control" text,
	"status" text NOT NULL,
	"revision" text,
	"lead_weeks" integer,
	"wear_spare" text,
	"unit" text DEFAULT 'pc' NOT NULL,
	"position" integer NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parts_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "spare_list_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_part_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"qty_per_system" numeric NOT NULL,
	"note" text,
	"position" integer NOT NULL,
	CONSTRAINT "spare_list_lines_system_part_id_part_id_unique" UNIQUE("system_part_id","part_id")
);
--> statement-breakpoint
CREATE TABLE "drawing_revisions" (
	"drawing_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"is_current" boolean NOT NULL,
	"checked_in_on" date,
	"eco_number" text,
	CONSTRAINT "drawing_revisions_drawing_id_revision_pk" PRIMARY KEY("drawing_id","revision")
);
--> statement-breakpoint
CREATE TABLE "drawings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"part_id" uuid,
	"revision" text NOT NULL,
	"state" text NOT NULL,
	"vault_path" text NOT NULL,
	"checked_in_by_name" text NOT NULL,
	"checked_in_by_person_id" uuid,
	"checked_in_on" date NOT NULL,
	"eco_number" text,
	"formats" text NOT NULL,
	"pdm_id" text,
	"preview_ref" text,
	"pdm_url" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drawings_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "pdm_vault_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"drawings_in_vault" integer NOT NULL,
	"drawings_updated" integer NOT NULL,
	"source" text,
	"scope" text,
	"project_id" uuid,
	"requested_by_person_id" uuid
);
--> statement-breakpoint
CREATE TABLE "project_assembly_roots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"root_part_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "project_assembly_roots_project_id_root_part_id_unique" UNIQUE("project_id","root_part_id")
);
--> statement-breakpoint
CREATE TABLE "project_bom_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	"activity_id" uuid,
	"scope" text DEFAULT 'keystone' NOT NULL,
	"note" text,
	"position" integer NOT NULL,
	"added_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_bom_lines_project_id_part_id_unique" UNIQUE("project_id","part_id")
);
--> statement-breakpoint
CREATE TABLE "revision_diff_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diff_id" uuid NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"qty_from" numeric,
	"qty_to" numeric,
	"kind" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revision_diffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_part_id" uuid NOT NULL,
	"from_revision" text NOT NULL,
	"to_revision" text NOT NULL,
	"diff_date" date NOT NULL,
	"eco_number" text,
	CONSTRAINT "revision_diffs_assembly_part_id_from_revision_to_revision_unique" UNIQUE("assembly_part_id","from_revision","to_revision")
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"po_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text NOT NULL,
	"expected_on" date,
	"received_on" date,
	"carrier" text,
	"supplier_delivery_note" text,
	"received_by_person_id" uuid,
	"qc_by_name" text,
	"qc_by_person_id" uuid,
	"qc_result" text,
	"qc_remarks" text,
	"qc_decided_at" timestamp with time zone,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "po_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"ordered_qty" numeric NOT NULL,
	"received_qty" numeric NOT NULL,
	"unit_price_eur" numeric NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "po_lines_po_id_part_id_unique" UNIQUE("po_id","part_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text NOT NULL,
	"origin" text NOT NULL,
	"ordered_on" date,
	"expected_on" date,
	"needed_for_activity_id" uuid,
	"delivery_terms" text NOT NULL,
	"created_by_person_id" uuid,
	"submitted_by_person_id" uuid,
	"submitted_at" timestamp with time zone,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"x3_ref" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "receipt_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text,
	"storage_ref" text,
	"added_by_person_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"ordered_qty" numeric NOT NULL,
	"delivered_qty" numeric NOT NULL,
	"accepted_qty" numeric NOT NULL,
	"rejected_qty" numeric NOT NULL,
	"put_away_location_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "receipt_lines_receipt_id_part_id_unique" UNIQUE("receipt_id","part_id")
);
--> statement-breakpoint
CREATE TABLE "rfq_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"unit_price_eur" numeric NOT NULL,
	"lead_weeks" integer NOT NULL,
	"payment_terms" text NOT NULL,
	"grade" text NOT NULL,
	"score" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "rfq_quotes_rfq_id_supplier_id_unique" UNIQUE("rfq_id","supplier_id")
);
--> statement-breakpoint
CREATE TABLE "rfqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"part_id" uuid,
	"quantity" numeric,
	"reply_due_on" date NOT NULL,
	"status" text NOT NULL,
	"award_rule" text NOT NULL,
	"owner_name" text NOT NULL,
	"owner_person_id" uuid,
	"incoterm" text,
	"invited_suppliers" text[] DEFAULT '{}' NOT NULL,
	"articles_text" text,
	"awarded_quote_id" uuid,
	"awarded_by_person_id" uuid,
	"awarded_at" timestamp with time zone,
	"purchase_order_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfqs_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"po_id" uuid,
	"receipt_id" uuid,
	"amount_eur" numeric NOT NULL,
	"po_amount_eur" numeric NOT NULL,
	"receipt_amount_eur" numeric NOT NULL,
	"approved_amount_eur" numeric,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"payment_terms" text NOT NULL,
	"status" text NOT NULL,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"x3_ap_ref" text,
	"pushed_to_ap_at" timestamp with time zone,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"movement_type" text NOT NULL,
	"part_id" uuid NOT NULL,
	"qty" numeric NOT NULL,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"project_id" uuid,
	"activity_id" uuid,
	"receipt_id" uuid,
	"where_text" text NOT NULL,
	"person_name" text NOT NULL,
	"person_id" uuid,
	"pushed_to_x3_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"on_hand" numeric NOT NULL,
	"reserved" numeric NOT NULL,
	"reserved_for_project_id" uuid,
	"min_qty" numeric NOT NULL,
	"source" text NOT NULL,
	"last_movement_on" date NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_positions_part_id_location_id_unique" UNIQUE("part_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "x3_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"line_count" integer NOT NULL,
	"requested_by_person_id" uuid
);
--> statement-breakpoint
CREATE TABLE "vigie_eco_approvals" (
	"eco_id" uuid NOT NULL,
	"approval_key" text NOT NULL,
	"decision" text NOT NULL,
	"approver_text" text NOT NULL,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "vigie_eco_approvals_eco_id_approval_key_pk" PRIMARY KEY("eco_id","approval_key")
);
--> statement-breakpoint
CREATE TABLE "vigie_eco_effectivity" (
	"eco_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_ref" text NOT NULL,
	"label" text NOT NULL,
	"disposition" text,
	"is_automatic" boolean NOT NULL,
	"note" text,
	"fitted_part_ref" text,
	"fitted_revision" text,
	"position" integer NOT NULL,
	CONSTRAINT "vigie_eco_effectivity_eco_id_target_type_target_ref_pk" PRIMARY KEY("eco_id","target_type","target_ref")
);
--> statement-breakpoint
CREATE TABLE "vigie_eco_parts" (
	"eco_id" uuid NOT NULL,
	"part_ref" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "vigie_eco_parts_eco_id_part_ref_pk" PRIMARY KEY("eco_id","part_ref")
);
--> statement-breakpoint
CREATE TABLE "vigie_eco_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eco_id" uuid NOT NULL,
	"eco_number" text NOT NULL,
	"kind" text NOT NULL,
	"approval_key" text,
	"decision" text,
	"target_status" text,
	"from_status" text NOT NULL,
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
CREATE TABLE "vigie_eco_projects" (
	"eco_id" uuid NOT NULL,
	"project_code" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "vigie_eco_projects_eco_id_project_code_pk" PRIMARY KEY("eco_id","project_code")
);
--> statement-breakpoint
CREATE TABLE "vigie_ecos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"eco_type" text NOT NULL,
	"status" text NOT NULL,
	"interchangeability" text,
	"from_revision" text NOT NULL,
	"to_revision" text NOT NULL,
	"cost_eur" numeric NOT NULL,
	"schedule_days" integer NOT NULL,
	"stock_impact" text NOT NULL,
	"document_refs" text[] DEFAULT '{}' NOT NULL,
	"requested_by_name" text NOT NULL,
	"requested_by_person_id" uuid,
	"raised_on" date NOT NULL,
	"pending_dispositions" integer NOT NULL,
	"locked" boolean NOT NULL,
	"position" integer NOT NULL,
	"vigie_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vigie_ecos_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "assembly_links" ADD CONSTRAINT "assembly_links_parent_part_id_parts_id_fk" FOREIGN KEY ("parent_part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_links" ADD CONSTRAINT "assembly_links_child_part_id_parts_id_fk" FOREIGN KEY ("child_part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_equivalents" ADD CONSTRAINT "part_equivalents_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_equivalents" ADD CONSTRAINT "part_equivalents_equivalent_part_id_parts_id_fk" FOREIGN KEY ("equivalent_part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_last_prices" ADD CONSTRAINT "part_last_prices_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_last_prices" ADD CONSTRAINT "part_last_prices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_manufacturer_id_suppliers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_created_by_person_id_persons_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_list_lines" ADD CONSTRAINT "spare_list_lines_system_part_id_parts_id_fk" FOREIGN KEY ("system_part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_list_lines" ADD CONSTRAINT "spare_list_lines_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing_revisions" ADD CONSTRAINT "drawing_revisions_drawing_id_drawings_id_fk" FOREIGN KEY ("drawing_id") REFERENCES "public"."drawings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_checked_in_by_person_id_persons_id_fk" FOREIGN KEY ("checked_in_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdm_vault_syncs" ADD CONSTRAINT "pdm_vault_syncs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdm_vault_syncs" ADD CONSTRAINT "pdm_vault_syncs_requested_by_person_id_persons_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assembly_roots" ADD CONSTRAINT "project_assembly_roots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assembly_roots" ADD CONSTRAINT "project_assembly_roots_root_part_id_parts_id_fk" FOREIGN KEY ("root_part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_bom_lines" ADD CONSTRAINT "project_bom_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_bom_lines" ADD CONSTRAINT "project_bom_lines_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_bom_lines" ADD CONSTRAINT "project_bom_lines_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_bom_lines" ADD CONSTRAINT "project_bom_lines_added_by_person_id_persons_id_fk" FOREIGN KEY ("added_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_diff_lines" ADD CONSTRAINT "revision_diff_lines_diff_id_revision_diffs_id_fk" FOREIGN KEY ("diff_id") REFERENCES "public"."revision_diffs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_diffs" ADD CONSTRAINT "revision_diffs_assembly_part_id_parts_id_fk" FOREIGN KEY ("assembly_part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_person_id_persons_id_fk" FOREIGN KEY ("received_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_qc_by_person_id_persons_id_fk" FOREIGN KEY ("qc_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_needed_for_activity_id_activities_id_fk" FOREIGN KEY ("needed_for_activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_person_id_persons_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_submitted_by_person_id_persons_id_fk" FOREIGN KEY ("submitted_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_decided_by_person_id_persons_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_attachments" ADD CONSTRAINT "receipt_attachments_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_attachments" ADD CONSTRAINT "receipt_attachments_added_by_person_id_persons_id_fk" FOREIGN KEY ("added_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_put_away_location_id_storage_locations_id_fk" FOREIGN KEY ("put_away_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_quotes" ADD CONSTRAINT "rfq_quotes_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_quotes" ADD CONSTRAINT "rfq_quotes_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_awarded_quote_id_rfq_quotes_id_fk" FOREIGN KEY ("awarded_quote_id") REFERENCES "public"."rfq_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_awarded_by_person_id_persons_id_fk" FOREIGN KEY ("awarded_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_decided_by_person_id_persons_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_location_id_storage_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_location_id_storage_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_positions" ADD CONSTRAINT "stock_positions_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_positions" ADD CONSTRAINT "stock_positions_location_id_storage_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_positions" ADD CONSTRAINT "stock_positions_reserved_for_project_id_projects_id_fk" FOREIGN KEY ("reserved_for_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x3_sync_runs" ADD CONSTRAINT "x3_sync_runs_requested_by_person_id_persons_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vigie_eco_approvals" ADD CONSTRAINT "vigie_eco_approvals_eco_id_vigie_ecos_id_fk" FOREIGN KEY ("eco_id") REFERENCES "public"."vigie_ecos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vigie_eco_effectivity" ADD CONSTRAINT "vigie_eco_effectivity_eco_id_vigie_ecos_id_fk" FOREIGN KEY ("eco_id") REFERENCES "public"."vigie_ecos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vigie_eco_parts" ADD CONSTRAINT "vigie_eco_parts_eco_id_vigie_ecos_id_fk" FOREIGN KEY ("eco_id") REFERENCES "public"."vigie_ecos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vigie_eco_progress" ADD CONSTRAINT "vigie_eco_progress_eco_id_vigie_ecos_id_fk" FOREIGN KEY ("eco_id") REFERENCES "public"."vigie_ecos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vigie_eco_progress" ADD CONSTRAINT "vigie_eco_progress_actor_person_id_persons_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vigie_eco_projects" ADD CONSTRAINT "vigie_eco_projects_eco_id_vigie_ecos_id_fk" FOREIGN KEY ("eco_id") REFERENCES "public"."vigie_ecos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vigie_ecos" ADD CONSTRAINT "vigie_ecos_requested_by_person_id_persons_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;