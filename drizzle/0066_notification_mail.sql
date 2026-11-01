ALTER TABLE "notification_recipients" ADD COLUMN "mail_state" text;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD COLUMN "mail_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD COLUMN "mail_error" text;--> statement-breakpoint
ALTER TABLE "reminder_preferences" ADD COLUMN "notification_modes" jsonb;--> statement-breakpoint
CREATE INDEX "notification_recipients_mail_state_idx" ON "notification_recipients" USING btree ("mail_state");