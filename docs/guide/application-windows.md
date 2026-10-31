# Keystone sous Windows : navigateur ou application

Keystone s’utilise de deux façons, au choix de chacun (décision du responsable produit du 31 octobre 2026, L9-X2) :

| | Navigateur web | Application Windows `Keystone.exe` |
|---|---|---|
| Où | n’importe quel poste, tablette ou réseau qui atteint le serveur | les PC Windows 10 ou 11 où elle est installée |
| Installation | aucune | un fichier fourni par le service informatique |
| Données, droits, écrans | identiques : c’est le même serveur Keystone | identiques |
| Connexion | « Se connecter avec Microsoft » (compte EPC2i) | la même, dans la fenêtre de l’application |
| Atouts | rien à installer, plusieurs onglets | une fenêtre à part dans la barre des tâches, lancée comme un logiciel, sans onglets mélangés aux autres sites |

L’application n’est **qu’une fenêtre** sur le serveur Keystone d’EPC2i : elle ne contient ni données ni copie hors ligne.
Sans réseau, elle affiche « Keystone est injoignable » avec un bouton **Réessayer**. Vous pouvez passer de l’une à l’autre à
tout moment : ce que vous faites dans l’une se retrouve dans l’autre.

## Installer l’application

1. Récupérez `Keystone.exe` auprès du service informatique (il peut aussi l’avoir installé pour vous).
2. Rangez-le dans un dossier à vous, par exemple `Documents\Keystone`, puis épinglez-le : clic droit sur `Keystone.exe` ›
   **Épingler à la barre des tâches** (ou **Épingler au menu Démarrer**).
3. Au premier lancement, Windows peut afficher « Windows a protégé votre ordinateur » tant que le fichier n’est pas signé :
   ne continuez (**Informations complémentaires** › **Exécuter quand même**) que si le fichier vient bien du service
   informatique.

L’application a besoin du composant **Microsoft Edge WebView2**, présent sous Windows 11 et sur les Windows 10 à jour. S’il
manque, un message l’indique et propose d’ouvrir la page de Microsoft : installez la version « Evergreen » ou demandez-la au
service informatique. En attendant, utilisez Keystone dans votre navigateur.

## Indiquer l’adresse du serveur

- Si le service informatique a préparé l’application, elle s’ouvre directement sur Keystone.
- Sinon, au premier lancement, la fenêtre **« Adresse du serveur Keystone »** la demande : saisissez l’adresse que vous
  utilisez dans votre navigateur (elle commence par `https://`), puis **Enregistrer**. Elle est retenue pour les lancements
  suivants.
- Pour la changer : **Ctrl+Maj+L**, ou clic droit sur la barre de titre (ou **Alt+Espace**) › **Changer l’adresse du
  serveur…**. Quand l’adresse a été fixée par le service informatique, ce menu l’affiche sans permettre de la modifier.

## Se connecter

Comme dans le navigateur : **« Se connecter avec Microsoft »**, puis votre compte EPC2i. La page de connexion Microsoft s’ouvre
dans la fenêtre de l’application. Sur un PC ouvert avec votre compte EPC2i, la connexion peut se faire sans saisir de mot de
passe. La session est conservée quand vous fermez l’application, pour la durée habituelle d’une session Keystone.

## Au quotidien

| Pour | Faire |
|---|---|
| Recharger la page | **F5** |
| Revenir à l’accueil de Keystone | **Alt+Origine** |
| Page précédente / suivante | **Alt+←** / **Alt+→** |
| Agrandir, réduire, taille normale du texte | **Ctrl++**, **Ctrl+-**, **Ctrl+0** |
| Imprimer la page | **Ctrl+P** |
| Ouvrir la page en cours dans le navigateur | **Ctrl+Maj+O** |
| Voir la version et l’adresse du serveur | clic droit sur la barre de titre › **À propos de Keystone** |

- **Exports** (CSV, Excel, PDF) et pièces jointes : Windows demande où enregistrer le fichier, en proposant le dossier
  **Téléchargements**.
- **Liens vers d’autres sites** (Codex, Vigie, Cursus, sites externes) : ils s’ouvrent dans votre navigateur. Une adresse
  e-mail ouvre votre messagerie.
- Une page Keystone ouverte « dans un nouvel onglet » (une photo, un fichier) s’ouvre dans une seconde fenêtre Keystone.
- La taille et la position de la fenêtre sont retenues d’un lancement à l’autre.

## En cas de problème

- **« Keystone est injoignable »** : vérifiez la connexion au réseau (ou au VPN), puis **Réessayer**. Si le navigateur
  n’atteint pas Keystone non plus, le serveur est indisponible : prévenez le service informatique.
- **Certificat non valide** : l’application refuse la connexion pour vous protéger ; prévenez le service informatique.
- **Mauvaise adresse** : **Ctrl+Maj+L** pour la corriger.
- Pour repartir de zéro (déconnexion complète) : fermez l’application et supprimez le dossier
  `%LOCALAPPDATA%\Keystone\WebView2`.
