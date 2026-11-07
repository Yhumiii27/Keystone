-- Custom SQL migration file, put your code below! --
-- Matrix M-19 (owner's « validé », 5 Nov 2026; REQUESTS.md; Matrix docs/edition-par-les-outils.md): the edit function
-- keystone.pub_editer(p_table, p_action, p_cle, p_valeurs, p_par, p_motif). The IT administrator corrects Keystone's data from
-- Matrix's data viewer; Matrix never writes in Keystone's tables (M-18): it calls this function, which applies Keystone's rules
-- and writes Keystone's audit trail (R-168, append-only), with the Matrix user's name as actor and the reason typed in Matrix.
-- Owner's restriction (session of 7 Nov 2026): a CLOSED list of tables and, per table, of columns — reference lists, stock
-- locations, clients, suppliers, people's non-sensitive fields, projects' descriptive fields (docs/delivery-9/notes-m19-edit.md).
-- Everything else is refused (users, roles and rights, audit trail, connectors, outboxes, mirrors of other tools, settings
-- validated in TypeScript…), and any personal-sensitive column even when named (Matrix never sends one; the function does not
-- rely on it). "retirer" deactivates where the table has that notion; tables without it refuse it (Keystone deletes none of them).
-- Refusals: RAISE EXCEPTION, French message shown as is by Matrix; SQLSTATE P0K01 (table, action or column not open),
-- P0K02 (invalid argument: reason, actor, key, value), P0K03 (Keystone rule), P0K04 (row not found).
-- Server layout: written in "public" like every migration; the server migrator rewrites "public". into "keystone". The
-- search_path is set by the last statement from the schema that holds audit_entries: `keystone, pg_temp` on the shared server,
-- `public, pg_temp` on PGlite. EXECUTE is revoked from PUBLIC: the right to run it is a Matrix link (matrix_app → this function),
-- never a grant in a Keystone migration.

-- A text value of p_valeurs: string or null, trimmed, '' = null; required and maximum length checked.
CREATE OR REPLACE FUNCTION "public"."ks_edit_text"(p_vals jsonb, p_col text, p_max integer, p_required boolean) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v jsonb := p_vals -> p_col;
  t text;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) = 'null' THEN
    t := NULL;
  ELSIF jsonb_typeof(v) <> 'string' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = format('Valeur de « %s » invalide : texte attendu', p_col);
  ELSE
    t := nullif(btrim(v #>> '{}'), '');
  END IF;
  IF t IS NULL AND p_required THEN
    RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = format('« %s » est obligatoire', p_col);
  END IF;
  IF length(t) > p_max THEN
    RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = format('« %s » est trop long (%s caractères au plus)', p_col, p_max);
  END IF;
  RETURN t;
END;
$$;
--> statement-breakpoint
-- The code of a new list entry, as slugOf (src/server/db/codes.ts): accents removed, lower case, runs of other characters → "_".
CREATE OR REPLACE FUNCTION "public"."ks_edit_slug"(p_label text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(nullif(btrim(regexp_replace(lower(regexp_replace(normalize(p_label, NFD), '[̀-ͯ]', '', 'g')), '[^a-z0-9]+', '_', 'g'), '_'), ''), 'item');
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."pub_editer"(p_table text, p_action text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  -- The closed list: table → actions open to Matrix, and per action the columns Matrix may write.
  c_open constant jsonb := '{
    "reference_values":  {"ajouter": ["list_key", "label"], "corriger": ["label"], "retirer": []},
    "storage_locations": {"ajouter": ["name", "location_type"], "corriger": ["name", "location_type"], "retirer": []},
    "clients":           {"ajouter": ["name"], "corriger": ["name"]},
    "suppliers":         {"ajouter": ["name", "x3_code"], "corriger": ["name", "x3_code"]},
    "persons":           {"corriger": ["full_name", "initials", "job_title"]},
    "projects":          {"corriger": ["name", "short_name"]}
  }';
  -- Personal-sensitive columns (GDPR): refused whatever the table's list says, and never returned.
  c_sensitive constant text[] := ARRAY['persons.email', 'persons.matricule', 'persons.rate_role_id', 'users.email', 'users.entra_object_id', 'rate_roles.base_rate_eur'];
  -- Why an action or a column stays closed (shown to Matrix's user).
  c_why constant jsonb := '{
    "clients.retirer": "un client ne se retire pas : Keystone n''archive ni ne supprime les clients (projets, contrats et parc installé les citent)",
    "suppliers.retirer": "un fournisseur ne se retire pas : Keystone n''archive ni ne supprime les fournisseurs (articles, commandes et factures les citent)",
    "persons.ajouter": "une personne est créée par l''annuaire de Cursus ou à sa première connexion",
    "persons.retirer": "une personne ne se retire pas de Keystone (annuaire de Cursus)",
    "projects.ajouter": "un projet se crée dans Keystone (assistant « Nouveau projet » : numéro, code analytique, modèle)",
    "projects.retirer": "un projet s''annule dans Keystone (cycle de vie, étape « Annulé »)",
    "persons.short_name": "le nom court cite la personne dans les projets et les enregistrements",
    "clients.code3": "le code client à 3 lettres est enregistré et réservé aux filiales (règles de Keystone)",
    "clients.is_internal": "la filiale d''un client se déclare dans Keystone (écran Contrat, liste des filiales de Matrix)",
    "clients.subsidiary_code": "la filiale d''un client se déclare dans Keystone (écran Contrat, liste des filiales de Matrix)",
    "projects.code": "le code projet est la clé partagée avec les autres outils",
    "projects.stage": "l''étape d''un projet change par le cycle de vie de Keystone",
    "suppliers.grade": "la note fournisseur vient de Vigie",
    "reference_values.code": "le code d''une valeur est sa clé dans les enregistrements"
  }';
  c_stages_required constant text[] := ARRAY['initiative', 'clos', 'annule'];
  c_location_types constant text[] := ARRAY['central_warehouse', 'workshop', 'site_store', 'consignment', 'quarantine'];
  c_list_titles constant jsonb := '{"skills": "Skills & levels", "costCats": "Cost categories", "statuses": "Project statuses", "riskCats": "Risk categories", "delivTypes": "Deliverable types", "holidays": "Public holidays 2026 — France", "locTypes": "Location types"}';

  v_table text := btrim(coalesce(p_table, ''));
  v_action text := btrim(coalesce(p_action, ''));
  v_par text := btrim(coalesce(p_par, ''));
  v_motif text := btrim(coalesce(p_motif, ''));
  v_vals jsonb := CASE WHEN p_valeurs IS NULL OR jsonb_typeof(p_valeurs) = 'null' THEN '{}'::jsonb ELSE p_valeurs END;
  v_cols text[];
  v_hide text[];
  v_col text;
  v_id uuid;
  v_old jsonb;
  v_new jsonb;
  v_before jsonb := NULL;
  v_after jsonb := NULL;
  v_ref text;
  v_change text;
  v_entity text;
  v_project uuid := NULL;
  v_found boolean;
  v_pos integer;
  v_code text;
  v_base text;
  v_i integer;
  v_list text;
  v_label text;
  v_name text;
  v_type text;
  v_x3 text;
  v_full text;
  v_initials text;
  v_job text;
  v_short text;
  r_rv reference_values;
  r_loc storage_locations;
  r_cli clients;
  r_sup suppliers;
  r_per persons;
  r_prj projects;
BEGIN
  -- 1. Table, action, actor and reason.
  IF NOT c_open ? v_table THEN
    RAISE EXCEPTION USING ERRCODE = 'P0K01', MESSAGE = format(
      'Table « %s » non modifiable depuis Matrix : Keystone n''ouvre que %s', v_table,
      (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(c_open) AS k));
  END IF;
  IF v_action NOT IN ('ajouter', 'corriger', 'retirer') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0K01', MESSAGE = format('Action « %s » inconnue : ajouter, corriger ou retirer', v_action);
  END IF;
  IF NOT (c_open -> v_table) ? v_action THEN
    RAISE EXCEPTION USING ERRCODE = 'P0K01', MESSAGE = format('« %s » refusé sur %s : %s', v_action, v_table,
      coalesce(c_why ->> (v_table || '.' || v_action), 'action non ouverte depuis Matrix'));
  END IF;
  IF v_motif = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = 'Le motif est obligatoire';
  END IF;
  IF length(v_motif) > 2000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = 'Le motif est trop long (2000 caractères au plus)';
  END IF;
  IF v_par = '' OR length(v_par) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = 'Le nom de la personne connectée à Matrix (p_par) est obligatoire (200 caractères au plus)';
  END IF;

  SELECT coalesce(array_agg(split_part(s, '.', 2)), '{}') INTO v_hide FROM unnest(c_sensitive) AS s WHERE split_part(s, '.', 1) = v_table;

  -- 2. Key: none to add, {"id": "<uuid>"} to correct or remove.
  IF v_action = 'ajouter' THEN
    IF p_cle IS NOT NULL AND jsonb_typeof(p_cle) <> 'null' AND p_cle <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = 'Pas de clé pour « ajouter » : Keystone attribue l''identifiant';
    END IF;
  ELSE
    IF p_cle IS NULL OR jsonb_typeof(p_cle) <> 'object' OR (SELECT array_agg(k) FROM jsonb_object_keys(p_cle) AS k) <> ARRAY['id']
       OR jsonb_typeof(p_cle -> 'id') <> 'string' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = 'Clé invalide : {"id": "<identifiant>"} attendu';
    END IF;
    BEGIN
      v_id := (p_cle ->> 'id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = format('Clé invalide : « %s » n''est pas un identifiant', p_cle ->> 'id');
    END;
  END IF;

  -- 3. Values: an object; sensitive columns refused first, then every column outside the table's list for this action.
  IF jsonb_typeof(v_vals) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = 'Valeurs invalides : un objet {"colonne": valeur} attendu';
  END IF;
  SELECT coalesce(array_agg(x), '{}') INTO v_cols FROM jsonb_array_elements_text((c_open -> v_table) -> v_action) AS x;
  FOR v_col IN SELECT k FROM jsonb_object_keys(v_vals) AS k ORDER BY k LOOP
    IF (v_table || '.' || v_col) = ANY (c_sensitive) OR v_col ~* '(secret|token|password|passwd|api_key|credential)' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0K01', MESSAGE = format('Colonne sensible « %s.%s » refusée (données personnelles, RGPD)', v_table, v_col);
    END IF;
    IF NOT v_col = ANY (v_cols) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0K01', MESSAGE = format('Colonne « %s » non modifiable sur %s depuis Matrix : %s', v_col, v_table,
        coalesce(c_why ->> (v_table || '.' || v_col),
          CASE WHEN cardinality(v_cols) = 0 THEN 'aucune valeur pour « ' || v_action || ' »' ELSE 'colonnes admises pour « ' || v_action || ' » : ' || array_to_string(v_cols, ', ') END));
    END IF;
  END LOOP;
  IF v_action <> 'retirer' AND v_vals = '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = format('Aucune valeur à écrire (colonnes admises : %s)', array_to_string(v_cols, ', '));
  END IF;

  -- One writer at a time, like every Keystone transaction on the shared server (src/server/db/server-schema.ts, WRITE_LOCK_NAME).
  PERFORM pg_advisory_xact_lock(hashtext('keystone.ecritures'));

  -- 4. The table's rules (the same as Keystone's writers: src/server/dal/settings.ts, projects.ts, parts.ts…).
  IF v_table = 'reference_values' THEN
    v_entity := 'reference_value';
    IF v_action = 'ajouter' THEN
      v_list := ks_edit_text(v_vals, 'list_key', 40, true);
      v_label := ks_edit_text(v_vals, 'label', 120, true);
      IF v_list = 'holidays' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = 'Un jour férié s''ajoute dans les Paramètres de Keystone (sa date est calculée pour l''année en cours)';
      ELSIF v_list = 'locTypes' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = 'Les types d''emplacement sont fixes';
      ELSIF v_list NOT IN ('riskCats', 'delivTypes', 'costCats', 'skills', 'statuses') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = format('Liste « %s » inconnue (riskCats, delivTypes, costCats, skills, statuses)', v_list);
      END IF;
      SELECT * INTO r_rv FROM reference_values WHERE list_key = v_list AND lower(label) = lower(v_label) ORDER BY active DESC LIMIT 1 FOR UPDATE;
      v_found := FOUND;
      IF v_found AND r_rv.active THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('« %s » est déjà dans la liste', v_label);
      END IF;
      IF NOT v_found AND v_list = 'statuses' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = 'Les statuts de projet sont les étapes du cycle de vie : une nouvelle étape demande une définition du cycle de vie (seule une étape désactivée peut revenir)';
      END IF;
      SELECT coalesce(max(position) + 1, 0) INTO v_pos FROM reference_values WHERE list_key = v_list;
      IF v_found THEN
        UPDATE reference_values SET active = true, position = v_pos, updated_at = now() WHERE id = r_rv.id RETURNING * INTO r_rv;
        v_change := format('reactivated "%s"', r_rv.label);
        v_before := jsonb_build_object('code', r_rv.code, 'label', r_rv.label, 'active', false);
      ELSE
        v_base := ks_edit_slug(v_label);
        v_code := v_base;
        v_i := 2;
        WHILE EXISTS (SELECT FROM reference_values WHERE list_key = v_list AND code = v_code) LOOP
          v_code := v_base || '_' || v_i;
          v_i := v_i + 1;
        END LOOP;
        INSERT INTO reference_values (list_key, code, label, position, active, is_default)
          VALUES (v_list, v_code, v_label, v_pos, true, false) RETURNING * INTO r_rv;
        v_change := format('added "%s"', r_rv.label);
      END IF;
      -- A skill family is a column of the skills matrix (all levels 0 until rated).
      IF v_list = 'skills' AND NOT EXISTS (SELECT FROM skills WHERE lower(name) = lower(r_rv.label)) THEN
        INSERT INTO skills (name, category, position) SELECT r_rv.label, NULL, coalesce(max(position), 0) + 1 FROM skills;
      END IF;
      v_after := jsonb_build_object('code', r_rv.code, 'label', r_rv.label, 'active', true);
    ELSE
      SELECT * INTO r_rv FROM reference_values WHERE id = v_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K04', MESSAGE = format('Valeur de liste %s introuvable', v_id);
      END IF;
      IF v_action = 'corriger' THEN
        IF r_rv.list_key NOT IN ('riskCats', 'delivTypes') THEN
          RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format(
            'Le libellé d''une valeur de la liste « %s » ne se corrige pas depuis Matrix (%s)', r_rv.list_key,
            CASE r_rv.list_key
              WHEN 'costCats' THEN 'les catégories de coût des projets sont reconnues par leur libellé'
              WHEN 'skills' THEN 'la compétence de la matrice est reconnue par son libellé'
              WHEN 'holidays' THEN 'le libellé d''un jour férié porte sa date'
              ELSE 'libellés tenus par Keystone' END);
        END IF;
        v_label := ks_edit_text(v_vals, 'label', 120, true);
        IF EXISTS (SELECT FROM reference_values WHERE list_key = r_rv.list_key AND id <> r_rv.id AND active AND lower(label) = lower(v_label)) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('« %s » est déjà dans la liste', v_label);
        END IF;
        v_old := to_jsonb(r_rv);
        IF r_rv.label IS DISTINCT FROM v_label THEN
          UPDATE reference_values SET label = v_label, updated_at = now() WHERE id = r_rv.id RETURNING * INTO r_rv;
        END IF;
      ELSE
        IF r_rv.list_key = 'locTypes' THEN
          RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = 'Les types d''emplacement sont fixes';
        END IF;
        IF r_rv.list_key = 'statuses' AND r_rv.code = ANY (c_stages_required) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = 'Cette étape est exigée par le cycle de vie (Initiative, Clos, Annulé)';
        END IF;
        IF NOT r_rv.active THEN
          RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('« %s » est déjà retiré', r_rv.label);
        END IF;
        -- Deactivated: no longer offered; the records that use it keep their code (A-14).
        UPDATE reference_values SET active = false, updated_at = now() WHERE id = r_rv.id RETURNING * INTO r_rv;
        v_change := format('deactivated "%s"', r_rv.label);
        v_before := jsonb_build_object('code', r_rv.code, 'label', r_rv.label, 'active', true);
        v_after := jsonb_build_object('code', r_rv.code, 'label', r_rv.label, 'active', false);
      END IF;
    END IF;
    v_ref := 'Settings · ' || coalesce(c_list_titles ->> r_rv.list_key, r_rv.list_key);
    v_id := r_rv.id;
    v_new := to_jsonb(r_rv);

  ELSIF v_table = 'storage_locations' THEN
    v_entity := 'storage_location';
    v_ref := 'Settings · Stock locations & workshops';
    IF v_action = 'ajouter' THEN
      v_name := ks_edit_text(v_vals, 'name', 120, true);
      v_type := ks_edit_text(v_vals, 'location_type', 40, true);
      IF NOT v_type = ANY (c_location_types) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = format('Type d''emplacement « %s » inconnu (%s)', v_type, array_to_string(c_location_types, ', '));
      END IF;
      SELECT * INTO r_loc FROM storage_locations WHERE lower(name) = lower(v_name) LIMIT 1 FOR UPDATE;
      v_found := FOUND;
      IF v_found AND r_loc.active THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('« %s » est déjà un emplacement', v_name);
      END IF;
      SELECT coalesce(max(position) + 1, 0) INTO v_pos FROM storage_locations;
      IF v_found THEN
        v_before := jsonb_build_object('name', r_loc.name, 'location_type', r_loc.location_type, 'active', false);
        UPDATE storage_locations SET active = true, location_type = v_type, position = v_pos, updated_at = now() WHERE id = r_loc.id RETURNING * INTO r_loc;
        v_change := format('reactivated "%s" (%s)', r_loc.name, r_loc.location_type);
      ELSE
        INSERT INTO storage_locations (name, location_type, position, active) VALUES (v_name, v_type, v_pos, true) RETURNING * INTO r_loc;
        v_change := format('added "%s" (%s)', r_loc.name, r_loc.location_type);
      END IF;
      v_after := jsonb_build_object('name', r_loc.name, 'location_type', r_loc.location_type, 'active', true);
    ELSE
      SELECT * INTO r_loc FROM storage_locations WHERE id = v_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K04', MESSAGE = format('Emplacement %s introuvable', v_id);
      END IF;
      IF v_action = 'corriger' THEN
        v_name := CASE WHEN v_vals ? 'name' THEN ks_edit_text(v_vals, 'name', 120, true) ELSE r_loc.name END;
        v_type := CASE WHEN v_vals ? 'location_type' THEN ks_edit_text(v_vals, 'location_type', 40, true) ELSE r_loc.location_type END;
        IF NOT v_type = ANY (c_location_types) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = format('Type d''emplacement « %s » inconnu (%s)', v_type, array_to_string(c_location_types, ', '));
        END IF;
        IF EXISTS (SELECT FROM storage_locations WHERE id <> r_loc.id AND lower(name) = lower(v_name)) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('« %s » est déjà un emplacement', v_name);
        END IF;
        v_old := to_jsonb(r_loc);
        IF (r_loc.name, r_loc.location_type) IS DISTINCT FROM (v_name, v_type) THEN
          UPDATE storage_locations SET name = v_name, location_type = v_type, updated_at = now() WHERE id = r_loc.id RETURNING * INTO r_loc;
        END IF;
      ELSE
        IF NOT r_loc.active THEN
          RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('« %s » est déjà retiré', r_loc.name);
        END IF;
        -- No longer offered; stock positions keep it.
        UPDATE storage_locations SET active = false, updated_at = now() WHERE id = r_loc.id RETURNING * INTO r_loc;
        v_change := format('removed "%s"', r_loc.name);
        v_before := jsonb_build_object('name', r_loc.name, 'active', true);
        v_after := jsonb_build_object('name', r_loc.name, 'active', false);
      END IF;
    END IF;
    v_id := r_loc.id;
    v_new := to_jsonb(r_loc);

  ELSIF v_table = 'clients' THEN
    v_entity := 'client';
    v_name := ks_edit_text(v_vals, 'name', 200, true);
    IF v_action = 'ajouter' THEN
      IF EXISTS (SELECT FROM clients WHERE lower(name) = lower(v_name)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('Le client « %s » existe déjà', v_name);
      END IF;
      INSERT INTO clients (name, sort_order) SELECT v_name, coalesce(max(sort_order), 0) + 1 FROM clients RETURNING * INTO r_cli;
      v_change := format('added client "%s"', r_cli.name);
      v_after := jsonb_build_object('name', r_cli.name);
    ELSE
      SELECT * INTO r_cli FROM clients WHERE id = v_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K04', MESSAGE = format('Client %s introuvable', v_id);
      END IF;
      IF EXISTS (SELECT FROM clients WHERE id <> r_cli.id AND lower(name) = lower(v_name)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('Le client « %s » existe déjà', v_name);
      END IF;
      v_old := to_jsonb(r_cli);
      IF r_cli.name IS DISTINCT FROM v_name THEN
        UPDATE clients SET name = v_name, updated_at = now() WHERE id = r_cli.id RETURNING * INTO r_cli;
        -- pub_projets.maj_le = projects.updated_at: the readers' incremental read sees the new client name on its projects.
        UPDATE projects SET updated_at = now() WHERE client_id = r_cli.id;
      END IF;
    END IF;
    v_ref := r_cli.name;
    v_id := r_cli.id;
    v_new := to_jsonb(r_cli);

  ELSIF v_table = 'suppliers' THEN
    v_entity := 'supplier';
    IF v_action = 'ajouter' THEN
      v_name := ks_edit_text(v_vals, 'name', 200, true);
      v_x3 := ks_edit_text(v_vals, 'x3_code', 40, false);
      IF EXISTS (SELECT FROM suppliers WHERE lower(name) = lower(v_name)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('Le fournisseur « %s » existe déjà', v_name);
      END IF;
      -- Keystone's own workshops are the suppliers named "Keystone …" (src/server/dal/parts.ts).
      INSERT INTO suppliers (name, x3_code, is_internal, position)
        SELECT v_name, v_x3, starts_with(v_name, 'Keystone '), coalesce(max(position), 0) + 1 FROM suppliers RETURNING * INTO r_sup;
      v_change := format('added supplier "%s"', r_sup.name);
      v_after := jsonb_build_object('name', r_sup.name, 'x3_code', r_sup.x3_code, 'is_internal', r_sup.is_internal);
    ELSE
      SELECT * INTO r_sup FROM suppliers WHERE id = v_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K04', MESSAGE = format('Fournisseur %s introuvable', v_id);
      END IF;
      v_name := CASE WHEN v_vals ? 'name' THEN ks_edit_text(v_vals, 'name', 200, true) ELSE r_sup.name END;
      v_x3 := CASE WHEN v_vals ? 'x3_code' THEN ks_edit_text(v_vals, 'x3_code', 40, false) ELSE r_sup.x3_code END;
      IF v_name IS DISTINCT FROM r_sup.name THEN
        IF r_sup.is_internal THEN
          RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = 'Le nom d''un atelier de Keystone ne se corrige pas depuis Matrix';
        END IF;
        IF starts_with(v_name, 'Keystone ') THEN
          RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = 'Les noms « Keystone … » sont réservés aux ateliers de Keystone';
        END IF;
        IF EXISTS (SELECT FROM suppliers WHERE id <> r_sup.id AND lower(name) = lower(v_name)) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('Le fournisseur « %s » existe déjà', v_name);
        END IF;
      END IF;
      v_old := to_jsonb(r_sup);
      IF (r_sup.name, r_sup.x3_code) IS DISTINCT FROM (v_name, v_x3) THEN
        UPDATE suppliers SET name = v_name, x3_code = v_x3, updated_at = now() WHERE id = r_sup.id RETURNING * INTO r_sup;
      END IF;
    END IF;
    v_ref := r_sup.name;
    v_id := r_sup.id;
    v_new := to_jsonb(r_sup);

  ELSIF v_table = 'persons' THEN
    v_entity := 'person';
    SELECT * INTO r_per FROM persons WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0K04', MESSAGE = format('Personne %s introuvable', v_id);
    END IF;
    v_full := CASE WHEN v_vals ? 'full_name' THEN ks_edit_text(v_vals, 'full_name', 200, false) ELSE r_per.full_name END;
    v_initials := CASE WHEN v_vals ? 'initials' THEN ks_edit_text(v_vals, 'initials', 5, true) ELSE r_per.initials END;
    v_job := CASE WHEN v_vals ? 'job_title' THEN ks_edit_text(v_vals, 'job_title', 200, false) ELSE r_per.job_title END;
    -- The staff directory import (R-027) writes the full name of the people it knows: Cursus is their source.
    IF v_full IS DISTINCT FROM r_per.full_name AND r_per.matricule IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = 'Le nom complet d''une personne de l''annuaire de Cursus se corrige dans Cursus';
    END IF;
    v_old := to_jsonb(r_per);
    IF (r_per.full_name, r_per.initials, r_per.job_title) IS DISTINCT FROM (v_full, v_initials, v_job) THEN
      UPDATE persons SET full_name = v_full, initials = v_initials, job_title = v_job, updated_at = now() WHERE id = r_per.id RETURNING * INTO r_per;
    END IF;
    v_ref := r_per.short_name;
    v_id := r_per.id;
    v_new := to_jsonb(r_per);

  ELSIF v_table = 'projects' THEN
    v_entity := 'project';
    SELECT * INTO r_prj FROM projects WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0K04', MESSAGE = format('Projet %s introuvable', v_id);
    END IF;
    v_name := CASE WHEN v_vals ? 'name' THEN ks_edit_text(v_vals, 'name', 200, true) ELSE r_prj.name END;
    v_short := CASE WHEN v_vals ? 'short_name' THEN ks_edit_text(v_vals, 'short_name', 80, false) ELSE r_prj.short_name END;
    v_old := to_jsonb(r_prj);
    IF (r_prj.name, r_prj.short_name) IS DISTINCT FROM (v_name, v_short) THEN
      UPDATE projects SET name = v_name, short_name = v_short, updated_at = now() WHERE id = r_prj.id RETURNING * INTO r_prj;
    END IF;
    v_ref := r_prj.code;
    v_id := r_prj.id;
    v_project := r_prj.id;
    v_new := to_jsonb(r_prj);
  END IF;

  -- 5. A correction: before / after of the columns that changed; nothing changed = nothing written, the row is returned.
  IF v_action = 'corriger' THEN
    SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k) INTO v_before, v_after
      FROM jsonb_object_keys(v_vals) AS k WHERE (v_old -> k) IS DISTINCT FROM (v_new -> k);
    IF v_before IS NULL THEN
      RETURN v_new - v_hide;
    END IF;
    SELECT string_agg(format('%s: %s → %s', k, coalesce(v_old ->> k, '—'), coalesce(v_new ->> k, '—')), ' · ' ORDER BY k) INTO v_change
      FROM jsonb_object_keys(v_after) AS k;
  END IF;

  -- 6. Keystone's audit trail (append-only): the Matrix user as actor, the reason, the values before / after.
  INSERT INTO audit_entries (occurred_at, actor_name, object_ref, change, area, entity_type, entity_id, project_id, before, after, reason)
    VALUES (now(), v_par, v_ref, format('Matrix (%s) · %s', session_user, v_change), 'Matrix', v_entity, v_id, v_project, v_before, v_after, v_motif);

  RETURN v_new - v_hide;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."pub_editer"(text, text, jsonb, jsonb, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."ks_edit_text"(jsonb, text, integer, boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."ks_edit_slug"(text) FROM PUBLIC;
--> statement-breakpoint
-- search_path fixed to the schema that holds Keystone's tables ("keystone" on the server, "public" on PGlite), then pg_temp.
DO $$
DECLARE
  s text := (SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = '"public"."audit_entries"'::regclass);
BEGIN
  EXECUTE format('ALTER FUNCTION %s SET search_path = %I, pg_temp', '"public"."pub_editer"(text, text, jsonb, jsonb, text, text)'::regprocedure, s);
  EXECUTE format('ALTER FUNCTION %s SET search_path = %I, pg_temp', '"public"."ks_edit_text"(jsonb, text, integer, boolean)'::regprocedure, s);
  EXECUTE format('ALTER FUNCTION %s SET search_path = %I, pg_temp', '"public"."ks_edit_slug"(text)'::regprocedure, s);
END;
$$;
