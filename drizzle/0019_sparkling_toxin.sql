CREATE TABLE "rate_multiplier_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"effective_from" date NOT NULL,
	"factor" numeric NOT NULL,
	"created_by_name" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_multiplier_rates_key_effective_from_unique" UNIQUE("key","effective_from")
);
--> statement-breakpoint
CREATE TABLE "rate_role_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_role_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"base_rate_eur" numeric NOT NULL,
	"created_by_name" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_role_rates_rate_role_id_effective_from_unique" UNIQUE("rate_role_id","effective_from")
);
--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "rate_role_id" uuid;--> statement-breakpoint
ALTER TABLE "rate_multiplier_rates" ADD CONSTRAINT "rate_multiplier_rates_key_rate_multipliers_key_fk" FOREIGN KEY ("key") REFERENCES "public"."rate_multipliers"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_multiplier_rates" ADD CONSTRAINT "rate_multiplier_rates_created_by_person_id_persons_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_role_rates" ADD CONSTRAINT "rate_role_rates_rate_role_id_rate_roles_id_fk" FOREIGN KEY ("rate_role_id") REFERENCES "public"."rate_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_role_rates" ADD CONSTRAINT "rate_role_rates_created_by_person_id_persons_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_rate_role_id_rate_roles_id_fk" FOREIGN KEY ("rate_role_id") REFERENCES "public"."rate_roles"("id") ON DELETE set null ON UPDATE no action;