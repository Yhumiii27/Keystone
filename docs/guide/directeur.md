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

### Demandes de modification et références — *à vérifier après intégration (R-069)*

Une nouvelle référence après BL1 passe par une demande de modification : le chef de projet la soumet depuis le Plan
(« Fixer la référence ») ; elle est approuvée successivement par le chef de projet, le client, le directeur puis le CCB
(le directeur décide aussi pour le CCB). Une fois approuvée, la nouvelle référence devient courante. La livraison 8 rend ce
circuit séquentiel avec un seuil CCB réglable (étapes non requises passées automatiquement).

### Ressources

- **Approbations** : le directeur décide les demandes de ressources de **tous** les services (un chef de service, celles de
  ses services).
- **Grilles de taux** : les taux horaires (visibles du directeur et des chefs de projet seulement).
- « Mes tâches » d’une autre personne : le directeur peut ouvrir celles de tout le monde.

### Administration

- **Paramètres** : listes personnalisables, seuils de santé (« À risque sous »), règles du portefeuille.
- **Activité et intégrations** : journal d’activité et d’audit, état réel de chaque connecteur (simulé, connecté, non
  connecté, désactivé), export du journal d’audit. « Synchroniser » l’index Codex est réservé au directeur.

## Points d’attention

- **Mode démonstration** : « Voir en tant que » permet de vérifier ce que voit chaque rôle ; il n’existe que sur la bêta.
- Le rôle **Finance** (contrat, facturation, grille de taux) arrive avec la livraison 8 (R-044) — *à vérifier après
  intégration*. L’entrée « Voir comme le client » pour le directeur et les chefs de projet aussi (R-139).
- Les seuils, intervalles et réglages par défaut listés comme « à confirmer » dans les notes de livraison attendent votre
  décision.
