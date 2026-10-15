# Guide — Chef de projet

Profil de démonstration : **Romain Aubert** (chef de projet de HLT-026). Lire d’abord le [tronc commun](README.md).

## Ce que voit le chef de projet

- **En haut** : Accueil, Mes projets, Mes approbations, Documents · Codex.
- **Portefeuille** : Vue d’ensemble, Projets, Planning, Mappemonde des projets, Priorisation, Trésorerie.
- **Projet** : Contrat et Facturation ; Plan — WBS, Planning, Budget et coûts, Heures (Lucca), Provision pour aléas,
  Ressources du projet ; Réunions & CR, Parties prenantes & RACI, Interfaces ; Ingénierie (synthèse et disciplines),
  Nomenclature projet ; Registre des risques, Contrôle des modifications, Qualité et livrables, Inspections & réserves ;
  Chantier, Mise en service & transfert ; Tendances et état, REX & clôture. (Validation P&ID n’est pas dans son menu : elle
  s’ouvre en consultation.)
- **Référentiel technique** (Articles, ECO, Plans), **Achats & stock** (Consultations et factures, Commandes d’achat,
  Livraisons, Stock et magasins), **Garantie & après-vente** (Parc installé, Réclamations & interventions), **Ressources**
  (Demandes de ressources, Lissage what-if, Matrice de compétences, Congés et calendrier, Grilles de taux), **Administration**
  (Paramètres, Types de machines, Registre des types de documents, Activité et intégrations).

**Droits** : ceux de chef de projet sur les projets dont il est **titulaire, co-chef de projet ou adjoint** ; ailleurs, en
consultation. Il voit les **taux horaires** (sans les modifier : directeur et Finance, P-12) et les **prix fournisseurs**.
Sur ses projets, le bouton **« Voir comme le client »** de l’en-tête ouvre le portail client du projet (voir 10).

## Parcours principaux

### 1. Créer un projet (assistant)

**Projets › « Nouveau projet »** (directeur et chefs de projet seulement) : nom, client, type de machine, date de début, ville
et pays du site sont obligatoires ; « Suivant » jusqu’au bout, puis « Créer le projet ». Un message confirme
la création (« #052 · nom du projet · Projet créé ») et le projet s’ouvre sur son Plan, avec le modèle du type de machine (lots, activités,
catégories de coûts, systèmes ITP).

Un **changement d’étape forcé** (Projets, menu de l’étape, motif obligatoire) est confirmé par « WSA-044 · Validation demandée
au directeur de portefeuille » ; le directeur l’approuve ou le refuse dans Mes approbations.

### 2. Plan et Gantt

- **Plan — WBS** : la structure (lots de travaux, activités), propriétaires, durées, budgets, liens. « Ajouter une activité »,
  « Ajouter un lien » (une boucle ou un doublon est refusé avec l’explication).
- **« Replanifier »** recalcule les dates (chemin critique) ; un second passage sans changement le dit.
- **Supprimer** un lot ou une activité : « Annuler » dans le message, ou plus tard **« Supprimés récemment » › « Restaurer »**
  (corbeille de 30 jours, 20 entrées par projet).
- **Avancement** : les propriétaires des activités saisissent eux-mêmes le % d’avancement de leurs activités (P-9a) ; le chef
  de projet et le directeur peuvent tout modifier.
- **Planning** : le Gantt, avec la référence.
- **Fixer la référence** : avant BL1, directement ; **après BL1**, le bouton ouvre une **demande de modification** « Nouvelle
  référence BLn » (voir 3).

### 3. Budget, demandes de modification, provision pour aléas

- **Budget et coûts** : BAC, valeur acquise (PV, EV, AC calculés depuis les activités, la référence et les commandes),
  CPI / SPI / EAC, catégories de coûts, lots de travaux. Les couleurs d’alerte des indicateurs suivent le seuil « À risque
  sous » des Paramètres (R-080).
- **Catégories de coûts après BL1** (R-081) : leur montant est figé. Il ne change plus que par une demande de modification
  approuvée ; une nouvelle catégorie démarre à 0 k€. Le nom et le type restent modifiables.
- **Contrôle des modifications › « Nouvelle demande de modification »** : titre, **justification**, **impact contractuel**
  (obligatoire : « Aucun (interne) », « Prix du contrat », « Délais contractuels » ou « Prix et délais du contrat »), impact
  coût et délai, activités touchées, **catégorie de coûts** (facultative) ; « Soumettre en revue ». La justification est
  montrée au client avec la demande (R-140) : dans le volet de la CR et, sur son portail, en « Pourquoi : … ».
- **Circuit d’approbation** (R-069) : les étapes sont fixées à la soumission et se décident **dans l’ordre** :
  1. **chef de projet** (dans Mes approbations du titulaire ; les co-chefs de projet et l’adjoint décident depuis Contrôle des
     modifications) ;
  2. **directeur de portefeuille** ;
  3. **client**, seulement si l’impact contractuel n’est pas « Aucun (interne) » ;
  4. **comité de contrôle des modifications**, seulement si le montant dépasse le seuil des Paramètres (50 k€ par défaut) ;
     le directeur enregistre la décision du comité.

  Une étape non requise est « Non requis ». Une étape décidée avant son tour est refusée (« Pas encore à vous de décider ») ;
  le volet indique « En attente de … ». Chaque approbateur est prévenu dans la cloche quand vient son tour, le demandeur à
  la décision finale.
- **CR approuvée** : le BAC et les lots de travaux sont mis à jour, ainsi que le budget de la catégorie choisie. Si le client
  l’a approuvée et qu’elle touche le prix, un **avenant brouillon** est préparé au Contrat. Tant qu’aucun compte client n’est
  ouvert (I-2b), une demande contractuelle attend à l’étape client.
- **Provision pour aléas › « Prélèvement »** : montant, motif, **lié à** une CR, un risque ou une NCR ; « Enregistrer le
  prélèvement ». Il attend la **validation du directeur** (Mes approbations) avant de compter dans le consommé.

### 4. Risques

**Registre des risques › « Nouveau risque »** : probabilité, impact, **coût s’il survient** ; l’EMV est calculée (coût ×
probabilité / 5). Un risque peut ouvrir le **Lissage what-if** des ressources.

### 5. Ressources

- **Ressources du projet** : charge, carte **« Équipe projet »** (titulaire, co-chefs de projet, adjoint, référents, membres —
  c’est elle qui donne les droits d’écriture).
- **« Nouvelle demande de ressource »** (Ressources du projet ou Demandes de ressources) : la demande part au **chef du service**
  concerné, qui l’approuve, la replanifie ou la refuse ; approuvée, elle crée une tâche pour la personne. Un message confirme
  l’envoi : « Demande RQ-045 envoyée ».
- **Rôle intérimaire** (personne externe à trouver, R-089) : approuvée, la demande crée une tâche pour les **achats**, qui
  trouvent et nomment la personne ; le chef de projet est prévenu (« Personne nommée · RQ-… »).
- **« Redemander »** (Demandes de ressources) : une demande **refusée ou retirée** se renvoie au service, par la personne qui
  l’avait envoyée, avec ses dates d’origine (R-090).
- **Lissage what-if** : « Retenir le scénario → créer les demandes » crée des demandes **brouillon** (une seule fois) ; on les
  envoie ou les supprime ensuite depuis **Demandes de ressources** (« Envoyer », « Supprimer »). Rien ne change dans le plan
  avant la prochaine replanification.

### 6. Mes tâches et tâches

Le chef de projet peut consulter « Mes tâches » des personnes qui travaillent sur les projets qu’il dirige. Une **tâche** (fiche) porte
son statut, ses commentaires, ses **fichiers** (« Joindre », 20 Mo, types autorisés ; antivirus selon l’installation) et le
lien vers l’activité du plan. Seuls l’assigné et le directeur modifient une tâche ou déplacent sa carte dans la vue Board
(R-150) ; le chef de projet la consulte sans la commenter. Quand une personne le mentionne dans un commentaire
(« @Romain Aubert » ou « @R. Aubert »), il reçoit la notification « @vous dans T-… » (R-149).

### 7. Réunions et comptes rendus

- **Réunions & CR › « Nouvelle réunion »** : type (interne / externe), série, date, lieu, invités, ordre du jour.
- Pendant la réunion, l’équipe ajoute des notes et des actions au point sélectionné ; **seuls l’organisateur et le chef de
  projet** rédigent et envoient le compte rendu (« Envoyer le CR à tous les conviés » : un document MIN, et des tâches pour les
  actions).
- **Tâches des actions** (R-067) : dans le composeur, une action peut être reliée à une **Activité** du plan. À l’envoi du CR,
  chaque action devient une tâche à l’**échéance saisie** (sinon dans 3 jours ouvrés). L’action d’un responsable interne
  devient sa tâche ; celle d’un externe (client, fournisseur) devient une tâche de **relance** (étiquette « Relance ») pour le
  responsable interne de la relation (Parties prenantes & RACI), à défaut pour le chef de projet. Chaque assigné est prévenu
  (« Tâche assignée · T-… »).
- **Transcription** : « Importer une transcription » (texte collé ou fichier .txt / .vtt / .srt), puis « Analyser la
  transcription ». Sans clé Claude configurée, l’**analyse locale par règles** tourne et rien ne sort de Keystone ; avec la
  clé, l’écran indique « Analyse par Claude (Anthropic) ». Les propositions (décisions, actions, risques, questions client)
  sont revues une par une, puis « Ajouter au CR » ; un risque passe par le formulaire « Nouveau risque ».
- Le client ne voit que les réunions **externes** ; jamais les transcriptions.

### 8. Commandes, livraisons, stock

- **Nomenclature projet** : manques, **« Créer la commande de pièces »** → commandes brouillon, ouvertes sur Commandes d’achat.
- **Commandes d’achat** : brouillon → « Envoyer pour approbation » → **approuvée par le directeur ou le chef de projet** (Mes
  approbations) → commandée.
- **Annuler une commande** (R-095), depuis son volet, avec un **motif obligatoire** :
  - **brouillon** : « Annuler la commande », par son auteur, le chef de projet ou le directeur ;
  - **en attente d’approbation** : « Retirer de l’approbation », par la personne qui l’a soumise ;
  - dans Mes approbations, « Refuser » demande aussi un motif et annule la commande.

  Le volet de la commande annulée indique la date, la personne qui l’a annulée et le motif ; la personne qui l’a rédigée
  et celle qui l’a soumise sont prévenues. Une commande passée (Commandée) ou importée de Sage X3 ne s’annule pas dans Keystone.
- **Livraisons** : « Annoncer une livraison », réception, contrôle qualité, acceptation ; les quantités acceptées vont en stock ; **photos** de
  réception. Une réception refusée (R-096) affiche dans son volet « Déclarer la NC fournisseur dans Vigie » (lien prérempli)
  et prévient l’acheteur et les responsables du projet (« Livraison refusée à la réception »).
- **Stock et magasins** : sorties vers une activité (imputées à son lot), réservations par projet.

### 9. Qualité, ITP, réserves, chantier

- **Inspections & réserves** : points de l’ITP, « Enregistrer le résultat » (conforme, avec réserves, non conforme — un échec
  se signale dans Vigie), réserves avec **photos**.
- **Une seule liste de réserves par projet** (R-117) : les réserves de l’ITP et celles du chantier sont numérotées à la suite
  (P-01, P-02…). Filtre **Origine** (Tous, Inspection, Site) ; chaque réserve a une catégorie A, B ou C, un responsable
  (Keystone ou client) et, au besoin, le numéro de NCR de Vigie. « Démarrer » et « Clôturer » se font sur Inspections &
  réserves ; la carte du Chantier montre les réserves levées sur site (« Tous » pour la liste entière).
- **Systèmes de l’ITP** (R-057) : figés à la création du plan d’inspection du projet ; une modification du type de machine ne
  vaut que pour les projets créés ensuite.
- **Fiche chantier** (R-118) : de l’étape Études à Mise en service & SAT, les responsables du projet (titulaire, co-chefs de
  projet, adjoint, directeur) la préparent et la renseignent :
  1. « Préparer le chantier » : formulaire prérempli (ville et pays du site, devise, premier contact client) ; saisir le début
     et la fin du chantier, puis « Créer la fiche chantier » ;
  2. « Modifier la fiche chantier », « Ajouter un prérequis client » (lié à une activité du plan), « Ajouter du matériel »,
     « Ajouter une rotation » (une personne de l’équipe projet ou une équipe sous-traitante), « Ajouter une ligne de coût de
     mission » (budget seulement) ;
  3. chaque ligne se modifie ou se retire (retrait confirmé), sauf une ligne confirmée, signée ou avec un réel de Sage X3,
     qui est conservée.

  Le réel des coûts de mission viendra de Sage X3 (« En attente de Sage X3 ») ; le chantier Cursus reste « Pas encore créé »
  tant que Cursus ne l’a pas créé (R-028).
- **Go / No Go** : au moins un verdict Cursus.
- **Conflits de l’équipe chantier** (R-119) : Équipe & mobilisation › « Détection des collisions » les calcule : charge
  au-delà de 110 %, même personne sur deux chantiers, habilitation Cursus qui expire, en attente ou manquante, congé ou
  absence reçus de Cursus pendant la mission. « Résoudre » ouvre l’écran utile. « Arbitrer » (commentaire obligatoire)
  revient au chef du service de la personne et au directeur ; pour une équipe sous-traitante ou une personne sans service,
  au directeur et aux responsables du projet. Un arbitrage tient tant que la cause du conflit ne change pas.
- **Rapport journalier** (R-122) : date, météo, effectif, avancement, photos. Il n’y a plus de case « incident HSE » : le lien
  « Incident HSE ? Déclarez-le dans Vigie » ouvre le signalement dans Vigie, prérempli avec le projet.
- **Qualité et livrables** : « Nouveau livrable » (chefs de projet du projet) ; le client accepte ou refuse un livrable (PV
  de réception) ; un livrable refusé repart à la révision suivante. Les NCR sont dans Vigie.
- **Mise en service & transfert**, **REX & clôture** (retours d’expérience).

### 10. Contrat, facturation, état du projet

- **Contrat** : montant, devise, règle de paiement, jalons, avenants (envoyés à la signature, facturables une fois signés),
  garanties. Un jalon **prévu** se corrige (« Modifier ») ou se retire (« Retirer », son numéro n’est pas réutilisé). La
  **Finance** modifie aussi le contrat ; le **taux budgétaire** d’un projet hors euro est fixé par le directeur ou la Finance
  (R-044).
- **Facturation** : « Émettre la facture » d’un jalon atteint. Si les parts du contrat de base ou d’un avenant dépassent
  100 %, le contrat affiche « Total des parts 105 % · facturation bloquée » et ces jalons ne se facturent plus jusqu’à la
  correction de l’échéancier (R-077) ; sous 100 %, ce n’est qu’un rappel.
- **« Voir comme le client »** (R-139) : bouton de l’en-tête des écrans du projet, pour le directeur et les responsables du
  projet. Il ouvre le portail client du projet sous le bandeau « Vue client · aperçu · lecture seule », avec « Retour au
  projet ». Rien ne s’y décide à la place du client.
- **Tendances et état** : rapport d’état interne ou client (PDF).

### 11. Garantie

**Réclamations & interventions** : « Nouvelle réclamation », diagnostic, « Planifier l’intervention », clôture ; le **Parc
installé** liste les machines livrées et leur configuration.

## Points d’attention

- Hors de l’équipe d’un projet, tout est en consultation, même avec le rôle de chef de projet.
- Les demandes de modification, prélèvements et commandes ne sont **effectifs qu’après approbation**.
- Les données de Vigie, Cursus et Codex se modifient dans leur application (liens « Ouvrir dans … »).
