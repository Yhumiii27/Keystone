# Décisions produit — réponses au questionnaire du chapitre 5

Réponses du responsable produit aux questions ouvertes de Keystone (spécification `docs/spec/00-overview.md` §10, livraisons 1–5, liaisons Vigie/Cursus).
Instantané du 2026-10-09 : 195 questions, 193 réponses. Source vivante : l'artefact « Décisions Keystone » https://claude.ai/artifact/V1QbfEyepVFzB5Vb9fo1Z9 (base `answers`, un document par identifiant). Données brutes : `docs/decisions/questions.json` (texte complet, options) et `docs/decisions/answers.json`.

Lecture : **choix retenu** (★ = la recommandation). Les réponses « Autre réponse » et « À discuter » portent une note du responsable produit, à lire en priorité.

## À traiter en priorité : réponses libres et points à discuter

- **A-1a · Achats et stock : partage des rôles entre Keystone et Sage X3** — À discuter : Je ne suis pas certains de modules et de la gestion qui est faite dans sage 3X.
Garde cette question car il faut que j'en discute avec le service finance, achat et la logistique.
- **A-1b · Référentiel articles : qui est maître ?** — À discuter : De mon point de vue, tout les numéros d'articles PLM sont pris par solidworks 3DX.
Laisse moi confirmer avec l'ingénierie
- **A-2 · Projets sans données : modèle du type de machine** — Autre réponse : Nous avons plusieurs type de projet et chacun doit voir son "standard" que le chef de projet pourra customiser.
Il nous faudra pour cela créer par type de projet un standard que l'on pourra mettre a jour dans Keystone, qui servira de socle pour le WBS, les budgets, et toutes les autres étapes ainsi que leurs livrables.
- **I-1a · Hébergement de Keystone (et des applications EPC2i)** — À discuter : Cela reste encore a décider avec l'IT et la DSI, je pense que dans un premier temps un serveur cloud indépendant sera utilisé pour commencer le multiuser avec des beta testeurs avant de passer en production, au moment de passer en production il est possible que l'on migre vers Azure ou vers un serveur interne ou même que l'on reste en cloud, je ne sais pas
- **I-3b · Échanges avec Sage X3 : interface ou fichiers** — À discuter : La connection a sage risque d'être le point le plus bloquant du projet.
Ma proposition est que dans un premier temps nous ferons des extraction automatisées de certaines bases sage et un import automatisé dans keystone. pour la périodicité de ces imports avant la mise en production un import par jour devrait être suffisant pour epprouver notre outil?
- **NEW-SYS-1 · Code projet commun à Keystone, Cursus et Vigie** — Autre réponse : Il existe deux forme pour identifier un projet chez nous, le code au format #000 qui est utilisé par l'ensemble des équipes ingénieries et une code dit analytique au format XXX000 qui est lui utilisé par la finance (et donc pas Sage 3X).
Je dois confirmer cela mais je pense que le numéro projet #000 vient d'un listing que l'on incrémente et que le numéro XXX000 est créé dans Sage et nous est donc imposé. Il faut trouver un moyen de réconcilier les deux et je pense que cela sera plus simple dans la fiche projet de keystone.
- **P-4 · Droits sur le contrat et la facturation client ; rôle Finance ?** — Autre réponse : Le directeur, le CP et le Role Finance doivent pouvoir modifier la page contrat.
- **P-5a · Seuils de montant pour approuver une commande d'achat** — Autre réponse : Nous avons une procédure d'achats qui défini les montant et workflow de validation dans Sage. Il faudra que je te communique cette procédure pour que tu définisses les règles dans keystone et ce qui devra être communiqué a sage
- **L-3a · Création d'un projet à partir du modèle de type de machine** — À discuter : Il y aura un modèle complet par type de machine, le chef de projet choisiera.
Je vais devoir te fournir les données standard (WBS, budgets, etc.) par type de machine, l'assistant fera une copie de tout cela que le chef de projet pourra customiser au besoin avant le lancement officiel du projet
- **S-5 · Suppression d'un lot et contrôle des liens** — À discuter : Nous devons demander une confirmation et garder la possibilité d'annulation.
- **S-6 · Données propres aux lots de travaux** — À discuter : les codes analystiques que sage utilise sont redécoupés en codes NIM, je ferais une extraction pour que tu puisses avoir le détails et ainsi nous pourront attribuer par tache au projet le bon code analytique et le bon code NIM, ces codes NIM devraient aussi être affectés a des budgets. Le découpage des budgets projets doit être revus, nous en discuterons plus tard.
- **S-9a · Formats d'échange avec MS Project et Primavera P6** — Autre réponse : Nos client aurons acces au planning dans le portail client, l'export au format PDF du planning détaillé et du gantt seront pour le moment suffisant.
- **S-13a · Parties prenantes : grille d'influence et dernier contact** — À discuter : (pas de note)
- **S-13b · Matrice RACI du projet** — Autre réponse : La grille ne doit pas etre modifiable, elle est en cours de définition et te sera donnée par la suite.
C'est une matrice par role, il faudra donc que tu identifie chaque role de la matrice a une personne de l'équipe projet.
- **C-8 · Base de calcul de la retenue de garantie** — À discuter : Il faut que je vois avec les service finance quelles genres de retenue oude garanties nous pouvons avoir
- **SC-7a · Saisie des devis des consultations** — À discuter : je dois me renseigner avant de te repondre
- **D-7b · Imports Excel / CSV pour la reprise des données** — À discuter : Ne traite rien pour le moment concernant les imports.

## Données, sources de vérité et intégrations

- **A-1a · Achats et stock : partage des rôles entre Keystone et Sage X3** (Bloquant production) : À discuter — *Je ne suis pas certains de modules et de la gestion qui est faite dans sage 3X.
Garde cette question car il faut que j'en discute avec le service finance, achat et la logistique.*
- **A-1b · Référentiel articles : qui est maître ?** (Bloquant production) : À discuter — *De mon point de vue, tout les numéros d'articles PLM sont pris par solidworks 3DX.
Laisse moi confirmer avec l'ingénierie*
- **A-2 · Projets sans données : modèle du type de machine** (Prochaine étape · défaut appliqué au chapitre 4) : Autre réponse — *Nous avons plusieurs type de projet et chacun doit voir son "standard" que le chef de projet pourra customiser.
Il nous faudra pour cela créer par type de projet un standard que l'on pourra mettre a jour dans Keystone, qui servira de socle pour le WBS, les budgets, et toutes les autres étapes ainsi que leurs livrables.*
- **A-3 · Vue d'ensemble : quels projets comptent comme « actifs » ?** (Prochaine étape) : Projets en exécution (Études → Mise en service) ★
- **A-4 · Demandes de modification : propagation au budget et au contrat** (Prochaine étape) : Registre unique, propagation automatique ★
- **A-5 · Facturation : le contrat fait foi** (Prochaine étape · défaut appliqué au chapitre 4) : Contrat seule référence, échéanciers repris ★
- **A-6 · Réserves : une liste ou deux ?** (Plus tard) : Une liste unique par projet ★
- **A-7 · Planning : barres et jalons calculés depuis le WBS** (Prochaine étape · défaut appliqué au chapitre 4) : Tout calculé depuis le WBS ★
- **A-8 · Provision pour aléas : définition du « consommé »** (Prochaine étape) : Le registre fait foi ★
- **A-9 · P&ID : révision de référence et repères en retard** (Plus tard) : Signaler l'écart et demander un ré-import ★
- **A-10 · Taux horaire pour valoriser les heures** (Prochaine étape) : Grille de taux par rôle, avec date d'effet ★
- **A-11 · Base de prix : nomenclature, commandes et stock** (Prochaine étape) : Prix réel d'abord ★
- **A-12 · Indicateurs figés : remplacés par des formules** (Prochaine étape · défaut appliqué au chapitre 4) : Formules sur les données ★
- **A-13 · Santé des projets : une seule règle** (Prochaine étape · défaut appliqué au chapitre 4) : Règle unique, seuils des Paramètres ★
- **A-14 · Listes des Paramètres : pilotage et droits** (Bloquant production · défaut appliqué au chapitre 4) : Pilotent les modules, modifiées par la direction ★
- **A-15 · Historiques fabriqués par le prototype** (Bloquant production) : Données réelles seulement ★
- **I-1a · Hébergement de Keystone (et des applications EPC2i)** (Bloquant production) : À discuter — *Cela reste encore a décider avec l'IT et la DSI, je pense que dans un premier temps un serveur cloud indépendant sera utilisé pour commencer le multiuser avec des beta testeurs avant de passer en production, au moment de passer en production il est possible que l'on migre vers Azure ou vers un serveur interne ou même que l'on reste en cloud, je ne sais pas*
- **I-1b · Sauvegardes : perte de données et délai de reprise acceptables** (Bloquant production) : Perte ≤ 15 min, reprise ≤ 4 h ★
- **I-2a · Connexion des salariés : fournisseur d'identité** (Bloquant production) : Microsoft Entra ID pour toutes les applications ★
- **I-2b · Connexion des clients au portail** (Bloquant production) : Pas d'accès client au lancement
- **I-3a · Ordre de branchement des connecteurs réels** (Prochaine étape) : D'abord Cursus, Codex et Vigie, puis X3, PDM, Microsoft ★
- **I-3b · Échanges avec Sage X3 : interface ou fichiers** (Prochaine étape) : À discuter — *La connection a sage risque d'être le point le plus bloquant du projet.
Ma proposition est que dans un premier temps nous ferons des extraction automatisées de certaines bases sage et un import automatisé dans keystone. pour la périodicité de ces imports avant la mise en production un import par jour devrait être suffisant pour epprouver notre outil?*
- **I-3c · Microsoft 365 : Outlook et Teams** (Plus tard) : Oui : Outlook, Teams et e-mails ★
- **NEW-SYS-1 · Code projet commun à Keystone, Cursus et Vigie** (Bloquant production) : Autre réponse — *Il existe deux forme pour identifier un projet chez nous, le code au format #000 qui est utilisé par l'ensemble des équipes ingénieries et une code dit analytique au format XXX000 qui est lui utilisé par la finance (et donc pas Sage 3X).
Je dois confirmer cela mais je pense que le numéro projet #000 vient d'un listing que l'on incrémente et que le numéro XXX000 est créé dans Sage et nous est donc imposé. Il faut trouver un moyen de réconcilier les deux et je pense que cela sera plus simple dans la fiche projet de keystone.*
- **V-2 · Échanges Keystone ↔ Vigie : mode et contrat** (Prochaine étape) : Keystone lit Vigie et lui envoie ses avancements ★
- **NEW-VIGIE-1 · ECO tant que Vigie n'a pas de module dédié** (Bloquant production) : Construire le module ECO de Vigie avant la mise en service
- **V-3a · Numéro de non-conformité et liens vers Vigie** (Prochaine étape) : Le numéro Vigie seul ★
- **V-3b · Pré-remplissage des signalements Vigie depuis Keystone** (Plus tard) : Oui : projet, article, activité, titre et lieu ★
- **NEW-CURSUS-1 · Chantier Cursus : création et lien avec le projet** (Prochaine étape) : Keystone crée le chantier dans Cursus (un par projet) ★
- **NEW-CURSUS-2 · Correspondance matricule Cursus ↔ personne Keystone** (Bloquant production) : Cursus fournit l'annuaire du personnel ★
- **NEW-CURSUS-3 · Liens ciblés et relances vers Cursus** (Plus tard) : Oui : liens ciblés et réception des relances ★
- **NEW-CURSUS-4 · Congés et absences : aussi depuis Cursus ?** (Prochaine étape) : Oui, depuis Cursus ; Lucca débranché ★
- **NEW-CURSUS-5 · Heures Cursus : par projet ou par activité ?** (Prochaine étape) : Par tâche Keystone, donc par activité ★
- **NEW-CURSUS-6 · Heures internes (codes INT-*) dans Keystone** (Prochaine étape) : Oui, un total hors projet par personne et par semaine ★
- **NEW-CURSUS-7 · Envoi des heures et absences : Cursus pousse ou Keystone interroge ?** (Prochaine étape) : Cursus pousse, avec renvoi en cas d'échec ★

## Droits d'accès et cycle de vie des projets

- **P-1 · Écrans hors de l'espace de travail : lecture seule ou accès refusé** (Bloquant production) : Lecture seule en interne, accès refusé pour le client ★
- **P-2 · Droits par projet pour les rôles autres que chef de projet et client** (Bloquant production) : Équipe projet nominative (CP, adjoints, référents) ★
- **P-3 · Qui peut créer un projet** (Bloquant production) : Directeur et chefs de projet ★
- **P-4 · Droits sur le contrat et la facturation client ; rôle Finance ?** (Bloquant production) : Autre réponse — *Le directeur, le CP et le Role Finance doivent pouvoir modifier la page contrat.*
- **P-5a · Seuils de montant pour approuver une commande d'achat** (Bloquant production) : Autre réponse — *Nous avons une procédure d'achats qui défini les montant et workflow de validation dans Sage. Il faudra que je te communique cette procédure pour que tu définisses les règles dans keystone et ce qui devra être communiqué a sage*
- **P-5b · Qui décide des factures fournisseurs et du contrôle à réception** (Prochaine étape · défaut appliqué au chapitre 4) : Répartition actuelle (achats/directeur, qualité/achats) ★
- **P-5c · Annulation d'une commande d'achat brouillon ou passée** (Prochaine étape) : Brouillon dans Keystone, commande passée dans Sage X3 ★
- **P-6a · Qui enregistre la décision du comité de contrôle des modifications** (Prochaine étape · défaut appliqué au chapitre 4) : Le directeur de portefeuille ★
- **P-6b · Ordre du circuit d'approbation des demandes de modification** (Prochaine étape) : Séquentiel : CP, directeur, client, puis comité ★
- **P-6c · Étapes non applicables dans une demande de modification** (Prochaine étape) : Règle automatique selon l'impact contractuel ★
- **P-7a · Approbation des ordres de modification technique (ECO)** (Plus tard) : déjà décidé
- **P-7b · Où approuver les documents Codex** (Bloquant production) : Dans Keystone, transmis à Codex (approbateur désigné) ★
- **P-7c · Validation de diffusion des livrables d'ingénierie** (Prochaine étape) : Lance le circuit Codex ; diffusé à la fin du circuit ★
- **P-7d · Délégation et absence des approbateurs** (Plus tard) : Suppléant déclaré par l'approbateur pour une période ★
- **P-8a · Périmètre des chefs de service sur les demandes de ressources** (Bloquant production) : Son service seulement ; le directeur pour tous ★
- **P-8b · Demandes de ressources pour du personnel externe** (Plus tard) : Tâche aux achats pour trouver et nommer l'intervenant ★
- **P-8c · Relancer une demande de ressource retirée** (Plus tard) : Oui, relance possible comme pour un refus ★
- **P-9a · Qui modifie le WBS et la logique du planning** (Prochaine étape) : CP et directeur ; les responsables saisissent l'avancement ★
- **P-9b · Qui rédige et envoie les comptes rendus de réunion** (Prochaine étape) : Organisateur et CP ; les internes ajoutent des notes ★
- **P-10a · Périmètre d'accès des utilisateurs client** (Bloquant production) : Projets de son organisation uniquement ★
- **P-10b · Ce que le client voit de son propre projet** (Bloquant production) : Cacher réunions internes, transcriptions, NC et achats ★
- **P-10c · Portail client séparé ou interface Keystone réduite** (Plus tard) : Interface Keystone au menu réduit (actuel) ★
- **P-11 · Aperçu « vue client » pour le directeur et le chef de projet** (Plus tard) : Directeur et CP du projet, en lecture seule ★
- **P-12 · Qui modifie la grille des taux horaires** (Prochaine étape) : Rôle Finance à créer, avec le directeur
- **P-13 · Auteur des actions et chef de projet à la création** (Bloquant production · défaut appliqué au chapitre 4) : Utilisateur connecté ; CP choisi dans l'assistant ★
- **P-14 · Qui modifie les types de machine standard** (Prochaine étape · défaut appliqué au chapitre 4) : Directeur, CP, ingénierie et qualité ★
- **L-1 · Validation d'un changement d'étape forcé** (Prochaine étape · défaut appliqué au chapitre 4) : Directeur de portefeuille : confirme ou fait revenir ★
- **L-2 · À quelle étape la référence BL1 est-elle figée** (Prochaine étape) : Fin d'APD, condition du passage en Études ★
- **L-3a · Création d'un projet à partir du modèle de type de machine** (Prochaine étape · défaut appliqué au chapitre 4) : À discuter — *Il y aura un modèle complet par type de machine, le chef de projet choisiera.
Je vais devoir te fournir les données standard (WBS, budgets, etc.) par type de machine, l'assistant fera une copie de tout cela que le chef de projet pourra customiser au besoin avant le lancement officiel du projet*
- **L-3b · Champs obligatoires de l'assistant de création de projet** (Prochaine étape) : Nom, client, chef de projet, type, début et lieu ★
- **L-4a · Règles de passage d'une étape à l'autre** (Prochaine étape) : Étape suivante ou Annulé seulement (actuel) ★
- **L-4b · Qui coche les livrables d'étape et fait avancer un projet** (Bloquant production) : CP du projet (et adjoints) et directeur ★
- **L-4c · Date enregistrée lors d'un changement d'étape** (Prochaine étape) : Date effective saisie, aujourd'hui par défaut ★
- **L-5a · Axes de notation d'une proposition de projet** (Plus tard) : 5 axes, les mêmes que le classement ★
- **L-5b · Source des données de capacité du portefeuille** (Plus tard) : Capacité réelle des équipes et charge des plannings ★
- **L-6 · Traitement des points soulevés par le client** (Prochaine étape) : Pris en charge par le chef de projet, réponse au client ★
- **L-7 · Carte des projets : étiquette de l'infobulle et légende** (Plus tard) : Les deux : étape et santé ★
- **L-8 · Horizon du planning de portefeuille** (Plus tard) : Fenêtre de 24 mois glissante, avec défilement ★
- **L-9 · Catégories de documents dans le portail client** (Plus tard) : Oui, calculées depuis les documents Codex partagés ★

## Planning, coûts et ressources

- **S-1 · Moteur de calcul du planning (chemin critique)** (Prochaine étape · défaut appliqué au chapitre 4) : Moteur réel, recalcul manuel « Replanifier » ★
- **S-2 · Calendriers de travail et jours fériés** (Prochaine étape · défaut appliqué au chapitre 4) : 4 calendriers, fériés français, 1 par projet + exception ★
- **S-3 · Références de planning (BL0, BL1, BL2…)** (Prochaine étape · défaut appliqué au chapitre 4) : Références successives, nouvelle via une modification ★
- **S-4 · Date de situation et horloge réelle** (Bloquant production) : Date de situation par projet, gel hebdo le vendredi ★
- **S-5 · Suppression d'un lot et contrôle des liens** (Plus tard · défaut appliqué au chapitre 4) : À discuter — *Nous devons demander une confirmation et garder la possibilité d'annulation.*
  - **Confirmé le 31/10/2026** : corbeille conservée 30 jours, 20 entrées au plus par projet, suppression et restauration réservées aux responsables du projet (chef de projet en titre, co-chef de projet, adjoint) et au directeur.
- **S-6 · Données propres aux lots de travaux** (Prochaine étape) : À discuter — *les codes analystiques que sage utilise sont redécoupés en codes NIM, je ferais une extraction pour que tu puisses avoir le détails et ainsi nous pourront attribuer par tache au projet le bon code analytique et le bon code NIM, ces codes NIM devraient aussi être affectés a des budgets. Le découpage des budgets projets doit être revus, nous en discuterons plus tard.*
- **S-7 · Scénarios « what-if » de nivellement des ressources** (Plus tard · défaut appliqué au chapitre 4) : Scénarios enregistrés ; « Appliquer » crée des demandes ★
- **S-8 · Unité des durées, marges et glissements** (Plus tard · défaut appliqué au chapitre 4) : Jours ouvrés partout ★
- **S-9a · Formats d'échange avec MS Project et Primavera P6** (Prochaine étape · défaut appliqué au chapitre 4) : Autre réponse — *Nos client aurons acces au planning dans le portail client, l'export au format PDF du planning détaillé et du gantt seront pour le moment suffisant.*
- **S-9b · Reprise des plannings existants au démarrage** (Bloquant production) : Import unique au démarrage, puis tout dans Keystone ★
- **S-10 · Analyse des transcriptions de réunion** (Plus tard · défaut appliqué au chapitre 4) : Fichier importé, analyse Claude ou locale, relecture ★
- **S-11 · Synchronisation des réunions avec Outlook** (Plus tard) : D'Outlook vers Keystone ★
- **S-12 · Actions de compte rendu confiées à des externes** (Plus tard) : Tâche de suivi pour le responsable interne de la relation ★
- **S-13a · Parties prenantes : grille d'influence et dernier contact** (Plus tard) : À discuter
- **S-13b · Matrice RACI du projet** (Plus tard) : Autre réponse — *La grille ne doit pas etre modifiable, elle est en cours de définition et te sera donnée par la suite.
C'est une matrice par role, il faudra donc que tu identifie chaque role de la matrice a une personne de l'équipe projet.*
- **C-1 · Couleurs des indicateurs du budget et sens des écarts** (Plus tard) : Couleurs selon seuils, barres signées ★
- **C-2a · Sources du coût réel et de la valeur acquise** (Prochaine étape) : Heures Cursus × taux + réceptions et factures Sage X3 ★
- **C-2b · Heures saisies sur les tâches Keystone** (Prochaine étape) : Supprimer la saisie d'heures dans Keystone
- **C-3 · Modifier les catégories de coûts d'un projet** (Plus tard) : Catégories des Paramètres, montant figé après BL1 ★
- **C-4 · Prélèvements sur la provision pour aléas** (Prochaine étape) : Lien obligatoire, validation du directeur ★
- **C-5 · Contenu du rapport d'avancement selon le public** (Prochaine étape) : Un PDF, contenu adapté au public ★
- **C-6 · Calcul des échéances de factures clients** (Prochaine étape · défaut appliqué au chapitre 4) : Règle choisie par contrat ★
- **C-7 · Total des jalons de paiement au-delà de 100 %** (Plus tard · défaut appliqué au chapitre 4) : Avertir, et bloquer la facturation au-delà de 100 % ★
- **C-8 · Base de calcul de la retenue de garantie** (Prochaine étape) : À discuter — *Il faut que je vois avec les service finance quelles genres de retenue oude garanties nous pouvons avoir*
- **C-9 · Gestion de plusieurs devises** (Bloquant production) : Devise par contrat et commande, consolidation en euros ★
- **C-10a · Prévision de trésorerie du portefeuille** (Prochaine étape · défaut appliqué au chapitre 4) : Plan de facturation + dépenses prévues du planning ★
- **C-10b · Définition de la marge des projets et du portefeuille** (Prochaine étape) : Marge à terminaison ★
- **R-1 · Capacité de travail d'une personne** (Prochaine étape) : Horaire contractuel de chacun, moins congés et fériés ★
- **R-2 · « Coût main-d'œuvre à date » sur l'écran Ressources** (Plus tard) : Total du portefeuille (filtré par zone) ★
- **R-3 · Bouton « Appliquer » du rééquilibrage suggéré** (Plus tard) : Créer une demande de ressource en brouillon ★
- **R-4a · Évolution des taux horaires dans le temps** (Prochaine étape) : Taux datés, heure valorisée au taux en vigueur ★
- **R-4b · Niveau de détail des taux horaires** (Prochaine étape) : Un taux par rôle
- **R-5a · Échelle de niveau des compétences** (Plus tard) : Échelle unique de 1 à 5 ★
- **R-5b · Compétences sans aucun expert** (Plus tard) : Deux indicateurs : aucun expert / un seul ★
- **R-6a · Répartition des heures Cursus sur les lots** (Prochaine étape) : Cursus envoie le détail par tâche Keystone ★
- **R-6b · Seuil d'alerte sur les écarts d'heures** (Plus tard) : ±10 % réglable, 10 % inclus, couleurs distinctes ★
- **R-7 · Fenêtre de semaines des plans de charge** (Prochaine étape) : 8 semaines glissantes depuis la semaine en cours ★
- **R-8a · Stockage des pièces jointes des tâches** (Plus tard · défaut appliqué au chapitre 4) : Stockées dans Keystone ★
- **R-8b · Mentions @personne dans les commentaires** (Plus tard) : Notification dans Keystone ★
- **R-8c · Glisser-déposer dans la vue Tableau des tâches** (Plus tard) : Oui, glisser change le statut ★
- **R-9 · Consulter le travail d'une autre personne** (Bloquant production · défaut appliqué au chapitre 4) : Selon la hiérarchie et les projets ★

## Achats, ingénierie, qualité, chantier et documents

- **SC-1 · Attribution d'une consultation : commande brouillon automatique** (Plus tard · défaut appliqué au chapitre 4) : Oui, commande brouillon au prix du devis ★
- **SC-2 · Statut « Payée » des factures fournisseurs** (Prochaine étape) : Synchronisation Sage X3 uniquement ★
- **SC-3a · Annulation et solde des commandes d'achat** (Prochaine étape) : Annulation possible à tout stade, avec motif ★
- **SC-3b · Refus à la réception : non-conformité fournisseur dans Vigie** (Prochaine étape) : Keystone ouvre le formulaire NC de Vigie pré-rempli ★
- **SC-4a · Rangement des bons de livraison et photos de réception** (Prochaine étape) : Bon de livraison dans Codex, photos dans Keystone ★
- **SC-4b · Document de commande envoyé au fournisseur** (Prochaine étape) : Bon de commande édité par Sage X3 ★
- **SC-5a · Sortie de stock : rattachement à une activité** (Prochaine étape) : Activité obligatoire, choisie dans le planning ★
- **SC-5b · Prendre du stock réservé par un autre projet** (Plus tard) : Interdit tant que la réservation n'est pas libérée ★
- **SC-6 · Note des fournisseurs (A/B/C)** (Plus tard) : Évaluation faite dans Vigie, affichée dans Keystone
- **SC-7a · Saisie des devis des consultations** (Prochaine étape) : À discuter — *je dois me renseigner avant de te repondre*
- **SC-7b · Liste de référence des fournisseurs** (Bloquant production) : Sage X3, repris dans Keystone ★
- **E-1a · Validation des nouveaux articles du catalogue** (Prochaine étape) : Validé par l'ingénierie ; péremption par ECO ★
- **E-1b · Données obligatoires d'un nouvel article** (Prochaine étape) : Minimum à la création, le reste avant validation ★
- **E-2a · Prix utilisé pour chiffrer la nomenclature** (Prochaine étape) : Prix commandé, sinon dernier achat, sinon catalogue ★
- **E-2b · Chiffrage des remplacements d'articles entre révisions** (Plus tard) : Oui : (nouveau prix − ancien prix) × quantité ★
- **E-3a · Stock affiché dans la liste des pièces d'usure et de rechange** (Plus tard · défaut appliqué au chapitre 4) : Total de tous les magasins ★
- **E-3b · Bouton « Créer une commande de pièces de rechange »** (Plus tard) : Commande brouillon « pièces de rechange » ★
- **E-4 · Pièces à garder pour les machines en service** (Plus tard) : Seulement les pièces montées sur la machine ★
- **E-5 · Révision qui fait foi pour une donnée d'entrée d'ingénierie** (Prochaine étape) : La dernière révision figée ou diffusée ★
- **E-6 · Recherche d'un article pour un repère du schéma P&ID** (Plus tard) : Tout le catalogue, nomenclature du projet en tête ★
- **E-7 · Contenu de la synchronisation avec SolidWorks PDM** (Prochaine étape) : Données des plans + aperçu PDF, chaque heure ★
- **E-8 · Configuration réelle des machines livrées** (Prochaine étape) : Créée à la livraison du projet, tenue par le SAV ★
- **E-9 · Types de machines : portée des modifications** (Plus tard · défaut appliqué au chapitre 4) : Nouveaux projets seulement ★
- **Q-1 · Calcul de l'exposition financière des risques (EMV)** (Prochaine étape) : Coût saisi, EMV = coût × P/5 ★
- **Q-2 · Rapport 8D et modification des non-conformités** (Plus tard) : déjà décidé
- **Q-3a · Livrable refusé par le client** (Prochaine étape) : Retour « En cours » avec la révision suivante ★
- **Q-3b · Création des livrables contractuels** (Prochaine étape) : Ajout manuel par le chef de projet ★
- **Q-4 · Date de réception d'une interface** (Plus tard) : Oui, date du jour modifiable ★
- **Q-5 · Avancement des étapes de mise en service** (Prochaine étape) : Contrôlée par Keystone, validée par un responsable ★
- **Q-6a · Saisie des résultats d'inspection** (Prochaine étape) : La qualité et le responsable ingénierie ★
- **Q-6b · Inspection non conforme : non-conformité dans Vigie** (Prochaine étape) : Keystone ouvre le formulaire NC de Vigie pré-rempli ★
- **Q-7 · Numérotation des enregistrements** (Bloquant production) : Par projet pour les registres projet, commune ailleurs ★
- **Q-8 · Suivi des réclamations sous garantie** (Prochaine étape) : Suivi complet, piloté par le responsable SAV ★
- **Q-9 · Source de l'enquête de satisfaction client** (Plus tard) : Questionnaire rempli par le client sur son portail ★
- **D-1a · Dépôt d'un document dans Codex depuis Keystone** (Prochaine étape) : Keystone ouvre le formulaire de dépôt Codex pré-rempli ★
- **D-1b · Où approuver les documents Codex** (Prochaine étape) : Depuis Keystone, décision transmise à Codex ★
- **D-2 · Informations reprises de Codex pour chaque document** (Plus tard) : Fiche, révision en cours et circuit en cours ★
- **D-3 · Ouverture du module Chantier** (Prochaine étape) : Le chef de projet crée la fiche quand il veut ★
- **D-4 · Actions automatiques sur les prérequis client en retard (J-15)** (Plus tard) : Notification et proposition de risque ★
- **D-5 · Journal des échanges avec le client sur le chantier** (Plus tard) : Utiliser les réunions et décisions du projet ★
- **D-6a · Relance Cursus pour un « GO avec réserve »** (Plus tard) : Oui, pour faire lever la réserve ★
- **D-6b · Résolution des conflits de planning de l'équipe chantier** (Prochaine étape) : Mise à jour automatique + arbitrage manuel ★
- **D-7a · Réglage des connecteurs** (Prochaine étape) : Par l'informatique, en dehors de l'application ★
- **D-7b · Imports Excel / CSV pour la reprise des données** (Bloquant production) : À discuter — *Ne traite rien pour le moment concernant les imports.*
- **NEW-SITE-1 · Go chantier sans aucun verdict Cursus** (Prochaine étape) : Non : au moins un verdict reçu, aucun NO GO ★
- **NEW-SITE-2 · Source des incidents HSE du chantier** (Plus tard) : Incidents déclarés dans Vigie ★

## Plateforme, ergonomie, langues et charte graphique

- **X-1 · Langue par défaut et mémorisation du choix** (Plus tard) : Français par défaut, choix mémorisé par utilisateur ★
- **X-2 · Adresses des écrans et liens directs vers les fiches** (Plus tard · défaut appliqué au chapitre 4) : Valider tel quel ★
- **X-3 · Contenu du bouton Exporter de l'en-tête** (Prochaine étape · défaut appliqué au chapitre 4) : Vue affichée, filtres compris, en CSV, Excel ou PDF ★
- **X-4 · Appareils cibles : ordinateur, tablette, téléphone** (Prochaine étape) : Ordinateur + tablette (menu repliable, écrans chantier) ★
- **X-5 · Portée de la recherche globale** (Plus tard) : Tout le portefeuille, filtré selon les droits ★
- **X-6a · Quels événements déclenchent une notification, et pour qui** (Prochaine étape) : Les événements clés, aux personnes concernées ★
- **X-6b · Canaux de notification : Keystone, e-mail, Teams** (Prochaine étape) : Keystone + e-mail, préférences par utilisateur
- **X-7 · Fermeture des menus, panneaux et fenêtres** (Plus tard · défaut appliqué au chapitre 4) : Valider ce comportement ★
- **X-8 · Nom du groupe quand une section du menu est repliée** (Plus tard) : Toujours afficher le nom du groupe ★
- **X-9 · Message de confirmation après une création ou une demande** (Plus tard) : Oui, un message pour les trois ★
- **X-10 · Nom du projet sous le titre des formulaires hors projet** (Plus tard) : Retirer partout où le formulaire ne vise pas un projet ★
- **X-11 · Justification des demandes de modification (CR) : qui la voit** (Plus tard · défaut appliqué au chapitre 4) : Affichée dans la fiche et transmise au client avec la CR ★
- **X-12a · Vocabulaire métier en mode anglais (étapes, livrables, modèles)** (Prochaine étape) : Ajouter un libellé anglais à chaque terme métier ★
- **X-12b · Textes saisis par les équipes ou reçus de Vigie et Cursus** (Plus tard · défaut appliqué au chapitre 4) : Afficher tels que saisis, sans traduction ★
- **X-13a · Palette sans rouge, orange ni vert, et accessibilité** (Plus tard) : Garder la palette, avec texte ou icône sur chaque statut ★
- **X-13b · Même couleur pour un même statut sur tous les écrans** (Plus tard) : Harmoniser : un statut = une couleur partout ★
- **X-14 · Détails techniques de la charte graphique** (Plus tard · défaut appliqué au chapitre 4) : Laisser à l'équipe technique (fidélité au prototype) ★
- **X-15 · Stockage des photos et des aperçus (réception, chantier, P&ID)** (Prochaine étape) : Photos dans Keystone ; aperçus lus dans Codex et le PDM ★
- **X-16 · Corrections des libellés erronés du prototype** (Plus tard · défaut appliqué au chapitre 4) : Valider et corriger aussi le message des machines ★

## Points relevés pendant les livraisons

- **NEW-D4-1 · Adresses des écrans ECO dans Vigie** (Bloquant production) : Vigie reprend les adresses proposées par Keystone ★
- **NEW-D2-1 · Confidentialité des taux horaires et des prix fournisseurs** (Bloquant production) : Directeur et chef de projet (+ achats pour les prix) ★
- **NEW-D3-1 · Droits de dépôt dans Codex depuis Keystone** (Bloquant production) : L'équipe interne du projet seulement ★
- **NEW-D3-2 · Lieu du site dans l'assistant de création de projet** (Prochaine étape) : Pays et ville obligatoires, zone déduite du pays ★
- **NEW-D1-1 · Règles des alertes du portefeuille** (Prochaine étape) : Règles calculées, seuils dans Paramètres ★
- **NEW-D1-2 · Langue des textes saisis (titres, noms, lots)** (Prochaine étape) : Afficher tel que saisi, sans traduction ★
- **NEW-D3-3 · Effet d'un avenant sur les jalons déjà facturés** (Prochaine étape) : L'avenant a ses propres jalons ★
- **NEW-D4-2 · Sortie de stock réservé pour un autre projet** (Prochaine étape) : Refuser, sauf accord du chef de l'autre projet ★
- **NEW-D4-3 · Réception refusée : non-conformité fournisseur dans Vigie** (Prochaine étape) : Formulaire Vigie prérempli + alerte à l'acheteur ★
- **NEW-D4-4 · Liste de référence des fournisseurs** (Prochaine étape) : Copie du fichier fournisseurs de Sage X3 ★
- **NEW-D2-2 · Lien entre demande de modification et activités du planning** (Prochaine étape) : Lot + activités touchées (facultatif) ★
- **NEW-D5-1 · Origine des listes d'ingénierie importées** (Prochaine étape) : Exports natifs (EPLAN, TIA Portal, SolidWorks)
- **NEW-D5-2 · Garantie : coût de l'année et prolongations** (Plus tard) : Année civile + date de fin prolongée ★
- **NEW-D4-5 · Grue EQ-CRN-250T et ASM-RMG-250 : un ou deux équipements ?** (Plus tard) : À faire vérifier par le bureau d'études ★
- **NEW-D5-3 · Mot français pour l'étape « Handover »** (Plus tard) : Transfert ★

## Questionnaire de la livraison 9 (réponses du 31/10/2026)

Questionnaire publié en artefact (https://claude.ai/artifact/1exn6XRVeQRgTtz5ZAYmKy, collection `answers`), questions dans `docs/decisions/questions-livraison-9.json`. ★ = choix par défaut confirmé.

### Gantt interactif (R-198)

- **L9-G1 · Le recalcul immédiat du chemin critique doit-il valoir aussi pour le tableau du Plan ?** : Gantt seulement : le Plan garde le recalcul manuel ★
- **L9-G2 · Quand on dépose une barre plus tôt que ses prédécesseurs ne le permettent ?** : Garder la contrainte « au plus tôt » : la logique l’emporte, sans message ★
- **L9-G3 · Sur quelle vue l’écran Planning s’ouvre-t-il ?** : Lots de travaux ★
- **L9-G4 · Faut-il un filtre par ligne d’équipement sur le Gantt des activités ?** : Non pour l’instant ★
- **L9-G5 · Faut-il pouvoir déplacer un lot de travaux entier d’un seul glisser ?** : Non ★

### Rappels d’échéances et rapports programmés (R-199)

- **L9-R1 · Quand rappeler une échéance ?** : J-7, J-1, puis un seul rappel une fois en retard ★
- **L9-R2 · Qui reçoit les rappels des jalons et des prérequis clients ?** : Le chef de projet en titre ★
- **L9-R3 · Quel rapport hebdomadaire envoyer aux responsables du projet ?** : Version « pilotage » ★
- **L9-R4 · Qui reçoit le rapport portefeuille hebdomadaire ?** : Les directeurs ★
- **L9-R5 · Quel jour et à quelle heure partent les rapports ?** : Le lundi matin, à l’heure des rappels ★
- **L9-R6 · L’e-mail est-il activé par défaut pour tout le monde ?** : Oui, activé par défaut ★

### Notifications par e-mail (R-036)

- **L9-N1 · Comment envoyer les notifications par défaut ?** : E-mail immédiat pour ce qui attend une action, résumé quotidien pour le reste ★
- **L9-N2 · À quelle heure part le résumé quotidien ?** : 7 h ★
- **L9-N3 · Les alertes d’indicateur (règles R-130) vont-elles aussi à la Finance ?** : Non ★
- **L9-N4 · L’invitation à la SAT part-elle aussi aux témoins qui n’ont pas de compte ?** : Non, seulement les contacts du client externe qui ont un compte ★

### Suppléance des validations (R-051)

- **L9-D1 · Le nom du suppléant doit-il figurer sur la pièce elle-même ?** : Non, l’audit suffit ★
- **L9-D2 · Faut-il signaler à Codex et à Vigie qu’une décision a été prise par un suppléant ?** : Non ★

### Fiche modifiée entre-temps (R-010)

- **L9-C1 · Faut-il étendre le contrôle « fiche modifiée entre-temps, rechargez » à d’autres écrans ?** : Non pour l’instant ★

### Pack d’ingénierie (R-191)

- **L9-E1 · Qui peut modifier la liste standard du pack d’ingénierie par type de machine ?** : Directeur, chef de projet, responsable ingénierie et qualité ★

### Expéditions (R-158)

- **L9-X1 · La liste des documents générés par Keystone vous convient-elle ?** : Oui, cette liste ★
- **L9-X2 · Le portail client reste-t-il réservé aux clients externes ?** : Autre réponse — *Le portail sera accessible à tout le monde (le groupe, nous, les filiales), mais pas aux externes au groupe. Par contre des .exe qui tournent sous Windows seront bienvenus pour les utilisateurs qui le souhaitent.* — **Précisé le 31/10/2026** : le portail des filiales est Arche (décision 6 du 25/10/2026 confirmée) ; pas d’accès pour les externes au groupe. L’accès web reste la solution pour accéder à Keystone de n’importe où ; une application Windows (.exe) validée le même jour coexiste avec lui pour laisser le choix à l’utilisateur (R-210). Le portail client de Keystone est gardé en réserve, sans compte client externe.
- **L9-X3 · La démonstration doit-elle contenir des documents d’expédition déjà déposés dans Codex ?** : Oui, en pré-déposer quelques-uns
