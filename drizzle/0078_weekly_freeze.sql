ALTER TABLE "status_snapshots" DROP CONSTRAINT "status_snapshots_project_id_week_code_unique";--> statement-breakpoint
ALTER TABLE "status_snapshots" ADD COLUMN "risk_count" integer;--> statement-breakpoint
ALTER TABLE "status_snapshots" ADD COLUMN "progress_pct" numeric;--> statement-breakpoint
ALTER TABLE "status_snapshots" ADD COLUMN "margin_pct" numeric;--> statement-breakpoint
ALTER TABLE "status_snapshots" ADD CONSTRAINT "status_snapshots_project_id_status_date_unique" UNIQUE("project_id","status_date");