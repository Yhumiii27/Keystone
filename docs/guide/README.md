# Keystone PM — guide utilisateur (bêta)

Keystone PM est l’outil de gestion de projets et de portefeuille d’EPC2i. Ce guide décrit **ce que fait l’application
aujourd’hui**, rôle par rôle. Il ne décrit pas les procédures d’EPC2i qui sont encore en cours de définition (procédure
d’achat, matrice RACI, gel hebdomadaire des données) : l’application ne les impose pas encore.

Les guides décrivent la version de la **livraison 8**.

## Guides par rôle

| Rôle | Guide | Profil de démonstration |
|---|---|---|
| Directeur de portefeuille | [directeur.md](directeur.md) | Marie Lefebvre |
| Chef de projet | [chef-de-projet.md](chef-de-projet.md) | Romain Aubert |
| Chef de service | [chef-de-service.md](chef-de-service.md) | Marion Kerviel (ingénierie) |
| Membre d’équipe | [membre-equipe.md](membre-equipe.md) | Julien Wagner |
| Responsable ingénierie | [responsable-ingenierie.md](responsable-ingenierie.md) | Antoine Girard |
| Responsable qualité | [qualite.md](qualite.md) | Gabriel Comte |
| Achats & stock | [achats.md](achats.md) | Fabien Bertrand |
| Finance | [finance.md](finance.md) | Léa Marchand |
| Logistique | [logistique.md](logistique.md) | Camille Verdier |

Le guide du **client** attend l’ouverture du portail client (I-2b, R-179). Les scénarios de recette de la bêta sont dans
[recette-beta.md](recette-beta.md) ; l’exploitation (installation, sauvegardes, antivirus) dans
[`docs/EXPLOITATION.md`](../EXPLOITATION.md).

## Prendre en main

- **Se connecter.** En production : « Se connecter avec Microsoft » (compte EPC2i). Sur la bêta de démonstration : le
  sélecteur **« Voir en tant que »** en bas de la barre latérale choisit un profil (aucun mot de passe : la bêta est protégée
  par l’identification du serveur).
- **Navigateur ou application Windows.** Keystone s’ouvre dans un navigateur, de n’importe où ; sous Windows, ceux qui le
  souhaitent peuvent aussi utiliser l’application `Keystone.exe`, une fenêtre sur le même serveur
  ([application-windows.md](application-windows.md)).
- **Rôle actif.** Une personne qui a plusieurs rôles choisit son **rôle actif** dans le menu de son compte : les écrans et les
  droits suivent le rôle actif.
- **Barre latérale.** En haut : Accueil, Mes projets, Mes tâches, Mes approbations, Documents · Codex. Puis les sections
  Portefeuille, Projet (Contrat, Pilotage, Équipe & échanges, Ingénierie projet, Maîtrise, Chantier & transfert, Bilan),
  Référentiel technique, Achats & stock, Garantie & après-vente, Ressources, Administration — selon le rôle. Un écran hors de
  votre périmètre s’ouvre **en consultation** (bandeau « Consultation — hors de mon périmètre »).
- **Projet courant.** Les écrans de la section Projet portent sur le projet choisi dans le sélecteur de projet de l’en-tête.
- **Langue.** Français par défaut ; FR / EN dans l’en-tête.
- **Recherche, notifications.** La recherche de l’en-tête trouve projets, activités, commandes, demandes de modification,
  risques… sur tout le portefeuille, le projet courant en premier ; la cloche liste vos notifications (demandes à décider,
  tâches assignées, mentions @…) ; Keystone n’envoie pas encore d’e-mail.
- **Exports.** Les écrans principaux s’exportent en CSV, Excel ou PDF (bouton « Exporter »).
- **Tablette.** L’application fonctionne sur tablette jusqu’à 1 024 px de large (menu en tiroir) ; pas de mise en page
  téléphone.

## Règles de droits (communes à tous les rôles)

- **Équipe projet nommée (R-041).** Les droits d’écriture sur un projet suivent son équipe (carte « Équipe projet » de
  Ressources du projet) :
  - le **chef de projet titulaire**, les **co-chefs de projet** et l’**adjoint** ont les droits de chef de projet, comme le
    **directeur** sur tous les projets ;
  - les **référents** et **membres** de l’équipe modifient leurs propres éléments (par exemple l’avancement de leurs
    activités) ;
  - hors de l’équipe, un projet est **en consultation**.
- **Création de projet** : le directeur et les chefs de projet (P-3).
- **Contrat** : modifié par le directeur et la Finance sur tous les projets, et par les chefs de projet du projet (P-4).
- **Taux horaires** : visibles du directeur, des chefs de projet et de la Finance ; modifiés par le directeur et la Finance
  seulement (P-12).
- **Prix fournisseurs** (prix d’achat, montants de commande, factures fournisseurs) : le directeur, les chefs de projet **et
  les achats** (NEW-D2-1) ; masqués `•••` pour les autres, exports compris.
- **Comptes rendus de réunion** : rédigés et envoyés par l’organisateur et le chef de projet ; l’équipe ajoute des notes et
  coche les actions (P-9b).
- **Plan** : structure et planification par l’équipe de direction du projet et le directeur ; chaque propriétaire saisit le
  % d’avancement de ses activités (P-9a).
- **Demandes de ressources** : un chef de service décide pour les services qu’il dirige, le directeur pour tous (P-8a).

## Ce qui reste dans Vigie, Cursus et Codex

Keystone **montre** les données des applications sœurs, **ouvre** leurs fiches dans leur application (liens profonds) et
**enregistre l’avancement** qu’il leur doit dans une file d’attente (« en attente de synchronisation »). La création et la
gestion complètes restent chez elles :

| Application | Ce qu’elle garde | Dans Keystone |
|---|---|---|
| **Vigie** (QHSE) | ECO, NCR des projets (8D, plans d’action), HSE du chantier | listes en lecture, « Signaler dans Vigie », liens préremplis (NC fournisseur d’une réception refusée, incident HSE du chantier), avancement en attente de synchronisation |
| **Cursus** (RH, formation) | habilitations chantier et Go / No Go des personnes ; congés et absences ; temps passés | verdicts Cursus sur la fiche chantier, absences reçues (Congés et calendrier), liens vers Cursus |
| **Codex** (documents) | les documents, leurs révisions et circuits d’approbation | l’index, les liens « Ouvrir dans Codex », les décisions en attente de synchronisation avec Codex |

## Limites connues de la bêta

- **Connecteurs** : sans adresse d’API, Vigie, Cursus et Codex sont **simulés** (miroir local, « Synchroniser » indique une
  synchronisation simulée) ; avec une adresse, ils appellent les API des applications sœurs, qui servent aujourd’hui des
  données de démonstration. Sage X3, SolidWorks PDM, Outlook / Exchange, Teams et la messagerie ne sont **pas connectés** ;
  sur la base de démonstration, les actions Sage X3 sont simulées et le disent (« Import simulé (Sage X3 non connecté) »).
- **Date d’état figée** : les indicateurs se calculent au **25 septembre 2026** (« aujourd’hui » = 30 septembre 2026) tant que
  l’horloge réelle et la date des données ne sont pas décidées (R-013, S-4).
- **Imports désactivés** (D-7b) : MS Project, Primavera P6 et les imports Excel / CSV ne sont pas proposés.
- **Pas d’accès client** à l’ouverture (I-2b) : le portail client existe mais aucun compte client n’est ouvert.
- **Pas d’e-mail** : les notifications restent dans la cloche de Keystone.
- **Tablette** jusqu’à 1 024 px ; pas de mise en page téléphone.
- **Données de démonstration** sur la bêta (projets HLT-026, NDC-031…) : ne pas y saisir de données réelles.

## Glossaire

| Terme | Sens dans Keystone |
|---|---|
| **Code projet** | `HLT-026` : trois lettres + numéro, la clé interne du projet |
| **Étapes** | Initiative, APS (avant-projet sommaire), APD (avant-projet détaillé), Études, Approvisionnements, Fabrication & Assemblage, FAT, Expédition, Chantier, Mise en service & SAT, Garantie, Clos, Annulé |
| **WBS, lot de travaux** | Structure de découpage du projet ; ses lots regroupent les activités |
| **Référence (BL0, BL1…)** | Planning et budget de référence : BL0 offre, BL1 référence approuvée, BL2+ nouvelles références (via une demande de modification) |
| **Demande de modification (CR), CCB** | Changement de périmètre, de coût ou de délai et son circuit d’approbation ; CCB = comité de contrôle des modifications |
| **Provision pour aléas** | Réserve budgétaire ; un prélèvement est lié à une CR, un risque ou une NCR et validé par le directeur |
| **EVM, CPI, SPI, EAC** | Valeur acquise : CPI = performance coût, SPI = performance délai, EAC = coût estimé à terminaison |
| **Santé** | À l’heure / À risque / En retard, d’après les seuils des Paramètres |
| **EMV** | Valeur monétaire attendue d’un risque = coût × probabilité / 5 |
| **NCR** | Non-conformité (gérée dans Vigie) |
| **ITP, réserves** | Plan d’inspection et d’essais (points d’arrêt, témoins…) ; réserves A (bloquantes), B (avant SAT), C (cosmétiques) |
| **PV de réception** | Procès-verbal d’acceptation d’un livrable, d’une FAT, d’une SAT par le client |
| **FAT / SAT** | Essais de réception en usine / sur site |
| **ECO** | Ordre de modification technique (géré dans Vigie) |
| **PLM, nomenclature (BOM)** | Catalogue des articles ; nomenclature des équipements et articles d’un projet |
| **REX** | Retour d’expérience |
| **Date d’état** | Date à laquelle se rapportent les indicateurs (figée pendant la bêta) |
