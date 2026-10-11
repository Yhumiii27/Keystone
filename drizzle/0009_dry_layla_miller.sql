CREATE TABLE "job_locks" (
	"job" text PRIMARY KEY NOT NULL,
	"holder" text,
	"locked_until" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_ok" boolean,
	"last_summary" text,
	"last_error" text,
	"run_count" integer DEFAULT 0 NOT NULL
);
