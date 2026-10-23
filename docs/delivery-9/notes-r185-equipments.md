# Livraison 9 — lot « projets multi-équipements », partie 1 (R-185)

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
