# Recette de la bêta — scénarios par rôle

Ces scénarios servent à la recette de la bêta par les utilisateurs pilotes. Ils reprennent les parcours vérifiés par les tests
de bout en bout du dépôt (`tests/e2e/01` à `08`) et les parcours principaux de la spécification (spec 00 § 5.3, § 8.14).

> **Jeu de données.** Tous les scénarios utilisent le **jeu de démonstration** (`KEYSTONE_SEED=demo` : projets HLT-026,
> NDC-031, MSR-012…, profils Marie Lefebvre, Romain Aubert…). Sur la bêta de démonstration, on choisit le profil avec
> « Voir en tant que » en bas de la barre latérale. Les dates sont figées (date d’état 25 septembre 2026). Un scénario modifie
> les données : on peut repartir d’une base neuve (l’exploitant la recrée).
>
> Les scénarios marqués **« à vérifier après intégration »** portent sur des parcours que la livraison 8 modifie.

## Mode d’emploi

- Faire chaque scénario dans l’ordre des étapes ; comparer avec le **résultat attendu**.
- Noter chaque écart dans une **fiche de retour** (modèle en fin de page), une fiche par écart.
- En cas d’erreur affichée, relever l’**identifiant d’incident** de la page d’erreur.

## A. Socle (tous rôles)

| # | Étapes | Résultat attendu |
|---|---|---|
| A1 | Ouvrir une adresse inconnue (`/n-existe-pas`) | Page « Erreur 404 · Page introuvable » en français, dans l’application |
| A2 | Parcourir chaque écran du menu de son rôle | Chaque écran s’affiche sans erreur ; un écran hors du rôle s’ouvre en consultation avec un bandeau |
| A3 | Administration › Activité et intégrations (directeur) | Vigie, Cursus, Codex « Simulé » ; Sage X3, PDM, Outlook, Teams, messagerie « Non connecté » ; pas de bouton « Synchroniser » sur un connecteur non connecté |
| A4 | Tablette (fenêtre de 900 px de large), Chantier de HLT-026 | Le menu est un tiroir derrière le bouton « Menu » ; Échap le ferme ; naviguer depuis le tiroir le ferme |
| A5 | Basculer FR / EN dans l’en-tête | Toute l’interface change de langue ; les textes saisis (noms, titres) restent tels quels |

## B. Directeur de portefeuille (Marie Lefebvre)

| # | Étapes | Résultat attendu |
|---|---|---|
| B1 | Projets › « Nouveau projet » : nom, client, date ; sans ville ni pays du site | « Suivant » reste grisé |
| B2 | Renseigner ville et pays, « Suivant » jusqu’au bout, « Créer le projet » | Le projet est créé et s’ouvre sur son Plan, avec les activités du modèle |
| B3 | Paramètres › « À risque sous » = 1, puis Projets | MSR-012 passe « À risque » (écran et export CSV) ; remettre 0,97 : « À l’heure » |
| B4 | Projets : forcer le changement d’étape de WSA-044 puis de RCF-019 (motif saisi) | Les deux projets changent d’étape ; deux demandes arrivent dans Mes approbations |
| B5 | Mes approbations : approuver WSA-044, refuser RCF-019 avec un commentaire | WSA-044 garde sa nouvelle étape ; RCF-019 revient à l’étape précédente |
| B6 | Exports : CSV et Excel du Budget, des Risques, du Plan… ; PDF du rapport d’état ; XML MS Project de HLT-026 | Chaque fichier se télécharge et s’ouvre |
| B7 | Après le scénario C5 : Mes approbations › approuver le prélèvement | « Prélèvement validé » ; il disparaît des approbations et compte dans le consommé |

## C. Chef de projet (Romain Aubert, projet HLT-026)

| # | Étapes | Résultat attendu |
|---|---|---|
| C1 | Plan › « Replanifier », deux fois | 1ʳᵉ fois : « … 11 activités modifiées » ; 2ᵉ fois : « aucun changement » |
| C2 | Plan › activité A1010 › « Ajouter un lien » avec A1620 comme prédécesseur | Refusé : « … créerait une boucle logique … » |
| C3 | Ajouter A1330 comme prédécesseur de A1520 (décalage 5) puis le retirer | « Lien ajouté · A1330 FS+5 → A1520 », puis « Lien supprimé » |
| C4 | Supprimer le lot 1.7, puis « Annuler » ; supprimer A1520, puis « Supprimés récemment » › « Restaurer » | Le plan revient exactement à l’identique (export CSV du plan identique) |
| C5 | Provision pour aléas › « Prélèvement » : 12 k€, motif, lié à une CR › « Enregistrer le prélèvement » | « En attente de la validation du directeur » (suite : B7) |
| C6 | *À vérifier après intégration (R-069).* Plan › « Fixer la référence » | Ouvre « Nouvelle référence · demande de modification » ; « Soumettre en revue » donne une CR « BL3 proposée » |
| C7 | *À vérifier après intégration (R-069).* Approuver la CR comme chef de projet, client, directeur, puis CCB (directeur) | La CR est approuvée ; BL3 devient la référence courante (21 activités), BL1 est remplacée |
| C8 | Ressources › Lissage what-if de HLT-026 › « Retenir le scénario → créer les demandes », deux fois | 1ʳᵉ fois : des demandes brouillon RQ-… ; 2ᵉ fois : « ses demandes existent déjà » ; le plan est inchangé |
| C9 | Demandes de ressources : « Envoyer » le premier brouillon, « Supprimer » le second | « Brouillon envoyé au service » ; le second disparaît |
| C10 | Réunions & CR › MTG-118 (en français) › « Importer une transcription » (texte collé), « Analyser la transcription » | « Transcription importée … 3 intervenants » ; analyse par **règles locales** (sans clé Claude) avec décisions, actions, risque |
| C11 | « Ajouter au CR » | La décision et les actions sont marquées « Ajouté au CR » |
| C12 | Nomenclature projet › Pièces de rechange › « Créer la commande de pièces » › « Créer les commandes brouillon » | Une commande PO-… brouillon, ouverte sur Commandes d’achat |
| C13 | Essayer de joindre un fichier à la tâche T-2314 (dont il n’est pas l’assigné) | Refusé (403) |

## D. Membre d’équipe (Julien Wagner)

| # | Étapes | Résultat attendu |
|---|---|---|
| D1 | Mes tâches › une de ses tâches (T-2305) › « Joindre » un PDF | Fichier joint, listé, téléchargeable à l’identique |
| D2 | Joindre un fichier `.exe` | Refusé : « Type de fichier non accepté » |
| D3 | Plan de HLT-026 : saisir le % d’avancement d’une activité dont il est propriétaire ; essayer de modifier une durée | L’avancement est enregistré ; la durée n’est pas modifiable |
| D4 | Réunions & CR : ajouter une note, cocher une action | Enregistré ; « Envoyer le CR » n’est pas proposé |

## E. Chef de service (Marion Kerviel)

| # | Étapes | Résultat attendu |
|---|---|---|
| E1 | Après C9 : Approbations du service Ingénierie | La demande envoyée y figure ; « Approuver » crée une tâche pour la personne |
| E2 | Ouvrir la page d’Approbations d’un autre service | Renvoyée vers celle de son service |

## F. Responsable qualité (Gabriel Comte)

| # | Étapes | Résultat attendu |
|---|---|---|
| F1 | Inspections & réserves de HLT-026 › « Enregistrer le résultat » d’un point (représentant client si point d’arrêt, commentaire) | « Résultat d’inspection enregistré » |
| F2 | Ajouter une photo (PNG) à la réserve P-02 de l’ITP | Photo enregistrée et affichée |
| F3 | Voir en tant que client : la même réserve | Le client voit la photo mais ne peut pas en ajouter (refus) |
| F4 | *À vérifier après intégration (R-117).* Réserves ITP et chantier | Une seule liste de réserves par projet |

## G. Achats (Fabien Bertrand)

| # | Étapes | Résultat attendu |
|---|---|---|
| G1 | Commandes d’achat de HLT-026 | Les prix sont visibles (ils sont masqués `•••` pour la qualité ou l’ingénierie) |
| G2 | Consultations › une consultation reçue › « Attribuer » | Une commande brouillon est créée pour le fournisseur retenu |
| G3 | Livraisons › « Annoncer une livraison », réception, contrôle qualité | Les quantités acceptées entrent en stock |
| G4 | *À vérifier après intégration (R-095).* Annuler une commande brouillon avec un motif | Commande annulée, motif dans l’audit |

## H. Client (portail — pas d’accès client à l’ouverture, I-2b ; à tester en « Voir en tant que » client)

| # | Étapes | Résultat attendu |
|---|---|---|
| H1 | Ouvrir `/projects/HLT-026/budget` | Renvoyé à l’accueil (hors de son périmètre) |
| H2 | Ouvrir `/projects/NDC-031/client` (autre organisation) | Renvoyé à l’accueil |
| H3 | Ouvrir `/projects/HLT-026/client` | Le portail de son projet s’ouvre |
| H4 | Exports : budget de HLT-026 ; rapport d’état PDF | Budget refusé ; rapport d’état autorisé |

## I. Plateforme (exploitant)

| # | Étapes | Résultat attendu |
|---|---|---|
| I1 | `GET /api/health` | 200 `{"status":"ok"…}` |
| I2 | 61 exports en une minute par le même profil | Le 61ᵉ est refusé (429, « Trop de requêtes… ») |
| I3 | `npm run backup` puis `npm run restore -- <instantané> --target <nouveau dossier>` (EXPLOITATION § 13) | « Restore checked » ; durée affichée |
| I4 | Antivirus actif : joindre le fichier de test EICAR à une tâche | Refusé (422, message générique) ; copie en quarantaine ; entrée d’audit « Files » |

## Fiche de retour (modèle)

```
Testeur / rôle :
Date, heure :
Scénario (n°) et étape :
Écran (adresse) :
Ce que j'ai fait :
Résultat attendu :
Résultat obtenu :
Identifiant d'incident (si page d'erreur) :
Gravité : bloquant / gênant / cosmétique / suggestion
Capture jointe : oui / non
```

Envoi des fiches : `[canal de support à fournir par le responsable produit]`.
