# Guide — Achats & stock

Profil de démonstration : **Fabien Bertrand**. Lire d’abord le [tronc commun](README.md).

## Ce que voit le rôle Achats

- **En haut** : Accueil, Mes projets, **Mes tâches**, Mes approbations, Documents · Codex.
- **Projet** : Plan — WBS (avancement de ses activités), Réunions & CR, Nomenclature projet ; le reste en consultation. Le
  **Contrat** n’est plus dans son menu : il est modifié par le directeur, la Finance et les chefs de projet (P-4, R-044) ; le
  rôle Achats le lit en consultation.
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
3. Approuvée, elle passe **Commandée** ; refusée (motif obligatoire), **annulée**. Le PDF de la commande est un récapitulatif
   interne (SC-4b) — la commande officielle vient de Sage X3.

**Annuler une commande avant qu’elle soit passée** (R-095), depuis son volet, avec un **motif obligatoire** (« Motif —
enregistré sur la commande annulée ») :

- **brouillon** : « Annuler la commande », par son auteur, le chef de projet ou le directeur ;
- **en attente d’approbation** : « Retirer de l’approbation », par la personne qui l’a soumise.

Le volet et le PDF de la commande annulée indiquent la date, la personne qui l’a annulée et le motif ; la consultation qui
l’a créée reste attribuée. Une commande passée (Commandée) ou importée de Sage X3 ne s’annule pas dans Keystone (elle
s’annule dans Sage X3).

**Actions Sage X3** (R-034) : Sage X3 n’est pas connecté. Sur la base de démonstration, « Importer depuis X3 » (Stock et
magasins) et « Envoyer vers X3 » (volet d’un article en stock, volet d’une commande) font une opération **simulée** et le
disent (« Import simulé (Sage X3 non connecté) · … », « Envoi simulé (Sage X3 non connecté) · … »). Sur une base de
production, ces boutons n’apparaissent pas et les écrans indiquent « Sage X3 non connecté ».

### 3. Livraisons et réception

**Livraisons** : « Annoncer une livraison », réception (avec **photos**), contrôle qualité, acceptation ; les quantités
acceptées vont dans le magasin choisi. Le **rapprochement à 3 voies** (facture fournisseur / commande / réception) se fait dans
Consultations et factures.

**Réception refusée** (R-096) :

- le volet de la livraison propose, pour chaque ligne refusée, « Déclarer la NC fournisseur dans Vigie » : un signalement
  prérempli (fournisseur, commande, réception, quantité ; noms des champs à confirmer avec Vigie). La NC est créée et suivie
  dans Vigie ;
- l’acheteur de la commande (la personne qui l’a soumise, à défaut son auteur ou le responsable de la consultation) et les
  responsables du projet reçoivent « Livraison refusée à la réception » ; sans acheteur identifié, tous les utilisateurs
  Achats ;
- une facture que le refus bloque au rapprochement donne « Facture bloquée par le rapprochement 3 voies ».

### 4. Stock

**Stock et magasins** : positions par magasin, **réservations** par projet (un stock réservé est refusé à un autre projet
sauf libération), **sorties** vers une activité (le coût est imputé au lot de travaux), retours. Les rôles Achats et directeur
sont magasiniers pour tous les projets ; les autres, pour les projets de leur équipe.

### 5. Activités et tâches

Le rôle Achats saisit l’**avancement de ses activités** sur le Plan (P-9a).

**Personne externe à trouver** (R-089) : quand une demande de ressource pour un **rôle intérimaire** est approuvée,
Keystone crée la tâche `Find and name: {rôle} — {titre de la demande}` pour le premier utilisateur Achats (à défaut le
directeur) ; tous les utilisateurs Achats sont prévenus (« Personne à trouver et nommer · T-… »).

1. **Mes tâches** › la tâche : la carte « Personne à trouver et nommer » rappelle le rôle et la demande.
2. **« Nommer la personne »** (achats et directeur) : choisir une personne déjà connue de Keystone (le pool de ressources
   d’abord). La tâche passe à cette personne, la demande la nomme, et le chef de projet est prévenu (« Personne nommée ·
   RQ-… »).
3. Si la personne n’existe pas encore dans Keystone, laisser un commentaire : la tâche reste aux achats. La création d’une
   personne attend l’annuaire Cursus (R-027).

## Points d’attention

- Les données de Sage X3 (stocks, commandes, factures) ne sont **pas connectées** (A-1a, R-034) : les valeurs sont celles de
  Keystone.
- Le client ne voit jamais les achats de son projet (P-10b).
