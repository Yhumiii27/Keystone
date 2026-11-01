# Livraison 9 — lot « Planning multi-niveaux » (R-204)

Statut : construit sur la branche `lotI-multilevel` (depuis `ae3e211`) le 1er nov. 2026, d’après la réponse du cadrage du même jour
(`docs/DECISIONS.md` § « Cadrage des prochains lots ») : **K-204 = « Lancer tout »** (plannings fournisseurs consolidés et codes
d’activité). **Une migration : `0074_multilevel_planning`** (7 tables, rien de modifié dans les tables existantes). Aucune nouvelle
dépendance.

## 1. Codes d’activité

Un dictionnaire par projet pour filtrer et regrouper les activités.

- **Types déduits** (jamais stockés, lecture seule) :
  - **Équipement** — la ligne d’équipement R-185 de l’activité (`activities.equipment_id`), valeurs « EQ-01 · 1 × EMP »… Le
    type n’apparaît que si le projet a des lignes d’équipement. Choisir une valeur dans la fiche de l’activité **écrit la ligne
    d’équipement de l’activité** (audité) : c’est le seul endroit où l’on peut la changer après l’assistant de création.
  - **Lot d’achat** — les commandes d’achat qui ont besoin de l’activité (`purchase_orders.needed_for_activity_id`) et celles dont
    le planning fournisseur est rattaché à l’activité. Une activité peut appartenir à plusieurs lots (A1430 : PO-1078 et
    PO-1082) ; un filtre la trouve dans chacun, un regroupement la range sous le premier.
- **Types stockés** : un type **Site** (un au plus par projet) et des **codes libres** que le chef de projet nomme (zone,
  discipline, sous-traitant…), chacun avec ses valeurs (code court + description) ; **une valeur par type et par activité**.
- **Où** : carte « Codes d’activité » de la vue Structure du **Plan** (dictionnaire : ajouter un type, une valeur, retirer) ; section
  « Codes d’activité » de la **fiche activité** (une liste par type ; les rattachements fournisseurs de l’activité y sont rappelés).
- **Filtrer / regrouper** :
  - **Plan** : `?code=<type>~<valeur>` (valeur `-` = sans valeur) et `?group=<type>` dans l’URL (barre au-dessus des indicateurs,
    paramètres gardés à l’ouverture / fermeture de la fiche). Le filtre garde la WBS (lots sans activité retenue masqués) ; le
    regroupement remplace les lots de travaux par les valeurs du code (cumuls calculés comme pour un lot) et **met le plan en
    lecture seule** (« regroupez par lot de travaux pour modifier »).
  - **Gantt interactif** (R-198) : les mêmes listes au-dessus du diagramme (état local de la vue, pas d’URL) ; regroupement par
    valeur ; chaque groupe se replie.
  - **Export** du Plan (Excel) : une colonne par type de code (codes des valeurs, séparés par des virgules).
- **Droits** : dictionnaire et affectations = chefs de projet du projet et directeur (`canEditStructure`, P-9a) ; les autres
  lisent ; le client est refusé.

## 2. Plannings fournisseurs (sous-réseaux)

- **Lot d’achat = commande d’achat** : un planning fournisseur par commande (`supplier_schedules.po_id` unique). Pas de commande
  annulée.
- **Contenu** : jalons (durée 0) et activités du fournisseur, durée en jours ouvrés (calendrier du projet), **dates engagées** du
  planning du fournisseur (sa référence), liens internes (FS/SS/FF/SF + décalage). Création vide ou **avec les étapes types**
  (Approbation des plans 10 j, Fabrication 40 j, FAT 3 j, Expédition 5 j, Livraison jalon — enchaînées fin-début ; la livraison
  engagée à la date de livraison attendue de la commande). Saisie manuelle (import hors périmètre).
- **Consolidation** (`src/domain/supplier-schedule.ts`, `consolidateNetwork`) : les activités fournisseur deviennent des **nœuds
  ordinaires** du CPM (id « PO-1082/F50 », étiquetés par leur commande), placés après les activités du projet, avec leurs liens et
  leurs **rattachements** au projet : « activité fournisseur → activité du projet » (la livraison pilote la réception / le
  montage) ou « activité du projet → activité fournisseur » (l’approbation des plans par EPC2i pilote la fabrication), toujours
  fin-début + décalage. **Le moteur `src/domain/cpm.ts` n’est pas modifié.** Une activité fournisseur non commencée porte un
  « Début au plus tôt le » sa date de début engagée (le fournisseur ne commence pas avant ce qu’il a promis). Seuls les plannings
  **rattachés** entrent dans le réseau du projet.
- **Qui le lit** : « Replanifier » (`rescheduleProject`, donc aussi le recalcul immédiat du Gantt), le Gantt interactif, la
  simulation Monte-Carlo (R-205 : les durées fournisseur reçoivent la fourchette par défaut −10 % / +25 %, l’empreinte des
  entrées change avec le planning fournisseur). `loadScheduleNetwork(code, q, { suppliers: true })` ; sans l’option, le réseau
  est celui d’avant (qualité du planning R-206, prévision de dérive R-208, simulation « et si », import / export MSPDI).
- **Boucles refusées** sur tout le réseau (projet + tous les plannings fournisseurs) à l’ajout d’un lien ou d’un rattachement,
  avec le chemin de la boucle dans le message ; le Gantt refuse aussi un lien qui fermerait une boucle à travers un fournisseur.
- **Affichage** :
  - **Commandes d’achat**, tiroir de la commande : section « Planning fournisseur » (activités : engagé / prévision / réel / % /
    glissement, logique, rattachements ; formulaires d’ajout, modification, avancement, lien, rattachement).
  - **Plan** : carte « Plannings fournisseurs » (une ligne repliable par commande : dans les temps ou en glissement, fin prévue vs
    engagée, activités pilotées ; lien vers la commande) ; l’export Excel du Plan a une feuille « Plannings fournisseurs ».
  - **Gantt interactif** : bande « Fournisseurs », un groupe repliable par commande rattachée ; barres hachurées en lecture seule
    (ni glisser, ni redimensionner, ni lier : « se modifient sur la commande d’achat »), la barre de référence = les dates
    engagées du fournisseur ; les flèches des rattachements sont tracées.
- **Droits** (`src/domain/rights.ts`) : le planning fournisseur (création, activités, logique, avancement) = **achats** et les
  **chefs de projet** du projet (et le directeur), sur un projet dont ils peuvent modifier les commandes
  (`canEditSupplierSchedule`) ; les **rattachements** = chefs de projet et directeur (`canTieSupplierSchedule`) ; les autres
  lisent ; client refusé. Chaque écriture est auditée (zone « Purchase orders », objet « HLT-026 · PO-1078 », avant / après).

## 3. Suivi de l’avancement fournisseur

- L’acheteur saisit **début réel, fin réelle, % d’avancement** (fin réelle ⇒ 100 % ; 100 % demande la fin réelle ; un % > 0
  demande le début réel ; jamais de date réelle après aujourd’hui — horloge métier).
- **Prévision** à la date d’état du projet (`supplierForecast` : le planning fournisseur seul, sans les rattachements) et
  **glissement** par activité en jours ouvrés contre la fin engagée ; une activité est **en glissement** si sa fin prévue (ou
  réelle) dépasse la fin engagée, ou si elle n’a pas commencé à sa date de début engagée. Signalé dans la section de la commande,
  sur la carte du Plan (étiquette « En glissement · +n j.o. ») et dans l’export.

## 4. Décisions prises sans demander

1. **Lot d’achat = commande d’achat** (pas de nouvel objet « lot d’achat » : Keystone n’en a pas ; un lot regroupant plusieurs
   commandes pourra venir plus tard comme code libre).
2. Les activités fournisseur sont dans **des tables à part**, pas dans `activities` : elles n’entrent ni dans la WBS, ni dans le
   budget / la valeur acquise, ni dans les indicateurs du Plan ; elles n’existent dans le CPM qu’une fois rattachées.
3. Calendrier des activités fournisseur = **calendrier du projet** ; « Début au plus tôt le » = début engagé tant que l’activité
   n’a pas commencé.
4. Rattachements **fin-début uniquement** (avec décalage), dans les deux sens.
5. La **qualité du planning (R-206)** et la **prévision de dérive (R-208)** restent calculées sur les seules activités du projet
   (les 14 contrôles DCMA portent sur le planning du projet) ; le Monte-Carlo, lui, simule le réseau consolidé.
6. Les indicateurs du Plan restent ceux de tout le projet quand un filtre de code est actif.
7. Le Gantt filtre / regroupe dans l’état de la vue (pas dans l’URL) ; le Plan les garde dans l’URL.
8. Les étapes types sont enregistrées en anglais et affichées en français par le dictionnaire (comme les données de démo).

## 5. Ce qui reste

- **Alertes** : le glissement fournisseur n’alimente pas encore les alertes du portefeuille / les notifications (ajout d’une
  règle `supplier_slip` à `src/domain/portfolio-alerts.ts`, à décider : seuil, destinataires).
- **Carte « Qualité du planning »** : pas de filtre par code (non fait : coût de recalcul des 14 contrôles par sous-ensemble).
- **Import** du planning du fournisseur (CSV / MS Project) : hors périmètre.
- **Données de démonstration** : aucun planning fournisseur ni code stocké n’est semé (pour ne pas changer les valeurs des tests
  de référence) ; à ajouter si le responsable produit veut une démonstration toute prête.

R-204 peut être marqué **« fait »** pour les trois points demandés (codes, sous-réseaux consolidés, suivi de l’avancement) ; les
alertes restent une amélioration optionnelle.

## 6. Questions ouvertes

1. Faut-il un **objet « lot d’achat »** regroupant plusieurs commandes (un planning fournisseur par lot plutôt que par
   commande) ?
2. Le glissement fournisseur doit-il **alerter** (qui : acheteur, chef de projet ; à partir de combien de jours ouvrés) ?
3. Les rattachements doivent-ils accepter d’autres types de liens que fin-début ?
4. Faut-il un **planning fournisseur type par type de machine / catégorie d’achat** (au lieu des cinq étapes génériques) ?

## 7. Fichiers

| Pièce | Où |
|---|---|
| Schéma, migration | `src/server/db/schema/multilevel.ts` (exporté par `index.ts`), `drizzle/0074_multilevel_planning.sql` |
| Règles pures | `src/domain/activity-codes.ts`, `src/domain/supplier-schedule.ts`, `src/domain/rights.ts` (`canEditSupplierSchedule`, `canTieSupplierSchedule`), `src/domain/gantt-edit.ts` (`source`, `codes`, refus `supplier`) |
| Lecture / écriture | `src/server/dal/activity-codes.ts`, `src/server/dal/supplier-schedules.ts`, `src/server/dal/schedule-network.ts` (`{ suppliers }`, `networkInput`), `schedule.ts` (Replanifier consolidé), `gantt.ts` (bande Fournisseurs, codes), `risk-analysis.ts` (réseau consolidé) |
| Server Functions | `src/features/activity-codes/actions.ts`, `src/features/supplier-schedules/actions.ts` |
| Écrans | Plan (`plan/page.tsx`, `features/activity-codes/code-controls.tsx`, `features/plan/activity-drawer.tsx` slot `codes`, `features/supplier-schedules/supplier-plan-card.tsx`) ; Commandes (`orders/page.tsx`, `features/orders/order-drawer.tsx` et `orders-view.tsx` slot `supplierSchedule`, `features/supplier-schedules/supplier-schedule-section.tsx`, `model.ts`) ; Gantt (`features/schedule/interactive-gantt.tsx`, `gantt-dialogs.tsx`, `gantt.module.css`) ; `components/app/FormDialog.tsx` + `form-def.ts` (champ `date`) |
| Export | `src/server/export/providers/steering.ts` (colonnes de codes, feuille « Plannings fournisseurs ») |
| Français | `src/i18n/extra/d9-multilevel.json` |
| Tests | `src/domain/supplier-schedule.test.ts` (consolidation, propagation des dates, boucles, règles de lien, validation, prévision et glissements), `src/domain/activity-codes.test.ts` (filtre, regroupement), `src/domain/gantt-edit.test.ts` (activités fournisseur en lecture seule), `src/server/dal/supplier-schedules.test.ts` (HLT-026 : étapes types, Replanifier consolidé, glissement puis rattrapage, boucles, Gantt, corbeille du Plan, codes), `src/features/supplier-schedules/actions.test.ts` (droits par persona, Server Functions) |
