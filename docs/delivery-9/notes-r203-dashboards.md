# Livraison 9 — lot « r203-dashboards » (R-203, K-203) : tableaux de bord configurables par l’utilisateur

Cadrage du 1er nov. 2026 (`docs/DECISIONS.md` § « Cadrage des prochains lots », K-203 : « Lancer »). Migration **0070**
(`0070_dashboards.sql`, numéro à recaler à l’intégration). K-203b (Power BI par les vues `pub_`) est traité à part avec
Matrix et la DSI : **hors de ce lot**.

## 1. Ce qui est construit

### Nouvel écran « Mes tableaux de bord » (`/my/dashboards`)

- 62ᵉ écran du registre (`src/config/screens.ts`, id `dashboards`, entrée fixe de la navigation après « Mes approbations »,
  icône `Gauge`). Ouvert à **tous les rôles internes** (`src/config/role-screens.ts`) ; le **client est renvoyé à son
  accueil** (R-042), comme sur tout écran hors de son espace.
- Chaque utilisateur compose **plusieurs tableaux de bord**, les **nomme**, en choisit **un par défaut** (ouvert en premier sur
  l’écran), les **partage**, les **duplique**, les **supprime**. Premier tableau de bord : bouton « Partir des vignettes
  suggérées » (vignettes proposées selon le rôle, `starterLayout`) ou tableau vide.
- Export Excel / CSV de l’écran (fournisseur `src/server/export/providers/dashboards.ts`) : la liste des tableaux de bord et
  les vignettes du tableau affiché avec leur valeur — mêmes droits que l’écran.

### Catalogue de vignettes — indicateurs EXISTANTS uniquement (`src/domain/dashboards.ts`)

| Vignette | Ce qu’elle montre (source) | Filtres | Écran source (droit) |
|---|---|---|---|
| Indicateur du portefeuille | une des 7 tuiles de la Vue d’ensemble : budget total, coût réel, EAC, CPI, SPI, projets à risque, écart d’incertitude (`portfolioKpis`, `uncertaintyKpi`) | zone, portée (tout le portefeuille / mes projets) | Vue d’ensemble |
| Alertes du portefeuille | les « Points d’attention » calculés par règles (R-130) | zone, portée, nombre de lignes | Vue d’ensemble |
| Mon compteur | mes tâches ouvertes, mes tâches en retard (Mon travail), mes approbations en attente (Mes approbations) | — | Mon travail / Mes approbations |
| Mes tâches | mes tâches ouvertes par échéance | projet, période, nombre de lignes | Mon travail |
| Indicateur de projet | avancement, CPI, SPI (carte de Mes projets, `overviewMetrics`), risques ouverts, exposition (registre des risques), réserves ouvertes (liste de réserves), jalons en retard (planning) | projet | Mes projets / Risques / Inspections & réserves / Planning |
| Jalons du projet | les jalons du planning | projet | Planning |
| Principaux risques | risques ouverts par score décroissant | projet, nombre de lignes | Risques |
| Réserves ouvertes | liste de réserves (R-117) | projet, période (échéance), nombre de lignes | Inspections & réserves |
| Budget vs coûts (courbe en S) | le graphique de valeur acquise de l’écran Budget (`EvmSCurve`) | projet | Budget |

Période (date métier `businessToday()`, R-013) : en retard seulement, échéance sous 7 jours, sous 30 jours (retards
compris), tout ce qui est ouvert. Portée : tout le portefeuille, ou seulement les projets dont la personne est dans l’équipe
nommée (`projectAccess(...).member`, R-041). Aucun nouvel indicateur : chaque chiffre est lu par la DAL de l’écran qui le
montre déjà (`src/server/dal/dashboard-data.ts`).

### Droits — le point crucial

- **Une vignette n’affiche une donnée que si le LECTEUR peut la voir.** Les données sont résolues côté serveur pour la personne
  qui regarde la page, jamais pour le propriétaire du tableau de bord :
  1. le rôle du lecteur doit avoir l’écran source de la vignette dans son espace de travail (`canSeeWidget` = `canSee(rôle,
     widgetScreen(vignette))`) — plus strict que les écrans eux-mêmes, que les rôles internes peuvent ouvrir en lecture hors de
     leur espace : un tableau de bord ne devient jamais un contournement de la navigation d’un rôle ;
  2. pour une vignette de projet, le projet doit exister, avoir des données et ne pas être refusé au lecteur
     (`projectAccess`, R-041 / R-042).
  Sinon la vignette revient `denied` (« Non disponible pour votre rôle ») ou `unavailable` (« Pas de données pour ce projet »),
  **sans chiffre, sans nom, sans ligne** ; le titre d’une vignette refusée ne montre même pas le projet.
- **Écriture** : le propriétaire seul modifie son tableau de bord (contrôlé dans la transaction de la DAL ; un destinataire reçoit
  « Seul son propriétaire peut modifier ce tableau de bord », toute autre personne « n’existe plus »). Une disposition
  enregistrée est validée par zod (`layoutSchema` : sortes, paramètres, codes projet, 24 vignettes au plus, identifiants
  uniques) **et** ne peut contenir que des vignettes que le rôle du propriétaire peut voir (`forbiddenWidget`). Une disposition
  relue qui ne valide plus est affichée vide (jamais utilisée telle quelle).
- **Partage** : avec des utilisateurs internes actifs nommés (jamais un client ni un externe, jamais soi-même ; 50 au plus).
  Le destinataire le voit dans « Partagés avec moi », **en lecture seule et avec ses propres droits** ; il peut le **copier**
  dans ses tableaux de bord — seules les vignettes que son rôle peut voir sont copiées (le message le signale).
- Tests : `src/domain/dashboards.test.ts` (droits de chaque persona sur chaque vignette, client sans rien, disposition
  suggérée), `src/features/dashboards/dashboards.test.ts` (Server Functions sur la base de démonstration : création, audit,
  refus, partage directeur → membre sans fuite, copie, défaut, suppression ; **boucle sur `PERSONAS`** : chaque vignette d’un
  tableau partagé est remplie exactement quand le rôle peut la voir).

### Disposition et accessibilité (R-183)

- Grille responsive (`grid auto-fill`, colonnes de 260 px au moins) ; largeur par vignette : petite (1 colonne), moyenne
  (2 colonnes), toute la largeur. Requête de conteneur : sous deux colonnes, une vignette moyenne prend la ligne (pas de
  défilement horizontal sur téléphone).
- Mode « Modifier la disposition » : ajouter (dialogue : vignette, indicateur, projet, portée, zone, période, lignes, largeur),
  filtres d’une vignette, largeur, retirer, **déplacer avant / après au clavier** (boutons nommés « Déplacer avant · <vignette> »),
  et glisser-déposer à la souris en option. Après un déplacement ou un retrait, le **focus revient** sur le même bouton de la
  vignette déplacée (ou sur « Ajouter une vignette ») et une zone `aria-live` annonce la nouvelle position.
- `tests/e2e/09-accessibility.spec.ts` couvre le nouvel écran (directeur EN, membre FR) ; `tests/e2e/d9-dashboards.spec.ts`
  passe axe en mode édition et dans le dialogue d’ajout, le déplacement au clavier, le partage, la lecture par le membre et la
  copie, le renvoi du client.

### Données

- Tables `dashboards` (propriétaire = compte utilisateur, nom, disposition jsonb, défaut — un seul par propriétaire, index
  unique partiel) et `dashboard_shares` (tableau de bord, utilisateur). Migration **0070**. Cascade à la suppression du compte.
- Chaque création, renommage, changement de disposition, défaut, partage, copie, suppression écrit une ligne d’audit (R-168,
  avant / après, dispositions complètes) dans la zone « My dashboards ».

## 2. Décisions prises sans demander

1. **Partage = copie partagée en lecture seule à l’intérieur de Keystone** (pas de lien public) : le destinataire voit le
   tableau de bord vivant du propriétaire, rendu avec ses propres droits, et peut le copier pour le modifier. C’est le plus
   simple et le plus sûr (aucun jeton, aucun accès hors session).
2. **Droit d’une vignette = écran source dans l’espace de travail du rôle** (plus strict que la lecture hors espace des
   écrans). Avancement / CPI / SPI d’un projet suivent la carte de « Mes projets » (tous les rôles internes) ; risques,
   réserves, jalons, courbe en S suivent leur écran (Risques, Inspections & réserves, Planning, Budget).
3. **« Défaut » = tableau ouvert en premier sur « Mes tableaux de bord »** ; l’Accueil de chaque rôle reste inchangé (remplacer
   l’Accueil aurait touché tous les rôles et leurs tests ; facile à ajouter ensuite).
4. **Portée « Mes projets »** des alertes : seules les alertes rattachées à un projet de l’équipe de la personne (les alertes
   transverses — surcharge de personnes — sont écartées dans cette portée).
5. Limites : 20 tableaux de bord par personne, 24 vignettes par tableau, 50 destinataires, 20 lignes par liste.
6. **Pas de ligne dans le fil d’activité** : un tableau de bord est un réglage personnel, pas un événement de projet ou de
   portefeuille ; l’audit garde tout l’historique.
7. Disposition suggérée (premier tableau) : mes compteurs, CPI / SPI / projets à risque et alertes du portefeuille, mes tâches
   à 30 jours, et pour le projet courant : avancement, jalons, principaux risques — filtrée par les droits du rôle.
8. Libellé français de « widget » : **« vignette »**.

## 3. Écarts, reste à faire

- R-203 côté **tableaux de bord configurables : fait** (à marquer « fait » une fois intégré). Le volet **Power BI / Dataverse
  (K-203b) reste à faire** hors de ce lot (vues `pub_`, demande à Matrix et à la DSI) : l’item R-203 entier n’est donc
  « fait » que lorsque K-203b le sera, ou à scinder.
- Pas de vignette « graphique » autre que la courbe en S : les autres graphiques (barres capacité / charge, trésorerie) prennent
  des données d’écran plus lourdes ; à ajouter au catalogue si demandé (même règle de droits).
- Le glisser-déposer est une option souris ; le chemin complet au clavier passe par les boutons.
- Les guides de rôle (`docs/guide/`) ne mentionnent pas encore l’écran.

## 4. Questions pour le propriétaire

1. Le partage en lecture seule avec copie vous convient-il, ou voulez-vous un tableau de bord **modifiable à plusieurs** ?
2. Le tableau de bord par défaut doit-il **remplacer l’Accueil** de la personne ?
3. Quels autres graphiques existants ajouter au catalogue en priorité (capacité / charge, trésorerie, tendances) ?
