# Guide — Finance

Profil de démonstration : **Léa Marchand** (contrôleuse de coûts, service Contrôle et planification ; membre des équipes de
HLT-026, NDC-031 et ERP-202). Lire d’abord le [tronc commun](README.md).

Le rôle **Finance** vient des réponses P-4, P-12 et C-9 du responsable produit (R-044). En production, la DSI l’attribue par
le rôle d’application Entra ID `Keystone.Finance` (valeur `finance`) ou par un groupe associé à `finance`
([`docs/EXPLOITATION.md`](../EXPLOITATION.md) § 6).

## Ce que voit la Finance

- **En haut** : Accueil, Mes projets, Mes tâches, Documents · Codex. Pas de « Mes approbations ».
- **Portefeuille** : Vue d’ensemble, Trésorerie. Pas de Priorisation (notation et poids non décidés pour la Finance).
- **Projet** : Contrat et Facturation ; Plan — WBS, Budget et coûts, Heures (Lucca) ; Réunions & CR. Les autres écrans du
  projet s’ouvrent en consultation.
- **Ressources** : Congés et calendrier, Grilles de taux.

L’**Accueil** est celui du directeur.

**Droits** :

- **Contrat** : modifiable sur **tous** les projets, même hors de l’équipe (P-4).
- **Facturation**, **Budget et coûts** et **Heures** : en consultation (tag « Consultation »), même sur les projets de son
  équipe.
- **Taux horaires** : visibles et modifiables. **Taux budgétaire** du projet : fixé par la Finance ou le directeur.
- **Marges** : visibles (Trésorerie, rapport d’état, exports).
- **Prix fournisseurs** : masqués `•••` (réservés au directeur, aux chefs de projet et aux achats).

## Parcours principaux

### 1. Contrat

**Contrat** d’un projet (bouton principal « Ajouter un avenant ») :

- **Fiche contrat** : montant, devise, règle de paiement… ; chaque champ s’enregistre en le quittant.
- **Avenants** : « Ajouter un avenant », « Envoyer pour signature », « Marquer signé ». Un avenant compte dans la valeur du
  contrat une fois signé.
- **Cautions & garanties** : « Ajouter une garantie », « Libérer ».
- **Jalons de paiement** : « Ajouter un jalon de paiement » ; sur un jalon **prévu**, « Modifier » (libellé, part, date
  contractuelle, condition) ou « Retirer » (après confirmation ; son numéro n’est jamais réutilisé). Un jalon facturé ne change
  plus.
- **Total des parts** : au-dessus de 100 % pour le contrat de base ou pour un avenant, le contrat affiche « Total des parts
  105 % · facturation bloquée » et la facturation de ce groupe de jalons est bloquée jusqu’à la correction (R-077). En dessous
  de 100 %, ce n’est qu’un rappel (« Les parts doivent totaliser 100 % »).

Une demande de modification approuvée qui touche le prix du contrat prépare un **avenant brouillon** du même montant, relié à
la demande : il reste à l’envoyer pour signature.

### 2. Devise et taux budgétaire

Carte **« Devise et taux budgétaire »** du Contrat : pour un projet hors euro, saisir le taux (« Taux budgétaire (€ par
unité) »), puis « Enregistrer le taux ». Seuls la Finance et le directeur le fixent ; les autres voient le taux sans le modifier.

### 3. Grilles de taux

**Ressources › Grilles de taux** (R-083) :

1. Le champ **« Taux en vigueur le · les modifications s’appliquent à partir du »** choisit la date (par défaut la date d’état,
   25 septembre 2026). Chaque taux indique depuis quand il s’applique et ses autres versions.
2. Modifier un taux de base ou une majoration : la valeur s’enregistre en quittant le champ (ou avec Entrée) et crée une
   **version datée** à la date choisie. Une date antérieure revalorise les heures travaillées depuis cette date ; le journal
   l’indique.
3. « Ajouter un rôle » : rôle, taux horaire, centre de coûts, grade et date d’effet.

Les heures sont valorisées au taux du rôle de la personne à la date du travail : coût d’une tâche, écart d’heures, Lissage
what-if, majorations du chantier. Une personne sans rôle de la grille n’est **pas valorisée** (« ligne non valorisée »,
« Taux manquant »), jamais à un taux inventé.

Les cinq majorations livrées (heures supplémentaires × 1,25, samedi × 1,5, dimanche et jour férié × 2, nuit × 1,3, astreinte
× 0,35) sont des valeurs provisoires en attente des valeurs d’EPC2i (R-178).

### 4. Facturation, budget et heures (consultation)

- **Facturation** : jalons à facturer, factures, retenue. « Émettre la facture » et « Marquer payé » restent au directeur et
  aux chefs de projet du projet. Un jalon bloqué (total au-delà de 100 %) affiche le motif sous sa ligne.
- **Budget et coûts** : BAC, valeur acquise, CPI / SPI / EAC, catégories de coûts. Les couleurs d’alerte suivent le seuil
  « À risque sous » des Paramètres (R-080).
- **Heures (Lucca)** : heures déclarées et prévues ; l’écart est valorisé au taux de la grille.

### 5. Portefeuille

- **Vue d’ensemble** : indicateurs des projets en exécution de la zone choisie.
- **Trésorerie** : encaissements prévus sur les dates de paiement des jalons, avec les marges.

### 6. Activités, tâches et réunions

- **Plan — WBS** : le % d’avancement des activités dont elle est propriétaire (P-9a) ; le reste en consultation.
- **Mes tâches** : ses tâches (par exemple T-2312), commentaires avec mentions @, fichiers joints, glisser-déposer dans la
  vue Board (voir le [guide du membre d’équipe](membre-equipe.md)).
- **Réunions & CR** : les réunions des projets dont elle est membre (notes, actions cochées) ; le compte rendu est rédigé et
  envoyé par l’organisateur et le chef de projet.

## Points d’attention

- **En attente du responsable produit** (`docs/delivery-8/notes-roles-rates-hr.md` § 7) :
  - modification du contrat de tous les projets, ou des seuls projets de son équipe ;
  - émission et encaissement des factures par la Finance (aujourd’hui en consultation ; Sage X3 non connecté, R-182) ;
  - une page d’accueil propre à la Finance : les lignes d’approbation de l’accueil du directeur ouvrent des écrans où la
    Finance n’agit pas ;
  - en production, l’affectation d’un rôle de la grille à chaque personne : rien ne la renseigne encore, donc personne n’est
    valorisé.
- Les coûts réels des heures viendront de Cursus (R-074) ; les écritures comptables restent dans Sage X3, non connecté.
