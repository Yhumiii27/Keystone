-- Custom SQL migration file, put your code below! --
-- R-186 (AC-4; Arche K-01, REQUESTS.md entry of 22 Oct 2026; docs/delivery-9/notes-r186-catalogue.md): the machine catalogue
-- (table machine_catalogue_entries, migration 0045) published to the CAPEX application.
-- 1. A published version is frozen (src/domain/machine-catalogue.ts): a row trigger refuses any change to a published or retired
--    version except published → retired, retired_at and updated_at, and refuses its deletion (a draft is edited and discarded
--    freely). Tamper evidence like the audit trail (0017): the table owner can still disable the trigger.
-- 2. View pub_catalogue_machines, contract K-01 column by column: one row per code and version, published and retired versions
--    only (drafts are never published). Same rules as 0035_share / 0038_share_followup: the view is a contract — a column is never
--    removed, renamed or moved, new columns go at the end; unqualified names ("public" on PGlite, "keystone" on the shared server
--    through search_path); WITH (security_barrier); the reader's grant (arche_app) is in Matrix (partage/90-droits.sql), and
--    Matrix's partage/30-keystone.sql is to be refreshed with this definition.
--    type_code = the machine type's stored code (as pub_parc_machines.type_machine_code); type_libelle = its label (the display
--    code when none). maj_le = machine_catalogue_entries.updated_at (index machine_catalogue_entries_updated_at_idx, K-11): moved
--    by every write of the row, and by a change of the machine type's label (src/server/dal/mtypes.ts).
CREATE OR REPLACE FUNCTION "machine_catalogue_entries_frozen"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'machine_catalogue_entries: version % of % is published and cannot be deleted', OLD.version, OLD.code
        USING ERRCODE = 'restrict_violation', HINT = 'A published catalogue version is frozen (R-186); retire it instead.';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.code, NEW.version, NEW.machine_type_code, NEW.variant, NEW.label, NEW.description, NEW.options, NEW.nominal_capacity,
      NEW.capacity_unit, NEW.indicative_price_keur, NEW.lead_time_weeks, NEW.published_at, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.code, OLD.version, OLD.machine_type_code, OLD.variant, OLD.label, OLD.description, OLD.options, OLD.nominal_capacity,
      OLD.capacity_unit, OLD.indicative_price_keur, OLD.lead_time_weeks, OLD.published_at, OLD.created_at)
     OR NOT (NEW.status = OLD.status OR (OLD.status = 'published' AND NEW.status = 'retired')) THEN
    RAISE EXCEPTION 'machine_catalogue_entries: version % of % is published and frozen', OLD.version, OLD.code
      USING ERRCODE = 'restrict_violation', HINT = 'A published catalogue version is frozen (R-186); create a new version.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "machine_catalogue_entries_frozen" ON "machine_catalogue_entries";
--> statement-breakpoint
CREATE TRIGGER "machine_catalogue_entries_frozen" BEFORE UPDATE OR DELETE ON "machine_catalogue_entries"
FOR EACH ROW EXECUTE FUNCTION "machine_catalogue_entries_frozen"();
--> statement-breakpoint
CREATE OR REPLACE VIEW pub_catalogue_machines WITH (security_barrier) AS
SELECT e.code,
       e.version,
       e.machine_type_code                  AS type_code,
       coalesce(mt.name, mt.label)          AS type_libelle,
       e.variant                            AS variante,
       e.label                              AS libelle,
       e.description,
       e.options,
       e.nominal_capacity                   AS capacite_nominale,
       e.capacity_unit                      AS unite_capacite,
       e.indicative_price_keur              AS prix_indicatif_keur,
       e.lead_time_weeks                    AS delai_type_semaines,
       CASE e.status WHEN 'published' THEN 'publie' ELSE 'retire' END AS statut,
       e.updated_at                         AS maj_le
FROM machine_catalogue_entries e
JOIN machine_types mt ON mt.code = e.machine_type_code
WHERE e.status IN ('published', 'retired');
--> statement-breakpoint
COMMENT ON VIEW pub_catalogue_machines IS 'Contrat K-01 v1 (R-186) : catalogue machines publié aux filiales, une ligne par fiche et version (publiées et retirées ; jamais les brouillons) ; une version publiée est figée, la publication d''une nouvelle version retire la précédente. Lecteurs : arche_app.';
