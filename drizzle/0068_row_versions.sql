CREATE TABLE "connector_refresh_claims" (
	"key" text PRIMARY KEY NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_categories" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_milestones" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;