ALTER TABLE "parts" ADD COLUMN "hs_not_applicable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "export_reviewed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "validated_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "cancelled_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_validated_by_person_id_persons_id_fk" FOREIGN KEY ("validated_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cancelled_by_person_id_persons_id_fk" FOREIGN KEY ("cancelled_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;