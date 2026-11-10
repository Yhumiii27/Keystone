# Livraison 9 — lot « P1 + P4 » (R-159, R-162)

Statut : construit sur la branche `d9-p1p4` le 10 nov. 2026, d’après les réponses du responsable produit du 10 nov. 2026
(`docs/DECISIONS.md`, « Décisions en attente de la livraison 9 ») :

| Question | Réponse | Item | État |
|---|---|---|---|
| D9-31 · P1 Relance fournisseurs et inspections usine | « Lancer : inspections, FAT et bons de libération sur les commandes » | R-159 | **fait** (§ 1) |
| D9-34 · P4 Exposition de change et alertes de couverture | « Lancer après la devise par contrat (R-075) » — R-075 est fait | R-162 | **fait** (§ 2) |

Migration **0078** `drizzle/0078_d9_expediting_fx.sql` (générée, aucune modification à la main ; à renuméroter à l’intégration
si un autre lot a pris le numéro) : quatre tables nouvelles, aucune colonne modifiée, aucune vue `pub_` créée ni touchée, aucun
droit accordé. Aucune nouvelle dépendance.

## 1. R-159 — relance, inspections fournisseur, FAT et bons de libération

### Ce qui est construit

Dans le **tiroir d’une commande** (écran « Commandes d’achat » du projet), une section « Relance & inspections fournisseur »
au-dessus du planning fournisseur (R-204) :

- **Avancement de fabrication** : % (entier 0–100) communiqué par le fournisseur, date de la communication (aujourd’hui par
  défaut, jamais dans le futur), note. Une ligne par commande (`po_expediting`).
- **Jalons d’inspection** chez le fournisseur (`po_inspections`, numérotés I-1, I-2… par commande) : nature (revue de plans,
  inspection matière, inspection en cours de fabrication, **FAT**, inspection avant expédition, autre), nom (par défaut la
  nature), lieu (usine du fournisseur par défaut), date prévue, inspecteur (texte : une personne d’EPC2i ou un organisme tiers),
  **résultat** (planifiée, conforme, conforme avec réserves, non conforme), date du résultat (jamais dans le futur), commentaire.
  Une inspection encore planifiée se modifie ou se supprime ; une inspection enregistrée est conservée (enregistrement qualité) :
  on enregistre une contre-inspection.
- **FAT reliée à l’ITP** : une inspection de nature FAT peut être rattachée à un point de stade « FAT » du plan d’inspection et
  d’essais du projet (tous les plans du projet, R-185). L’écran ITP affiche sous le point « FAT fournisseur PO-1071/I-2 ·
  Conforme » (lecteurs internes seulement). **Le résultat n’est pas recopié** dans l’ITP (décision prise sans demander, § 3).
- **NC dans Vigie** : une inspection non conforme sans NC propose « Déclarer la NC dans Vigie » (formulaire de Vigie prérempli :
  projet, commande, fournisseur, titre, et `inspection` = « PO-1071/I-2 »). Quand Vigie renvoie la référence de l’inspection sur
  la NC (`vigie_ncrs.inspection_number`, même mécanisme que l’ITP, Q-6b), son numéro s’affiche avec le lien vers Vigie ; sinon
  le numéro saisi dans le résultat (« Numéro de NC dans Vigie ») est affiché. **Keystone n’écrit rien chez Vigie** : ni table,
  ni fonction (aucune nouvelle demande à Matrix ou à Vigie).
- **Bon de libération** (`po_release_notes`, « PO-1071-RN1 ») : émis par la **qualité** (ou la directrice), avec le périmètre
  libéré (« Toute la commande » par défaut), les réserves et l’inspecteur signataire. Il autorise le fournisseur à expédier.
  - Une commande **exige** un bon dès qu’elle a une inspection planifiée.
  - Émission **refusée** tant qu’une inspection non conforme n’a pas de contre-inspection conforme de même nature après elle, ou
    que la commande a une FAT et qu’aucune n’est conforme ; refusée aussi si un bon est déjà en vigueur.
  - **Retrait** avec motif obligatoire (le bon est gardé, marqué retiré ; le motif est dans l’audit).
- **Livraisons signalées sans bon** : une réception (annoncée ou reçue) d’une commande qui exige un bon, sans bon en vigueur émis
  au plus tard à sa date, est **signalée, jamais bloquée** (défaut prudent demandé) : étiquette « Sans bon de libération » dans la
  liste de l’écran « Livraisons », ligne « Bon de libération : absent » dans son tiroir, et rappel dans la section de la commande.
- **Alerte d’inspection en retard** : chaque matin (tâche « indicator-alerts », avec les glissements fournisseur S-27), une
  inspection **planifiée dont la date est passée** d’une **commande à long délai** (≥ 84 jours entre la date de commande et la
  livraison attendue ; commande ni brouillon, ni annulée, ni entièrement reçue) est notifiée (cloche, type « alerte » ; l’e-mail
  suit les préférences R-036) à l’acheteur de la commande (sinon aux achats) et à la qualité, **une fois par inspection et par
  date prévue** (une inspection replanifiée qui glisse à nouveau est re-signalée). Titre « Inspection fournisseur en retard ·
  PO-1071/I-4 · +2 d », ouvre la commande.
- **Droits** : avancement et inspections — directrice, achats, qualité, **sur tous les projets** ; bon de libération — qualité et
  directrice ; les chefs de projet et les autres rôles internes lisent ; le client n’a pas l’écran. La qualité reçoit l’écran
  « Commandes d’achat » dans son espace, **en lecture seule pour les commandes elles-mêmes** (`qualityReadOnly`, comme la
  logistique pour la nomenclature). Chaque écriture revérifie le droit dans sa transaction (commande verrouillée), écrit l’audit
  (avant / après ; motif du retrait) et le fil d’activité.

### Fichiers

| Pièce | Où |
|---|---|
| Règles pures | `src/domain/expediting.ts` (+ `expediting.test.ts`) |
| Tables | `src/server/db/schema/expediting.ts` (`po_expediting`, `po_inspections`, `po_release_notes`) |
| DAL | `src/server/dal/expediting.ts` (lecture, écrivains, livraisons signalées, FAT fournisseur de l’ITP) |
| Alertes | `src/server/dal/expediting-notices.ts` (`runExpeditingAlerts`), branché dans `src/server/jobs/definitions.ts` |
| Server Functions | `src/features/expediting/actions.ts` |
| Écran | `src/features/expediting/expediting-section.tsx`, `model.ts`, page `projects/[code]/orders` ; Livraisons (`features/deliveries/model.ts`, `deliveries-view.tsx`, page) ; ITP (`server/dal/itp.ts`, `features/itpcom/model.ts`, `itp-view.tsx`) |
| Droits | `src/domain/rights.ts` (`canEditExpediting`, `canIssueRelease`, `qualityReadOnly`), `src/config/role-screens.ts` |
| Tests | `src/server/dal/expediting.test.ts` (droits pour chaque persona, parcours complet, audit, alerte) |

## 2. R-162 — cours de référence, exposition de change, alertes de couverture

### Ce qui est construit

- **Cours de référence** datés (`fx_reference_rates`) dans **Paramètres › « Cours de change de référence »** : devise (autre que
  l’euro), euros par unité, valable à partir d’une date (aujourd’hui par défaut) ; un seul cours par devise et par date ; le cours
  d’un jour est le dernier valable ce jour-là (« En vigueur » affiché). Suppression d’un cours saisi par erreur (l’audit garde ses
  valeurs). **Finance et la directrice** modifient ; Finance reçoit Paramètres dans son espace (le reste de Paramètres reste à la
  directrice, A-14).
- **Seuils des alertes de couverture** dans la même carte (comme S-25) : exposition nette à partir de laquelle une alerte est
  levée (**500 k€** par défaut) et dérive du cours de référence face au cours budgétaire (**5 %** par défaut) ;
  `app_settings` « `finance.fxAlerts` » ; audit avant / après.
- **Exposition d’un projet** (règle pure `projectFxExposure`) : par devise autre que l’euro (R-075 : contrat, commandes et
  factures sont en euros ou dans la devise du projet) —
  - à encaisser = valeur du contrat (base + avenants signés) − factures payées (détail : à facturer, facturé non payé) ;
  - à payer = commandes ouvertes (commandée, partiellement ou entièrement reçue) − factures fournisseur payées de la commande dans
    sa devise ;
  - position nette = à encaisser − à payer, valorisée au **cours budgétaire** du projet et au **cours de référence** ; gain / perte
    du mouvement de cours sur la position ouverte, et dérive en %.
- **Alertes de couverture** : exposition nette au cours de référence ≥ seuil, **ou** |dérive| ≥ seuil sur une position ouverte.
  Affichées dans la carte du projet et la ligne du portefeuille, et notifiées chaque matin (même tâche) à **Finance et aux
  directeurs**, une fois par projet, devise et nature tant qu’elles durent ; redescendues sous le seuil, elles sont effacées et
  une nouvelle passe est re-notifiée. Titre « Exposition de change au-dessus du seuil · HLT-026 · USD · 1530 k€ », ouvre le
  Contrat.
- **Écrans** : carte « Exposition de change » sur l’écran **Contrat** du projet (aussi sans contrat) ; carte « Exposition de change
  du portefeuille » sur **Trésorerie & facturation** (une ligne par projet et devise, lien vers le contrat). Lecteurs : **Finance
  et la directrice** seulement.

### Fichiers

| Pièce | Où |
|---|---|
| Règles pures | `src/domain/fx-exposure.ts` (+ `fx-exposure.test.ts`) |
| Table, réglage | `fx_reference_rates` (`src/server/db/schema/expediting.ts`), `APP_SETTING_FX_ALERTS` (`src/server/db/codes.ts`) |
| DAL | `src/server/dal/fx.ts` |
| Server Functions | `src/features/fx/actions.ts` |
| Écrans | `src/features/fx/fx-settings-card.tsx` (Paramètres), `fx-exposure-card.tsx` (Contrat, Trésorerie) |
| Droits | `src/domain/rights.ts` (`canEditFxRates`, `canSeeFxExposure`), `src/config/role-screens.ts` (Paramètres pour Finance) |
| Tests | `src/server/dal/expediting.test.ts` (droits pour chaque persona, doublon, exposition d’un projet en USD, alertes notifiées une fois puis effacées, audit des seuils) |

## 3. Décisions prises sans demander (faciles à changer)

1. **Qui modifie (P1)** : directrice, achats et qualité, sur **tous les projets** (pas seulement l’équipe nommée), comme la
   logistique sur les expéditions ; le bon de libération est réservé à la **qualité** (et à la directrice), jamais aux achats
   (séparation des rôles). L’inspecteur tiers n’a pas de compte : la qualité saisit son nom.
2. **Qualité et écran Commandes** : l’écran est ajouté à l’espace de la qualité, en lecture seule pour les commandes ; l’étiquette
   « Lecture seule » de l’en-tête s’y affiche donc, alors que la section d’inspection est modifiable.
3. **Bon exigé** dès qu’une inspection est planifiée sur la commande (pas de case « bon exigé » à part).
4. **Signalement, pas blocage** : une réception sans bon reste possible ; elle est signalée (Livraisons, tiroir de la commande).
   Une réception antérieure à l’émission du bon reste signalée (« expédiée sans bon »).
5. **Long délai** = 84 jours (12 semaines) ou plus entre la commande et la livraison attendue (`LONG_LEAD_DAYS`), constante et
   non réglage de Paramètres.
6. **FAT ↔ ITP** : simple rattachement affiché dans les deux sens ; le résultat de la FAT fournisseur **n’est pas recopié** sur le
   point ITP (le point ITP reste enregistré par la qualité / l’ingénierie, R-112).
7. **Contre-inspection** : une non-conformité est levée par une inspection conforme **de même nature** enregistrée après elle.
8. **P4, seuils** : 500 k€ et 5 % ; l’alerte part si **l’un ou l’autre** est franchi (lecture littérale de la demande), la dérive
   seulement sur une position ouverte ; aucun enregistrement de couverture dans Keystone (Finance décide).
9. **P4, lecteurs** : Finance et la directrice seulement (cartes Contrat et Trésorerie) ; les chefs de projet ne voient pas
   l’exposition.
10. **P4, ce qui compte** : commandes « commandée / partiellement reçue / reçue » (pas les brouillons ni celles en approbation) ;
    les factures fournisseur « payées » diminuent la position ; contrat à encaisser = valeur − factures payées. Sans cours de
    référence, la position est valorisée au cours budgétaire, sans dérive.
11. **Données de démonstration** : aucune (pas de projet en devise dans le jeu ; aucune inspection semée).

## 4. Écarts, reste à faire, questions

- **R-159** : fait. Restent possibles (non demandés) : recopie du résultat de la FAT sur le point ITP, seuil « long délai » en
  Paramètres, PDF du bon de libération (dépôt dans Codex).
- **R-162** : fait. Restent possibles : saisie des couvertures (contrats à terme) pour déduire la position couverte ; import
  automatique des cours (BCE) — refusé par défaut (pas de nouvel hôte réseau).
- Questions au responsable produit :
  1. Le bon de libération doit-il **bloquer** la réception (au lieu de la signaler) ?
  2. Faut-il recopier le résultat d’une FAT fournisseur sur le point FAT de l’ITP ?
  3. Les chefs de projet doivent-ils voir l’exposition de change de leur projet ?
  4. Seuils 500 k€ / 5 % et règle « l’un ou l’autre » : à confirmer.

## 5. Vérifications

- `npm run typecheck`, `npm run lint`, `scripts/db-check.ts` : verts. Build de production (`.next-ci`) : vert.
- `npm test` : suite complète lancée ; la machine partagée était saturée (workers tués par manque de mémoire, délais de hooks
  dépassés sur 35 fichiers sans lien avec ce lot). Les deux vrais échecs (index des clés étrangères, page Paramètres) et les trois
  listes de rôles (Finance a Paramètres) ont été corrigés, puis les 40 fichiers en échec ou interrompus ont été relancés : tous
  verts (39 fichiers, 461 tests ; le reste de la suite : 437 fichiers verts au premier passage).
- Tests ajoutés : `src/domain/expediting.test.ts`, `src/domain/fx-exposure.test.ts`, `src/server/dal/expediting.test.ts`.
- Fichiers partagés touchés : `rights.ts`, `role-screens.ts` (qualité → Commandes, Finance → Paramètres), `codes.ts`
  (`D5_SCREEN_ROLES.settings`, `APP_SETTING_FX_ALERTS`), `jobs/definitions.ts`, `itp.ts`, pages Commandes, Livraisons, Contrat,
  Trésorerie, Paramètres, `fk-without-index.json`, `same-in-french.json`, `i18n/extra/index.ts`, trois tests de rôles.
