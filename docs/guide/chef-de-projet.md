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
consultation. Il voit les **taux horaires** et les **prix fournisseurs**.

## Parcours principaux

### 1. Créer un projet (assistant)

**Projets › « Nouveau projet »** (directeur et chefs de projet seulement) : nom, client, type de machine, date de début, ville
et pays du site sont obligatoires ; « Suivant » jusqu’au bout, puis « Créer le projet ». Le projet s’ouvre sur son Plan, avec
le modèle du type de machine (lots, activités, catégories de coûts, systèmes ITP).

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
  CPI / SPI / EAC, catégories de coûts, lots de travaux. *Catégories figées après BL1 et seuils des indicateurs : à vérifier
  après intégration (R-081, R-080).*
- **Contrôle des modifications › « Nouvelle demande de modification »** : titre, justification, impact coût et délai,
  activités touchées ; « Soumettre en revue ». Le circuit : chef de projet, client, directeur, CCB ; une CR approuvée met à
  jour le budget des lots et, si elle est contractuelle, le contrat (avenant). *Circuit séquentiel, seuil CCB et
  justification visible du client : à vérifier après intégration (R-069, R-140).*
- **Provision pour aléas › « Prélèvement »** : montant, motif, **lié à** une CR, un risque ou une NCR ; « Enregistrer le
  prélèvement ». Il attend la **validation du directeur** (Mes approbations) avant de compter dans le consommé.

### 4. Risques

**Registre des risques › « Nouveau risque »** : probabilité, impact, **coût s’il survient** ; l’EMV est calculée (coût ×
probabilité / 5). Un risque peut ouvrir le **Lissage what-if** des ressources.

### 5. Ressources

- **Ressources du projet** : charge, carte **« Équipe projet »** (titulaire, co-chefs de projet, adjoint, référents, membres —
  c’est elle qui donne les droits d’écriture).
- **« Nouvelle demande de ressource »** (Ressources du projet ou Demandes de ressources) : la demande part au **chef du service**
  concerné, qui l’approuve, la replanifie ou la refuse ; approuvée, elle crée une tâche pour la personne.
- **Lissage what-if** : « Retenir le scénario → créer les demandes » crée des demandes **brouillon** (une seule fois) ; on les
  envoie ou les supprime ensuite depuis **Demandes de ressources** (« Envoyer », « Supprimer »). Rien ne change dans le plan
  avant la prochaine replanification.
- *Ré-envoi d’une demande retirée, messages de confirmation : à vérifier après intégration (R-090, R-152).*

### 6. Mes tâches et tâches

Le chef de projet peut consulter « Mes tâches » des personnes qui travaillent sur les projets qu’il dirige. Une **tâche** (fiche) porte
son statut, ses commentaires, ses **fichiers** (« Joindre », 20 Mo, types autorisés ; antivirus selon l’installation) et le
lien vers l’activité du plan. Seuls l’assigné et le directeur modifient une tâche. *Mentions @, glisser-déposer du tableau :
à vérifier après intégration (R-149, R-150).*

### 7. Réunions et comptes rendus

- **Réunions & CR › « Nouvelle réunion »** : type (interne / externe), série, date, lieu, invités, ordre du jour.
- Pendant la réunion, l’équipe ajoute des notes et des actions au point sélectionné ; **seuls l’organisateur et le chef de
  projet** rédigent et envoient le compte rendu (« Envoyer le CR à tous les conviés » : un document MIN, et des tâches pour les
  actions). *Tâches de suivi avec l’échéance saisie : à vérifier après intégration (R-067).*
- **Transcription** : « Importer une transcription » (texte collé ou fichier .txt / .vtt / .srt), puis « Analyser la
  transcription ». Sans clé Claude configurée, l’**analyse locale par règles** tourne et rien ne sort de Keystone ; avec la
  clé, l’écran indique « Analyse par Claude (Anthropic) ». Les propositions (décisions, actions, risques, questions client)
  sont revues une par une, puis « Ajouter au CR » ; un risque passe par le formulaire « Nouveau risque ».
- Le client ne voit que les réunions **externes** ; jamais les transcriptions.

### 8. Commandes, livraisons, stock

- **Nomenclature projet** : manques, **« Créer la commande de pièces »** → commandes brouillon, ouvertes sur Commandes d’achat.
- **Commandes d’achat** : brouillon → « Envoyer pour approbation » → **approuvée par le directeur ou le chef de projet** (Mes
  approbations) → commandée. *Annulation d’une commande avec motif : à vérifier après intégration (R-095).*
- **Livraisons** : « Annoncer une livraison », réception, contrôle qualité, acceptation ; les quantités acceptées vont en stock ; **photos** de
  réception.
- **Stock et magasins** : sorties vers une activité (imputées à son lot), réservations par projet.

### 9. Qualité, ITP, réserves, chantier

- **Inspections & réserves** : points de l’ITP, « Enregistrer le résultat » (conforme, avec réserves, non conforme — un échec
  se signale dans Vigie), réserves avec **photos**. *Liste de réserves unique par projet, systèmes ITP figés : à vérifier après
  intégration (R-117, R-057).*
- **Chantier** : préparation, Go / No Go (au moins un verdict Cursus), rapports journaliers avec photos. *Fiche chantier créée
  et renseignée par le chef de projet, conflits d’équipe calculés, case incident remplacée par un lien Vigie : à vérifier
  après intégration (R-118, R-119, R-122).*
- **Qualité et livrables** : « Nouveau livrable » (chefs de projet du projet) ; le client accepte ou refuse un livrable (PV
  de réception) ; un livrable refusé repart à la révision suivante. Les NCR sont dans Vigie.
- **Mise en service & transfert**, **REX & clôture** (retours d’expérience).

### 10. Contrat, facturation, état du projet

- **Contrat** : montant, devise, règle de paiement, jalons, avenants (envoyés à la signature, facturables une fois signés),
  garanties. **Facturation** : « Émettre la facture » d’un jalon atteint. *Blocage au-delà de 100 % des jalons, rôle Finance :
  à vérifier après intégration (R-077, R-044).*
- **Tendances et état** : rapport d’état interne ou client (PDF).

### 11. Garantie

**Réclamations & interventions** : « Nouvelle réclamation », diagnostic, « Planifier l’intervention », clôture ; le **Parc
installé** liste les machines livrées et leur configuration.

## Points d’attention

- Hors de l’équipe d’un projet, tout est en consultation, même avec le rôle de chef de projet.
- Les demandes de modification, prélèvements et commandes ne sont **effectifs qu’après approbation**.
- Les données de Vigie, Cursus et Codex se modifient dans leur application (liens « Ouvrir dans … »).
