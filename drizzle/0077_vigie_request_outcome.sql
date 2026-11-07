ALTER TABLE "vigie_eco_progress" ADD COLUMN "vigie_outcome" text;--> statement-breakpoint
ALTER TABLE "vigie_eco_progress" ADD COLUMN "vigie_result_code" text;--> statement-breakpoint
ALTER TABLE "vigie_eco_progress" ADD COLUMN "vigie_result" text;--> statement-breakpoint
ALTER TABLE "vigie_eco_progress" ADD COLUMN "vigie_processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vigie_ncr_progress" ADD COLUMN "vigie_outcome" text;--> statement-breakpoint
ALTER TABLE "vigie_ncr_progress" ADD COLUMN "vigie_result_code" text;--> statement-breakpoint
ALTER TABLE "vigie_ncr_progress" ADD COLUMN "vigie_result" text;--> statement-breakpoint
ALTER TABLE "vigie_ncr_progress" ADD COLUMN "vigie_processed_at" timestamp with time zone;