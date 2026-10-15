# Guide — Chef de service

Profil de démonstration : **Marion Kerviel** (cheffe du service Ingénierie). Lire d’abord le [tronc commun](README.md).

## Ce que voit le chef de service

- **En haut** : Accueil, Mes projets, Mes approbations, Documents · Codex.
- **Portefeuille** : Vue d’ensemble, Mappemonde des projets.
- **Projet** : Chantier, Réunions & CR, Heures (Lucca) ; les autres écrans du projet s’ouvrent en consultation.
- **Ressources** : Ressources, Demandes de ressources, Approbations, Lissage what-if, Matrice de compétences, Congés et
  calendrier.
- **Administration** : Paramètres.

Le chef de service ne crée pas de projet (P-3). Il ne voit pas les taux horaires ni les prix fournisseurs.

## Parcours principaux

### 1. Décider les demandes de ressources

1. Une demande envoyée par un chef de projet (ou un brouillon what-if envoyé) arrive dans **Approbations** du service, et
   dans **Mes approbations**.
2. Le chef de service **approuve**, **replanifie** ou **refuse** (avec un commentaire). Approuvée, la demande crée une tâche
   pour la personne affectée.
3. Il ne décide que pour **les services qu’il dirige** ; la page d’un autre service le renvoie vers le sien. Le directeur
   décide pour tous (P-8a).
4. Une demande pour un **rôle intérimaire** (personne externe à trouver) crée, une fois approuvée, une tâche pour les
   **achats**, qui trouvent et nomment la personne (R-089).

### 2. Suivre la charge de son équipe

- **Ressources** : charge et capacité des personnes ; **Lissage what-if** pour comparer des scénarios.
- **Matrice de compétences** (R-087) : une seule échelle de 1 à 5 (« Ajouter une compétence » ne demande plus de niveaux) ;
  un expert est au niveau 4 ou plus. Deux indicateurs : « Compétences sans expert » (personne au niveau ≥4) et
  « Compétences à expert unique » (une seule personne au niveau ≥4).
- **Congés et calendrier** (R-031) : les congés et absences viennent de **Cursus**, où ils se demandent et s’approuvent. Deux
  types seulement : « Congés » (congés payés, RTT) et « Absence » (toute autre absence), sans motif. La première tuile
  « Cursus » donne la date de la dernière absence reçue (« Aucune reçue pour l’instant » tant que Cursus n’en a pas envoyé).
  Il n’y a plus de bouton « Synchroniser Lucca ».
- « Mes tâches » d’une personne de son service : le chef de service peut la consulter (R-9).

### 3. Heures

**Heures (Lucca)** du projet : rapprochement des heures déclarées et prévues. Une ligne est signalée quand l’écart atteint
le **seuil d’écart d’heures** des Paramètres (10 % par défaut, réglé par le directeur — R-088), au-dessus (▲) comme en
dessous (▼) du prévu ; la tuile « Écart » suit le même seuil. Le coût de l’écart est valorisé aux taux de la grille, donc
masqué `•••` pour le chef de service. Les temps passés viendront de Cursus (lien en attente de validation).

### 4. Chantier et réunions

- **Chantier** : préparation et mobilisation des équipes (en consultation sauf sur les projets dont il est membre).
- **Conflits de l’équipe chantier** (R-119) : Chantier › Équipe & mobilisation › « Détection des collisions » calcule les
  conflits (charge au-delà de 110 %, même personne sur deux chantiers, habilitation Cursus qui expire, en attente ou
  manquante, congé ou absence pendant la mission). Pour une personne de son service, le chef de service peut **« Arbitrer »**
  le conflit, même hors de l’équipe du projet : commentaire obligatoire (« Pourquoi il est accepté »), puis « Marquer
  arbitré ». L’arbitrage tient tant que la cause ne change pas ; « Résoudre » ouvre l’écran utile (Lissage what-if, Congés,
  Compétences, Cursus).
- **Réunions & CR** : il ajoute des notes et coche les actions des réunions des projets dont il fait partie ; le compte rendu
  est rédigé et envoyé par l’organisateur et le chef de projet.

## Points d’attention

- Une demande refusée ou replanifiée est notifiée au demandeur dans la cloche (pas d’e-mail).
- Les habilitations chantier des personnes (Go / No Go) se gèrent dans **Cursus**.
