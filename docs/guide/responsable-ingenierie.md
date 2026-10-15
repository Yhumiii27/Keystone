# Guide — Responsable ingénierie

Profil de démonstration : **Antoine Girard**. Lire d’abord le [tronc commun](README.md).

## Ce que voit le responsable ingénierie

- **En haut** : Accueil, Mes projets, Mes approbations, Documents · Codex.
- **Projet** : Plan — WBS, Réunions & CR, Interfaces ; Ingénierie (synthèse, process, mécanique, électricité, automatisme),
  Validation P&ID, Nomenclature projet ; Qualité et livrables, Inspections & réserves ; Mise en service & transfert ;
  REX & clôture.
- **Référentiel technique** : Articles (PLM), Ordres de modification (ECO), Plans.
- **Ressources** : Demandes de ressources, Matrice de compétences, Congés et calendrier.
- **Administration** : Paramètres, Types de machines.

Il ne voit ni les taux horaires ni les prix fournisseurs. Ses droits d’écriture sur un projet suivent l’**équipe projet**
(référent ingénierie, membre).

## Parcours principaux

### 1. Ingénierie du projet

- **Synthèse ingénierie** et écrans par discipline : livrables d’études, avancement, documents.
- **« Geler »** puis **« Proposer la diffusion »** d’un document d’étude ; la diffusion est validée par le chef de projet
  (« Valider la diffusion (CP) ») et la décision part vers **Codex** (en attente de synchronisation tant que Codex n’est pas
  connecté).
- La **dernière révision gelée ou diffusée** fait référence (E-5).

### 2. P&ID et nomenclature

- **Validation P&ID** : repères (tags), périmètre (Keystone / surcouche / client), validation du process.
- **Associer un tag à un article** (R-108) : cliquer sur un tag, puis chercher dans **tout le catalogue** (« Rechercher une
  référence ou un nom »). Le filtre de type propose d’abord les types compatibles avec le tag ; les articles déjà dans la
  nomenclature du projet viennent en tête (« Dans la nomenclature ») ; 20 résultats au plus. Ensuite :
  - « Lier seulement » relie le tag sans toucher à la nomenclature ;
  - « Lier et ajouter à la nomenclature » ajoute aussi la ligne (quantité 1 par défaut, périmètre du tag) ; il faut le droit
    de modifier la nomenclature du projet.

  Keystone ne crée jamais d’article depuis le P&ID.
- **Écart de révision avec Codex** (R-109) : quand Codex a une révision plus récente du P&ID que celle des tags, un bandeau
  le dit en haut de l’écran (par exemple « Codex a la rév. D de ce PID (…) — les tags viennent de la rév. C. Réimportez les
  tags de la rév. D. ») et « Importer les tags du PID » propose cette révision. Rien n’est bloqué.
- **Nomenclature projet** : équipements et articles, valorisation (prix commandé, sinon dernier prix d’achat, sinon
  catalogue — masqués `•••` pour lui), manques.
- **Comparer les révisions** (R-104) : le remplacement d’un article est chiffré comme la nouvelle quantité × le nouveau prix
  moins l’ancienne quantité × l’ancien prix ; si un des deux prix est inconnu, seule la différence de quantité compte.
- **Doublon possible** (R-111) : un article acheté et un ensemble qui ont le même code douanier et le même prix catalogue,
  sans que l’un fasse partie de l’autre, sont signalés sur les deux lignes (« Doublon possible de … · à vérifier par le
  bureau d’études ») et par une note des indicateurs. Aucune valeur ne change.

### 3. Référentiel technique

- **Articles (PLM)** : le catalogue ; « Nouvel article ».
- **Valider un article** (R-102) : le volet d’un article « Non validé » a une section **Qualification** (ce qui manque, qui a
  validé et quand).
  1. « Compléter la fiche » : code douanier (ou « Sans objet »), restriction à l’export (« Aucun » choisi explicitement, ou
     la restriction et son texte), délai en semaines, référence fabricant ; « Enregistrer la fiche ».
  2. « Valider l’article » : réservé au responsable ingénierie et au directeur ; le bouton reste grisé tant que la fiche est
     incomplète (le survol liste ce qui manque).

  Après validation, « Compléter la fiche » est réservé au responsable ingénierie et au directeur.
- **Ordres de modification (ECO)** : listés depuis **Vigie**, qui les gère ; Keystone montre les cibles (nomenclatures,
  parc installé) et enregistre l’avancement en attente de synchronisation.
- **Plans** : le coffre PDM (SolidWorks PDM **non connecté** : « Synchroniser le coffre » est une synchronisation simulée).

### 4. Interfaces, réunions, qualité

- **Interfaces** : données dues par le client ou un tiers, avec leur date de besoin. « Marquer reçu » demande la date de
  réception (« Reçu le », aujourd’hui par défaut, jamais dans le futur) ; elle ne se corrige plus ensuite (R-116).
- **Réunions & CR** : il rédige et envoie le compte rendu des réunions **qu’il organise** ; sinon il ajoute des notes.
- **Inspections & réserves**, **Qualité et livrables**, **Mise en service & transfert**, **REX & clôture** des projets dont il
  fait partie.

## Points d’attention

- Les ECO et les NCR se créent et se traitent dans **Vigie** ; les documents dans **Codex**.
- Les exports EPLAN, TIA Portal et SolidWorks ne sont pas importés (imports désactivés, D-7b).
