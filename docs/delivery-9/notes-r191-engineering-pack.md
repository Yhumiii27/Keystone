# Livraison 9 — lot « pack ingénierie » (R-191, vue `pub_pack_ingenierie`)

Statut : construit sur la branche `r191-engineering-pack` (depuis `22f6b2c`) le 25 oct. 2026, à la demande du responsable produit
(lancement de R-191 le 25 oct. 2026 **avec une liste type provisoire**). Sources : demande d’Arche **K-08** (`REQUESTS.md`, entrée
du 22 oct. 2026 « Vues de suivi des projets pour les jalons CAPEX (R-189, R-191) »), contrat d’Arche (`docs/CONTRATS.md` d’Arche,
§ `pub_pack_ingenierie`), `docs/dig-prodi/ANALYSE-DIG-PRODI.md` (point **C-9** : « Pack Ingénierie > 80 % de complétude », critère
du jalon G2), `docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md`.

## 1. Ce qui change

| Pièce | Où | Rôle |
|---|---|---|
| Table, colonne | `drizzle/0058_engineering_pack.sql` (générée) | `machine_type_pack_families` (liste type : type de machine × famille, poids, minimum attendu, `updated_at`) ; `document_types.pack_family` (famille du pack d’un type de document) ; contraintes de valeurs |
| Reprise | `drizzle/0059_engineering_pack_backfill.sql` (personnalisée) | liste type provisoire sur chaque type de machine existant, correspondance des cinq types de documents ; rejouable, ne touche pas une valeur déjà posée |
| Vue | `drizzle/0060_engineering_pack_share.sql` (personnalisée) | `pub_pack_ingenierie`, contrat K-08 |
| Règles | `src/domain/engineering-pack.ts` (+ `engineering-pack.test.ts`) | familles, libellés, liste provisoire, correspondance, validation, union multi-équipements, formule |
| Lecture | `src/server/dal/engineering-pack.ts` | listes types, pack d’un projet (carte) |
| Écriture | `setMachineTypePack` (`src/server/dal/mtypes.ts`), `setMachineTypePackAction` (`src/features/admin/actions.ts`) | liste type d’un type de machine, audit (message `machineType.pack`, avant / après) |
| Écrans | « Types de machines standard » : carte « Pack ingénierie (liste type) » (`mtype-editor.tsx`) ; « Synthèse ingénierie » : carte « Pack ingénierie · part EPC2i » (`src/features/eng/pack-card.tsx`) | |
| Seeds | `seed/engineering.ts` (`seedMachineTypeAggregate`), `seed/documents.ts` (`seedDocumentTypes`) | données de référence des **deux** seeds (démonstration et production) |
| Contrôles | `src/features/admin/engineering-pack.test.ts`, `src/server/db/migration-engineering-pack.test.ts`, `share-views.test.ts`, `postgres.integration.test.ts`, `scripts/db-check.ts` (aussi `--postgres`), `share-contracts.ts` (`SHARE_VIEW_COLUMNS`, `PACK_VIEW_TYPES`, 21 vues) | |
| Traductions | `src/i18n/extra/d9-engineering-pack.json` | |

## 2. Liste type provisoire et comment la remplacer

**Familles** : la liste fixe des cinq codes du contrat d’Arche, dans cet ordre — `pid` (P&ID), `bom` (nomenclature), `layout`
(implantation / plan de masse machine), `electrique` (schéma électrique et bilan de puissance), `analyse_fonctionnelle`. Liste
**extensible** : un nouveau code s’ajoute à la fin de `PACK_FAMILIES` (`src/domain/engineering-pack.ts`), des deux contraintes
(`machine_type_pack_families_family_check`, `document_types_pack_family_check`, par une nouvelle migration) et de la liste des
familles connues d’Arche (nouvelle demande). Aucune raison forte de les rendre libres n’est apparue : Arche les attend par code.

**Liste type** (`machine_type_pack_families`, une ligne par type de machine et famille, toujours les cinq) :

- **poids** en % entier (0 à 100 ; 0 = la famille n’est pas dans le pack de ce type) ; les poids d’un type totalisent **100 %**
  — refusé sinon, côté serveur (`packStandardError`) ; l’écran affiche le total en direct et n’active « Enregistrer » qu’à 100 % ;
- **minimum attendu** (0 à 99) : nombre de pièces attendues au moins, quoi que contienne l’index.

**Provisoire** (responsable produit, 25 oct. 2026) : les cinq familles à **20 %** et **1** pièce attendue chacune, pour **chaque**
type de machine (EMP, MEMU, SPUR, AUTRE, R&D), en production comme en démonstration. Un nouveau type copie la liste du modèle choisi
(« Vide » : la liste provisoire).

**Remplacer la liste** quand le responsable produit fournira la vraie (C-9) : sur l’écran « Types de machines standard », carte
« Pack ingénierie (liste type) » de chaque type — poids et minimum par famille, puis « Enregistrer ». Le changement vaut tout de
suite pour tous les projets du type (le pack est mesuré, pas recopié dans le projet) ; il est tracé au journal d’audit (zone
Paramètres) et fait avancer `maj_le` de la vue. Pour une liste très différente (nouvelles familles, pièces nommées), voir § 8.

## 3. Correspondance des pièces du projet aux familles

**Source retenue : l’index Codex des documents du projet** (`documents`), par le **type de document** : une colonne Keystone
`document_types.pack_family` (nulle = hors pack) classe les types de Codex. Correspondance provisoire (`PACK_DOCUMENT_TYPES`) :

| Type Codex | Famille |
|---|---|
| `PID` (P&ID) | `pid` |
| `BOM` (nomenclature) | `bom` |
| `GA` (plan d’ensemble) | `layout` |
| `SCH` (schémas électriques) | `electrique` |
| `FDS` (spécification / analyse fonctionnelle) | `analyse_fonctionnelle` |

- **attendues** d’une famille = documents du projet de cette famille, **hors obsolètes** (retirés), et **au moins le minimum** de la
  liste type ;
- **validées** = ceux au statut **Diffusé** (BPE : le circuit d’approbation est complet ; c’est le « validé » de C-9). Brouillon,
  Gelé et Diffusion proposée ne comptent pas encore.

Pourquoi l’index Codex et pas les livrables client (`deliverables`, types « Drawings », « Calculation notes »…) : le pack
ingénierie est fait des documents d’études des disciplines (P&ID, nomenclatures, schémas, analyses), qui sont des fiches Codex
indexées par Keystone avec leur statut de diffusion ; les livrables client sont la liste contractuelle remise au client (PV,
notes de calcul, certificats), sans lien avec ces familles. La colonne est sur le type plutôt que sur chaque document : la
correspondance est une règle (un P&ID est toujours un P&ID) et un document synchronisé depuis Codex la reçoit sans saisie. Les
listes techniques `LST` (instruments, moteurs, E/S, câbles) restent hors pack : le type est générique (le bilan de puissance n’a
pas de type Codex dédié aujourd’hui).

**Plusieurs équipements (R-185)** : les familles du projet sont l’**union** de celles (poids > 0) des types de ses lignes
d’équipement ; le poids d’une famille est celui du **type de la ligne principale** (la première), sinon de la première ligne dont
le type la pèse ; le minimum est le plus grand parmi ces types. Le % est renormalisé sur la somme des poids retenus (elle peut
dépasser 100 quand une famille vient d’un type secondaire). Projet sans ligne : son type de machine. Projet sans type de machine :
pas de pack (pas de carte, pas de ligne dans la vue).

## 4. Formule du % de complétude

`packCompleteness` (`src/domain/engineering-pack.ts`), la même dans la vue :

**% = Σ poids × validées / attendues ÷ Σ poids**, sur les familles du projet **qui ont au moins une pièce attendue**, × 100, arrondi
au dixième ; **0** quand rien n’est attendu.

- Avec le minimum provisoire de 1, une famille sans aucun document compte **0 %** dans la moyenne : le pack se mesure contre la
  liste type, pas contre ce qui se trouve indexé.
- Une famille de minimum 0 sans document est **écartée** et le % renormalisé sur les autres (choix pour une famille « si
  applicable »).
- Cible G2 : **strictement au-dessus de 80 %** (`PACK_TARGET_PCT`), affichée sur la carte (« Cible atteinte » / « Sous la cible »).

## 5. Carte « Pack ingénierie · part EPC2i » (Synthèse ingénierie)

Écran « Synthèse ingénierie » (`/projects/<code>/engineering`), juste sous la rangée d’indicateurs ; sur un projet sans registre
ingénierie (NDC-031), au-dessus de l’état vide (ses documents comptent quand même). Elle montre le % pondéré, la cible G2 > 80 %
et l’état, la barre de progression, puis par famille : libellé, barre, validées / attendues, poids, et les documents comptés
(« BOM-MEC-026 rév. D · Nomenclature mécanique · Gelé ») ou « Aucun document indexé ». Lecture seule ; mêmes lecteurs que l’écran
(directeur, chef de projet, responsable ingénierie, qualité ; les autres rôles en consultation hors espace ; client refusé).

## 6. Vue `pub_pack_ingenierie` (contrat K-08)

Une ligne par projet et famille de son pack, colonnes dans l’ordre du contrat :

| Colonne | Type | Contenu |
|---|---|---|
| `projet_code` | text | `projects.code` |
| `famille` | text | `pid`, `bom`, `layout`, `electrique`, `analyse_fonctionnelle` |
| `attendues` | integer | § 3 |
| `validees` | integer | § 3 |
| `poids` | numeric | poids de la famille (% entier) |
| `pct_pondere` | numeric | § 4, même valeur sur chaque ligne du projet |
| `maj_le` | timestamptz | le plus récent du projet, de ses lignes d’équipement, des listes types en jeu et de ses documents du pack |

`WITH (security_barrier)`, noms non qualifiés (`public` sur PGlite, `keystone` sur le serveur commun), `COMMENT ON VIEW` nommant le
lecteur `arche_app` ; enregistrée dans `share-contracts.ts` (colonnes et types, 21 vues), contrôlée par `db-check` (aussi
`--postgres`) et les tests. Les droits sont ceux de Matrix (`partage/90-droits.sql`). Pas d’index `maj_le` : la colonne est un
maximum calculé sur plusieurs tables (une lecture incrémentale ne peut pas l’indexer) et la vue est petite (5 lignes par projet).
Un document ou une ligne d’équipement **supprimés** ne font avancer `maj_le` que par la date du projet.

**Valeurs de la démonstration** (sur la liste provisoire) :

| Projet | pid | bom | layout | electrique | analyse_fonctionnelle | % |
|---|---|---|---|---|---|---|
| HLT-026 (EMP + 3 × MEMU) | 1/1 (PID-HLT-026 Diffusé) | 0/2 (BOM-MEC Gelé, BOM-ELE Brouillon) | 1/1 (GA-HLT-026 Diffusé) | 0/1 (SCH-ELE Brouillon) | 0/1 (FDS-HLT-026 Gelé) | **40,0** |
| NDC-031 | 1/1 (PID-NDC-031 Diffusé) | 0/1 | 0/1 | 0/1 | 0/1 | **20,0** |
| ERP-202, MSR-012, RCF-019, WSA-044 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0,0 |

Les documents de démonstration étaient déjà classés par leur type : aucun document ajouté, aucune valeur affichée existante ne
change (les tests « golden » restent identiques ; seules nouveautés : la carte et la vue).

## 7. Droits

- **Liste type** : mêmes droits que le reste de l’éditeur des types de machines (`editor('mtypes')`, l’espace de l’écran :
  directeur, chef de projet, responsable ingénierie, qualité) ; les autres rôles la lisent (champs en lecture seule) et le serveur
  les refuse (« Les types de machines sont en lecture seule pour vous »). Validation des entrées côté serveur (familles connues,
  entiers, total 100 %), écriture dans une transaction, audit, `revalidatePath('/', 'layout')`.
- **Carte** : lecture seule, droits de l’écran « Synthèse ingénierie ».
- **Vue** : lecteur `arche_app` (droit posé par Matrix).

## 8. Décisions prises sans demander

1. **Source = index Codex par type de document**, pas les livrables client ni un champ par document (§ 3).
2. **Correspondance sur le type** (`document_types.pack_family`), colonne propre à Keystone sur le miroir des types Codex (Codex
   n’envoie pas les types : ils sont des données de référence des seeds) ; GA vaut layout, FDS vaut analyse fonctionnelle ; les
   listes `LST` hors pack.
3. **Validée = Diffusée (BPE)** ; Gelé ne suffit pas (pas encore approuvé) ; obsolète = ni attendue ni validée.
4. **Minimum attendu par famille** (provisoire 1) plutôt qu’une simple renormalisation sur ce qui existe : une famille vide pèse 0 %.
5. **Les cinq lignes toujours présentes** par type (poids 0 = hors pack), total imposé à 100 % côté serveur (contrairement à
   l’échéancier de paiement, simple avertissement).
6. **Multi-équipements** : union, poids du type principal d’abord, renormalisation (§ 3).
7. **Arrondi au dixième** ; 0 quand rien n’est attendu (plutôt qu’une valeur nulle : le contrat est numérique) ; cible strictement
   > 80 %.
8. **Pas de pièces nommées** dans la liste type (nombre minimum seulement) : la liste réelle de C-9 dira s’il faut nommer les
   pièces attendues (par exemple « P&ID machine », « bilan de puissance ») — alors une table des pièces attendues par type, rapprochées
   des documents par type et sous-type Codex.

## 9. Ce qui reste

- **Liste type réelle (CDC C-9)** : poids et pièces par type d’investissement à fournir par le responsable produit ; saisie sur
  l’écran (§ 2), ou nouvelle migration de données si elle est livrée en masse. Si elle introduit des pièces nommées ou de nouvelles
  familles : § 8 point 8 et § 2.
- **Types de documents Codex dédiés** (layout / plan de masse machine, bilan de puissance, analyse fonctionnelle) : quand Codex les
  créera, les rattacher à leur famille (`pack_family`) par une migration de données.
- **Copie dans Matrix** : `partage/30-keystone.sql` doit reprendre `pub_pack_ingenierie` (`drizzle/0060_engineering_pack_share.sql`,
  qualifiée `keystone.`) et `partage/90-droits.sql` donner la lecture à `arche_app` ; prérequis : `machine_type_pack_families`,
  `document_types.pack_family` (0058). Demande à déposer dans le `REQUESTS.md` de Matrix après le « validé » du responsable produit.
- **Arche** : passer l’entrée K-08 de `REQUESTS.md` à « fait » et la page du reste à développer (non modifiées par ce lot, à la
  demande).
