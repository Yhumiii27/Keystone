CREATE TABLE "approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"substitute_user_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"note" text,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_name" text,
	"cancel_reason" text
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "on_behalf_of_name" text;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "on_behalf_of_name" text;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_substitute_user_id_users_id_fk" FOREIGN KEY ("substitute_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_delegations_approver_idx" ON "approval_delegations" USING btree ("approver_user_id");--> statement-breakpoint
CREATE INDEX "approval_delegations_substitute_idx" ON "approval_delegations" USING btree ("substitute_user_id");