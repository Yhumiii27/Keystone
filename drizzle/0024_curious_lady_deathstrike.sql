CREATE TABLE "cursus_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"emitted_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"replace_key" text,
	"matricule" text,
	"data" jsonb NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"processed_at" timestamp with time zone,
	CONSTRAINT "cursus_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "leave_entries" ALTER COLUMN "source" SET DEFAULT 'cursus';--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "matricule" text;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "directory_team" text;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "directory_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "cursus_events_replace_idx" ON "cursus_events" USING btree ("type","replace_key");--> statement-breakpoint
CREATE INDEX "cursus_events_status_idx" ON "cursus_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cursus_events_received_idx" ON "cursus_events" USING btree ("received_at");--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_matricule_unique" UNIQUE("matricule");