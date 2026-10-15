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
  *Recherche d’un article dans tout le catalogue depuis un repère, écart de révision avec Codex : à vérifier après
  intégration (R-108, R-109).*
- **Nomenclature projet** : équipements et articles, valorisation (prix commandé, sinon dernier prix d’achat, sinon
  catalogue — masqués `•••` pour lui), manques. *Coût des remplacements d’articles, doublon signalé : à vérifier après
  intégration (R-104, R-111).*

### 3. Référentiel technique

- **Articles (PLM)** : le catalogue ; « Nouvel article ». *Validation des articles par l’ingénierie : à vérifier après
  intégration (R-102).*
- **Ordres de modification (ECO)** : listés depuis **Vigie**, qui les gère ; Keystone montre les cibles (nomenclatures,
  parc installé) et enregistre l’avancement en attente de synchronisation.
- **Plans** : le coffre PDM (SolidWorks PDM **non connecté** : « Synchroniser le coffre » est une synchronisation simulée).

### 4. Interfaces, réunions, qualité

- **Interfaces** : données dues par le client ou un tiers, avec leur date de besoin. *Date de réception : à vérifier après
  intégration (R-116).*
- **Réunions & CR** : il rédige et envoie le compte rendu des réunions **qu’il organise** ; sinon il ajoute des notes.
- **Inspections & réserves**, **Qualité et livrables**, **Mise en service & transfert**, **REX & clôture** des projets dont il
  fait partie.

## Points d’attention

- Les ECO et les NCR se créent et se traitent dans **Vigie** ; les documents dans **Codex**.
- Les exports EPLAN, TIA Portal et SolidWorks ne sont pas importés (imports désactivés, D-7b).
