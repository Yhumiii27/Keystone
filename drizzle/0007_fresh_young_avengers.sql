ALTER TABLE "projects" ADD COLUMN "budget_rate" numeric;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD COLUMN "sent_on" date;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "payment_rule" text DEFAULT 'net' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "payment_days" integer DEFAULT 45 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD COLUMN "currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD COLUMN "amendment_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_amendment_id_contract_amendments_id_fk" FOREIGN KEY ("amendment_id") REFERENCES "public"."contract_amendments"("id") ON DELETE cascade ON UPDATE no action;