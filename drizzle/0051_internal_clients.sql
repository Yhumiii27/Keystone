ALTER TABLE "clients" ADD COLUMN "is_internal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "subsidiary_code" text;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_subsidiary_code_unique" UNIQUE("subsidiary_code");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_subsidiary_code_check" CHECK ("clients"."subsidiary_code" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_subsidiary_internal_check" CHECK ("clients"."subsidiary_code" is null or "clients"."is_internal");