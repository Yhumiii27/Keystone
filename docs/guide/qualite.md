# Guide — Responsable qualité

Profil de démonstration : **Gabriel Comte**. Lire d’abord le [tronc commun](README.md).

## Ce que voit le responsable qualité

- **En haut** : Accueil, Mes projets, Mes approbations, Documents · Codex.
- **Projet** : Plan — WBS, Réunions & CR ; Ingénierie (synthèse et disciplines), Validation P&ID, Nomenclature projet ;
  Registre des risques, Qualité et livrables, Inspections & réserves ; Mise en service & transfert ; REX & clôture.
- **Référentiel technique** : Articles (PLM), Ordres de modification (ECO), Plans.
- **Achats & stock** : Livraisons (contrôle qualité des réceptions), Stock et magasins.
- **Garantie & après-vente** : Parc installé, Réclamations & interventions.
- **Ressources** : Approbations, Congés et calendrier.
- **Administration** : Paramètres, Types de machines, Registre des types de documents.

Il ne voit ni les taux horaires ni les prix fournisseurs.

## Parcours principaux

### 1. Inspections et réserves (ITP)

1. **Inspections & réserves** du projet : les points de l’ITP par système et par étape (atelier, FAT, site, SAT).
2. **« Enregistrer le résultat »** d’un point : conforme, avec réserves ou non conforme, date, inspecteur, commentaire ; un
   **point d’arrêt** demande le représentant du client présent.
3. Un résultat **non conforme** se signale dans **Vigie** (lien prérempli) : la NCR y est créée et suivie ; Keystone garde le
   lien.
4. **Réserves** : catégorie A (bloquante), B (avant SAT), C (cosmétique), avec **photos** (PNG, JPEG…). Le client voit les
   réserves de son projet et les photos des réserves d’inspection, sans pouvoir en ajouter.

**Une seule liste de réserves par projet** (R-117) : les réserves levées en inspection et celles levées sur le chantier sont
dans la même liste, numérotées à la suite (sur HLT-026 : P-01 à P-05 en inspection, P-06 à P-08 sur site).

- Filtre **Origine** (Tous, Inspection, Site) et colonne Origine.
- « Ajouter une réserve » : les champs habituels, plus l’origine, la partie responsable (Keystone ou client) et le numéro de
  NCR donné par Vigie (par exemple NCR-029).
- « Démarrer » et « Clôturer » sur toute réserve ouverte, quelle que soit son origine.
- Le client voit toute la liste de son projet, sans les numéros de NCR.

**Systèmes de l’ITP** (R-057) : chaque plan d’inspection garde les systèmes de son type de machine tels qu’ils étaient à sa
création. Dans Types de machines, la carte des systèmes ITP l’indique : « Les modifications s’appliquent aux projets créés
ensuite ».

### 2. Livrables et PV de réception

**Qualité et livrables** : les livrables contractuels et leur circuit ; le client accepte ou refuse (PV de réception) depuis
son portail ou « Mes approbations » ; un refus fait repartir le livrable à la révision suivante. Les **NCR** du projet sont
listées depuis Vigie.

### 3. Réceptions

**Livraisons** : le contrôle qualité d’une réception (accepter ou refuser les quantités) ; les quantités acceptées entrent en
stock. Les photos de réception sont stockées par Keystone.

**Réception refusée** (R-096) : après un refus (total ou partiel), le volet de la livraison propose, sous « Contrôle
qualité », un lien « Déclarer la NC fournisseur dans Vigie » par ligne refusée, prérempli avec le fournisseur, la commande,
la réception et la quantité. Le message de confirmation le rappelle (« … · déclarer la NC fournisseur dans Vigie »).
L’acheteur de la commande et les responsables du projet sont prévenus (« Livraison refusée à la réception »). Keystone
n’enregistre pas la NC : elle vit dans Vigie.

### 4. Risques, mise en service, REX

- **Registre des risques** : création et mise à jour des risques qualité.
- **Mise en service & transfert** : essais et dossier de transfert.
- **REX & clôture** : « Ajouter un retour d’expérience ».

### 5. Garantie

**Réclamations & interventions** : diagnostic, interventions, clôture ; **Parc installé** : machines livrées et configuration
réelle. Une réclamation peut mener à un ECO (dans Vigie).

## Points d’attention

- Les NCR, les 8D et les plans d’action vivent dans **Vigie** ; les HSE du chantier aussi.
- Un incident HSE du chantier se déclare dans Vigie : le rapport journalier n’a plus de case incident, seulement le lien
  « Incident HSE ? Déclarez-le dans Vigie » (R-122). Les incidents saisis avant restent affichés sous leur rapport.
