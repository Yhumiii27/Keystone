CREATE TABLE "risk_analysis_delays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"risk_id" uuid NOT NULL,
	"delay_days" integer NOT NULL,
	"updated_by_person_id" uuid,
	"updated_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_analysis_delays_risk_id_unique" UNIQUE("risk_id"),
	CONSTRAINT "risk_analysis_delays_days_check" CHECK ("risk_analysis_delays"."delay_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "risk_analysis_ranges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"duration_min" numeric,
	"duration_likely" numeric,
	"duration_max" numeric,
	"cost_min_keur" numeric,
	"cost_likely_keur" numeric,
	"cost_max_keur" numeric,
	"updated_by_person_id" uuid,
	"updated_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_analysis_ranges_activity_id_unique" UNIQUE("activity_id"),
	CONSTRAINT "risk_analysis_ranges_duration_check" CHECK (("risk_analysis_ranges"."duration_min" is null and "risk_analysis_ranges"."duration_likely" is null and "risk_analysis_ranges"."duration_max" is null) or (0 <= "risk_analysis_ranges"."duration_min" and "risk_analysis_ranges"."duration_min" <= "risk_analysis_ranges"."duration_likely" and "risk_analysis_ranges"."duration_likely" <= "risk_analysis_ranges"."duration_max")),
	CONSTRAINT "risk_analysis_ranges_cost_check" CHECK (("risk_analysis_ranges"."cost_min_keur" is null and "risk_analysis_ranges"."cost_likely_keur" is null and "risk_analysis_ranges"."cost_max_keur" is null) or (0 <= "risk_analysis_ranges"."cost_min_keur" and "risk_analysis_ranges"."cost_min_keur" <= "risk_analysis_ranges"."cost_likely_keur" and "risk_analysis_ranges"."cost_likely_keur" <= "risk_analysis_ranges"."cost_max_keur"))
);
--> statement-breakpoint
CREATE TABLE "risk_analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ran_by_person_id" uuid,
	"ran_by_name" text NOT NULL,
	"data_date" date NOT NULL,
	"iterations" integer NOT NULL,
	"seed" integer NOT NULL,
	"target_finish" date,
	"target_finish_source" text NOT NULL,
	"target_cost_keur" numeric,
	"inputs" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "risk_analysis_delays" ADD CONSTRAINT "risk_analysis_delays_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_analysis_delays" ADD CONSTRAINT "risk_analysis_delays_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_analysis_delays" ADD CONSTRAINT "risk_analysis_delays_updated_by_person_id_persons_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_analysis_ranges" ADD CONSTRAINT "risk_analysis_ranges_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_analysis_ranges" ADD CONSTRAINT "risk_analysis_ranges_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_analysis_ranges" ADD CONSTRAINT "risk_analysis_ranges_updated_by_person_id_persons_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_analysis_runs" ADD CONSTRAINT "risk_analysis_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_analysis_runs" ADD CONSTRAINT "risk_analysis_runs_ran_by_person_id_persons_id_fk" FOREIGN KEY ("ran_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "risk_analysis_delays_project_id_idx" ON "risk_analysis_delays" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "risk_analysis_ranges_project_id_idx" ON "risk_analysis_ranges" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "risk_analysis_runs_project_ran_idx" ON "risk_analysis_runs" USING btree ("project_id","ran_at");