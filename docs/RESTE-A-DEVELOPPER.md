# Keystone PM — reste à développer

Inventaire initial du 2026-10-10, mis à jour le 2026-11-01 (branche `main-2a2fep`). Il recense ce qu'il reste à développer, à brancher, à décider ou à mettre en production pour passer de la reconstruction du prototype à un outil utilisé en production par EPC2i. Il est tenu à jour à chaque développement : un point passe « en cours » quand une livraison le prend, « fait » quand elle est intégrée et vérifiée. Page interactive : https://claude.ai/artifact/NmH1NN5BjedvgHRjKaPpGc.

**Méthode.** Onze relectures indépendantes ont croisé les 195 décisions produit (`docs/DECISIONS.md`), les écarts et questions ouvertes de `DELIVERY-1.md` à `DELIVERY-6.md`, `docs/BACKLOG.md`, les marqueurs du code (TODO, simulations, constantes du prototype), la spécification fonctionnelle (`docs/spec/`) et la préparation à la production. Chaque point a ensuite été vérifié dans le code, catégorie par catégorie : ce qui existait déjà a été écarté (153 candidats), les doublons fusionnés, puis un contrôle de complétude a ajouté ce qui manquait. Le détail, avec les preuves relevées dans le code pour chaque point, est dans `docs/reste-a-developper.json` ; ce document et la page sont produits par `npm run remaining:page`.

**Lecture.** Priorité : celle du responsable produit quand une décision la donne (Bloquant production, Prochaine étape, Plus tard), « À décider » quand il faut d'abord trancher. Effort, pour un développeur qui connaît le code : S < 2 jours, M ≤ 1 semaine, L ≤ 3 semaines, XL > 3 semaines. Les identifiants entre parenthèses renvoient aux décisions (`docs/DECISIONS.md`) ou aux documents de livraison.

## 1. En bref

**Avancement** : 122 faits, 33 en cours, 55 à faire, sur 210 points.

| Priorité | Points restants | Effort estimé (jours) |
|---|---:|---:|
| Bloquant production | 15 | ≈ 102 |
| Prochaine étape | 27 | ≈ 243 |
| À décider | 26 | ≈ 191 |
| Plus tard | 20 | ≈ 126 |
| **Total** | **88** | **≈ 662** |

L'effort est un ordre de grandeur (S = 1,5 j, M = 4 j, L = 12 j, XL = 30 j) : il ne compte ni l'attente des décisions et des données, ni les développements à faire côté Vigie, Cursus, Codex ou Sage X3, ni la recette.

| Statut (points restants) | Points |
|---|---:|
| Non commencé | 39 |
| Partiel | 9 |
| Attend le responsable produit | 28 |
| Attend un système externe | 12 |

| Domaine | Bloquant production | Prochaine étape | À décider | Plus tard | Restants | Faits |
|---|---:|---:|---:|---:|---:|---:|
| Plateforme et mise en production | 6 | 4 | 0 | 2 | 12 | 15 |
| Authentification, utilisateurs et droits | 1 | 0 | 2 | 0 | 3 | 14 |
| Intégrations avec les autres systèmes | 5 | 7 | 2 | 6 | 20 | 6 |
| Projets, cycle de vie et modèles par type de machine | 0 | 1 | 2 | 2 | 5 | 5 |
| Planning | 1 | 2 | 3 | 1 | 7 | 5 |
| Coûts, contrat et finance | 0 | 3 | 2 | 0 | 5 | 13 |
| Ressources et RH | 0 | 2 | 1 | 1 | 4 | 5 |
| Achats et stock | 2 | 1 | 2 | 0 | 5 | 4 |
| Ingénierie et PLM | 0 | 1 | 1 | 0 | 2 | 10 |
| Qualité, chantier et mise en service | 0 | 1 | 2 | 0 | 3 | 10 |
| Documents | 0 | 1 | 0 | 0 | 1 | 4 |
| Portefeuille, pilotage et indicateurs | 0 | 2 | 0 | 0 | 2 | 8 |
| Portail client | 0 | 0 | 1 | 2 | 3 | 3 |
| SAV et parc installé | 0 | 0 | 0 | 1 | 1 | 3 |
| Ergonomie, langues et accessibilité | 0 | 1 | 0 | 1 | 2 | 13 |
| Dette technique | 0 | 1 | 0 | 3 | 4 | 3 |
| Nouveaux modules demandés ou proposés (à valider) | 0 | 0 | 8 | 1 | 9 | 1 |

### 1.1 Chemin critique vers la production

Les points « Bloquant production » restants, par domaine. Sans eux, Keystone reste un démonstrateur mono-utilisateur sur des données de démonstration.

- **Plateforme et mise en production** : R-003 Héberger une instance multi-utilisateur (bêta puis production) *(en cours, Livraison 8)* ; R-004 Mettre en place sauvegardes et restauration (RPO ≤ 15 min, RTO ≤ 4 h) *(en cours, Livraison 8)* ; R-012 Faire la reprise initiale des plannings et données existants ; R-014 Numéroter les registres projet par projet (Q-7) ; R-173 Mettre Keystone en conformité RGPD (données personnelles, conservation, sous-traitants) *(en cours, Livraison 8)* ; R-174 Faire auditer la sécurité avant production (test d'intrusion, veille des dépendances) *(en cours, Livraison 8)*.
- **Authentification, utilisateurs et droits** : R-044 Créer le rôle Finance (contrat, facturation, grille de taux) *(en cours, Livraison 8)*.
- **Intégrations avec les autres systèmes** : R-022 Réconcilier les codes projet (#000, XXX000, Cursus, Vigie) dans la fiche projet ; R-024 Faire construire le module ECO de Vigie avec les adresses proposées *(en cours, Livraison 8)* ; R-027 Importer l’annuaire du personnel de Cursus (matricule ↔ personne) *(en cours, Livraison 8)* ; R-033 Construire le connecteur Codex (index, approbations, dépôts, liens profonds) *(en cours, Livraison 8)* ; R-034 Construire le connecteur Sage X3 (extractions quotidiennes et envois) *(en cours, Livraison 8)*.
- **Planning** : R-060 Gérer la date de situation par projet et le gel hebdomadaire du vendredi.
- **Achats et stock** : R-093 Reprendre la liste des fournisseurs de Sage X3 et supprimer la saisie libre ; R-094 Appliquer la procédure d’achats (seuils et circuit de validation des commandes).

### 1.2 Ce qui attend le responsable produit

Décisions à prendre et données à fournir avant de pouvoir développer. Les questions nouvelles de `DELIVERY-6.md` §8 ne figurent pas encore dans le questionnaire : une nouvelle série de questions est à prévoir.

- **R-012** Faire la reprise initiale des plannings et données existants — Arbitrage du responsable produit entre S-9b (import unique) et D-7b (« rien sur les imports pour le moment »), puis fichiers MS Project / P6 des projets actifs
- **R-019** Adapter ou retirer l’application macOS Keystone.app — Décision du responsable produit une fois l’hébergement choisi (I-1a)
- **R-022** Réconcilier les codes projet (#000, XXX000, Cursus, Vigie) dans la fiche projet — Confirmation par le responsable produit de l’origine des codes #000 et XXX000
- **R-030** Recevoir les heures validées Cursus par tâche et remplacer l’écran Heures (Lucca) — Validation du périmètre par le responsable produit (BACKLOG §1 bis) et évolution de Cursus pour envoyer l’identifiant de tâche Keystone
- **R-034** Construire le connecteur Sage X3 (extractions quotidiennes et envois) — Partage des rôles Keystone / X3 (A-1a, avec finance, achats et logistique), extractions Sage et procédure d’achats (P-5a)
- **R-040** Décider où s’attribuent les rôles (groupes Entra ou écran Keystone) — Choix du responsable produit et de l’IT
- **R-053** Créer le standard complet par type de machine et l’instancier à la création — Données standard par type de machine (WBS, budgets, durées, livrables, ITP) promises par le responsable produit (A-2, L-3a)
- **R-056** Choisir une source de géocodage pour les sites des nouveaux projets — Choix du responsable produit (DELIVERY-6 §8 L-3b)
- **R-058** Intégrer la matrice RACI d’entreprise, par rôle et non modifiable — Matrice RACI par rôle, en cours de définition par le responsable produit
- **R-059** Trancher la grille pouvoir / intérêt et le « dernier contact » des parties prenantes — Discussion avec le responsable produit (S-13a, « À discuter » sans note ; statut Plus tard)
- **R-060** Gérer la date de situation par projet et le gel hebdomadaire du vendredi — Précision du responsable produit : ce qui fait avancer la date (tâche du vendredi, action du CP, Replanifier) et ce que le gel enregistre (DELIVERY-6 §8 S-4)
- **R-063** Trancher les règles restantes des références de planning (S-3) — Réponse du responsable produit (DELIVERY-6 §8 S-3)
- **R-065** Valider puis ajouter l’éditeur d’exceptions de calendrier — Validation du responsable produit (fonction hors prototype)
- **R-066** Valider puis rendre éditables les contraintes de date des activités — Validation du responsable produit (fonction absente du prototype)
- **R-078** Définir avec la finance la retenue de garantie et les cautions — Retour du service finance (C-8 « À discuter »)
- **R-082** Affecter codes analytiques et codes NIM par tâche, budgets par code NIM — Extraction Sage des codes analytiques et NIM, puis discussion sur le découpage des budgets
- **R-091** Préciser les règles des scénarios what-if et des brouillons — Réponses du responsable produit (DELIVERY-6 §8 S-7)
- **R-092** Arbitrer le partage achats / stock entre Keystone et Sage X3 — Discussion du responsable produit avec finance, achats et logistique (modules utilisés dans Sage X3)
- **R-093** Reprendre la liste des fournisseurs de Sage X3 et supprimer la saisie libre — Extraction automatisée du fichier fournisseurs Sage X3 (R-034, I-3b) et partage des rôles (A-1a)
- **R-094** Appliquer la procédure d’achats (seuils et circuit de validation des commandes) — Procédure d’achats fournie par le responsable produit
- **R-100** Décider comment les devis fournisseurs entrent dans les consultations — Réponse du responsable produit (SC-7a « je dois me renseigner »)
- **R-101** Trancher qui est maître du référentiel articles (3DX / PDM ou Keystone) — Confirmation de l’ingénierie (A-1b, marqué Bloquant production)
- **R-107** Lire les exports natifs EPLAN, TIA Portal et SolidWorks — Échantillons d’exports réels de chaque outil fournis par l’ingénierie ; confirmation que D-7b ne s’applique pas
- **R-123** Statuer sur le journal client retiré et la notion de « décision client » — Réponse du responsable produit (DELIVERY-6 §8 D-5)
- **R-141** Recueillir l’enquête de satisfaction client par le portail — Ouverture de l’accès client au portail (I-2b : pas d’accès client au lancement)
- **R-142** Préciser l’onglet Planning du portail client et les PDF de planning — Réponses du responsable produit (DELIVERY-6 §8 S-9a)
- **R-159** P1 · Relance fournisseurs et inspections usine (à valider) — Validation de la proposition par le responsable produit
- **R-160** P2 · Conformité CE et dossier technique machine (à valider) — Validation de la proposition et du périmètre réglementaire par le responsable produit
- **R-161** P3 · Réclamations contractuelles et pénalités (à valider) — Validation de la proposition par le responsable produit
- **R-162** P4 · Exposition de change par projet et alertes de couverture (à valider) — Validation de la proposition par le responsable produit (non retenue dans la réponse C-9) ; R-075 d’abord
- **R-163** P5 · Missions et mobilisation internationale (à valider) — Validation par le responsable produit ; partage des rôles avec Cursus
- **R-164** P6 · Offres et chiffrage avant-vente (à valider) — Validation de la proposition ; standards par type de machine (A-2, L-3a)
- **R-165** P7 · Outillage et étalonnage (à valider) — Validation de la proposition par le responsable produit
- **R-166** P8 · Application chantier hors ligne (à valider) — Validation de la proposition ; X-4 et X-15 réalisés d’abord
- **R-178** Fournir et charger les listes de référence réelles d'EPC2i — Listes métier validées par la direction (catégories, compétences, taux, services, clients, lieux)
- **R-179** Choisir la connexion des clients avant d'ouvrir le portail — Décision du responsable produit et de la DSI sur la date d'ouverture du portail et le mode de connexion client
- **R-181** Décider qui crée le projet dans Codex et Vigie à sa création dans Keystone — Décision du responsable produit ; API de création de projet côté Codex et Vigie
- **R-182** Décider si les factures client sont émises et encaissées dans Sage X3 — Service finance : processus de facturation client dans Sage X3 (numérotation légale, encaissements, facturation électronique)
- **R-189** Vues de suivi pour le CAPEX : jalons, avancement côté vente, avenants, réserves — Réponse P-05 (données financières visibles par la filiale)
- **R-192** Sécurité machine : HazOp / AMDEC, ATEX, condition PSSR avant mise en service — Vigie : porte-t-il HazID / HazOp / AMDEC / PSSR ?

### 1.3 Ce qui attend les autres applications

- **R-023** Brancher l’API Vigie réelle (NC, HSE, ECO) et passer au numéro Vigie — API d’échange de Vigie (contrat, endpoints, authentification)
- **R-024** Faire construire le module ECO de Vigie avec les adresses proposées — Équipe Vigie : module ECO et routes /modifications-techniques, /<id>, /nouvelle
- **R-025** Pré-remplir les signalements Vigie et filtrer ses listes par projet — Évolution de Vigie (lecture des paramètres et filtre par projet Keystone)
- **R-026** Afficher la note fournisseur A/B/C évaluée dans Vigie — Évaluation des fournisseurs et API correspondante dans Vigie
- **R-027** Importer l’annuaire du personnel de Cursus (matricule ↔ personne) — Nouvel accès « annuaire » côté Cursus
- **R-028** Créer le chantier Cursus depuis Keystone (un par projet) — Point d’API de création de chantier dans Cursus ; création de la fiche chantier dans Keystone (D-3)
- **R-032** Finaliser les liens ciblés et les relances vers Cursus — Cursus : routes ciblées et point de réception des relances
- **R-033** Construire le connecteur Codex (index, approbations, dépôts, liens profonds) — API et routes de Codex (index, approbations, dépôt pré-rempli, liens profonds, D-1)
- **R-035** Brancher SolidWorks PDM / 3DEXPERIENCE (plans, aperçus, « Ouvrir dans PDM ») — Accès API ou export SolidWorks PDM / 3DX (IT et ingénierie) ; décision A-1b
- **R-037** Synchroniser les réunions Outlook / Teams vers Keystone (S-11) — Déclaration de Keystone dans Microsoft 365 et accès Graph par l’IT (I-3c)
- **R-074** Alimenter le coût réel depuis Cursus et Sage X3 — Heures Cursus (R-030), extractions Sage X3 (R-034) et grille de taux datée (R-083)
- **R-125** Déposer dans Codex via son formulaire pré-rempli — Routes et paramètres du formulaire de dépôt Codex, et lecture de l’index Codex pour le retour de la fiche

## 2. Liste détaillée par domaine

### 2.1 Plateforme et mise en production (12 restants, 15 faits)

**R-003 · Héberger une instance multi-utilisateur (bêta puis production)** — *Bloquant production · partiel · effort M* · **en cours (Livraison 8)**  
La PR #1 (ouverte, non fusionnée) apporte un Dockerfile Coolify : un seul conteneur next start sur le port 3000, PGlite et fichiers sur un volume /data. Il reste à la rebaser sur la livraison 6, construire et tester l’image, ajouter NEXT_PUBLIC_CODEX_URL aux arguments de build, configurer TLS et domaine, et protéger l’accès tant que l’authentification manque. Ensuite viennent la préproduction et la production avec PostgreSQL et un worker ; leur cible (Azure, serveur interne ou cloud) reste à décider. Analyse comparative du 25 oct. 2026 : l’hébergement d’une instance multi-utilisateur est un prérequis de production (bloquant), rappelé par l’analyse comparative ; aucun changement de priorité.  
*Avancement : Livraison 8 : kit conteneur Compose pour Coolify et job CI d’image, fusionnés dans main (PR #2) ; il remplace le Dockerfile de la PR #1. Reste à choisir l’hébergement (I-1a) et à déployer la bêta multi-utilisateur. · Attend : Relecture et fusion de la PR #1 après la livraison 6 ; choix de la cible de production avec l’IT et la DSI (I-1a « À discuter ») · Sources : I-1a, 00 §8.15, DECISIONS.md « À traiter en priorité », PR #1 claude/deploiement-coolify, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-004 · Mettre en place sauvegardes et restauration (RPO ≤ 15 min, RTO ≤ 4 h)** — *Bloquant production · non commencé · effort M* · **en cours (Livraison 8)**  
Sauvegarder la base en continu (restauration à un instant donné) ainsi que les fichiers stockés par Keystone, et écrire une procédure de restauration testée en moins de 4 h. Rien n’existe aujourd’hui : la base est un dossier PGlite local.  
*Avancement : Livraison 8 : sauvegardes planifiées (10 min, rétention 48 h / 30 j / 12 m) et restauration vérifiée ; copie hors site et PITR attendent l’hébergement (I-1a). · Attend : Hébergement choisi (I-1a) · Sources : I-1b, 00 §8.10*

**R-012 · Faire la reprise initiale des plannings et données existants** — *Bloquant production · attend le responsable produit · effort M*  
S-9b demande d’importer une seule fois les plannings des projets en cours (MS Project / P6), et éventuellement des tables Excel/CSV, puis de tout planifier dans Keystone. Les importeurs MSPDI, XER et tables sont construits et testés mais désactivés par D-7b (« ne rien traiter pour le moment »). Il faut le feu vert et le périmètre, activer IMPORTS_ENABLED, ajouter le choix du projet dans un XER multi-projets, déplacer la replanification dans la transaction d’écriture et écrire la procédure de migration par projet. Analyse comparative du 25 oct. 2026 : l’import MS Project (MSPDI) et Primavera (XER) avec reprise des plannings existants est un standard du marché (MS Project, P6, Smartsheet) ; les parseurs existent mais IMPORTS_ENABLED=false (src/domain/ch4-defaults.ts, D-7b). Priorité suggérée P1 : condition du remplacement de MS Project.  
*Attend : Arbitrage du responsable produit entre S-9b (import unique) et D-7b (« rien sur les imports pour le moment »), puis fichiers MS Project / P6 des projets actifs · Sources : S-9b, D-7b, DELIVERY-6.md §4 Interchange, §8 D-7b / S-9b, docs/delivery-6/notes-admin-settings.md §2.1, §4.5, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-014 · Numéroter les registres projet par projet (Q-7)** — *Bloquant production · non commencé · effort M*  
Les registres projet (risques, demandes de modification, réunions, livrables, réserves, interfaces, leçons…) doivent être numérotés par projet, par exemple R-HLT-026-01 ou CR-HLT-026-03 ; commandes, réceptions, machines et réclamations gardent une numérotation commune. Il faut un service de numérotation (entité NumberSequence) et adapter liens profonds et recherche.  
*Attend : Format du code projet à confirmer (NEW-SYS-1) · Sources : Q-7, 07 OQ22, 05 OQ15, 11 §3.12 NumberSequence, DELIVERY-2.md §6, DELIVERY-3.md §6*

**R-173 · Mettre Keystone en conformité RGPD (données personnelles, conservation, sous-traitants)** — *Bloquant production · non commencé · effort M* · **en cours (Livraison 8)**  
Keystone stocke des données personnelles (absences dont « maladie » visibles par tous les rôles qui ouvrent Congés, taux horaires, compétences, e-mails des parties prenantes, transcriptions de réunion, journaux nominatifs) et peut envoyer les transcriptions à Anthropic. Il faut tenir le registre des traitements avec le DPO, minimiser (masquer le motif d'absence, cloisonner le calendrier des congés), fixer et appliquer des durées de conservation (audit, export_log, notifications, fichiers), encadrer les droits d'accès et d'effacement, et signer les contrats de sous-traitance (hébergeur, Anthropic). Tant que ce n'est pas validé, l'analyse par Claude reste désactivée en production. Analyse comparative du 25 oct. 2026 : la conformité RGPD est un prérequis de production (bloquant), rappelé par l’analyse comparative ; aucun changement de priorité.  
*Avancement : Livraison 8 : partie constructible du RGPD (types d’absence sans motif, rappel DPA pour l’analyse Claude, minimisation des décisions) ; registre et durées de conservation attendent le responsable produit. · Attend : DPO / DSI : registre des traitements, base légale, contrats de sous-traitance (hébergeur, Anthropic) · Sources : S-10, R-1, NEW-CURSUS-4, 00 §7.12 (Cursus : aucune donnée personnelle importée), docs/spec/10-site-docs-mywork-settings.md l.334 (notice de confidentialité), DELIVERY-6.md §2 (Analyse par Claude), Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-174 · Faire auditer la sécurité avant production (test d'intrusion, veille des dépendances)** — *Bloquant production · non commencé · effort M* · **en cours (Livraison 8)**  
Les seules revues de sécurité sont les revues internes des livraisons. Avant d'exposer une instance multi-utilisateur avec des données financières et client, il faut un test d'intrusion externe (droits par rôle et par projet, routes d'envoi de fichiers et d'import, Server Functions) et une veille automatique des vulnérabilités des dépendances (Next.js, pdfkit, exceljs, PGlite), avec une politique de mise à jour. Analyse comparative du 25 oct. 2026 : le test d’intrusion avant mise en production est un prérequis de production (bloquant), rappelé par l’analyse comparative ; aucun changement de priorité.  
*Avancement : Livraison 8 : processus de sécurité documenté, audit des dépendances en CI ; Dependabot à activer par le propriétaire, test d’intrusion après l’hébergement. · Attend : Choix de l'hébergement (I-1a) et d'un prestataire d'audit · Sources : 00 §8.12, 00 §8.15, I-1a, DELIVERY-6.md §1 (revues adverses internes), §1.1, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-005 · Déplacer le stockage des fichiers hors du disque local** — *Prochaine étape · partiel · effort M*  
Pièces jointes, transcriptions, fichiers d’import et futures photos sont écrits sur le disque du serveur (<data dir>/files). Le volume persistant /data de la PR #1 suffit pour une instance unique. Pour plusieurs instances, ou chez un hébergeur sans volume, il faut un stockage objet (S3, Azure Blob) derrière la même API storeFile / streamStoredFile.  
*Attend : Hébergement choisi (I-1a) · Sources : I-1a, R-8a, X-15, SC-4a, 00 §8.13*

**R-177 · Rédiger le guide utilisateur, former par rôle et organiser le support** — *Prochaine étape · non commencé · effort M* · **en cours (Livraison 8)**  
Il n'existe aucune documentation pour les utilisateurs : le README et docs/ s'adressent aux développeurs. Avant la bêta multi-utilisateur, préparer un guide par rôle (8 profils), des scénarios de recette pour les bêta-testeurs, une formation, un canal de support et un dossier d'exploitation pour la DSI (déploiement, configuration des connecteurs, restauration).  
*Avancement : Livraison 8 : runbook, guides par rôle et scénarios de recette bêta en français ; contacts support, plan de formation et calendrier bêta à compléter. · Attend : Liste des bêta-testeurs et calendrier de la bêta (I-1a) · Sources : I-1a (bêta-testeurs avant production), D-7a (connecteurs configurés par l'IT), 00 §8.15*

**R-178 · Fournir et charger les listes de référence réelles d'EPC2i** — *Prochaine étape · attend le responsable produit · effort S* · **en cours (Livraison 8)**  
Les Paramètres (catégories de risques et de coûts, compétences, types de livrables, statuts, lieux de stockage), la grille de taux, les services et les clients viennent des constantes du prototype, et « Rétablir les valeurs par défaut » recharge SETTINGS0. Il faut que la direction fournisse les vraies listes et qu'une reprise les charge, en complément du démarrage sans données de démonstration.  
*Avancement : Livraison 8 : coefficients de production en attente (valeurs provisoires) et fiche de collecte des données de référence ; vraies valeurs attendues de la direction. · Attend : Listes métier validées par la direction (catégories, compétences, taux, services, clients, lieux) · Sources : A-14, A-15, A-10, 10 §1 (Paramètres)*

**R-210 · Application Windows (.exe) à côté de l’accès web** — *Prochaine étape · non commencé · effort M* · **en cours (Livraison 9)**  
Le responsable produit (31 oct. 2026, questionnaire L9-X2) : l’accès web reste la solution pour accéder à Keystone de n’importe où ; une application Windows (.exe), installable par ceux qui le souhaitent, coexiste avec lui pour laisser le choix à l’utilisateur. Fenêtre native (WebView2) sur le serveur Keystone d’EPC2i, connexion Microsoft habituelle, sans serveur local.  
*Avancement : 31 oct. 2026 : application construite (C# Windows Forms + WebView2, .NET 10, Keystone.exe autonome win-x64, docs/delivery-9/notes-r210-windows-app.md) ; compilée sous Linux, fabrication à la demande (windows-app.yml). Reste : essai sur un PC Windows avec un serveur hébergé (I-1a), signature de code et mode de diffusion (DSI). · Sources : Questionnaire de la livraison 9, L9-X2 (31 oct. 2026)*

**R-018 · Mémoriser les préférences par utilisateur (langue, menu, projet, zone)** — *Plus tard · partiel · effort S*  
Une fois l’authentification en place, stocker en base, par utilisateur, la langue (français par défaut, choix FR/EN suivant l’utilisateur sur tous ses postes, X-1), l’état du menu, le dernier projet, la zone et les préférences de notification, qui vivent aujourd’hui dans des cookies du navigateur.  
*Attend : Authentification réelle et vrais comptes (R-038, R-039) · Sources : X-1, X-6b, 01 OQ1, 00 §7.2, DELIVERY-1.md §7*

**R-019 · Adapter ou retirer l’application macOS Keystone.app** — *Plus tard · attend le responsable produit · effort S*  
Keystone.app lance un serveur local avec sa propre base PGlite sur le port 3000. Avec un serveur hébergé, il faut soit la faire pointer vers l’URL du serveur (fenêtre WebKit seule), soit l’abandonner.  
*Avancement : 31 oct. 2026 : le responsable produit garde le choix web ou application ; l’application macOS sera adaptée comme l’application Windows (R-210) pour pointer vers le serveur hébergé. · Attend : Décision du responsable produit une fois l’hébergement choisi (I-1a) · Sources : I-1a*

**~~R-002 · Passer de PGlite à un serveur PostgreSQL~~** — *Bloquant production · non commencé · effort M* · **fait (Livraison 7)**  
Remplacer PGlite (base embarquée, une seule connexion) par PostgreSQL serveur via drizzle-orm/node-postgres et un pool de connexions. Les migrations doivent tourner au déploiement et non au premier getDb() d’un processus, pour que plusieurs instances partagent la base.  
*Avancement : Livraison 7 : pilote node-postgres, db:migrate au déploiement. 18 oct. 2026 : serveur commun EPC2I (schéma keystone, rôle keystone_app, docs/EXPLOITATION.md § 4.1). · Attend : Choix de l’hébergement par l’IT et la DSI (I-1a) pour la base gérée · Sources : I-1a, 00 §8.10, DELIVERY-1.md §3*

**~~R-006 · Mettre en place des tâches planifiées côté serveur~~** — *Bloquant production · non commencé · effort M* · **fait (Livraison 7)**  
Ajouter un worker ou une file de tâches pour le gel du vendredi (S-4), la relance des outbox Vigie et Cursus, le résumé e-mail quotidien (X-6b), la purge de la corbeille du plan et celle des fichiers orphelins. Il servira ensuite à l’import Sage (I-3b) et à la synchro PDM horaire (E-7) quand ces connecteurs existeront. Aujourd’hui rien ne tourne en tâche de fond : tout part d’un clic ou de l’affichage d’une page.  
*Attend : Choix de l’hébergement (I-1a) pour le type de planificateur ; réponse à S-4 (DELIVERY-6 §8) sur ce que le gel du vendredi enregistre et sur ce qui fait avancer la date de situation · Sources : S-4, I-3b, E-7, X-6b, NEW-CURSUS-7, I-1a, 00 §8.11, DELIVERY-6.md §6 Minor points, §8 S-4*

**~~R-007 · Gérer les secrets et la configuration de production~~** — *Bloquant production · partiel · effort S* · **fait (Livraison 7)**  
Fournir un .env.example et un coffre de secrets pour les clés Cursus, Vigie, Codex, Sage, Anthropic et Entra. Supprimer le repli sur la clé de démonstration « demo-keystone » et ajouter l’authentification aux appels Vigie.  
*Attend : Contrat d’API Vigie, dont l’authentification (question V-3 de DELIVERY-5 §8) ; coffre de secrets selon l’hébergement (I-1a) · Sources : D-7a, V-2, V-3, 00 §8.11*

**~~R-008 · Durcir la sécurité HTTP~~** — *Bloquant production · partiel · effort M* · **fait (Livraison 7)**  
Ajouter les en-têtes de sécurité globaux (CSP, HSTS, frame-ancestors), une limitation de débit sur les envois de fichiers, les exports, les analyses Claude et les connexions, et des cookies de session httpOnly et secure. Prévoir un audit des dépendances et un test d’intrusion avant la mise en production. Les téléchargements portent déjà nosniff, les envois sont plafonnés en octets et l’import refuse les requêtes inter-sites.  
*Sources : 00 §8.12, DELIVERY-6.md §1.1, §8 P-1*

**~~R-009 · Ajouter journalisation, supervision et alertes~~** — *Bloquant production · partiel · effort M* · **fait (Livraison 7)**  
Mettre en place des journaux structurés, un suivi des erreurs, un point de contrôle de santé pour l’hébergeur et des alertes externes (e-mail, Teams) quand un connecteur échoue ou que des envois restent trop longtemps en attente. Aujourd’hui, seul l’écran Administration › Intégrations montre les connecteurs en échec (badge « ! »), et les erreurs ne vont qu’en console.  
*Sources : 00 Phase 9 (observabilité)*

**~~R-010 · Sécuriser les écritures concurrentes en multi-utilisateur~~** — *Bloquant production · non commencé · effort M* · **fait (Livraison 9)**  
Rendre sûres sous accès concurrent la numérotation métier (max+1 sur toute la table), les contrôles « vérifier puis écrire » et les états gardés dans globalThis : contraintes uniques avec nouvel essai, verrous ou transactions SERIALIZABLE, détection des modifications simultanées d’une fiche. Cas connu : « Définir la référence » revérifie la règle BL1 hors de la transaction, donc deux envois simultanés à BL0 peuvent créer BL2 sans demande de modification. Analyse comparative du 25 oct. 2026 : le verrouillage optimiste par enregistrement (détection d’une fiche modifiée entre-temps) est un standard du marché ; le verrou d’écriture global hashtext('keystone.ecritures') (src/server/db/transactions.ts) sérialise toutes les écritures et limitera la montée en charge multi-utilisateur. Priorité suggérée P1 : remplacer le verrou global par un verrou optimiste (version par enregistrement) ou des verrous ciblés.  
*Avancement : Fiche modifiée entre-temps : refus avec « modifiée entre-temps par X — rechargez » (colonne version + déclencheur, migrations 0068-0069) sur le Plan, le Gantt, les risques, le contrat, les jalons de paiement, les catégories de coût et les réclamations ; numérotation relancée sur conflit ; vérifications déplacées dans les transactions ; rafraîchissements des connecteurs partagés entre instances. · Sources : Q-7, S-3, DELIVERY-6.md §6 Minor points, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**~~R-011 · Démarrer la production sans données de démonstration~~** — *Bloquant production · non commencé · effort M* · **fait (Livraison 7)**  
En production, Keystone ne doit afficher que ce qu’il a enregistré ou reçu de Codex, du PDM, de Vigie, de Cursus ou de Sage. Il faut un mode d’initialisation « production » qui ne charge que les référentiels (étapes, calendriers, listes des Paramètres, types de documents et de machine, utilisateurs), garder le jeu du prototype pour une base de démo séparée, et retirer les artefacts de démo du code (projet par défaut HLT-026, numérotations décalées).  
*Sources : A-15, 10#13, 09#17, 05#11, #16, OQ15, DELIVERY-1.md §3, DELIVERY-3.md §3*

**~~R-013 · Remplacer l’horloge figée au 25 sept. 2026 par l’horloge réelle~~** — *Bloquant production · partiel · effort XL* · **fait (Livraison 9)**  
Introduire une source de date unique, injectable dans les tests, à la place de STATUS_ISO, NOW_ISO, CODEX_TODAY_ISO, PG_NOW, STATUS_DATE et TODAY. Retards, échéances, horodatages des écritures, salutation et périodes des formulaires doivent suivre le temps réel, et les tests golden fixeront l’horloge. La date de situation par projet (projects.data_date, lue par projectDataDate()) existe déjà, mais rien ne l’écrit encore (S-4).  
*Avancement : Lot « horloge » (docs/delivery-9/notes-clock.md) : une seule date métier (src/domain/clock.ts, src/server/clock.ts) à la place des six dates figées ; réglage KEYSTONE_CLOCK ; date réelle sur une base de production, 25 sept. 2026 sur la base de démonstration ; années des dates saisies et affichées selon l’année en cours. La date de situation par projet reste à faire (R-060, S-4). 17 oct. 2026 : « bêta fonctionnelle, c’est maintenant » — date réelle par défaut sur toute base, démonstration comprise (les tests restent au 25 sept. 2026). · Attend : Réponse du responsable produit à S-4 (DELIVERY-6 §8) : ce qui fait avancer la date de situation par projet (tâche du vendredi, chef de projet ou replanification) et ce que le gel enregistre · Sources : S-4, R-7, 00 §7.5, 01 OQ5, 04 Q11, 05 OQ6, DELIVERY-1.md §2, DELIVERY-6.md §3, §8 S-4*

**~~R-001 · Fusionner la livraison 6 dans main~~** — *Prochaine étape · non commencé · effort S* · **fait (Livraison 8)**  
La branche main-2a2fep (livraisons 1–6) a 30 commits d’avance sur origin/main (95412b5), et aucune PR n’est ouverte pour elle. La fusion peut se faire en avance rapide et seule la migration 0006 est nouvelle (0005 est déjà sur main). Il faut ouvrir et relire la PR, relancer typecheck, lint, tests et build, rebaser ensuite la PR #1 (Dockerfile Coolify, partie de 95412b5), puis supprimer les 3 worktrees et branches worktree-agent-*.  
*Avancement : PR #2 fusionnée dans main le 15 oct. 2026 par le responsable produit (livraisons 1 à 8, commit e302703) ; CI verte avant fusion (types, lint, tests, build, bout en bout, image conteneur) ; la PR #1 était déjà dans main ; worktrees et branches worktree-agent-\* supprimés. · Attend : Relecture et accord du responsable produit · Sources : CLAUDE.md, DELIVERY-6.md §1, docs/delivery-6/notes-planning.md §3*

**~~R-015 · Notifier les événements clés aux personnes concernées (X-6a)~~** — *Prochaine étape · partiel · effort M* · **fait (Livraison 9)**  
Créer les notifications choisies : CR soumise, NCR, livraison refusée, ECO à approuver, mention @, tâche assignée, facture bloquée, alerte d’indicateur. Elles doivent aller à l’approbateur, au demandeur, au responsable ou à la personne citée, et non à tout un rôle. Le ciblage par personne n’a de sens qu’avec de vrais comptes, car la table users n’a qu’un utilisateur par rôle. Analyse comparative du 25 oct. 2026 : les notifications hors application (e-mail, Teams, Outlook) et les rappels d’échéances sont un standard du marché ; Keystone reste in-app seulement, sans dépendance SMTP. Priorité suggérée P1, avec R-036 et R-037.  
*Avancement : Avis adressés aux personnes : SAT planifiée et livrable soumis (client externe), décision client sur un livrable, inspection non conforme, alertes d’indicateur (R-130) ; ECO et NCR partiront avec l’API Vigie (R-023). · Attend : Comptes utilisateurs réels (R-038, R-039) pour cibler des personnes plutôt que des rôles · Sources : X-6a, 01 §5.5, OQ19, 00 §7.7, DELIVERY-2.md §5, §7, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**~~R-016 · Mettre en place l’intégration continue et versionner les tests de bout en bout~~** — *Prochaine étape · partiel · effort M* · **fait (Livraison 7)**  
Créer un pipeline CI (typecheck, lint, vitest, build) sur chaque PR, puis un pipeline de déploiement. Versionner les 14 scénarios Playwright et la matrice des routes (3 520 requêtes) de la livraison 6, exécutés hors du dépôt, et supprimer les worktrees d’agents qui obligent à passer --ignore-pattern au lint.  
*Sources : DELIVERY-6.md §1, 00 §8.14*

**~~R-017 · Tenir la charge avec de vrais volumes de données~~** — *Prochaine étape · non commencé · effort L* · **fait (9)**  
Ajouter les index manquants sur les clés étrangères, paginer les grandes listes, éviter les lectures complètes de tables et mettre en cache les ~20 badges du menu calculés à chaque page, dont certains interrogent Cursus. Valider par un test de charge sur un jeu réaliste.  
*Avancement : 26 oct. 2026 (docs/delivery-9/notes-r017-volumes.md) : jeu agrandi (npm run load:seed : 150 projets, 30 000 activités, 20 000 documents, 8 000 commandes, 50 000 lignes d’audit, 500 personnes), mesures (npm run load:measure, load:check), 72 index (migration 0062), points chauds corrigés (calendriers, listes IN, valeur acquise, coffre documentaire, approbations, badges sans appel Cursus / Vigie), cache de lecture (versionedRead exact, badges ttlRead 30 s ; KEYSTONE_READ_CACHE=off), pagination ?page= (coffre, piste d’audit). Tous les écrans mesurés < 300 ms à chaud en PGlite, < 150 ms sur PostgreSQL. Reste : coût après écriture de l’accueil directeur (1–2 s), suggestions de rééquilibrage à calculer dans le worker. · Sources : 00 Phase 9 (performance)*

**~~R-175 · Analyser par antivirus les fichiers déposés dans Keystone~~** — *Prochaine étape · non commencé · effort S* · **fait (Livraison 8)**  
Les pièces jointes des tâches, transcriptions et imports sont contrôlés sur l'extension, la taille et la signature, mais pas analysés par un antivirus, alors que docx, xlsx, zip, msg et eml sont acceptés et ensuite téléchargés par d'autres utilisateurs. Brancher une analyse (ClamAV ou service de l'hébergeur) au dépôt, avec mise en quarantaine.  
*Avancement : Livraison 8, lot plateforme : antivirus (clamd) sur les dépôts de fichiers, fichiers bloqués en 410, nouvelle analyse planifiée, quarantaine purgée. · Attend : Choix de l'hébergement (I-1a) pour retenir le service antivirus · Sources : R-8a, X-15, DELIVERY-6.md §2 (Files)*

**~~R-176 · Ajouter des pages d'erreur et « page introuvable » traduites~~** — *Prochaine étape · non commencé · effort S* · **fait (Livraison 7)**  
Aucune page error.tsx, global-error.tsx ni not-found.tsx n'existe : une erreur serveur affiche la page brute de Next.js et une adresse inconnue la page 404 par défaut, en anglais. Ajouter des pages aux couleurs de Nocturne, en français par défaut, avec un identifiant d'incident relié à la journalisation.  
*Sources : DELIVERY-5.md §7 (Catch-all : 404 pour un écran construit), 00 §7.9, 01 (i18n, français par défaut)*

**~~R-199 · Rappels d’échéances et rapports programmés (envoi automatique)~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 9)**  
Envoyer automatiquement des rappels avant les échéances (tâches, jalons, livrables, actions de réunion, prérequis client) et des rapports programmés (avancement hebdomadaire, portefeuille) aux personnes concernées, par e-mail puis Teams. Standard du marché (Smartsheet, Wrike, MS Project). Aujourd’hui les avis sont in-app seulement, sans dépendance SMTP ; le canal e-mail (R-036), les comptes réels (R-038, R-039) et le job worker (R-006, fait) sont les prérequis. Analyse comparative du 25 oct. 2026 : priorité P1 avec R-036 et R-037.  
*Avancement : Rappels J-7 / J-1 / retard et rapports hebdomadaires (tâches planifiées, journal des envois, préférences) ; l’envoi réel des e-mails attend le relais SMTP ou Microsoft 365 de la DSI (R-036). · Attend : Canal e-mail (R-036) et comptes réels · Sources : Analyse comparative avec les solutions du commerce, 25 oct. 2026*

### 2.2 Authentification, utilisateurs et droits (3 restants, 14 faits)

**R-044 · Créer le rôle Finance (contrat, facturation, grille de taux)** — *Bloquant production · non commencé · effort M* · **en cours (Livraison 8)**  
Ajouter un rôle Finance (persona, ROLE_SCREENS, contrôles serveur, exports, i18n). Directeur, CP du projet et Finance modifient la page Contrat ; les achats perdent ce droit (P-4). Finance et directeur tiennent la grille des taux et coefficients, les CP la consultent (P-12).  
*Avancement : Livraison 8 : rôle Finance (9e persona Léa Marchand), droits P-4 sur le contrat, lecture seule sur Budget / Heures / Facturation ; questions ouvertes : factures, périmètre des projets. · Attend : Responsable produit : droits de Finance sur l’émission et le « payé » des factures client · Sources : P-4, P-12, A-10, 04 Q7, DELIVERY-2.md §7, DELIVERY-3.md §6, §7, DELIVERY-6.md §5*

**R-040 · Décider où s’attribuent les rôles (groupes Entra ou écran Keystone)** — *À décider · attend le responsable produit · effort M*  
Choisir si les rôles (directeur, CP, chef de service, achats, qualité, futur rôle Finance) viennent des groupes Entra ID ou d’un écran d’administration des utilisateurs. Un tel écran, absent du prototype, demande la validation du responsable produit.  
*Attend : Choix du responsable produit et de l’IT · Sources : I-2a, P-4, P-12, CLAUDE.md « No new tools without approval »*

**R-179 · Choisir la connexion des clients avant d'ouvrir le portail** — *À décider · attend le responsable produit · effort M*  
Le responsable produit a retenu « pas d'accès client au lancement » (I-2b) ; le portail est construit mais le client n'est qu'un profil de démonstration rattaché à une organisation codée en dur. Avant d'ouvrir le portail, décider du mode de connexion des clients (invités Entra B2B ou lien par e-mail), de leur rattachement à une organisation et des conditions d'utilisation, puis le brancher.  
*Avancement :  25 oct. 2026 (responsable produit) : tout ce à quoi la filiale (client interne) accédait dans Keystone remonte désormais dans Arche par les vues pub_, plus dans Keystone ; le portail Keystone ne concerne plus que les clients externes. · Attend : Décision du responsable produit et de la DSI sur la date d'ouverture du portail et le mode de connexion client · Sources : I-2b, 00 §8.12, 00 §10 I-2, P-10c, DELIVERY-6.md §4 (Client portal), §8 P-1*

**~~R-038 · Remplacer « Voir en tant que » par la connexion Microsoft Entra ID~~** — *Bloquant production · non commencé · effort L* · **fait (Livraison 7)**  
Connexion OIDC Entra ID (session serveur, connexion, déconnexion, redirection via proxy.ts) à la place du cookie ks-role, avec le même fournisseur que Cursus, Vigie et Codex, et « Voir en tant que » réservé à la démo. Aujourd’hui n’importe qui peut se déclarer directeur et une requête sans cookie s’exécute en directeur. Aucun compte client n’est ouvert au lancement (I-2b).  
*Attend : Inscription de l’application dans le tenant Entra ID par l’administrateur Microsoft d’EPC2i · Sources : I-2a, I-2b, I-3c, P-13, 00 §8.12, DELIVERY-1.md §5, DELIVERY-2.md §7*

**~~R-039 · Passer des 8 personas figés à de vrais utilisateurs~~** — *Bloquant production · non commencé · effort L* · **fait (Livraison 7)**  
Modéliser un compte par personne, lié à l’identité Entra, avec plusieurs rôles possibles, le service rattaché et l’organisation cliente. Auteurs, propriété des projets, état lu des notifications et droits doivent porter l’identifiant de la personne, et non le rôle, le nom court ou la constante CLIENT_ORG.  
*Attend : Authentification Entra ID (R-038) · Sources : I-2a, P-13, P-10a, P-8a, X-1, 11 §3.1 User / UserRole / UserPreference*

**~~R-041 · Fonder les droits de modification sur l’équipe projet nominative~~** — *Bloquant production · non commencé · effort L* · **fait (Livraison 7)**  
Les droits d’écriture d’un projet doivent venir de son équipe nommée (CP, CP adjoints, référents) ; les autres consultent. Aujourd’hui seul le CP, par son nom court, est limité à ses projets, tandis qu’ingénierie, qualité, achats et chefs de service modifient tous les projets. Il faut gérer l’équipe par projet, les projets à plusieurs CP, et faire suivre getProjectContext, isMineProject et toutes les Server Functions, y compris pour que les adjoints cochent les livrables et fassent avancer l’étape (L-4b).  
*Sources : P-2, L-4b, 01 OQ7, 07 OQ15, DELIVERY-1.md §7, DELIVERY-2.md §7, DELIVERY-4.md §8*

**~~R-042 · Refuser au client les écrans hors portail et les projets d’autres organisations~~** — *Bloquant production · partiel · effort M* · **fait (Livraison 7)**  
Un client doit recevoir un refus d’accès, et non une lecture seule avec bandeau, sur tout écran hors de son espace et tout projet d’une autre organisation ; le bouton « Tout le portefeuille » disparaît pour lui. P-1 n’est appliqué aujourd’hui qu’aux exports. Les salariés gardent la lecture seule. À faire avant toute ouverture aux clients (I-2b).  
*Sources : P-1, P-10a, I-2b, 03 OQ14-15, DELIVERY-6.md §7, §8 P-1*

**~~R-043 · Masquer au client réunions internes, transcriptions, NC et achats de son projet~~** — *Bloquant production · non commencé · effort M* · **fait (Livraison 7)**  
Sur son propre projet, le client ne doit plus voir les réunions internes, les transcriptions, les questions internes, le registre des NC (onglet NCR de Qualité) ni les données d’achats. Il garde avancement, jalons, demandes de modification, livrables, factures, documents partagés et réunions externes. Le filtrage se fait côté serveur, dans les DAL et les exports.  
*Sources : P-10b, I-2b, 05 OQ14, DELIVERY-3.md §5, DELIVERY-5.md §6*

**~~R-045 · Retirer aux chefs de service la création de projet~~** — *Bloquant production · non commencé · effort S* · **fait (Livraison 7)**  
Seuls le directeur et les chefs de projet créent un projet : le chef de service doit perdre « Nouveau projet », notamment sur la Vue d’ensemble, et la Server Function doit le refuser.  
*Sources : P-3, 03 OQ13, DELIVERY-1.md §4*

**~~R-046 · Masquer taux horaires et prix fournisseurs aux rôles non autorisés~~** — *Bloquant production · partiel · effort M* · **fait (Livraison 7)**  
Le taux horaire de la note de coût d’une tâche et les prix et factures fournisseurs ne doivent être visibles que du directeur et du CP, plus les achats pour les prix, à l’écran comme dans les exports et sans envoyer la donnée au navigateur. Aujourd’hui la grille des taux, le simulateur et les exports masquent déjà les taux ; restent la fiche tâche (taux envoyé au navigateur et affiché à tous, client compris) et tous les prix fournisseurs, lisibles par tout lecteur, y compris hors espace.  
*Sources : NEW-D2-1, P-2, A-10, DELIVERY-2.md §5, DELIVERY-4.md §6–§8*

**~~R-047 · Réserver le dépôt et la révision Codex à l’équipe interne du projet~~** — *Bloquant production · non commencé · effort M* · **fait (Livraison 7)**  
Seuls les membres internes du projet déposent un document ou créent une révision depuis Documents ; « Synchroniser » est réservé au directeur et à l’administrateur. Aujourd’hui tous les profils le peuvent, client compris, sur n’importe quel projet. Le refus du client et la restriction de la synchro au directeur peuvent se faire tout de suite ; la règle « équipe interne » dépend de l’équipe projet nominative (R-041), et Keystone n’a pas de rôle administrateur. Le refus du client et la synchro réservée au directeur sont faisables dès maintenant avec project_members.  
*Attend : Équipe projet nominative (R-041) ; définition d’un rôle administrateur, absent des 8 rôles · Sources : NEW-D3-1, P-1, P-2, DELIVERY-3.md §5–§7*

**~~R-048 · Limiter chaque chef de service aux demandes de ressources de son service~~** — *Bloquant production · non commencé · effort S* · **fait (Livraison 7)**  
Un chef de service ne décide (approuver, refuser, reprogrammer) que les demandes de son service ; le directeur décide pour tous. Aujourd’hui tout rôle qui a l’écran Approbations, qualité comprise, décide pour n’importe quel service.  
*Sources : P-8a, 08 OQ19, DELIVERY-2.md §6, §7*

**~~R-049 · Restreindre « Mon travail » d’autrui selon la hiérarchie et les projets~~** — *Bloquant production · non commencé · effort S* · **fait (Livraison 7)**  
Réponse retenue : le directeur voit tout le monde, un chef de service son service, un CP les membres de ses projets. Le code applique encore une règle par rôle sur tout le pool, alors que DECISIONS.md indique « défaut appliqué ». La règle vaut pour la page, la fiche tâche et l’export, avec un message quand un ?person= est ignoré.  
*Sources : R-9, P-13, DELIVERY-2.md §5*

**~~R-050 · Réserver l’envoi des comptes rendus à l’organisateur et au CP~~** — *Prochaine étape · non commencé · effort S* · **fait (Livraison 7)**  
Seuls l’organisateur et le CP du projet envoient le compte rendu ; les internes ajoutent des notes ; le client lit sans modifier ni créer de réunion. Aujourd’hui tout rôle ayant l’écran Réunions, membre et client compris, crée une réunion et envoie le compte rendu.  
*Sources : P-9b, 05 OQ7, DELIVERY-3.md §6, §7*

**~~R-190 · Filiale = client interne ; projet rattaché à son CAPEX~~** — *À décider · non commencé · effort S* · **fait (9)**  
Un client peut être une filiale du groupe (organisation interne) ; un projet porte la référence de son CAPEX et de son besoin ; les filiales suivent leurs projets dans l’application CAPEX, pas dans le portail client (réservé aux clients externes, R-179).  
*Avancement : Livraison 9, lot « share-views » : projects.capex_code et besoin_ref (formats d’Arche CPX-SAI-2026-01, CPX-SAI-2026-01/B01, contrôlés en base), carte « Rattachement CAPEX » de l’écran Contrat pour le directeur et les responsables du projet (audit et fil d’activité), publiés en fin de pub_projets. Un client peut déjà être une filiale (saisie libre) ; drapeau « client interne » non ajouté (aucun écran d’administration des clients) — à reprendre avec R-179 (portail réservé aux clients externes) et la création du projet à la commande (R-187). 24 oct. 2026 : fait (docs/delivery-9/notes-r190-internal-client.md) — clients.is_internal et subsidiary_code (migration 0051, un client par filiale), carte « Client » de l’écran Contrat (directeur), badge « Interne », portail client fermé aux projets d’un client interne, client interne posé à la création d’un projet depuis un besoin d’Arche, client_interne et filiale_code en fin de pub_projets (0052). Reste : R-179 (connexion des clients au portail) ; Matrix recopie pub_projets. · Sources : Responsable produit, 22 oct. 2026 (application CAPEX dédiée, DIG-PRODI v4.0), docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md*

**~~R-051 · Ajouter la délégation des validations à un suppléant sur une période~~** — *Plus tard · non commencé · effort M* · **fait (Livraison 9)**  
L’approbateur déclare un suppléant et des dates ; pendant cette période, ses validations (documents, demandes, commandes, Mes validations) sont routées vers le suppléant, et les décisions sont tracées à son nom.  
*Avancement : Suppléance déclarée par l’approbateur sur une période (un an au plus) ; « Mes validations » du suppléant, décision tracée « pour le compte de », sans chaînage, annulation par l’approbateur ou le directeur (migration 0067). · Sources : P-7d, 08 §7*

**~~R-052 · Étendre la recherche globale au portefeuille, filtrée selon les droits~~** — *Plus tard · non commencé · effort M* · **fait (Livraison 8)**  
Chercher commandes, CR, NCR et risques sur tous les projets, chaque résultat ouvrant son projet, en filtrant les résultats selon les droits du lecteur (un client ne voit que ses projets). Aujourd’hui la recherche ignore l’utilisateur et limite ces objets au projet courant.  
*Avancement : Livraison 8 : recherche globale sur tout le portefeuille (X-5), projet courant d’abord ; le client voit les demandes de modification de ses propres projets. · Sources : X-5, 01 OQ18, 00 §7.6, DELIVERY-1.md §4*

### 2.3 Intégrations avec les autres systèmes (20 restants, 6 faits)

**R-022 · Réconcilier les codes projet (#000, XXX000, Cursus, Vigie) dans la fiche projet** — *Bloquant production · attend le responsable produit · effort M*  
La fiche projet doit porter et réconcilier le numéro ingénierie #000 (liste incrémentée) et le code analytique XXX000 créé dans Sage et donc imposé, au lieu de les générer. Elle doit aussi tenir la correspondance avec les identifiants Cursus (chantier K-26xx) et Vigie (K-2025-042), clé commune de tous les connecteurs.  
*Attend : Confirmation par le responsable produit de l’origine des codes #000 et XXX000 · Sources : NEW-SYS-1, S-6, BACKLOG.md §1 bis, 01 §10.2, DELIVERY-5.md §5.1, §5.2, §8 (V-3, C-3)*

**R-024 · Faire construire le module ECO de Vigie avec les adresses proposées** — *Bloquant production · attend un système externe · effort M* · **en cours (Livraison 8)**  
Le démarrage sur les vraies ECO attend le module ECO de Vigie, qui doit reprendre les routes proposées par Keystone (registre, fiche, formulaire « Nouvelle ECO » pré-rempli avec part, project, title, source=keystone). Côté Keystone : transmettre la spécification, adopter l’API réelle, vérifier de bout en bout, retirer les 6 ECO de démonstration du miroir et les mentions OPEN QUESTION V-1. D’ici là, « Ouvrir dans Vigie » et « Créer l’ECO » mènent à une page vide. Analyse comparative du 25 oct. 2026 : la lecture réelle des ECO de Vigie à la place des 6 ECO de démonstration est attendue (standard du marché) ; priorité transverse, dépend de Vigie.  
*Avancement : Livraison 8 : section ECO du contrat d’interface Vigie rédigée (NEW-D4-1, NEW-VIGIE-1) ; le module reste à construire par Vigie. · Attend : Équipe Vigie : module ECO et routes /modifications-techniques, /<id>, /nouvelle · Sources : NEW-VIGIE-1, NEW-D4-1, V-1, P-7a, DELIVERY-4.md §5, §8, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-027 · Importer l’annuaire du personnel de Cursus (matricule ↔ personne)** — *Bloquant production · attend un système externe · effort M* · **en cours (Livraison 8)**  
Reprendre de Cursus le matricule, le nom, l’e-mail professionnel et l’équipe, et rattacher chaque matricule à une personne Keystone, y compris les intérimaires sans compte Microsoft. Sans cette correspondance, verdicts, heures et absences reçus de Cursus restent sans nom. Analyse comparative du 25 oct. 2026 : la lecture réelle de l’annuaire Cursus (vues pub_ ou API) à la place du mode veille est un standard du marché ; priorité transverse, dépend de Cursus.  
*Avancement : Livraison 8 : import de l’annuaire Cursus côté Keystone (matricule ↔ personne), en veille (CURSUS_DIRECTORY=off) tant que Cursus n’expose pas son annuaire. · Attend : Nouvel accès « annuaire » côté Cursus · Sources : NEW-CURSUS-2, C-3, BACKLOG.md §1 bis, 11 §3.1, DELIVERY-5.md §5.2, §8, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-033 · Construire le connecteur Codex (index, approbations, dépôts, liens profonds)** — *Bloquant production · attend un système externe · effort L* · **en cours (Livraison 8)**  
Créer src/server/integrations/codex/ sur le modèle Vigie/Cursus : miroir en lecture de l’index (révisions, statuts, téléchargements réels à la place de l’historique fabriqué), outbox des approbations signées dans Keystone vers Codex (P-7b, D-1b) et dépôt par le formulaire Codex pré-rempli (D-1a) au lieu de la création locale simulée, modes mock et http, synchro réelle, liens profonds par document et par sélection (zip), « Ouvrir / Modifier dans Codex » réels. Aujourd’hui seule l’URL de base existe. Analyse comparative du 25 oct. 2026 : la lecture réelle de l’index Codex (vues pub_ ou API) à la place des mocks est un standard du marché ; priorité transverse, dépend de Codex. Même attente pour Arche (connecteur capex, R-187) : lire les vues pub_ réelles des autres outils plutôt que les simulations.  
*Avancement : Livraison 8 : côté Keystone du connecteur Codex (liens, état réel, lecture horaire de l’index ; les fiches en attente d’un projet ou d’un type sont relues seules) ; l’API Codex (D-1), le formulaire de dépôt (R-125) et les téléchargements restent à faire. · Attend : API et routes de Codex (index, approbations, dépôt pré-rempli, liens profonds, D-1) · Sources : I-3a, P-7b, D-1a, D-1b, P-7c, NEW-D3-1, D-1, A-15, A-9, DELIVERY-3.md §5, §7, DELIVERY-6.md §6, §8 D-1, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-034 · Construire le connecteur Sage X3 (extractions quotidiennes et envois)** — *Bloquant production · attend le responsable produit · effort XL* · **en cours (Livraison 8)**  
Importer chaque jour les extractions Sage proposées par le responsable produit : fichier fournisseurs (SC-7b), stock, commandes et références X3, réceptions, factures fournisseurs et statut « Payée » (SC-2), coûts par code analytique et codes NIM. Définir ensuite ce qui repart vers X3 (commandes approuvées, annulations, mouvements de stock, factures). Aujourd’hui tout est un mock sur l’instantané du prototype et aucun planificateur ne lance d’import périodique. Analyse comparative du 25 oct. 2026 : un connecteur ERP réel (fournisseurs, commandes, factures, réalisé) est une fonction avancée des outils du marché (Deltek, Planview) ; Keystone n’a qu’un mock (src/server/integrations/x3/mock-mode.ts). Priorité suggérée P1.  
*Avancement : Livraison 8 : simulation Sage X3 honnête (« Import simulé (Sage X3 non connecté) ») ; le vrai connecteur attend les extractions X3 (format, fréquence, périmètre — I-3b). · Attend : Partage des rôles Keystone / X3 (A-1a, avec finance, achats et logistique), extractions Sage et procédure d’achats (P-5a) · Sources : I-3b, A-1a, SC-2, SC-4b, SC-7b, NEW-D4-4, P-5c, S-6, C-2a, 00 §7.12, 08 §0, DELIVERY-4.md §6, §8, DELIVERY-6.md §6, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-023 · Brancher l’API Vigie réelle (NC, HSE, ECO) et passer au numéro Vigie** — *Prochaine étape · attend un système externe · effort M* · **en cours (Livraison 8)**  
Le miroir en lecture et les outbox sont prêts en mode mock et http sur des endpoints proposés. Il reste à les aligner sur l’API publiée par Vigie avec authentification, à faire correspondre projets Vigie et codes Keystone, à afficher le seul numéro Vigie et ouvrir la fiche par son identifiant (V-3a), et à ne plus perdre l’avancement non envoyé quand un rafraîchissement complet supprime une ECO ou une NC du miroir (suppression en cascade des outbox). Analyse comparative du 25 oct. 2026 : la lecture réelle des données de Vigie (vues pub_ ou API) à la place des mocks est un standard du marché pour les intégrations entre outils ; priorité transverse, à traiter dès que Vigie publie son contrat.  
*Avancement : Livraison 8, lot connecteurs : côté Keystone du connecteur Vigie (élagage du miroir, contrat, liens projet) ; l’API réelle attend Vigie (V-2, V-3a). · Attend : API d’échange de Vigie (contrat, endpoints, authentification) · Sources : V-2, V-3a, I-3a, DELIVERY-4.md §5, §8, DELIVERY-5.md §5.1, §8 (V-3), DELIVERY-6.md §6, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-028 · Créer le chantier Cursus depuis Keystone (un par projet)** — *Prochaine étape · attend un système externe · effort M*  
À l’ouverture de la fiche chantier, Keystone doit créer le chantier dans Cursus (dates, lieu, équipe) et enregistrer son identifiant. Aujourd’hui cursus_chantier_id n’est jamais renseigné, donc en mode http aucun Go/No-Go réel n’est rafraîchi et les demandes de voyage sont refusées. Prérequis : la création de la fiche chantier par le chef de projet (D-3) n’existe pas non plus, seule la graine crée des fiches.  
*Attend : Point d’API de création de chantier dans Cursus ; création de la fiche chantier dans Keystone (D-3) · Sources : NEW-CURSUS-1, D-3, C-3, DELIVERY-5.md §5.2, §8*

**R-030 · Recevoir les heures validées Cursus par tâche et remplacer l’écran Heures (Lucca)** — *Prochaine étape · attend le responsable produit · effort L*  
Recevoir les heures validées détaillées par tâche Keystone, exposer à Cursus un point de lecture des tâches affectées à un matricule pour une semaine, imputer les heures par activité et tenir un total hors projet INT-* par personne et par semaine pour la charge. L’écran devient « Heures (Cursus) » (prévu contre réalisé, anomalies) et la saisie d’heures dans Keystone disparaît (C-2b). Le lien feuilles de temps Cursus est encore « à valider » (CLAUDE.md, BACKLOG).  
*Attend : Validation du périmètre par le responsable produit (BACKLOG §1 bis) et évolution de Cursus pour envoyer l’identifiant de tâche Keystone · Sources : NEW-CURSUS-5, NEW-CURSUS-6, NEW-CURSUS-7, R-6a, C-2b, BACKLOG.md §1 bis, DELIVERY-6.md §9, 06 §5*

**R-031 · Recevoir les absences de Cursus et débrancher Lucca** — *Prochaine étape · non commencé · effort M* · **en cours (Livraison 9)**  
Les absences validées (dates et type simple) doivent arriver de Cursus, alimenter l’écran Congés, réduire la disponibilité dans la charge et le what-if, et révéler les conflits avec la rotation chantier. Il faut aussi retirer Lucca partout : connecteur, libellés, accueil, notifications, journal d’activité.  
*Avancement : Livraison 8 : absences reçues de Cursus en deux types simples (Congé, Absence), « Sync Lucca » retiré. Livraison 9, lot « cursus-contract » : format réel de Cursus accepté (absence, du, au ; sans nature = Absence ; demi-journée = journée entière), une correction remplace les semaines, absence.annulee retire les semaines ; les absences réduisent la capacité dans la charge et le what-if. Reste : conflits avec la rotation chantier à revoir avec les absences Cursus, demandes à Cursus (vue pub_absences, matricule de sorties.ts). · Attend : Envoi des événements absence.validee par Cursus · Sources : NEW-CURSUS-4, R-1, BACKLOG.md §1 bis, 00 §10 R-1, 11 §6.7, DELIVERY-2.md §5, §7*

**R-035 · Brancher SolidWorks PDM / 3DEXPERIENCE (plans, aperçus, « Ouvrir dans PDM »)** — *Prochaine étape · attend un système externe · effort L*  
Synchroniser chaque heure les données des plans (numéro, titre, révision, état, article lié) et l’aperçu PDF des révisions diffusées, avec un vrai lien « Ouvrir dans PDM » depuis Plans et P&ID et les aperçus des feuilles P&ID (X-15). Aujourd’hui la synchro du coffre est simulée et recopie le volume précédent. Le périmètre dépend du référentiel articles (A-1b).  
*Attend : Accès API ou export SolidWorks PDM / 3DX (IT et ingénierie) ; décision A-1b · Sources : E-7, X-15, A-1b, I-3a, 09 OQ17, DELIVERY-4.md §8, DELIVERY-6.md §6*

**R-036 · Envoyer les notifications par e-mail, avec préférences par utilisateur** — *Prochaine étape · non commencé · effort L* · **en cours (Livraison 9)**  
Ajouter le canal e-mail (Microsoft Graph via l’application Entra, ou SMTP) : envoi immédiat pour ce qui attend une action et pour les clients, résumé quotidien pour le reste, préférences réglées par chacun. Les invitations SAT et les notifications client, affichées comme envoyées, ne partent pas aujourd’hui, et le pied du panneau de notifications annonce à tort un résumé e-mail, un canal Teams (non retenu par X-6b) et des préférences inexistantes. Analyse comparative du 25 oct. 2026 : le canal e-mail avec rappels d’échéances et rapports programmés est un standard du marché (Smartsheet, Wrike, MS Project) ; aucune dépendance SMTP ni Graph n’est encore en place. Priorité suggérée P1 (voir aussi R-199 pour les rappels et rapports programmés).  
*Avancement : Livraison 9 : e-mail immédiat ou résumé quotidien par famille et par personne, invitations SAT envoyées, pied du panneau corrigé (sans Teams) ; reste le transport réel (relais SMTP ou Microsoft 365 Mail.Send), l’expéditeur et l’URL publique, fournis par la DSI. · Attend : IT : relais SMTP ou déclaration de Keystone dans Microsoft 365 ; comptes réels avec adresse e-mail · Sources : X-6b, I-3c, DELIVERY-5.md §6, §8 X-6, DELIVERY-6.md §6 (Mail), Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-196 · Catégorie « R&D » des projets lisible dans pub_projets (pour Crucible)** — *Prochaine étape · non commencé · effort S* · **en cours (Livraison 9)**  
Crucible (K-3) filtre les projets R&D : si les projets R&D sont des projets internes de Keystone, une nature ou une étiquette « R&D » lisible dans pub_projets (colonne en fin de vue, ex. categorie). Le type de machine « R&D » existe déjà ; à décider : type de machine, nature du projet ou étiquette.  
*Avancement : 01/11/2026 (K-196) : nature de projet « R&D » à la création, colonne en fin de pub_projets ; en construction. · Sources : Crucible (application de planification des moyens d’essais R&D), docs/DEMANDES-KEYSTONE.md, 22 oct. 2026*

**R-181 · Décider qui crée le projet dans Codex et Vigie à sa création dans Keystone** — *À décider · attend le responsable produit · effort M*  
Keystone créera le chantier Cursus (NEW-CURSUS-1), mais rien n'est décidé pour Codex (espace documentaire du projet) ni pour Vigie, qui utilise ses propres identifiants de projet. Décider si la création d'un projet dans Keystone ouvre automatiquement le projet dans Codex et Vigie avec le code commun, puis le construire dans les connecteurs.  
*Attend : Décision du responsable produit ; API de création de projet côté Codex et Vigie · Sources : NEW-SYS-1, NEW-CURSUS-1 (équivalent pour Cursus), I-3a, DELIVERY-5.md §5.1 (projets Vigie « K-2025-042 »)*

**R-189 · Vues de suivi pour le CAPEX : jalons, avancement côté vente, avenants, réserves** — *À décider · non commencé · effort M* · **en cours (Livraison 9)**  
Vues pub_jalons_projets (commande, FAT, expédition, arrivée site, SAT, PV, fin de garantie), pub_avancement_projets (avancement physique, SPI, fin prévue, contrat + avenants et facturé côté vente — aucun coût interne ni marge, P-05), pub_avenants, pub_reserves ; contrats documentés avec Matrix.  
*Avancement : Livraison 9, lot « share-views » (docs/delivery-9/notes-share-views.md, migration 0038_share_followup) : pub_jalons_projets (8 jalons par projet : commande, fin d’études, FAT, expédition, arrivée site, SAT, PV, fin de garantie, rapprochés des étapes, de l’ITP, de la mise en service, des PV et de la garantie), pub_avancement_projets (côté vente seulement : avancement physique et SPI tenus par la tâche horaire share-progress, fin prévue, contrat, avenants signés et facturé en k€ ; aucun coût interne, taux, CPI, EAC ni marge — testé), pub_avenants (brouillons exclus), pub_reserves ; pub_livrables + type, accepte_le, maj_le en fin de vue ; colonnes vérifiées par db-check (aussi sur PostgreSQL). Reste : droits d’arche_app et copie des vues dans Matrix (demande à déposer après validation), dates BL1 des jalons (reference_le vide : code de jalon CAPEX sur les jalons du planning, à valider), pub_pack_ingenierie (R-191). Index maj_le (K-11) faits le 23 oct. 2026 (notes § 8). 25 oct. 2026 : dates BL1 des jalons faites (docs/delivery-9/notes-r189-reference-dates.md) — milestones.capex_milestone_code (8 codes, règle de noms prudente, reprise 0056, correction sur la carte « Jalons » du Planning), reference_le = date du jalon dans la BL1, pub_jalons_projets recréée à colonnes identiques (0055-0057). Reste : pub_pack_ingenierie (R-191, liste type du pack) et réponse P-05. 25 oct. 2026 : pub_pack_ingenierie publiée (R-191). Reste : réponse P-05. · Attend : Réponse P-05 (données financières visibles par la filiale) · Sources : Responsable produit, 22 oct. 2026 (application CAPEX dédiée, DIG-PRODI v4.0), docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md*

**R-025 · Pré-remplir les signalements Vigie et filtrer ses listes par projet** — *Plus tard · attend un système externe · effort S* · **en cours (Livraison 8)**  
Keystone envoie déjà projet, article, activité, titre et lieu au formulaire /signaler, mais Vigie ne lit que le lieu. Il reste à ajouter le filtre projet aux liens vers les listes Vigie, puis à valider de bout en bout quand Vigie aura évolué ; dépend de la correspondance des codes projet (R-022).  
*Avancement : Livraison 8 : moitié Keystone du filtre par projet des listes Vigie (V-3b) ; le filtre côté Vigie reste à faire. · Attend : Évolution de Vigie (lecture des paramètres et filtre par projet Keystone) · Sources : V-3b, NEW-SYS-1, DELIVERY-5.md §5.1, §8 (V-3)*

**R-026 · Afficher la note fournisseur A/B/C évaluée dans Vigie** — *Plus tard · attend un système externe · effort M*  
L’évaluation des fournisseurs (ISO 9001 §8.4) est tenue dans Vigie. Keystone doit relire la note et ses indicateurs par le miroir Vigie, au lieu des pourcentages et notes figés du prototype.  
*Attend : Évaluation des fournisseurs et API correspondante dans Vigie · Sources : SC-6, 08 OQ24, DELIVERY-4.md §8*

**R-032 · Finaliser les liens ciblés et les relances vers Cursus** — *Plus tard · attend un système externe · effort S* · **en cours (Livraison 8)**  
« Ouvrir Cursus » doit ouvrir le bon chantier ou le bon salarié, et « Relancer dans Cursus » (y compris pour un GO avec réserve, D-6a) doit être délivré à la personne ou aux RH. Côté Keystone, le paramètre chantier est proposé et les relances attendent dans l’outbox ; il manque le lien vers un salarié et l’envoi réel.  
*Avancement : Livraison 8 : lien vers la fiche Cursus d’une personne depuis le Chantier (NEW-CURSUS-3) ; l’adresse est une proposition à convenir avec Cursus, les matricules arrivent avec R-027. · Attend : Cursus : routes ciblées et point de réception des relances · Sources : NEW-CURSUS-3, C-1, C-2, D-6a, DELIVERY-5.md §5.2, §8*

**R-037 · Synchroniser les réunions Outlook / Teams vers Keystone (S-11)** — *Plus tard · attend un système externe · effort L* · **en cours (Livraison 8)**  
Faire arriver dans Keystone les réunions Outlook ou Teams portant le code projet ; Keystone y ajoute ordre du jour, compte rendu et actions, et met à jour les accusés de lecture des comptes rendus. « Synchronisé depuis Outlook » n’est aujourd’hui qu’un libellé. Les messages dans les canaux Teams ne sont pas retenus pour les notifications (X-6b : Keystone + e-mail) : la ligne de connecteur « Microsoft Teams » est à retirer ou à requalifier. Analyse comparative du 25 oct. 2026 : l’intégration Teams / Outlook (réunions, notifications) est un standard du marché ; seul le libellé existe aujourd’hui. Priorité suggérée P1 pour les notifications, l’accès Graph restant le prérequis.  
*Avancement : Livraison 8 : libellés Outlook / Teams fidèles et accusés de lecture dans Keystone ; la synchronisation Outlook attend l’accès Graph de la DSI. · Attend : Déclaration de Keystone dans Microsoft 365 et accès Graph par l’IT (I-3c) · Sources : S-11, I-3c, X-6b, I-3a, 05 OQ18, DELIVERY-3.md §3, §5, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-197 · Afficher les essais planifiés de Crucible dans le planning d’un projet (facultatif)** — *Plus tard · non commencé · effort M*  
Crucible (K-4, facultatif) publie crucible.pub_reservations : Keystone pourrait les lire et les afficher dans le planning d’un projet (visibilité côté projet), en miroir lecture seule avec liens profonds vers Crucible.  
*Avancement : 01/11/2026 (K-197) : plus tard, quand Crucible aura publié sa vue des réservations. · Attend : Crucible : vue pub_reservations publiée ; validation du responsable produit · Sources : Crucible (application de planification des moyens d’essais R&D), docs/DEMANDES-KEYSTONE.md, 22 oct. 2026*

**R-202 · API REST métier documentée, webhooks et connecteurs Power Automate / Zapier** — *Plus tard · non commencé · effort L*  
Exposer une API REST générale documentée (OpenAPI) sur les projets, le planning, les tâches, les coûts et les registres, avec jetons d’accès et droits par rôle, des webhooks sur les événements clés (jalon, CR, NC, commande) et des connecteurs Power Automate / Zapier. Standard du marché. Aujourd’hui seuls existent les endpoints Cursus (/api/cursus/v1), l’export et les photos ; pas d’API générale ni de webhooks. Analyse comparative du 25 oct. 2026 : priorité P2, à valider par le responsable produit (périmètre et sécurité).  
*Avancement : 01/11/2026 (K-202) : plus tard, après l’hébergement et l’avis de la DSI. · Attend : Validation du responsable produit et de la DSI (exposition d’une API) · Sources : Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**~~R-021 · Afficher l’état réel des connecteurs non branchés~~** — *Bloquant production · non commencé · effort S* · **fait (Livraison 7)**  
Codex, Lucca, Sage X3, SolidWorks PDM, MS Project, Outlook, Teams et SMTP affichent les statuts et volumes semés du prototype (« OK », « 412 records », « Token expires in 3 days », « 9 sent today ») et « Sync now » simule un passage (pour Codex, un comptage local). En production, ils doivent apparaître « Non connecté » (ou disparaître pour Lucca) tant que le vrai connecteur n’existe pas.  
*Avancement : Livraison 7 : état réel de chaque connecteur ; « Ajouter un connecteur » retiré (R-020, D-7a). · Sources : A-15, D-7a, DELIVERY-5.md §6 Administration, DELIVERY-6.md §6*

**~~R-020 · Configurer les connecteurs hors de l’application, par l’IT (D-7a)~~** — *Prochaine étape · partiel · effort S* · **fait (Livraison 7)**  
Le dialogue « Configurer » est déjà en lecture seule, mais « Ajouter un connecteur » écrit encore un connecteur depuis l’écran Intégrations, et rien ne permet à l’IT d’activer, désactiver ou régler un connecteur hors des variables d’environnement Vigie et Cursus. Retirer l’ajout dans l’interface et prévoir un fichier de configuration lu au démarrage ou un script d’administration.  
*Sources : D-7a, 01 §5.9, docs/delivery-6/notes-admin-settings.md §2.1*

**~~R-029 · Créer le point d’entrée des événements poussés par Cursus~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 9)**  
Point d’entrée HTTP protégé par clé d’API pour heures.validees, absence.validee, demande.decision et verdict.modifie. Un renvoi remplace la semaine déjà reçue pour un même salarié sans doublon, chaque réception est tracée dans l’audit, et l’émetteur peut renvoyer en cas d’échec.  
*Avancement : Livraison 8 : point d’entrée (clé dédiée CURSUS_EVENTS_KEY, idempotent, purge planifiée). Livraison 9, lot « cursus-contract » (docs/delivery-9/notes-cursus-contract.md) : aligné sur le contrat de Cursus (qui fait foi) — adresse POST /api/cursus/v1/evenements (l’ancienne reste servie), jeton Authorization: Bearer, enveloppe donnees, accusé de réception « accuse », decision de demande.decision ; appels sortants sur les routes /v1 de Cursus (reference des demandes, 409 DEMANDE_EN_DOUBLE). · Attend : Contrat d’événements à définir avec Cursus (POST /events, jeton) · Sources : NEW-CURSUS-7, NEW-CURSUS-4, NEW-CURSUS-5, BACKLOG.md §1 bis*

**~~R-180 · Exposer à Cursus les tâches Keystone de chaque personne par semaine~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 9)**  
Pour que Cursus propose les lignes de feuille de temps « depuis les tâches Keystone » et renvoie les heures par tâche (NEW-CURSUS-5 = c), Keystone doit offrir un point de lecture authentifié : tâches et activités affectées à un matricule pour une semaine, avec leur identifiant et le code projet. Aucune route de ce type n'existe ; c'est le pendant sortant de la réception des heures.  
*Avancement : Lot « cursus-tasks » (docs/delivery-9/notes-cursus-tasks.md, contrat docs/integrations/cursus-contract.md § 7) : selon le contrat de Cursus, Keystone pousse (pas de route de lecture) — chaque nuit à 02:00 (tâche cursus-tasks) et avec « Synchroniser » : PUT /v1/projets/{code} pour les projets cités, puis PUT /v1/instantane (section taches, depuis = lundi courant moins 4 semaines ; Cursus supprime les tâches absentes). Envoyées pour chaque personne qui a un matricule : affectations nominatives du planning (heures par jour ouvré du calendrier de l’activité) et tâches Keystone (règle de la vue pub_taches_jours), une tâche couverte par une affectation de la même personne sur la même activité n’étant pas envoyée deux fois. Échec réessayable renvoyé par cursus-outbox ; tâche refusée par Cursus (matricule inconnu) retirée et comptée ; connecteur simulé : envoi enregistré, rien n’est envoyé ; ligne Cursus d’Activité & intégrations : dernier envoi, tâches, refus, personnes sans matricule. À confirmer : la priorité affectation / tâche, l’heure de nuit ; les personnes n’ont pas encore de matricule (annuaire R-027). · Attend : Contrat d'API à convenir avec Cursus (Cursus lit aujourd'hui ses propres données fictives) · Sources : BACKLOG.md §1 bis (« Point de lecture des tâches »), NEW-CURSUS-5, R-6a, C-2b*

**~~R-195 · Vue pub_jalons des échéances des projets (pour Crucible)~~** — *Prochaine étape · partiel · effort M* · **fait (Livraison 9)**  
Crucible (K-2) lit les échéances des projets pour anticiper les besoins d’essais : vue pub_jalons (projet_code, jalon_id, nom, mois_reference, mois_prevu, statut, activite_code, date_activite_fin = fin au plus tôt de l’activité liée si datée, maj_le). La lecture de pub_projets par crucible_app (K-1) est un droit à accorder dans Matrix (partage/90-droits.sql), pas un changement de Keystone. Proche de pub_jalons_projets demandée par Arche (R-189) : une seule vue pour les deux lecteurs si les colonnes se rejoignent.  
*Avancement : 01/11/2026 : rien à construire — la vue pub_jalons (migration 0038, colonnes projet_code, jalon_id, nom, position, mois_reference, mois_prevu, statut, activite_code, date_fin_activite, maj_le) existe déjà et Matrix l’accorde à crucible_app (90-droits.sql) ; pub_jalons_projets reste la vue des 8 jalons CAPEX pour Arche. · Sources : Crucible (application de planification des moyens d’essais R&D), docs/DEMANDES-KEYSTONE.md, 22 oct. 2026*

**~~R-187 · Besoins machines des filiales : connecteur capex, réponse chiffrée, création du projet à la commande~~** — *À décider · non commencé · effort L* · **fait (9)**  
Connecteur capex (miroir de pub_capex et pub_besoins_machines, liens profonds, simulation) ; corbeille « Besoins des filiales » ; qualification, réponse chiffrée avec classe d’estimation, devis puis offre (Codex) ; création du projet EPC2i au G2 du CAPEX avec la référence du CAPEX et du besoin ; vue pub_reponses_besoins. Rejoint la proposition P6 (offres et chiffrage).  
*Avancement : Consigné le 22 oct. 2026 (lien avec l’application CAPEX) ; à valider avant de construire. Demandes d’Arche (dépôt Arche, docs/DEMANDES-KEYSTONE.md et CONTRATS.md, 22 oct. 2026) : K-02 — connecteur capex (lire arche.pub_capex et arche.pub_besoins_machines, liens profonds <ARCHE_URL>/capex/<code>), corbeille « Besoins des filiales », pub_reponses_besoins ; K-10 — à la commande, créer le projet EPC2i ou ajouter des équipements à un projet existant, code publié dans pub_reponses_besoins.projet_code. 24 oct. 2026 : fait côté Keystone (docs/delivery-9/notes-r187-capex-needs.md) — connecteur capex (miroir de arche.pub_capex et arche.pub_besoins_machines : lecture directe sur le serveur commun, simulation en démonstration, tâche toutes les 15 min, liens profonds ARCHE_URL), carte « Besoins machines des filiales » sous le registre de Portefeuille › Projets (directeur ; chefs de projet en lecture), réponses chiffrées RB-nnn (qualification, indicatif, devis, offre ferme E10 ; fourchette par la classe), création du projet ou ajout d’une ligne d’équipement à la commande (action du directeur), vue pub_reponses_besoins (migrations 0049-0050). Reste : Arche publie ses deux vues (son lot L4) ; Matrix recopie la vue et vérifie les droits. · Sources : Responsable produit, 22 oct. 2026 (application CAPEX dédiée, DIG-PRODI v4.0), docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md*

### 2.4 Projets, cycle de vie et modèles par type de machine (5 restants, 5 faits)

**R-053 · Créer le standard complet par type de machine et l’instancier à la création** — *Prochaine étape · attend le responsable produit · effort L*  
Chaque type de projet doit avoir un standard tenu et modifiable dans Keystone : WBS avec lots, activités, durées et liens, budgets, livrables par étape, points ITP. L’assistant en fait une copie que le CP personnalise avant le lancement. Aujourd’hui le modèle se limite aux noms des phases (un lot et une activité de 30 jours ouvrés par phase, enchaînés FS), aux catégories de coûts et aux noms des systèmes ITP : aucun point d’inspection n’est créé et les livrables d’étape sont communs à tous les types. Sans fin saisie, la fin prévue vient de ce plan type, pas d’une date fixe.  
*Attend : Données standard par type de machine (WBS, budgets, durées, livrables, ITP) promises par le responsable produit (A-2, L-3a) · Sources : A-2, L-3a, DELIVERY-1.md §7, DELIVERY-6.md §4, §5, §8 L-3b, DELIVERY-6-PLAN.md §2, docs/delivery-6/notes-admin-settings.md §4.4*

**R-056 · Choisir une source de géocodage pour les sites des nouveaux projets** — *À décider · attend le responsable produit · effort S*  
La saisie pays / ville est faite, mais un site dont la ville n’est pas déjà connue n’a pas de coordonnées et le projet n’apparaît pas sur la carte. Le responsable produit doit choisir entre une table de villes dans les Paramètres et un service de géocodage (nouvel outil, soumis à approbation).  
*Attend : Choix du responsable produit (DELIVERY-6 §8 L-3b) · Sources : L-3b, NEW-D3-2, DELIVERY-6.md §4, §8 L-3b, docs/delivery-6/notes-admin-settings.md §4.3*

**R-059 · Trancher la grille pouvoir / intérêt et le « dernier contact » des parties prenantes** — *À décider · attend le responsable produit · effort M*  
Réponse « À discuter » sans note. Les champs influence, intérêt et attitude existent mais restent vides et ne sont pas affichés. Le « dernier contact » prend la date figée du 30 sept. 2026 à la création de la partie prenante et ne peut plus être modifié ensuite. Il faut choisir entre une grille avec dernier contact déduit des réunions Keystone (recommandé), une grille avec les e-mails Microsoft 365, ou un registre simple avec une date à mettre à jour à la main (à rendre modifiable).  
*Attend : Discussion avec le responsable produit (S-13a, « À discuter » sans note ; statut Plus tard) · Sources : S-13a, 05 OQ19, DELIVERY-3.md §4, §6, §7*

**R-058 · Intégrer la matrice RACI d’entreprise, par rôle et non modifiable** — *Plus tard · attend le responsable produit · effort M*  
S-13b : la matrice RACI fournie par le responsable produit sera fixe et organisée par rôle, et Keystone doit permettre d’affecter chaque rôle à une personne de l’équipe projet. Aujourd’hui la RACI est stockée par projet, en lecture seule, avec des colonnes en texte libre. Seul HLT-026 en a une (semée depuis le prototype), et un projet créé par l’assistant n’en a aucune. La RACI-B des livrables qualité est un objet distinct, hors du périmètre de la réponse.  
*Attend : Matrice RACI par rôle, en cours de définition par le responsable produit · Sources : S-13b, 05 OQ20, DELIVERY-3.md §7, DELIVERY-5.md §6*

**R-201 · Tâches récurrentes et automatisation des tâches répétitives dans « Mon travail »** — *Plus tard · non commencé · effort M* · **en cours (Livraison 9)**  
Permettre de créer des tâches récurrentes (hebdomadaire, mensuelle, à chaque jalon) et d’automatiser les tâches répétitives dans « Mon travail » : règle de récurrence sur la tâche, génération de l’occurrence suivante à la clôture, affichage dans les vues liste, tableau et calendrier. Standard du marché (Wrike, Asana). Aujourd’hui les vues existent (src/app/(app)/my/tasks/page.tsx) mais le modèle ne porte aucune récurrence (src/server/db/schema/work.ts). Analyse comparative du 25 oct. 2026 : priorité P2.  
*Avancement : 01/11/2026 (K-201) : lancé ; en construction. · Sources : Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**~~R-054 · Lier le livrable « Planning BL1 posé » à la référence BL1 réelle~~** — *Prochaine étape · partiel · effort S* · **fait (Livraison 8)**  
L-2 : BL1 est figée en fin d’APD et conditionne le passage en Études. Le livrable d’étape APD « Planning BL1 posé » existe déjà : tant qu’il n’est pas coché, le passage automatique est refusé et il faut forcer. Mais la case se coche à la main, sans lien avec les références. Reste à faire : cocher la case quand on définit BL1, refuser de la cocher sans BL1 (ou la décocher), éventuellement réserver BL1 à l’étape APD, et corriger le texte obsolète de l’assistant « Set BL1 at Planning → Active ».  
*Avancement : Livraison 8 : « Planning BL1 posé » coché par la vraie référence BL1. · Attend : Confirmer la coche automatique du livrable « Planning BL1 posé » (DELIVERY-6 §8 L-2) · Sources : L-2, 01 OQ10, DELIVERY-1.md §7, DELIVERY-6.md §8 L-2, docs/delivery-6/notes-planning.md §3*

**~~R-055 · Saisir la date effective d’un changement d’étape~~** — *Prochaine étape · partiel · effort S* · **fait (Livraison 7)**  
Le CP indique la date réelle du changement d’étape (par exemple un PV de FAT signé la veille), proposée par défaut à aujourd’hui ; l’heure de saisie reste dans l’audit. Le DAL accepte déjà effectiveOn mais l’interface ne le propose pas, et c’est la date figée qui est inscrite.  
*Sources : L-4c, S-4, 03 OQ19, DELIVERY-1.md §4*

**~~R-185 · Projets multi-équipements (ex. une EMP et plusieurs MEMU) : adapter l’approche projet~~** — *À décider · non commencé · effort XL* · **fait (9)**  
Un projet peut fournir plusieurs équipements, de types différents et en plusieurs exemplaires (par exemple une EMP et plusieurs MEMU). Aujourd’hui un projet porte un seul type de machine : le modèle de création (phases, catégories de coûts, systèmes ITP), le plan ITP unique du projet, le budget de référence (références REX) et l’affichage du projet en dépendent ; la mise en service et la nomenclature ne savent pas à quel équipement se rattache un système ou une ligne. Le parc installé, lui, enregistre déjà une machine par équipement livré, avec son propre type. L’approche projet doit pouvoir s’adapter : équipements du projet (type, quantité), lots / systèmes, ITP, mise en service, nomenclature et coûts par équipement, livraison et parc installé par exemplaire. À cadrer avec le responsable produit avant de construire ; toute nouvelle fonction ne doit plus supposer « un seul type de machine par projet ». Analyse comparative du 25 oct. 2026 : le multi-équipements par projet est un besoin spécifique au métier d’EPC2i (sans équivalent direct dans les outils du commerce) ; parties 1 et 2 faites, reste la ventilation complète et la généralisation aux nouvelles fonctions. Priorité suggérée P2 pour ce qui reste.  
*Avancement : Consigné le 15 oct. 2026 à la demande du responsable produit ; à cadrer avant la livraison 9. 22 oct. 2026 : prérequis du lien avec l’application CAPEX (un besoin de plusieurs machines = un projet EPC2i à plusieurs équipements, recommandé). Demandes d’Arche (dépôt Arche, docs/DEMANDES-KEYSTONE.md et CONTRATS.md, 22 oct. 2026) : K-10 — un besoin de plusieurs machines doit pouvoir créer un projet EPC2i à plusieurs équipements ou en ajouter à un projet existant. 23 oct. 2026 : AC-5 tranché (oui) — un besoin de plusieurs machines = un projet EPC2i à plusieurs équipements ; cadrage proposé dans docs/delivery-9/cadrage-r185-r186.md, 5 choix à valider avant de construire. 23 oct. 2026 : les 5 choix du cadrage validés par le responsable produit. Partie 1 faite (docs/delivery-9/notes-r185-equipments.md) : lignes d’équipement project_equipments (type × quantité, EQ-01…), reprise des projets existants (migrations 0041-0042), carte « Équipement » sur l’écran Contrat, résumé « 1 × EMP · 3 × MEMU » au registre, assistant à plusieurs lignes avec lots propres à chaque équipement (phases per_equipment), budget de référence = somme des types × quantité. Reste (partie 2) : un plan ITP par ligne, réserves, mise en service, nomenclature et parc installé rattachés à l’équipement. Partie 2 faite (même notes, section « Partie 2 ») : un plan ITP par ligne d’équipement (migrations 0043-0044, plans existants rattachés à la ligne principale, numéros d’inspection uniques sur le projet), réserves, systèmes de mise en service, nomenclature et machines du parc installé rattachés à une ligne (ou communs), écrans ITP, réserves, mise en service, nomenclature et parc installé filtrés par équipement quand le projet a plusieurs lignes ; démonstration : HLT-026 EQ-02 (3 × MEMU) a son plan, deux inspections, une réserve C et un système. Reste : ventilation des coûts par équipement au Budget (à décider). 23 oct. 2026 : parties 1 et 2 fusionnées dans main (PR #29, #30), CI verte. 24 oct. 2026 : ventilation des coûts par équipement faite à la demande du responsable produit (carte « Budget par équipement », Budget › Structure : budget actuel, réel, EAC, valeur acquise et commandes ouvertes par ligne ; catégories de coûts et engagé hors commandes restent au niveau du projet). · Sources : Responsable produit, 15 oct. 2026 (note pour les futurs développements), Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**~~R-186 · Catalogue machines publié aux filiales (vue pub_catalogue_machines)~~** — *À décider · non commencé · effort L* · **fait (9)**  
Les types de machine deviennent des fiches catalogue (variantes, options, capacité nominale, prix catalogue indicatif, délai type, budget de référence, statut publié / retiré), lues par l’application CAPEX dans la vue pub_catalogue_machines. Le configurateur (règles d’options, chiffrage automatique) reste une option à valider.  
*Avancement : Consigné le 22 oct. 2026 (lien avec l’application CAPEX) ; à valider avant de construire. Demandes d’Arche (dépôt Arche, docs/DEMANDES-KEYSTONE.md et CONTRATS.md, 22 oct. 2026) : K-01 — pub_catalogue_machines (fiches publiées, versions, options, capacité nominale, prix indicatif, délai type, statut). 23 oct. 2026 : AC-4 tranché (oui) — le catalogue machines est un module de Keystone, construit à partir des types de machine ; cadrage dans docs/delivery-9/cadrage-r185-r186.md. 24 oct. 2026 : fait (docs/delivery-9/notes-r186-catalogue.md) — fiches catalogue versionnées (brouillon → publié → retiré, version publiée figée par déclencheur, une version en vigueur par code), section « Catalogue machines » de l’écran Types de machine (directeur et responsable ingénierie), case « propre à chaque équipement » sur les phases, vue pub_catalogue_machines au contrat K-01 (migrations 0045-0046), ligne d’équipement liée à une version publiée. Reste côté Matrix : recopier la vue dans 30-keystone.sql. · Sources : Responsable produit, 22 oct. 2026 (application CAPEX dédiée, DIG-PRODI v4.0), docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md*

**~~R-057 · Figer dans le projet les systèmes ITP du type de machine~~** — *Plus tard · partiel · effort S* · **fait (Livraison 8)**  
E-9 veut que la modification d’un type de machine ne touche que les nouveaux projets. Phases, lots et catégories sont copiés à la création, mais les systèmes ITP d’un projet existant sont relus en direct sur le type : il faut les copier dans le plan ITP à la création.  
*Avancement : Livraison 8 : systèmes ITP figés dans le plan à sa création (assistant, données de démonstration, premier « Ajouter une inspection »), reprise des plans existants (E-9). · Sources : E-9, A-2, L-3a, DELIVERY-5.md §4*

### 2.5 Planning (7 restants, 5 faits)

**R-060 · Gérer la date de situation par projet et le gel hebdomadaire du vendredi** — *Bloquant production · attend le responsable produit · effort L*  
Écrire projects.data_date (date de situation par projet, que le CP fait avancer) et l’utiliser pour l’avancement et les coûts ; tous les lecteurs passent déjà par projectDataDate() et le Plan l’affiche déjà, il ne manque que l’écrivain. Un gel le vendredi doit enregistrer l’instantané de la semaine (Tendances : CPI, SPI, EAC, marge, risques ; période EVM ; avancement) : freezeSnapshot existe mais n’est jamais appelé, et l’historique des Tendances et de l’EVM vient uniquement du seed (contraire à A-15). Volet lié de S-4 : les retards, échéances et horodatages doivent suivre l’horloge réelle, alors que TODAY/STATUS_ISO restent figés au 25 sept. 2026 dans environ 46 fichiers.  
*Attend : Précision du responsable produit : ce qui fait avancer la date (tâche du vendredi, action du CP, Replanifier) et ce que le gel enregistre (DELIVERY-6 §8 S-4) · Sources : S-4, A-15, 04 §2, Q11, 11 §3.3, DELIVERY-6.md §3, §8 S-4, docs/delivery-6/notes-planning.md §3 gap (6)*

**R-204 · Planning multi-niveaux : consolidation des plannings fournisseurs et codes d’activité** — *Prochaine étape · non commencé · effort L*  
Modéliser les plannings fournisseurs (lots d’achat) dans le CPM et les consolider dans le planning projet (sous-réseaux, liens vers les activités de réception), avec des codes d’activité (lot d’achat, site, équipement) pour filtrer et regrouper. Fonction avancée du marché (Planisware, Primavera P6). Aujourd’hui les plannings fournisseurs ne sont pas modélisés dans le CPM. Analyse comparative du 25 oct. 2026 : priorité P3, à décider.  
*Avancement : 01/11/2026 (K-204) : lancé en entier (plannings fournisseurs consolidés et codes d’activité) ; construit après le diagnostic du planning. · Sources : Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-206 · Diagnostic de la qualité du planning (métriques DCMA 14 points, analyse forensique des retards)** — *Prochaine étape · non commencé · effort M* · **en cours (Livraison 9)**  
Évaluer la qualité d’un planning avec les 14 contrôles DCMA (liens manquants, contraintes dures, marges négatives, durées longues, retards, liens début-fin…) et fournir une analyse forensique des retards (comparaison référence / actuel par activité, glissement du chemin critique). Fonction différenciante du marché (Deltek Acumen). Absent aujourd’hui. Analyse comparative du 25 oct. 2026 : priorité P3, à décider.  
*Avancement : 01/11/2026 (K-206, K-206b) : carte « Qualité du planning », 14 contrôles DCMA aux seuils du standard (modifiables) et analyse des retards ; en construction. · Sources : Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-063 · Trancher les règles restantes des références de planning (S-3)** — *À décider · attend le responsable produit · effort S*  
Trois choix restent : une référence proposée dont la CR est rejetée est-elle supprimée ou marquée rejetée ? Après BL1, « Re-baseline » du Planning devient-il le même lien vers une CR que le Plan ? Quand une ancienne CR est approuvée après une plus récente (CR-009 / BL2 après CR-011 / BL3), la dernière approbation l’emporte-t-elle ou garde-t-on la BLn la plus haute ?  
*Attend : Réponse du responsable produit (DELIVERY-6 §8 S-3) · Sources : S-3, DELIVERY-2.md §5, DELIVERY-6.md §8 S-3, docs/delivery-6/notes-planning.md §3*

**R-065 · Valider puis ajouter l’éditeur d’exceptions de calendrier** — *À décider · partiel · effort S*  
Les fermetures communes à l’entreprise passent déjà par Paramètres › Jours fériés, appliqués à tous les calendriers. Il manque les exceptions propres à un calendrier (jour ouvré exceptionnel, fermeture de chantier) : elles ont un écrivain dans le DAL mais aucune interface et n’arrivent que par les imports, désactivés. La réponse S-2 ne le demande pas : à valider avant de construire un éditeur (Paramètres ou Plan) réservé au CP et au directeur.  
*Attend : Validation du responsable produit (fonction hors prototype) · Sources : S-2, DELIVERY-6.md §3, docs/delivery-6/notes-planning.md §3 gap (4)*

**R-066 · Valider puis rendre éditables les contraintes de date des activités** — *À décider · non commencé · effort S*  
Le moteur CPM gère les contraintes (SNET, FNLT, MSO…), mais elles ne viennent que du seed ou des imports désactivés : un nouveau projet ne peut pas en avoir. La spécification demande type et date éditables ; absent du prototype, donc à valider avant construction.  
*Attend : Validation du responsable produit (fonction absente du prototype) · Sources : S-1, 05 §7 (Constraints)*

**R-200 · Nivellement automatique des ressources sur le planning CPM (copie comparée à la référence)** — *Plus tard · non commencé · effort L*  
Niveler automatiquement les activités du planning CPM selon la capacité des ressources (décalage des activités non critiques, respect des liens et des contraintes), appliqué sur une copie du planning et comparé à la référence avant adoption. Fonction avancée du marché (Primavera P6, MS Project). Aujourd’hui le what-if ne porte que sur les allocations hebdomadaires (src/domain/whatif.ts), sans nivellement d’activités. Analyse comparative du 25 oct. 2026 : priorité P2, à valider par le responsable produit (fonction absente du prototype).  
*Avancement : 01/11/2026 (K-200) : plus tard, la capacité réelle attend les absences de Cursus (R-084). · Attend : Validation du responsable produit · Sources : Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**~~R-061 · Réserver la structure du planning au CP et au directeur~~** — *Prochaine étape · partiel · effort M* · **fait (Livraison 7)**  
WBS, durées, budgets et liens ne sont modifiables que par le CP du projet et le directeur ; les responsables d’activité saisissent seulement l’avancement de leurs activités. Aujourd’hui ingénierie et qualité modifient le planning de tous les projets, et le membre n’a pas accès au Plan. Replanifier, références et suppression sont déjà limités au CP et au directeur.  
*Sources : P-9a, 05 OQ7, DELIVERY-6.md §7 Plan removal rights*

**~~R-062 · Lier une demande de modification aux activités du planning~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 7)**  
En plus du lot, une CR peut citer, en option, les activités touchées et leur nouvelle durée ; l’impact apparaît au prochain « Replanifier » et le lien s’affiche dans le tiroir d’activité. Il faut une table de liaison, le champ dans le formulaire et la fiche, et retirer le texte codé en dur « second crew (CR-008) » sur A1250.  
*Sources : NEW-D2-2, A-4, S-3, DELIVERY-1.md §5, DELIVERY-2.md §5, DELIVERY-5.md §6*

**~~R-198 · Gantt interactif : glisser-déposer, zoom jour/semaine, édition des liens et des durées~~** — *Prochaine étape · non commencé · effort L* · **fait (Livraison 9)**  
Rendre le Gantt du planning interactif : déplacer et redimensionner les activités par glisser-déposer, zoom jour / semaine / mois, création et édition des liens et des durées directement dans le diagramme, avec recalcul CPM immédiat. Standard du marché (Smartsheet, MS Project, Wrike). Aujourd’hui le Gantt est un rendu serveur en lecture seule à l’échelle mensuelle sur 13 mois (src/components/charts/project-gantt.tsx). Analyse comparative du 25 oct. 2026 : priorité P1, condition du remplacement de MS Project.  
*Avancement : Gantt des activités interactif (zoom jour/semaine/mois, glisser-déposer, liens, recalcul CPM immédiat, saisie au clavier) ; questions ouvertes dans notes-r198-gantt.md § 5. · Sources : Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**~~R-064 · Corbeille du Plan : confirmer rétention et droits, purge planifiée~~** — *Plus tard · partiel · effort S* · **fait (Livraison 9)**  
La confirmation et l’annulation demandées en S-5 sont livrées. Reste à faire confirmer les limites (30 jours, 20 entrées par projet) et la règle qui réserve suppression et restauration au CP et au directeur. Côté technique, à faire sans attendre la réponse : purger par tâche planifiée plutôt qu’à la suppression suivante, et renuméroter les positions en double après une restauration.  
*Avancement : S-5 confirmé le 31 oct. 2026 : 30 jours, 20 entrées par projet, suppression et restauration par les responsables du projet et le directeur ; purge planifiée toutes les heures et positions après restauration en place. · Sources : S-5, DELIVERY-6.md §6 Minor points, §8 S-5, docs/delivery-6/notes-planning.md §2, §3*

**~~R-067 · Créer les tâches de suivi des actions de compte rendu avec l’échéance saisie~~** — *Plus tard · non commencé · effort M* · **fait (Livraison 8)**  
À l’envoi du compte rendu, une action confiée à un externe (client, fournisseur) doit créer une tâche de suivi pour le responsable interne de la relation : stakeholders.owner_person_id, ou à défaut le CP. Toute tâche doit reprendre l’échéance saisie, déjà stockée dans meeting_lines.due_date, au lieu de J+3. Elle doit aussi reprendre l’activité liée, ce qui demande une colonne activity_id sur meeting_lines (migration) et un sélecteur d’activité dans le formulaire d’action.  
*Avancement : Livraison 8 : tâches de suivi des actions de compte rendu avec l’échéance saisie (S-12). · Sources : S-12, 05 OQ16-18, DELIVERY-3.md §5, §7*

### 2.6 Coûts, contrat et finance (5 restants, 13 faits)

**R-074 · Alimenter le coût réel depuis Cursus et Sage X3** — *Prochaine étape · attend un système externe · effort L*  
Coût réel = heures validées Cursus × taux en vigueur, plus achats à la réception, sous-traitance et locations sur facture validée dans Sage X3. Aujourd’hui seules les étiquettes de source existent et les colonnes actual / committed ne sont écrites que par le seed. Analyse comparative du 25 oct. 2026 : l’alimentation du réalisé depuis l’ERP (factures, réceptions) est attendue d’un connecteur ERP réel (Deltek, Planview) ; mock uniquement aujourd’hui. Priorité suggérée P1 avec R-034.  
*Attend : Heures Cursus (R-030), extractions Sage X3 (R-034) et grille de taux datée (R-083) · Sources : C-2a, A-10, I-3b, NEW-CURSUS-5, BACKLOG.md §1 bis, 04 Q3, DELIVERY-1.md §7, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-082 · Affecter codes analytiques et codes NIM par tâche, budgets par code NIM** — *Prochaine étape · attend le responsable produit · effort L*  
Le responsable produit fournira une extraction Sage des codes analytiques et de leur découpage en codes NIM. Chaque tâche recevra son code analytique et son code NIM, et les budgets seront rattachés aux codes NIM ; le découpage des budgets projet reste à revoir avec lui.  
*Attend : Extraction Sage des codes analytiques et NIM, puis discussion sur le découpage des budgets · Sources : S-6, NEW-SYS-1, I-3b, 05 OQ9, 04 §1, DELIVERY-6.md §5*

**R-205 · Analyse de risques Monte-Carlo sur coût et délai** — *Prochaine étape · non commencé · effort L* · **en cours (Livraison 9)**  
Simuler l’incertitude des durées et des coûts (lois triangulaires sur les activités et les risques liés) pour produire des distributions de fin de projet et de coût à terminaison avec niveaux de confiance (P50 / P80). Fonction avancée du marché (Primavera Cloud). Aujourd’hui le registre des risques est en probabilité × impact seulement ; le lien risque ↔ activité existe déjà dans le modèle (risks.activity_id). Analyse comparative du 25 oct. 2026 : priorité P3, à décider.  
*Avancement : 01/11/2026 (K-205, K-205b) : Monte-Carlo délai et coût, fourchettes saisies par le CP (défaut −10 % / +25 %) ; en construction. · Sources : Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-078 · Définir avec la finance la retenue de garantie et les cautions** — *À décider · attend le responsable produit · effort M*  
Le responsable produit doit vérifier avec la finance les types de retenues et garanties (retenue déduite des factures puis libérée, caution…) avant de choisir le calcul. Aujourd’hui la retenue est indicative, calculée sur les montants payés, sans effet sur les factures ni la trésorerie.  
*Attend : Retour du service finance (C-8 « À discuter ») · Sources : C-8, 04 Q14, DECISIONS.md « À traiter en priorité », DELIVERY-3.md §7*

**R-182 · Décider si les factures client sont émises et encaissées dans Sage X3** — *À décider · attend le responsable produit · effort M*  
Keystone émet lui-même les factures client avec sa propre numérotation (INV-2026-00n) et les marque payées à la main, alors que la facture légale et les encaissements relèvent normalement de la comptabilité (Sage X3), et que la réforme de la facturation électronique s'applique. Décider avec la finance si Keystone garde l'émission ou passe une demande de facturation à X3 et reçoit en retour le numéro et le paiement, comme pour les factures fournisseurs (SC-2).  
*Attend : Service finance : processus de facturation client dans Sage X3 (numérotation légale, encaissements, facturation électronique) · Sources : P-4, I-3b, A-5, SC-2 (règle analogue fournisseurs), 04 §4, DELIVERY-3.md §4 (Billing), §7 (P-4, 04 Q7)*

**~~R-075 · Gérer plusieurs devises avec consolidation en euros~~** — *Bloquant production · non commencé · effort L* · **fait (Livraison 7)**  
Chaque contrat, commande et facture garde sa devise ; budget, trésorerie et finance du portefeuille sont consolidés en euros au taux budgétaire fixé pour chaque projet. Aujourd’hui seul le symbole change et tous les montants sont en k€.  
*Attend : Taux budgétaire par projet à fournir par la finance · Sources : C-9, 04 Q17, BACKLOG.md §2 P4*

**~~R-068 · Propager les CR approuvées au budget et au contrat (registre unique)~~** — *Prochaine étape · non commencé · effort L* · **fait (Livraison 7)**  
À l’approbation d’une CR, réviser le BAC, les lots et les « modifications approuvées », et préparer l’avenant au contrat. L’écran Budget doit lire le registre unique des CR au lieu de sa liste budget_change_lines et de sa réconciliation figée. Aujourd’hui l’approbation ne rend courante que la référence de planning proposée.  
*Sources : A-4, 04 Q6, 07 §2.2, 11 §7 #2, DELIVERY-1.md §7, DELIVERY-2.md §5, §6*

**~~R-069 · Rendre séquentiel le circuit des CR avec étapes non requises automatiques~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 8)**  
Le circuit doit suivre CP → directeur → client → comité : le client ne voit la demande qu’après l’accord interne et le comité tranche en dernier (P-6b). L’étape client n’est requise que si le prix ou le délai contractuel change, et le comité qu’au-delà d’un seuil réglable dans les Paramètres (P-6c). Il faut distinguer l’impact contractuel, faire suivre Mes validations et le portail, et remplacer la cadence figée du comité.  
*Avancement : Livraison 8 : circuit séquentiel des demandes de modification, étapes selon l’impact contractuel et le seuil du comité (50 k€ par défaut, réglable). · Attend : Seuil et cadence du comité de contrôle des modifications, à fixer par la direction · Sources : P-6b, P-6c, A-4, 07 OQ3, 11 §6.3, DELIVERY-2.md §5, §7*

**~~R-070 · Faire du registre de la provision la source du « consommé » au Budget~~** — *Prochaine étape · non commencé · effort S* · **fait (Livraison 7)**  
Le « consommé » de la provision pour aléas affiché par le Budget doit être la somme des prélèvements du registre, avec la prévision de consommation à part. Aujourd’hui il affiche une valeur semée (208 k€, soit 139 % sur HLT-026) qui diffère du registre (48 k€) et ne suit pas les prélèvements.  
*Sources : A-8, 04 Q10, 11 §7 #18, DELIVERY-2.md §6, §7*

**~~R-071 · Imposer un lien et la validation du directeur aux prélèvements sur provision~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 7)**  
Un prélèvement doit être lié à une CR, un risque ou une NC choisis dans une liste, et ne compter qu’après accord du directeur dans Mes validations. Aujourd’hui il compte dès la saisie, le lien est un texte libre facultatif et le solde n’est pas contrôlé.  
*Sources : C-4, A-8, 04 Q8, DELIVERY-2.md §6, §7*

**~~R-072 · Saisir le coût d’un risque et calculer l’EMV = coût × P/5~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 7)**  
Remplacer la saisie directe de l’EMV par celle du coût « si le risque survient », puis dériver l’EMV. Cela demande une migration emv_keur → coût, l’adaptation du formulaire, de l’exposition, de la provision et des instantanés, et la mise à jour des tests golden en citant Q-1.  
*Sources : Q-1, 07 OQ4, DELIVERY-2.md §6, §7*

**~~R-073 · Calculer PV, EV, SPI/CPI, avancement et engagés à partir des données Keystone~~** — *Prochaine étape · non commencé · effort L* · **fait (Livraison 7)**  
Les séries PV/EV/AC (evm_periods) lues par le Budget, par la courbe « Avancement » du Planning (SPI mensuel) et par le portail client, ainsi que l’avancement, le coût réel et le SPI des projets, les réels/engagés des catégories et des lots, la réconciliation et les « commandes passées » (713 k€) sont des valeurs semées jamais recalculées : un nouveau projet n’a pas d’EVM. Calculer la PV depuis la référence chargée en coûts, l’EV = avancement × budget, l’avancement projet depuis les activités et l’engagé depuis les commandes Keystone. Déjà fait : barres et jalons du Planning (A-7) et dates réelles posées au Reschedule à partir du %.  
*Sources : C-2a, A-7, A-15, A-11, 04 Q3, 05 §7 (Progress entry), DELIVERY-1.md §5, DELIVERY-3.md §3*

**~~R-076 · Calculer l’échéance des factures client selon la règle du contrat~~** — *Prochaine étape · non commencé · effort S* · **fait (Livraison 7)**  
Chaque contrat choisit sa règle : N jours date de facture, 45 jours fin de mois, ou fin de mois + N jours ; échéances et encaissements de la trésorerie en découlent. DECISIONS.md indique « défaut appliqué », mais le code n’applique que des jours calendaires tirés d’un texte libre.  
*Sources : C-6, C-10a, 04 Q12, DELIVERY-3.md §7*

**~~R-079 · Donner aux avenants leurs propres jalons et un cycle de signature~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 7)**  
Un avenant signé doit porter ses propres échéances au lieu de re-chiffrer tous les jalons, y compris ceux déjà facturés (NEW-D3-3). Il faut modéliser les jalons par avenant, leur saisie, revoir le plan de facturation et les écarts jalon / facture, et ajouter les transitions brouillon → envoyé pour signature → signé ainsi que la libération des cautions.  
*Sources : NEW-D3-3, A-5, C-7, 11 §6.3 Amendment / Bond, DELIVERY-3.md §5*

**~~R-188 · Classe d’estimation des budgets et des offres (±50 % / ±30 % / +10 −5 %)~~** — *À décider · non commencé · effort M* · **fait (9)**  
Chaque version de budget et chaque offre porte une classe d’estimation, la fourchette est affichée, un indicateur « écart d’incertitude » est au tableau de bord ; une offre ferme exige la classe +10/−5 %.  
*Avancement : Consigné le 22 oct. 2026 (lien avec l’application CAPEX) ; à valider avant de construire. Demandes d’Arche (dépôt Arche, docs/DEMANDES-KEYSTONE.md et CONTRATS.md, 22 oct. 2026) : K-03 — classe d’estimation E50 / E30 / E10 et fourchette sur les réponses et les offres ; offre ferme = E10. 24 oct. 2026 : fait (docs/delivery-9/notes-r188-estimate-class.md) — classes E50 (±50 %), E30 (±30 %), E10 (+10 / −5 %) d’après ANALYSE-DIG-PRODI § 3 ; classe portée par chaque version de budget (baselines.estimate_class, migrations 0047-0048, proposée selon la phase au gel), tuile « Fourchette d’estimation » au Budget, indicateur « Écart d’incertitude » à la vue d’ensemble du portefeuille ; règle « offre ferme = E10 » prête pour les réponses aux besoins d’Arche (R-187, colonnes de pub_reponses_besoins). · Sources : Responsable produit, 22 oct. 2026 (application CAPEX dédiée, DIG-PRODI v4.0), docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md*

**~~R-077 · Bloquer la facturation quand les jalons dépassent 100 %~~** — *Plus tard · partiel · effort S* · **fait (Livraison 8)**  
L’échéancier reste modifiable, mais aucune facture ne doit partir tant que le total des jalons dépasse 100 % de la valeur du contrat. Aujourd’hui un simple avertissement s’affiche.  
*Avancement : Livraison 8 : facturation bloquée au-delà de 100 %, jalons prévus modifiables et supprimables. · Sources : C-7, 04 Q13*

**~~R-080 · Colorer les indicateurs du Budget selon les seuils et signer les barres d’écart~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
EAC, VAC, CPI et TCPI doivent suivre les seuils de santé des Paramètres au lieu d’être toujours en couleur d’alerte, et les barres d’écart doivent monter en cas d’économie et descendre en cas de dépassement.  
*Avancement : Livraison 8 : couleurs des indicateurs Budget sur les seuils de Paramètres, barres d’écart signées. · Sources : C-1, A-13, 04 Q1-Q2, DELIVERY-1.md §6*

**~~R-081 · Figer le montant des catégories de coûts après BL1~~** — *Plus tard · partiel · effort S* · **fait (Livraison 8)**  
Les catégories viennent déjà des Paramètres ; leur montant doit être libre avant BL1, puis ne changer que par une CR approuvée. Aujourd’hui il reste modifiable à tout moment.  
*Avancement : Livraison 8 : montants des catégories de coûts figés après BL1, catégorie imputée à l’approbation. · Sources : C-3, S-3, 04 Q4, DELIVERY-1.md §7*

### 2.7 Ressources et RH (4 restants, 5 faits)

**R-083 · Dater la grille de taux par rôle et unifier la valorisation des heures** — *Prochaine étape · partiel · effort M* · **en cours (Livraison 8)**  
Grille de taux par rôle (taux de base × coefficients) avec date d’effet et historique, un seul taux par rôle (R-4b), chaque heure valorisée au taux en vigueur et chaque personne reliée à son rôle. Supprimer les sources concurrentes : taux par intitulé de poste pour la note de coût des tâches, 62 €/h fixe de l’écran Heures, 60 €/h du what-if, et la modification en place qui revalorise tout l’historique.  
*Avancement : Livraison 8 : grille de taux datée, une seule valorisation des heures par rôle de la grille ; reste : source en production du rôle de taux d’une personne. · Attend : Rôle Finance pour les droits de modification (R-044) · Sources : A-10, R-4a, R-4b, P-12, 06 OQ6-7, 11 §7 #7, DELIVERY-2.md §5, §7*

**R-084 · Calculer la capacité et la charge réelles avec une source unique** — *Prochaine étape · partiel · effort L* · **en cours (Livraison 9)**  
Capacité = horaire contractuel de chacun (35 h par défaut, temps partiels respectés) − absences validées − fériés ; charge = affectations du planning et demandes approuvées ; même règle dans Ressources, Congés, what-if et Priorisation, le ratio par M€ ne servant qu’aux propositions sans planning. Aujourd’hui seul l’écran Congés déduit congés et fériés (sur 35 h fixes) ; les autres comptent 40 h fixes, lisent des pourcentages de charge semés et des capacités de service statiques, et Priorisation (pool × 40 h) diffère de Ressources (department_capacities).  
*Avancement : Lot « planning-load » (docs/delivery-9/notes-planning-load.md) : la charge vient des affectations des plannings (une seule source, getPlanningLoad) ; le travail non affecté à une personne compte par métier (service) ; alerte du matin au CP pour une activité sans ressource déclarée. Reste la partie capacité (horaire contractuel, absences Cursus). Quatrième tour (18 oct.) : équipes externes hors du plan de charge ; alerte du matin au CP à J-15 pour une activité sans affectation ; plannings de démonstration enrichis d’affectations nominatives (occupation 84 %, 3 personnes surchargées). Les niveaux de compétence attendent les besoins par activité. Lot « cursus-contract » (docs/delivery-9/notes-cursus-contract.md) : capacité hebdomadaire = 40 h moins 8 h par jour d’absence (leave_entries, toutes sources ; fériés exclus, règle de la vue semaine) dans la charge, la vue semaine, les barres de Ressources projet et le what-if. Reste : horaire contractuel (non exposé par Cursus), capacité des services, règle du taux d’occupation. Décision du 22 oct. (option 1) : congés de démonstration déplacés hors des affectations (src/server/db/seed/demo-leave.ts) — de nouveau 3 personnes au-delà de 110 %, occupation 84 %. · Attend : Absences Cursus (R-031) et source de l’horaire contractuel ; confirmation de la source de capacité (DELIVERY-6 §8 A-12) · Sources : R-1, L-5b, A-12, 06 OQ3, 03 OQ9, 11 §7 #16, DELIVERY-2.md §6, DELIVERY-3.md §5, DELIVERY-6.md §8 A-12*

**R-091 · Préciser les règles des scénarios what-if et des brouillons** — *À décider · attend le responsable produit · effort M*  
À trancher : ignorer un levier déjà demandé depuis une suggestion ou un autre scénario, approbation formelle d’un scénario, scénarios basés sur une référence, horizon au-delà de 8 semaines ; pour les brouillons, visibilité par le CP, demandeur à l’envoi, envoi par les achats, filtre « Brouillons ».  
*Attend : Réponses du responsable produit (DELIVERY-6 §8 S-7) · Sources : S-7, R-3, DELIVERY-6.md §8 S-7, docs/delivery-6/notes-whatif-kpis.md §5*

**R-089 · Envoyer aux achats une tâche pour trouver l’intervenant externe** — *Plus tard · non commencé · effort M* · **en cours (Livraison 8)**  
Après approbation d’une demande portant sur un profil sans personne nommée (intérim, sous-traitance), les achats reçoivent une tâche pour trouver l’intervenant ; la tâche passe ensuite à la personne retenue. Aujourd’hui la tâche est créée au nom du rôle contractuel, sans suite.  
*Avancement : Livraison 8 : la tâche de recherche part aux achats (P-8b), « Nommer la personne » ; créer une nouvelle personne attend l’annuaire Cursus (R-027). · Sources : P-8b, 08 OQ20, DELIVERY-2.md §7*

**~~R-085 · Afficher les plans de charge sur 8 semaines glissantes~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 9)**  
Ressources, Congés et what-if doivent partir de la semaine en cours, avec boutons précédent et suivant. Aujourd’hui ils montrent toujours les 8 semaines semées (28 sept. – 16 nov. 2026).  
*Avancement : Livraison 9, lot « load-window » (docs/delivery-9/notes-load-window.md) : Ressources, ressources du projet et Congés sur 8 semaines depuis la semaine en cours, boutons semaine précédente / suivante (±52 semaines) ; what-if sur la fenêtre en cours. Les autres lecteurs de charge suivront avec R-084. Réponses du 17 oct. 2026 : vues « Semaine » (congés jour par jour) et « 8 semaines » (pas d’une semaine ou de 8), navigation du what-if avec la période portée par toutes ses actions. Second tour (17 oct.) : répartition par projet de la vue semaine tirée des affectations du planning. · Attend : Horloge réelle (R-013) · Sources : R-7, S-4, S-7, 06 OQ15*

**~~R-086 · Afficher le coût main-d’œuvre du portefeuille par zone sur Ressources~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
La tuile « Coût main-d’œuvre à date » de l’écran Ressources global doit totaliser les heures valorisées de tous les projets de la zone affichée ; elle lit aujourd’hui la catégorie main-d’œuvre du dernier projet consulté.  
*Avancement : Livraison 8 : coût main-d’œuvre du portefeuille par zone (R-2 a). · Sources : R-2, 06 OQ2, DELIVERY-2.md §6*

**~~R-087 · Compétences : échelle unique 1–5 et deux indicateurs~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
Retirer les échelles 1–4, 1–3 et Oui/Non du formulaire « Ajouter une compétence » (R-5a) et séparer l’indicateur unique en « aucun expert » et « un seul expert » (R-5b).  
*Avancement : Livraison 8 : une échelle de compétences 1–5 et deux indicateurs (R-5a, R-5b). · Sources : R-5a, R-5b, 06 OQ8, OQ11*

**~~R-088 · Rendre réglable le seuil d’écart d’heures (±10 %, inclus), couleurs distinctes~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
Le seuil se règle dans les Paramètres, inclut la valeur limite et distingue sur- et sous-déclaration ; à reprendre dans le futur écran Heures (Cursus). Aujourd’hui il est fixe, strict, et les deux cas ont la même couleur.  
*Avancement : Livraison 8 : seuil d’écart d’heures réglable dans Paramètres (R-6b, 10 % par défaut). · Sources : R-6b, 06 OQ10, DELIVERY-2.md §4*

**~~R-090 · Autoriser la relance d’une demande de ressource retirée~~** — *Plus tard · partiel · effort S* · **fait (Livraison 8)**  
« Relancer » doit aussi apparaître sur une demande retirée, qui repart en attente à la date du jour. Le DAL l’accepte déjà, mais l’action serveur et le bouton sont limités aux demandes refusées.  
*Avancement : Livraison 8, lot travail et planning : une demande retirée peut être relancée (P-8c). · Sources : P-8c*

### 2.8 Achats et stock (5 restants, 4 faits)

**R-093 · Reprendre la liste des fournisseurs de Sage X3 et supprimer la saisie libre** — *Bloquant production · attend le responsable produit · effort M*  
Les fournisseurs doivent venir du fichier X3 (avec le code X3) et être choisis dans une liste pour les articles, les consultations, les commandes et les factures. Les nouveaux fournisseurs se créent dans X3. Aujourd’hui ils sont saisis librement, et un fabricant inconnu crée un fournisseur, ce qui produit des doublons et empêche le rapprochement avec X3. Analyse comparative du 25 oct. 2026 : la reprise du référentiel fournisseurs depuis l’ERP fait partie du connecteur Sage X3 réel attendu (niveau avancé du marché, Deltek / Planview) ; mock uniquement aujourd’hui. Priorité suggérée P1 avec R-034.  
*Attend : Extraction automatisée du fichier fournisseurs Sage X3 (R-034, I-3b) et partage des rôles (A-1a) · Sources : SC-7b, NEW-D4-4, A-1a, I-3b, SC-4, DELIVERY-4.md §6, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-094 · Appliquer la procédure d’achats (seuils et circuit de validation des commandes)** — *Bloquant production · attend le responsable produit · effort M*  
Le responsable produit doit transmettre la procédure d’achats (montants et circuit de validation dans Sage). Keystone en tirera ses règles d’approbation et les données à transmettre à Sage. Aujourd’hui le CP du projet ou le directeur approuve n’importe quelle commande, sans limite de montant.  
*Attend : Procédure d’achats fournie par le responsable produit · Sources : P-5a, A-1a, 08 OQ11, DECISIONS.md « À traiter en priorité », DELIVERY-4.md §7, §8*

**R-095 · Annuler une commande d’achat avec motif (brouillon, puis commande passée selon arbitrage)** — *Prochaine étape · non commencé · effort M* · **en cours (Livraison 8)**  
Il faut ajouter « Annuler » avec un motif obligatoire. Pour un brouillon, l’auteur annule dans Keystone ; ce cas est cohérent avec P-5c et SC-3a et peut se faire tout de suite. Pour une commande passée, les deux réponses se contredisent : SC-3a fait annuler le CP ou le directeur dans Keystone avec report vers X3, alors que P-5c fait annuler dans Sage X3 et Keystone reprend le statut. Le responsable produit doit trancher, puis on ajoute « Solder le reste à livrer » (SC-3a).  
*Avancement : Livraison 8, lot achats et ingénierie : annulation avec motif d’une commande pas encore passée (SC-3a, P-5c), avis à l’acheteur ; l’annulation d’une commande passée attend l’arbitrage du responsable produit. · Attend : Arbitrage P-5c / SC-3a pour l’annulation d’une commande passée ; report ou reprise du statut via le connecteur X3 (R-034) · Sources : SC-3a, P-5c, I-3b, 08 OQ12, DELIVERY-4.md §6, §8*

**R-092 · Arbitrer le partage achats / stock entre Keystone et Sage X3** — *À décider · attend le responsable produit · effort M*  
Le responsable produit doit décider avec la finance, les achats et la logistique qui saisit et qui fait foi pour les commandes et le stock. Il a classé la question « Bloquant production ». Aujourd’hui Keystone crée les commandes et les mouvements, et l’envoi vers X3 est simulé. Cette décision conditionne le connecteur X3 (R-034) et les règles de validation (R-094).  
*Attend : Discussion du responsable produit avec finance, achats et logistique (modules utilisés dans Sage X3) · Sources : A-1a, I-3b, DECISIONS.md « À traiter en priorité », 00 §10 A-1, DELIVERY-4.md §3, §8*

**R-100 · Décider comment les devis fournisseurs entrent dans les consultations** — *À décider · attend le responsable produit · effort M*  
Une consultation créée dans Keystone ne reçoit jamais de devis : elle ne peut être ni comparée ni attribuée, et le KPI « délai moyen » reste vide. Avant de construire l’écrivain, le responsable produit doit choisir entre la saisie par l’acheteur, l’import X3 et un portail fournisseur.  
*Attend : Réponse du responsable produit (SC-7a « je dois me renseigner ») · Sources : SC-7a, SC-7, 08 #3, #4, DELIVERY-4.md §6, §8, DELIVERY-6.md §8 A-12, docs/delivery-6/notes-whatif-kpis.md §5.6*

**~~R-096 · Réception refusée : NC fournisseur Vigie pré-remplie et alerte acheteur~~** — *Prochaine étape · non commencé · effort S* · **fait (Livraison 8)**  
Sur un refus total ou partiel à la réception, proposer « Déclarer la NC fournisseur dans Vigie », pré-rempli avec le fournisseur, la commande, l’article et la quantité refusée, et notifier l’acheteur. Aujourd’hui le refus ne fait que mettre la marchandise en quarantaine. Le côté Keystone (lien et notification) peut se construire dès maintenant, mais le pré-remplissage dépend de Vigie.  
*Avancement : Livraison 8 : réception refusée → NC fournisseur Vigie pré-remplie et alerte à l’acheteur (NEW-D4-3, SC-3b). · Attend : Vigie doit accepter les paramètres fournisseur, commande et quantité dans /signaler (V-3) · Sources : SC-3b, NEW-D4-3, V-3b, DELIVERY-4.md §6, §8, DELIVERY-5.md §5.1*

**~~R-097 · Présenter le PDF de commande Keystone comme un récapitulatif interne~~** — *Prochaine étape · non commencé · effort S* · **fait (Livraison 7)**  
Le document officiel envoyé au fournisseur est le bon de commande édité par Sage X3. « Exporter la commande » doit donc produire un récapitulatif interne qui renvoie à la référence X3, sans la signature « Accusé de réception fournisseur » ni les consignes au fournisseur.  
*Sources : SC-4b, A-1a*

**~~R-098 · Rendre obligatoire l’activité d’une sortie de stock et imputer le coût au lot~~** — *Prochaine étape · partiel · effort M* · **fait (Livraison 7)**  
« Sortir vers une activité » doit proposer les activités du planning du projet et rendre le choix obligatoire. Le coût matière doit ensuite remonter par lot de travaux dans le suivi des coûts. Le DAL gère déjà une activité facultative, mais l’interface n’a pas de sélecteur.  
*Sources : SC-5a, A-11, 08 OQ14, DELIVERY-4.md §6, §8*

**~~R-099 · Protéger le stock réservé pour un autre projet~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 7)**  
Une sortie ou un rebut ne doit plus consommer des unités réservées pour un autre projet. Le chef de l’autre projet doit d’abord libérer sa réservation (NEW-D4-2, SC-5b) : il faut donc un refus côté domaine et une opération « Libérer la réservation » réservée à ce projet. Le transfert fait déjà suivre la réservation et refuse une destination réservée par un autre projet. Les décisions ne demandent pas de circuit de demande d’accord.  
*Sources : NEW-D4-2, SC-5b, 08 OQ14, DELIVERY-4.md §6, §8*

### 2.9 Ingénierie et PLM (2 restants, 10 faits)

**R-107 · Lire les exports natifs EPLAN, TIA Portal et SolidWorks** — *Prochaine étape · attend le responsable produit · effort XL*  
L’assistant « Importer une liste » ne lit aucun fichier : 27 lignes, mapping et écarts semés du prototype, et « Générer xlsx » horodate sans produire de fichier. Il faut lire chaque format natif, comparer à la révision précédente (écarts, contrôles de cohérence) et produire les fichiers ; confirmer d’abord que ce sujet est distinct de D-7b.  
*Attend : Échantillons d’exports réels de chaque outil fournis par l’ingénierie ; confirmation que D-7b ne s’applique pas · Sources : NEW-D5-1, D-7b, A-15, DELIVERY-5.md §4, §6*

**R-101 · Trancher qui est maître du référentiel articles (3DX / PDM ou Keystone)** — *À décider · attend le responsable produit · effort M*  
Le responsable produit pense que les numéros d’articles PLM sont attribués par SolidWorks 3DX ; l’ingénierie doit le confirmer, ainsi que le système visé (3DEXPERIENCE ou SolidWorks PDM). Si c’est le cas, la création d’articles dans Keystone devient une reprise en lecture, Keystone n’ajoutant que ses données techniques.  
*Attend : Confirmation de l’ingénierie (A-1b, marqué Bloquant production) · Sources : A-1b, E-1a, E-1b, 09 §5.9, DECISIONS.md « À traiter en priorité », DELIVERY-4.md §3*

**~~R-102 · Mettre en place la validation des articles par l’ingénierie~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 8)**  
La création n’exige que le minimum ; le responsable ingénierie fait passer l’article de « Non validé » à « Validé », refusé sans code HS, restriction export, délai et référence fabricant (E-1b). « Périmé » et « Obsolète » ne viennent que d’un ECO diffusé dans Vigie (E-1a). Aujourd’hui aucun changement de statut n’existe.  
*Avancement : Livraison 8 : validation des articles par le responsable ingénierie ou le directeur, contrôle export explicite (E-1a, E-1b). · Attend : Référentiel articles maître (R-101) · Sources : E-1a, E-1b, A-1b, 09 OQ5, 11 §6.6, DELIVERY-4.md §5, §9*

**~~R-103 · Valoriser la nomenclature au prix commandé, sinon dernier achat, sinon catalogue~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 7)**  
Appliquer une seule règle à la liste à plat, à l’arborescence, au coût d’un nœud et à la comparaison de révisions : prix de la ligne de commande du projet, sinon dernier prix d’achat, sinon catalogue ; le stock reste au dernier prix d’achat. Le « dernier prix d’achat » doit aussi être tenu à jour (aujourd’hui 15 prix figés semés du prototype) à partir des commandes reçues dans Keystone. Mettre à jour les tests golden en citant E-2a / A-11.  
*Sources : E-2a, A-11, 08#6, 09 OQ7, 11 §7 #8, DELIVERY-4.md §3, §8*

**~~R-105 · Prendre la dernière révision figée ou diffusée comme référence des entrées~~** — *Prochaine étape · non commencé · effort S* · **fait (Livraison 7)**  
Une discipline qui travaille sur une révision figée doit être considérée à jour. Aujourd’hui une révision seulement « Figée » renvoie à la lettre précédente, et LST-IO-026 rév. B est signalé périmé par rapport à une rév. A ; mettre à jour le test golden en citant E-5.  
*Sources : E-5, 09 OQ12, DELIVERY-5.md §6, §8*

**~~R-106 · Faire lancer le circuit Codex par « Valider la diffusion » des livrables d’ingénierie~~** — *Prochaine étape · partiel · effort M* · **fait (Livraison 7)**  
« Valider la diffusion (CP) » doit lancer le circuit d’approbation du type de document ; le livrable ne passe à Diffusé qu’une fois toutes les étapes approuvées. Le circuit miroir existe déjà (Documents › « Approuver dans Codex », diffusion à la dernière étape), mais l’écran Ingénierie le court-circuite : le CP ou le directeur passe directement à Diffusé. Il reste à brancher l’ingénierie sur ce circuit, puis à transmettre les décisions à Codex.  
*Attend : Rien pour la partie Keystone (circuit miroir existant) ; transmission réelle des approbations à Codex via le connecteur (D-1b, R-033, R-124) · Sources : P-7c, D-1b, E-5, 09 OQ11, DELIVERY-5.md §6*

**~~R-191 · Part EPC2i du pack ingénierie et son % de complétude (vue pub_pack_ingenierie)~~** — *À décider · non commencé · effort M* · **fait (9)**  
Types de livrable layout / plan de masse machine, schéma électrique et bilan de puissance, analyse fonctionnelle ; liste type pondérée par type de machine ; % de complétude au tableau de bord ingénierie ; vue pub_pack_ingenierie pour le Dossier Investissement du CAPEX (cible > 80 %).  
*Avancement : Consigné le 22 oct. 2026 (lien avec l’application CAPEX) ; à valider avant de construire. 25 oct. 2026 : fait avec la liste provisoire validée par le responsable produit (docs/delivery-9/notes-r191-engineering-pack.md) — 5 familles × 20 % par type de machine (P&ID, nomenclature, implantation, électrique, analyse fonctionnelle), modifiables sur l’écran Types de machine ; pièces = documents de l’index Codex par type de document, validées = diffusées ; carte « Pack ingénierie · part EPC2i » sur la Synthèse ingénierie (cible > 80 %) ; vue pub_pack_ingenierie (migrations 0058-0060). Reste : la vraie liste type (C-9). · Sources : Responsable produit, 22 oct. 2026 (application CAPEX dédiée, DIG-PRODI v4.0), docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md*

**~~R-104 · Chiffrer les remplacements d’articles entre deux révisions~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
Dans la comparaison de révisions, une substitution doit valoir (nouveau prix − ancien prix) × quantité ; aujourd’hui seule une variation de quantité est chiffrée et une substitution à quantité égale affiche 0 €.  
*Avancement : Livraison 8 : remplacement chiffré entre deux révisions (E-2b). · Sources : E-2b, E-2a, 09 OQ8*

**~~R-108 · P&ID : rechercher l’article d’un repère dans tout le catalogue~~** — *Plus tard · non commencé · effort M* · **fait (Livraison 8)**  
Rechercher dans tout le catalogue, avec un filtre par type et la nomenclature du projet en tête ; lier un article absent de la nomenclature propose de l’y ajouter. Aujourd’hui la liste se limite à 8 articles compatibles déjà dans la nomenclature, et tout autre article est refusé.  
*Avancement : Livraison 8 : recherche de l’article d’un repère P&ID dans tout le catalogue (E-6). · Sources : E-6, 09 OQ15, DELIVERY-5.md §4, §6, §8*

**~~R-109 · P&ID : signaler l’écart de révision avec Codex et proposer un ré-import~~** — *Plus tard · partiel · effort S* · **fait (Livraison 8)**  
Quand l’index Codex porte une révision plus récente que celle d’où les repères ont été extraits, un bandeau doit le signaler et ouvrir l’import « Importer les repères P&ID » existant, sans rien bloquer. Aujourd’hui l’écart n’apparaît qu’en infobulle ; le ré-import lui-même existe déjà.  
*Avancement : Livraison 8 : écart de révision P&ID avec Codex signalé, ré-import proposé (A-9). · Sources : A-9, 09 OQ13, 11 §7 #10, DELIVERY-5.md §5.3, §8*

**~~R-110 · Ne protéger pour le parc que les pièces réellement montées~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
La mention « à garder pour le parc installé » ne doit concerner que les pièces de l’ECO montées sur chaque machine concernée, d’après sa configuration ; aujourd’hui toutes les pièces de l’ECO sont marquées pour chaque machine.  
*Avancement : Livraison 8 : seules les pièces montées sont protégées pour le parc installé (E-4). · Attend : Configuration des machines tenue à jour (R-144) · Sources : E-4, E-8, 09 OQ21, DELIVERY-4.md §7*

**~~R-111 · Signaler le doublon possible de la grue EQ-CRN-250T / ASM-RMG-250~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
La nomenclature de HLT-026 compte peut-être deux fois la même grue. La réponse retenue (NEW-D4-5 c) demande de signaler le doublon possible jusqu’à la réponse du bureau d’études, ce qui n’est pas fait et peut l’être dès maintenant. Corriger ensuite les données ou la règle de valorisation selon la réponse.  
*Avancement : Livraison 8 : doublon possible EQ-CRN-250T / ASM-RMG-250 signalé (NEW-D4-5 c). · Attend : Réponse du bureau d’études (même grue ou deux équipements) pour la correction définitive ; le signalement n’attend rien · Sources : NEW-D4-5, E-2, A-11, DELIVERY-4.md §3, §6, §8*

### 2.10 Qualité, chantier et mise en service (3 restants, 10 faits)

**R-113 · Piloter les étapes de mise en service et le dossier de transfert** — *Prochaine étape · non commencé · effort L*  
Rendre la grille modifiable : une étape (fin de montage, pré-mise en service, mise en service, SAT, transfert) ne se valide que si ses inspections obligatoires sont passées, sans réserve A ni interface bloquante, et c’est le CP ou le responsable mise en service qui la valide. Il faut aussi définir quelles inspections sont obligatoires par étape (les étapes ITP atelier/FAT/site/SAT ne correspondent pas aux étapes de mise en service), calculer les blocages au lieu du blockingRef semé, et créer la grille des nouveaux projets (l’assistant ne crée que le plan ITP). Aujourd’hui seule la date de la SAT est enregistrée.  
*Attend : Saisie des résultats d’inspection (R-112) ; désignation du « responsable mise en service », qui n’est pas un rôle Keystone · Sources : Q-5, 07 OQ11, 11 §6.4, DELIVERY-5.md §6, §8*

**R-123 · Statuer sur le journal client retiré et la notion de « décision client »** — *À décider · attend le responsable produit · effort S*  
La table client_communications et son DAL sont conservés mais inaccessibles : faut-il les supprimer par une nouvelle migration ? Une « décision client » est aujourd’hui toute décision d’une réunion externe, revues fournisseurs comprises : faut-il un indicateur « client présent » ?  
*Attend : Réponse du responsable produit (DELIVERY-6 §8 D-5) · Sources : D-5, DELIVERY-6.md §3, §8 D-5, docs/delivery-6/notes-admin-settings.md §2.3, §4 points 1-2*

**R-192 · Sécurité machine : HazOp / AMDEC, ATEX, condition PSSR avant mise en service** — *À décider · non commencé · effort M*  
HazOp / AMDEC machine, zonage ATEX machine et condition « PSSR obtenu » avant la mise en service avec produit, lus dans Vigie (miroir) et bloquants dans Keystone.  
*Avancement : Consigné le 22 oct. 2026 (lien avec l’application CAPEX) ; à valider avant de construire. · Attend : Vigie : porte-t-il HazID / HazOp / AMDEC / PSSR ? · Sources : Responsable produit, 22 oct. 2026 (application CAPEX dédiée, DIG-PRODI v4.0), docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md*

**~~R-112 · Saisir les résultats d’inspection ITP et ouvrir une NC Vigie en cas d’échec~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 7)**  
La qualité et le responsable ingénierie enregistrent le résultat (conforme, non conforme) et, pour un point témoin, le représentant client présent (Q-6a). Un résultat non conforme ouvre le formulaire NC de Vigie pré-rempli (projet, inspection, système, article) et le numéro Vigie s’affiche sur l’inspection à la synchro (Q-6b). Aujourd’hui les résultats sont en lecture seule.  
*Attend : Paramètres de pré-remplissage acceptés par /signaler de Vigie (V-3) · Sources : Q-6a, Q-6b, V-3, 07 OQ12, 11 §6.4, DELIVERY-5.md §6, §8*

**~~R-114 · Remettre « En cours » un livrable refusé par le client, révision suivante~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 7)**  
Après un refus du client, le livrable repart « En cours » avec la révision suivante, puis est soumis de nouveau, en conservant l’historique des refus et des commentaires (table d’historique à créer). Le document de la nouvelle révision, déposé dans Codex, se relie par le lien existant vers l’index Codex. Aujourd’hui « Refusé » est terminal et le refus écrase les commentaires.  
*Sources : Q-3a, 07 OQ9, 11 §6.4, DELIVERY-5.md §6*

**~~R-115 · Ajouter un bouton « Nouveau livrable » pour le chef de projet~~** — *Prochaine étape · non commencé · effort S* · **fait (Livraison 7)**  
Le CP crée les livrables contractuels à la main : type (liste des Paramètres), titre, échéance, responsable et suppléant. Aujourd’hui aucun écran ne crée de livrable.  
*Sources : Q-3b, A-14, 07 OQ19, DELIVERY-5.md §6*

**~~R-118 · Permettre au CP de créer et renseigner la fiche chantier~~** — *Prochaine étape · non commencé · effort L* · **fait (Livraison 8)**  
Un bouton « Préparer le chantier », disponible dès les Études, crée la fiche chantier avec l’identifiant du chantier Cursus et ouvre le module. Il faut ensuite pouvoir saisir prérequis, équipements, rotations et frais de mission, avec un message quand ces tables sont vides. Aujourd’hui seule la fiche semée de HLT-026 existe.  
*Avancement : Livraison 8 : les responsables du projet préparent et renseignent la fiche chantier dès les Études (D-3) ; la création du chantier dans Cursus (R-028), les coûts réels saisis (R-074) et l’avancement en jours restent à faire. · Attend : Création du chantier dans Cursus (R-028) pour l’identifiant · Sources : D-3, NEW-CURSUS-1, DELIVERY-5.md §8 C-3 (Cursus : projet ↔ chantier, distinct du C-3 coûts de DECISIONS.md), 10 OQ5, 11 §3.11, DELIVERY-5.md §3, §4, §6*

**~~R-119 · Détecter et lever automatiquement les conflits de l’équipe chantier~~** — *Prochaine étape · non commencé · effort L* · **fait (Livraison 8)**  
Un conflit (double affectation, congé, habilitation ou badge qui expire) doit être calculé et disparaître avec sa cause ; le chef de service peut aussi le marquer « arbitré » avec un commentaire. La double affectation (rotations Keystone) et l’arbitrage manuel peuvent se faire tout de suite ; habilitations et badges peuvent venir des motifs Go/No-Go déjà reçus de Cursus ; seuls les congés attendent une source Cursus. Aujourd’hui les conflits sont des lignes semées sans résolution et bloquent en permanence « Équipe sans conflit » du Go chantier.  
*Avancement : Livraison 8 : conflits de l’équipe chantier calculés (charge, autre chantier, habilitations et absences Cursus) et arbitrés par le chef du service de la personne (D-6b) ; la table site_collisions est gardée jusqu’à confirmation. · Attend : Congés fournis par Cursus (pour les conflits de congé seulement) · Sources : D-6b, 10 OQ10, 11 §6.7, DELIVERY-5.md §4*

**~~R-120 · Exiger au moins un verdict Cursus pour le Go chantier~~** — *Prochaine étape · non commencé · effort S* · **fait (Livraison 7)**  
Sans aucun verdict reçu (par exemple un projet sans chantier Cursus), la condition « Go individuel · Cursus » doit rester ouverte au lieu d’afficher « Prête » ; un GO avec réserve reste accepté et un NO GO bloque. Ajouter le cas « aucun verdict » dans src/domain/site.test.ts en citant NEW-SITE-1 (aucun script golden ne couvre goChantier).  
*Sources : NEW-SITE-1, DELIVERY-5.md §6, §8 Site*

**~~R-116 · Dater la réception d’une interface~~** — *Plus tard · partiel · effort S* · **fait (Livraison 8)**  
« Marquer reçue » doit proposer la date du jour, modifiable si l’information est arrivée plus tôt ; l’indicateur « Échéance sous 30 jours » est déjà corrigé.  
*Avancement : Livraison 8 : date de réception d’une interface (Q-4). · Sources : Q-4, 07 OQ10, DELIVERY-3.md §5*

**~~R-117 · Fusionner les réserves ITP et chantier en une liste unique par projet~~** — *Plus tard · non commencé · effort M* · **fait (Livraison 8)**  
Une seule liste de réserves par projet, chaque réserve portant son origine (inspection ou chantier), sa catégorie A/B/C, sa partie responsable, sa NC ou inspection d’origine en option et un numéro unique. Aujourd’hui une même table porte deux registres numérotés séparément : les réserves chantier sont en lecture seule (ni ajout ni clôture) et le « Bloquant A » de la mise en service ne compte que le registre ITP.  
*Avancement : Livraison 8, lot qualité et chantier : une liste de réserves par projet (origines Inspection et Chantier), numérotée sur le projet ; les réserves chantier de HLT-026 deviennent P-06…P-08 (A-6). · Sources : A-6, 11 §7 #4, DELIVERY-5.md §3, §8*

**~~R-121 · Alerter le CP à J-15 sur un prérequis client non confirmé~~** — *Plus tard · partiel · effort M* · **fait (Livraison 9)**  
Un contrôle quotidien envoie une notification au CP et lui propose un risque pré-rempli à confirmer quand un prérequis client n’est pas confirmé à J-15. Aujourd’hui le retard n’est qu’un indicateur à l’écran.  
*Avancement : Livraison 9, lot « prereq-alert » (docs/delivery-9/notes-prereq-alert.md) : tâche quotidienne, une notification au CP par prérequis client non confirmé à J-15, « Ouvrir un risque » prérempli depuis la ligne du chantier, lié au prérequis. Réponses du 17 oct. 2026 : rappels automatiques chaque matin à 07:00 (KEYSTONE_REMINDERS_AT), destinataire le CP seul, CP ajouté aux responsables de risque proposés. Second tour (17 oct.) : mention de la lettre client retirée ; un risque peut être ouvert depuis tout prérequis non confirmé, avant J-15. Troisième tour : l’alerte J-15 part aussi quand un risque est déjà lié (elle le cite) ; un nouveau risque peut être ouvert quand le prérequis est en retard. · Attend : Notifications par événement (R-015) et tâches planifiées (R-006) · Sources : D-4, X-6a, 10 OQ6, DELIVERY-5.md §7*

**~~R-122 · Retirer la case incident du rapport journalier au profit de Vigie~~** — *Plus tard · partiel · effort S* · **fait (Livraison 8)**  
La tuile HSE compte déjà les incidents de Vigie ; le rapport journalier doit cesser de demander un incident et renvoyer vers « Déclarer dans Vigie ».  
*Avancement : Livraison 8 : plus de case incident HSE dans le rapport journalier ; un lien Vigie prérempli à la place (NEW-SITE-2). · Sources : NEW-SITE-2, A-12, DELIVERY-5.md §6*

### 2.11 Documents (1 restants, 4 faits)

**R-125 · Déposer dans Codex via son formulaire pré-rempli** — *Prochaine étape · attend un système externe · effort M*  
Remplacer le dépôt simulé, où Keystone numérote lui-même (aperçu « count + 40 ») sans changer la lettre de révision et avec un titre par défaut du prototype, par l’ouverture du formulaire de dépôt Codex pré-rempli (projet, type, liens) ; Codex attribue numéro et révision et la fiche revient par la synchro. « Joindre le bon de livraison » d’une réception doit passer par le même dépôt (SC-4a).  
*Attend : Routes et paramètres du formulaire de dépôt Codex, et lecture de l’index Codex pour le retour de la fiche · Sources : D-1a, SC-4a, I-3a, docs/spec/10 §11 OQ14, DELIVERY-3.md §5, §7, DELIVERY-4.md §6, §8*

**~~R-124 · Transmettre à Codex les approbations de documents faites dans Keystone~~** — *Bloquant production · non commencé · effort M* · **fait (Livraison 7)**  
L’approbateur désigné décide dans Keystone, y compris directement depuis Mes validations, et la décision part vers Codex par une outbox « en attente de synchro » avec accusé de réception ; Codex reste la référence. Aujourd’hui l’approbation n’écrit que dans l’index local, Mes validations renvoie au tiroir et il n’existe aucun connecteur Codex (seulement une URL). L’outbox, le connecteur mock et la décision dans Mes validations peuvent être faits dès maintenant sur le modèle du connecteur ECO Vigie ; seul l’envoi réel attend Codex.  
*Avancement : Livraison 7 : circuit vers Codex par file d’attente ; connecteur simulé tant que l’API Codex n’existe pas (CODEX_API_URL). · Attend : API d’approbation de Codex pour l’envoi réel uniquement (outbox, mock et décision dans Mes validations faisables dès maintenant) · Sources : P-7b, D-1b, P-7, I-3a, docs/spec/10 §11 OQ12, DELIVERY-6.md §6, §8 D-1*

**~~R-126 · Stocker les photos (réception, chantier, réserves) dans Keystone~~** — *Prochaine étape · partiel · effort M* · **fait (Livraison 7)**  
Déposer les photos de réception, de chantier et de réserves dans Keystone avec la mécanique des pièces jointes de tâches (ajout réservé à qui peut modifier l’écran). Les aperçus de plans, PDF et images P&ID viendront de Codex et du PDM (R-033, R-035). Aujourd’hui les photos ne sont qu’un compteur et les cadres d’aperçu sont vides.  
*Sources : X-15, SC-4a, 02 Q-18, C-31, DELIVERY-4.md §6, DELIVERY-5.md §3, §6*

**~~R-127 · Limiter la reprise Codex à la fiche, à la révision et au circuit en cours~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
Keystone ne reprend de Codex que la fiche, la révision en cours et le circuit en cours ; l’historique complet et le journal des téléchargements s’ouvrent dans Codex, les accusés de réception du portail restant dans Keystone. Aujourd’hui ces historiques sont reconstitués depuis le prototype.  
*Avancement : Livraison 8 : l’historique reste dans Codex — fiche, révision courante et circuit en cours seulement ; journal de téléchargement Keystone supprimé (D-2). · Attend : Connecteur Codex et liens profonds par document (R-033) · Sources : D-2, D-1a, DELIVERY-3.md §5*

**~~R-128 · Rendre cliquables les relations Livrable, Commande et Réserve d’un document~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
Dans le tiroir d’un document, seules les relations Article et CR sont des liens ; Livrable, Commande d’achat et Réserve restent inertes alors que ces écrans existent depuis les livraisons 4–5.  
*Avancement : Livraison 8 : relations Livrable, Commande et Réserve cliquables ; les lignes de réserve ont leur ancre (R-117). · Sources : 10 OQ15, DELIVERY-3.md §5*

### 2.12 Portefeuille, pilotage et indicateurs (2 restants, 8 faits)

**R-203 · Tableaux de bord configurables par l’utilisateur et connecteur Power BI / Dataverse** — *Prochaine étape · non commencé · effort L* · **en cours (Livraison 9)**  
Laisser chaque utilisateur composer ses tableaux de bord (widgets, filtres, indicateurs, enregistrement et partage) et ouvrir les données à Power BI / Dataverse (vues pub_ ou flux OData / API) pour les analyses du groupe. Standard du marché (Wrike, Planner Premium). Aujourd’hui les écrans de pilotage sont fixes et seul l’export CSV / XLSX existe. Analyse comparative du 25 oct. 2026 : priorité P2, à valider par le responsable produit ; le connecteur Power BI peut s’appuyer sur les vues pub_ déjà publiées.  
*Avancement : 01/11/2026 (K-203, K-203b) : tableaux de bord configurables lancés ; Power BI par les vues pub_ (demande à Matrix et à la DSI). · Sources : Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-208 · IA prédictive de dérive délai / coût et suggestions de mitigation** — *Prochaine étape · non commencé · effort XL* · **en cours (Livraison 9)**  
Prédire la dérive de délai et de coût d’un projet à partir de l’historique (référence, avancement, valeur acquise, REX) et proposer des mitigations (réaffectation, resserrement, alerte précoce). Fonction avancée du marché (Planview, Planisware). Aujourd’hui l’IA ne sert qu’à l’analyse des transcriptions de réunion (src/server/ai/transcripts/). Analyse comparative du 25 oct. 2026 : priorité P3, à décider ; suppose un historique réel de projets.  
*Avancement : 01/11/2026 (K-208) : première version fondée sur les règles et la valeur acquise ; en construction. · Sources : Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**~~R-129 · Vue d’ensemble : ne compter que les projets en exécution~~** — *Prochaine étape · non commencé · effort S* · **fait (Livraison 7)**  
Appliquer A-3 : la Vue d’ensemble, l’accueil directeur (tuiles et demandes de modification) et Mes projets doivent suivre le registre en direct et retenir les projets dont l’étape appartient au groupe « execution » (Études → Mise en service), et non plus ceux qui ont des données de contrôle (hasData). Les libellés « FY2026 », figés dans l’indice de carte et dans le fil d’Ariane, doivent venir de la date de données. Les tests golden doivent être mis à jour avec un commentaire citant A-3. La règle de santé unique (A-13) est déjà appliquée.  
*Sources : A-3, 03 §4, OQ4, DELIVERY-1.md §6 (l.156), §7 (l.191)*

**~~R-130 · Calculer les alertes « À surveiller » du portefeuille par règles~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 7)**  
Les 4 alertes de la Vue d’ensemble et de l’accueil directeur sont le texte figé du prototype (glissement Harbor Line, 3 personnes > 115 %, SPI 0,84 de RCF-019) et ne suivent pas les données. Il faut les générer par règles avec seuils dans les Paramètres : glissement du chemin critique, dépassement de coût, surcharge, SPI/CPI hors trajectoire, jalon ou facture en retard, approbation en attente depuis plus de N jours.  
*Sources : NEW-D1-1, A-12, A-15, 03 §4.4, DELIVERY-1.md §5*

**~~R-131 · Adapter le rapport d’avancement PDF à chaque public~~** — *Prochaine étape · partiel · effort M* · **fait (Livraison 7)**  
Appliquer C-5. Pilotage : tout, y compris la marge (contrat − EAC) et les risques. Client : avancement, jalons, modifications, livrables et factures, sans coûts internes. Interne : tout, plus les ressources affectées. Aujourd’hui, pilotage et interne produisent exactement le même contenu, sans marge ni ressources. La version client ne liste ni les modifications, ni les livrables, ni les factures : elle ne contient que les décisions en attente, les problèmes ouverts et les totaux du contrat.  
*Sources : C-5, 04 Q9, 03 OQ21, DELIVERY-6.md §4 Exports*

**~~R-132 · Calculer la marge par projet à terminaison~~** — *Prochaine étape · partiel · effort S* · **fait (Livraison 7)**  
La marge du portefeuille utilise déjà (contrat − EAC) / contrat. Les marges par projet de la Priorisation et de la Trésorerie comparent encore le contrat au budget. La fonction existe aussi en double : la version du domaine n’est pas utilisée, celle de la DAL l’est. Il faut une seule fonction basée sur projectEacKeur.  
*Sources : C-10b, A-12, 03 OQ8, DELIVERY-3.md §5, §6*

**~~R-133 · Répartir le reste à dépenser de la trésorerie selon la courbe prévue~~** — *Prochaine étape · partiel · effort S* · **fait (Livraison 7)**  
C-10a demande que les décaissements restants suivent la courbe prévue du planning. Le calcul actuel répartit l’ETC à parts égales jusqu’au mois de fin. Les encaissements suivent déjà le plan de facturation. La courbe PV par période existe (evm_periods) et peut servir de clé de répartition.  
*Sources : C-10a, A-12*

**~~R-134 · Noter les propositions de projet sur les 5 axes du classement~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
« Noter une proposition » doit saisir les 5 axes du classement, dont l’adéquation des ressources et la priorité client, au lieu de 3. Les 2 autres axes reçoivent aujourd’hui 1 par défaut.  
*Avancement : Livraison 8, lot documents et portefeuille : une proposition se note sur les 5 axes du classement (L-5a). · Sources : L-5a, 03 OQ10, DELIVERY-3.md §6*

**~~R-135 · Carte des projets : couleur d’étape, légende « Clos / annulé », clavier~~** — *Plus tard · partiel · effort S* · **fait (Livraison 8)**  
L’infobulle affiche déjà l’étape et la santé (deux étiquettes). Restent trois points. La couleur de l’étiquette d’étape doit suivre l’étape, comme dans le registre, et non la santé. La légende doit devenir « Clos / annulé », le statut « En attente » n’existant plus. Les marqueurs doivent être atteignables au clavier.  
*Avancement : Livraison 8 : couleur d’étape sur l’étiquette, légende « Clos / annulé », marqueurs au clavier (L-7). · Sources : L-7, 02 Q-2, DELIVERY-3.md §6 (l.277), §7 (l.356)*

**~~R-136 · Planning de portefeuille : fenêtre glissante de 24 mois~~** — *Plus tard · non commencé · effort M* · **fait (Livraison 8)**  
Remplacer l’horizon fixe de janvier 2026 à décembre 2027 par une fenêtre de 24 mois centrée sur aujourd’hui, qui avance ou recule par trimestre, avec l’état dans l’URL. Les décalages de mois sont comptés depuis janvier 2026 et « maintenant » est la constante PG_NOW. Cela peut être fait dès maintenant en centrant la fenêtre sur la date de données. La vraie date ne viendra qu’avec l’horloge réelle (R-013), ce qui ne bloque pas ce travail.  
*Avancement : Livraison 8 : planning de portefeuille sur une fenêtre glissante de 24 mois, pas trimestriel (L-8). · Sources : L-8, 05 OQ22, DELIVERY-3.md §7 (l.357)*

### 2.13 Portail client (3 restants, 3 faits)

**R-142 · Préciser l’onglet Planning du portail client et les PDF de planning** — *À décider · attend le responsable produit · effort S*  
À confirmer par le responsable produit : le nom et la place de l’onglet « Planning », et si le client voit le plan d’activités détaillé (il ne voit aujourd’hui que le Gantt des lots). Faut-il aussi un Gantt PDF qui va jusqu’à la fin prévue, au lieu des 13 mois de l’écran ? Et une variante interne du PDF du plan, avec les coûts ?  
*Attend : Réponses du responsable produit (DELIVERY-6 §8 S-9a) · Sources : S-9a, DELIVERY-6.md §8 S-9a, docs/delivery-6/notes-exports.md §1, §7.2, §7.3, §7.5*

**R-139 · Ajouter l’entrée « Voir comme le client » pour le directeur et le CP** — *Plus tard · partiel · effort S* · **en cours (Livraison 8)**  
Appliquer P-11 : ajouter dans le projet une entrée « Voir comme le client » qui ouvre le portail en lecture seule, sans décision possible, et la réserver au directeur et au CP du projet. Aujourd’hui le portail ne s’ouvre que par lien. Tout rôle interne peut l’ouvrir en lecture seule, hors de son espace. Le directeur y garde « Signaler un point ».  
*Avancement : Livraison 8 : « Voir comme le client » pour le directeur et les responsables du projet (P-11 a) ; question ouverte sur « Signaler un problème » du directeur. · Sources : P-11, 01 OQ8, DELIVERY-6.md §4 « internal people preview the client view (P-11) »*

**R-141 · Recueillir l’enquête de satisfaction client par le portail** — *Plus tard · attend le responsable produit · effort M*  
À la clôture, un questionnaire sur les 5 critères est envoyé au client sur son portail et ses notes arrivent dans Keystone. Aujourd’hui l’enquête est en lecture seule avec les notes du prototype.  
*Attend : Ouverture de l’accès client au portail (I-2b : pas d’accès client au lancement) · Sources : Q-9, I-2b, 07 §2.7, DELIVERY-5.md §4*

**~~R-137 · Faire traiter par le CP les points soulevés par le client~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 7)**  
Appliquer L-6 : le CP est prévenu quand un point est soulevé, le prend en charge (Ouvert → En cours → Clos) depuis un espace interne et rédige la réponse ; le client est prévenu de la réponse et de la clôture (notification Keystone, l’e-mail n’envoyant rien, X-6). Aujourd’hui un point peut seulement être créé : il reste « Ouvert » avec l’accusé automatique, le CP n’est pas notifié et ne voit le registre qu’en lecture seule, hors de son espace.  
*Sources : L-6, 03 OQ16-17, 11 §6.4 (« the UI only creates open »), §7 #22, DELIVERY-5.md §7*

**~~R-138 · Portail client : catégories de documents calculées depuis Codex~~** — *Plus tard · non commencé · effort M* · **fait (Livraison 8)**  
Afficher dans l’onglet Documents du portail un regroupement par catégorie (contrat et avenants, rapports mensuels, comptes rendus, rapports HSE, livrables acceptés), avec des nombres de fichiers calculés depuis l’index Codex. Les catégories et nombres saisis à la main (table client_document_categories) seront supprimés. Il faut aussi une correspondance « type de document → catégorie client », et élargir la règle de partage : aujourd’hui, seuls les livrables client diffusés sont partagés.  
*Avancement : Livraison 8 : catégories de documents du portail client calculées depuis l’index Codex (L-9) ; « Contrat & avenants » et « Rapports mensuels » attendent le responsable produit. · Attend : Correspondance types de documents → catégories client et règle de partage à préciser ; contenu réel via l’index Codex (R-033) · Sources : L-9, 03 OQ22, DELIVERY-5.md §3*

**~~R-140 · Afficher la justification des CR dans la fiche et au client~~** — *Plus tard · partiel · effort S* · **fait (Livraison 8)**  
La justification obligatoire, déjà enregistrée, doit s’afficher dans la fiche de la CR et être transmise au client quand la CR lui est soumise ; elle n’apparaît aujourd’hui que dans l’export.  
*Avancement : Livraison 8 : justification visible dans le panneau et sur le portail client. · Sources : X-11, 01 OQ15, 07 OQ17, DELIVERY-2.md §6*

### 2.14 SAV et parc installé (1 restants, 3 faits)

**R-193 · Retour de montée en puissance au parc installé (vue pub_rampup)** — *Plus tard · non commencé · effort S* · **en cours (Livraison 9)**  
Le parc installé affiche la capacité nominale atteinte et le TRS / OEE et les rebuts de réception lus dans la vue pub_rampup de l’application CAPEX (REX machine).  
*Avancement : Livraison 9, lot « share-views » suite (docs/delivery-9/notes-share-views.md § 7–8, migrations 0039_share_maj_le_indexes et 0040_share_installed_base) : K-07 fait — pub_parc_machines + type_machine_code, livree_le, maj_le en fin de vue (colonnes de la machine, une ligne par machine pour la lecture DISTINCT d’Arche ; maj_le = machines.updated_at, déplacée quand une intervention monte une nouvelle révision) ; K-11 fait — index deliverables.updated_at et punch_items.updated_at, seuls utiles (justification § 8). Reste : K-09 — lire arche.pub_rampup au parc installé (capacité atteinte, TRS, rebuts de réception), attend la publication de la vue par Arche (sa livraison 6) ; droit de lecture d’arche_app et copie de la vue dans Matrix (demande à déposer après validation). · Attend : Application CAPEX · Sources : Responsable produit, 22 oct. 2026 (application CAPEX dédiée, DIG-PRODI v4.0), docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md*

**~~R-143 · Suivre les réclamations sous garantie de bout en bout~~** — *Prochaine étape · non commencé · effort M* · **fait (Livraison 7)**  
Donner aux réclamations une fiche détaillée où le SAV fait avancer les statuts (Ouverte → Diagnostiquée → Intervention planifiée → Clôturée), décide de la prise en charge (garantie, extension, facturable) et saisit le diagnostic, la prochaine étape et le coût (aujourd’hui figé à 0). Il crée et clôt aussi les interventions (Planifiée → Réalisée) et rattache un ECO de conception : il en ouvre un dans Vigie via vigieNewEcoUrl prérempli, ou saisit un ECO existant. L’affichage de l’étiquette ECO existe déjà, mais seule la création d’une réclamation est réelle. Aucun persona « responsable SAV » n’existe : il faut rattacher ce pilotage aux rôles qui modifient déjà l’écran (directeur, chef de projet, qualité, achats) ou au responsable de la réclamation.  
*Sources : Q-8, 07 OQ20, 11 §6.4, DELIVERY-5.md §6, §7, §8*

**~~R-144 · Créer les machines et leur configuration telle que construite à la livraison~~** — *Prochaine étape · non commencé · effort L* · **fait (Livraison 7)**  
À la livraison d’un projet, Keystone crée les machines et leur configuration (révision de chaque pièce montée) depuis la nomenclature ; chaque intervention SAV la met ensuite à jour. Aujourd’hui « Ajouter une machine » crée une machine sans projet ni configuration.  
*Sources : E-8, 09 OQ23, 11 §3.7, DELIVERY-4.md §8, DELIVERY-5.md §3*

**~~R-145 · Coût garantie sur l’année civile et alerte sur la fin prolongée~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
« Coût garantie depuis le début de l’année » ne doit compter que les réclamations non facturables de l’année civile en cours, selon reportedOn. L’alerte « fin de garantie < 90 jours » et le statut doivent suivre la garantie réellement en vigueur : la fin prolongée (extendedUntil), et le passage automatique à « Hors garantie » à l’échéance, alors que le statut est aujourd’hui stocké et figé. Mettre à jour les tests golden en citant NEW-D5-2. L’« année en cours » dépend encore du « maintenant » du prototype (NOW_ISO/PG_NOW = 30 sept. 2026).  
*Avancement : Livraison 8 : coût garantie de l’année civile, extension en vigueur (NEW-D5-2). · Sources : NEW-D5-2, Q-8, DELIVERY-5.md §6*

### 2.15 Ergonomie, langues et accessibilité (2 restants, 13 faits)

**R-147 · Ajouter un libellé anglais à chaque terme métier** — *Prochaine étape · non commencé · effort M*  
Étapes du cycle de vie, livrables d’étape, jalons, modèles de projet (descriptions de l’assistant) et données chantier doivent avoir un libellé anglais en mode EN ; ils s’affichent aujourd’hui en français dans les deux langues. Proposer le glossaire et le faire valider.  
*Attend : Validation du glossaire anglais par le responsable produit · Sources : X-12a, 01 §13.4, OQ16-17, 03 OQ18, 02 Q-7, DELIVERY-1.md §7, DELIVERY-6.md §6*

**R-209 · Multilingue au-delà du français et de l’anglais pour les filiales pays** — *Plus tard · non commencé · effort L*  
Ajouter d’autres langues d’interface (espagnol, portugais… selon les filiales) : dictionnaires supplémentaires dans src/i18n, règles de complétude par langue, libellés des termes métier (R-147) et choix de langue par utilisateur (R-018). Standard du marché. Aujourd’hui FR / EN seulement. Analyse comparative du 25 oct. 2026 : besoin transverse, à décider selon les langues des filiales utilisatrices.  
*Avancement : 01/11/2026 (K-209) : plus tard. · Attend : Liste des langues des filiales, validation du responsable produit · Sources : Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**~~R-146 · Rendre Keystone utilisable sur tablette~~** — *Prochaine étape · non commencé · effort L* · **fait (Livraison 7)**  
Menu latéral repliable et mises en page tablette, en commençant par Chantier, Réserves et Livraisons, en ligne. Le shell est figé à 232 px sans point de rupture ; c’est un préalable à toute application chantier hors ligne (P8).  
*Avancement : Livraison 7 : tablette jusqu’à 1024 px (menu en tiroir, tableaux défilants, cibles de 40 px) ; pas de mise en page téléphone (X-4). · Sources : X-4, 01 OQ4, 02 Q-8, BACKLOG.md §2 P8*

**~~R-148 · Afficher les textes saisis tels quels, sans traduction partielle~~** — *Prochaine étape · partiel · effort M* · **fait (Livraison 7)**  
Titres, noms de projets et de clients, lots, clauses du contrat, CR et textes reçus de Vigie et Cursus ne doivent plus passer par les règles de traduction jour / mois (« Sun Valley Farm » devient « dim. Valley Farm »). Un helper partagé unique remplace les copies locales de dataText, avec au plus une correspondance exacte pour les données de démo ; la recherche ne doit plus traduire ses résultats.  
*Sources : NEW-D1-2, X-12b, DELIVERY-1.md §5, DELIVERY-2.md §5, DELIVERY-3.md §5, DELIVERY-4.md §7, DELIVERY-5.md §7*

**~~R-149 · Notifier les personnes mentionnées par @ dans les commentaires de tâche~~** — *Plus tard · non commencé · effort M* · **fait (Livraison 8)**  
Reconnaître les mentions @personne dans les commentaires et notifier la personne citée dans Keystone. Le champ l’annonce déjà sans effet, et les notifications sont aujourd’hui adressées par rôle.  
*Avancement : Livraison 8 : mentions @ dans les commentaires de tâche, avis à la personne mentionnée (R-8b). · Attend : Notifications nominatives (R-015, R-039) · Sources : R-8b, 10 OQ20, DELIVERY-2.md §7*

**~~R-150 · Changer le statut d’une tâche par glisser-déposer dans le Tableau~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
Dans « Mon travail › Tableau », glisser une carte vers une autre colonne change son statut, avec les mêmes règles que le menu de statut et une alternative au clavier.  
*Avancement : Livraison 8 : glisser-déposer sur le Tableau pour changer le statut d’une tâche (R-8c). · Sources : R-8c, 10 OQ21, DELIVERY-2.md §7*

**~~R-151 · Toujours afficher le nom du groupe dans une section de menu repliée~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
Quand une section est repliée, l’en-tête du groupe de l’écran ouvert doit rester visible, même si cet écran n’est pas le premier du groupe.  
*Avancement : Livraison 8 : une section repliée garde l’en-tête de groupe de l’entrée affichée (X-8). · Sources : X-8, 01 OQ21*

**~~R-152 · Afficher les messages de confirmation manquants~~** — *Plus tard · partiel · effort S* · **fait (Livraison 8)**  
Afficher « Demande RQ-xxx envoyée » même quand on est redirigé vers les demandes, et « Validation demandée au directeur de portefeuille » après un changement d’étape forcé ; « Projet créé » est déjà en place.  
*Avancement : Livraison 8 : messages de confirmation manquants ajoutés (X-9, L-1). · Sources : X-9, L-1, 01 OQ22, DELIVERY-6.md §6 Minor points*

**~~R-153 · Retirer le nom du projet des formulaires qui ne visent pas un projet~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
Supprimer le sous-titre « projet courant » des formulaires de listes communes : types de machine, connecteurs, nouvel article, synchro du coffre PDM, ajout de machine et nouvelle réclamation de garantie. Le garder sur « Nouvelle consultation » : la RFQ créée est bien rattachée au projet courant.  
*Avancement : Livraison 8 : plus de nom de projet sur les formulaires qui ne visent pas un projet (X-10). · Sources : X-10, 01 OQ14, 06 OQ14, DELIVERY-4.md §7.1, DELIVERY-5.md §7.1*

**~~R-154 · Harmoniser les couleurs de statut et doubler chaque couleur d’un texte~~** — *Plus tard · non commencé · effort M* · **fait (Livraison 9)**  
Un même statut a la même couleur sur tous les écrans (par exemple CR approuvée en neutre, activité en cours en contour), et aucune information n’est portée par la seule couleur (WCAG AA). Cela demande un audit des points et pastilles sans libellé.  
*Avancement : Mêmes couleurs pour un même statut (X-13b « Harmoniser ») et aucune information portée par la seule couleur (icône d’alerte, textes). · Sources : X-13a, X-13b, 02 Q-1, Q-5, Q-6, 10 OQ9, DELIVERY-5.md §7*

**~~R-155 · Corriger le message de zone vide des listes de machines~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
Parc installé et Garantie doivent afficher « Aucune machine dans cette zone » au lieu du message prévu pour les projets ; ajouter la traduction et mettre à jour les tests.  
*Avancement : Livraison 8 : message de zone vide des listes de machines (X-16). · Sources : X-16, 01 §7.2, 07 A.1, 12 §5, DELIVERY-5.md §6, §7*

**~~R-156 · Traduire l’étape « Handover » par « Transfert »~~** — *Plus tard · partiel · effort S* · **fait (Livraison 8)**  
L’étape « Handover » de l’écran Mise en service s’affiche « Livraison » ; la traduire par « Transfert » et aligner les phrases dérivées encore en « livraison » / « réception » (« Livraison prévue », chemin critique, « j sur la livraison », jalons du portefeuille, alertes). Le « Dossier de transfert » est déjà traduit ainsi.  
*Avancement : Livraison 8 : l’étape Handover se dit « Transfert » en français (NEW-D5-3 'a'). · Sources : NEW-D5-3, DELIVERY-5.md §6, §7, 11*

**~~R-157 · Corriger les finitions d’ergonomie relevées par les revues~~** — *Plus tard · non commencé · effort M* · **fait (Livraison 9)**  
Reprendre les petits défauts listés aux livraisons 1–6 : messages de refus génériques, textes des connecteurs en anglais en mode français, recherche de la nomenclature limitée aux noms anglais, colonnes Début/Fin exportées en texte, IF-02 / IF-05 non cliquables, boutons de statut « outline » au fond gris du navigateur, mention « Modifiable » montrée en lecture seule, focus perdu après « Marquer payée », vues Décisions/Actions vides sans message, et l’analyseur local de transcriptions qui ignore les actions à la 2e personne (« tu vas », « vous allez »).  
*Avancement : Messages de refus précis (Chantier, Qualité), textes des connecteurs en français, recherche de la nomenclature en français sans accents, vraies dates dans les exports, IF-xx cliquables, boutons « outline », lecture seule des pondérations, focus conservé, vues vides des réunions, actions à la 2e personne. · Sources : X-13b, S-10, DELIVERY-1.md §6, DELIVERY-3.md §5, DELIVERY-4.md §6, DELIVERY-5.md §6, DELIVERY-6.md §6 Minor points, docs/delivery-6/notes-exports.md §7.4*

**~~R-183 · Auditer l'accessibilité (WCAG 2.1 AA) et automatiser des contrôles axe~~** — *Plus tard · non commencé · effort M* · **fait (Livraison 9)**  
La spécification vise WCAG 2.1 AA avec des contrôles automatiques (axe) et des parcours au clavier, mais aucun outil n'est en place et seules des corrections ponctuelles ont été faites. Faire un audit complet (contraste accent-300, rôles ARIA des onglets et segments, focus après action, lien d'évitement), corriger, puis ajouter les contrôles axe aux tests de bout en bout.  
*Avancement : Contrôles axe (WCAG 2.1 AA) dans les tests de bout en bout existants (tous les écrans du directeur, écrans principaux des autres profils), lien d’évitement, contrastes corrigés. · Sources : 00 §7.15, 00 §8.14, X-13a, X-7, DELIVERY-5.md §6 (focus non déplacé, initiales d'avatar lues avant le nom)*

**~~R-184 · Contrôler automatiquement la complétude de la traduction française~~** — *Plus tard · non commencé · effort M* · **fait (Livraison 8)**  
L'interface passe par le moteur de traduction du prototype (dictionnaire exact puis règles regex) sans aucun test qui vérifie que chaque libellé affiché a sa traduction ; des textes écrits par le DAL restent en anglais en français. Ajouter un contrôle de complétude dans les tests et stocker les textes système (journal, synchronisations) sous forme de code et paramètres plutôt qu'en phrases anglaises.  
*Avancement : Livraison 8 : garde de complétude du français (src/i18n/completeness.test.ts), une seule traduction par clé, messages système à clé, fil d’activité et journal d’audit dans la langue de l’utilisateur. · Sources : 00 §7.2, 00 §8.7, 00 §8.14 (i18n completeness), 12 §6.3, DELIVERY-5.md §6 (Administration : textes du DAL en anglais)*

### 2.16 Dette technique (4 restants, 3 faits)

**R-168 · Renforcer le journal d’audit (avant / après, motif, utilisateur, immuabilité)** — *Prochaine étape · partiel · effort M* · **en cours (Livraison 8)**  
Enrichir audit_entries avec un avant / après structuré (jsonb), le motif et l’utilisateur authentifié, et rendre la table non modifiable (trigger ou droits SQL), comme le prévoit le modèle de données pour l’export ISO 9001.  
*Avancement : Livraison 8, lot journal d’audit : table en ajout seul (déclencheurs), utilisateur, avant / après, motif, 4 colonnes de plus dans l’export CSV ISO. Reste : remplir avant / après / motif dans les autres écritures (balayage après la livraison) et REVOKE quand l’hébergement est choisi (I-1a). · Attend : Vrais utilisateurs (R-039) · Sources : 11 §3.12 AuditEntry*

**R-171 · Supprimer le code mort, les doublons et les commentaires périmés** — *Plus tard · non commencé · effort S*  
À retirer : addTaskAttachment, INDEX_ALERT, les fonctions de disponibilité de resources.ts (seulement testées, hr.ts a sa copie), transferTargets, getPortfolioCashForecast, listDeliverableTypes et les doublons priorityScore / marginPct. Il faut aussi unifier les deux règles de décision d’une étape de CR (par rôle ou par approbateur nommé) et supprimer client_communications, son DAL et openClientFollowUps si D-5 le confirme. Enfin, mettre à jour les 81 commentaires « OPEN QUESTION », dont la plupart sont tranchés. Les routes catch-all restent (404, redirection /projects/<code>) : seule la branche ComingSoon, gardée volontairement pour un futur écran, est inatteignible.  
*Attend : Confirmation D-5 pour supprimer client_communications (DELIVERY-6 §8) · Sources : DELIVERY-2.md §5, DELIVERY-4.md §5 (l.320), DELIVERY-6-PLAN.md (settings cleanup), DELIVERY-6.md §8 D-5*

**R-172 · Solder les TODO(db) restants (import P&ID, lien CR ↔ activité, nom du responsable)** — *Plus tard · non commencé · effort S* · **en cours (Livraison 8)**  
La table import_jobs existe désormais : faire passer l’import P&ID par une ImportJob (nouveau type « pid ») au lieu de recalculer le staging depuis le fichier soumis, et mettre à jour le commentaire périmé. Modéliser le lien CR ↔ activité pour retirer la note figée A1250 / CR-008 du tiroir du plan. Afficher partout le nom du responsable au lieu de son code (« SP » sur un projet créé par l’assistant), dans l’export du plan comme à l’écran : la DAL fournit déjà ownerName.  
*Avancement : Livraison 8 : noms des responsables sur le Plan ; le lien CR ↔ activité était R-062 ; l’import P&ID reste suspendu tant que les imports sont coupés (D-7b). · Sources : 11 §3.12 ImportJob, DELIVERY-6.md §6 Minor points, D-7b (imports gelés : l’import P&ID du prototype reste actif)*

**R-194 · Socle partagé @epc2i/socle (Keystone et application CAPEX)** — *Plus tard · non commencé · effort L*  
Extraire de Keystone la coquille, le design Nocturne, l’infrastructure i18n, l’authentification Entra, la piste d’audit, le moteur de validations, les tâches planifiées, la configuration, les journaux et la santé, l’exploitation, en un paquet versionné consommé par Keystone et par l’application CAPEX ; aucun changement de comportement dans Keystone. L’application CAPEX démarre avec une copie du socle, remplacée par le paquet.  
*Avancement : Consigné le 22 oct. 2026 (lien avec l’application CAPEX) ; à valider avant de construire. Demandes d’Arche (dépôt Arche, docs/DEMANDES-KEYSTONE.md et CONTRATS.md, 22 oct. 2026) : K-12 — Arche consommera @epc2i/socle à la place de ses copies. · Attend : MVP de l’application CAPEX stabilisé · Sources : Responsable produit, 22 oct. 2026 (application CAPEX dédiée, DIG-PRODI v4.0), docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md*

**~~R-170 · Supprimer les lectures des données du prototype à l’exécution~~** — *Bloquant production · partiel · effort S* · **fait (Livraison 7)**  
Plusieurs écrans lisent encore les constantes PROTO alors que la base contient les données. Le sélecteur de projet de l’en-tête lit le code analytique, le DAS et le type dans PROTO, et reste vide pour tout projet créé par l’assistant. Les zones et leurs responsables (noms fictifs du prototype) aussi, alors que la table zones a manager_person_id. La remise à zéro des Paramètres (listes et emplacements) passe par le module de seed, et l’index DEFS du modèle d’un projet n’est pas stocké. En production, ces lectures affichent des données fictives ou vides : à solder avant la mise en service (A-15 « Données réelles seulement »). Le snapshot PROTO.STOCK0 du mock X3 reste, jusqu’au vrai connecteur X3.  
*Sources : A-15, src/server/prototype/index.ts:4 (règle TODO(db)), DELIVERY-1.md §5, DELIVERY-5.md §6*

**~~R-169 · Retirer les constantes figées du prototype des écrans et écritures~~** — *Prochaine étape · partiel · effort S* · **fait (Livraison 7)**  
Remplacer par des données ou des paramètres : la prime chantier « ×1,5 / ×2 » (à lire dans rate_multipliers, comme l’annonce D-5), la tuile « Règle d’attribution : PM », le sous-titre « Superseded by rev 2 », la référence par défaut CR-BRG-SKF de « Où utilisé », les conditions « Site gate 2 · DAP · Net 30 » écrites sur chaque nouvelle commande et la tuile « Canaux 3 ». Il faut aussi corriger ou confirmer la date du run PDM du seed (26 sept., après la date de situation). Les périodes figées « Sept. 2026 » et l’heure de synchro Lucca des formulaires RH disparaîtront avec le débranchement de Lucca (NEW-CURSUS-4, C-2b) : pas de correctif séparé.  
*Attend : Choix sur la date du run PDM du seed (DELIVERY-6 §8 A-12) · Sources : A-12, D-5 (contexte : majoration lue dans les grilles de taux), 09 OQ22, NEW-CURSUS-4, C-2b, DELIVERY-4.md §6, DELIVERY-5.md §6, DELIVERY-6.md §4 (table A-12), §8 A-12*

**~~R-167 · Corriger isoOfDayOffset pour les décalages négatifs~~** — *Plus tard · non commencé · effort S* · **fait (Livraison 8)**  
isoOfDayOffset calcule une date fausse pour un décalage négatif : −1 jour ouvré donne le dimanche 13 sept. au lieu du vendredi 18. Le même bug a déjà été corrigé dans dayDate (src/lib/format.ts:74). Le bug est aujourd’hui latent, car tous les appelants passent un décalage ≥ 0 (semaines 5/10/15, TODAY = 4, valeur par défaut 5, seed à partir du 21 sept.). Il faut corriger la formule et ajouter un test sur les décalages négatifs avant qu’un appelant n’en passe un. Il faut aussi mettre à jour DELIVERY-2 §5, qui dit à tort que seuls les seeders l’utilisent.  
*Avancement : Livraison 8 : isoOfDayOffset correct pour les décalages négatifs. · Sources : DELIVERY-2.md §5 (l.361, l.399)*

### 2.17 Nouveaux modules demandés ou proposés (à valider) (9 restants, 1 faits)

**R-159 · P1 · Relance fournisseurs et inspections usine (à valider)** — *À décider · non commencé · effort L*  
Proposition : avancement de fabrication par commande, jalons d’inspection et FAT fournisseurs, bons de libération et alertes de délai pour les commandes longues. Existent seulement les commandes (date attendue, activité qui en a besoin, drapeau « en retard » quand l’activité a démarré), les réceptions et annonces de livraison, et des points ITP d’étape FAT non reliés aux commandes ni aux fournisseurs.  
*Attend : Validation de la proposition par le responsable produit · Sources : BACKLOG.md §2 P1, DELIVERY-6.md §9*

**R-160 · P2 · Conformité CE et dossier technique machine (à valider)** — *À décider · non commencé · effort XL*  
Proposition : analyse de risques, exigences essentielles, déclaration UE de conformité, dossier technique et notices, liés aux livrables. Aujourd’hui seuls existent un type de livrable « Certificats (CE, levage…) » et une ligne « Déclaration CE & certificats de conformité » du dossier de transfert, sans aucun outil. À arbitrer vite : le règlement Machines (UE) 2023/1230 s’applique à partir du 20 janv. 2027, dans environ 3 mois.  
*Attend : Validation de la proposition et du périmètre réglementaire par le responsable produit · Sources : BACKLOG.md §2 P2, DELIVERY-6.md §9*

**R-161 · P3 · Réclamations contractuelles et pénalités (à valider)** — *À décider · non commencé · effort L*  
Proposition : registre des réclamations client et fournisseur chiffrées, et pénalités de retard calculées depuis le planning, liées aux CR et au contrat. Aujourd’hui le contrat ne porte qu’un texte « Pénalités de retard ». Analyse comparative du 25 oct. 2026 : les pénalités de retard contractuelles (LD) et les scénarios de récupération sont une fonction différenciante du marché (Deltek) ; la proposition P3 n’est pas validée. Priorité suggérée P3, à décider.  
*Attend : Validation de la proposition par le responsable produit · Sources : BACKLOG.md §2 P3, DELIVERY-6.md §9, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-162 · P4 · Exposition de change par projet et alertes de couverture (à valider)** — *À décider · non commencé · effort M*  
Au-delà de la décision C-9 (devise par contrat et commande, consolidation en euros, R-075), la proposition P4 ajoute les cours de référence, l’exposition de change par projet et des alertes de couverture. Le responsable produit a retenu l’option b de C-9 et non l’option c (module P4 complet) : P4 reste à valider et vient après R-075. Aujourd’hui seul un code devise EUR/USD est stocké sur le projet et une catégorie de risque « Financier / change » existe.  
*Attend : Validation de la proposition par le responsable produit (non retenue dans la réponse C-9) ; R-075 d’abord · Sources : BACKLOG.md §2 P4, C-9, docs/decisions/questions.json C-9 option c*

**R-163 · P5 · Missions et mobilisation internationale (à valider)** — *À décider · partiel · effort L*  
Proposition : ordres de mission, voyages et indemnités journalières, liés à Cursus et au planning chantier. Le module Chantier affiche déjà le plan de rotation (dates de mission, hébergement, voyage) et des lignes de coûts de mission, toutes deux semées sans écriture, les visas et vaccins lus dans Cursus, et envoie une demande de voyage à Cursus ; manquent les ordres de mission, les indemnités journalières et la saisie des rotations. À valider selon ce que Cursus gère déjà.  
*Avancement : Livraison 8 : la saisie des rotations existe désormais dans la fiche chantier (R-118) ; le reste de la proposition attend sa validation. · Attend : Validation par le responsable produit ; partage des rôles avec Cursus · Sources : BACKLOG.md §2 P5, DELIVERY-6.md §9*

**R-164 · P6 · Offres et chiffrage avant-vente (à valider)** — *À décider · non commencé · effort XL*  
Proposition : chiffrage depuis les modèles de type de machine, marge, aide au go / no-go et conversion en BL1 à la signature. Dépend des standards par type de machine (R-053).  
*Attend : Validation de la proposition ; standards par type de machine (A-2, L-3a) · Sources : BACKLOG.md §2 P6, A-2, L-3a, L-5a*

**R-165 · P7 · Outillage et étalonnage (à valider)** — *À décider · non commencé · effort M*  
Proposition : parc d’outillage, affectation aux chantiers, échéances d’étalonnage et certificats (ISO 9001 §7.1.5). Seule existe la liste des équipements d’un chantier (expédié, location locale ou client, avec confirmation), sans parc, sans étalonnage ni certificat.  
*Attend : Validation de la proposition par le responsable produit · Sources : BACKLOG.md §2 P7, DELIVERY-6.md §9*

**R-166 · P8 · Application chantier hors ligne (à valider)** — *À décider · non commencé · effort XL*  
Proposition : version tablette des écrans Chantier, Réserves et Livraisons avec saisie hors ligne et synchronisation (rapports journaliers, photos, réceptions). Suppose d’abord la tablette en ligne (X-4, R-146) et le stockage des photos (X-15, R-126) ; la réponse X-4 a retenu la tablette en ligne, pas l’appli hors ligne. Analyse comparative du 25 oct. 2026 : une application mobile / chantier hors ligne (rapports journaliers, photos, réserves) est un standard du marché (Procore, Smartsheet) ; aujourd’hui les photos passent par /api/photos sur navigateur et la proposition P8 n’est pas validée. Priorité suggérée P2, à valider par le responsable produit.  
*Attend : Validation de la proposition ; X-4 et X-15 réalisés d’abord · Sources : BACKLOG.md §2 P8, X-4, X-15, Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**R-207 · Automatisations sans code (règles si / alors, approbations automatiques)** — *Plus tard · non commencé · effort XL*  
Offrir un éditeur de règles si / alors (déclencheur, condition, action : notifier, changer un statut, créer une tâche, approuver automatiquement sous un seuil) configurable par les administrateurs. Standard du marché (monday, Smartsheet). Aujourd’hui les circuits d’approbation sont codés en dur (src/server/approvals/). Analyse comparative du 25 oct. 2026 : priorité P3, à décider.  
*Avancement : 01/11/2026 (K-207) : plus tard, après la procédure d’achats (R-094). · Attend : Validation du responsable produit · Sources : Analyse comparative avec les solutions du commerce, 25 oct. 2026*

**~~R-158 · Cadrer puis construire le module Expédition & transport~~** — *À décider · non commencé · effort XL* · **fait (9)**  
Module demandé mais à cadrer avec le responsable produit avant construction : plan d’expédition (lots, colis, conteneurs et remplissage), fret (mode, Incoterm, transitaire, ETD/ETA, jalons), coûts imputés au budget, documents versés dans Codex (facture, packing list, EUR.1, CMR, B/L ou LTA, déclaration d’export), synthèse douane par code HS avec alerte double usage, et contrôle nomenclature ↔ packing list bloquant le livrable « Colisage & documents douaniers ». Les données articles (code HS, restriction et famille de contrôle export) existent déjà et ne sont aujourd’hui qu’affichées ; le livrable d’étape n’est qu’une case à cocher.  
*Avancement : 25 oct. 2026 : le responsable produit redemande le module (« il manque un module de gestion des expéditions du matériel vers la filiale ») ; cadrage rédigé (docs/delivery-9/cadrage-r158-expeditions.md) : écran projet Expéditions, chargements et colis, contrôle colisage ↔ nomenclature, douane (codes HS), documents (packing list, proforma) versés dans Codex, réception sur site et réserves, jalons expedition / arrivee_site, vue pub_expeditions pour la filiale ; 8 points à valider. Même jour : choix tranchés (cadrage § 5) — vue projet seulement, transport d’après l’Incoterm du contrat, Keystone génère tous les documents sauf les factures, contrôle colisage bloquant, écart à la réception = réserve, suivi filiale dans Arche, nouveau profil Logistique, transitaires externes sans accès, Incoterms 2020 paramétrables, conteneurs et contenus déclarés par EPC2i ; construction lancée. Lot A fait (docs/delivery-9/notes-r158-shipments.md) : profil Logistique (10ᵉ), 11 Incoterms 2020 paramétrables (Paramètres) avec répartition vendeur / acheteur, Incoterm et lieu sur le contrat, écran projet Expéditions (EXP-nn, étapes d’après l’Incoterm, chargements et contenu déclarés, contrôle colisage ↔ nomenclature, synthèse par code SH), case « Colisage & documents douaniers » bloquée tant que le contrôle n’est pas soldé (migration 0061). Lot B : documents, réception sur site et réserves, jalons, pub_expeditions. 26 oct. 2026 : lot B fait — 8 documents générés sans facture (packing list, par conteneur, bon de livraison, marquage, CMR, instructions d’expédition, demande d’origine / EUR.1, déclaration d’export ; gabarits génériques remplaçables), versés dans Codex (type SHP, outbox de dépôt), réception sur site chargement par chargement (écart → réserve : endommagé A, manquant B), jalons expedition / arrivee_site de pub_jalons_projets nourris par les expéditions, vue pub_expeditions sans valeurs pour Arche, alerte retard de fret avec « Ouvrir un risque » (migrations 0063-0064). Reste : formats standard EPC2i, API de dépôt Codex. Vues pub_expeditions et pub_jalons_projets recopiées et accordées par Matrix (29 oct. 2026). 31 oct. 2026 (L9-X3) : la démonstration contient trois documents d’EXP-01 versés dans Codex (packing list, CMR, bon de livraison : SHP-HLT-040 à 042, dépôts en attente de synchro). · Sources : BACKLOG.md §1, DELIVERY-6.md §9, CLAUDE.md, E-1b, A-1a*

## 3. Mises à jour

- 2026-11-01 — R-195 fait : la vue pub_jalons existe déjà (0038) et Matrix l’accorde à Crucible.
- 2026-11-01 — Cadrage des lots R-195 à R-209 (questionnaire) : lancés R-196, R-201, R-203, R-205, R-206, R-208, puis R-204 ; R-195 et Power BI par Matrix ; plus tard R-197, R-200, R-202, R-207, R-209.
- 2026-10-31 — R-210 : application Windows construite (en attente d’un essai sur PC Windows et de l’hébergement).
- 2026-10-31 — L9-X3 fait : documents d’expédition pré-versés dans Codex dans la démonstration.
- 2026-10-31 — Questionnaire de la livraison 9 : 20 choix par défaut confirmés ; démo avec documents d’expédition versés dans Codex (L9-X3) ; portail des filiales = Arche, accès web gardé et application Windows validée (R-210, nouvel item).
- 2026-10-31 — R-064 fait (S-5 confirmé : 30 jours, 20 entrées, CP et directeur) ; vérifié que Matrix a recopié et accordé pub_pack_ingenierie, pub_expeditions et la nouvelle pub_jalons_projets (29 oct.).
- 2026-10-29 — R-157, R-154 et R-183 faits : finitions d’ergonomie, couleurs de statut harmonisées, accessibilité WCAG 2.1 AA avec contrôles axe.
- 2026-10-29 — R-010 fait : verrouillage optimiste des fiches (« modifiée entre-temps par X »), numérotation et contrôles sûrs en concurrence (migrations 0068-0069).
- 2026-10-29 — R-051 fait : suppléance des validations sur une période ; R-064 : partie technique vérifiée, attend S-5.
- 2026-10-29 — R-015 fait et R-036 avancé : notifications par e-mail (immédiat / résumé quotidien, préférences), avis aux personnes concernées, alertes d’indicateur (migration 0066).
- 2026-10-29 — R-198 et R-199 faits : Gantt interactif ; rappels d’échéances et rapports programmés (migration 0065).
- 2026-10-29 — R-198 et R-199 validés et lancés (Gantt interactif ; rappels d’échéances et rapports programmés).
- 2026-10-26 — Analyse comparative avec les solutions du commerce (25 oct. 2026) : 12 items ajoutés (R-198 à R-209), 18 items existants annotés.
- 2026-10-26 — R-158 fait : lot B des expéditions (documents générés et versés dans Codex, réception sur site et réserves, jalons, pub_expeditions).
- 2026-10-26 — R-017 fait : tenue de la charge avec de vrais volumes (index, points chauds, cache des badges, pagination).
- 2026-10-25 — R-158 lot A : profil Logistique, Incoterms paramétrables, écran projet Expéditions avec contrôle du colisage.
- 2026-10-25 — R-158 : cadrage des expéditions validé (vue projet, Incoterm du contrat, documents générés sauf factures, profil Logistique, Incoterms paramétrables) ; la filiale suit tout depuis Arche.
- 2026-10-25 — R-158 (expéditions vers la filiale) : cadrage proposé, 8 points à valider par le responsable produit.
- 2026-10-25 — R-191 fait : pack ingénierie (liste provisoire 5 familles × 20 %), % de complétude à la Synthèse ingénierie, vue pub_pack_ingenierie pour Arche.
- 2026-10-25 — R-189 : dates de référence BL1 des jalons CAPEX publiées dans pub_jalons_projets (code de jalon CAPEX sur les jalons du planning).
- 2026-10-25 — Catalogue machines : nouvelle catégorie du menu et écran dédié (/catalogue/machines) à la demande du responsable produit ; la section catalogue quitte l’écran Types de machine (60 écrans).
- 2026-10-25 — Demandes de Matrix D21 et D22 faites : vue pub_rex des leçons apprises ; clients filiales reliés au code de filiale de Matrix (miroir de matrix.pub_filiales, filiale_code dans pub_clients).
- 2026-10-24 — R-190 fait : client interne (filiale du groupe), portail fermé aux filiales, publié dans pub_projets.
- 2026-10-24 — R-187 fait : besoins machines des filiales (connecteur Arche, réponses chiffrées, projet créé à la commande, vue pub_reponses_besoins).
- 2026-10-24 — R-188 fait : classe d’estimation des versions de budget (E50 / E30 / E10), fourchette au Budget et écart d’incertitude au portefeuille.
- 2026-10-24 — Ventilation des coûts par équipement (R-185) et catalogue machines publié aux filiales (R-186, vue pub_catalogue_machines, demande K-01 d’Arche).
- 2026-10-23 — R-185 fait : projets à plusieurs équipements fusionnés dans main (PR #29 et #30). Prochaines étapes du cadrage : catalogue machines (R-186), corbeille des besoins d’Arche (R-187), classe d’estimation (R-188).
- 2026-10-23 — R-185 partie 2 : plan ITP par ligne d’équipement ; réserves, mise en service, nomenclature et parc installé rattachés à l’équipement.
- 2026-10-23 — R-185 partie 1 : projets à plusieurs équipements — lignes d’équipement, reprise des projets existants, carte Équipement, assistant à plusieurs lignes avec lots par équipement ; les 5 choix du cadrage validés par le responsable produit.
- 2026-10-23 — AC-4 et AC-5 tranchés par le responsable produit (catalogue machines dans Keystone ; projet à plusieurs équipements) ; cadrage R-185 / R-186 rédigé, 5 choix à valider. Demande déposée chez Matrix (REQUESTS.md, PR Matrix #22) pour recopier les nouvelles vues de partage dans 30-keystone.sql.
- 2026-10-23 — Parc installé et lecture incrémentale pour Arche (R-193, demandes K-07 et K-11) : pub_parc_machines publie en fin de vue le type de machine, la date de livraison et la date de dernière modification (déplacée aussi quand une intervention change la configuration) ; index sur la date de modification des livrables et des réserves, atteints à travers les vues ; copie des vues à rafraîchir dans Matrix.
- 2026-10-22 — Vues de partage pour Crucible et Arche (R-195, R-190, R-189) : pub_jalons, pub_jalons_projets, pub_avancement_projets (côté vente, sans coût ni marge), pub_avenants, pub_reserves ; colonnes ajoutées en fin de pub_projets (capex_code, besoin_ref, saisis sur l’écran Contrat) et de pub_livrables (type, accepte_le, maj_le) ; tâche horaire share-progress pour l’avancement et le SPI ; droits des lecteurs à poser dans Matrix.
- 2026-10-22 — Tâches planifiées envoyées à Cursus (R-180) : chaque nuit et avec « Synchroniser », les affectations nominatives du planning et les tâches Keystone de chaque personne qui a un matricule partent vers Cursus en un instantané, pour que la feuille de temps « Propose depuis Keystone » ; reprise automatique après un échec, tâches refusées comptées, état visible sur la ligne Cursus d’Activité & intégrations.
- 2026-10-22 — Mise à jour de sécurité de Next.js (16.4.0 → 16.4.2, avec eslint-config-next) : la construction signalait une vulnérabilité connue ; typecheck, lint, tests, audit et tests de bout en bout verts.
- 2026-10-22 — Congés de démonstration déplacés hors des affectations (décision du responsable produit, option 1) : mêmes personnes, mêmes jours et types, sur des semaines sans charge ou peu chargées ; la démonstration retrouve 3 personnes au-delà de 110 % (semaines 42–44), une occupation de 84 % et 7 conflits sur le chantier HLT-026 ; une base de démonstration existante est corrigée une fois à l’ouverture (R-084).
- 2026-10-22 — Demandes d’Arche (application CAPEX) rattachées aux lots R-185 à R-194, et demandes de Crucible (moyens d’essais R&D) inscrites (R-195 à R-197) ; les dépôts frères restent des sources d’information, Keystone n’y écrit pas.
- 2026-10-22 — Contrat Cursus : Keystone accepte le format réel des événements de Cursus (adresse /api/cursus/v1/evenements, jeton Bearer, donnees, absence.annulee, accusé), appelle les routes /v1 de Cursus, et la capacité de chacun tient compte de ses absences (R-029, R-031, R-084).
- 2026-10-22 — CI économe en minutes GitHub Actions (quota du compte gratuit épuisé) : rien pour un changement de documentation seule, vérifications rapides seulement après fusion dans main, audit des dépendances quand elles changent et chaque semaine ; budget Actions plafonné à régler par le responsable produit.
- 2026-10-22 — DIG-PRODI : le niveau CAPEX devient une application dédiée (données communes sur le serveur PostgreSQL EPC2I, échanges par vues pub_) ; changements de Keystone consignés (R-186 à R-194, R-185 prérequis) ; prompt de démarrage de l’application CAPEX dans docs/dig-prodi/.
- 2026-10-19 — Correctif de déploiement (Coolify, mono-conteneur PGlite) : le script d’entrée de l’image rend /data à l’utilisateur node quand le volume a été écrit en root par l’image de la PR #1 (« PGlite failed to initialize properly ») ; curl gardé pour le contrôle de santé de Coolify.
- 2026-10-18 — Serveur PostgreSQL commun EPC2I (étape 3, décision M-01) : sur PostgreSQL, tables, vues pub_ et journal des migrations dans le schéma keystone (rôle keystone_app), migrations publiées inchangées (« "public". » remplacé par « "keystone". » à l’application, verrou hashtext('keystone.migrations')), verrou d’écriture des transactions, numéro et code analytique d’un nouveau projet calculés dans la transaction, sauvegarde limitée au schéma keystone ; migrations 0034_share_prerequisites et 0035_share (12 vues pub_ du partage). PGlite inchangé.
- 2026-10-18 — Réponses du 18 oct. : équipes externes exclues de la charge, alerte J-15 sur activité sans affectation, affectations nominatives dans les plannings de démonstration ; anciens risques de prérequis laissés ouverts.
- 2026-10-18 — Livraison 9 : charge calculée depuis les affectations des plannings et par métier, alerte des activités sans ressource (R-084, partie charge) ; alerte J-15 avec risque déjà lié (R-121).
- 2026-10-17 — PR #12 fusionnée : Keystone déclare le schéma de sa base à Matrix (catalogue des bases EPC2i) au démarrage, en arrière-plan ; variables MATRIX_URL et MATRIX_TOKEN.
- 2026-10-17 — PR #11 fusionnée. Réponses du second tour : date réelle par défaut (bêta), répartition par projet depuis les affectations, lettre client retirée, risque ouvrable avant J-15.
- 2026-10-17 — PR #10 fusionnée dans main (horloge réelle, plans de charge glissants, alerte J-15). Réponses du responsable produit appliquées : rappels le matin, CP responsable de risque, vues semaine / 8 semaines, navigation du what-if ; tout est fusionné dans main au fil de l’eau.
- 2026-10-16 — Livraison 9 : R-085 (plans de charge sur 8 semaines glissantes) et R-121 (alerte J-15 et proposition de risque) faits.
- 2026-10-16 — Livraison 9 : lots R-085 (plans de charge sur 8 semaines glissantes, R-7) et R-121 (alerte J-15 sur prérequis client et proposition de risque, D-4) démarrés.
- 2026-10-16 — Livraison 9, lot « horloge » : R-013 fait — Keystone suit la date réelle sur une base de production (la démonstration reste au 25 sept. 2026, réglable par KEYSTONE_CLOCK).
- 2026-10-15 — PR #2 fusionnée dans main par le responsable produit : les livraisons 1 à 8 sont sur main (R-001 fait).
- 2026-10-15 — Nouveau besoin du responsable produit (R-185) : un projet peut fournir plusieurs équipements (par exemple une EMP et plusieurs MEMU) ; l’approche projet devra s’adapter — à cadrer avant la livraison 9.
- 2026-10-15 — PR #2 (main-2a2fep → main) : main, qui contient la PR #1 (Dockerfile Coolify), fusionnée dans la branche ; le kit de la livraison 8 remplace ce Dockerfile.
- 2026-10-15 — Livraison 8 terminée : lot 9 (qualité et chantier) intégré, deux revues croisées (26 constats confirmés, tous corrigés avec un test), vérification complète (4 000 tests, build, db-check, matrice des routes à 9 profils, tests de bout en bout). Bilan dans docs/DELIVERY-8.md.
- 2026-10-15 — Livraison 8 : lots 7 et 8 intégrés et vérifiés (documents et portefeuille, travail et planning) — 11 points faits, 7 restent en cours (Codex, Microsoft 365, annuaire Cursus, rétention de la corbeille, import P&ID). Suite complète : 3 866 tests verts. Le lot 9 (qualité et chantier) est en construction.
- 2026-10-15 — Livraison 8 : lots 5 et 6 intégrés et vérifiés (achats et ingénierie, connecteurs Vigie et Cursus) — 11 points faits, 9 restent en cours (en attente de Vigie, Cursus, Sage X3 ou d’un arbitrage). Suite complète : 3 696 tests verts.
- 2026-10-15 — Livraison 8 : lots 1 à 4 intégrés et vérifiés sur main-2a2fep (journal d’audit et traduction, plateforme d’exploitation, rôles et taux, demandes de modification et coûts) — 17 points faits, 9 restent en cours (parties en attente du responsable produit, de l’hébergement ou de données). Les 5 autres lots sont en construction.
- 2026-10-12 — Livraison 8 lancée : 67 points en cours, en 9 lots (journal d’audit et traduction, plateforme d’exploitation, rôles et taux, demandes de modification et coûts, achats et ingénierie, connecteurs Vigie et Cursus, documents et portefeuille, travail et planning, qualité et chantier) — plan dans docs/DELIVERY-8-PLAN.md. Tri préalable des 103 points restants hors « à décider » : 36 écartés de cette livraison (en attente du responsable produit ou d’un autre système, ou trop transverses pour des lots parallèles).
- 2026-10-11 — Livraison 7 intégrée et vérifiée : 56 points faits (plateforme de production, connexion Entra ID et vrais utilisateurs, droits par équipe projet, maîtrise des coûts, contrat et portefeuille, opérations, qualité et chantier, dette technique et tablette) ; R-010 reste en cours (détection d’édition concurrente d’une même fiche). Détail dans docs/DELIVERY-7.md.
- 2026-10-11 — Livraison 7 lancée : 57 points en cours (plateforme, authentification Entra ID, droits, coûts, contrat et portefeuille, opérations, qualité et chantier, dette technique) — plan dans docs/DELIVERY-7-PLAN.md.
- 2026-10-10 — Inventaire initial : 184 points vérifiés dans le code après la livraison 6.
