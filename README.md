# Keystone PM

Outil de gestion de projets et de portefeuille du système EPC2i (avec Codex, Cursus et Vigie). C'est la
reconstruction en Next.js 16 du prototype Claude Design `design/Keystone PM v8.dc.html`.

- Conventions : `docs/ARCHITECTURE.md`
- Spécification fonctionnelle : `docs/spec/`
- État des livraisons : `docs/DELIVERY-1.md`, `docs/DELIVERY-2.md`, `docs/DELIVERY-3.md`, `docs/DELIVERY-4.md`, `docs/DELIVERY-5.md`
  (état courant : les 59 écrans du prototype sont construits)
- Évolutions demandées et proposées : `docs/BACKLOG.md`

## Développement

```bash
npm install
npm run dev          # http://localhost:3000
```

- **Base locale :** au premier accès, une base PGlite est créée dans `./.data`, puis remplie avec les données du
  prototype.
- **Repartir de zéro :** serveur arrêté, `npm run db:reset`.
- **Contrôles :** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- **Rôle et langue :** le sélecteur « Voir en tant que » en bas de la barre latérale remplace l'authentification.
  La bascule FR/EN est dans l'en-tête ; le français est la langue par défaut.

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
