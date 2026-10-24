# Livraison 9 — lot « projets multi-équipements », parties 1 et 2 (R-185)

Statut : construit sur `main-2a2fep` le 23 oct. 2026, d’après le cadrage `docs/delivery-9/cadrage-r185-r186.md` dont les cinq
choix ont été validés par le responsable produit le même jour (options « recommandé »). Cette partie couvre les étapes (1) et (2)
de l’ordre de construction du § 3 : liste des équipements, migration des projets existants, affichage ; assistant de création et
génération du planning par ligne. ITP, réserves, mise en service, nomenclature par équipement (étape 3) et le catalogue (R-186)
restent à faire (§ 7).

## 1. Ce qui change

| Élément | Où | Rôle |
|---|---|---|
| Table et colonnes | `drizzle/0041_project_equipments.sql` (générée) | table `project_equipments` ; `machine_type_phases.per_equipment` ; `wbs_nodes.equipment_id`, `activities.equipment_id` |
| Reprise | `drizzle/0042_project_equipments_backfill.sql` (personnalisée, comme 0030) | une ligne EQ-01 par projet typé, drapeaux des phases propres à un équipement |
| Règles pures | `src/domain/project-equipment.ts`, `instantiateTemplate` / `templatePlanShape` (`src/domain/project-template.ts`) | repères, validation, résumé, type principal, budget de référence, lots par ligne |
| DAL | `src/server/dal/project-equipment.ts` | lecture, ajout, modification, retrait, synchronisation du type principal |
| Server Functions | `addEquipmentAction`, `updateEquipmentAction`, `removeEquipmentAction` (`src/features/contract/actions.ts`) | droits, validation, audit, fil d’activité, `revalidatePath` |
| Carte « Équipement » | `src/features/contract/equipment-card.tsx`, `equipment-buttons.tsx`, page Contrat | liste des lignes ; ajout, modification, retrait pour les responsables |
| Assistant | `new-project-wizard.tsx`, `new-project-launcher.tsx`, `createProjectAction`, `createWizardProject` | une ou plusieurs lignes ; lots par ligne ; catégories de référence × quantité |
| Affichage | `ProjectRow.equipment` (`src/server/dal/projects.ts`), registre, sélecteur de projet, export du registre, Budget › REX | « 1 × EMP · 3 × MEMU » |
| Traductions | `src/i18n/extra/d9-equipment.json`, messages système `project.equipment*` | |

Aucune vue `pub_` n’est modifiée ; aucun écran n’est ajouté à `src/config/screens.ts`.

## 2. Schéma

`project_equipments` : `id`, `project_id` (cascade), `ref` (`EQ-01`, `EQ-02`… ; unique par projet, contrôle `^EQ-[0-9]{2,}$`),
`machine_type_code` (clé étrangère `machine_types`), `quantity` (entier ≥ 1, défaut 1), `label` (texte saisi, facultatif),
`position` (0 = ligne principale), `capacity_value` + `capacity_unit` (capacité visée, facultative), `options` (jsonb, tableau,
défaut `[]` — texte saisi pour l’instant, codes d’options du catalogue avec R-186), `besoin_ref` (besoin d’Arche, format
`CPX-XXX-AAAA-NN/BNN`, référence inter-schéma sans clé étrangère), `catalogue_version` (entier, null jusqu’à R-186), horodatages.

`machine_type_phases.per_equipment` (booléen, défaut faux) : la phase est un lot propre à un équipement.
`wbs_nodes.equipment_id` et `activities.equipment_id` (null = commun au projet ; `on delete set null`).

`projects.machine_type_code` reste le **type principal** = type de la première ligne : les écrans et la vue `pub_projets` qui le
lisent ne changent pas. Chaque écriture des lignes (assistant, `createProject`, ajout, modification, retrait) le tient à jour.

## 3. Migration et reprise

- 0041 (générée) crée la table et les colonnes.
- 0042 (personnalisée, après 0041), rejouable : une ligne `EQ-01`, quantité 1, position 0, par projet ayant un type et aucune
  ligne ; puis `per_equipment = true` sur les phases standard listées par `PER_EQUIPMENT_PHASES`, retrouvées par leur nom (une
  phase renommée reste commune). Une base neuve n’a aucun projet : la seed écrit elle-même lignes et drapeaux.
- SQL non qualifié : le migrateur serveur remplace `"public".` par `"keystone".` et la connexion est en `search_path=keystone` ;
  PGlite reste dans `public`. Testé par `src/server/db/migration-equipment.test.ts` (état d’avant R-185 reconstitué, deux passages).

## 4. Règles

- **Ligne** = type × quantité (choix 1). Les exemplaires (numéros de série) restent au parc installé (`machines`).
- **Repère** : un après le plus haut repère en usage (`nextEquipmentRef`) ; un repère retiré en dernier peut donc revenir.
- **Validation** (`parseEquipmentLine`, côté Server Function et DAL) : type actif (ou le type actuel de la ligne modifiée),
  quantité entière 1–999, libellé ≤ 120, capacité > 0 avec son unité, au plus 12 options de 80 caractères, besoin au format
  d’Arche. Au plus 20 lignes par projet.
- **Résumé** (`equipmentSummary`) : « EMP » pour une seule ligne d’une machine (l’affichage d’avant R-185), sinon
  « 1 × EMP · 3 × MEMU ».
- **Droits** : `canSetProjectEquipment` = ceux du rattachement CAPEX — le directeur et les responsables du projet (chef de projet
  attitré, co-CP, adjoint) qui voient l’écran Contrat ; ni Finance, ni le client, ni un membre ; jamais sur un projet en lecture
  seule (`ctx.canEdit('contract')`).
- **Retrait** : la dernière ligne est refusée ; les lots et activités de la ligne restent, communs au projet (clé étrangère
  `set null`, le nombre de lots et d’activités détachés est noté dans l’audit) ; si la première ligne part, la suivante devient
  principale.
- **Budget de référence** (choix 3) : `referenceCategories` = catégories de référence de chaque type × quantité, fusionnées par
  nom et type (celles du type principal d’abord). L’assistant les propose à l’étape 3 ; le suivi des coûts reste au niveau du
  projet ; la ventilation par équipement viendra des lots du planning (`activities.equipment_id`).
- **Budget › Profil de coûts** : le schéma de paiement REX reste celui du type principal ; les projets de référence des autres
  types des lignes s’affichent en dessous (`RexPattern.others`).

## 5. Planning : phases communes et lots par équipement (choix 2)

**Règle retenue pour « propre à un équipement »** : un drapeau `per_equipment` sur `machine_type_phases`, faux par défaut (phase
commune). Les phases d’atelier — fabrication, montage / assemblage, essais d’atelier ou plateforme (FAT) — sont propres à un
équipement ; les études, approvisionnements, travaux de site, mise en service sur site et réception restent communs. Liste standard
(`PER_EQUIPMENT_PHASES`) :

| Type | Phases propres à un équipement |
|---|---|
| EMP | Fabrication structure · Montage mécanique · Installation électrique & automatisme |
| MEMU | Fabrication modules · Assemblage & câblage · Essais plateforme |
| SPUR | Structures & supports · Équipements électriques |
| AUTRE | Réalisation · Essais |
| R&D | aucune (un prototype par projet) |

L’écran « Types de machine » ne montre pas encore le drapeau (édition prévue avec le catalogue, R-186) ; il le conserve quand une
phase garde son nom, et un type créé depuis un autre le copie.

**Génération** (`planStructure`, `instantiateTemplate`) :
- les phases communes viennent du modèle du type principal, dans leur ordre ;
- les lots propres à un équipement forment un bloc, placé à l’endroit de la première phase propre du type principal (à la fin s’il
  n’en a pas) ; dans ce bloc chaque ligne reçoit **les phases propres de son type**, un lot (nœud WBS de niveau 1) par phase,
  marqué de la ligne (`equipment_id` sur le lot et ses activités) et nommé « Fabrication modules — EQ-02 · 3 × MEMU » quand le
  projet a plusieurs lignes ;
- les lignes avancent en parallèle (mêmes créneaux), les lots d’une ligne sont enchaînés fin-début ; la phase commune avant le bloc
  précède le premier lot de chaque ligne, le dernier lot de chaque ligne précède la phase commune suivante ;
- la fenêtre prévue est partagée entre les créneaux (le bloc compte sa ligne la plus longue), le budget également entre les
  activités ;
- **une seule ligne → exactement le plan d’avant R-185** (mêmes lots, activités, dates et liens), les lots propres étant
  seulement marqués EQ-01. Une quantité > 1 ne multiplie pas les lots (une ligne = un lot par phase).
- Si les phases propres du type principal ne se suivent pas, elles sont regroupées au premier emplacement (aucun type standard
  n’est dans ce cas).

L’étape 2 de l’assistant liste les équipements (type, quantité, ajout, retrait ; la première ligne suit le type de l’étape 1),
met en évidence les phases propres à un équipement et compte lots, activités et liens avant la création (`templatePlanShape`).

**ITP à la création** : l’assistant crée toujours le plan ITP unique, du type de la première ligne (systèmes figés, R-057). Le plan
par ligne d’équipement (choix 4) est l’objet de la partie 2 ; rien dans cette partie ne l’empêche.

## 6. Données de démonstration et valeurs affichées

- Chaque projet typé a sa ligne EQ-01 (son type, une machine). **HLT-026** (Harbor Line) devient le projet multi-équipements de
  démonstration : EQ-01 1 × EMP, EQ-02 3 × MEMU (`DEMO_EQUIPMENT_LINES`, `src/server/db/seed/portfolio.ts`). Son type principal
  reste EMP : budget, planning, ITP et valeurs dorées sont inchangés.
- Changements affichés délibérés (R-185) : la ligne d’identité de HLT-026 dans le registre et le sélecteur de projet
  (« HAV004 · DAS 2 · 1 × EMP · 3 × MEMU »), son export du registre, Budget › Profil de coûts (références REX MEMU en plus),
  la recherche du registre (« MEMU » trouve aussi HLT-026). Les tests concernés citent R-185. L’écran Types de machine liste
  toujours les projets par type principal (valeurs du prototype inchangées).
- La seed de production n’a rien de plus que le schéma (et les drapeaux des phases standard).

## 7. Reste pour la partie 2 (et après)

- **ITP par ligne d’équipement** (choix 4) : un `itp_plans` par ligne (systèmes du type de la ligne), migration du plan unique
  vers la ligne EQ-01 ; inspection et réserve portant l’équipement (et l’exemplaire si connu).
- **Réserves / liste de réserves** : équipement sur `punch_items`.
- **Mise en service** : systèmes de mise en service par ligne ; SAT par équipement ou global au choix du chef de projet.
- **Nomenclature (BOM)** : équipement sur chaque ligne de nomenclature (vide = commun).
- **Parc installé** : rattacher chaque machine livrée (`machines`) à sa ligne d’équipement.
- **Coûts** : ventilation par équipement d’après `activities.equipment_id` (lecture seule) ; pas de catégories par équipement.
- **Catalogue (R-186)** : fiche versionnée (`catalogue_version`), options codées, drapeau `per_equipment` éditable par le directeur
  et le responsable ingénierie ; `pub_catalogue_machines`.
- **Arche (R-187, K-10)** : créer un projet avec ses lignes ou ajouter une ligne depuis un besoin (`besoin_ref` de la ligne).
- Retirer `projects.machine_type_code` des écrans au profit du résumé, une fois les lecteurs passés aux lignes.

## 8. Écarts et choix faits sans question

- Carte « Équipement » sur l’écran **Contrat** (à côté du rattachement CAPEX, aussi sans contrat) : c’est la portée de ce que le
  projet fournit ; mêmes droits que le rattachement CAPEX.
- Le sélecteur de projet et l’export du registre montrent le résumé à la place du type (colonne « Type de machine » gardée).
- Modifier les lignes dans l’assistant remet les catégories de l’étape 3 aux catégories de référence (comme un changement de type).
- Les messages d’audit et d’activité donnent la ligne en « 3 × MEMU · libellé » ; le détail (capacité, options, besoin) est dans
  `before` / `after`.


---

# Partie 2 — ITP, réserves, mise en service, nomenclature et parc par ligne d’équipement (étape 3)

Statut : construit sur la branche `r185-part2` le 23 oct. 2026 (étape (3) de l’ordre de construction du § 3 du cadrage ; choix 4
« un plan ITP par ligne d’équipement »). Le catalogue (R-186) et la ventilation des coûts par équipement restent à faire (§ 2.7).

## 2.1 Ce qui change

| Élément | Où | Rôle |
|---|---|---|
| Colonnes | `drizzle/0043_itp_plans_per_equipment.sql` (générée) | `equipment_id` sur `itp_plans`, `punch_items`, `commissioning_systems`, `project_bom_lines`, `machines` ; clé « un plan par projet » remplacée par « un plan par ligne » |
| Reprise | `drizzle/0044_equipment_links_backfill.sql` (personnalisée, après 0043) | rattache les données existantes à leur ligne (§ 2.3) |
| Règles pures | `src/domain/equipment-scope.ts` | ligne principale, choix d’une ligne dans un formulaire, filtre d’URL, regroupement par ligne, règle de retrait d’une ligne |
| ITP | `src/server/dal/itp.ts` (`getItpPlan(code, ligne?)`, `getItpPlans`, `listItpSystems(code, ligne?)`, `ensureEquipmentPlan`, `rebuildEquipmentPlan`, `equipmentPlanInspections`) | un plan par ligne ; inspections numérotées sur tout le projet |
| Écran ITP | page `itp`, `src/features/itpcom/model.ts`, `itp-view.tsx`, `forms.ts`, `add-buttons.tsx`, `actions.ts` | sélecteur « Équipement » (plan), filtre et colonne « Équipement » (réserves), « Ajouter une inspection » sur le plan affiché, ligne demandée par « Ajouter une réserve » |
| Mise en service | `src/server/dal/commissioning.ts`, `commissioning-view.tsx` | systèmes rattachés à une ligne ou communs ; grille groupée par ligne ; « Bloquant A » par ligne |
| Nomenclature | `src/server/dal/bom.ts` (`setBomLineEquipment`), `src/features/bom/*` (`equipment-select.tsx`, `setBomLineEquipmentAction`) | ligne de chaque article : choisie à l’ajout, modifiable dans la liste à plat, filtre `?eq=` et colonne |
| Parc installé | `src/server/dal/fleet.ts` (`registerDeliveredMachines`, `listDeliveryCandidates`), `src/features/aftersales/*` | « Enregistrer les machines livrées » demande la ligne quand le projet en a plusieurs : type de la ligne, configuration telle que construite de ses articles et des articles communs |
| Équipement (Contrat) | `src/server/dal/project-equipment.ts` | ajout d’une ligne → son plan ITP ; changement de type → plan reconstruit s’il est vide ; retrait refusé si le plan a des inspections |
| Assistant | `createWizardProject` (`projects-register.ts`) | un plan par ligne : la ligne principale depuis le modèle (comme avant), les autres depuis leur type |
| Export ITP | `src/server/export/providers/control.ts` | inspections de tous les plans ; colonne « Équipement » (inspections et réserves) quand le projet a plusieurs lignes |
| Traductions | `src/i18n/extra/d9-equipment.json` | libellés et textes de démonstration |

Aucune vue `pub_` n’est modifiée (§ 2.6) ; aucun écran n’est ajouté à `src/config/screens.ts`.

## 2.2 Schéma

- `itp_plans.equipment_id` → `project_equipments` (**cascade** : le plan suit sa ligne). `project_id` reste (vues et lecteurs par
  projet). Clés : `itp_plans_equipment_id_unique` (un plan par ligne) ; index unique partiel `itp_plans_project_without_equipment_idx`
  (au plus un plan sans ligne par projet — projets sans type de machine, donc sans ligne) ; index `itp_plans_project_id_idx`. La
  contrainte `itp_plans_project_id_unique` est supprimée.
- `punch_items.equipment_id`, `commissioning_systems.equipment_id`, `project_bom_lines.equipment_id`, `machines.equipment_id` →
  `project_equipments`, **set null** (null = commun au projet, ou inconnu pour une machine).
- `commissioning_systems` garde l’unicité (projet, nom) : la grille est en lecture seule (Q-5, aucun écran ne crée de système), les
  plans SAT (`sat_plans.system_name`) et « Bloquant A » désignent un système par son nom. Deux lignes du même type nommeront leurs
  systèmes différemment (« Structure — EQ-03 ») le jour où la création de systèmes existera ; passer à (projet, ligne, nom)
  demandera aussi la ligne sur `sat_plans`.

## 2.3 Migrations

- 0043 (générée) : colonnes, clés étrangères, clés du plan.
- 0044 (personnalisée, rejouable : chaque instruction ne remplit qu’un `equipment_id` nul ; SQL non qualifié, PGlite dans `public`,
  serveur dans `keystone` par le migrateur, comme 0042) :
  1. chaque plan ITP existant va à la **ligne principale** de son projet (position la plus basse — EQ-01 après 0042) ; un projet sans
     ligne garde son plan sans ligne ;
  2. une réserve levée par une inspection (`source_inspection_id`) prend la ligne du plan de l’inspection ; les autres restent communes ;
  3. les systèmes de mise en service d’un projet **à une seule ligne** vont à cette ligne ; ceux d’un projet à plusieurs lignes
     restent communs (rien ne dit à quelle ligne ils appartiennent) ;
  4. une machine du parc livrée par un projet va à la première ligne du projet **de son type**, sinon à la ligne principale.
- Les lignes de nomenclature restent communes (null). Une base neuve n’a aucune donnée : la seed écrit elle-même les rattachements.
- Testé par `src/server/db/migration-equipment-links.test.ts` (état d’avant la partie 2 reconstitué, deux passages).

## 2.4 Règles

- **Un plan par ligne** (choix 4). Le plan d’une ligne est créé avec la ligne (assistant, carte « Équipement ») avec les systèmes ITP
  de son type figés (R-057) ; sinon à la première inspection ajoutée sur la ligne (comme avant pour le plan unique). La première
  ligne donnée à un projet qui avait un plan sans ligne reprend ce plan.
- **Numérotation** : les inspections sont numérotées sur **tout le projet** (I-20, I-21… quel que soit le plan) : « I-15 » désigne une
  seule inspection — résultat (`recordItpResult`), NCR de Vigie (`inspection_number`), source d’une réserve.
- **Ligne principale** : `getItpPlan(code)` sans ligne = le plan de la ligne principale, c’est-à-dire le plan d’avant R-185 ; les
  lecteurs sans notion de ligne (KPI « Modèle », badge, export) voient donc les mêmes valeurs pour un projet à une ligne.
- **Changement de type d’une ligne** : son plan est reconstruit (type et systèmes du nouveau type) **s’il n’a aucune inspection** ; sinon
  il garde son type et ses systèmes (ce qui a été instancié reste, R-057).
- **Retrait d’une ligne** (décision) : **refusé tant que son plan a des inspections** (« Cette ligne d’équipement a des inspections
  dans son plan d’inspection ») — supprimer la ligne supprimerait le plan et ses inspections, qui sont des enregistrements qualité ;
  sinon le plan vide part avec la ligne et ses réserves, systèmes de mise en service, articles de nomenclature et machines deviennent
  communs au projet ; l’audit compte ce qui a été détaché (`punchItems`, `commissioningSystems`, `bomLines`, `machines` en plus des
  lots et activités). La dernière ligne reste refusée.
- **Réserves** : la ligne vient du plan de l’inspection source quand la réserve est levée depuis une inspection (`sourceInspection`
  du DAL), sinon de la liste « Équipement » du formulaire (projets à plusieurs lignes ; « Commun au projet » par défaut, ou la ligne
  du filtre affiché) ; une ligne inconnue est refusée.
- **Mise en service — « SAT par équipement ou global »** (décision) : pas de réglage. Le SAT est une étape de chaque système ; le chef
  de projet choisit en rattachant ses systèmes à une ligne (SAT par équipement) ou en les laissant communs (SAT global). L’écran
  groupe la grille par ligne quand le projet en a plusieurs (« EQ-02 · 3 × MEMU », puis « Commun au projet ») ; « Bloquant A » d’un
  système d’une ligne ne compte que les réserves de cette ligne et les communes. « Planifier le SAT » sans grille propose les
  systèmes de tous les plans du projet (chaque nom une fois).
- **Nomenclature** : un article (une ligne par article et projet) appartient à une ligne ou est commun ; choisi à « Ajouter un
  article », modifié dans la liste à plat (liste déroulante, mêmes droits que l’ajout, audit « réf · equipment: common → EQ-02 ») ;
  filtre `?eq=` (une ligne ou `common`).
- **Parc installé** : « Enregistrer les machines livrées » demande la ligne quand le projet en a plusieurs (défaut : la ligne
  principale) ; les machines prennent le **type de la ligne** et la configuration telle que construite des articles de la ligne et des
  articles communs ; `machines.equipment_id` est posé.
- **Affichage** : colonne, filtre, sélecteur et groupes n’apparaissent que si le projet a **plus d’une ligne** (`showsEquipment`) ;
  avec une seule ligne, chaque écran est celui d’avant R-185.

## 2.5 Données de démonstration et valeurs affichées

- Harbor Line (HLT-026) : le plan du prototype, ses réserves levées par inspection et ses six systèmes de mise en service sont sur
  EQ-01 (EMP). EQ-02 (3 × MEMU) reçoit (`DEMO_EQ02`, `src/server/db/seed/execution.ts`) son plan (5 systèmes MEMU), deux inspections
  numérotées après celles du prototype (I-14 passée, I-15 planifiée — FAT au 12 nov., avant la FAT EMP du 20 nov. : le jalon `fat` de
  `pub_jalons_projets` ne change pas), une réserve P-09 (catégorie C : ni badge ITP ni « Bloquant A » ne changent) et un système de
  mise en service « Modules MEMU M1–M3 ». Les machines de la démonstration sont sur la ligne de leur type dans leur projet.
- Valeurs affichées inchangées : plan ITP principal de HLT-026 (13 inspections, KPI « Inspections réussies », « Points d’arrêt à
  venir », « Modèle »), tous les projets à une ligne.
- Changements délibérés (R-185), tests annotés : liste de réserves de HLT-026 (+ P-09 ; « Réserves ouvertes » 6 → 7, « A 0 · B 4 ·
  C 3 », sur l’écran ITP, et « Réserves ouvertes » 6 → 7 sur l’écran Chantier ; une étape « Démarrer » de plus), grille de mise en
  service de HLT-026 (+ 1 système : « Systèmes transférés » 0 / 6 → 0 / 7, « Étapes terminées » 1 / 30 → 1 / 35 ; « Planifier le SAT »
  propose aussi « Modules MEMU M1–M3 »), contexte de « Ajouter une inspection » (« … · EQ-01 · EMP »), sélecteur, colonne et groupes
  « Équipement » sur HLT-026, export ITP de HLT-026 (inspections des deux plans, colonne « Équipement »). La nomenclature de HLT-026
  montre la colonne et le filtre « Équipement » (tous ses articles communs) ; les valeurs dorées (`bom.golden.json`) sont rendues
  sans l’option équipement et ne changent pas. Comptes de la seed (`scripts/db-check.ts`) : `itp_plans` 2, `itp_plan_systems` 11,
  `itp_inspections` 15, `punch_items` 9, `commissioning_systems` 7, `commissioning_steps` 35.
- Une base existante (démonstration déjà semée) reçoit la reprise 0044 mais pas les données de démonstration d’EQ-02 ; ses systèmes de
  mise en service de HLT-026 restent communs (projet à deux lignes).

## 2.6 Vues `pub_`

Aucune vue modifiée. `pub_jalons_projets` lit `itp_plans` par `project_id` (colonne gardée) : le jalon `fat` couvre les inspections
de tous les plans du projet. `pub_parc_machines.type_machine_code` vient déjà du type de la machine. `pub_reserves` n’a pas reçu
`equipement_ref` : l’ajout en fin de vue est simple mais demande une mise à jour de la copie de Matrix et du contrat d’Arche — à
proposer si Arche en a besoin.

## 2.7 Reste

- **Ventilation des coûts par équipement** sur l’écran Budget (d’après `activities.equipment_id`, lecture seule) : non faite.
- Exemplaire (numéro de série) sur l’inspection et la réserve : non fait (le cadrage dit « si connu ») ; la machine du parc porte sa
  ligne.
- Création de systèmes de mise en service par ligne dans Keystone (la grille reste en lecture seule, Q-5) ; unicité (projet, ligne,
  nom) avec la ligne sur `sat_plans` le jour venu.
- `pub_reserves.equipement_ref` si Arche le demande (§ 2.6).
- Catalogue (R-186), Arche (R-187), retrait de `projects.machine_type_code` des écrans : inchangé (§ 7 de la partie 1).


---

# Ventilation des coûts par équipement (R-185, choix 3)

Statut : construit sur la branche `r185-costs` le 24 oct. 2026. Choix 3 validé : le suivi des coûts reste au niveau du projet, avec
une **ventilation par équipement là où les lots du planning la donnent** ; aucune catégorie de coûts par équipement. Lecture seule,
sans migration ni changement de schéma.

## Où

| Élément | Où |
|---|---|
| Règle pure | `src/domain/equipment-costs.ts` (`equipmentCostBreakdown`, `wbsEquipmentOf`), tests `equipment-costs.test.ts` |
| DAL | `getEquipmentCosts` (`src/server/dal/budget.ts`), lu par `getBudgetData` → `BudgetData.equipment` |
| Écran | Budget › Structure & modifications, carte « Budget par équipement » sous « Budget par lot de travaux » (`src/features/budget/equipment-costs-card.tsx`) |
| Traductions | `src/i18n/extra/d9-equipment.json` |
| Tests d’intégration | `src/features/budget/equipment-costs.render.test.ts` |

La carte n’apparaît que si le projet a **plus d’une ligne** (`showsEquipment`) : un projet à une ligne voit l’écran d’avant ; les
valeurs dorées du Budget ne changent pas. Droits : ceux de l’écran Budget (`getProjectContext(code, 'budget')` : chef de projet,
directeur, Finance… ; le client n’a pas l’écran Budget).

## Règle d’attribution

Chaque montant va à **une** ligne d’équipement ou à « Commun au projet » ; rien n’est réparti au prorata.

- **Nœud WBS** : sa ligne (`wbs_nodes.equipment_id`), sinon celle de son ancêtre le plus proche ; aucune → commun.
- **Activité** : sa ligne (`activities.equipment_id`), sinon celle de son nœud WBS.
- **Budget actuel** (initial + modifications approuvées, colonne « Actuel » du tableau « Budget par lot de travaux ») : ligne du nœud du lot ; la
  ligne « Provision pour aléas (non affectée) » est commune.
- **Réel et EAC** d’un lot : ceux de chacune de ses activités vont à la ligne de l’activité ; le stock sorti dans Keystone (SC-5a,
  R-098) à la ligne de l’activité à laquelle il a été sorti (sinon à celle du lot) ; le reste du lot (ses propres chiffres quand il n’a
  pas d’activité, la provision consommée) à la ligne du lot.
- **Valeur acquise** (seulement quand elle est calculée à partir des activités, R-073) : BAC × budget de l’activité × % d’avancement
  / Σ budgets des activités — c’est exactement la valeur acquise du projet à sa date d’état, sommée par ligne.
- **Commandes ouvertes** (engagé des commandes Keystone, R-073) : ligne de l’article dans la nomenclature du projet
  (`project_bom_lines.equipment_id`), sinon ligne de l’activité pour laquelle la commande est passée
  (`purchase_orders.needed_for_activity_id`), sinon commun ; au taux budgétaire du projet comme `getOpenCommitment`.
- Une ligne retirée entre-temps compte comme commune.

**Invariant** (testé) : la ligne Total égale les chiffres que l’écran montre déjà — Total du tableau « Budget par lot de travaux » (actuel = BAC,
réel = AC, EAC), valeur acquise de la tuile Performance, commandes passées (`ordersPlaced`, arrondi à 0,1 k€).

## Ce qui n’est pas ventilé, et pourquoi

- **Catégories de coûts** (main-d’œuvre, matériaux, équipement, sous-traitance, frais, provision) : leurs réels et engagés viennent par
  catégorie (pointages × taux, factures, Sage X3 — R-074), pas par activité ; les ventiler demanderait une clé de répartition
  inventée. Une note le dit sous le tableau.
- **Engagé hors commandes** (engagé saisi des catégories autres que la première catégorie matériaux) : même raison.
- **PV, CPI, SPI, EAC « au CPI » par ligne** : la valeur planifiée vient de l’instantané de la référence (par activité, sans ligne) ;
  ces indices restent au niveau du projet. L’EAC affiché par ligne est l’EAC ascendant des lots (comme le tableau « Budget par lot de travaux »).
- **Valeur acquise d’un projet sans budget d’activités** (séries de la seed) : affichée « — » avec une note.
- **Budget d’un lot dont les activités sont sur des lignes différentes** : le budget reste à la ligne du lot (pas de répartition par
  budget d’activité) ; l’assistant génère des lots dont les activités ont la ligne de leur lot, ce cas ne vient que d’une saisie manuelle.
- Pas d’export : l’export Budget (`src/server/export/providers/budget.ts`) est inchangé.

## Démonstration et valeurs affichées

- Harbor Line (HLT-026) : les lots **1.5 « Crane installation » → EQ-01** (portique EMP) et **1.6 « MEP systems » → EQ-02**
  (3 modules MEMU) sont marqués (`DEMO_EQUIPMENT_LOTS`, `src/server/db/seed/cost.ts`) ; leurs activités héritent de la ligne. Aucun
  montant, lot ni activité n’est ajouté : totaux du projet, EVM, valeurs dorées et constantes D7 inchangés.
- Carte affichée (EN) : EQ-01 · EMP 685 k€ / réel 372 / EAC 690 / VA 186 / commandes 3,70 M€ (grue 250 t, PO-1052) ; EQ-02 · 3 × MEMU
  780 / 296 / 830 / 182 / 246 k€ (PO-1063, PO-1071, PO-1078) ; Commun 3,33 M€ / 2,69 / 3,72 / 2,64 ; Total 4,80 M€ / 3,36 / 5,24 / 3,01
  / 3,95 M€.
- Seul changement affiché : la nouvelle carte sur HLT-026. Une base de démonstration déjà semée ne reçoit pas ces marques (seed
  seulement) : la carte y montre tout en « Commun au projet ».
- Le retrait d’une ligne détache ses lots (`set null`) : leurs coûts redeviennent communs (le nombre de lots détachés est déjà à l’audit).
