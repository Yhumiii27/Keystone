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
   réserves et leurs photos de son projet, sans pouvoir en ajouter.

*Liste de réserves unique (ITP et chantier) et systèmes ITP figés par projet : à vérifier après intégration (R-117, R-057).*

### 2. Livrables et PV de réception

**Qualité et livrables** : les livrables contractuels et leur circuit ; le client accepte ou refuse (PV de réception) depuis
son portail ou « Mes approbations » ; un refus fait repartir le livrable à la révision suivante. Les **NCR** du projet sont
listées depuis Vigie.

### 3. Réceptions

**Livraisons** : le contrôle qualité d’une réception (accepter ou refuser les quantités) ; les quantités acceptées entrent en
stock. Les photos de réception sont stockées par Keystone. *Réception refusée : NCR fournisseur préremplie dans Vigie et
alerte à l’acheteur — à vérifier après intégration (R-096).*

### 4. Risques, mise en service, REX

- **Registre des risques** : création et mise à jour des risques qualité.
- **Mise en service & transfert** : essais et dossier de transfert.
- **REX & clôture** : « Ajouter un retour d’expérience ».

### 5. Garantie

**Réclamations & interventions** : diagnostic, interventions, clôture ; **Parc installé** : machines livrées et configuration
réelle. Une réclamation peut mener à un ECO (dans Vigie).

## Points d’attention

- Les NCR, les 8D et les plans d’action vivent dans **Vigie** ; les HSE du chantier aussi.
- L’incident HSE du rapport journalier se déclare dans Vigie. *Case incident retirée du rapport : à vérifier après
  intégration (R-122).*
