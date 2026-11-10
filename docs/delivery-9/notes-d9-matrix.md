# Lot « d9-matrix » — réponses D9-04, D9-05, D9-07 (10 nov. 2026)

> Réponses du responsable produit au questionnaire de la livraison 9 (`docs/DECISIONS.md`, dernière section). Suite de la demande
> Matrix M-19 (`notes-m19-edit.md`) et de R-139 (« Voir comme le client »).

## 1. D9-04 — jours fériés et seuils des Paramètres ouverts à Matrix

Réponse : « Ouvrir aussi les jours fériés et les seuils de Paramètres ».

### Ce qui est livré

- Migration **`drizzle/0078_pub_editer_settings.sql`** (numéro donné par drizzle ; à renuméroter à l’intégration si une autre
  migration passe avant). Elle **remplace** `pub_editer` (`CREATE OR REPLACE`, même signature, `SECURITY DEFINER`) ; 0076 n’est
  pas modifiée. Même logique de `search_path` (posé en dernière instruction d’après le schéma qui porte `audit_entries` :
  `keystone, pg_temp` sur le serveur, `public, pg_temp` sur PGlite), `REVOKE EXECUTE … FROM PUBLIC` sur la fonction et sur
  chacune de ses aides, aucun `GRANT`, aucune vue `pub_` (garde-fou M-18 vert). Même journal d’audit qu’en 0076.
- Aides SQL nouvelles (internes, `REVOKE` de PUBLIC) : `ks_edit_js_trim`, `ks_edit_js_len`, `ks_edit_js_parse_int`,
  `ks_edit_holiday_entry`, `ks_edit_holiday_date`, `ks_edit_holiday_label`, `ks_edit_number`. Elles reproduisent le comportement
  exact de JavaScript là où il compte (espaces de `trim()` et `\s`, longueur en unités UTF-16, `parseInt(…, 10)`, nombres en
  double précision, `Math.round`).
- **Jours fériés** (`reference_values`, liste `holidays`) :
  - `ajouter` : `{"list_key": "holidays", "label": "14 Jul · Fête nationale"}` — même règle que les Paramètres
    (`parseHolidayEntry`, nouvelle fonction pure de `src/domain/admin.ts`, utilisée désormais aussi par l’action « Ajouter » des
    Paramètres) : mois français converti (« 14 juil. », « 14 juillet »), 120 caractères au plus, date réelle (« 31 Feb » refusé),
    code = la date dans l’année d’affaires (date réelle à Paris) sauf si l’entrée écrit son année ; un seul jour férié actif par
    date ; même libellé retiré = réactivé (il garde son code, comme dans les Paramètres).
  - `corriger` : `{"label": "…"}` — même règle ; le code suit la nouvelle date (avant / après du journal : `code` et `label`).
  - `retirer` : désactivation (déjà ouvert par 0076).
- **Seuils des Paramètres** (`app_settings`, action `corriger` seulement, clé `{"key": "<paramètre>"}`, valeurs
  `{"<seuil>": <valeur>, …}`, plusieurs seuils à la fois) :

  | Paramètre | Seuils et règle (identique au code TypeScript cité) |
  |---|---|
  | `health.thresholds` | `risk`, `off` : nombres dans ]0, 2], `off` < `risk` (`healthThresholdsRefusal`, extrait de `setHealthThresholds`) ; `null` garde la valeur (comme `??`) |
  | `hours.variance` | `pct` : entier 1–50 (`isHoursVariancePct`) |
  | `change.ccbThreshold` | `keur` : nombre 0–1 000 000, arrondi au centième (`isCcbThreshold`, `setCcbThreshold`) |
  | `schedule.dcma` | les 15 seuils de `DCMA_THRESHOLD_FIELDS` : bornes, entiers, texte « 5 » / « 0,95 » admis, arrondi au millième (`parseDcmaThreshold`) |
  | `forecast.drift` | les 13 seuils de `DRIFT_THRESHOLD_FIELDS` (`parseDriftThreshold`) et les paires ordonnées `DRIFT_THRESHOLD_ORDER` vérifiées sur le résultat |
  | `purchasing.supplierSlip` | `days` : entier 1–60 (`isSupplierSlipDays`) |
  | `purchasing.supplierSlipEscalation` | `days` 1–120, `impactDays` 1–60, entiers, texte de 1 à 4 chiffres admis (`parseSupplierSlipEscalation`) |

  La valeur de départ est celle que Keystone lit (`usable…` : une valeur enregistrée invalide prend sa valeur par défaut, une paire
  cassée de la dérive revient aux défauts). Le document enregistré est complet (comme `{ ...cur, [key]: v }` des Paramètres).
  Refus : `P0K01` paramètre ou seuil non ouvert (`settings.defaults`, préférences de rappel… restent fermés), `P0K02` valeur hors
  bornes ou mal formée, `P0K03` règle d’ordre (santé, paires de la dérive). Rien ne change = rien n’est écrit ni journalisé.
  Journal : domaine « Matrix », `entity_type` `app_setting` (sans identifiant : la clé est un texte), objet = le titre des
  Paramètres (« Drift forecast thresholds »…), avant / après des seuils modifiés, motif. `updated_by_name` = « <p_par> (Matrix) ».

### Garde-fou contre la dérive TypeScript / SQL

`src/server/db/pub-editer-settings.test.ts` passe **les mêmes cas** dans les validateurs TypeScript et dans `pub_editer`, et
attend la même acceptation / le même refus et, si accepté, la même valeur lue par Keystone :
- jours fériés : ~90 entrées (formes des Paramètres, mois français et majuscules, années écrites, 29 février, `parseInt`
  permissif, suffixe « A », espaces Unicode, retours à la ligne, longueur UTF-16 avec émojis, non-textes), en ajout et en
  correction (année de l’entrée) ;
- seuils : pour chaque seuil de chaque paramètre, les bornes, ±1, ±0,001, demi-unités, arrondis (0,0005, 1,0005), textes (« 5 »,
  « 0,5 », espaces insécables, zéros de tête, « 1e1 », vide), `1e400`, `1e-400`, `-0`, booléens, tableaux, sur plusieurs documents
  enregistrés (aucun, partiel, invalide, paire cassée, non-objet), plusieurs seuils à la fois, seuil inconnu, valeurs vides ;
- listes de seuils SQL = listes TypeScript ; valeurs par défaut SQL = valeurs par défaut TypeScript.
Un seuil, une borne ou une forme ajoutés d’un seul côté font échouer ce test.

`src/server/db/pub-editer.postgres.test.ts` (serveur PostgreSQL) vérifie en plus les aides de 0078 (schéma `keystone`,
`search_path`, EXECUTE retiré à PUBLIC) et une correction de seuil et un ajout de jour férié par un rôle qui a le lien Matrix.

### Décisions prises sans demander

- **Correction d’un jour férié : il garde son année** (l’année de son code), au lieu de passer à l’année d’affaires ; une
  correction ne déplace pas un jour férié d’une année à l’autre.
- **Date tenue par un jour férié retiré** : la correction vers cette date est refusée (« ajoutez-le de nouveau avec son
  libellé ») plutôt que de créer un code « 2026-11-01_2 » que les calendriers ignoreraient.
- **Année d’affaires en SQL = date réelle à Paris** : la fonction ne connaît pas `KEYSTONE_CLOCK` (horloge du processus) ; sur les
  serveurs, `KEYSTONE_CLOCK` n’est pas posé (date réelle, responsable produit 17/10/2026). Une démonstration à date épinglée
  calcule donc l’année réelle.
- **Plusieurs seuils à la fois** : Matrix peut envoyer plusieurs seuils d’un même paramètre ; ils sont appliqués ensemble et
  l’ordre (santé, paires de la dérive) est vérifié sur le résultat (les Paramètres en changent un à la fois).
- **Pas de fil d’activité** pour ces corrections (les Paramètres en écrivent un pour les seuils) : D9-05.
- `updated_by_name` des seuils corrigés = « <nom Matrix> (Matrix) », `updated_by_person_id` nul.
- Petite remise en forme du TypeScript sans changement de comportement : `parseHolidayEntry` / `realHolidayDate`
  (`src/domain/admin.ts`, remplace `isRealHoliday` local à `src/features/admin/actions.ts`) et `healthThresholdsRefusal`
  (`src/domain/health.ts`, utilisé par `setHealthThresholds`), pour que le test compare le SQL au code même des Paramètres.

### Écart connu, laissé tel quel (question)

- Dans les Paramètres, ajouter un jour férié dont la date est tenue par un jour férié **retiré d’un autre libellé** crée un code
  `<date>_2` que `settingsHolidayDates` ignore (le jour n’est plus retiré de la capacité). `pub_editer` reproduit ce comportement à
  l’ajout (même règle des deux côtés) ; à corriger des deux côtés si le responsable produit le souhaite (réactiver l’entrée
  retirée sous le nouveau libellé, par exemple).

## 2. D9-05 — corrections depuis Matrix hors du fil d’activité

Réponse : « Non, le journal d’audit suffit (actuel) ». Rien à faire : `pub_editer` (0076 et 0078) n’écrit que dans
`audit_entries` (domaine « Matrix ») ; aucune ligne `activity_events`. Confirmé.

## 3. D9-07 (R-139) — autres rôles internes renvoyés vers la fiche du projet

Réponse : « Non, les renvoyer vers la fiche du projet ».

- Règle pure `clientPortalSendsToProject(role, access)` (`src/domain/rights.ts`) : tout rôle interne qui ne peut pas
  prévisualiser le portail (ni directeur, ni responsable du projet : chef de projet en titre, co-CP, suppléant) ; jamais le client.
- `src/app/(app)/projects/[code]/client/page.tsx` : ces rôles sont redirigés vers la fiche du projet (écran Plan, comme les
  liens du portefeuille et « Retour au projet » de l’aperçu) ; ils ne voient plus le portail en lecture seule hors de leur espace.
- Inchangé (D9-06 en cours de confirmation) : l’aperçu « Voir comme le client » du directeur et des responsables du projet, le
  portail et le profil client.
- Test : `src/domain/d8-roles-rates-hr.test.ts` (boucle sur `PERSONAS`).

## 4. État des items

- **D9-04** : fait (jours fériés et seuils ouverts, garde-fou d’équivalence). Reste côté Matrix : la visionneuse doit proposer
  `app_settings` avec la clé `{"key": …}` et les seuils du tableau ci-dessus, et les jours fériés (`list_key` `holidays`).
- **D9-05** : fait (rien à changer).
- **D9-07 / R-139** : la redirection est faite ; R-139 reste « en cours » tant que D9-06 (suppression éventuelle de l’aperçu et du
  profil client, signature DocuSign) n’est pas confirmée.

## 5. Questions ouvertes

- Faut-il corriger l’écart « `<date>_2` » des jours fériés (§ 1, des deux côtés) ?
- La visionneuse de Matrix doit-elle connaître les libellés français des seuils (aujourd’hui : leurs noms techniques, `highFloatDays`…) ?
