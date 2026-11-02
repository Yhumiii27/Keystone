# Livraison 9 — demande d’Arche K-14 : démonstration alignée

Statut : construit sur la branche `k14-demo` (depuis `5d114c2`, « Merge pull request #63 ») le 2 nov. 2026. Entrée « [2026-10-30]
Arche → Keystone — Démo alignée : CAPEX et besoin manquants dans la simulation d’Arche (K-14) » de `REQUESTS.md`, validée par le
responsable produit le 2 nov. 2026. Valeurs reprises du dépôt Arche (lecture seule, `main` `eb383ea`) :
`src/server/db/seed/demo.ts` (`DEMO_CAPEX`, `seedNeeds`, `seedStartup`), `src/server/integrations/keystone/simulation.ts`
(`simulatedProjectCode`, `simulatedMachineNumber`), `keystone-demo.ts`, `docs/CONTRATS.md` § 3.

**Jeu de démonstration et simulation seulement** : aucune migration, aucune vue `pub_` créée ni modifiée (règle M-18), seed de
production inchangé.

## 1. Ce qui change, point par point

| Point de K-14 | Fait | Où |
|---|---|---|
| 1. CAPEX manquants | `CPX-APM-2025-01` (« Ageing oven and finishing line », APM, Kénitra plant, phase `demarrage`, G1 20/05/2025, G2 15/09/2025, début de MES 01/07/2026), `CPX-SAI-2026-02` (« Aseptic packaging line », SAI, Kaolack plant, phase `cadrage`, aucune porte), `CPX-SAI-2026-03` (« Solar power plant for the Thiès site », SAI, Thiès site, phase `avant_projet`, G1 24/09/2026) ; colonne `devise` (AR-039, en fin de `pub_capex` depuis le 29 oct.) ajoutée aux cinq lignes | `src/server/integrations/capex/simulation.ts` |
| 2. Besoin `CPX-APM-2025-01/B01` | besoin libre « Ageing oven 2 × 6 m », quantité 1, capacité 2 t/h, besoin au 01/07/2026, soumis le 02/06/2025, statut `ordered`, commandé le 15/09/2025 | idem |
| 3. Projet livré relié au besoin | **APM-008** (nouveau projet de démonstration, aucun projet existant ne convenait — voir § 2), en garantie ; `pub_projets` : `capex_code = 'CPX-APM-2025-01'`, `besoin_ref = 'CPX-APM-2025-01/B01'`, client interne Atlas Process Maroc (`filiale_code = 'APM'`) ; `pub_parc_machines` : machine **MCH-045** ; réponse **RB-006** (offre ferme E10 acceptée, projet APM-008) | `src/server/db/seed/capex-k14.ts` |
| 4. SAT de RCF-019 | plan de SAT du système « Automation » le 16 nov. 2026 (`sat_plans`) : `pub_jalons_projets` `sat`.`prevu_le` = 2026-11-16 | idem |
| 5. RCF-019 plus vraisemblable | **non fait** — voir § 3 | — |

### Projet APM-008 (point 3)

Projet minimal, comme les projets clos du prototype (ALP-021, QFR-015…) : ligne du registre, site, ligne d’équipement, historique
des phases, une machine du parc, grille de mise en service ; ni planning, ni budget détaillé, ni équipe.

- Registre : `APM-008`, numéro `#008`, code analytique `APM001`, nom « Ageing oven and finishing line — Ageing oven 2 × 6 m » (le nom
  que donne la création à la commande, `needProjectName`), client **Atlas Process Maroc** enregistré comme client interne (code
  `APM`, filiale `APM` ; créé s’il n’existe pas), chef de projet C. Moreau, DAS 1, type AUTRE, phase **Garantie**, Sep 2025 →
  Jun 2026, budget 663 k€, réel 641 k€, avancement 100 %. Le numéro `#008` est sous ceux du prototype : le prochain projet de
  l’assistant reste `#045`.
- EQ-01 : AUTRE × 1, libellé « Ageing oven 2 × 6 m », 2 t/h, `besoin_ref` du besoin.
- Site : Kénitra (Maroc).
- Phases (auto) : Initiative et Études le 15/09/2025 (commande), Approvisionnements 14/11/2025, Fabrication 08/12/2025, FAT
  16/03/2026, Expédition 13/04/2026, Chantier 11/05/2026, MES & SAT 25/05/2026, Garantie 29/06/2026.
- Machine **MCH-045** « Ageing oven 2 × 6 m », type AUTRE, Atlas Process Maroc, « Kénitra · finishing hall », livrée le
  11/05/2026, garantie jusqu’au 10/05/2028 (convention du modèle : livraison = début de garantie, deux ans), sur EQ-01.
  **Écart avec Arche** : la simulation d’Arche donne à la machine de sa ligne de ramp-up « Ageing oven » le numéro
  `simulatedMachineNumber(simulatedProjectCode('CPX-APM-2025-01/B01'), 0)` = **MCH-443**, écrit tel quel par son seed
  (`seedStartup`). Keystone ne le reprend pas : « Ajouter une machine » numérote après le plus grand numéro existant (plancher
  MCH-049), et MCH-443 aurait fait passer les machines ajoutées de MCH-050 à MCH-444 (comportement visible et une vingtaine de
  tests). MCH-045 est libre et sous le plancher. Côté Arche, la ligne de ramp-up devra porter `MCH-045` quand Arche reprendra
  APM-008 dans `keystone-demo.ts` (ce qu’il doit faire de toute façon pour le code projet, voir § 5).
- Mise en service : un système « General » (gabarit AUTRE), cinq étapes faites (achèvement mécanique 22/05, pré-mise en service
  29/05, mise en service 12/06, **SAT 19/06/2026**, remise 29/06/2026).
- Réponse **RB-006** : offre ferme E10, 663 k€ (fourchette 629,9–729,3), 26 semaines, valable jusqu’au 29/11/2025,
  `OFF-CPX-APM-2025-01-001`, acceptée, remise le 01/08/2025 — le prix et la date que la simulation d’Arche répond pour ce besoin
  (650 k€ × 1,02 ; offre ferme à soumission + 60 jours).
- Ce que publie `pub_jalons_projets` pour APM-008 : commande 15/09/2025, fin d’études 14/11/2025, FAT et expédition 13/04/2026
  (la vue date la FAT réelle par l’entrée en expédition), arrivée sur site 11/05/2026, SAT prévue et réelle 19/06/2026,
  fin de garantie prévue 10/05/2028 ; PV de réception nul (aucun livrable « réception client » : non ajouté, pour ne pas toucher
  les registres de livrables comparés au prototype).

### Bases de démonstration existantes

Rattrapages uniques dans `seedIfEmpty` (`src/server/db/seed/index.ts`, après celui de R-190 dont la condition veut qu’aucun client
ne soit encore interne) :

- `demoK14ProjectToBackfill` : aucun projet ne livre le besoin et le code, le numéro, le code analytique et le numéro de machine
  sont libres → miroir d’Arche remplacé par la source simulée (comme une lecture réussie du connecteur), puis APM-008 et sa
  réponse (numéro suivant si RB-006 est déjà pris) ;
- `demoK14RcfSatToBackfill` : RCF-019 n’a ni plan de SAT ni grille de mise en service → plan de SAT.

Une base créée avant R-187 reçoit tout par le rattrapage R-187 (`seedDemoCapexNeeds` appelle maintenant `seedDemoK14`).

## 2. Décisions prises sans demander

- **Nouveau projet plutôt qu’un projet existant** : les projets livrés ou en garantie de la démonstration (ALP-021 balisage
  d’aéroport à Lyon, QFR-015 défenses de quai au Havre, DRR-009 toiture de dépôt, TTR-017 pylône télécom à Abidjan, HRM-011 SIRH)
  n’ont rien d’un four de vieillissement à Kénitra, et leurs machines sont des ponts et portiques du prototype.
- Code `APM-008` (code de la filiale + numéro, comme la création à la commande) plutôt que le code simulé d’Arche `APM-25011`
  (pas au format de Keystone : un numéro `#25011` ferait passer le prochain projet de l’assistant à `#25012`).
- Machine `MCH-045` plutôt que `MCH-443` (§ 1) : la numérotation « Ajouter une machine » de la démonstration reste MCH-050…
- Client = la filiale, client interne (R-190), comme le ferait la création à la commande.
- Chef de projet C. Moreau (pas une persona : les vues « mes projets » des personas ne changent pas).
- Une seule réponse (l’offre ferme acceptée) au lieu des quatre que génère la simulation d’Arche (qualification, E50, E30, E10) ;
  numéro RB-006 bien qu’antérieure à RB-001 (les numéros RB-001 à RB-005 sont déjà ceux d’Arche).
- SAT de RCF-019 au 16 nov. 2026, sur le système « Automation » du gabarit MEMU : arrivée sur site le 7 sept., fin prévue
  27 déc. 2026, « mise en service sur site en 4 semaines » d’après la fiche MEMU-16.

## 3. Point 5 non fait : RCF-019 reste « Clinique Pasteur Lyon Fit-out »

RCF-019 est l’un des six projets détaillés du prototype (`projectData`) : son nom, son client « Health trust », Lyon et ses données
(planning, budget, livrables D-110…, risques, équipe) sont comparés au prototype par une quarantaine de fichiers de tests dorés
(`delivery2/3/4/5.test.ts`, `home`, `portfolio`, `plan`, `cost-control`, `risks-screen`, `register`, rendu des pages…), et son nom
apparaît dans les textes du prototype (activité, notifications, audit). Le renommer touche des centaines de valeurs affichées : ce
n’est pas un changement « propre » de quelques tests annotés K-14. Proposition au responsable produit : soit garder RCF-019 tel quel
(Arche affiche le code et les jalons, pas le client), soit décider d’un renommage dans un lot à part qui assume la mise à jour des
tests dorés (nom, client, ville, pays, intitulés des livrables).

## 4. Tests

- `src/server/integrations/capex/connector.test.ts` : lecture simulée et lecture du serveur avec les cinq CAPEX et six besoins.
- `src/server/db/seed/capex-k14.test.ts` (nouveau) : sur la base de démonstration, `pub_projets` (APM-008 : CAPEX, besoin, client
  interne), `pub_parc_machines` (MCH-045), `pub_reponses_besoins` (RB-006 → APM-008), `pub_jalons_projets` (SAT de RCF-019 et
  d’APM-008), et le rattrapage d’une base sans K-14 (une fois).
- **Comparaisons au prototype** : `src/test/k14.ts` (`withoutK14Demo`) retire APM-008, sa machine, sa réponse et son client de la
  base de test ; appelé (commentaire « K-14 ») par les tests dorés qui comptent ou listent les projets, le parc ou les types de
  machine : `worldmap/render`, `pfplan.render` / `.scenarios` / `.window`, `projects/register` / `register-render`, `aftersales/model`
  / `page` / `render` / `actions`, `admin/model`, `dal/delivery3`, `delivery5`, `delivery5-writes`, `shell`, `warranty-in-force`,
  `export/export`, `db/db.test` ; par `scripts/db-check.ts` avant ses sections « Projects » et suivantes ; par les tests des
  migrations R-185 (`migration-equipment`, `migration-equipment-links` : une base d’avant R-185 n’a pas APM-008) et par
  `contract/internal-client-actions` (il donne lui-même le code APM au Port authority et enregistre Atlas Process Maroc).
- **Attentes mises à jour** (données de Keystone, pas du prototype) : `capex/connector.test.ts` (5 CAPEX, 6 besoins, 6 réponses),
  `capex-needs/actions.test.ts` (RB-006 dans la vue ; les réponses créées par le test deviennent RB-007 à RB-010),
  `contract/equipment-actions.test.ts` (APM-008 : AUTRE), `db/share-views.test.ts` (APM-008 seul projet à client interne,
  `pub_clients` : APM et SAI), `scripts/db-check.ts` (comptes : +1 système et +5 étapes de mise en service, +1 plan de SAT,
  +1 machine ; réponses, clients internes, D21).

## 5. Ce qui reste côté Arche (pour information)

Arche peut maintenant reprendre APM-008 dans `keystone-demo.ts` (ajouter `CPX-APM-2025-01/B01` à `KEYSTONE_DEMO_NEEDS`, exporter
RB-006, APM-008, ses jalons et la machine MCH-045 au lieu de MCH-443) et la SAT de RCF-019 ; sans cela sa simulation continue de générer le projet `APM-25011`,
dont la machine porte le numéro MCH-443 (MCH-045 chez Keystone).
