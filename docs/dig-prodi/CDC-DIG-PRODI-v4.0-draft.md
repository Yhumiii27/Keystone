# CAHIER DES CHARGES : PILOTAGE NUMÉRIQUE DES PROJETS INDUSTRIELS (DIG-PRODI) — draft v4.0 (baseline)

> Texte reçu du responsable produit le 21 oct. 2026, reproduit tel quel (brouillon à compléter). Analyse et comparaison avec
> Keystone : [`ANALYSE-DIG-PRODI.md`](ANALYSE-DIG-PRODI.md).
>
> Note du responsable produit (21 oct. 2026) : le CDC intègre plusieurs niveaux de gestion de projet, du CAPEX global de
> montage de l’usine (géré par la filiale, qui devra avoir accès à notre outil) jusqu’au projet industriel de création des
> équipements (géré par EPC2i). Le projet doit donc commencer par un CAPEX ouvert par la filiale, qui ouvre un projet de
> besoin machine chez EPC2i (si le CAPEX inclut des machines), idéalement depuis un catalogue qui pourrait faire office d’un
> nouveau logiciel pour créer et paramétrer les machines et proposer le catalogue aux filiales dans leurs ouvertures de CAPEX.

## 1. Contexte, Enjeux et Objectifs de la Refonte (v4.0)

Dans le cadre de l’optimisation de sa gouvernance industrielle, notre groupe fait évoluer son processus historique (passant
d'un modèle lourd de 6 étapes séquentielles à un modèle agile et simplifié en 4 phases guidées par des dossiers numériques
vivants).

- Objectifs mesurés de la digitalisation :
  - Réduction de 40 % des délais de validation grâce à la clarification des circuits de décision.
  - Diminution de 50 % des documents statiques en remplaçant les 6 formulaires Word/Excel dispersés par 3 dossiers vivants
    sous workflow.
  - Traçabilité numérique à 100 % via une Workstation centralisant les budgets, les jalons, les risques et les indicateurs
    en temps réel.

## 2. Architecture du Processus Cible : 4 Phases, 3 Jalons, 3 Dossiers Vivants

La solution logicielle recherchée doit intégrer et automatiser nativement le cycle de vie suivant :

### Phase 1 : Cadrage & Opportunités

- Objectif : Qualifier le besoin et s'assurer de l'alignement stratégique et de marché.
- Activités & Contenu : Cadrage du périmètre, barrières à l'entrée, premier Business Plan préliminaire avec une précision
  d'estimation de ±50 %, et intégration des contraintes foncières/réglementaires (ICPE, PLU, accès site).
- Sécurité & Risques : Jalon SSE obligatoire HazID (HS 2) pour identifier initialement les dangers et pré-valider la sécurité
  des procédés.
- Jalon de fin — G1 (« Go Études ») : Décidé en COPIL GPI mensuel (le double examen PDG + COPIL est supprimé pour se limiter
  à un délai de 2 jours maximum). Ce jalon libère le budget d'études d'Avant-Projet.
- Livrable 1 (Dossier Vivant 1) : Business Case Cadrage (formulaire standardisé en ligne capturant le besoin et le BP
  préliminaire, soumis à un workflow de visa Sponsor & COPIL GPI).

### Phase 2 : Avant-Projet (APS ➔ APD)

- Objectif : Fusion des phases APS et APD en un entonnoir de précision continu (50 % ➔ 30 % ➔ 10 %) pour aboutir à un
  dossier unique d'engagement CAPEX.
- Activités & Contenu :
  - Faisabilité technologique, étude de variantes et gel de la Baseline Technique.
  - Constitution du Pack Ingénierie Cible (Cible > 80 % de complétude) : Schémas P&ID (tuyauteries, instrumentation, vannes,
    sécurité process), BOM (liste des équipements majeurs), Layout & Plan de masse, Schémas électriques (TGBT, puissance) et
    analyses fonctionnelles.
  - Constitution du dossier réglementaire (ICPE, Permis de construire, zonage ATEX) et études de sécurité HazOp / AMDEC
    (HS 3).
  - Modèle financier consolidé par la DAF (précision du budget CAPEX à +10 % / -5 %).
- Jalon de fin — G2 (« Single Gate PDG ») : Seul jalon d'arbitrage ultime du PDG sur la base du dossier d'investissement
  consolidé. Sa validation met officiellement le projet en vigueur (achats de terrain, équipements, lancements des
  recrutements).
- Livrable 2 (Dossier Vivant 2) : Dossier Investissement (Pack ingénierie complet + AFE, autorisations, BP DAF consolidé,
  soumis à un workflow de signature électronique du PDG).

### Phase 3 : Exécution

- Objectif : Réalisation physique, maîtrise des coûts et des délais, et gestion rigoureuse des modifications.
- Activités & Contenu : Achats d'équipements (long lead items), génie civil, structures, VRD, montage mécanique, tuyauterie,
  câblage, et contrôle physique chantier Sécurité HS 4.
- Gouvernance & Décisions : La conformité à l'Avant-Projet est vérifiée par le Directeur Industriel (Dir.IG) seul. Le Copil
  Projet prend les arbitrages et gère les modifications courantes dans le cadre de seuils délégués (fin des arbitrages
  systématiques par le PDG).
- Livrable 3.1 (Workstation Dashboard) : Suivi dynamique en temps réel via la Courbe en S (S-Curve) / Earned Value Management
  (EVM), registre des avenants / MoC, et tableau de bord des KPI opérationnels.

### Phase 4 : Démarrage, Montée en Puissance (Ramp-up) & Transfert (G4)

- Objectif : Fusion de la mise en service (MES) et de la montée en puissance sous un pilotage unique à bascule.
- Activités & Contenu :
  - Pre-Commissioning : Tests à blanc, vérification E/S automates, épreuves d'étanchéité.
  - Audit de Sécurité PSSR (Pre-Startup Safety Review) : Audit de sécurité obligatoire avant introduction de
    fluides/matières, incluant la RSPDI (HS 4+5) et l'audit ASPD (HS 6) conduit par la Direction SSE Groupe.
  - Commissioning & SAT : Essais en charge avec produits réels, réglages des boucles, formation initiale des équipes
    d'exploitation.
  - Montée en puissance (Ramp-up) : Suivi au jour le jour de l'atteinte de la capacité nominale sur 30 jours continus, suivi
    du TRS/OEE et taux de rebuts.
- Jalon de fin — G3 (« Go Transfert / Clôture ») : Clôture formelle sur critères (réserves soldées + 1 mois à capacité
  nominale, au plus tard 6 mois après le début de la MES).
- Livrable 3 (Dossier Vivant 3) : Dossier Transfert & REX (PV de transfert d'actif unique contresigné par le Client Interne
  et le Dir.IG, obtention du Quitus Sécurité PSSR, clôture comptable, et capitalisation automatique du REX par les fonctions
  centrales).

## 3. Organisation, Staffing et Rôles Décisionnels

La solution doit permettre de modéliser deux typologies de projets avec des circuits de staffing distincts :

1. Projet Standard / Light (Capex modéré, < 20 % du CA de la filiale) :
   - Staffing : Chef de projet filiale + Co-DIG (Support opérationnel léger).
   - Suivi : Revue trimestrielle en Copil Projet.
2. Grand Projet Stratégique (Capex majeur, nouvelle usine, > 20 % du CA de la filiale) :
   - Staffing renforcé : Chef de Projet dédié + Contrôleur de Gestion (CDG) de filiale + PMO EPC 2i en appui opérationnel.
   - Suivi : Revue mensuelle stricte et audits transversaux.

## 4. Exigences Fonctionnelles et Techniques de la Plateforme

- Workflows de Validation et Consultations en Ligne :
  - Dématérialisation complète des circuits de validation des jalons (G1, G2, G3) avec signatures électroniques.
  - Intégration de workflows d'avis d'experts asynchrones (Qualité, HSE, DAF, Exploitation) pour éviter les réunions
    superflues et accélérer les instructions.
- Dashboards et Pilotage Intégré :
  - Tableaux de bord unifiés offrant une visibilité temps réel sur la maturité des études (suivi du taux de complétude du
    Pack Ingénierie), l'avancement budgétaire (écart d'incertitude), et le suivi de la montée en puissance (Ramp-up).
- Sécurité, Hébergement et Confidentialité :
  - Hébergement des données impérativement en France pour répondre aux critères de souveraineté et de conformité du groupe.
  - Gestion fine des rôles et des profils (isolation des portefeuilles entre le Groupe et la filiale EPC 2i, tout en
    autorisant des vues croisées pour les fonctions centrales comme la DAF ou le SSE).
- Intelligence Artificielle et Aide à la Décision :
  - Capacités d'analyse prédictive ou d'assistant intelligent intégré pour détecter et alerter automatiquement en cas de
    dérive sur les plannings (courbe en S), les budgets ou les non-conformités des actions de sécurité (ex: suivi de la levée
    des actions HazID / HazOp).

## 5. Calendrier de Déploiement et Modalités d'Accompagnement

Nous attendons des candidats une proposition méthodologique s'articulant autour d'un déploiement progressif :

- Mois 1-2 (Cadrage & Paramétrage) : Formalisation des 3 dossiers vivants et paramétrage des workflows de validation sur
  l'outil.
- Mois 2-3 (Conception & Tests IT) : Paramétrage des formulaires de Business Case, des modèles de consultation et tests des
  passerelles techniques.
- Mois 3-4 (Phase Pilote) : Déploiement sur 1 à 2 projets pilotes pour valider les dashboards d'études et intégrer les
  retours terrain.
- Déploiement Général : Bascule officielle de l'ensemble des projets de la nouvelle procédure DIG-PRODI, incluant la
  formation des Directeurs de Zone, Chefs de Projets et CDG de filiales.
