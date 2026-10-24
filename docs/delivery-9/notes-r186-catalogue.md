# Livraison 9 — lot « catalogue machines publié aux filiales » (R-186)

Statut : construit sur la branche `r186-catalogue` (depuis `645886d`, « Remaining work: R-185 done ») le 24 oct. 2026, d’après le
cadrage `docs/delivery-9/cadrage-r185-r186.md` § 2 (choix 5 validé le 23 oct. 2026 : le catalogue est tenu par le **directeur** et
le **responsable ingénierie**), la décision AC-4 (le catalogue est un module de Keystone construit à partir des types de machine) et
le contrat **K-01** de la demande d’Arche (`REQUESTS.md`, entrée « Catalogue machines et réponses aux besoins des filiales »).

## 1. Ce qui change

| Élément | Où | Rôle |
|---|---|---|
| Table et colonne | `drizzle/0045_machine_catalogue.sql` (générée) | table `machine_catalogue_entries` ; `project_equipments.catalogue_code` + clé étrangère composite vers (code, version) |
| Gel et vue | `drizzle/0046_catalogue_share.sql` (personnalisée, comme 0017 et 0038) | déclencheur `machine_catalogue_entries_frozen` ; vue `pub_catalogue_machines` |
| Règles pures | `src/domain/machine-catalogue.ts` | contenu, options, versions, transitions, gel, choix d’une ligne d’équipement, droits |
| DAL | `src/server/dal/machine-catalogue.ts` ; `mtypes.ts` (`setMachineTypePhaseScope`, `phaseFlags`) ; `project-equipment.ts` (`checkCatalogueChoice`) | lecture, création, nouvelle version, brouillon, publication, retrait, abandon |
| Server Functions | `src/features/admin/catalogue-actions.ts` | droits, validation, audit, fil d’activité, `revalidatePath` |
| Écran « Types de machine standard » | `catalogue-section.tsx`, `catalogue-model.ts`, `mtype-editor.tsx`, page `admin/machine-types` | section « Catalogue machines » du type sélectionné ; case « Par équipement » sur les phases standard |
| Projets | carte « Équipement » (Contrat), assistant de création | liste « Fiche catalogue » facultative par ligne |
| Contrat de partage | `src/server/db/share-contracts.ts` (`SHARE_VIEW_COLUMNS`, `CATALOGUE_VIEW_TYPES`, `SHARE_VIEW_COUNT` = 18, `SHARE_MAJ_LE_INDEXES`) | vérifié par `share-views.test.ts`, `catalogue-actions.test.ts`, `postgres.integration.test.ts`, `scripts/db-check.ts` |
| Traductions | `src/i18n/extra/d9-catalogue.json`, messages système `catalogue.*`, `machineType.phaseScope` ; « Version » ajouté à `same-in-french.json` | |

Aucun écran n’est ajouté à `src/config/screens.ts`.

## 2. Schéma

`machine_catalogue_entries` : `id`, `code` (`EMP-40T` ; contrôle `^[A-Z0-9][A-Z0-9-]{1,29}$`), `version` (entier ≥ 1, unique avec le
code), `machine_type_code` (clé étrangère `machine_types` ; le même pour toutes les versions d’un code), `variant`, `label`,
`description` (texte saisi, affiché tel quel), `options` (jsonb, tableau `[{code, libelle, prix_indicatif_keur}]` — la forme du
contrat K-01, publiée telle quelle), `nominal_capacity` + `capacity_unit`, `indicative_price_keur` (classe E50, k€),
`lead_time_weeks`, `status` (`draft` | `published` | `retired`), `published_at`, `retired_at`, horodatages.

Index et contraintes : un seul brouillon et une seule version publiée par code (index uniques partiels), index
`machine_catalogue_entries_updated_at_idx` (K-11), et une version non brouillon a forcément `published_at`, un prix indicatif et un
délai type.

Le budget de référence et le plan ITP type restent sur le type de machine ; la fiche y renvoie par `machine_type_code`.

`project_equipments.catalogue_code` (nouveau) et `catalogue_version` (déjà là depuis R-185) : les deux ou aucun (contrôle), clé
étrangère composite vers (`code`, `version`).

## 3. Versions et statuts — règle retenue

- **Brouillon → publié → retiré.** Une fiche naît en brouillon v1. Seul un brouillon se modifie, se publie ou s’abandonne (supprimé :
  il n’a jamais été partagé).
- **Une version publiée est figée** : son contenu ne change plus jamais. Pour la faire évoluer, « Nouvelle version » copie la
  dernière version dans un brouillon numéroté un au-dessus du plus haut (une seule version brouillon à la fois par code).
- **Publier la version n retire la version publiée du code** (n − 1 ou plus ancienne), dans la même transaction. Le catalogue proposé
  aux filiales ne compte donc qu’**une version publiée par code** (`statut = 'publie'`), la version courante. Les versions retirées
  restent dans `pub_catalogue_machines` avec `statut = 'retire'` : un besoin d’Arche qui a choisi `EMP-40T` v1 retrouve toujours sa
  ligne (une ligne par fiche et version, comme le demande K-01).
- **Retirer** la version publiée sort le code du catalogue proposé (sans version publiée jusqu’à la prochaine publication).
- Publier demande un **prix indicatif** et un **délai type** (les filiales choisissent sur ces deux valeurs) ; la capacité, la variante
  et les options sont facultatives.
- Gel **côté serveur** (`catalogueActionBlocker`, DAL) **et en base** : le déclencheur `machine_catalogue_entries_frozen` refuse toute
  modification d’une version publiée ou retirée autre que publiée → retirée, `retired_at` et `updated_at`, et sa suppression (même
  principe que la piste d’audit, 0017 : preuve de falsification, pas d’inviolabilité vis-à-vis du propriétaire de la table).

## 4. Droits

- **Catalogue** (choix 5) : le directeur et le responsable ingénierie (`canEditCatalogue`, `CATALOGUE_EDITORS`) créent une fiche,
  modifient et publient ou abandonnent un brouillon, créent une nouvelle version et retirent la version publiée. Le chef de projet et
  le responsable qualité, qui voient l’écran, lisent ; les rôles hors de l’espace de travail voient l’écran en lecture seule (« Les
  types de machines sont en lecture seule pour vous »), comme pour le reste de l’écran. Contrôlé dans la Server
  Function puis de nouveau dans le DAL.
- **Case « Par équipement »** des phases standard (R-185, drapeau `machine_type_phases.per_equipment`, jusqu’ici non affiché) : mêmes
  droits que le reste de l’éditeur de type (directeur, chef de projet, responsable ingénierie, qualité). Les projets déjà créés gardent
  leur planning ; le changement vaut pour les projets créés ensuite.
- **Ligne d’équipement** : inchangé (directeur et responsables du projet, R-185).

Audit : chaque écriture du catalogue écrit une ligne d’audit (zone « Settings », `entity_type = 'machine_catalogue_entry'`, message
système `catalogue.created` / `versionCreated` / `draftSaved` / `published` / `publishedSuperseding` / `retired` / `discarded`, avant /
après) ; publication et retrait écrivent aussi un événement du fil d’activité. La case « Par équipement » écrit `machineType.phaseScope`.

## 5. Vue `pub_catalogue_machines` (contrat K-01)

`WITH (security_barrier)`, SQL non qualifié (`public` en PGlite, `keystone` sur le serveur commun), `COMMENT ON VIEW` nommant le
lecteur `arche_app` ; aucun `GRANT` (les droits sont tenus par Matrix, comme pour les vues précédentes). Colonnes, dans l’ordre :

| Colonne | Type | Source |
|---|---|---|
| `code` | text | `code` |
| `version` | integer | `version` |
| `type_code` | text | `machine_type_code` (code stocké du type, comme `pub_parc_machines.type_machine_code`) |
| `type_libelle` | text | libellé du type (`machine_types.name`, sinon son code d’affichage) |
| `variante` | text | `variant` |
| `libelle` | text | `label` |
| `description` | text | `description` |
| `options` | jsonb | `options` (`[{code, libelle, prix_indicatif_keur}]`) |
| `capacite_nominale` | numeric | `nominal_capacity` |
| `unite_capacite` | text | `capacity_unit` |
| `prix_indicatif_keur` | numeric | `indicative_price_keur` (classe E50) |
| `delai_type_semaines` | integer | `lead_time_weeks` |
| `statut` | text | `publie` / `retire` (les brouillons ne sont jamais publiés) |
| `maj_le` | timestamptz | `updated_at` (indexé, K-11) |

`maj_le` bouge à chaque écriture de la ligne (publication, retrait) et quand le libellé du type change (`touchCatalogueOfType`, appelé
par `updateMachineType` : `type_libelle` lit ce libellé). Une lecture incrémentale (`where maj_le > …`) atteint l’index à travers la
vue (testé en PGlite et sur PostgreSQL).

## 6. Projets

- Carte « Équipement » (Contrat) : liste facultative « Fiche catalogue » (« Aucun » par défaut) avec les versions publiées ; la version
  choisie doit être **publiée et du type de la ligne** ; une ligne garde sa version même retirée depuis (proposée à la modification),
  une nouvelle ligne ne peut pas la prendre ; un brouillon n’est jamais proposé. La référence (« EMP-40T v1 ») s’affiche à côté du type
  quand elle est posée.
- Assistant de création : une liste par ligne (versions publiées du type de la ligne) ; changer le type de la ligne efface le choix.
  Contrôlé par la Server Function puis dans la transaction de création.
- Les options de la ligne restent du texte saisi (R-185) : les codes d’options du catalogue pourront les remplacer avec la corbeille des
  besoins (R-187).

## 7. Données de démonstration et valeurs affichées

- Démonstration (`src/server/db/seed/machine-catalogue.ts`) : **EMP-40T** v1 publiée (4 200 k€, 52 semaines, 2 options) et v2
  brouillon (4 350 k€, 48 semaines, 3 options) ; **MEMU-16** v1 publiée ; **SPUR-2X** v1 retirée. La vue publie 3 lignes. Une base de
  démonstration déjà semée reçoit ces fiches une fois (rattrapage tant que le catalogue est vide et qu’aucune écriture du catalogue
  n’est à l’audit).
- Production : rien (le catalogue est créé par le directeur et le responsable ingénierie) ; `production-seed.test.ts` inchangé.
- Aucune ligne d’équipement de démonstration ne pointe le catalogue : les écrans Contrat, registre, budget et planning sont inchangés.
- Changements affichés délibérés : l’écran « Types de machine » montre la case « Par équipement » sur les phases standard et la section
  « Catalogue machines » ; les formulaires de ligne d’équipement (carte et assistant) ont la liste « Fiche catalogue ». Valeurs dorées
  inchangées. Comptes de `scripts/db-check.ts` : 18 vues `pub_` (au lieu de 17).

## 8. Écarts et choix faits sans question

- Statut stocké en anglais (`draft` / `published` / `retired`, comme les autres codes de Keystone), traduit en `publie` / `retire` par
  la vue.
- Le type d’une fiche est fixé à sa création (toutes les versions d’un code sont du même type) ; une fiche se crée sur un type actif.
- Les options sont saisies une par ligne, « CODE | libellé | prix indicatif k€ » (prix facultatif) ; au plus 20.
- `type_code` publie le code stocké du type (`rnd` pour R&D), cohérent avec `pub_parc_machines.type_machine_code`.
- Abandonner un brouillon le supprime (il n’a jamais été partagé ; l’audit garde son contenu dans `before`) ; son numéro peut revenir.

## 9. Reste à faire

- **R-187** : connecteur Arche (lecture de `arche.pub_capex` et `arche.pub_besoins_machines`), corbeille « Besoins des filiales »,
  `pub_reponses_besoins`, création du projet ou ajout d’une ligne à la commande (K-02, K-10) — la ligne gardera la fiche et la version
  choisies par le besoin (`catalogue_code` / `catalogue_version`).
- **R-188** : classe d’estimation (E50 / E30 / E10) et fourchette sur les réponses (K-03) ; le catalogue porte déjà le prix indicatif E50.
- **Matrix** : recopier la définition de `pub_catalogue_machines` dans `partage/30-keystone.sql` et vérifier le droit de lecture
  `arche_app` dans `partage/90-droits.sql` (demande à porter par Matrix ; ce lot ne modifie pas Matrix).
- Mettre à jour l’entrée d’Arche dans `REQUESTS.md` (K-01 fait) et `docs/reste-a-developper.json` à l’intégration du lot.
- Configurateur (règles d’options, chiffrage automatique) : option à valider (cadrage, R-186 « reste une option »).
