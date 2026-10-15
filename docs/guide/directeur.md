# Guide — Directeur de portefeuille

Profil de démonstration : **Marie Lefebvre**. Lire d’abord le [tronc commun](README.md) (prise en main, droits, applications
sœurs, limites de la bêta, glossaire).

## Ce que voit le directeur

Le directeur voit **les 59 écrans** et a les droits de chef de projet sur **tous** les projets :

- **En haut** : Accueil, Mes projets, Mes tâches, Mes approbations, Documents · Codex.
- **Portefeuille** : Vue d’ensemble, Projets, Planning, Mappemonde des projets, Priorisation, Trésorerie.
- **Projet** : Contrat, Facturation ; Plan — WBS, Planning, Budget et coûts, Heures (Lucca), Provision pour aléas,
  Ressources du projet ; Réunions & CR, Parties prenantes & RACI, Interfaces ; Ingénierie (synthèse et disciplines),
  Validation P&ID, Nomenclature projet ; Registre des risques, Contrôle des modifications, Qualité et livrables,
  Inspections & réserves ; Chantier, Mise en service & transfert ; Tendances et état, REX & clôture.
- **Référentiel technique**, **Achats & stock**, **Garantie & après-vente**, **Ressources** (dont Grilles de taux),
  **Administration** (Paramètres, Types de machines, Registre des types de documents, Activité et intégrations).

## Parcours principaux

### Suivre le portefeuille

1. **Vue d’ensemble** : indicateurs des projets en exécution de la zone choisie, alertes calculées (chemin critique, coûts,
   surcharge, approbations en attente) ; chaque alerte ouvre l’écran concerné.
2. **Projets** : le registre ; colonne Santé selon les seuils des **Paramètres** (« À risque sous » 0,97 par défaut).
3. **Planning du portefeuille**, **Mappemonde**, **Priorisation**, **Trésorerie** (encaissements prévus sur les dates de
   paiement des jalons).

### Créer un projet

1. **Projets › « Nouveau projet »** : nom, client, chef de projet, type de machine, date de début, **ville et pays du site**
   (« Suivant » reste grisé sans lieu).
2. Parcourir les étapes avec « Suivant », puis **« Créer le projet »** : le modèle du type de machine est instancié et le
   projet s’ouvre sur son **Plan**.

### Décider dans « Mes approbations »

Tout ce qui attend une décision du directeur arrive dans **Mes approbations** : changements d’étape forcés, prélèvements sur
la provision pour aléas, étapes « directeur » et « CCB » des demandes de modification, commandes en attente d’approbation,
décisions de documents.

- **Changement d’étape forcé** : un chef de projet a déplacé un projet malgré des livrables manquants ; « Approuver » le
  confirme, « Refuser » (avec un commentaire que le chef de projet verra) le ramène à l’étape précédente.
- **Prélèvement sur la provision** : « Approuver » le valide (il compte alors dans le consommé).

### Demandes de modification et références (R-069)

Les étapes d’une demande de modification sont fixées à sa soumission et se décident **dans l’ordre** :

1. **chef de projet** ;
2. **directeur de portefeuille** ;
3. **client**, seulement si l’impact contractuel n’est pas « Aucun (interne) » ;
4. **comité de contrôle des modifications**, seulement si le montant dépasse le seuil des Paramètres (50 k€ par défaut) ; le
   directeur enregistre la décision du comité (P-6a).

Une étape non requise est « Non requis » ; une étape n’arrive dans Mes approbations qu’à son tour (sinon « Pas encore à vous
de décider »). La **justification** de la demande est visible du client (R-140).

Une nouvelle référence après BL1 passe par ce circuit : le chef de projet la soumet depuis le Plan (« Fixer la référence ») ;
une fois la demande approuvée, la nouvelle référence devient courante et l’ancienne est « Remplacée ».

Approuvée, une demande met à jour le BAC, les lots de travaux et la catégorie de coûts choisie ; si le client l’a approuvée
et qu’elle touche le prix, un avenant brouillon est préparé au Contrat.

### Ressources

- **Approbations** : le directeur décide les demandes de ressources de **tous** les services (un chef de service, celles de
  ses services).
- **Grilles de taux** (R-083) : taux horaires et majorations **datés**. Le champ « Taux en vigueur le · les modifications
  s’appliquent à partir du » choisit la date ; une modification crée une version à cette date (une date antérieure revalorise
  les heures travaillées depuis). Le directeur et la Finance les modifient ; les chefs de projet les lisent ; les autres rôles
  ne les voient pas.
- « Mes tâches » d’une autre personne : le directeur peut ouvrir celles de tout le monde.

### Administration

- **Paramètres** : listes personnalisables, seuils de santé (« À risque sous »), règles du portefeuille. Deux réglages de
  la livraison 8, modifiables par le directeur seul :
  - **Comité de contrôle des modifications** : « Comité au-delà de (k€) », 50 k€ par défaut ; s’applique aux demandes
    soumises ensuite ;
  - **Écart d’heures** : « Seuil d’écart d’heures (%) », 10 % par défaut ; une ligne d’Heures (Lucca) est signalée au-dessus
    comme en dessous du prévu.
- **Activité et intégrations** : journal d’activité et d’audit, état réel de chaque connecteur (simulé, connecté, non
  connecté, désactivé), export du journal d’audit. « Synchroniser » l’index Codex est réservé au directeur.

## Points d’attention

- **Mode démonstration** : « Voir en tant que » permet de vérifier ce que voit chaque rôle ; il n’existe que sur la bêta.
- Le rôle **Finance** (R-044, [guide](finance.md)) modifie le contrat de tous les projets, les grilles de taux et le taux
  budgétaire ; il lit Facturation, Budget et Heures.
- **« Voir comme le client »** (R-139) : bouton de l’en-tête des écrans d’un projet. Il ouvre le portail client sous le
  bandeau « Vue client · aperçu · lecture seule », avec « Retour au projet ». Le directeur y garde « Signaler » ; les
  décisions restent au client.
- Les seuils, intervalles et réglages par défaut listés comme « à confirmer » dans les notes de livraison attendent votre
  décision.
