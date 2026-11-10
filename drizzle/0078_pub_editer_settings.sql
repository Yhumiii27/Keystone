-- Custom SQL migration file, put your code below! --
-- D9-04 (owner, 10 Nov 2026: « Ouvrir aussi les jours fériés et les seuils de Paramètres »): keystone.pub_editer (M-19,
-- migration 0076) is REPLACED — same signature, same SECURITY DEFINER, search_path and REVOKE logic, same audit — and opens two
-- more things to Matrix (docs/delivery-9/notes-d9-matrix.md):
--   * the public holidays (reference_values, list "holidays"): add, correct the entry, remove (deactivate); the entry reads
--     "14 Jul · Fête nationale" (a French month is converted), its code is its date in the business year (R-013: the real date
--     in Europe/Paris on the server) unless the entry names its year, a real day, one active holiday per date;
--   * the Settings thresholds kept in app_settings (table "app_settings", action "corriger", key {"key": "<setting>"}, values
--     {"<field>": <value>}): health, hours variance, schedule quality (DCMA), change control board, drift forecast (S-25),
--     supplier slip (S-31) and its escalation (S-34).
-- Their rules lived in TypeScript only; they are reproduced here exactly — ranges, whole numbers, open bounds, the ordered pairs,
-- the strings the Settings parsers accept, the rounding — and src/server/db/pub-editer-settings.test.ts runs the same cases
-- through the TypeScript validators (src/domain/admin.ts parseHolidayEntry, health.ts healthThresholdsRefusal, hr.ts,
-- change-control.ts, schedule-quality.ts, drift-forecast.ts, supplier-slip-alerts.ts) and through this function, so that they
-- cannot drift. Never edit 0076: a later change replaces the function again in a new migration.

-- JavaScript's white space (String.prototype.trim, /\s/): the characters of the Settings parsers.
CREATE OR REPLACE FUNCTION "public"."ks_edit_js_trim"(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(p, '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$', '', 'g');
$$;
--> statement-breakpoint
-- JavaScript's String.length: UTF-16 code units (a character beyond U+FFFF counts twice).
CREATE OR REPLACE FUNCTION "public"."ks_edit_js_len"(p text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT length(p) + (SELECT count(*)::integer FROM regexp_split_to_table(p, '') AS c WHERE c <> '' AND ascii(c) > 65535);
$$;
--> statement-breakpoint
-- JavaScript's parseInt(s, 10) on a token without white space: an optional sign then the leading digits; NULL = NaN. numeric,
-- so that no length overflows.
CREATE OR REPLACE FUNCTION "public"."ks_edit_js_parse_int"(p text) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN m[1] = '-' THEN -(m[2]::numeric) ELSE m[2]::numeric END FROM (SELECT regexp_match(p, '^([+-]?)([0-9]+)') AS m) AS x;
$$;
--> statement-breakpoint
-- holidayEntry (src/domain/admin.ts): the entry trimmed; "14 juil. · Fête nationale", "14 juillet · …" → "14 Jul · …".
CREATE OR REPLACE FUNCTION "public"."ks_edit_holiday_entry"(p_raw text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  c_ws constant text := '\t\n\v\f\r    -     　﻿';
  c_en constant text[] := ARRAY['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  c_fr constant text[] := ARRAY['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  c_fr_long constant text[] := ARRAY['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  c_mon constant text[] := ARRAY['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  t text := ks_edit_js_trim(p_raw);
  m text[];
  mon text;
  i integer;
BEGIN
  m := regexp_match(t, '^([0-9]{1,2})[' || c_ws || ']+([^' || c_ws || '·]+)[' || c_ws || ']*·[' || c_ws || ']*([^\n\r  ]+)$');
  IF m IS NULL THEN RETURN t; END IF;
  -- toLowerCase: lower() changes ASCII letters on every collation; É and Û are the capitals of the French month names.
  mon := translate(lower(regexp_replace(m[2], '\.$', '')), 'ÉÛ', 'éû');
  i := coalesce(array_position(c_en, mon), array_position(c_fr, mon), array_position(c_fr_long, mon));
  IF i IS NULL THEN RETURN t; END IF;
  RETURN format('%s %s · %s', m[1]::integer, c_mon[i], ks_edit_js_trim(m[3]));
END;
$$;
--> statement-breakpoint
-- realHolidayDate (src/domain/admin.ts, over isoOfDisplayDate of src/server/db/codes.ts): the date of "<date> · <name>", a real
-- day, in p_year unless the date names its year; NULL otherwise.
CREATE OR REPLACE FUNCTION "public"."ks_edit_holiday_date"(p_text text, p_year integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  c_ws constant text := '[\t\n\v\f\r    -     　﻿]';
  c_mon constant text[] := ARRAY['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  t text;
  parts text[];
  d numeric;
  mo integer;
  y numeric;
  yy text;
BEGIN
  IF p_text IS NULL OR strpos(p_text, ' · ') = 0 THEN RETURN NULL; END IF;
  -- splitActual: the activity " A" (actual) suffix is dropped.
  t := ks_edit_js_trim(split_part(p_text, ' · ', 1));
  IF t ~ (c_ws || 'A$') THEN
    t := regexp_replace(left(t, -2), c_ws || '+$', '');
  END IF;
  SELECT coalesce(array_agg(x ORDER BY n), '{}') INTO parts FROM unnest(regexp_split_to_array(t, c_ws || '+')) WITH ORDINALITY AS u(x, n) WHERE x <> '';
  IF cardinality(parts) < 2 THEN RETURN NULL; END IF;
  d := ks_edit_js_parse_int(parts[1]);
  mo := array_position(c_mon, left(parts[2], 3));
  y := p_year;
  IF cardinality(parts) >= 3 THEN
    yy := regexp_replace(parts[3], '^[’'']', '');
    y := ks_edit_js_parse_int(yy) + CASE WHEN ks_edit_js_len(yy) = 2 THEN 2000 ELSE 0 END;
  END IF;
  IF d IS NULL OR mo IS NULL OR y IS NULL OR d < 1 OR d > 31 THEN RETURN NULL; END IF;
  -- A real day written with a four-digit year (the date JavaScript reads back the same).
  IF y < 1000 OR y > 9999 OR d > extract(day FROM (make_date(y::integer, mo, 1) + interval '1 month' - interval '1 day')) THEN RETURN NULL; END IF;
  RETURN to_char(make_date(y::integer, mo, d::integer), 'YYYY-MM-DD');
END;
$$;
--> statement-breakpoint
-- A Settings threshold as the TypeScript parsers read it; NULL = refused. p_mode: 'number' (a JSON number only), 'decimal'
-- (also a string "5", "0,95" — parseDcmaThreshold / parseDriftThreshold), 'digits' (also a string of 1 to 4 digits —
-- parseSupplierSlipEscalation). Range [p_min, p_max] (]p_min, p_max] when p_min_open), whole numbers when p_integer, then
-- Math.round(v * 10^p_round) / 10^p_round when p_round is set. Double precision, like JavaScript's numbers.
CREATE OR REPLACE FUNCTION "public"."ks_edit_number"(p jsonb, p_mode text, p_min double precision, p_max double precision, p_min_open boolean, p_integer boolean, p_round integer)
RETURNS double precision
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  c_ws constant text := '[\t\n\v\f\r    -     　﻿]';
  s text;
  v double precision;
  k double precision;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p) = 'number' THEN
    s := p #>> '{}';
  ELSIF jsonb_typeof(p) = 'string' AND p_mode = 'decimal' AND (p #>> '{}') ~ ('^' || c_ws || '*[0-9]+(?:[.,][0-9]+)?' || c_ws || '*$') THEN
    s := replace(ks_edit_js_trim(p #>> '{}'), ',', '.');
  ELSIF jsonb_typeof(p) = 'string' AND p_mode = 'digits' AND (p #>> '{}') ~ ('^' || c_ws || '*[0-9]{1,4}' || c_ws || '*$') THEN
    s := ks_edit_js_trim(p #>> '{}');
  ELSE
    RETURN NULL;
  END IF;
  BEGIN
    v := s::double precision;
  EXCEPTION WHEN numeric_value_out_of_range THEN
    -- JavaScript reads a number too large as Infinity (refused) and one too small as 0.
    IF abs(s::numeric) < 1 THEN v := 0; ELSE RETURN NULL; END IF;
  END;
  IF v > p_max OR v < p_min OR (p_min_open AND v = p_min) THEN RETURN NULL; END IF;
  IF p_integer AND v <> trunc(v) THEN RETURN NULL; END IF;
  IF p_round IS NOT NULL THEN
    k := v * power(10::double precision, p_round);
    -- Math.round: the nearest integer, halves upwards.
    k := CASE WHEN k - floor(k) >= 0.5 THEN floor(k) + 1 ELSE floor(k) END;
    v := k / power(10::double precision, p_round);
  END IF;
  RETURN v;
END;
$$;
--> statement-breakpoint
-- A holiday entry sent by Matrix (the "label" value): a string, as Settings stores it (holidayEntry), required, at most 120
-- characters counted as JavaScript does (parseHolidayEntry, src/domain/admin.ts).
CREATE OR REPLACE FUNCTION "public"."ks_edit_holiday_label"(p_vals jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v jsonb := p_vals -> 'label';
  t text;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'string' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = 'Valeur de « label » invalide : texte attendu (« 14 Jul · Fête nationale »)';
  END IF;
  t := ks_edit_holiday_entry(v #>> '{}');
  IF t = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = '« label » est obligatoire';
  END IF;
  IF ks_edit_js_len(t) > 120 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = '« label » est trop long (120 caractères au plus)';
  END IF;
  RETURN t;
END;
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
    "projects":          {"corriger": ["name", "short_name"]},
    "app_settings":      {"corriger": []}
  }';
  -- D9-04: the Settings thresholds open to Matrix — setting key → its fields, each as its TypeScript parser reads it: [mode of a
  -- value sent by Matrix, mode of the stored value (the reader's "usable…" rule), min, max, min excluded, whole number, rounding of
  -- a value sent, rounding of a stored value, default]. Modes and rules: see ks_edit_number.
  c_settings constant jsonb := '{
    "health.thresholds": {"risk": ["number", "number", 0, 2, true, false, null, null, 0.97], "off": ["number", "number", 0, 2, true, false, null, null, 0.9]},
    "hours.variance": {"pct": ["number", "number", 1, 50, false, true, null, null, 10]},
    "change.ccbThreshold": {"keur": ["number", "number", 0, 1000000, false, false, 2, null, 50]},
    "schedule.dcma": {
      "logicPct": ["decimal", "decimal", 0, 100, false, false, 3, 3, 5],
      "leadsCount": ["decimal", "decimal", 0, 9999, false, true, 3, 3, 0],
      "lagsPct": ["decimal", "decimal", 0, 100, false, false, 3, 3, 5],
      "fsMinPct": ["decimal", "decimal", 0, 100, false, false, 3, 3, 90],
      "hardConstraintsPct": ["decimal", "decimal", 0, 100, false, false, 3, 3, 5],
      "highFloatDays": ["decimal", "decimal", 1, 9999, false, true, 3, 3, 44],
      "highFloatPct": ["decimal", "decimal", 0, 100, false, false, 3, 3, 5],
      "negativeFloatCount": ["decimal", "decimal", 0, 9999, false, true, 3, 3, 0],
      "highDurationDays": ["decimal", "decimal", 1, 9999, false, true, 3, 3, 44],
      "highDurationPct": ["decimal", "decimal", 0, 100, false, false, 3, 3, 5],
      "invalidDatesCount": ["decimal", "decimal", 0, 9999, false, true, 3, 3, 0],
      "resourcesPct": ["decimal", "decimal", 0, 100, false, false, 3, 3, 0],
      "missedTasksPct": ["decimal", "decimal", 0, 100, false, false, 3, 3, 5],
      "cpliMin": ["decimal", "decimal", 0, 2, false, false, 3, 3, 0.95],
      "beiMin": ["decimal", "decimal", 0, 2, false, false, 3, 3, 0.95]
    },
    "forecast.drift": {
      "spiCritical": ["decimal", "decimal", 0.01, 2, false, false, 3, 3, 0.9],
      "cpiReview": ["decimal", "decimal", 0.01, 2, false, false, 3, 3, 0.95],
      "cpiHigh": ["decimal", "decimal", 0.01, 2, false, false, 3, 3, 0.9],
      "tcpiHigh": ["decimal", "decimal", 0.5, 5, false, false, 3, 3, 1.1],
      "floatErosionDays": ["decimal", "decimal", 1, 999, false, true, 3, 3, 5],
      "probabilityLowPct": ["decimal", "decimal", 0, 100, false, false, 3, 3, 50],
      "probabilityVeryLowPct": ["decimal", "decimal", 0, 100, false, false, 3, 3, 20],
      "monteCarloMaxAgeDays": ["decimal", "decimal", 1, 999, false, true, 3, 3, 30],
      "spreadDays": ["decimal", "decimal", 1, 999, false, true, 3, 3, 30],
      "spreadCostPct": ["decimal", "decimal", 0, 100, false, false, 3, 3, 10],
      "progressEarlyPct": ["decimal", "decimal", 0, 100, false, false, 3, 3, 15],
      "progressReliablePct": ["decimal", "decimal", 0, 100, false, false, 3, 3, 50],
      "portfolioOnTimePct": ["decimal", "decimal", 0, 100, false, false, 3, 3, 20]
    },
    "purchasing.supplierSlip": {"days": ["number", "number", 1, 60, false, true, null, null, 5]},
    "purchasing.supplierSlipEscalation": {"days": ["digits", "number", 1, 120, false, true, null, null, 10], "impactDays": ["digits", "number", 1, 60, false, true, null, null, 5]}
  }';
  -- Pairs that stay ordered (lower ≤ higher; DRIFT_THRESHOLD_ORDER); the health thresholds: "off" strictly under "risk".
  c_setting_order constant jsonb := '{"forecast.drift": [["cpiHigh", "cpiReview"], ["probabilityVeryLowPct", "probabilityLowPct"], ["progressEarlyPct", "progressReliablePct"]]}';
  -- The audit object of each setting (the Settings writers' objectRef).
  c_setting_refs constant jsonb := '{"health.thresholds": "Health rules", "hours.variance": "Hours variance threshold", "change.ccbThreshold": "Change control board", "schedule.dcma": "Schedule quality thresholds", "forecast.drift": "Drift forecast thresholds", "purchasing.supplierSlip": "Supplier schedule slip threshold", "purchasing.supplierSlipEscalation": "Supplier slip escalation thresholds"}';
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
    "reference_values.code": "le code d''une valeur est sa clé dans les enregistrements",
    "app_settings.ajouter": "les paramètres de Keystone sont fixes : seules leurs valeurs se corrigent",
    "app_settings.retirer": "un paramètre ne se retire pas : « corriger » remet une valeur"
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
  r_set app_settings;
  v_key text;
  v_fields jsonb;
  v_spec jsonb;
  v_stored jsonb;
  v_cur jsonb;
  v_next jsonb;
  v_num double precision;
  v_pair jsonb;
  v_year integer;
  v_date text;
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
  ELSIF v_table = 'app_settings' THEN
    -- A setting is named by its key: {"key": "schedule.dcma"}.
    IF p_cle IS NULL OR jsonb_typeof(p_cle) <> 'object' OR (SELECT array_agg(k) FROM jsonb_object_keys(p_cle) AS k) <> ARRAY['key']
       OR jsonb_typeof(p_cle -> 'key') <> 'string' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = 'Clé invalide : {"key": "<paramètre>"} attendu';
    END IF;
    v_key := p_cle ->> 'key';
    IF NOT c_settings ? v_key THEN
      RAISE EXCEPTION USING ERRCODE = 'P0K01', MESSAGE = format('Paramètre « %s » non modifiable depuis Matrix : Keystone n''ouvre que %s', v_key,
        (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(c_settings) AS k));
    END IF;
    v_fields := c_settings -> v_key;
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
  IF v_table = 'app_settings' THEN
    SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO v_cols FROM jsonb_object_keys(v_fields) AS x;
  ELSE
    SELECT coalesce(array_agg(x), '{}') INTO v_cols FROM jsonb_array_elements_text((c_open -> v_table) -> v_action) AS x;
  END IF;
  FOR v_col IN SELECT k FROM jsonb_object_keys(v_vals) AS k ORDER BY k LOOP
    IF (v_table || '.' || v_col) = ANY (c_sensitive) OR v_col ~* '(secret|token|password|passwd|api_key|credential)' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0K01', MESSAGE = format('Colonne sensible « %s.%s » refusée (données personnelles, RGPD)', v_table, v_col);
    END IF;
    IF NOT v_col = ANY (v_cols) AND v_table = 'app_settings' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0K01', MESSAGE = format('Seuil « %s » inconnu pour le paramètre %s (seuils : %s)', v_col, v_key, array_to_string(v_cols, ', '));
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
      IF v_list = 'holidays' THEN
        -- D9-04: the entry as Settings stores it, its date in the business year (parseHolidayEntry, src/domain/admin.ts).
        v_year := extract(year FROM (now() AT TIME ZONE 'Europe/Paris'))::integer;
        v_label := ks_edit_holiday_label(v_vals);
        v_date := ks_edit_holiday_date(v_label, v_year);
        IF v_date IS NULL THEN
          RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = format('Jour férié « %s » invalide : « 14 Jul · Fête nationale » attendu (date réelle, mois en anglais ou en français)', v_label);
        END IF;
      ELSE
        v_label := ks_edit_text(v_vals, 'label', 120, true);
      END IF;
      IF v_list = 'locTypes' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = 'Les types d''emplacement sont fixes';
      ELSIF v_list NOT IN ('riskCats', 'delivTypes', 'costCats', 'skills', 'statuses', 'holidays') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = format('Liste « %s » inconnue (riskCats, delivTypes, costCats, skills, statuses, holidays)', v_list);
      END IF;
      SELECT * INTO r_rv FROM reference_values WHERE list_key = v_list AND lower(label) = lower(v_label) ORDER BY active DESC LIMIT 1 FOR UPDATE;
      v_found := FOUND;
      IF v_found AND r_rv.active THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('« %s » est déjà dans la liste', v_label);
      END IF;
      -- A holiday is keyed by its date (calendars, capacity): one active entry per date (HOLIDAY_DATE_TAKEN).
      IF NOT v_found AND v_list = 'holidays' AND EXISTS (SELECT FROM reference_values WHERE list_key = 'holidays' AND active AND code = v_date) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('Un jour férié est déjà inscrit le %s', v_date);
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
        v_base := CASE WHEN v_list = 'holidays' THEN v_date ELSE ks_edit_slug(v_label) END;
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
        IF r_rv.list_key NOT IN ('riskCats', 'delivTypes', 'holidays') THEN
          RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format(
            'Le libellé d''une valeur de la liste « %s » ne se corrige pas depuis Matrix (%s)', r_rv.list_key,
            CASE r_rv.list_key
              WHEN 'costCats' THEN 'les catégories de coût des projets sont reconnues par leur libellé'
              WHEN 'skills' THEN 'la compétence de la matrice est reconnue par son libellé'
              ELSE 'libellés tenus par Keystone' END);
        END IF;
        IF r_rv.list_key = 'holidays' THEN
          -- D9-04: the corrected entry keeps its year (the year of its date; the business year for an entry without one).
          v_year := CASE WHEN r_rv.code ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN left(r_rv.code, 4)::integer
                         ELSE extract(year FROM (now() AT TIME ZONE 'Europe/Paris'))::integer END;
          v_label := ks_edit_holiday_label(v_vals);
          v_date := ks_edit_holiday_date(v_label, v_year);
          IF v_date IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = format('Jour férié « %s » invalide : « 14 Jul · Fête nationale » attendu (date réelle, mois en anglais ou en français)', v_label);
          END IF;
        ELSE
          v_label := ks_edit_text(v_vals, 'label', 120, true);
          v_date := r_rv.code;
        END IF;
        IF EXISTS (SELECT FROM reference_values WHERE list_key = r_rv.list_key AND id <> r_rv.id AND active AND lower(label) = lower(v_label)) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('« %s » est déjà dans la liste', v_label);
        END IF;
        IF r_rv.list_key = 'holidays' AND v_date IS DISTINCT FROM r_rv.code THEN
          IF EXISTS (SELECT FROM reference_values WHERE list_key = 'holidays' AND id <> r_rv.id AND active AND code = v_date) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('Un jour férié est déjà inscrit le %s', v_date);
          END IF;
          IF EXISTS (SELECT FROM reference_values WHERE list_key = 'holidays' AND id <> r_rv.id AND code = v_date) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('Un jour férié retiré porte déjà la date du %s : ajoutez-le de nouveau avec son libellé', v_date);
          END IF;
        END IF;
        v_old := to_jsonb(r_rv);
        IF (r_rv.label, r_rv.code) IS DISTINCT FROM (v_label, v_date) THEN
          UPDATE reference_values SET label = v_label, code = v_date, updated_at = now() WHERE id = r_rv.id RETURNING * INTO r_rv;
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

  ELSIF v_table = 'app_settings' THEN
    -- D9-04: a Settings threshold (src/server/dal/settings.ts set…), the same rules as the Settings writers.
    v_entity := 'app_setting';
    v_ref := c_setting_refs ->> v_key;
    SELECT * INTO r_set FROM app_settings WHERE key = v_key FOR UPDATE;
    v_found := FOUND;
    v_stored := CASE WHEN v_found THEN r_set.value ELSE NULL END;
    -- The values in force, as Keystone reads them (usable…: an invalid stored value gives its default).
    v_cur := '{}'::jsonb;
    FOR v_col, v_spec IN SELECT k, v FROM jsonb_each(v_fields) AS e(k, v) LOOP
      v_num := CASE WHEN jsonb_typeof(v_stored) = 'object' THEN
        ks_edit_number(v_stored -> v_col, v_spec ->> 1, (v_spec ->> 2)::float8, (v_spec ->> 3)::float8, (v_spec ->> 4)::boolean, (v_spec ->> 5)::boolean, (v_spec ->> 7)::integer) END;
      v_cur := v_cur || jsonb_build_object(v_col, coalesce(to_jsonb(v_num), v_spec -> 8));
    END LOOP;
    IF v_key = 'health.thresholds' AND (jsonb_typeof(v_stored) IS DISTINCT FROM 'object'
        OR ks_edit_number(v_stored -> 'risk', 'number', 0, 2, true, false, NULL) IS NULL
        OR ks_edit_number(v_stored -> 'off', 'number', 0, 2, true, false, NULL) IS NULL
        OR (v_cur ->> 'off')::float8 >= (v_cur ->> 'risk')::float8) THEN
      v_cur := jsonb_build_object('risk', 0.97, 'off', 0.9);
    END IF;
    FOR v_pair IN SELECT x FROM jsonb_array_elements(coalesce(c_setting_order -> v_key, '[]')) AS x LOOP
      IF (v_cur ->> (v_pair ->> 0))::float8 > (v_cur ->> (v_pair ->> 1))::float8 THEN
        v_cur := v_cur || jsonb_build_object(v_pair ->> 0, v_fields -> (v_pair ->> 0) -> 8, v_pair ->> 1, v_fields -> (v_pair ->> 1) -> 8);
      END IF;
    END LOOP;
    -- The values sent, each checked like the Settings parser of its field; a health threshold sent as null keeps its value.
    v_next := v_cur;
    FOR v_col IN SELECT k FROM jsonb_object_keys(v_vals) AS k ORDER BY k LOOP
      v_spec := v_fields -> v_col;
      IF v_key = 'health.thresholds' AND jsonb_typeof(v_vals -> v_col) = 'null' THEN
        CONTINUE;
      END IF;
      v_num := ks_edit_number(v_vals -> v_col, v_spec ->> 0, (v_spec ->> 2)::float8, (v_spec ->> 3)::float8, (v_spec ->> 4)::boolean, (v_spec ->> 5)::boolean, (v_spec ->> 6)::integer);
      IF v_num IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K02', MESSAGE = format('Valeur de « %s » invalide : %s', v_col,
          CASE WHEN (v_spec ->> 5)::boolean THEN 'un nombre entier' ELSE 'un nombre' END
          || format(CASE WHEN (v_spec ->> 4)::boolean THEN ' supérieur à %s et au plus %s' ELSE ' entre %s et %s' END, v_spec ->> 2, v_spec ->> 3));
      END IF;
      v_next := v_next || jsonb_build_object(v_col, to_jsonb(v_num));
    END LOOP;
    IF v_key = 'health.thresholds' AND (v_next ->> 'off')::float8 >= (v_next ->> 'risk')::float8 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = '« Hors trajectoire sous » (off) doit être inférieur à « À risque sous » (risk)';
    END IF;
    FOR v_pair IN SELECT x FROM jsonb_array_elements(coalesce(c_setting_order -> v_key, '[]')) AS x LOOP
      IF (v_next ->> (v_pair ->> 0))::float8 > (v_next ->> (v_pair ->> 1))::float8 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0K03', MESSAGE = format('« %s » doit rester au plus égal à « %s » (le niveau urgent au-delà du premier)', v_pair ->> 0, v_pair ->> 1);
      END IF;
    END LOOP;
    -- Nothing changed: the setting is returned, nothing is written.
    SELECT jsonb_object_agg(k, v_cur -> k), jsonb_object_agg(k, v_next -> k) INTO v_before, v_after
      FROM jsonb_object_keys(v_next) AS k WHERE (v_cur -> k) IS DISTINCT FROM (v_next -> k);
    IF v_before IS NULL THEN
      RETURN CASE WHEN v_found THEN to_jsonb(r_set)
        ELSE jsonb_build_object('key', v_key, 'value', v_cur, 'updated_at', NULL, 'updated_by_name', NULL, 'updated_by_person_id', NULL) END;
    END IF;
    INSERT INTO app_settings (key, value, updated_at, updated_by_name, updated_by_person_id)
      VALUES (v_key, v_next, now(), format('%s (Matrix)', v_par), NULL)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by_name = EXCLUDED.updated_by_name, updated_by_person_id = NULL
      RETURNING * INTO r_set;
    SELECT string_agg(format('%s: %s → %s', k, v_cur ->> k, v_next ->> k), ' · ' ORDER BY k) INTO v_change FROM jsonb_object_keys(v_after) AS k;
    v_new := to_jsonb(r_set);
  END IF;

  -- 5. A correction: before / after of the columns that changed; nothing changed = nothing written, the row is returned.
  IF v_action = 'corriger' AND v_table <> 'app_settings' THEN
    -- (A holiday's code is its date: a corrected date shows in before / after.)
    SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k) INTO v_before, v_after
      FROM (SELECT jsonb_object_keys(v_vals) AS k UNION SELECT 'code' WHERE v_table = 'reference_values') AS ks
      WHERE (v_old -> k) IS DISTINCT FROM (v_new -> k);
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
REVOKE EXECUTE ON FUNCTION "public"."ks_edit_js_trim"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."ks_edit_js_len"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."ks_edit_js_parse_int"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."ks_edit_holiday_entry"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."ks_edit_holiday_date"(text, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."ks_edit_holiday_label"(jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."ks_edit_number"(jsonb, text, double precision, double precision, boolean, boolean, integer) FROM PUBLIC;
--> statement-breakpoint
-- search_path fixed to the schema that holds Keystone's tables ("keystone" on the server, "public" on PGlite), then pg_temp —
-- as 0076 (CREATE OR REPLACE keeps neither the function's SET clause from 0076: it is set again here).
DO $$
DECLARE
  s text := (SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = '"public"."audit_entries"'::regclass);
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    '"public"."pub_editer"(text, text, jsonb, jsonb, text, text)',
    '"public"."ks_edit_js_trim"(text)',
    '"public"."ks_edit_js_len"(text)',
    '"public"."ks_edit_js_parse_int"(text)',
    '"public"."ks_edit_holiday_entry"(text)',
    '"public"."ks_edit_holiday_date"(text, integer)',
    '"public"."ks_edit_holiday_label"(jsonb)',
    '"public"."ks_edit_number"(jsonb, text, double precision, double precision, boolean, boolean, integer)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = %I, pg_temp', f::regprocedure, s);
  END LOOP;
END;
$$;
