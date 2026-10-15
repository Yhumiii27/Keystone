CREATE TABLE "codex_index_awaiting" (
	"number" text PRIMARY KEY NOT NULL,
	"project_code" text NOT NULL,
	"type_code" text NOT NULL,
	"read_since" timestamp with time zone,
	"skipped_at" timestamp with time zone NOT NULL
);
