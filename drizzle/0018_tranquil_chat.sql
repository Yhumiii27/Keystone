ALTER TABLE "stored_files" ADD COLUMN "scan_status" text DEFAULT 'unscanned' NOT NULL;--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "scan_signature" text;