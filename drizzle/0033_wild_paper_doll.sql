ALTER TABLE "site_prerequisites" ADD COLUMN "alerted_needed_by" date;--> statement-breakpoint
ALTER TABLE "site_prerequisites" ADD COLUMN "alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_prerequisites" ADD COLUMN "risk_id" uuid;--> statement-breakpoint
ALTER TABLE "site_prerequisites" ADD CONSTRAINT "site_prerequisites_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE set null ON UPDATE no action;