# Guide — Achats & stock

Profil de démonstration : **Fabien Bertrand**. Lire d’abord le [tronc commun](README.md).

## Ce que voit le rôle Achats

- **En haut** : Accueil, Mes projets, Mes approbations, Documents · Codex.
- **Projet** : Contrat, Plan — WBS (avancement de ses activités), Réunions & CR, Nomenclature projet ; le reste en
  consultation. *Le Contrat passe au rôle Finance avec la livraison 8 — à vérifier après intégration (R-044).*
- **Référentiel technique** : Articles (PLM), Ordres de modification (ECO).
- **Achats & stock** : Consultations et factures, Commandes d’achat, Livraisons, Stock et magasins.
- **Garantie & après-vente** : Parc installé, Réclamations & interventions.
- **Ressources** : Ressources, Congés et calendrier.
- **Administration** : Paramètres.

Les **prix fournisseurs** lui sont visibles (NEW-D2-1) ; les taux horaires, non.

## Parcours principaux

Keystone ne décrit pas encore la procédure d’achat d’EPC2i (seuils, niveaux d’approbation, circuit Sage X3 : en attente du
responsable produit). Voici ce que fait l’application.

### 1. Consultations (RFQ)

**Consultations et factures › « Nouvelle consultation »** : articles, quantités, fournisseurs ; « Envoyer aux fournisseurs » ;
comparaison des offres et **« Attribuer »** (règle d’attribution des Paramètres).

### 2. Commandes d’achat

1. Une commande naît **brouillon** (depuis une consultation attribuée ou la **Nomenclature projet** : « Créer la commande de
   pièces »).
2. « Envoyer pour approbation » : la commande attend le **directeur ou le chef de projet** dans « Mes approbations ».
3. Approuvée, elle passe **Commandée** ; refusée, **annulée**. Le PDF de la commande est un récapitulatif interne
   (SC-4b) — la commande officielle vient de Sage X3.

*Annulation d’une commande avec motif, actions Sage X3 simulées : à vérifier après intégration (R-095, R-034).*

### 3. Livraisons et réception

**Livraisons** : « Annoncer une livraison », réception (avec **photos**), contrôle qualité, acceptation ; les quantités
acceptées vont dans le magasin choisi. Le **rapprochement à 3 voies** (facture fournisseur / commande / réception) se fait dans
Consultations et factures.

### 4. Stock

**Stock et magasins** : positions par magasin, **réservations** par projet (un stock réservé est refusé à un autre projet
sauf libération), **sorties** vers une activité (le coût est imputé au lot de travaux), retours. Les rôles Achats et directeur
sont magasiniers pour tous les projets ; les autres, pour les projets de leur équipe.

### 5. Activités et tâches

Le rôle Achats saisit l’**avancement de ses activités** sur le Plan (P-9a). *Tâche « trouver l’intervenant externe » reçue
des demandes de ressources et « Mes tâches » pour les achats : à vérifier après intégration (R-089).*

## Points d’attention

- Les données de Sage X3 (stocks, commandes, factures) ne sont **pas connectées** (A-1a, R-034) : les valeurs sont celles de
  Keystone.
- Le client ne voit jamais les achats de son projet (P-10b).
