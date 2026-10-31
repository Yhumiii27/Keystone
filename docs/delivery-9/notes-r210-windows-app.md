# Livraison 9 — application Windows `Keystone.exe` (R-210)

Statut : construit sur la branche `r210-windows` le 31 oct. 2026, d’après la réponse du responsable produit au questionnaire
de la livraison 9 (**L9-X2**, précisée le 31/10/2026) : l’accès web reste la voie pour atteindre Keystone de partout ; une
application Windows, installée par ceux qui le souhaitent, coexiste avec lui. **Compilée et publiée ici, sous Linux**
(`dotnet build` et `dotnet publish -r win-x64` : `Keystone.exe` PE32+ GUI de 49,9 Mo, icône et version incluses) ; tests des
règles verts (29). **Pas encore lancée sur un PC Windows** : vérifications manuelles au § 6.

## 1. Ce qui est construit

| Pièce | Où | Rôle |
|---|---|---|
| Projet de l’application | `desktop/windows/Keystone/Keystone.csproj` | C# .NET 10, Windows Forms, `Microsoft.Web.WebView2` 1.0.4191.47 ; publication `win-x64` en un seul fichier autonome |
| Démarrage | `Program.cs` | contrôle du runtime WebView2 (sinon message et lien Microsoft), lecture des réglages, première adresse demandée |
| Fenêtre | `MainForm.cs` | WebView2, page « Keystone est injoignable », menu de la fenêtre, raccourcis, taille et position retenues |
| Comportement commun | `WebViewSetup.cs` | navigations gardées dans la fenêtre ou confiées à Windows, téléchargements par « Enregistrer sous », fenêtres secondaires |
| Règles pures | `NavigationRules.cs` | adresse du serveur acceptée et normalisée, classement d’un lien, lecture et écriture de `keystone.json` |
| Réglages | `AppSettings.cs` | `keystone.json` (à côté de l’exe, sinon `%APPDATA%\Keystone`), `window.json`, profil `%LOCALAPPDATA%\Keystone\WebView2` |
| Dialogue | `ServerDialog.cs` | « Adresse du serveur Keystone » (premier lancement, Ctrl+Maj+L) |
| Page hors ligne | `StatusPages.cs` | même présentation que les pages d’état de l’app Mac ; « Réessayer », « Changer l’adresse du serveur » |
| Windows | `Native.cs` | barre de titre sombre, entrées du menu système, dossier Téléchargements, ouverture par le programme par défaut |
| Icône | `Keystone/Keystone.ico`, `desktop/windows/make-icon.mjs` | dessin de l’icône Mac (`desktop/make-icon.swift`) en 9 tailles (16 à 256 px) ; script Node sans dépendance |
| Tests | `desktop/windows/Keystone.Tests/` | xUnit, 29 cas, tournent sur tout système (`dotnet test desktop/windows/Keystone.Tests`) |
| Construction | `desktop/windows/build.ps1` | tests puis `dotnet publish` (version de `package.json`) vers `desktop/windows/dist/` |
| Workflow | `.github/workflows/windows-app.yml` | `workflow_dispatch` **seulement**, `windows-latest`, artefact `Keystone-windows-x64` (exe + `keystone.example.json`) |
| Exemple DSI | `desktop/windows/keystone.example.json` | `{"serverUrl": "https://keystone.exemple.fr"}` |
| Documentation | `docs/guide/application-windows.md` (nouveau), `docs/guide/README.md`, `docs/EXPLOITATION.md` § 2.3 | choisir web ou application, installer, adresse, raccourcis ; fabrication et pré-déploiement |

Rien n’est ajouté au `package.json` de Keystone ; `ci.yml` et `CLAUDE.md` ne changent pas.

## 2. Pile choisie et pourquoi

- **C# Windows Forms + WebView2**, comme recommandé : quelques centaines de lignes, un exe autonome, le moteur Edge déjà sur
  les postes (Evergreen, mis à jour par Windows Update). Electron ou Tauri embarqueraient un second moteur ou une chaîne Rust
  pour une simple fenêtre. Windows Forms plutôt que WPF : aucune interface native à dessiner (un dialogue), démarrage plus léger.
- **.NET 10 au lieu de .NET 8 (décision prise sans demander)** : le support de .NET 8 s’arrête le **10 novembre 2026**, dans dix
  jours ; .NET 10 est la version LTS suivante (support jusqu’en novembre 2028). L’exe étant autonome, le poste n’a pas besoin
  de .NET. Revenir à .NET 8 = changer `TargetFramework` dans les deux `.csproj` et `dotnet-version` du workflow.
- **Un seul fichier autonome** (`PublishSingleFile`, `SelfContained`, compression) : 49,9 Mo ; rien à installer d’autre que le
  runtime WebView2.

## 3. Comportement

- **Adresse du serveur**, dans l’ordre : `keystone.json` à côté de `Keystone.exe` (posé par la DSI : l’adresse est alors
  **fixe**, le menu l’affiche sans la changer), sinon `%APPDATA%\Keystone\keystone.json`, sinon le dialogue du premier
  lancement (« Quitter » ferme l’application), enregistré dans `%APPDATA%\Keystone\keystone.json`. Contrôles : `https://`
  seulement (`http://` pour `localhost`, `127.0.0.1`, `[::1]`), pas d’identifiants dans l’adresse ; le schéma manquant devient
  `https://`, requête et fragment sont retirés. Un fichier illisible est signalé une fois, puis ignoré.
- **Connexion Microsoft (R-038)** : les pages de connexion restent dans la fenêtre (`login.microsoftonline.com`,
  `login.microsoft.com`, `login.windows.net`, `login.live.com`, `device.login.microsoftonline.com`,
  `autologon.microsoftazuread-sso.com`, et les pages d’enregistrement MFA `mysignins.microsoft.com`,
  `account.activedirectory.windowsazure.com`), en HTTPS seulement ; `signInHosts` de `keystone.json` en ajoute (serveur AD FS,
  `*.domaine` admis). Authentification unique Windows activée (`AllowSingleSignOnUsingOSPrimaryAccount`) : un PC ouvert avec un
  compte EPC2i peut sauter le mot de passe.
- **Liens** : même origine que le serveur (schéma, hôte, port) = dans la fenêtre ; autres sites, `mailto:`, `tel:` = programme
  par défaut de Windows ; `file:`, `edge:` et protocoles inconnus = refusés. Une page Keystone ouverte « dans un nouvel onglet »
  (`target=_blank` : photo, fichier affiché) s’ouvre dans une **seconde fenêtre Keystone** avec la même session, plutôt que dans
  le navigateur où l’utilisateur n’est pas forcément connecté (décision prise sans demander ; l’app Mac, elle, ouvre tout dans
  le navigateur).
- **Téléchargements** (exports `fetch` + `blob:` et pièces jointes `Content-Disposition: attachment`) : « Enregistrer le
  fichier » de Windows, ouvert sur le dossier **Téléchargements** (lu par `SHGetKnownFolderPath`, même s’il a été déplacé), nom
  proposé par le serveur ; le volet de téléchargement d’Edge reste affiché (progression, « Ouvrir le fichier »).
- **Hors ligne** : échec réseau, DNS, délai, connexion coupée, certificat invalide, réponse 502 / 503 / 504 → page « Keystone
  est injoignable » avec la cause en français, **Réessayer** (rouvre la page qui a échoué), **Changer l’adresse du serveur**
  (absent si l’adresse est fixée), nouvel essai automatique au retour du réseau (`online`). Les autres erreurs HTTP (404…)
  restent les pages de Keystone. La page ne parle à l’application que par `postMessage`, accepté seulement quand c’est elle qui
  est affichée (`about:` / `data:`).
- **Runtime WebView2 absent** : message en français, lien `https://developer.microsoft.com/microsoft-edge/webview2/` (programme
  d’amorçage « Evergreen »), proposition de l’ouvrir, rappel que Keystone reste accessible dans le navigateur.
- **Session** : profil dans `%LOCALAPPDATA%\Keystone\WebView2` (cookies conservés d’un lancement à l’autre et après une mise à
  jour de l’exe).
- **Fenêtre** : titre « Keystone », icône, barre de titre sombre, fond `#161826` avant la première page (pas d’éclair blanc),
  taille et position (et état agrandi) retenues dans `%APPDATA%\Keystone\window.json`, replacée sur l’écran principal si
  l’écran d’origine a disparu ; taille minimale 900 × 600.
- **Menu de la fenêtre** (clic droit sur la barre de titre ou Alt+Espace) et raccourcis : Recharger (F5), Accueil de Keystone
  (Alt+Origine), Ouvrir cette page dans le navigateur (Ctrl+Maj+O), Changer l’adresse du serveur… (Ctrl+Maj+L), À propos de
  Keystone (version, serveur, version de WebView2, dossier du profil). Les raccourcis du navigateur restent (Alt+←, Ctrl+P,
  Ctrl+F, zoom). Le contrôle WebView2 Windows Forms remonte les touches d’accélération par son événement `KeyDown` (vérifié dans
  l’assembly), d’où `OnWebKeyDown`.
- **Sécurité** : outils de développement désactivés, objets hôtes interdits, enregistrement des mots de passe désactivé ;
  aucune donnée Keystone sur le poste hors du cache du navigateur intégré.

## 4. Décisions prises sans demander

1. **.NET 10** plutôt que .NET 8 (fin de support le 10 nov. 2026, § 2).
2. `keystone.json` **à côté de l’exe prime** sur celui de `%APPDATA%` et **verrouille** l’adresse (fichier de la DSI) ; celui de
  `%APPDATA%` est le choix de l’utilisateur.
3. Pages Keystone en nouvel onglet → **seconde fenêtre Keystone** (§ 3).
4. Volet de téléchargement d’Edge **conservé** après le choix de l’emplacement.
5. Pas de barre de menus (place gardée pour Keystone) : commandes dans le menu de la fenêtre et raccourcis.
6. Outils de développement **désactivés** (un support se fait dans le navigateur, qui montre les mêmes pages).
7. Pas d’instance unique : deux lancements ouvrent deux fenêtres sur le même profil (WebView2 le permet).
8. Messages de `build.ps1` en anglais ASCII : Windows PowerShell 5.1 lit un script UTF-8 sans BOM en ANSI et prendrait les
  apostrophes typographiques pour des guillemets.
9. Le workflow lance aussi les tests ; les minutes Windows comptent double : environ 3 à 5 minutes de runner par lancement.

## 5. Écarts, limites

- **Exe non signé** : SmartScreen avertira au premier lancement tant qu’il n’est pas signé avec un certificat de signature de
  code d’EPC2i (procédure dans `EXPLOITATION.md` § 2.3 ; aucun certificat dans le dépôt).
- **Pas d’installateur** (MSI / MSIX) ni de mise à jour automatique : un seul exe à copier ; la DSI peut le déployer (Intune,
  GPO) avec `keystone.json`. À cadrer si le besoin apparaît.
- **x64 seulement** (pas d’ARM64) : ajouter `-r win-arm64` si des PC ARM sont concernés.
- **Authentification HTTP de l’hébergeur** (bêta de démonstration derrière une identification du serveur) : WebView2 affiche
  normalement sa propre fenêtre d’identification ; à vérifier (§ 6).
- L’application Mac (R-019) n’est **pas** modifiée ici : elle lance toujours son serveur local ; elle sera alignée sur ce modèle
  (client léger du serveur hébergé) dans R-019.

## 6. Vérifications manuelles sur un PC Windows

À faire une fois, sur Windows 11 et sur un Windows 10 à jour, avec un serveur Keystone (local `http://localhost:3000` en
`KEYSTONE_AUTH=entra` avec un tenant de test, ou la bêta) :

1. Premier lancement sans `keystone.json` : dialogue en français ; `http://exemple.fr` refusé avec le message, `exemple.fr`
   accepté en `https://exemple.fr/` ; « Quitter » ferme l’application ; fichier écrit dans `%APPDATA%\Keystone\keystone.json`.
2. `keystone.json` à côté de l’exe : ouverture directe ; Ctrl+Maj+L affiche l’adresse sans la modifier ; fichier invalide →
   message puis repli.
3. Connexion Microsoft : la page `login.microsoftonline.com` s’ouvre dans la fenêtre ; MFA ; retour sur Keystone connecté ;
   fermer puis rouvrir : toujours connecté ; déconnexion Keystone puis reconnexion.
4. Liens : Codex / Vigie / Cursus et un `mailto:` s’ouvrent dans le navigateur et la messagerie ; une photo ouverte en nouvel
   onglet ouvre une seconde fenêtre connectée.
5. Exports CSV, Excel et PDF (bouton « Exporter ») et une pièce jointe : dialogue « Enregistrer le fichier » sur
   Téléchargements, nom correct, fichier lisible ; annuler n’enregistre rien.
6. Couper le réseau (ou arrêter le serveur) : page « Keystone est injoignable » ; « Réessayer » ; retour automatique au retour
   du réseau ; certificat auto-signé → message de certificat.
7. Raccourcis F5, Alt+Origine, Ctrl+Maj+O, Ctrl+Maj+L avec le focus dans la page et dans un champ de saisie ; menu de la fenêtre
   (clic droit sur la barre de titre, Alt+Espace) ; « À propos ».
8. Taille, position et état agrandi retenus ; deux écrans puis débrancher le second.
9. Sans runtime WebView2 (machine virtuelle Windows 10 sans Edge à jour) : message et lien.
10. Mise à l’échelle 125 % / 150 % (dialogue lisible), icône dans la barre des tâches et l’explorateur, barre de titre sombre.
11. Bêta derrière l’identification HTTP de l’hébergeur : la fenêtre d’identification s’affiche.

## 7. Ce qui reste, questions ouvertes

R-210 : **construit, à vérifier sur un PC Windows** (§ 6) avant d’être marqué « fait ». Ensuite :

- **Signature de code** : EPC2i a-t-il un certificat de signature (ou faut-il en acheter un, ou passer par Azure Trusted
  Signing) ?
- **Diffusion** : exe copié à la main, ou déploiement par la DSI (Intune / GPO) avec `keystone.json` ? Faut-il un installateur
  MSI / MSIX ?
- **Adresse du serveur** à pré-remplir une fois l’hébergement choisi (I-1a).
- `ci.yml` se déclenche sur une PR qui ne touche que `desktop/windows/` (le filtre exclut seulement la documentation) : faut-il
  y exclure `desktop/**` pour économiser des minutes ? (non modifié ici, consigne.)
