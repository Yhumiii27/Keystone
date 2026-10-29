CREATE TABLE "reminder_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email_reminders" boolean NOT NULL,
	"email_reports" boolean NOT NULL,
	"offsets" integer[] NOT NULL,
	"overdue" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"item_key" text NOT NULL,
	"slot" text NOT NULL,
	"occurrence" text NOT NULL,
	"run_on" date NOT NULL,
	"notification_code" text,
	"email_status" text,
	"email_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_sends_key_unique" UNIQUE("person_id","item_key","slot","occurrence")
);
--> statement-breakpoint
ALTER TABLE "reminder_preferences" ADD CONSTRAINT "reminder_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_sends" ADD CONSTRAINT "reminder_sends_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminder_sends_run_on_idx" ON "reminder_sends" USING btree ("run_on");