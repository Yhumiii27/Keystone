# Cadrage — projets multi-équipements (R-185) et catalogue machines (R-186)

> 23 oct. 2026. Décisions du responsable produit du même jour : **AC-4 oui** — le catalogue machines est un module de
> Keystone, construit à partir des types de machine ; **AC-5 oui** — un besoin de plusieurs machines devient **un projet
> EPC2i à plusieurs équipements**. CLAUDE.md demande de cadrer l’approche multi-équipements avec le responsable produit
> **avant** de construire : ce document propose le modèle et les choix par défaut (§ 3), à valider (§ 4). Demandes liées :
> `REQUESTS.md` (Arche K-01, K-02, K-03, K-10), `docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md`.

## 1. Aujourd’hui

Un projet porte **un seul** `projects.machine_type_code`. Il en découle, à la création (assistant, `src/domain/project-template.ts`) :
phases et lots du planning (`machine_type_phases`), catégories de coûts et budget de référence (`machine_type_cost_categories`,
références REX), systèmes du plan ITP (`machine_type_itp_systems` → `itp_plans` / `itp_plan_systems`, un plan par projet).
La mise en service (`commissioning_systems`), la nomenclature et les réserves ne savent pas à quel équipement elles se
rattachent. Le parc installé (`machines`) a déjà **une ligne par machine livrée**, avec son propre type. 14 fichiers de code
lisent le type de machine du projet.

## 2. Catalogue machines (R-186, AC-4)

- **Fiche catalogue** = un type de machine (EMP, MEMU, SPUR…) enrichi, **versionnée** (un besoin d’Arche garde la version
  choisie) : variante, libellé, description, options (code, libellé, prix indicatif), capacité nominale et unité, prix
  indicatif (classe E50), délai type (semaines), budget de référence (déjà là), plan ITP type (déjà là), statut
  `brouillon` → `publié` → `retiré`.
- **Qui** : le directeur et le responsable ingénierie, dans l’écran « Types de machine standard » existant, étendu ; publier
  une nouvelle version fige la précédente.
- **Publication** : vue `pub_catalogue_machines` (contrat d’Arche K-01, droits déjà prévus par Matrix).
- Le standard complet par type (R-053 : WBS, durées, livrables, points ITP) reste à fournir ; le catalogue n’en dépend pas
  pour démarrer.

## 3. Projet à plusieurs équipements (R-185, AC-5) — proposition

| Sujet | Proposition par défaut |
|---|---|
| **Équipements du projet** | nouvelle liste `project_equipments` : une **ligne par type × quantité** (ex. « 1 × EMP-40T », « 3 × MEMU »), avec repère (`EQ-01`…), fiche catalogue et version, options, capacité visée, besoin d’Arche d’origine (`besoin_ref`). Les **exemplaires** (numéros de série) restent au parc installé, rattachés à leur ligne. |
| **Projets existants** | migration automatique : une ligne par projet, reprise de `machine_type_code`, quantité 1. `projects.machine_type_code` reste comme « type principal » (= première ligne) pour ne rien casser, puis disparaît des écrans. |
| **Planning** | phases **communes** au projet (études, achats, chantier…) ; les lots propres à un équipement (fabrication, FAT, expédition) sont **générés par ligne** depuis le modèle de son type et marqués de leur équipement. |
| **ITP et réserves** | un plan ITP **par ligne d’équipement** (systèmes du type) ; inspection et réserve portent l’équipement (et l’exemplaire si connu). |
| **Mise en service** | systèmes de mise en service par ligne d’équipement ; SAT par équipement ou global (au choix du chef de projet). |
| **Nomenclature (BOM)** | chaque ligne de nomenclature peut porter son équipement (vide = commun). |
| **Coûts et budget** | budget de référence = somme des lignes (budget du type × quantité) ; **suivi des coûts au niveau du projet** comme aujourd’hui, avec une ventilation par équipement là où les lots du planning la donnent (pas de second niveau de catégories de coûts au départ). |
| **Commun au projet** | contrat, facturation, avenants, équipe, documents, risques, réunions, client, CAPEX d’origine. |
| **Arche (K-10)** | à la commande d’un besoin : créer le projet avec ses lignes, **ou** ajouter une ligne à un projet existant (choix proposé au directeur dans la corbeille « Besoins des filiales »). |
| **Assistant de création** | une ou plusieurs lignes au lieu d’un type unique. |

Ordre de construction proposé : (1) liste des équipements + migration des projets existants + affichage ; (2) assistant et
génération du planning par ligne ; (3) ITP, réserves, mise en service, BOM par équipement ; (4) catalogue publié (R-186) ;
(5) corbeille des besoins d’Arche et création à la commande (R-187, K-10) ; classe d’estimation (R-188) en parallèle.

## 4. Points à valider par le responsable produit

1. Ligne = **type × quantité** (recommandé), ou une ligne par exemplaire ?
2. Planning : phases communes + lots par équipement (recommandé), ou un planning complet dupliqué par équipement ?
3. Coûts : suivi au niveau du projet avec ventilation par lots (recommandé), ou catégories de coûts par équipement ?
4. ITP : un plan par ligne d’équipement (recommandé), ou un plan unique avec un champ équipement ?
5. Catalogue : éditable par le directeur et le responsable ingénierie (recommandé) — d’autres rôles ?
