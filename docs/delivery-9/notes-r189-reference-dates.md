# Livraison 9 — lot « dates BL1 des jalons CAPEX » (R-189, `reference_le`)

Statut : construit sur la branche `r189-reference-dates` (depuis `2ad3551`) le 25 oct. 2026, à la demande du responsable produit
(lancement de R-189 le 25 oct. 2026). Sources : demande d’Arche **K-04** (`REQUESTS.md` : `pub_jalons_projets.reference_le` =
« date de la baseline (BL1) »), contrat d’Arche (`docs/CONTRATS.md` d’Arche : `reference_le` date BL1, lue pour le glissement
des jalons et les critères K3 « SAT EPC2i planifiés » et G3), `docs/delivery-9/notes-share-views.md` § 3 et § 5.1 (point ouvert :
« code de jalon CAPEX sur les jalons du planning »). Hors lot : `pub_pack_ingenierie` (R-191, attend la liste type du pack
ingénierie, CDC C-9).

## 1. Ce qui change

| Pièce | Où | Rôle |
|---|---|---|
| Colonne | `drizzle/0055_capex_milestone_code.sql` (générée) | `milestones.capex_milestone_code` (texte, nul = aucun), contrainte `milestones_capex_milestone_code_check` (les 8 codes), unicité `milestones_project_capex_code_unique` (un jalon par code et par projet) |
| Reprise | `drizzle/0056_capex_milestone_backfill.sql` (personnalisée) | code posé sur les jalons existants par la règle automatique, seulement quand elle est sans ambiguïté |
| Vue | `drizzle/0057_capex_milestone_share.sql` (personnalisée) | `pub_jalons_projets` recréée à l’identique de ses colonnes ; `reference_le` remplie |
| Règles | `src/domain/capex-milestones.ts` (+ tests) | codes, libellés, motifs de noms, règle automatique, saisie |
| Écriture | `src/server/dal/capex-milestones.ts`, `setCapexMilestoneAction` (`src/features/schedule/actions.ts`) | correction par les responsables du projet, avec audit et fil d’activité |
| Écran | Planning (`/projects/<code>/schedule`), carte « Jalons » : `capex-milestone-select.tsx`, `schedule-view.tsx` | petite liste « Jalon CAPEX » sous chaque jalon pour les responsables ; le code seul (« Jalon CAPEX · PV de réception ») pour les autres |
| Droits | `canSetCapexMilestone` (`src/domain/rights.ts`) | le directeur et les responsables du projet (chef de projet titulaire, co-CP, adjoint) qui voient le Planning ; ni Finance ni le client ; jamais sur un projet en lecture seule (`canEdit('schedule')`) |
| Contrôles | `share-views.test.ts`, `migration-capex-milestones.test.ts`, `capex-milestone-actions.test.ts`, `capex-milestones.test.ts`, `scripts/db-check.ts` (aussi `--postgres`), `share-contracts.ts` (commentaire du contrat) | |

## 2. Règle de correspondance (jalon du planning → jalon CAPEX)

Les jalons du planning (`milestones`) n’avaient aucun lien avec les huit jalons d’Arche. Un jalon peut désormais porter **un** code
(`commande`, `fin_etudes`, `fat`, `expedition`, `arrivee_site`, `sat`, `pv_reception`, `fin_garantie`), et un code n’est porté
que par **un** jalon du projet.

**Règle automatique** (`autoCapexMilestoneCodes`) — appliquée au seed de démonstration, à l’import d’un planning MS Project / P6
(nouveaux jalons) et par la migration 0056 aux bases existantes :

1. le nom du jalon est comparé, sans tenir compte de la casse, à un motif par code (français et anglais, `CAPEX_MILESTONE_PATTERNS`) :
   par exemple « FAT », « Essais usine », « Factory acceptance » → `fat` ; « Mise en service », « SAT », « Commissioning » → `sat` ;
   « PV de réception », « Réception provisoire », « Handover » → `pv_reception` ; « Fin de garantie », « Réception définitive »,
   « Final acceptance » → `fin_garantie` ; « Arrivée sur site », « Livraison chantier » → `arrivee_site` ; « Expédition »,
   « Départ usine » → `expedition` ; « Fin des études », « Design freeze » → `fin_etudes` ; « Commande », « Contract signed »,
   « Kick-off » → `commande` ;
2. un mot générique ne compte que comme nom entier (« Commande » oui, « Commande moteurs » non — une commande d’achat n’est pas
   la commande du projet) ; « PV » seulement comme « PV de réception » ou nom entier (« PV modules complete », des panneaux
   photovoltaïques, n’en est pas un) ;
3. un nom qui répond à **deux** codes reste sans code (« Commissioning & handover complete » de RCF-019 : SAT ou PV ?) ;
4. deux jalons du projet qui répondent au même code seul restent tous deux sans code ;
5. un code déjà porté (posé à la main) n’est jamais redonné, et un jalon déjà codé n’est jamais recodé.

Tout ce qui est ambigu est laissé aux responsables du projet, sur l’écran Planning.

Les motifs sont écrits dans la syntaxe commune à JavaScript et à PostgreSQL (ni barre oblique inverse, ni apostrophe, ni
assertion) : la migration 0056 applique **les mêmes chaînes** avec `~*`. `capex-milestones.test.ts` vérifie que le fichier SQL
porte exactement les motifs TypeScript et que PostgreSQL (PGlite) donne à chaque nom de la liste de test les mêmes codes que
JavaScript (accents compris).

**Correction à l’écran** : sur le Planning, chaque jalon de la carte « Jalons » porte une petite liste (« Pas un jalon CAPEX »
et les huit libellés, traduits). Choisir un code déjà porté par un autre jalon du projet le **déplace** (l’autre jalon le perd,
dans la même transaction). Chaque jalon modifié reçoit une ligne d’audit (zone « Planning », message système
`milestone.capexCode`, avant / après) ; une entrée au fil d’activité ; `updated_at` du jalon avance (`pub_jalons`,
`pub_jalons_projets`) ; `revalidatePath` de l’espace projet.

**Démonstration** (codes posés par le seed) : HLT-026 « Handover » → `pv_reception` ; MSR-012 « Acceptance & handover complete » →
`pv_reception` ; NDC-031 « Commissioning & IST complete » → `sat` ; WSA-044 « Commissioning complete » → `sat`. RCF-019 et
ERP-202 : aucun (ambigu, ou aucun jalon CAPEX).

## 3. Date BL1 (`reference_le`)

Les références sont stockées dans `baselines` (BL0, BL1, BL2… par projet, `state` current / superseded / proposed) et leur
instantané d’activités dans `baseline_activities` (dates ISO de début et de fin par activité ; le seed en écrit un pour BL1).
Les jalons du planning sont des positions en mois fractionnaires depuis le début du projet (`baseline_month`, `forecast_month`),
ancrés sur une activité (`milestones.activity_id`) par l’import et par chaque reprogrammation (« Reschedule », roll-ups A-7).

`reference_le` d’un code = la date BL1 du jalon du projet qui porte ce code :

- **jalon ancré sur une activité** : la fin de cette activité dans l’instantané BL1 (`baseline_activities`, rapprochée par
  l’activité, sinon par son code) ; nulle si l’activité a été ajoutée après BL1 ;
- **jalon pas encore ancré** (jalon du seed avant sa première reprogrammation) : sa position de référence lue **comme l’écran
  Planning la lit** (`dateOf` : mois de début du projet + position ; jour = arrondi(fraction × 30), au moins 1, au plus le dernier
  jour du mois). Le stockage n’est pas en « mois seuls » : la fraction porte le jour (`monthIndex` = mois + (jour − 1) / 30) ;
  la règle « dernier jour du mois » envisagée pour un stockage au mois n’a donc pas été nécessaire. Ainsi la date publiée est
  celle qu’affiche le Planning (« Référence 18 déc. ») ;
- **sans BL1** (ou BL1 encore proposée, c’est-à-dire pas gelée) : nulle ; une BL1 remplacée (superseded) reste la BL1 ;
- sans jalon codé : nulle.

Après une reprogrammation, le jalon est ancré et la date vient de l’instantané BL1 : pour HLT-026 la même date
(18 déc. 2026, testé).

**Valeurs de la démonstration** (date du jour fixée au 25 sept. 2026) : HLT-026 `pv_reception` **2026-12-18** (les sept autres
codes de HLT-026 : `reference_le` nulle) ; MSR-012 `pv_reception` 2026-11-01 ; NDC-031 `sat` 2027-04-01 ; WSA-044 `sat`
2027-07-01 ; toutes les autres lignes : nulle.

## 4. La vue `pub_jalons_projets` (0057)

`CREATE OR REPLACE VIEW` garde les six colonnes, dans le même ordre et avec les mêmes types (`reference_le` reste `date`) ;
`security_barrier`, noms non qualifiés, commentaire de vue mis à jour. Rien ne change pour les colonnes déjà calculées par les
modules, qui gardent la priorité ; le jalon codé ne sert que de **repli** :

| Colonne | Avant | Après (R-189) |
|---|---|---|
| `prevu_le` | date du module qui le planifie, sinon la date réelle | date du module, **sinon la date courante du jalon codé** (fin courante de son activité, ou sa position prévue lue comme le Planning), sinon la date réelle |
| `reference_le` | toujours nulle | date BL1 du jalon codé (§ 3) |
| `reel_le` | date réelle du module (étapes, SAT, PV) | la même, **sinon la fin réelle du jalon codé** (activité d’ancrage terminée, ou jalon non ancré marqué « fait ») |
| `maj_le` | projet, transitions, source du module | + le jalon codé, son activité (`updated_at`, `scheduled_at`) et la BL1 du projet |

**Valeurs affichées qui changent sur la démonstration** (seulement des valeurs nulles qui se remplissent) :

- `reference_le` : les quatre lignes ci-dessus (nulles avant) ;
- `prevu_le` : NDC-031 `sat` 2027-04-04, WSA-044 `sat` 2027-07-01, MSR-012 `pv_reception` 2026-11-09 — aucun module ne les
  planifiait (ni mise en service, ni PV de livrable) : c’est la prévision du planning, plus juste qu’une date vide.
  HLT-026 `pv_reception` garde 2027-01-14 (échéance des livrables PV, prioritaire) ;
- aucun `reel_le` ne change (aucun jalon codé n’est terminé dans la démonstration) ; `pub_jalons` ne change pas (le code n’y est
  pas publié ; le seed n’ancre aucun jalon).

`share-views.test.ts` cite R-189 là où l’attente « `reference_le` toujours nulle » est remplacée.

## 5. Décisions prises sans demander

1. **Le code est sur le jalon du planning**, pas sur l’activité : c’est ce que le Planning montre et ce que Crucible lit déjà
   (`pub_jalons`) ; l’activité vient de l’ancrage du jalon.
2. **Règle automatique par le nom**, prudente (ambiguïté ⇒ rien) plutôt que par la position : les noms du planning sont libres et
   la position ne dit rien de la nature du jalon. Les motifs couvrent le français et l’anglais (imports MS Project / P6).
3. **Un code déplacé, pas refusé** : choisir sur un jalon un code déjà porté le retire à l’autre jalon (deux lignes d’audit),
   plutôt que d’obliger à deux manipulations.
4. **Droits** : ceux du rattachement CAPEX (R-190) — directeur et responsables du projet — appliqués à l’écran Planning ; pas de
   nouvel écran, pas de nouveau champ ailleurs (la liste vit dans la carte « Jalons » existante).
5. **BL1 au sens strict** : la ligne `baselines.code = 'BL1'` non proposée, même remplacée par BL2 (Arche mesure le glissement
   par rapport à la BL1, référence de la Phase 2) ; pas de repli sur BL0 ni sur la référence affichée.
6. **Jalon non ancré** : date de référence lue sur sa position, comme le Planning (§ 3), plutôt que nulle jusqu’à la première
   reprogrammation ; elle n’est publiée que si le projet a une BL1.
7. **`prevu_le` / `reel_le`** : le jalon codé ne vient qu’en repli des modules (ITP, fiche chantier, mise en service, PV,
   garantie, étapes), qui restent la source quand ils ont une date — aucune valeur non nulle de la démonstration ne change.
8. **Libellés** : « FAT » et « SAT » se lisent de même en français (pas d’entrée de traduction : `t()` les rend tels quels) ; `pv_reception` =
   « Acceptance certificate » / « PV de réception ».

## 6. Ce qui reste

- **`pub_pack_ingenierie`** (R-191, K-08) : attend la liste type pondérée du pack ingénierie (CDC C-9).
- **Copie dans Matrix** : `partage/30-keystone.sql` de Matrix doit reprendre la nouvelle définition de `pub_jalons_projets`
  (`drizzle/0057_capex_milestone_share.sql`, qualifiée `keystone.`) et ajouter à son contrôle des prérequis
  `milestones.capex_milestone_code`, `baselines`, `baseline_activities`, `project_controls` et `activities.finish_actual` /
  `percent_complete` / `scheduled_at` (tables présentes depuis les premières migrations ; seule la colonne est nouvelle,
  migration 0055). Sans cette copie, un rejeu du fichier 30 de Matrix republierait `reference_le` nulle (même colonnes : PostgreSQL
  l’accepterait sans erreur). Demande à déposer dans le `REQUESTS.md` de Matrix après le « validé » du responsable produit (avec
  les droits d’`arche_app`, notes-share-views § 6).
- **Plusieurs équipements par projet (R-185)** : un code par projet ; avec plusieurs machines, les jalons CAPEX seraient par
  équipement — à cadrer avec R-185 (la contrainte d’unicité devra alors inclure l’équipement).
- `fat` et `expedition` partagent toujours la même frontière d’étape côté module (notes-share-views § 5.2) ; un jalon codé
  `fat` du planning donne désormais une date prévue et une date BL1 propres au FAT.
