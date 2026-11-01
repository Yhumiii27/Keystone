CREATE TABLE "matrix_subsidiaries" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country_iso2" text,
	"zone_code" text,
	"currency" text,
	"position" integer,
	"active" boolean NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lessons_learned_updated_at_idx" ON "lessons_learned" USING btree ("updated_at");