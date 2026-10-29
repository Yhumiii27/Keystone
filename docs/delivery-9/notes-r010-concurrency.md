# Livraison 9 — lot « concurrency » (R-010) : écritures concurrentes en multi-utilisateur

Point de départ : la livraison 7 (`docs/delivery-7/notes-platform-data.md` § R-010) avait déjà rendu toutes les transactions
SERIALIZABLE avec reprise (40001 / 40P01), ajouté le verrou d’écriture du serveur partagé (`hashtext('keystone.ecritures')`),
re-vérifié la règle BL1 dans la transaction de « Définir la référence » (S-3) et réservé les envois des boîtes d’envoi des
connecteurs. Restait la détection d’une fiche modifiée entre-temps (verrouillage optimiste) ; ce lot la construit, et reprend
les trois autres points pour vérifier ce qui était fait et combler ce qui manquait.

Migrations : `drizzle/0068_row_versions.sql` (générée : colonne `version` sur 6 tables, table `connector_refresh_claims`) et
`drizzle/0069_row_version_triggers.sql` (SQL écrit à la main, `--custom` : fonction `ks_bump_row_version` et ses déclencheurs).
Aucune nouvelle dépendance.

## 1. Fiche modifiée entre-temps (verrouillage optimiste)

### Mécanique (générique)

| Pièce | Où | Rôle |
|---|---|---|
| Colonne `version` | `rowVersion()` de `src/server/db/schema/_common.ts` | entier, 1 à la création |
| Déclencheur | `ks_bump_row_version` (migration 0069) | `BEFORE UPDATE` : +1 quand le contenu de la ligne change (comparaison `to_jsonb(NEW) - ignorées` / `to_jsonb(OLD) - ignorées`), quel que soit l’auteur (formulaire, transition, import, connecteur). Ignorées : `version`, `updated_at` et les colonnes dérivées passées en arguments (dates et marges du CPM d’une activité, positions d’affichage, réalisé importé, prévision d’une catégorie, activité liée d’un risque — vidée puis remise par la corbeille du Plan). Un rédacteur qui pose lui-même `version + 1` (`bumpVersion`) garde sa valeur. |
| Jeton | `src/domain/record-version.ts` | `"<version>.<epoch ms de la lecture>"` ; `parseVersionToken` (valeur non fiable), `freshness` (verdict), `staleRecordText` (FR / EN) |
| Contrôle | `assertRecordFresh` (`src/server/dal/record-version.ts`) | dans la transaction du rédacteur : `SELECT … FOR UPDATE` de la ligne, comparaison de version ; si elle a bougé, lecture des entrées d’audit de l’entité depuis la lecture du jeton → `StaleRecordError(by, at)` |
| Réponse | `staleRecordResult(e, lang)` | `{ error: « Fiche modifiée entre-temps par <nom> le <date> à <heure> — rechargez pour voir ses changements », conflict: true }` |
| Navigateur | `src/components/app/StaleRecord.tsx` | `StaleRecordCallout` (dans un formulaire ; `FormDialog` l’affiche pour un résultat `conflict`) et `useStaleRecordToast()` (modifications en ligne : toast avec l’action « Recharger » = `router.refresh()`) |

Règles du verdict (`freshness`) :
- même version : enregistré ;
- version différente, et seules des modifications **de la même personne** depuis la lecture (deuxième clic avant le
  rafraîchissement de la page, barre de Gantt déplacée deux fois) : enregistré — la demande dit « modifiée par quelqu’un
  d’autre » ;
- une modification d’une autre personne ou d’un système (Lucca, Vigie…) : refus, avec le nom et l’heure (Paris) de la dernière ;
- version différente sans entrée d’audit (rédacteur qui n’audite pas) : refus sans nom (« Fiche modifiée entre-temps —
  rechargez pour voir les changements ») ;
- pas de jeton (page plus ancienne, appel sans formulaire) : pas de contrôle, comme avant ; jeton mal formé : refus (jamais
  d’écrasement silencieux).

Le jeton voyage comme valeur cachée : `initialValues.version` d’un `FormDialog` (les valeurs non déclarées comme champs sont
renvoyées telles quelles à `onSubmit`), ou paramètre `version` des Server Functions des modifications en ligne.

### Formulaires couverts

| Fiche | Formulaire / modification | Écrivain (contrôle) |
|---|---|---|
| Activité | cellules du Plan (nom, responsable, durée, budget, prédécesseurs, % d’avancement, « Marquer terminé ») | `updateActivity` (`src/server/dal/plan.ts`) |
| Activité | Gantt interactif (déplacement, durée, contrainte, boîte « Appliquer ») — `src/features/schedule/gantt-actions.ts` | `updateActivity` |
| Risque | tiroir du registre (P, I, stratégie, coût si survient, clore / rouvrir) | `updateRisk` |
| Contrat | fiche contrat (chaque champ) | `updateContractSheet` |
| Jalon de paiement | « Modifier » d’un jalon prévu | `updatePaymentMilestone` |
| Catégorie de coût | « Modifier la catégorie » (Budget › Paramétrage) | `updateProjectCostCategory` |
| Réclamation garantie | « Modifier la réclamation » | `updateClaim` |

Conséquences voulues :
- les modifications en ligne du Plan sont désormais **auditées** (« Plan edit: name … → … », avec avant / après) : sans cela la
  personne qui vient de modifier n’était pas connue ; « Mettre à jour l’avancement » aussi (sans contrôle de version, voir § 1.3) ;
- la modification des liens d’une activité (prédécesseurs, Gantt, tiroir) incrémente la version du **successeur** (les liens
  vivent dans `activity_links`) ;
- un Reschedule (dates CPM), un réordonnancement ou l’import du réalisé ne rendent jamais une page périmée.

### Formulaires non couverts (et pourquoi)

- **Demandes de modification, livrables, bons de commande, PV de réunion, tâches** : pas de formulaire qui réécrit les champs
  d’une fiche existante. Ce sont des créations, des ajouts de lignes et des transitions ; chaque transition re-vérifie déjà
  l’état dans la transaction (`UPDATE … WHERE status = …`, « … has moved on »). Les cases à cocher (actions de réunion, liste de
  contrôle d’une tâche) envoient désormais l’état demandé au lieu d’une bascule (§ 3).
- **Fiche projet / charte** : Keystone n’a pas de formulaire d’édition de la fiche projet (le projet se crée par l’assistant et
  change par des actions ciblées : phase, calendrier, devise, lien CAPEX, client interne). La fiche contrat en tient lieu et est
  couverte.
- **Lignes de nomenclature (BOM)** : seule modification = le choix de l’équipement (un menu, une valeur) — dernier qui écrit
  gagne, sans risque d’écraser d’autres champs. À couvrir si un vrai formulaire de ligne apparaît.
- **Avancement d’une tâche (segment %), « Mettre à jour l’avancement » du Plan** : saisie d’une seule valeur qui remplace la
  précédente par nature ; un refus gênerait plus qu’il ne protège (décision prise sans demander, facile à changer : passer le
  jeton comme pour les cellules).
- **Expéditions (R-158), réponses aux besoins machine, brouillons du catalogue, types de machine (admin)** : vrais formulaires,
  non couverts dans ce lot (R-158 vient d’être livré par un lot voisin ; les autres sont rarement édités à plusieurs). Pour en
  couvrir un : `version: rowVersion()` sur la table + un déclencheur dans une nouvelle migration, le jeton dans la lecture
  (`tokenOf`), `assertRecordFresh` dans l’écrivain, `staleRecordResult` dans la Server Function.
- **Feuille de site et ses lignes** : avaient déjà leur propre empreinte de contenu (`stamp`, livraison 8) — laissé tel quel.

### Décisions prises sans demander

- UX : celle proposée au propriétaire (refus + « Recharger », jamais d’écrasement) ; « Recharger » rafraîchit les données de la
  page (`router.refresh()`) et ferme le formulaire, plutôt que recharger tout le navigateur.
- Contrôle au niveau de la fiche, pas du champ : deux personnes qui modifient deux champs différents de la même fiche en même
  temps → la seconde recharge. Standard du marché, simple à expliquer.
- Les modifications de la même personne depuis la lecture ne sont pas un conflit.
- `version` entière + déclencheur plutôt que `updated_at` : `updated_at` n’est pas posé par tous les écrivains, et sa précision
  (µs en base, ms en JavaScript) rend la comparaison fragile.

## 2. Numérotation métier

Vérifié : les 28 appels à `nextNumber` / `nextBusinessNumber` lisent le maximum **dans la transaction** de l’écrivain (aucun hors
transaction ; `createProject` hors transaction n’est utilisé que par `scripts/db-check.ts`, déjà noté en livraison 7). Sur
PGlite les transactions passent une à une ; sur le serveur, derrière le verrou d’écriture : deux écrivains n’obtiennent jamais le
même numéro. Toutes les colonnes numérotées ont une contrainte unique (vérifié dans l’instantané 0068).

Ajouté : un **filet** si un numéro était quand même pris entre-temps (écrivain hors verrou, futur verrou ciblé) — une violation
d’unicité (23505) sur une contrainte de numérotation (`NUMBERING_CONSTRAINTS`, `src/server/db/transactions.ts`) relance la
transaction, qui relit le maximum et tire le numéro suivant. Une violation sur une autre contrainte (code saisi deux fois) reste
définitive. Un test vérifie que chaque nom de la liste existe dans le schéma (un renommage arrêterait silencieusement la reprise).
Pas de table de compteurs : inutile tant que la lecture du maximum est dans la transaction verrouillée.

## 3. « Vérifier puis écrire » hors transaction

- « Définir la référence » (`canSnapshotFreely` avant `createBaselineSnapshot`) : déjà corrigé en livraison 7
  (`enforcePolicy: true`, la règle est re-vérifiée dans la transaction ; la pré-vérification de la Server Function ne sert plus
  qu’à répondre vite). Test de course existant (`src/features/plan/baseline-race.test.ts`, et sur PostgreSQL).
- Balayage des Server Functions qui vérifient un état avant d’appeler l’écrivain (`status !== …`, « already ») et des
  écrivains qui posent un `status` sans condition. Corrigés :
  - Heures « Affecter » (`assignUnassignedHours`) : la ligne déjà affectée est refusée dans la transaction
    (`HOURS_ALREADY_ASSIGNED`) — deux affectations simultanées n’en déplacent plus qu’une ;
  - Leçon « Valider » / « Marquer appliquée » (`advanceLesson`) et liste de clôture (`cycleClosureItem`) : l’état vu par la
    personne (`from`) est re-vérifié dans la transaction — deux clics simultanés n’avancent plus de deux pas ;
  - Actions de réunion et liste de contrôle d’une tâche : la Server Function envoie l’état demandé (`done`) au lieu d’une
    bascule — deux personnes qui cochent en même temps laissent la case cochée.
- Vérifiés, déjà sûrs (re-vérification dans l’écrivain) : PV de réunion, demandes de ressources, réceptions et contrôle qualité,
  validation d’une pièce PLM, demandes de modification, avenants, jalons, réclamations, catalogue machine, factures fournisseur.

## 4. États gardés dans globalThis

- **Rafraîchissements des connecteurs** (Vigie ECO, Vigie NCR / HSE, Cursus go / no-go par projet) : avec plusieurs instances
  sur le serveur PostgreSQL, un seul rafraîchissement par minute pour toutes les instances. Le créneau est une ligne de
  `connector_refresh_claims`, pris par un `INSERT … ON CONFLICT DO UPDATE … WHERE claimed_at <= now() - intervalle RETURNING`
  atomique (`src/server/integrations/refresh-claims.ts`) ; hors transaction et hors verrou d’écriture (il ne doit pas attendre
  les écrivains). Un rafraîchissement Vigie échoué rend son créneau (relancé à la lecture suivante, sur n’importe quelle
  instance) ; Cursus le garde (un délai d’attente par minute, pas par page). Sur PGlite, une seule instance possède la base
  (`pglite-lock.ts`) : le créneau n’est pas consulté, le minuteur du processus suffit. L’heure gardée dans le processus sert
  seulement à éviter la requête du créneau à chaque lecture. Une erreur de base sur le créneau ne bloque jamais une lecture.
- Restés par processus, sans risque :
  - `__ksReadCache` / `__ksWriteGeneration` (R-017) : `versionedRead` est exact entre instances (jeton
    `pg_current_snapshot()`) ; `ttlRead` (badges) montre les écritures d’une autre instance au plus tard après sa durée de vie ;
  - `__ksRateLimits` (`src/server/http/request-guard.ts`) : la limite s’applique par instance (avec N instances, au plus N fois
    la limite) — à déplacer vers le proxy inverse si une limite globale est voulue ;
  - `__ksJobs` (planificateur interne) : les tâches prennent un bail dans `job_locks`, une seule instance exécute une tâche ;
  - `__ksDb`, `__ksExportProviders`, `__ksFilesRoot`, `__ksQuarantineRoot`, `__ksClockOverride` : poignée, registre statique,
    réglages de tests.

## 5. Tests

- Domaine : `src/domain/record-version.test.ts` (jeton, verdict, texte FR / EN).
- Base : `src/server/dal/record-version.test.ts` (déclencheur sur les 6 tables, colonnes ignorées, version posée par
  l’écrivain ; refus avec qui / quand, sa propre modification acceptée, sans jeton, jeton mal formé, version bougée sans audit,
  **deux enregistrements simultanés → un seul accepté**), `src/server/dal/record-version-forms.test.ts` (contrat, jalon,
  catégorie, réclamation), Server Functions (`src/features/risks/actions.test.ts`, `src/features/plan/actions.test.ts`,
  `src/features/schedule/gantt-actions.test.ts` : message `conflict`, Reschedule sans effet), rendu de l’avis
  (`src/components/app/stale-record.render.test.ts`).
- Numérotation : `src/server/dal/numbering-concurrency.test.ts` (8 risques et 6 tâches créés en parallèle → numéros distincts ;
  vraie collision → transaction relancée avec le numéro suivant), `src/server/db/transactions.test.ts` (reprise sur les seules
  contraintes de numérotation, noms présents dans le schéma).
- Vérifier puis écrire : `src/server/dal/check-then-write.test.ts`.
- Créneaux des connecteurs : `src/server/integrations/refresh-claims.test.ts`.
- **PostgreSQL 16** (`src/server/db/postgres.integration.test.ts`, `KEYSTONE_TEST_DATABASE_URL`) : trois nouveaux cas sur des
  connexions séparées (trois enregistrements simultanés d’un risque → un accepté, déclencheur dans le schéma `keystone` ;
  collision de numéro relancée ; créneau pris par une seule de quatre instances) ; le test de parité compare les versions sans
  l’heure de lecture des jetons. Exécuté localement sur un PostgreSQL 16 privé (socket unix) : 14 / 14 ; et, avec la couche de
  base `infra/postgres-socle/`, `npm run db:migrate` en `keystone_app` (toutes les migrations, avant la dernière fusion de `main-2a2fep`) puis `scripts/db-check.ts --postgres` :
  tout passe.

## 6. Ce qui reste

- Le verrou d’écriture global reste en place : il sérialise toutes les écritures du serveur. La version par fiche et la reprise
  sur les contraintes de numérotation sont les deux pièces qui permettraient de le remplacer par des verrous ciblés ; ce
  remplacement demande une mesure de charge réelle (pas de test de charge en CI) — à décider avec l’exploitation.
- Étendre le jeton aux formulaires listés au § 1 « non couverts » si l’usage le demande.
