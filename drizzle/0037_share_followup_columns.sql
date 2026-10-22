CREATE TABLE "share_project_progress" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"situation_on" date NOT NULL,
	"progress_pct" numeric NOT NULL,
	"spi" numeric,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "capex_code" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "besoin_ref" text;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "share_project_progress" ADD CONSTRAINT "share_project_progress_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_capex_code_check" CHECK ("projects"."capex_code" ~ '^CPX-[A-Z]{3}-[0-9]{4}-[0-9]{2,}$');--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_besoin_ref_check" CHECK ("projects"."besoin_ref" is null or ("projects"."capex_code" is not null and "projects"."besoin_ref" ~ '^CPX-[A-Z]{3}-[0-9]{4}-[0-9]{2,}/B[0-9]{2,}$' and starts_with("projects"."besoin_ref", "projects"."capex_code" || '/')));