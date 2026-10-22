CREATE TABLE "cursus_task_pushes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"trigger" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"since" date NOT NULL,
	"projects" integer DEFAULT 0 NOT NULL,
	"tasks" integer DEFAULT 0 NOT NULL,
	"persons" integer DEFAULT 0 NOT NULL,
	"without_matricule" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"payload" jsonb,
	"result" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "cursus_task_pushes_requested_idx" ON "cursus_task_pushes" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "cursus_task_pushes_status_idx" ON "cursus_task_pushes" USING btree ("status");