# DIG-PRODI v4.0 — analyse, comparaison avec Keystone et modifications proposées

> 21 oct. 2026. Source : [`CDC-DIG-PRODI-v4.0-draft.md`](CDC-DIG-PRODI-v4.0-draft.md) (brouillon reçu du responsable
> produit) et l’état de Keystone sur `main` (livraisons 1 à 8, livraison 9 en cours). **Rien n’est construit** : chaque
> lot ci-dessous attend la validation du responsable produit (règle « pas de nouvel outil sans accord »). Les preuves de
> l’existant renvoient au code et aux docs (`docs/spec/`, `docs/DECISIONS.md`, `docs/RESTE-A-DEVELOPPER.md`).

## 1. Ce que décrit le CDC — et ce qu’il ne décrit pas

### 1.1 Lecture

Le CDC décrit la méthodologie **du maître d’ouvrage** : le groupe et ses filiales qui investissent (CAPEX) pour monter une
usine ou une ligne. Keystone, lui, est construit pour **le fournisseur** : EPC2i qui conçoit, fabrique, livre et met en
service des machines (13 étapes, de l’Initiative à la Garantie). Ce sont deux niveaux différents d’un même investissement :

| Niveau | Qui pilote | Objet | Méthode | Dans Keystone aujourd’hui |
|---|---|---|---|---|
| **N1 — CAPEX usine** | la filiale (sponsor, chef de projet filiale, CDG), le groupe (PDG, DAF, SSE, Dir.IG) | l’investissement complet : terrain, génie civil, utilités, machines, recrutement, montée en puissance | DIG-PRODI : 4 phases, G1/G2/G3, 3 dossiers vivants | **absent** |
| **N2 — Besoin machine** | la filiale exprime, EPC2i qualifie | une ou plusieurs machines du CAPEX, idéalement choisies dans un catalogue | — (à créer) | **absent** (pas de catalogue machines, seulement des types de machine) |
| **N3 — Projet EPC2i** | le chef de projet EPC2i | la fourniture des équipements | 13 étapes, livrables de sortie, BL0/BL1, EVM, ITP, mise en service | **existe** (cœur de Keystone) |

La note du responsable produit confirme ce découpage : le projet commence par un **CAPEX ouvert par la filiale**, qui ouvre
un **besoin machine chez EPC2i**, idéalement depuis un **catalogue**. Keystone doit donc **monter d’un niveau** (le CAPEX) et
**s’ouvrir aux filiales**, sans perdre ce qu’il fait déjà au niveau du projet EPC2i.

### 1.2 Points forts du CDC

- Une chaîne de décision courte : un seul jalon PDG (G2), Dir.IG seul en exécution, Copil projet avec seuils délégués.
- Des dossiers « vivants » (données sous workflow) plutôt que des formulaires : c’est exactement le modèle de Keystone
  (registres, listes de livrables, approbations, piste d’audit).
- Un entonnoir de précision explicite (±50 % → ±30 % → +10/−5 %) qui rend l’incertitude budgétaire mesurable.
- Une clôture sur critères (réserves soldées + 30 jours à capacité nominale, ≤ 6 mois après le début de la MES).

### 1.3 Incohérences et manques à corriger dans le CDC (avant de le figer)

| # | Constat | Proposition de complément |
|---|---|---|
| C-1 | « 3 jalons » mais la phase 4 est titrée « (G4) » alors que son jalon de fin est G3 ; la phase 3 n’a pas de jalon de fin. | Écrire « Phase 4 … Transfert (G3) ». Préciser si le passage Exécution → Démarrage est un simple point de contrôle (ex. « Prêt pour PSSR ») sans arbitrage. |
| C-2 | Livrables numérotés 1, 2, **3.1**, 3 : le tableau de bord d’exécution n’est pas un dossier vivant. | Renommer « Livrable 3.1 » en « Tableau de bord d’exécution (Workstation) » et garder 3 dossiers vivants. |
| C-3 | Jalons SSE HS 2 à HS 6 : HS 1 n’existe pas ; RSPDI et ASPD ne sont pas définis. | Ajouter une table des jalons HS (code, phase, contenu, responsable, preuve attendue, bloquant pour quel jalon G). |
| C-4 | « Seuils délégués » du Copil projet non chiffrés. | Matrice de délégation : montant d’une modification / d’un avenant / d’un tirage de provision → Copil projet, Dir.IG, PDG ; par typologie Light / Stratégique. |
| C-5 | Typologie au seuil « 20 % du CA de la filiale » : la donnée CA filiale n’est pas dans le périmètre. | Préciser qui saisit le CA de référence (DAF), l’année de référence, et si la typologie peut être forcée (nouvelle usine = Stratégique d’office). |
| C-6 | « Co-DIG », « Client Interne », « COPIL GPI », « Dir.IG », « Directeur de Zone » non définis. | Glossaire des rôles + RACI par phase et par jalon (rejoint R-058 « RACI par rôle », encore à fournir). |
| C-7 | « Signature électronique » sans niveau. | Fixer le niveau eIDAS (simple, avancée, qualifiée) par document : G2/AFE probablement **avancée** ; visas G1 et avis d’experts : simple (authentification Entra + horodatage + piste d’audit). |
| C-8 | Précision budget « +10 % / −5 % » en phase 2 mais pas de règle de passage ±50 → ±30. | Définir les classes d’estimation par jalon (ex. G1 : classe 4 ±50 % ; mi-AP : ±30 % ; G2 : +10/−5 %) et ce qui fait changer de classe (pack ingénierie ≥ x %, devis fournisseurs, etc.). |
| C-9 | « Pack Ingénierie > 80 % de complétude » : la base du pourcentage n’est pas définie. | Liste type des pièces du pack par type d’investissement, pondérées (P&ID, BOM, layout, électrique, analyses fonctionnelles) ; % = pièces au statut « validé » / pièces attendues. |
| C-10 | Objectifs (−40 % délais, −50 % documents, 100 % traçabilité) sans point de référence. | Mesurer l’existant (délai moyen actuel d’un G, nombre de documents) pendant le pilote, et définir le calcul des KPI dans l’outil. |
| C-11 | Rien sur le lien CAPEX ↔ fournisseurs internes (EPC2i) ni sur le catalogue machines. | Ajouter un chapitre « Besoins machines et catalogue » (voir §3, lots D-3 et D-4). |
| C-12 | Rien sur les interfaces (ERP/Sage, GED, HSE, RH). | Renvoyer aux applications du groupe : Codex (documents), Vigie (QHSE, NCR, ECO), Cursus (habilitations, heures), Sage (comptabilité, clôture comptable du G3). |
| C-13 | Hébergement « impérativement en France » sans précision sur l’IA et l’annuaire. | Préciser : données et sauvegardes en France ; IA via un fournisseur offrant une région UE/France ou désactivable ; annuaire Entra ID (Microsoft) accepté ou non. |

## 2. Correspondance des cycles de vie

Le CAPEX (N1) suit DIG-PRODI ; chaque projet EPC2i (N3) garde ses 13 étapes, **synchronisées** avec les jalons du CAPEX :

| DIG-PRODI (CAPEX filiale) | Ce qu’EPC2i fournit au CAPEX | Étapes Keystone (projet EPC2i) | Précision du chiffrage EPC2i |
|---|---|---|---|
| **Phase 1 Cadrage** → G1 « Go Études » | besoin machine qualifié, machine(s) du catalogue, budget indicatif | Initiative | ±50 % (prix catalogue) |
| **Phase 2 Avant-Projet** → G2 « Single Gate PDG » | devis budgétaire puis offre ferme, part machine du pack ingénierie (P&ID machine, BOM, layout, puissances électriques, analyse fonctionnelle), HazOp/AMDEC machine, zonage ATEX machine | APS (« Devis budgétaire remis »), APD (« Avant-projet détaillé approuvé client », BL1, BAC) | ±30 % à l’APS, +10/−5 % à l’APD |
| G2 validé | **commande** à EPC2i (engagement CAPEX) | entrée en Études (« APD approuvé · BL1 posé ») | baseline BL1 |
| **Phase 3 Exécution** | avancement, EVM, avenants/MoC, long lead items, chantier | Études → Approvisionnements → Fabrication & Assemblage → FAT → Expédition → Chantier | BL1 + avenants |
| **Phase 4 Démarrage / Ramp-up** | pré-commissioning, participation au PSSR, SAT, formation, assistance à la montée en puissance | Mise en service & SAT, puis Garantie | — |
| G3 « Go Transfert » | PV d’acceptation, réserves soldées, dossier de transfert, REX | Clos (après Garantie, ou étape « Transfert » si la garantie dure) | — |

Conséquence : **G2 du CAPEX = commande EPC2i** ; **G3 du CAPEX** a besoin des PV et réserves de tous ses projets EPC2i, plus
des données de montée en puissance que seule la filiale possède.

## 3. Comparaison exigence par exigence

Statut Keystone : ✅ existe · 🟡 partiel · ❌ absent.

| Exigence DIG-PRODI | Keystone aujourd’hui | Écart | Lot |
|---|---|---|---|
| CAPEX ouvert par la filiale, au-dessus des projets | ❌ Projets à plat, groupés par zone, DAS, client, type de machine (`src/server/db/schema/portfolio.ts`). | Nouvel objet CAPEX (programme) | D-1 |
| 4 phases + G1/G2/G3 | 🟡 13 étapes, porte d’entrée par étape, liste de livrables de sortie, passage auto/forcé, date d’effet (L-1…L-4c, R-055 ; `src/domain/lifecycle.ts`). | Modèle d’étapes paramétrable par niveau ; jalons à comité | D-2 |
| Business Case Cadrage (dossier vivant 1) | ❌ (P6 « Offres & chiffrage » non validé ; seul « Score a proposal » en priorisation). | Formulaire business case + BP préliminaire | D-2 |
| Visa Sponsor & COPIL GPI (G1), signature PDG (G2), contre-signature Client Interne + Dir.IG (G3) | 🟡 « Mes validations » (12 types), chaîne séquentielle des demandes de modification ; « signé » = statut + date, sans signature électronique. | Circuit de jalon multi-signataires + signature électronique | D-5 |
| Avis d’experts asynchrones (Qualité, HSE, DAF, Exploitation) | ❌ | Consultations en ligne avec délai et avis motivé | D-5 |
| Entonnoir de précision ±50 → ±30 → +10/−5 % | ❌ BL0/BL1/BL2, provision BAC × 3 %, budget de référence par type de machine. | Classe d’estimation par version de budget, écart d’incertitude au tableau de bord | D-6 |
| Modèle financier DAF (BP, AFE) | 🟡 Marge à terminaison (R-132), trésorerie 6 mois (R-133), rôle Finance (R-044) — au niveau du projet EPC2i. | BP CAPEX (VAN, TRI, payback) au niveau N1, AFE | D-6 |
| Pack Ingénierie > 80 % (P&ID, BOM, layout, électrique, analyses fonctionnelles) | 🟡 Ingénierie par discipline, P&ID (tags liés à la BOM), BOM, livrables publiés x/y, index Codex (`src/domain/engineering.ts`, `pid.ts`, `bom.ts`). | Liste type du pack, % de complétude pondéré, layout comme livrable | D-7 |
| Dossier réglementaire (ICPE, PC, PLU, ATEX) | ❌ (ATEX seulement en texte de démo). | Registre des autorisations avec échéances (N1) | D-7 |
| Jalons SSE HS 2–6 : HazID, HazOp/AMDEC, PSSR, RSPDI, ASPD ; suivi de levée des actions | 🟡 HSE chantier via Vigie (plan de prévention, permis, accueil) ; « Go chantier » à 5 conditions ; « HAZOP light » comme étape P&ID. | Jalons HS bloquants + registre d’actions de sécurité. **Propriétaire : Vigie** (QHSE), Keystone affiche et bloque | D-8 |
| Exécution : S-curve/EVM, avenants/MoC, KPI | ✅ EVM (R-073) et courbe en S, avenants (R-079), demandes de modification séquentielles avec seuil CCB (R-069), alertes portefeuille (R-130), rapports par audience (R-131). | Consolidation au niveau CAPEX (somme des projets EPC2i + lots hors EPC2i) | D-1, D-9 |
| Copil projet à seuils délégués ; Dir.IG seul pour la conformité | 🟡 Séries de réunions (comité de pilotage), décisions et actions ; un seul seuil (CCB 50 k€). | Matrice de délégation par typologie et par montant | D-5 |
| Pre-commissioning, commissioning, SAT, formation | ✅ Systèmes × étapes (Mechanical completion, Pre-commissioning, Commissioning, SAT, Handover), plan SAT, dossier de remise (`src/domain/itpcom.ts`). | Lien avec le PSSR (jalon HS bloquant avant introduction de produit) | D-8 |
| Ramp-up 30 jours, TRS/OEE, rebuts | ❌ | Saisie journalière (ou import) capacité / TRS / rebuts, critère « 30 jours continus à capacité nominale » | D-10 |
| Dossier Transfert & REX, PV d’actif unique, clôture comptable | 🟡 PV d’acceptation client, réserves A/B/C, liste de clôture, REX, enquête de satisfaction, parc installé (`src/domain/rexclient.ts`, `quality.ts`). | Dossier de transfert CAPEX qui agrège les projets ; capitalisation du REX vers les fonctions centrales | D-10 |
| Deux typologies Light / Stratégique (20 % du CA filiale), staffing et cadence de revue | ❌ | Typologie calculée + forçable, gabarit de staffing, cadence de revue et alertes de revue en retard | D-9 |
| Dashboards temps réel (maturité études, écart d’incertitude, ramp-up) | 🟡 Tableaux de bord projet/portefeuille, tendances hebdomadaires, santé. | Tableau de bord CAPEX (N1) | D-9 |
| Isolation Groupe / filiales / EPC2i, vues croisées DAF / SSE | 🟡 9 profils, droits par équipe projet (R-041), client limité à son organisation (P-10a/b). Une seule organisation. | Multi-organisation, profils filiale et groupe, portées de données | D-4 |
| Hébergement en France | ❌ non statué (I-1a ouvert ; bêta sur un serveur cloud Coolify). | Choisir un hébergeur en France ; politique IA | D-11 |
| IA : détection de dérive (planning, budget, actions de sécurité) | 🟡 Alertes à règles (R-130), « N j de dérive », analyse de comptes rendus par Claude si clé API. | Détection de tendance (projection S-curve, EAC) + alerte actions HazID/HazOp en retard ; assistant | D-12 |
| Catalogue machines proposé aux filiales | ❌ Types de machine (EMP, MEMU, SPUR…) avec phases, catégories de coûts, ITP, budget de référence (`mtypes`) ; R-053 (standard complet) attend les données. | Catalogue + configurateur, **nouvel outil** à valider | D-3 |
| Plusieurs machines par besoin | ❌ un type de machine par projet (R-185 à cadrer). | Lignes d’équipement par projet | D-3 |

## 4. Modifications proposées (lots à valider)

Tailles : S ≈ 1 semaine, M ≈ 2–3 semaines, L ≈ 1 mois, XL > 1 mois (développement assisté, hors délais de décision).

### D-1 · Niveau CAPEX (programme filiale) — L
- Nouvel objet **CAPEX** : filiale, site/usine, sponsor, chef de projet filiale, typologie, phase DIG-PRODI, budget par
  classe d’estimation, lots (génie civil, utilités, bâtiments, machines, recrutement…), risques, décisions.
- Un CAPEX contient des **lots hors EPC2i** (suivis simplement : budget, engagé, réalisé, jalons) et des **besoins machines**
  qui deviennent des projets EPC2i.
- Consolidation : budget/engagé/EAC du CAPEX = lots + projets EPC2i (EVM agrégé) ; jalons EPC2i remontés (commande, FAT,
  livraison, SAT, PV).
- Écrans : registre des CAPEX, fiche CAPEX (onglets : cadrage, avant-projet, exécution, démarrage, dossiers vivants).

### D-2 · Cycle de vie paramétrable et jalons G1/G2/G3 — M
- Les étapes deviennent un **modèle par niveau** : modèle « DIG-PRODI » (4 phases, 3 jalons) pour les CAPEX, modèle
  « EPC2i » (13 étapes actuelles, inchangées) pour les projets EPC2i. Même moteur : livrables de sortie, passage forcé
  motivé, date d’effet, historique (`stage_transitions`).
- **Jalon à comité** : critères (dont jalons HS bloquants), dossier vivant attaché, circuit de décision (D-5), décision
  Go / Go sous réserve / No-Go / Ajourné, délai cible (G1 : 2 jours).
- **Synchronisation** : G2 validé → le besoin machine peut passer en commande (projet EPC2i en Études) ; G3 exige le PV et
  les réserves soldées de chaque projet EPC2i du CAPEX.

### D-3 · Besoins machines, catalogue et multi-équipements — XL (dont un nouvel outil)
- **Besoin machine** (dans Keystone) : la filiale, depuis son CAPEX, demande une ou plusieurs machines (type, quantité,
  options, capacité, date de besoin). EPC2i qualifie (faisabilité, budget ±50 %), puis répond par devis puis offre (D-6).
  Une fois commandé, le besoin crée **un projet EPC2i** (ou s’ajoute à un projet existant).
- **Multi-équipements (R-185)** : le besoin donne la forme du projet — une liste d’équipements (type × quantité). C’est le
  cadrage demandé le 15 oct. : il faut le trancher dans ce lot (lots de planning, ITP, mise en service, BOM et coûts **par
  équipement** ; contrat, facturation, équipe et documents **communs**).
- **Catalogue machines** : fiche machine (type, variantes, options, capacité nominale, prix catalogue, délai, budget de
  référence, plan ITP, gabarit de planning, REX). Deux options :
  - **Option A — module de Keystone** : les types de machine actuels (`mtypes`) deviennent des fiches catalogue publiées aux
    filiales. Plus rapide, une seule base.
  - **Option B — nouvelle application** du groupe (comme Codex, Vigie, Cursus) : création et paramétrage des machines
    (configurateur, règles d’options, prix), catalogue exposé aux filiales ; Keystone le lit par connecteur (miroir en
    lecture, lien profond), selon les règles de frontière déjà en place.
  - Recommandation : **commencer par A** (catalogue = types de machine enrichis, lecture seule pour les filiales), et
    réserver B au configurateur (règles d’options, chiffrage automatique) si le besoin est confirmé. À valider.
- Dépend des données R-053 (standard complet par type de machine).

### D-4 · Multi-organisation et nouveaux profils — L
- **Organisations** : Groupe, filiales, EPC2i ; chaque CAPEX appartient à une filiale, chaque projet EPC2i à EPC2i (avec la
  filiale comme client interne). Portée des données par organisation ; vues croisées pour les fonctions centrales (DAF
  groupe, SSE groupe, PMO EPC2i, Dir.IG) ; le PDG voit tout.
- **Profils à ajouter** (les 9 actuels restent pour EPC2i) : Sponsor, Chef de projet filiale, CDG filiale, Dir.IG, PDG,
  DAF groupe, SSE groupe, Expert (Qualité, HSE, Exploitation), Membre COPIL GPI. Le profil « client » actuel couvre les
  clients externes ; la filiale devient un **client interne** avec ses propres écrans (pas le portail client restreint).
- Entra ID : groupes par organisation et par rôle (extension d’`ENTRA_GROUP_ROLES`) ; invités B2B si les filiales sont sur
  un autre annuaire.
- Rejoint R-179 (connexion client) et R-058 (RACI).

### D-5 · Circuits de décision, signatures et avis d’experts — L
- **Circuit de jalon** : liste ordonnée ou parallèle de signataires (visa Sponsor → COPIL GPI pour G1 ; PDG pour G2 ;
  Client Interne + Dir.IG pour G3), délais, relances du matin (mécanisme existant), décision tracée dans la piste d’audit
  (append-only, R-168).
- **Signature électronique** : signature simple intégrée (Entra + horodatage + empreinte du dossier figé) ; signature
  avancée pour G2/AFE via un prestataire qualifié français ou européen (Yousign, Docusign…) — choix et coût à valider.
- **Consultations d’experts** : le chef de projet ouvre une consultation (Qualité, HSE, DAF, Exploitation) sur un dossier
  vivant ; chaque expert rend un avis (favorable / réservé / défavorable + commentaire) avant une date ; les avis
  conditionnent le jalon. Nouveau type dans « Mes validations ».
- **Matrice de délégation** (C-4) : remplace le seuil unique CCB 50 k€ par des seuils par typologie et par objet
  (modification, avenant, tirage de provision) → Copil projet / Dir.IG / PDG. Rejoint R-051 (suppléance).

### D-6 · Business case, entonnoir de précision et modèle financier — L
- **Dossier vivant 1 — Business Case Cadrage** : formulaire standard (besoin, marché, barrières, contraintes foncières et
  réglementaires, BP préliminaire), versions, visa.
- **Classe d’estimation** sur chaque version de budget (CAPEX et projet EPC2i) : ±50 % / ±30 % / +10/−5 %, avec la
  fourchette affichée et un indicateur « écart d’incertitude » au tableau de bord ; un jalon refuse un budget de classe
  insuffisante.
- **Modèle financier CAPEX** (DAF) : CAPEX, OPEX, chiffre d’affaires attendu, VAN, TRI, retour sur investissement, AFE.
  Saisie ou import Excel du modèle DAF (à préciser : outil de la DAF existant ?).
- Côté EPC2i : devis budgétaire (APS) et offre ferme (APD) chiffrés depuis le catalogue et le REX — c’est la proposition
  **P6 « Offres & chiffrage »**, qu’il faut valider dans ce cadre.

### D-7 · Pack ingénierie et dossier réglementaire — M
- **Liste type du pack** par type d’investissement (C-9), pondérée ; chaque pièce est un livrable Codex (index Keystone)
  ou un objet Keystone (P&ID, BOM) ; % de complétude affiché et exigé au G2 (> 80 %).
- Ajouter **layout / plan de masse** et **schémas électriques (TGBT, bilan de puissance)** comme livrables typés.
- **Registre des autorisations** (ICPE, permis de construire, PLU, ATEX) : dossier, autorité, dépôt, échéance, statut,
  document Codex ; alerte d’échéance.

### D-8 · Jalons SSE HS 2–6 et PSSR — M (avec Vigie)
- **Table des jalons HS** (C-3) avec leur effet bloquant : HS 2 HazID avant G1, HS 3 HazOp/AMDEC avant G2, HS 4 contrôle
  chantier, PSSR (HS 4+5, RSPDI) avant introduction de produit, HS 6 ASPD avant G3.
- **Propriété** : les études et actions de sécurité sont des enregistrements **QHSE → Vigie** (comme les NCR et le HSE
  chantier). Keystone affiche l’état (miroir), bloque les jalons, alerte sur les actions en retard, ouvre Vigie par lien
  profond. À confirmer : Vigie sait-il porter HazID/HazOp/PSSR ? Sinon, à spécifier côté Vigie (Keystone ne modifie pas
  les applications sœurs).
- Le « Go chantier » actuel (5 conditions) et la mise en service gagnent la condition « PSSR obtenu ».

### D-9 · Typologie, gouvernance et tableau de bord CAPEX — M
- **Typologie** calculée (CAPEX / CA de référence de la filiale > 20 % → Stratégique), forçable avec motif.
- **Gabarit de staffing** par typologie (Light : chef de projet filiale + Co-DIG ; Stratégique : + CDG + PMO EPC2i) et
  contrôle « équipe incomplète ».
- **Cadence de revue** (trimestrielle / mensuelle) : séries de réunions Copil créées d’office, alerte « revue en retard »,
  rapport d’avancement « Copil » (R-131) au niveau CAPEX.
- **Tableau de bord CAPEX** : maturité des études (% pack), écart d’incertitude, S-curve consolidée, jalons G et HS,
  avenants/MoC, montée en puissance ; portefeuille des CAPEX par filiale et par zone (Directeurs de Zone).

### D-10 · Montée en puissance et dossier de transfert — M
- **Ramp-up** : saisie journalière (ou import depuis la supervision/MES de l’usine, à préciser) de la production, de la
  capacité nominale, du TRS/OEE et du taux de rebuts ; courbe vers la capacité nominale ; critère « 30 jours continus » et
  limite « 6 mois après le début de la MES ».
- **Dossier vivant 3 — Transfert & REX** : PV de transfert d’actif unique (contre-signature Client Interne + Dir.IG),
  quitus PSSR (Vigie), réserves soldées (punch lists des projets EPC2i), clôture comptable (Sage, R-182), REX capitalisé et
  diffusé aux fonctions centrales (le REX projet existe déjà ; à étendre au niveau CAPEX avec une diffusion).
- Lien parc installé : la machine mise en service porte sa capacité nominale et son TRS de réception.

### D-11 · Hébergement en France et conformité — S (décision) + M (mise en œuvre)
- Trancher **I-1a** : hébergeur en France (OVHcloud, Scaleway, Outscale… ou serveur interne, ou Azure France Central),
  sauvegardes en France ; le kit Coolify actuel convient à un serveur loué en France.
- **IA** : l’analyse par Claude envoie des données à un service d’IA ; pour respecter la souveraineté, utiliser un
  fournisseur offrant une région UE/France (à vérifier au moment du choix) ou garder l’analyse locale par règles (déjà
  disponible). Rejoint R-173 (RGPD).

### D-12 · Aide à la décision et IA — M
- **Dérive planning/budget** : projection de la courbe en S et de l’EAC (tendance des SPI/CPI sur les instantanés
  hebdomadaires existants), alerte quand la date ou le coût projetés franchissent un seuil.
- **Actions de sécurité** : alerte sur les actions HazID/HazOp en retard (données Vigie).
- **Assistant** : résumé d’un dossier vivant avant un jalon, questions sur le CAPEX ; uniquement avec un fournisseur d’IA
  conforme à D-11.

## 5. Ordre proposé (aligné sur le §5 du CDC)

| Période | Lots | Résultat |
|---|---|---|
| Mois 1 | Décisions (§6), compléments du CDC (§1.3), D-11 décision, D-4 (organisations et profils) | Les filiales peuvent se connecter et ne voient que leur périmètre |
| Mois 1–2 | D-1, D-2, D-5 (circuits, signature simple) | CAPEX, phases et jalons G1/G2/G3 dématérialisés |
| Mois 2–3 | D-6, D-7, D-3 (besoin machine + catalogue option A + multi-équipements) | Dossiers vivants 1 et 2, demande machine depuis le CAPEX |
| Mois 3–4 | D-8 (avec Vigie), D-9, pilote sur 1–2 CAPEX | Jalons HS, tableaux de bord, typologie |
| Après pilote | D-10, D-12, signature avancée, option B du catalogue si confirmée | Ramp-up, transfert, IA |

## 6. Décisions à prendre par le responsable produit

1. **Périmètre** : Keystone devient-il l’outil du CAPEX des filiales (niveau N1) en plus de celui d’EPC2i ? (Hypothèse de
   cette analyse : oui, d’après la note du 21 oct.)
2. **Catalogue machines** : option A (module Keystone) ou option B (nouvelle application) — et qui le maintient (bureau
   d’études EPC2i ?).
3. **Multi-équipements (R-185)** : un besoin de plusieurs machines = un projet EPC2i à plusieurs équipements, ou un projet
   par machine ?
4. **Sécurité de procédé (HazID, HazOp, PSSR)** : portée par Vigie (recommandé, conforme aux frontières) ou par Keystone ?
5. **Signature électronique** : niveau par document et prestataire (C-7).
6. **Matrice de délégation** et **RACI** (C-4, C-6) : qui les fournit, sous quel délai.
7. **Hébergement en France** (I-1a) et politique d’IA (C-13).
8. **Ramp-up** : saisie manuelle par la filiale, ou import depuis les systèmes de l’usine ?
9. **Données de référence** : CA des filiales (typologie), liste type du pack ingénierie, table des jalons HS, standard par
   type de machine (R-053).

## 7. Ce qui ne change pas

Le projet EPC2i garde ses 13 étapes, ses baselines, son EVM, ses achats, son ingénierie, son ITP, sa mise en service, sa
garantie et ses connecteurs (Codex, Vigie, Cursus). DIG-PRODI s’ajoute **au-dessus** (CAPEX filiale) et **à côté** (besoin
machine, catalogue) ; les jalons du CAPEX se nourrissent des données que Keystone produit déjà.
