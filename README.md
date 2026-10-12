# Keystone PM

Outil de gestion de projets et de portefeuille du système EPC2i (avec Codex, Cursus et Vigie). C'est la
reconstruction en Next.js 16 du prototype Claude Design `design/Keystone PM v8.dc.html`.

- Conventions : `docs/ARCHITECTURE.md`
- Spécification fonctionnelle : `docs/spec/`
- État des livraisons : `docs/DELIVERY-1.md`, `docs/DELIVERY-2.md`, `docs/DELIVERY-3.md`, `docs/DELIVERY-4.md`, `docs/DELIVERY-5.md`,
  `docs/DELIVERY-6.md` (chapitre 4 : les fonctions simulées des 59 écrans sont devenues réelles ; plan d'origine dans
  `docs/DELIVERY-6-PLAN.md`), `docs/DELIVERY-7.md` (mise en production : PostgreSQL, connexion Microsoft Entra ID, droits par
  équipe projet, réponses du responsable produit ; plan dans `docs/DELIVERY-7-PLAN.md`)
- Reste à développer (inventaire du 10 octobre 2026, tenu à jour à chaque développement) : `docs/RESTE-A-DEVELOPPER.md`
- Décisions du responsable produit (questionnaire) : `docs/DECISIONS.md`
- Consignes pour les sessions Claude : `CLAUDE.md`
- Évolutions demandées et proposées : `docs/BACKLOG.md`
- **Guide utilisateur par rôle (bêta)** : [`docs/guide/`](docs/guide/README.md) — directeur, chef de projet, chef de service,
  membre d’équipe, responsable ingénierie, qualité, achats, Finance (à venir), et les
  [scénarios de recette de la bêta](docs/guide/recette-beta.md)
- **Exploitation (DSI)** : [`docs/EXPLOITATION.md`](docs/EXPLOITATION.md) — installation, variables, Entra ID, tâches,
  supervision, Coolify, sauvegardes et restauration, antivirus ; sécurité : [`docs/SECURITY.md`](docs/SECURITY.md)

## Développement

```bash
npm install
npm run dev          # http://localhost:3000
```

- **Base locale :** au premier accès, une base PGlite est créée dans `./.data`, puis remplie avec les données du
  prototype.
- **Repartir de zéro :** serveur arrêté, `npm run db:reset`.
- **Contrôles :** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e` (Playwright sur un build de
  production).
- **Rôle et langue :** en mode démonstration (`KEYSTONE_AUTH=demo`, par défaut), le sélecteur « Voir en tant que » en bas de la
  barre latérale remplace l'authentification. En production, `KEYSTONE_AUTH=entra` impose la connexion Microsoft Entra ID.
- **Configuration de production :** toutes les variables sont décrites dans `.env.example` (base PostgreSQL et
  `npm run db:migrate`, jeu de données `KEYSTONE_SEED`, connexion Entra ID, tâches planifiées `npm run worker`, connecteurs).
  La bascule FR/EN est dans l'en-tête ; le français est la langue par défaut.
- **Analyse des comptes rendus par Claude (optionnelle) :** l'analyse d'une transcription de réunion par Claude n'est active que si
  `ANTHROPIC_API_KEY` est définie côté serveur. La transcription est alors envoyée à Anthropic, et l'écran l'indique (« Analyse par
  Claude (Anthropic) »). Sans cette clé, un analyseur local à base de règles est utilisé et rien ne sort de Keystone.
  `KEYSTONE_AI_MODEL` permet de changer de modèle.

## Configuration et mise en production

Toutes les variables d'environnement sont décrites dans `.env.example` et vérifiées au démarrage
(`src/server/config`). En production (`NODE_ENV=production`), une valeur invalide ou manquante arrête le serveur avec
une ligne de journal qui nomme la variable.

- **Base PostgreSQL :** définir `DATABASE_URL`. Les migrations et le premier remplissage se font au déploiement avec
  `npm run db:migrate`, avant de démarrer la nouvelle version. Le serveur refuse une base en retard de migration.
  Sans `DATABASE_URL`, la base PGlite locale est utilisée comme aujourd'hui.
- **Données d'une nouvelle base :** `KEYSTONE_SEED=demo` (par défaut) charge le jeu du prototype.
  `KEYSTONE_SEED=production` ne charge que les référentiels (étapes, calendriers, listes des Paramètres, types de
  documents et de machine, départements et zones), sans projet ni personne. Une base existante garde son jeu de données.
- **Journaux :** une ligne JSON par événement en production (`LOG_LEVEL`, `LOG_FORMAT`), sans secret.
- **Supervision :** `GET /api/health` répond 200 quand la base répond et que son schéma est à jour, 503 sinon.
- **Sauvegardes :** désactivées sans `KEYSTONE_BACKUP_DIR` ; un instantané toutes les 10 minutes (base, puis fichiers) par la
  tâche `backup` ; `npm run backup` et `npm run restore -- <instantané> --target <cible vide>`
  ([`docs/EXPLOITATION.md`](docs/EXPLOITATION.md) § 13).
- **Antivirus des fichiers déposés :** `KEYSTONE_FILE_SCAN=clamav` avec un service clamd (obligatoire à choisir — `clamav` ou
  `off` — avec `KEYSTONE_SEED=production`).

## Mise en ligne (Docker, Coolify)

Le `Dockerfile` construit **une seule image** pour le serveur web, la migration, le worker et les sauvegardes ;
`deploy/compose.yaml` décrit la ressource **Docker Compose** de Coolify (PostgreSQL 16, migration à chaque déploiement, serveur
web, worker). Détails, réglages Coolify et procédure de mise à jour : [`docs/EXPLOITATION.md`](docs/EXPLOITATION.md) § 2 et § 12.

- **Port interne :** `3000`. **Données :** volume sur `/data`. **Santé :** `GET /api/health`.
- **Variables à la construction :** seulement `NEXT_PUBLIC_CODEX_URL`, `NEXT_PUBLIC_CURSUS_URL`, `NEXT_PUBLIC_VIGIE_URL`
  (adresses publiques figées dans l’application : redéployer après un changement). Toutes les autres sont des variables
  d’exécution (`.env.example`).
- **Bêta de démonstration :** `KEYSTONE_SEED=demo` et `KEYSTONE_AUTH=demo`, **uniquement derrière l’authentification HTTP de
  Coolify** — le mode démo permet de « voir en tant que » n’importe quel profil, directeur compris.
- **Production :** en attente — une base `KEYSTONE_SEED=production` n’a encore aucune personne pour se connecter
  ([`docs/EXPLOITATION.md`](docs/EXPLOITATION.md) § 7) ; hébergement, copie hors site des sauvegardes et stockage des fichiers
  attendent la décision I-1a.
- **Variante mono-conteneur :** sans `DATABASE_URL` (PGlite dans `/data/pg`) et avec `KEYSTONE_JOBS=inprocess`.

## Application Mac

```bash
npm run app
```

Construit `Keystone.app` (fenêtre native macOS, sans Electron, sur le modèle de Codex), l'installe dans
`~/Applications` et dépose un alias « Keystone » sur le bureau.

- **Au lancement :** si un serveur Keystone répond déjà sur le port 3000 (par exemple `npm run dev`), l'app
  l'utilise tel quel et ne l'arrête jamais.
- **Sinon :** elle lance le serveur de production de ce projet sur `http://127.0.0.1:3000`. Il est recompilé
  automatiquement si le code a changé depuis la dernière build. Elle l'arrête quand on quitte l'app, y compris si
  l'app plante.
- **Port 3000 :** c'est l'adresse que les autres apps utilisent pour Keystone (Codex : `NEXT_PUBLIC_KEYSTONE_URL`).
- **Données :** elles sont séparées de celles du développement, dans `~/Library/Application Support/Keystone`
  (`KEYSTONE_DATA_DIR`).
- **Journal :** `~/Library/Logs/Keystone/server.log`, accessible par le menu Présentation › Afficher le journal du
  serveur.
- **Liens et téléchargements :** les liens vers Codex, Vigie, Cursus ou le web s'ouvrent dans le navigateur. Les
  téléchargements vont dans `~/Téléchargements`.

L'app pointe vers ce dossier de projet et vers le Node.js présents au moment de la construction : relancez
`npm run app` après un déplacement du projet ou un changement de Node.

Pour repartir d'une base de démo neuve : quittez l'app, puis supprimez `~/Library/Application Support/Keystone/data`.
