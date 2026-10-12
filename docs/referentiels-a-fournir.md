# Référentiels à fournir par EPC2i (R-178)

> **Fiche de collecte, pas un modèle d’import.** Ce document liste les listes de référence qu’EPC2i doit fournir pour démarrer
> Keystone en production, avec la valeur que Keystone utilise aujourd’hui en production, les contraintes à respecter et qui
> valide. Les imports restent désactivés (décision D-7b) : les valeurs fournies seront saisies dans les écrans de Keystone (ou
> chargées par l’équipe projet une fois D-7b levée). Rien ici n’est un fichier à remplir pour un chargement automatique.
>
> Rappel A-15 (« Données réelles seulement ») : en production Keystone ne montre que ce qu’il a enregistré ou reçu de Codex, du
> PDM, de Vigie, de Cursus ou de Sage. Les valeurs de démonstration du prototype ne sont jamais présentées comme celles d’EPC2i.

Base de production actuelle : `KEYSTONE_SEED=production` (`src/server/db/seed/reference.ts`). Les listes « Paramètres » sont
modifiables par la direction de portefeuille seule (A-14) ; chaque modification est tracée dans le journal d’audit.

## 1. Listes des Paramètres (écran Administration › Paramètres)

| Liste | Valeur en production aujourd’hui | Contraintes | Qui valide |
|---|---|---|---|
| Familles de compétences | Les 10 du prototype : Structural, Electrical / HV, MEP, Automation & controls, Crane & lifting, Civil & site, Planning & cost control, Procurement, Quality / QA-QC, Software / IT | Libellé unique dans la liste (sans tenir compte des majuscules). Une seule échelle 1–5 pour toutes les compétences (R-5a). Une famille retirée masque sa colonne de la matrice sans effacer les niveaux. | Direction + chefs de service |
| Catégories de coûts | Labor, Materials, Equipment, Subcontractors, Permits & fees, Contingency | Libellé unique. Chaque catégorie porte un type de coût (main-d’œuvre, matériel, équipement, sous-traitance, frais, réserve) : le type « main-d’œuvre » alimente le coût main-d’œuvre de Ressources (R-086). | Direction + contrôle de gestion (Finance) |
| Statuts de projet (étapes du cycle de vie) | Les 13 étapes : Initiative, APS, APD, Études, Approvisionnements, Fabrication & Assemblage, FAT, Expédition, Chantier, Mise en service & SAT, Garantie, Clos, Annulé | **Statuts de workflow fixes** : pas de statut personnalisé (une étape a ses livrables et sa revue de passage) ; Initiative, Clos et Annulé ne peuvent pas être désactivés. EPC2i peut seulement désactiver les étapes qu’il n’utilise pas. | Direction |
| Catégories de risques | Technical, Supplier / delivery, HSE (safety), Contractual / client, Financial / currency, Regulatory / permits, Resources / skills | Libellé unique. | Direction + responsable qualité |
| Types de livrables | Drawings, Calculation notes, Specifications, Test & inspection reports, Certificates (CE, lifting…), Manuals / as-built, Meeting minutes, Client acceptance (PV de réception) | Libellé unique. | Direction + responsable qualité |
| Jours fériés | Les 11 jours fériés français 2026 | Écriture **« 14 Jul · Fête nationale »** (jour, mois abrégé en anglais, « · », nom) ; le code enregistré est la date **2026**. Keystone ne gère aujourd’hui qu’une année : fournir les jours fériés **datés, année par année** (2026, 2027…) et par pays si des chantiers sont hors de France — sans attendre un calendrier pluriannuel. | Direction + RH |
| Types d’emplacement | Central warehouse, Workshop, Site store, Consignment at supplier, Quarantine (QC hold) | Libellé unique ; chaque emplacement de stock a **un type** de cette liste. | Achats + direction |
| Seuils de santé des projets | À risque sous 0,97 · hors trajectoire sous 0,90 | Nombres dans ]0 ; 2] ; « hors trajectoire » strictement sous « à risque ». | Direction |
| Seuil d’écart d’heures (R-088) | ± 10 % des heures prévues | Pourcentage entier de 1 à 50, appliqué dans les deux sens. | Direction |

## 2. Emplacements de stock et ateliers

| Liste | Valeur en production aujourd’hui | Contraintes | Qui valide |
|---|---|---|---|
| Emplacements de stock | **Aucun** (les 6 emplacements du prototype ne sont chargés qu’en démonstration) | Nom unique ; **un type par emplacement** (liste des types ci-dessus) ; les réceptions, transferts et réservations n’utilisent que ces emplacements. | Achats & stock |

## 3. Grille de taux (écran Ressources › Grilles de taux)

La grille est datée (R-083) : chaque taux et chaque coefficient a une date d’effet ; une modification s’applique à partir de la
date choisie. Elle est modifiée par la direction et la Finance ; les chefs de projet la consultent (P-12 c).

| Liste | Valeur en production aujourd’hui | Contraintes | Qui valide |
|---|---|---|---|
| Rôles et taux horaires de base (€/h) | **Aucun rôle** | Nom de rôle unique ; un taux par rôle et par date d’effet ; « external » dans le nom marque un rôle externe (sous-traitant). Le centre de coût et le grade sont informatifs (R-4b). Indiquer la date d’effet de chaque taux. | Direction + Finance |
| Rattachement personne → rôle | Aucun (tout le monde est « non valorisé ») | Chaque personne valorisée doit avoir un rôle de la grille ; sans rôle, ses heures sont affichées « taux manquant ». **Question ouverte** : qui fournit ce rattachement (l’annuaire Cursus, R-027, ne porte pas de rôle). | Direction + RH |
| Coefficients de majoration | Les 5 du prototype, **valeurs provisoires à confirmer**, en vigueur au 1er janvier 2026 : heures sup. > 8 h/jour ×1,25 ; samedi ×1,5 ; dimanche / jour férié ×2 ; nuit ×1,3 ; astreinte ×0,35 (× base, par heure d’astreinte) | Les 5 clés sont fixes (pas d’ajout de coefficient) ; un facteur entre 0 et 10 ; une date d’effet par valeur. | Direction + Finance |

## 4. Organisation

| Liste | Valeur en production aujourd’hui | Contraintes | Qui valide |
|---|---|---|---|
| Services (départements) | Les 5 du prototype sans responsable : Engineering, Site operations, MEP, Quality, Controls & planning | Nom unique ; un responsable par service (une personne connue de Keystone). Aucun écran ne permet aujourd’hui d’ajouter ou de renommer un service : la liste réelle doit être fournie pour être chargée. | Direction + RH |
| Zones | Europe & North America, Africa, Asia Pacific, sans responsable | Une zone par pays ; un responsable de zone (personne). | Direction |
| Clients | **Aucun** | Nom unique ; un code client de 3 lettres unique (sert à numéroter les projets) ; les contacts clients arriveront avec les comptes (I-2b). | Direction + commerce |

## 5. Ce que cette fiche ne couvre pas

- Le chargement lui-même (attend les données et la levée de D-7b) ;
- les standards par type de machine (R-053, données promises par le métier) ;
- l’annuaire du personnel (R-027, Cursus) ;
- la procédure d’achat (seuils, niveaux d’approbation — R-094).

R-178 reste « en cours » tant que les listes réelles ne sont pas fournies et chargées.
