# Livraison 9 — lot « volumes » (R-017) : tenir la charge avec de vrais volumes de données

Aucune dépendance externe : préparation de la mise en production. Mesuré avant et après sur un jeu de données à la taille
d’EPC2i, en PGlite et sur le serveur PostgreSQL 16 (schéma `keystone`, rôle `keystone_app`).

## 1. Le jeu de données de charge (`npm run load:seed`)

`scripts/load/seed-volume.ts` grossit une base **de démonstration** (refuse une base `production`) ; chaque étape complète
jusqu’à sa cible, donc une deuxième exécution n’ajoute rien. PGlite de `KEYSTONE_DATA_DIR` (créée et amorcée si vide) ou
serveur de `DATABASE_URL` (déjà migré avec le jeu de démonstration). Jamais sur une base dont on garde les données.

- **Projets** : les 6 projets de démonstration qui ont des données sont clonés à tour de rôle jusqu’à 150 projets
  (`scripts/load/clone-graph.ts`, générique : le schéma est lu dans le catalogue PostgreSQL). Un clone emporte toutes les lignes
  qui pendent du projet par les clés étrangères uuid (planning, budget, documents, commandes, ITP, chantier, réunions,
  expéditions…), plus les miroirs indexés par `project_code` (Vigie, Cursus) ; les clés vers les tables partagées (personnes,
  articles, fournisseurs) sont gardées ; les contraintes d’unicité sont respectées en réécrivant les numéros (code du projet
  remplacé, sinon numéro final renuméroté, sinon suffixe). Nouveau code `HLT-100`…, numéro `#100`…, code analytique.
- **Démultiplication dans chaque projet** : activités (avec leurs affectations), jalons, documents (révisions, visas, accusés),
  commandes (lignes), réserves, personnes (compétences, affectations, congés).
- **Deux ans d’heures et de congés** : une saisie de temps par tâche et par semaine sur 104 semaines, une semaine de congé tous
  les deux mois par personne interne ; lignes d’audit jusqu’à la cible. Puis `ANALYZE`.

| Volumes obtenus | |
|---|---|
| Projets | 150 |
| Activités | 30 000 (affectations ≈ 13 500) |
| Jalons | 5 000 |
| Documents | 20 000 (révisions ≈ 30 100) |
| Commandes / lignes | 8 000 / ≈ 13 300 |
| Réserves (punch list) | 3 000 |
| Lignes d’audit | 50 000 |
| Personnes | 500 |
| Saisies de temps / congés | 67 280 / ≈ 7 200 |

Durée : ≈ 60 s en PGlite, ≈ 40 s sur PostgreSQL. `--projects=`, `--scale=`, `--dry` (un clone annulé, affiche la copie
par table). Limite connue : les activités démultipliées n’ont ni liens ni ligne de référence (les clones gardent ceux du
modèle) ; les clones gardent les dates de leur modèle, ce qui concentre la charge sur les mêmes semaines (jeu pessimiste).

## 2. Mesure (`npm run load:measure`, contrôle `npm run load:check`)

`scripts/load/measure.ts` appelle les lecteurs du DAL de chaque écran comme le font ses pages (en directeur, sur HLT-026),
dans une requête simulée (le `cache()` de React par requête est reproduit), et donne : **à froid** (premier passage du
processus), **après une écriture** (caches de lecture vidés : ce que coûte une page juste après une modification), **à chaud**
(servi par les caches, base inchangée) et le nombre de requêtes SQL. `load:check` sort en erreur si un écran dépasse le budget
à chaud : **300 ms en PGlite, 150 ms sur PostgreSQL** (la carte diffusée en différé n’est pas comptée). Ce n’est **pas** un job
de CI (minutes Actions comptées) : à relancer à la main après un changement de lecteur.

### Avant (PGlite, base agrandie, code d’origine — médiane à chaud, sans cache entre requêtes)

| Écran | Froid (ms) | À chaud (ms) | SQL |
|---|---:|---:|---:|
| Accueil (directeur) | 7 258 | 7 049 | 1 684 |
| Accueil (CP) | 582 | 574 | 42 |
| Vue d’ensemble du portefeuille | 6 561 | 6 856 | 1 506 |
| Registre des projets | 665 | 641 | 22 |
| Planning du portefeuille | 611 | 679 | 13 |
| En-tête de projet | 483 | 500 | 8 |
| Plan | 564 | 492 | 23 |
| Planning | 456 | 456 | 12 |
| Budget | 556 | 505 | 45 |
| ITP | 22 | 14 | 12 |
| Coffre documentaire | 2 215 | 2 233 | 11 |
| Fiche document | 2 310 | 2 346 | 22 |
| Commandes | 63 | 53 | 13 |
| Ressources | 49 193 | 47 837 | 2 673 |
| Catalogue machines | 19 | 13 | 11 |
| Mon travail | 1 811 | 1 783 | 573 |
| Activité & audit | 86 | 78 | 30 |
| Parc installé | 567 | 593 | 20 |
| Badges du menu (directeur) | 9 812 | 8 972 | 2 385 |
| Badges du menu (CP) | 8 088 | 7 554 | 2 578 |

### Après — PGlite (même volume)

| Écran | Froid | Après une écriture | À chaud | SQL après écriture | SQL à chaud |
|---|---:|---:|---:|---:|---:|
| Accueil (directeur) | 2 326 | 2 222 | 121 | 510 | 22 |
| Accueil (CP) | 653 | 651 | 122 | 43 | 38 |
| Vue d’ensemble du portefeuille | 2 349 | 2 223 | 18 | 494 | 6 |
| Registre des projets | 640 | 627 | 163 | 23 | 18 |
| Planning du portefeuille | 658 | 590 | 167 | 14 | 9 |
| En-tête de projet | 514 | 556 | 13 | 9 | 4 |
| Plan | 509 | 561 | 47 | 24 | 19 |
| Planning | 452 | 494 | 10 | 13 | 8 |
| Budget | 563 | 479 | 49 | 46 | 41 |
| ITP | 20 | 13 | 12 | 12 | 12 |
| Coffre — projet courant | 88 | 76 | 71 | 12 | 12 |
| Coffre — tous les projets | 1 574 | 1 622 | 7 | 12 | 3 |
| Fiche document | 98 | 93 | 77 | 23 | 23 |
| Commandes | 46 | 29 | 34 | 13 | 13 |
| Ressources (page) | 1 101 | 1 124 | 68 | 32 | 20 |
| Ressources — suggestions (diffusées en différé) | 22 563 | 19 842 | 1 | 2 099 | 1 |
| Catalogue machines | 18 | 10 | 12 | 11 | 11 |
| Mon travail | 545 | 535 | 25 | 21 | 14 |
| Activité & audit | 93 | 69 | 101 | 30 | 30 |
| Parc installé | 509 | 503 | 35 | 21 | 16 |
| Badges du menu (directeur) | 937 | 970 | 0 | 206 | 0 |
| Badges du menu (CP) | 882 | 909 | 0 | 285 | 0 |

Tous les écrans mesurés tiennent le budget à chaud de 300 ms.

### Après — PostgreSQL 16 (même volume, cluster local)

| Écran | Froid | Après une écriture | À chaud |
|---|---:|---:|---:|
| Accueil (directeur) | 1 137 | 951 | 44 |
| Accueil (CP) | 225 | 274 | 47 |
| Vue d’ensemble du portefeuille | 841 | 776 | 14 |
| Registre des projets | 241 | 320 | 87 |
| Planning du portefeuille | 224 | 243 | 71 |
| En-tête de projet | 272 | 179 | 9 |
| Plan | 254 | 229 | 22 |
| Planning | 153 | 170 | 5 |
| Budget | 203 | 198 | 21 |
| ITP | 11 | 8 | 8 |
| Coffre — projet courant | 33 | 40 | 43 |
| Coffre — tous les projets | 699 | 742 | 5 |
| Fiche document | 39 | 47 | 46 |
| Commandes | 24 | 20 | 17 |
| Ressources (page) | 526 | 571 | 35 |
| Ressources — suggestions (différé) | 17 923 | 17 655 | 1 |
| Mon travail | 241 | 273 | 12 |
| Activité & audit | 63 | 62 | 66 |
| Parc installé | 163 | 194 | 15 |
| Badges du menu (directeur / CP) | 384 / 382 | 402 / 390 | 1 / 0 |

Tous les écrans tiennent le budget à chaud de 150 ms. Le « avant » n’a été mesuré qu’en PGlite.

## 3. Index (migration `0062_load_indexes`, 72 index)

Règle, justifiée par les requêtes mesurées : (a) la clé `project_id` des tables métier qu’un écran de projet lit par projet
(documents, commandes, tâches, réceptions, réunions, audit, notifications, budgets de lots, barres de planning…) ; (b) la clé
du parent des lignes lues par leur parent (affectations par activité, lignes de documents, saisies par tâche, commentaires /
check-lists / pièces de tâche, avenants et cautions par contrat, jalons de paiement, tirages de provision, lignes d’import
d’heures, interventions, évènements de demande, progrès Vigie, lignes d’expédition par chargement…) ; (c) les clés vers
`activities` vérifiées à la suppression d’une activité (corbeille du plan) ; (d) filtres et tris fréquents : `documents.status`
(« proposé à la diffusion »), `purchase_orders.status` (« en attente d’approbation »), `time_entries (person_id, work_date)`,
`leave_entries (start_date, end_date)`, `tasks.assignee_person_id`, `activities.owner_person_id`.

Les autres clés étrangères sans index sont des **exceptions revues**, chacune avec sa raison, dans
`src/server/db/fk-without-index.json` (personne qui a agi, valeur de référence, journal…) ; `src/server/db/fk-indexes.test.ts`
échoue si une nouvelle clé étrangère n’a ni index ni entrée dans cette liste (une décision est alors nécessaire), ou si une
exception a désormais un index.

## 4. Points chauds corrigés

| Point chaud | Correction |
|---|---|
| Calendriers lus une fois par projet dans le plan de charge (561 requêtes) | `loadWorkCalendarsOf` : trois lectures pour tous les projets (`calendars.ts`, `planning-load.ts`) |
| Listes `IN` de milliers d’identifiants (plan de charge, activités à pourvoir, coffre) — et limite de 65 535 paramètres de PostgreSQL | jointure / sous-requête sur la même condition |
| Jours ouvrés recomptés jour par jour pour chaque affectation et chaque semaine | `activityWorkDays` : par activité, par ordinal du calendrier (deux recherches binaires) ; mêmes heures (`load-week.ts`, `planning-load.ts`) |
| Conversions de dates répétées (CPM, charge, what-if) | mémorisation bornée de `msOf`, `isoOfMs`, `isIsoDate` et des ordinaux d’un calendrier (`calendar.ts`, mêmes résultats) |
| Valeur acquise de tout le portefeuille (lit les 30 000 activités) à chaque page | regroupement en une passe (était quadratique) + cache exact (§ 5) |
| `findRecord` des actions Documents, `DocumentLink`, Qualité, fiche article lisaient tout le coffre | lecteurs ciblés : `getVaultDocument(numéro)`, `listOwnProjectDocuments`, `listPartDocuments`, `listSharedDocuments` en SQL ; badge Documents et « Mes approbations » : `listReleaseProposedDocuments` |
| Badge « Mes approbations » : chaque type par projet, pour 150 projets (2 067 requêtes) | `candidates` (une requête par type donne les projets où un élément peut exister) et `countByProject` (commandes comptées en SQL) ; idem pour la file du directeur des alertes du portefeuille |
| Badge Chantier : lecture complète du chantier de chaque projet, avec Cursus et Vigie (HTTP possible) | les conditions « Go chantier » en cinq lectures pour toutes les fiches, depuis les **miroirs** Cursus et Vigie ; les conflits d’équipe ne sont calculés que si tout le reste est prêt ; plus aucun appel à Cursus dans le menu |
| Badge P&ID : validation complète par projet | trois lectures pour le portefeuille, mêmes règles (`pidTagStatusOf`, `pidCoverage`) |
| Accueil directeur : demandes de modification lues projet par projet | `listChangeRequestsOf` (trois lectures) |
| Suggestions de rééquilibrage (what-if de 150 projets) sur le chemin critique de Ressources | carte diffusée en différé (`<Suspense>`, `portfolio-suggestions.tsx`) + cache exact |

## 5. Règle de cache (`src/server/cache/read-cache.ts`)

- **`versionedRead` — chiffres dérivés affichés** (valeur acquise de tous les projets, plan de charge, alertes du
  portefeuille, suggestions de rééquilibrage, coffre « tous les projets ») : gardés en mémoire du processus tant que la base
  n’a pas changé. Le jeton est `pg_current_snapshot()` de PostgreSQL, qui bouge dès qu’une transaction qui a écrit se
  termine — sur ce serveur, sur une autre instance de Keystone ou par un autre outil du serveur commun — et jamais pour une
  lecture : un résultat servi du cache est exactement celui d’une relecture (coût : une petite requête). Rien qui dépende du
  lecteur : les droits sont appliqués par les appelants après la lecture. Valeurs remises en copie (structuredClone) ; le coffre
  complet est gelé et partagé.
- **`ttlRead` — badges du menu** (calculés à chaque page) : 30 s (`SHELL_BADGES_TTL_MS`), effacés dès que **ce processus**
  écrit (`writeGeneration` : chaque transaction validée et chaque requête d’écriture, via le logger Drizzle) — donc les
  écritures des Server Functions qui appellent `revalidatePath` sont visibles à la page suivante ; celles d’une autre instance
  dans les 30 s. Deux entrées : les compteurs communs à tous (partagés) et ceux du lecteur, sous une clé qui porte tout ce dont
  ses droits dépendent (rôle, rôles, nom, organisation, service, personne, utilisateur, e-mail) et la date métier — jamais
  servis à un autre lecteur. Un client ne reçoit toujours que les badges de son espace (`badgesFor`).
- Erreurs jamais mises en cache ; caches vidés quand la base change (`setDb`) ; `KEYSTONE_READ_CACHE=off` coupe tout
  (diagnostic ; `.env.example`, `docs/EXPLOITATION.md`). L’API de cache de Next 16 (`use cache` / `unstable_cache`, sans
  Cache Components activé) n’est pas utilisée : elle ne sait ni valider sur la version de la base ni servir les scripts et tests.

## 6. Pagination

`?page=` côté serveur (`src/domain/pagination.ts`, 100 lignes par page, `Pager` dans `src/components/app/Pager.tsx`) :

- **Coffre documentaire** : « Projet courant » lit seulement les documents du projet et du SMQ ; la liste est découpée par
  pages, les compteurs, KPI et titre couvrent toute la liste ; ouvrir une fiche garde la page, un filtre revient à la page 1.
- **Piste d’audit** (Activité & intégrations) : 100 entrées par page, les plus récentes d’abord (l’identifiant départage les
  entrées d’un même instant) — elle était tronquée à 500 lignes.
- Les exports restent complets (registre documentaire, CSV d’audit). Les listes de démonstration tiennent sur la première page :
  rien ne change à l’écran. Commandes, parc installé et catalogue restent petits par écran : non paginés.

Valeurs affichées : aucune ne change. Changements visibles seulement à volume réel : pager au-delà de 100 lignes ; la carte
« Rééquilibrage suggéré » de Ressources arrive après le reste de la page.

## 7. Relancer

```bash
KEYSTONE_DATA_DIR=/tmp/ks-load npm run load:seed      # PGlite jetable (créée et amorcée si vide)
KEYSTONE_DATA_DIR=/tmp/ks-load npm run load:measure   # tableau ; --json, --only=docs,shell, --runs=5
KEYSTONE_DATA_DIR=/tmp/ks-load npm run load:check     # budget à chaud (300 ms PGlite, 150 ms PostgreSQL)
DATABASE_URL=postgres://keystone_app:…@host/epc2i npm run load:seed   # serveur migré (db:migrate, KEYSTONE_SEED=demo)
```

## 8. Ce qui reste

- **Après une écriture**, la première page paie le recalcul : ≈ 0,5 s en PGlite / 0,2 s sur PostgreSQL pour tout ce qui passe
  par le registre (valeur acquise des 30 000 activités), ≈ 2 s / 1 s pour l’accueil directeur et la vue d’ensemble (alertes :
  contrat de chaque projet en exécution), ≈ 1 s / 0,4 s pour les badges du menu. Pistes : valeur acquise et alertes par
  projet modifié (empreinte par projet), ou calculées par le worker.
- **Suggestions de rééquilibrage du portefeuille** : ≈ 20 s / 18 s de calcul (what-if de 150 projets planifiés) après une
  écriture, désormais hors du chemin critique (diffusées en différé) et en cache exact ensuite ; à calculer dans le worker
  (tâche planifiée) ou à restreindre aux projets surchargés si le propriétaire le valide.
- Coffre « tous les projets » : 1,6 s / 0,7 s après une écriture (20 000 fiches lues) ; pagination en SQL possible si besoin.
- Index non créés sur les colonnes de fenêtre des activités (`start_date`, `finish_date`) : la fenêtre de 8 semaines couvre
  un tiers des activités du jeu, un index n’y serait pas choisi.
- Le jeu clone les dates de ses modèles (charge concentrée) : à refaire avec des données réelles anonymisées si EPC2i en fournit.
