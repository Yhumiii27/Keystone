CREATE TABLE "incoterms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_fr" text NOT NULL,
	"description_en" text DEFAULT '' NOT NULL,
	"description_fr" text DEFAULT '' NOT NULL,
	"modes" text NOT NULL,
	"split" jsonb NOT NULL,
	"standard" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incoterms_code_unique" UNIQUE("code"),
	CONSTRAINT "incoterms_code_check" CHECK ("incoterms"."code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "incoterms_modes_check" CHECK ("incoterms"."modes" in ('any', 'sea'))
);
--> statement-breakpoint
CREATE TABLE "shipment_equipments" (
	"shipment_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	CONSTRAINT "shipment_equipments_shipment_id_equipment_id_pk" PRIMARY KEY("shipment_id","equipment_id")
);
--> statement-breakpoint
CREATE TABLE "shipment_gap_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"gap_key" text NOT NULL,
	"delta" numeric NOT NULL,
	"reason" text NOT NULL,
	"by_person_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_gap_reasons_key_unique" UNIQUE("shipment_id","gap_key")
);
--> statement-breakpoint
CREATE TABLE "shipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"load_id" uuid NOT NULL,
	"part_id" uuid,
	"description" text,
	"hs_code" text,
	"unit_value_eur" numeric,
	"quantity" numeric NOT NULL,
	"packages" integer,
	"length_cm" numeric,
	"width_cm" numeric,
	"height_cm" numeric,
	"net_kg" numeric,
	"gross_kg" numeric,
	"origin_country" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_items_kind_check" CHECK (("shipment_items"."part_id" is not null) or ("shipment_items"."description" is not null)),
	CONSTRAINT "shipment_items_quantity_check" CHECK ("shipment_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "shipment_loads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"load_type" text NOT NULL,
	"identifier" text,
	"seal" text,
	"gross_kg" numeric,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_loads_number_unique" UNIQUE("shipment_id","number"),
	CONSTRAINT "shipment_loads_type_check" CHECK ("shipment_loads"."load_type" in ('truck', 'c20', 'c40', 'c40hc', 'open_top', 'flat_rack', 'out_of_gauge'))
);
--> statement-breakpoint
CREATE TABLE "shipment_steps" (
	"shipment_id" uuid NOT NULL,
	"step" text NOT NULL,
	"planned_on" date,
	"actual_on" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_steps_shipment_id_step_pk" PRIMARY KEY("shipment_id","step")
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"label" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"mode" text,
	"forwarder" text,
	"origin" text,
	"destination" text,
	"etd" date,
	"eta" date,
	"atd" date,
	"ata" date,
	"note" text,
	"packing_validated_at" timestamp with time zone,
	"packing_validated_by_person_id" uuid,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_project_ref_unique" UNIQUE("project_id","ref"),
	CONSTRAINT "shipments_ref_check" CHECK ("shipments"."ref" ~ '^EXP-[0-9]{2,}$'),
	CONSTRAINT "shipments_status_check" CHECK ("shipments"."status" in ('draft', 'prepared', 'picked_up', 'in_transit', 'arrived', 'received', 'closed')),
	CONSTRAINT "shipments_mode_check" CHECK ("shipments"."mode" is null or "shipments"."mode" in ('road', 'sea', 'air', 'multimodal'))
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "incoterm_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "incoterm_place" text;--> statement-breakpoint
ALTER TABLE "shipment_equipments" ADD CONSTRAINT "shipment_equipments_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_equipments" ADD CONSTRAINT "shipment_equipments_equipment_id_project_equipments_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."project_equipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_gap_reasons" ADD CONSTRAINT "shipment_gap_reasons_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_gap_reasons" ADD CONSTRAINT "shipment_gap_reasons_by_person_id_persons_id_fk" FOREIGN KEY ("by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_load_id_shipment_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."shipment_loads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_loads" ADD CONSTRAINT "shipment_loads_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_steps" ADD CONSTRAINT "shipment_steps_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_packing_validated_by_person_id_persons_id_fk" FOREIGN KEY ("packing_validated_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_person_id_persons_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_incoterm_id_incoterms_id_fk" FOREIGN KEY ("incoterm_id") REFERENCES "public"."incoterms"("id") ON DELETE no action ON UPDATE no action;