# Livraison 9 — lot « Suites des lots de suivi » (S-29 à S-32)

Statut : construit sur la branche `s-followup2` (depuis `84a5ac4`) le 5 nov. 2026, d’après les réponses du responsable produit du
même jour (`docs/DECISIONS.md` § « Suites des lots de suivi (réponses du 05/11/2026) »). **Aucune migration** (le seuil S-31 est
une ligne de `app_settings`). Aucune nouvelle dépendance.

| Question | Réponse | État |
|---|---|---|
| S-29 | Le code « Équipement » prend la ligne du lot quand l’activité n’en a pas, comme le filtre du Gantt (S-08) | **fait** (§ 1) |
| S-30 | Une ligne dans les alertes de la Vue d’ensemble pour un planning fournisseur en glissement | **fait** (§ 2) |
| S-31 | Seuil du glissement fournisseur réglable dans Paramètres (défaut 5 jours ouvrés) | **fait** (§ 3) |
| S-32 | Colonne « Qualité du planning » aussi dans « Mes projets » | **fait** (§ 4) |

## 1. S-29 — code d’activité « Équipement » hérité du lot

- **Une seule règle** : `activityLineOf(own, wbsCode, packages)` (`src/domain/equipment-scope.ts`) — la ligne propre de l’activité
  (`activities.equipment_id`), sinon celle de son lot de travaux (nœud WBS de niveau 1, `wbs_nodes.equipment_id` ; code du lot ou
  code du lot suivi d’un point), sinon commune au projet.
- **Lecture** : `getActivityCodes` (`src/server/dal/activity-codes.ts`) l’applique pour le type dérivé « Équipement » ; le Plan
  (filtre `?code=equipment~…`, regroupement, export Excel) et le Gantt interactif (listes de codes) suivent donc la même règle.
  `getGanttNetwork` (`src/server/dal/gantt.ts`) ne calcule plus la ligne de son côté : `GanttActivity.equipment` (filtre
  `?equipment=` de S-08) lit la valeur du code — la règle n’existe plus qu’à un endroit.
- **Fiche activité** : `getActivityCodes` rend aussi `inheritedEquipment` (activité → ligne héritée). La liste « Équipement » de la
  section « Codes d’activité » affiche alors « Héritée du lot · EQ-02 » sur l’option vide (en lecture : le même texte) ; choisir une
  ligne écrit la ligne propre de l’activité (audité, inchangé), revenir à l’option vide la rend au lot.
- Tests : `src/domain/equipment-scope.test.ts` (ligne propre, ligne du lot, préfixe sans point refusé),
  `src/server/dal/supplier-schedules.test.ts` (HLT-026 : activités des lots 1.5 / 1.6 → EQ-01 / EQ-02, héritage signalé, Gantt =
  valeur du code pour chaque activité).

## 2. S-30 — glissement fournisseur dans les alertes du portefeuille

- **Règle** (`src/domain/portfolio-alerts.ts`, règle 8, type `supplier_slip`) : une ligne par projet en exécution dont au moins un
  planning fournisseur surveillé glisse **d’au moins le seuil de Paramètres** (S-31). Titre « Harbor Line — planning fournisseur en
  glissement » ; détail « PO-1078 · fournisseur · +10 jours ouvrés (seuil 5) · activité la plus en retard · n de plus » (le pire
  planning nommé, les autres comptés) ; bouton « Ouvrir la commande » vers les Commandes d’achat du projet, tiroir de la commande
  ouvert (`?po=`). Icône camion.
- **Rang** : après les jalons en retard, avant la prévision Monte-Carlo (R-208) ; entre deux projets, le plus grand glissement
  d’abord. La liste reste plafonnée à 8 alertes (`maxAlerts`), les pires d’abord.
- **Données** (`src/server/dal/portfolio-alerts.ts`) : `supplierSlipsOf(codes, date)` (`src/server/dal/supplier-slip-notices.ts`) —
  la même prévision que l’alerte quotidienne S-27 et que le tiroir de la commande (`supplierForecast`, plannings non annulés et pas
  entièrement terminés), mise en commun avec la tâche quotidienne (`slipsOfNetwork`). Seuls les projets ayant un planning
  fournisseur sont lus. Le cache des alertes (`versionedRead`) est inchangé.
- **Lien de l’alerte** : `PortfolioAlert.target.params` (nouveau, facultatif) et `alertTargetHref` (même module) servent à la Vue
  d’ensemble et au widget « Alertes » des tableaux de bord.
- **Pas de double notification** : les alertes d’indicateurs notifiées (`runIndicatorAlerts`, `src/server/dal/event-notices.ts`)
  laissent de côté `supplier_slip` — le glissement est déjà signalé chaque matin par S-27 à l’acheteur et aux responsables, une fois
  par palier.
- Tests : `src/domain/portfolio-alerts.test.ts` (texte EN / FR, seuil, rang, lien), `src/server/dal/supplier-slip-threshold.test.ts`
  (HLT-026 / PO-1078 : ligne au seuil, lien `/projects/HLT-026/orders?po=PO-1078`, disparition au-dessus du seuil).

## 3. S-31 — seuil du glissement fournisseur dans Paramètres

- Règles pures (`src/domain/supplier-slip-alerts.ts`) : `SUPPLIER_SLIP_ALERT_DAYS` (5) devient le défaut ; bornes **1 à 60 jours
  ouvrés entiers** (`parseSupplierSlipDays`, `usableSupplierSlipDays` : ligne absente ou invalide → 5).
- Stockage : `app_settings` « `purchasing.supplierSlip` » = `{ days }` (`APP_SETTING_SUPPLIER_SLIP`, `src/server/db/codes.ts`), lu par
  `src/server/dal/supplier-slip-threshold.ts`.
- Écriture : `setSupplierSlipDays` (`src/server/dal/settings.ts`) — **directrice de portefeuille seule** (A-14), une transaction,
  audit « Supplier schedule slip threshold » avec avant / après, fil d’activité ; « Réinitialiser » remet 5 (audit de la remise à
  zéro avec la valeur d’avant). Server Function `setSupplierSlipDaysAction` (`src/features/admin/actions.ts`).
- Écran : carte **« Glissement des plannings fournisseurs »** de Paramètres, sous « Dérive prévue » : un champ « Alerte à partir de
  (jours ouvrés) », enregistré à la sortie du champ / Entrée, défaut rappelé dessous ; lecture seule pour les autres rôles.
- Lecteurs : la tâche quotidienne S-27 (`runSupplierSlipAlerts` : seuil **et** pas des paliers) et les alertes du portefeuille S-30.
- Tests : `src/domain/supplier-slip-alerts.test.ts` (saisie, défaut, autre pas), `src/server/dal/supplier-slip-threshold.test.ts`
  (droits pour chaque persona, bornes, message français, même valeur sans écriture, audit et fil, remise à zéro, tâche quotidienne et
  ligne du portefeuille qui suivent le seuil), `src/features/admin/render.test.ts` (champ en lecture seule).

## 4. S-32 — « Qualité du planning » dans « Mes projets »

- Page `src/app/(app)/my/projects/page.tsx` : `scheduleQualitySummaries` (S-23) pour les **seuls projets de la personne** encore
  « vivants » (`isLiveRow`, la règle de la colonne du registre) ; **rien sur le mur de repli** (« tout le portefeuille », personne
  sans projet) — ce ne sont pas ses projets.
- Même cellule et même lien que le registre : `qualityCell` (`src/features/projects/register-model.ts`, maintenant exporté) et
  `QualityCell` (`register-cells.tsx`, prend désormais la cellule plutôt que la ligne) — « Non conforme · n », infobulle « Contrôles
  DCMA non conformes · n / m applicables · #2, #5… », lien vers le Planning du projet si la personne voit cet écran.
- Carte (`src/features/portfolio/my-projects.tsx`) : une ligne « Qualité du planning » au-dessus du pied. Pour que la cellule garde
  son propre lien, la carte n’est plus un grand lien : le nom du projet est le lien vers le Plan, **étiré sur toute la carte**
  (`::after`), la cellule passant au-dessus (`portfolio.module.css`) — la carte reste cliquable partout, sans lien imbriqué.
- Tests : `src/features/portfolio/my-projects-quality.test.ts` (chef de projet : cellules de ses projets, lien, pas de lien imbriqué,
  français ; chaque persona : lien selon `canSee(…, 'schedule')`, aucune cellule sur le mur de repli, client refusé).

## 5. Décisions prises sans demander (faciles à changer)

1. **S-29** : la fiche activité montre la ligne héritée (« Héritée du lot · EQ-02 ») sans l’écrire sur l’activité ; l’export Excel et
   le regroupement du Plan comptent l’activité dans la ligne de son lot.
2. **S-30** : **une ligne par projet** (le pire planning nommé, les autres comptés), rang **après les jalons en retard et avant la
   prévision Monte-Carlo** ; avec le plafond de 8 alertes, un portefeuille déjà chargé (c’est le cas du jeu de démonstration) peut
   ne pas l’afficher — la cloche S-27 continue de prévenir l’acheteur et le chef de projet. Pas de notification « alerte
   d’indicateur » en plus pour ce type (pas de doublon avec S-27 ; la direction n’est donc pas notifiée d’un glissement fournisseur,
   comme dans S-27).
3. **S-31** : bornes 1–60 jours ouvrés entiers ; le seuil est aussi **le pas des paliers** de S-27 (5, 10, 15… avec 5 ; 8, 16, 24…
   avec 8). Les paliers déjà notés gardent leur numéro : après un changement de seuil, un palier de même numéro déjà signalé ne
   relance rien ; un planning repassé sous le nouveau seuil efface ses paliers comme avant.
4. **S-32** : la ligne n’apparaît que sur les projets de la personne (pas sur le mur de repli) ; la carte devient un « lien étiré »
   plutôt qu’un grand lien.

## 6. Ce qui reste

- **S-29, S-30, S-31, S-32 : faits** (vérifiés sur la branche : `npm run typecheck`, `npm run lint`, suite complète, build de
  production).
- R-204 (§ 5 de ses notes) : le type « Équipement » est maintenant aligné sur le filtre du Gantt.

## 7. Questions ouvertes

1. S-30 : faut-il relever le plafond de 8 alertes de la Vue d’ensemble (ou y réserver une place au glissement fournisseur) ?
2. S-30 : la direction doit-elle aussi être notifiée d’un glissement fournisseur (aujourd’hui : acheteur et responsables du
   projet seulement) ?

## 8. Fichiers partagés touchés

`src/domain/equipment-scope.ts` (+ test), `src/domain/portfolio-alerts.ts` (+ test), `src/domain/supplier-slip-alerts.ts` (+ test),
`src/server/db/codes.ts`, `src/server/dal/activity-codes.ts`, `src/server/dal/gantt.ts`, `src/server/dal/settings.ts`,
`src/server/dal/portfolio-alerts.ts`, `src/server/dal/supplier-slip-notices.ts`, `src/server/dal/event-notices.ts`,
`src/server/dal/supplier-schedules.test.ts`, `src/features/activity-codes/code-controls.tsx`,
`src/app/(app)/projects/[code]/plan/page.tsx`, `src/features/admin/{actions.ts,model.ts,settings-view.tsx,render.test.ts}`,
`src/features/portfolio/{overview.tsx,view.tsx,my-projects.tsx,portfolio.module.css}`, `src/features/dashboards/widget-body.tsx`,
`src/features/projects/{register.tsx,register-cells.tsx,register-model.ts}`, `src/app/(app)/my/projects/page.tsx`,
`src/i18n/extra/index.ts`. Nouveaux : `src/server/dal/supplier-slip-threshold.ts` (+ test),
`src/features/portfolio/my-projects-quality.test.ts`, `src/i18n/extra/d9-s-followup2.json`.
