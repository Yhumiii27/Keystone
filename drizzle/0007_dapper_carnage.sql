ALTER TABLE "vigie_eco_progress" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vigie_ncr_progress" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cursus_requests" ADD COLUMN "claimed_at" timestamp with time zone;