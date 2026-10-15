DROP TABLE "job_title_rates" CASCADE;--> statement-breakpoint
ALTER TABLE "rate_multipliers" DROP COLUMN "factor";--> statement-breakpoint
ALTER TABLE "rate_roles" DROP COLUMN "base_rate_eur";--> statement-breakpoint
ALTER TABLE "rate_roles" DROP COLUMN "effective_from";