# Keystone PM — backlog produit (hors prototype)

Besoins exprimés après l'analyse du prototype v8. Rien ici n'est implémenté.
Règle : les modules « proposés » ne sont construits qu'après validation explicite.

## 1. Demandé — Expédition & transport (section Projet › Chantier & transfert)

**Constat.** Le prototype ne couvre le transport que par l'étape de cycle de vie *Expédition*. Cette étape a 3 livrables cochables :
- « Colisage & documents douaniers » ;
- « Transport contracté » ;
- « Expédition effectuée ».

Les articles PLM portent déjà un code douanier (HS) et une restriction export, mais rien ne les exploite.

**Périmètre envisagé** (à affiner avant construction) :
- **Plan d'expédition par projet**
  - lots d'expédition ;
  - colis : dimensions, poids brut et net, contenu ;
  - conteneurs ou chargements (20' / 40' / 40' HC / open-top / flat-rack / hors gabarit), avec leur taux de remplissage.
- **Mode de fret** : routier, aérien, maritime ou multimodal, avec :
  - l'Incoterm ;
  - le transitaire ;
  - les ports ou aéroports de départ et d'arrivée ;
  - l'ETD et l'ETA, et le suivi des jalons : enlèvement, dédouanement export, embarquement, arrivée, dédouanement import, livraison chantier.
- **Valorisation**
  - valeur par colis et par conteneur, à partir des prix articles et des commandes ;
  - assurance transport ;
  - coûts fret, droits et taxes imputés à une catégorie du budget.
- **Documents générés et versés dans Codex**
  - facture commerciale ;
  - facture proforma ou facture douane ;
  - packing list ;
  - certificat d'origine ou EUR.1 ;
  - lettre de transport : CMR, connaissement (B/L) ou LTA (AWB) ;
  - déclaration d'export.
- **Douane**
  - remontée des codes HS depuis la nomenclature et le PLM ;
  - synthèse par code HS : valeur, poids, origine ;
  - alerte sur les articles sous restriction export (biens à double usage).
- **Contrôle croisé nomenclature ↔ packing list**
  - quantités expédiées comparées aux quantités de la nomenclature ;
  - manquants, excédents, articles hors nomenclature ;
  - écarts de valeur.
  - Ce contrôle bloque le livrable « Colisage & documents douaniers » tant qu'il n'est pas soldé.
- **Liens**
  - réception chantier : livraisons et réserves à l'arrivée ;
  - étape *Expédition* du registre projets ;
  - risques, par exemple le retard de fret.

## 2. Proposés — à valider

| # | Outil | Pourquoi (contexte Keystone) | Portée indicative |
|---|---|---|---|
| P1 | **Relance fournisseurs (expediting) & inspections usine** | Commandes longues (charpente, grues, TGBT) ; FAT fournisseurs avant expédition | Avancement de fabrication par commande, jalons d'inspection, bons de libération (release note), alertes de délai |
| P2 | **Conformité CE & dossier technique machine** | Keystone fabrique des machines. Le règlement Machines (UE) 2023/1230 s'applique à partir du 20 janv. 2027. | Analyse de risques, exigences essentielles, déclaration UE de conformité, dossier technique et notices, lien vers les livrables projet |
| P3 | **Réclamations contractuelles & pénalités** | Contrats EPC : pénalités de retard, réclamations du client ou vers le client, au-delà des avenants | Registre des réclamations, chiffrage, pénalités calculées depuis le planning, lien avec les demandes de modification et le contrat |
| P4 | **Multi-devises & exposition de change** | Projets Afrique et Asie-Pacifique ; question ouverte C-9 (exposition EUR/USD sur Halvorsen) | Devise par contrat et par commande, cours de référence, exposition par projet, alertes de couverture |
| P5 | **Missions & mobilisation internationale** | Chantiers au Maroc, en Côte d'Ivoire, au Sénégal et en Asie : visas, vaccins, voyages, indemnités | Ordres de mission, voyages, indemnités journalières, lien avec Cursus et le planning chantier |
| P6 | **Offres & chiffrage (avant-vente)** | Étapes Initiative, APS et APD : l'offre commerciale existe dans les données, mais pas l'outil pour la construire | Chiffrage depuis les modèles de types de machines, marge, aide au go / no-go, conversion en budget de référence (BL1) à la signature |
| P7 | **Outillage & étalonnage** | ISO 9001 §7.1.5 : maîtrise des équipements de mesure ; outillage envoyé sur chantier | Parc d'outillage, affectation chantier, échéances d'étalonnage, certificats |
| P8 | **Application mobile chantier (hors-ligne)** | Rapports journaliers, réserves, photos et réceptions depuis le chantier (question ouverte X-4) | Version tablette des écrans Chantier, Réserves et Livraisons, avec synchronisation |
