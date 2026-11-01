-- Custom SQL migration file, put your code below! --
-- R-010 (delivery 9): optimistic locking of edited records. Each table below got a "version" column (previous migration,
-- default 1). This trigger adds 1 to it whenever an UPDATE changes the row's content, whoever writes it — Keystone's edit
-- forms, status transitions, imports, connectors —, so an edit form saved on a record changed meanwhile is refused
-- (src/server/dal/record-version.ts). Not counted as a change: "version" and "updated_at" themselves, and the derived columns
-- named as the trigger's arguments (CPM dates and floats of an activity, display positions, imported actuals and the cost
-- forecast of a category, kept by the cost screens, the activity a risk points to, cleared and set back by the Plan trash): a Reschedule
-- or a re-order never makes a form stale. A writer that sets "version" itself (version + 1: an activity's relationships, kept
-- in another table) keeps its value.
CREATE OR REPLACE FUNCTION "ks_bump_row_version"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ignored text[] := TG_ARGV::text[] || ARRAY['version', 'updated_at'];
BEGIN
  IF NEW."version" IS DISTINCT FROM OLD."version" THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
    NEW."version" := OLD."version" + 1;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "activities_row_version" ON "activities";
--> statement-breakpoint
CREATE TRIGGER "activities_row_version" BEFORE UPDATE ON "activities" FOR EACH ROW EXECUTE FUNCTION "ks_bump_row_version"(
  'start_text', 'start_actual', 'finish_text', 'finish_actual', 'start_date', 'finish_date', 'baseline_finish_text', 'baseline_finish_date',
  'variance_days', 'constraint_violated', 'total_float_days', 'early_start_date', 'early_finish_date', 'late_start_date', 'late_finish_date',
  'free_float_days', 'scheduled_at', 'position', 'actual_keur'
);
--> statement-breakpoint
DROP TRIGGER IF EXISTS "risks_row_version" ON "risks";
--> statement-breakpoint
CREATE TRIGGER "risks_row_version" BEFORE UPDATE ON "risks" FOR EACH ROW EXECUTE FUNCTION "ks_bump_row_version"('sort_order', 'activity_id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS "contracts_row_version" ON "contracts";
--> statement-breakpoint
CREATE TRIGGER "contracts_row_version" BEFORE UPDATE ON "contracts" FOR EACH ROW EXECUTE FUNCTION "ks_bump_row_version"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "payment_milestones_row_version" ON "payment_milestones";
--> statement-breakpoint
CREATE TRIGGER "payment_milestones_row_version" BEFORE UPDATE ON "payment_milestones" FOR EACH ROW EXECUTE FUNCTION "ks_bump_row_version"('position');
--> statement-breakpoint
DROP TRIGGER IF EXISTS "cost_categories_row_version" ON "cost_categories";
--> statement-breakpoint
CREATE TRIGGER "cost_categories_row_version" BEFORE UPDATE ON "cost_categories" FOR EACH ROW EXECUTE FUNCTION "ks_bump_row_version"(
  'actual_keur', 'committed_keur', 'forecast_keur', 'position'
);
--> statement-breakpoint
DROP TRIGGER IF EXISTS "warranty_claims_row_version" ON "warranty_claims";
--> statement-breakpoint
CREATE TRIGGER "warranty_claims_row_version" BEFORE UPDATE ON "warranty_claims" FOR EACH ROW EXECUTE FUNCTION "ks_bump_row_version"('position');
