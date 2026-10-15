-- Custom SQL migration file, put your code below! --
-- Delivery 8, R-168 (spec 11 §3.12): the audit trail is append-only. In this order (an existing data directory has rows):
-- 1. the user behind each existing row, from its person (users.person_id is unique);
-- 2. a trigger function that refuses the change;
-- 3. a row trigger refusing UPDATE and DELETE (a cascaded foreign-key action included) and a statement trigger refusing TRUNCATE.
-- Tamper evidence, not tamper proof: the table owner can still disable the triggers. Real immutability needs a separate owner
-- role and REVOKE (hosting, I-1a). A maintenance script that must rewrite rows (GDPR purge, R-173) runs
-- ALTER TABLE "audit_entries" DISABLE TRIGGER ... and ENABLE TRIGGER ... inside one transaction, as the table owner.
UPDATE "audit_entries" AS a SET "actor_user_id" = u."id"
FROM "users" AS u
WHERE a."actor_user_id" IS NULL AND a."actor_person_id" IS NOT NULL AND u."person_id" = a."actor_person_id";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "audit_entries_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_entries is append-only: % refused', TG_OP
    USING ERRCODE = 'restrict_violation', HINT = 'The audit trail can only be added to (R-168).';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_entries_no_update_delete" ON "audit_entries";
--> statement-breakpoint
CREATE TRIGGER "audit_entries_no_update_delete" BEFORE UPDATE OR DELETE ON "audit_entries"
FOR EACH ROW EXECUTE FUNCTION "audit_entries_append_only"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_entries_no_truncate" ON "audit_entries";
--> statement-breakpoint
CREATE TRIGGER "audit_entries_no_truncate" BEFORE TRUNCATE ON "audit_entries"
FOR EACH STATEMENT EXECUTE FUNCTION "audit_entries_append_only"();
