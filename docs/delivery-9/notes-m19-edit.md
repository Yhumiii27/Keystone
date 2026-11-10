# Demande Matrix M-19 — fonction d’édition `keystone.pub_editer`

> 7 nov. 2026. Demande de Matrix dans `REQUESTS.md` (« Fonction d’édition `keystone.pub_editer` », 05/11/2026), validée par
> Guillaume le 05/11/2026. Convention de Matrix : `docs/edition-par-les-outils.md` (dépôt Matrix). Restriction du responsable
> produit, convenue en séance : **liste fermée** de tables et, par table, de colonnes.

## 1. Ce qui est livré

- Migration **`drizzle/0076_pub_editer.sql`** (numéro donné par drizzle ; à renuméroter à l’intégration si une autre migration
  passe avant) : fonction générique
  `keystone.pub_editer(p_table text, p_action text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text) RETURNS jsonb`.
  - `SECURITY DEFINER`, `search_path = keystone, pg_temp` sur le serveur commun (`public, pg_temp` sur PGlite : le
    `search_path` est posé par la dernière instruction de la migration d’après le schéma qui porte `audit_entries`, pour que le
    même fichier serve aux deux moteurs ; la réécriture `"public".` → `"keystone".` du migrateur place la fonction dans
    `keystone`).
  - `REVOKE EXECUTE … FROM PUBLIC` (et sur ses deux aides internes `ks_edit_text`, `ks_edit_slug`) ; **aucun GRANT** : le droit
    d’exécution est le lien Matrix `matrix_app` → `keystone.pub_editer`. Le garde-fou M-18
    (`src/server/db/pub-views-owned-by-matrix.test.ts`) reste vert : ni vue `pub_`, ni droit accordé à un autre outil.
  - Une écriture à la fois, comme les transactions de Keystone sur le serveur : `pg_advisory_xact_lock(hashtext('keystone.ecritures'))`.
  - Renvoie la ligne après modification, **sans colonne sensible**.
- Journal d’audit (R-168, ajout seul) : une ligne `audit_entries` par modification — `actor_name` = `p_par` (personne connectée à
  Matrix), `reason` = `p_motif`, `before` / `after` = colonnes modifiées (création : `after` seul ; retrait : `active`
  true → false), `area` = « Matrix », `entity_type` / `entity_id` = la ligne, `project_id` pour un projet, `change` =
  « Matrix (<session_user>) · … » (l’appelant PostgreSQL, `matrix_app` en production). Une correction qui ne change rien
  renvoie la ligne sans rien écrire.
- Refus par `RAISE EXCEPTION`, message en français montré tel quel par Matrix, avec un SQLSTATE stable :
  `P0K01` table, action ou colonne non ouverte (dont colonne sensible), `P0K02` argument invalide (motif, `p_par`, clé, valeur),
  `P0K03` règle de Keystone (doublon, étape exigée, nom réservé…), `P0K04` ligne introuvable. Un refus n’écrit rien.
- Clé : la clé primaire, `{"id": "<uuid>"}` pour `corriger` et `retirer` ; aucune pour `ajouter`.

## 2. Liste fermée (pour le responsable produit)

| Table | Ajouter | Corriger | Retirer | Règles de Keystone appliquées |
|---|---|---|---|---|
| `reference_values` (listes des Paramètres) | `list_key`, `label` — catégories de risque, types de livrable, catégories de coût, compétences ; une étape de projet désactivée peut revenir | `label` — catégories de risque et types de livrable seulement | oui : **désactivation** | Doublon refusé (casse ignorée) ; même libellé désactivé = réactivé ; code calculé comme Keystone (`slugOf`) ; compétence ajoutée = colonne de la matrice des compétences ; pas de nouveau statut de projet (A-14) ; Initiative, Clos, Annulé jamais retirés ; jours fériés et types d’emplacement : non (voir § 3) |
| `storage_locations` (emplacements et ateliers) | `name`, `location_type` | `name`, `location_type` | oui : **désactivation** (le stock garde l’emplacement) | Doublon refusé ; type parmi les 5 types de Keystone ; même nom désactivé = réactivé |
| `clients` | `name` | `name` | non (Keystone n’archive ni ne supprime les clients) | Doublon refusé ; un nom corrigé met à jour `projects.updated_at` de ses projets (lecture incrémentale de `pub_projets`) |
| `suppliers` | `name`, `x3_code` | `name`, `x3_code` | non (ni archivage ni suppression dans Keystone) | Doublon refusé ; un nom « Keystone … » est un atelier interne (`is_internal`, comme `parts.ts`) ; le nom d’un atelier ne se corrige pas et « Keystone … » est réservé |
| `persons` | non (annuaire de Cursus, première connexion) | `full_name`, `initials`, `job_title` | non | Nom complet d’une personne reprise de l’annuaire de Cursus (matricule posé) : refusé, à corriger dans Cursus ; initiales obligatoires (5 caractères au plus) |
| `projects` | non (assistant « Nouveau projet ») | `name`, `short_name` | non (annulation par le cycle de vie) | Nom obligatoire (200 caractères au plus), nom court facultatif (80) |
| `reference_values` liste `holidays` (jours fériés) — **D9-04, migration 0078** | `list_key` = `holidays`, `label` | `label` | oui : **désactivation** | Règle des Paramètres (`parseHolidayEntry`) : « 14 Jul · Fête nationale », mois français converti, date réelle, 120 caractères ; code = la date dans l’année d’affaires (date réelle à Paris) sauf année écrite ; un seul jour férié actif par date ; une correction garde l’année de l’entrée et change le code ; date tenue par un jour férié retiré : refus |
| `app_settings` — **D9-04, migration 0078** ; clé `{"key": "<paramètre>"}` | non | les seuils du paramètre (valeurs `{"<seuil>": <valeur>}`) | non | `health.thresholds` (`risk`, `off` : ]0, 2], off < risk), `hours.variance` (`pct` entier 1–50), `change.ccbThreshold` (`keur` 0–1 000 000, arrondi au centième), `schedule.dcma` (15 seuils, bornes et entiers de `DCMA_THRESHOLD_FIELDS`, « 0,95 » admis, arrondi au millième), `forecast.drift` (13 seuils de `DRIFT_THRESHOLD_FIELDS`, paires ordonnées), `purchasing.supplierSlip` (`days` entier 1–60), `purchasing.supplierSlipEscalation` (`days` 1–120, `impactDays` 1–60, entiers) |

Colonnes sensibles (RGPD), refusées même si elles sont nommées et jamais renvoyées : `persons.email`, `persons.matricule`,
`persons.rate_role_id` (rôle de taux, lié à la valorisation des heures), et toute colonne dont le nom évoque un secret
(`secret`, `token`, `password`, `api_key`, `credential`). La liste est dans la fonction : elle ne dépend pas de
`droits.colonnes_sensibles` de Matrix (qui ne liste aujourd’hui aucune colonne de Keystone).

Textes : chaîne ou null, espaces de bord retirés, chaîne vide = null ; longueur maximale vérifiée (libellé de liste et
emplacement 120, noms 200, code Sage 40, nom court de projet 80).

## 3. Ce qui reste fermé, et pourquoi

- Comptes, rôles et droits (`users`, équipes de projet, délégations), journal d’audit et fil d’activité, connecteurs et leur
  configuration, files d’envoi (outbox) et miroirs des autres outils (Vigie, Cursus, Codex, Arche, Matrix) : jamais.
- ~~`app_settings`~~ et ~~jours fériés~~ : ouverts par D9-04 (10/11/2026, migration `0078_pub_editer_settings`, voir
  `notes-d9-matrix.md`). Restent fermés dans `app_settings` : les valeurs par défaut de « Réinitialiser » (`settings.defaults`),
  les préférences de rappel et tout autre paramètre.
- Catégories de coût et compétences : reconnues par leur **libellé** dans les budgets et la matrice des compétences ; corriger
  le libellé couperait le lien ; ajout et retrait admis.
- Statuts de projet : ce sont les étapes du cycle de vie ; libellé non corrigé ici, pas de nouvelle étape.
- Clients : `code3` (code enregistré, réservé aux filiales), `is_internal` et `subsidiary_code` (liste des filiales de Matrix,
  écran Contrat) : règles en TypeScript (`src/server/dal/internal-client.ts`), refusés.
- Personnes : `short_name` (cite la personne dans les projets et enregistrements), service, client, rôle de taux.
- Projets : code, numéro, code analytique, étape, montants, dates, CAPEX… (règles du cycle de vie, de la numérotation et des
  écrans de Keystone).
- Fournisseurs : notes de la fiche fournisseur (venues de Vigie, R-026), commandes ouvertes (instantané de Sage).

## 4. Décisions prises sans demander

- **Fonction générique seule**, pas de `pub_editer_<table>` : une seule entrée à autoriser dans Matrix.
- **« Retirer » désactive toujours** (listes, emplacements), même une valeur personnalisée inutilisée que l’écran Paramètres
  supprimerait (A-14) : rien n’est supprimé depuis Matrix ; la valeur revient par « ajouter » avec le même libellé.
- **Domaine d’audit « Matrix »** pour toutes ces modifications (repérables dans le journal), texte du changement en anglais
  comme les autres lignes, avec l’appelant PostgreSQL (`session_user`).
- **Pas d’événement dans le fil d’activité** (le journal d’audit suffit pour une correction de données de référence).
- Les tables ouvertes n’ont pas de colonne `version` (R-010) ; une mise à jour faite par la fonction passerait de toute façon par
  les déclencheurs de Keystone.
- Les pages de Keystone relisent la base à chaque requête ; le cache de lecture (R-017) suit `pg_current_snapshot()` et voit
  donc ces écritures ; les badges de navigation suivent après leur durée de vie.

## 5. Tests

- `src/server/db/pub-editer.test.ts` (PGlite, jeu de démonstration, 19 cas) : ajouts, corrections et retraits admis par table,
  chaque refus (table, action, colonne, colonne sensible, motif manquant, `p_par` vide, clé absente, mal formée ou inconnue,
  valeur non textuelle, valeurs vides), contenu de la ligne d’audit, aucune écriture sur refus, aucune ligne d’audit quand rien
  ne change, `SECURITY DEFINER`, `search_path` et EXECUTE retiré à PUBLIC.
- `src/server/db/pub-editer.postgres.test.ts` (serveur PostgreSQL, si `KEYSTONE_TEST_DATABASE_URL`) : fonction dans
  `keystone` avec `search_path=keystone, pg_temp`, rien dans `public`, EXECUTE refusé à un rôle sans le lien (42501), accordé
  (comme le lien de Matrix) la correction passe et l’audit nomme l’appelant ; le rôle ne peut toujours pas écrire dans les tables.
- Garde-fou M-18 inchangé et vert.

## 6. Ce qui reste

- **Matrix** : poser le lien « écriture » `matrix_app` → `keystone.pub_editer` (`droits.accorder_execution`, écran « Liens entre
  outils »). La visionneuse ne doit proposer que les tables et colonnes du § 2 (les autres sont refusées par la fonction).
- Élargir la liste : sur décision du responsable produit, table par table (règles à reproduire en SQL ou à garder dans Keystone).
