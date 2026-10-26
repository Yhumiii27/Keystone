# Guide — Logistique

Profil de démonstration : **Camille Verdier** (coordinatrice logistique, service Contrôle et planification). Lire d’abord le
[tronc commun](README.md).

Le rôle **Logistique** vient de la décision 7 du responsable produit du 25 oct. 2026 (R-158, module Expéditions) : la
logistique d’EPC2i prépare et suit les expéditions du matériel vers le site de la filiale ou du client. En production, la DSI
l’attribue par le rôle d’application Entra ID `Keystone.Logistics` (valeur `logistics`) ou par un groupe associé à `logistics`
([`docs/EXPLOITATION.md`](../EXPLOITATION.md) § 6).

## Ce que voit la Logistique

- **En haut** : Accueil, Mes projets, Documents · Codex.
- **Projet** : **Expéditions** (Chantier & transfert) ; en consultation : Nomenclature, Chantier, Planning, Livraisons.
- **Ressources** : Congés et calendrier. **Administration** : Paramètres (lecture des Incoterms).

L’**Accueil** liste les expéditions du projet courant : listes de colisage à valider, expéditions en route, étapes de transport
en retard, écarts de colisage à solder.

**Droits** :

- **Expéditions** : modifiables sur **tous** les projets, même hors de l’équipe.
- **Nomenclature, Chantier, Planning, Livraisons** : en consultation, même sur les projets de son équipe.
- **Valeurs en douane** des expéditions : visibles (elles viennent de la valorisation de la nomenclature).
- Pas de Contrat, de Budget ni de Facturation : l’**Incoterm du contrat** est affiché sur l’écran Expéditions ; il est renseigné
  sur l’écran Contrat par ses éditeurs (directeur, Finance, chef de projet).

## Parcours principaux

1. **Créer une expédition** : Expéditions › « Nouvelle expédition » — ligne(s) d’équipement, mode, transitaire (externe, sans
   accès : vous notez ce qu’il faut), origine, destination, départ et arrivée prévus. Référence EXP-01, EXP-02…
2. **Déclarer les chargements** : « Ajouter un chargement » (camion, conteneur 20′ / 40′ / 40′ HC, open-top, flat-rack, hors
   gabarit ; n° de conteneur, scellé, poids brut), puis « Ajouter du contenu » : un article de la nomenclature (ou un article
   libre avec sa description, son code SH et sa valeur), quantité, colis, dimensions, poids, origine.
3. **Contrôle du colisage** : les quantités colisées sont comparées à la nomenclature des lignes d’équipement de l’expédition
   (manquants, excédents, articles hors nomenclature). Justifiez chaque écart (« Justifier ») ; un article sans code SH bloque :
   faites compléter l’article dans le PLM. La synthèse par code SH donne valeur, poids et origines ; les articles sous restriction
   export sont signalés.
4. **Valider la liste de colisage** : l’expédition passe « préparée ». Une modification du contenu la ramène en brouillon.
   Le livrable « Colisage & documents douaniers » du cycle de vie ne se coche que lorsque toutes les expéditions du projet sont
   validées.
5. **Organiser le transport** d’après l’Incoterm du contrat : les étapes à la charge d’EPC2i (emballage, chargement,
   dédouanement export, transport principal, assurance, livraison site… selon l’Incoterm) se planifient et se datent
   (« Modifier » sur l’étape) ; celles de l’acheteur sont affichées sans suivi.
6. **Suivre** : « Marquer enlevée » (départ réel), « Marquer en transit », « Marquer arrivée » (arrivée réelle). Une alerte
   « Retard de fret » s’affiche si l’ETA dépasse la date de besoin sur site (le chef de projet peut ouvrir un risque).
7. **Documents d’expédition** : liste de colisage, liste par conteneur, bon de livraison, marquage des colis, lettre de voiture
   CMR, instructions au transitaire, demande de certificat d’origine / EUR.1, données de la déclaration d’export (jamais de
   facture) — « PDF » pour les télécharger, « Verser dans Codex » pour les classer (un nouvel indice à chaque versement).
8. **Réception sur site** (expédition arrivée ; avec l’équipe chantier) : « Pointer le chargement » puis chaque ligne (reçu,
   manquant, endommagé). Chaque écart ouvre une réserve sur la liste des réserves (endommagé : A, manquant : B par défaut). « Solder
   la réception » quand tout est pointé ; l’expédition se clôture d’elle-même à la levée de sa dernière réserve, ou par
   « Clôturer l’expédition » (motif obligatoire si des réserves restent ouvertes).
