# Requêtes inter-applications
Format d'une entrée :
## [YYYY-MM-DD] <app demandeuse> → <cette app> — <titre court>
- Statut : OUVERTE | ACCEPTÉE | REFUSÉE | FAITE
- Demande : (quoi)
- Justification : (pourquoi, impact sur l'app demandeuse)
- Détails techniques : (tables, champs, types, endpoints, exemples)
- Validé par Guillaume le : (date)

## [2026-10-22] Crucible → Keystone — Publier les jalons des projets (vue pub_jalons)
- Statut : FAITE
- Demande : publier une vue `keystone.pub_jalons` des jalons des projets, avec la date de fin de l'activité liée quand elle est datée.
- Justification : Crucible (planification des moyens d'essais R&D partagés, dépôt Yhumiii27/Crucible) anticipe les besoins d'essais à partir des échéances des projets (rétro-planification, plan de charge prévisionnel, livraison 3 de Crucible). Les jalons existent dans Keystone mais ne sont pas publiés. Sans la vue, les jalons des projets présents dans Keystone sont ressaisis à la main dans Crucible (double saisie, risque d'écart). Matrix a déjà prévu le droit de lecture (`infra/postgres/partage/90-droits.sql` : `keystone.pub_jalons` → `crucible_app`).
- Détails techniques : vue `pub_jalons` (schéma `keystone`, `WITH (security_barrier)`, contrat : colonnes ajoutées en fin seulement) sur `milestones` jointe à `projects` et, si `activity_id` est posé, à `activities`. Colonnes : `projet_code` (text, `projects.code`), `jalon_id` (uuid), `nom` (text), `position` (integer), `mois_reference` (`baseline_month`), `mois_prevu` (`forecast_month`), `statut` (text), `activite_code` (text, null si aucune activité liée), `date_fin_activite` (date, `activities.finish_date`, null si non datée), `maj_le` (timestamptz). Lecteur : `crucible_app` (droit accordé par Matrix). Crucible lit par `projet_code` et `maj_le`.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Keystone — Catalogue machines et réponses aux besoins des filiales (R-186, R-187, R-188, R-185)
- Statut : FAITE — K-01 (pub_catalogue_machines, R-186), K-03 (classe d’estimation, R-188), K-02 et K-10 (connecteur capex, corbeille, pub_reponses_besoins, projet à la commande, R-187) ; côté Arche : publier arche.pub_capex et arche.pub_besoins_machines
- Demande : (K-01) publier `keystone.pub_catalogue_machines` ; (K-02) lire `arche.pub_capex` et `arche.pub_besoins_machines` (corbeille « Besoins des filiales » côté EPC2i, liens profonds vers `<ARCHE_URL>/capex/<code>` et `…/machines`) et publier `keystone.pub_reponses_besoins` ; (K-03) classe d'estimation `E50` / `E30` / `E10` et fourchette sur les réponses, une offre ferme est `E10` ; (K-10) à la commande d'un besoin (`statut = ordered` dans `arche.pub_besoins_machines`), créer le projet EPC2i — ou ajouter l'équipement à un projet existant (multi-équipements, R-185) — et publier son code dans `pub_reponses_besoins.projet_code`.
- Justification : Arche (pilotage des CAPEX des filiales, dépôt Yhumiii27/Arche, livraison 4 fusionnée le 22 oct. 2026) fait choisir les machines dans le catalogue EPC2i et calcule le critère du G2 « offre ferme EPC2i pour chaque besoin soumis » à partir des réponses. Sans ces vues, Arche ne fonctionne qu'en simulation sur son jeu de démonstration ; en production le catalogue est vide et le critère G2 doit être forcé avec motif à chaque passage.
- Détails techniques : vues dans le schéma `keystone`, `WITH (security_barrier)`, `COMMENT ON VIEW` nommant les lecteurs, colonnes ajoutées en fin seulement ; lecteur `arche_app` (droit accordé par Matrix). Arche lit chaque vue en entier (`select to_jsonb(v) from keystone.<vue> v`) toutes les 15 min ; clés communes : code CAPEX `CPX-APM-2026-01`, référence de besoin `CPX-APM-2026-01/B01`, code catalogue + version.
  - `pub_catalogue_machines` (une ligne par fiche et version) : `code` text (`EMP-40T`), `version` int (un besoin garde la version choisie), `type_code` text, `type_libelle` text, `variante` text, `libelle` text, `description` text, `options` jsonb `[{code, libelle, prix_indicatif_keur}]`, `capacite_nominale` numeric, `unite_capacite` text, `prix_indicatif_keur` numeric (classe E50), `delai_type_semaines` int, `statut` text (`publie` / `retire`), `maj_le` timestamptz.
  - `pub_reponses_besoins` (une ligne par réponse, la plus récente fait foi) : `besoin_ref` text, `capex_code` text, `numero` text, `nature` text (`qualification` / `indicatif` / `devis` / `offre_ferme`), `qualification` text (`faisable` / `a_etudier` / `refuse`), `motif` text, `classe_estimation` text (`E50` / `E30` / `E10`), `montant_central_keur`, `montant_bas_keur`, `montant_haut_keur` numeric, `delai_semaines` int, `valide_jusqu_au` date, `document_ref` text (référence Codex du devis ou de l'offre), `projet_code` text (projet créé à la commande, sinon null), `statut` text (`en_cours` / `remise` / `acceptee` / `caduque`), `repondu_le` timestamptz, `maj_le` timestamptz.
  - Ce qu'Arche publie déjà pour Keystone : `arche.pub_capex` et `arche.pub_besoins_machines` (`besoin_ref`, `capex_code`, `ligne`, `catalogue_code`, `catalogue_version`, `libelle_libre`, `quantite`, `options`, `capacite_visee`, `unite_capacite`, `date_besoin`, `site`, `statut` submitted / withdrawn / ordered, `commentaire`, `soumis_le`, `commande_le`, `maj_le` ; brouillons non publiés). Contrats complets : `docs/CONTRATS.md` du dépôt Arche.
  - Questions liées côté Keystone : AC-4 (qui tient le catalogue), AC-5 (projets multi-équipements).
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Keystone — Rattacher les projets EPC2i au CAPEX dans pub_projets (R-190)
- Statut : FAITE — capex_code et besoin_ref (R-190, 23/10), client interne et code de filiale : client_interne et filiale_code en fin de pub_projets (R-190, 24/10)
- Demande : (K-05) ajouter en fin de vue `pub_projets` les colonnes `capex_code` et `besoin_ref` ; admettre qu'une filiale du groupe soit le client d'un projet (client interne).
- Justification : Arche affiche, sur chaque CAPEX, les projets EPC2i qui livrent ses machines. Sans ces colonnes, Arche ne retrouve un projet que par le `projet_code` d'une réponse acceptée (`pub_reponses_besoins`) : un projet ouvert hors de ce circuit reste invisible dans Arche.
- Détails techniques : `capex_code` text (`CPX-SAI-2026-01`, null pour un projet sans CAPEX), `besoin_ref` text (premier besoin à l'origine du projet, `CPX-SAI-2026-01/B01`), ajoutées après `maj_le` (contrat D02 v1 inchangé pour les lecteurs actuels). Arche lit `code`, `nom`, `phase_code`, `phase`, `chef_projet_nom`, `capex_code`, `besoin_ref`, `maj_le`.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Keystone — Vues de suivi des projets pour les jalons CAPEX (R-189, R-191)
- Statut : FAITE — pub_jalons_projets, pub_avancement_projets, pub_avenants, pub_reserves, pub_livrables + 3 colonnes ; dates BL1 des jalons (reference_le, 25/10), pub_pack_ingenierie (R-191, liste type provisoire, 25/10)
- Demande : (K-04) publier `pub_jalons_projets`, `pub_avancement_projets` (côté vente seulement : aucun coût interne, taux ni marge), `pub_avenants`, `pub_reserves` ; (K-06) ajouter en fin de `pub_livrables` les colonnes `type`, `accepte_le`, `maj_le` ; (K-08) publier `pub_pack_ingenierie`.
- Justification : trois critères des jalons d'Arche en dépendent — K3 « SAT EPC2i planifiés », G3 « réserves A/B levées et PV de réception acceptés », G2 « pack d'ingénierie au-dessus du seuil » — ainsi que le suivi des projets EPC2i sur la page du CAPEX (livraisons 5 et 6 d'Arche). Sans ces vues, ces critères sont forcés avec motif et la page n'affiche aucun suivi en production.
- Détails techniques : schéma `keystone`, `WITH (security_barrier)`, lecteur `arche_app` ; Arche filtre par `projet_code`.
  - `pub_jalons_projets` (une ligne par projet et jalon) : `projet_code` text, `jalon_code` text (`commande`, `fin_etudes`, `fat`, `expedition`, `arrivee_site`, `sat`, `pv_reception`, `fin_garantie`), `prevu_le` date, `reference_le` date (baseline BL1), `reel_le` date (null si à venir), `maj_le` timestamptz. À rapprocher de la demande de Crucible ci-dessus (`pub_jalons`) : une seule vue peut servir les deux si elle porte les colonnes des deux contrats.
  - `pub_avancement_projets` (une ligne par projet) : `projet_code` text, `date_situation` date, `avancement_physique_pct` numeric, `spi` numeric, `fin_prevue_le` date, `montant_contrat_keur` numeric (prix de vente initial), `montant_avenants_keur` numeric (avenants signés), `facture_keur` numeric (facturé à la filiale), `maj_le` timestamptz.
  - `pub_avenants` : `projet_code`, `numero`, `objet`, `montant_keur`, `delai_jours`, `statut` (`propose` / `signe` / `refuse`), `signe_le`, `maj_le`.
  - `pub_reserves` : `projet_code`, `numero`, `categorie` (`A` / `B` / `C`), `origine` (`itp` / `site`), `statut` (`open` / `in_progress` / `closed`), `responsable` (`client` / `keystone`), `ouverte_le`, `levee_le`, `maj_le`.
  - `pub_livrables` (fin de vue) : `type` text (`client_acceptance` = PV de réception), `accepte_le` date, `maj_le` timestamptz.
  - `pub_pack_ingenierie` (une ligne par projet et famille) : `projet_code`, `famille` (`pid`, `bom`, `layout`, `electrique`, `analyse_fonctionnelle`), `attendues` int, `validees` int, `poids` numeric, `pct_pondere` numeric (même valeur sur chaque ligne du projet), `maj_le`.
  - Question liée : AC-2 (aucun coût interne publié).
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Keystone — Parc installé, montée en puissance, lecture incrémentale, socle partagé (R-193, R-194)
- Statut : ACCEPTÉE — fait : K-07, K-11 ; reste : K-09 (attend arche.pub_rampup), K-12 (socle partagé)
- Demande : (K-07) ajouter en fin de `pub_parc_machines` les colonnes `type_machine_code`, `livree_le`, `maj_le` ; (K-09) lire `arche.pub_rampup` au parc installé (capacité atteinte, TRS, rebuts de réception) ; (K-11) indexer `maj_le` (ou sa colonne source) des vues lues par Arche ; (K-12) publier le socle partagé `@epc2i/socle` qu'Arche consommera à la place de ses copies.
- Justification : montée en puissance par machine (livraison 6 d'Arche), lecture plus légère, moins de code copié. Sans ces points, aucun blocage avant la livraison 6 d'Arche : Arche continue de copier les vues en entier et garde sa copie du socle.
- Détails techniques : `pub_parc_machines` : `type_machine_code` text, `livree_le` date, `maj_le` timestamptz en fin de vue (Arche lit `DISTINCT number, name, project_code, site_text` et ces colonnes). `arche.pub_rampup` (publiée par Arche en livraison 6) : `machine_numero`, `capex_code`, `ligne_production`, `debut_mes_le`, `capacite_nominale`… (contrat dans `docs/CONTRATS.md` d'Arche). Liste des modules du socle copiés par Arche : `docs/SOCLE.md` d'Arche.
- Validé par Guillaume le : 2026-10-22

## [2026-10-23] Matrix → Keystone — Publier les leçons apprises des projets (vue pub_rex, D22)
- Statut : FAITE — vue pub_rex publiée (leçons validées ou appliquées, migrations 0053-0054, 25/10/2026) ; côté Matrix : recopier la vue et rejouer 96-matrix-rex-unifie.sql
- Demande : publier une vue `keystone.pub_rex` des leçons apprises des projets (`lessons_learned`), au contrat commun du REX fixé par Matrix (le même pour `arche.pub_rex`).
- Justification : décision D22 de Matrix (22/10/2026, option A « Deux registres, une vue commune ») : Keystone garde le REX des projets, Arche celui des CAPEX, et Matrix les réunit (`UNION ALL`, comme le journal unifié). Le REX d'un CAPEX porte souvent sur la machine livrée par EPC2i. Sans cette vue, la vue commune de Matrix ne contient que le REX d'Arche ; rien n'est bloqué ailleurs.
- Détails techniques : colonnes, dans cet ordre et de type `text` sauf indication : `ref_source` (identifiant de la ligne dans l'outil), `outil` (`keystone` ou `arche`), `projet_code`, `capex_code`, `numero`, `categorie`, `titre`, `constat`, `impact`, `recommandation`, `portee`, `statut`, `auteur`, `cree_le` (timestamptz), `maj_le` (timestamptz). Colonnes propres à un outil : en fin de vue seulement. Vue `WITH (security_barrier)`, lecteur `matrix_app` (droit déjà prévu dans `infra/postgres/partage/90-droits.sql` de Matrix) ; une vue `pub_` est un contrat : aucune colonne retirée ni renommée. Correspondance proposée : `ref_source` = `'lessons_learned:' || id`, `outil` = `'keystone'`, `projet_code` = `projects.code`, `capex_code` = null (ou le CAPEX du projet quand Keystone le connaîtra, R-190), `numero` = `number`, `categorie` = `theme`, `titre` = au choix de Keystone (la table n'a pas de titre ; par exemple `number || ' · ' || theme`), `constat` = `what_happened`, `impact` = `impact`, `recommandation` = `recommendation`, `portee` = `applies_to`, `statut` = `status`, `auteur` = `raised_by_name`, `cree_le` = `created_at`, `maj_le` = `updated_at`. Données personnelles : le nom de l'auteur seulement, comme `pub_journal`.
- Validé par Guillaume le : 2026-10-23

## [2026-10-23] Matrix → Keystone — Relier les clients filiales au code de la filiale de Matrix (D21)
- Statut : FAITE — miroir de matrix.pub_filiales (liste des filiales de la carte « Client »), code3 d’un client interne = code de la filiale, code réservé aux filiales, filiale_code en fin de pub_clients (0053-0054, 25/10/2026)
- Demande : quand un client est une filiale du groupe, `clients.code3` prend le code de la filiale publié par Matrix (`matrix.pub_filiales`, choisi dans une liste, en lecture seule) ; les clients extérieurs au groupe gardent un `code3` libre. Ajouter en fin de `keystone.pub_clients` une colonne `filiale_code` (text, null pour un client extérieur).
- Justification : décision D21 de Matrix (22/10/2026, option A) : Matrix fait foi pour les zones et les filiales du groupe. La filiale est à la fois le client des projets EPC2i (Keystone) et l'entité d'un CAPEX (Arche, contrôle R-190) ; sans code commun, la même filiale existe deux fois sous deux codes possibles. Sans ce lien, le rapprochement Keystone ↔ Arche reste manuel. Pas urgent : la liste réelle des filiales n'est pas encore saisie dans Matrix.
- Détails techniques : `matrix.pub_filiales` (lecteur `keystone_app`, droit déjà posé) : `code` (trois majuscules, `^[A-Z]{3}$`), `nom`, `zone_code`, `pays_iso2`, `devise`, `actif`. Contrôle : un `code3` égal au code d'une filiale active est réservé à cette filiale. Colonne `pub_clients.filiale_code` ajoutée en fin de vue (contrat `pub_`).
- Validé par Guillaume le : 2026-10-23

## [2026-10-30] Arche → Keystone — Démo alignée : CAPEX et besoin manquants dans la simulation d'Arche (K-14)
- Statut : FAITE pour les points 1 à 4 (02/11/2026, `docs/delivery-9/notes-k14-demo.md`) : trois CAPEX et le besoin `CPX-APM-2025-01/B01` dans la simulation (colonne `devise` comprise) ; projet de démonstration **APM-008** en garantie (pas `APM-25011`), client interne Atlas Process Maroc, `capex_code` / `besoin_ref` publiés, machine **MCH-045** (pas MCH-443) dans `pub_parc_machines`, réponse RB-006 (offre ferme acceptée) ; SAT de RCF-019 prévue le 16/11/2026 dans `pub_jalons_projets`. Point 5 non fait : RCF-019 gardé tel quel (responsable produit, questionnaire de suivi S-01, 04/11/2026). Côté Arche : reprendre APM-008, MCH-045 et RB-006 dans `keystone-demo.ts` — demandé à Arche le 04/11/2026 (entrée de son `REQUESTS.md`, Yhumiii27/Arche#51)
- Demande : dans la simulation d'Arche de Keystone (`src/server/integrations/capex/simulation.ts`) :
  1. ajouter les CAPEX de démo d'Arche qui lui manquent : `CPX-APM-2025-01` (Four de vieillissement et ligne de finition, APM, Kénitra, phase 4 démarrage, mise en service le 01/07/2026), `CPX-SAI-2026-02` (Ligne de conditionnement aseptique, SAI, Kaolack, phase 1 cadrage) et `CPX-SAI-2026-03` (Centrale solaire du site de Thiès, SAI, phase 2 avant-projet) ;
  2. ajouter le besoin `CPX-APM-2025-01/B01` (libellé libre « Ageing oven 2 × 6 m », sans fiche catalogue, quantité 1, statut `ordered`, commandé le 15/09/2025) ;
  3. relier à ce besoin un projet de démo livré ou en garantie, dont le parc installé donne les machines des lignes de ramp-up d'Arche ;
  4. planifier la SAT de RCF-019 (le critère K3 de `CPX-SAI-2026-01` dans Arche la lit) ;
  5. si possible, remplacer RCF-019 (aménagement d'une clinique à Lyon) par un projet plus vraisemblable pour l'unité mobile `MEMU-16` d'une usine de tomates au Sénégal.
- Justification : la démo du pilote d'Arche montre les deux applications côte à côte. Arche reprend déjà les lignes réelles de la démo de Keystone (catalogue EMP-40T / MEMU-16 / SPUR-2X, réponses RB-001 à RB-005, projet RCF-019 ; `src/server/integrations/keystone/keystone-demo.ts` du dépôt Arche). Sans ces ajouts, trois CAPEX de la démo d'Arche n'apparaissent pas dans la corbeille « Besoins des filiales » de Keystone, le four de CPX-APM-2025-01 n'a ni projet ni parc installé (ses lignes de ramp-up restent sans machines) et le critère K3 de CPX-SAI-2026-01 ne peut pas être montré rempli.
- Détails techniques : uniquement le jeu de démonstration / la simulation, aucun changement de contrat des vues `pub_`. Les champs des CAPEX et du besoin suivent les colonnes de `arche.pub_capex` et `arche.pub_besoins_machines` déjà simulées (`docs/CONTRATS.md` du dépôt Arche ; valeurs exactes dans `src/server/db/seed/demo.ts` d'Arche, `DEMO_CAPEX`). Le projet relié au besoin publie `besoin_ref = 'CPX-APM-2025-01/B01'` et `capex_code = 'CPX-APM-2025-01'` dans `pub_projets`, et son parc installé dans `pub_parc_machines` (R-193). La SAT de RCF-019 est un jalon daté dans `pub_jalons_projets` (R-189).

## [2026-10-30] Matrix → Keystone — M-17 : accès entre outils décidés par Matrix (plus de copie de vue, écritures par API ou fonction `pub_`)
- Statut : FAITE (02/11/2026 : règles reprises dans `CLAUDE.md` § « Exchanges with the other tools » ; inventaire dans `docs/delivery-9/notes-m17-m18.md` : lectures par vues `pub_` seulement (`matrix.pub_filiales`, `matrix.pub_organigramme`, `arche.pub_capex`, `arche.pub_besoins_machines`), écritures par API (Vigie, Cursus, Codex, déclaration Matrix), aucune écriture SQL dans un autre schéma, rien de non conforme ; point 3 remplacé par M-18)
- Demande : appliquer dans Keystone la décision M-17 de Matrix (`docs/decisions.md` et `docs/architecture-postgres.md` § 8 sexies du dépôt Matrix) :
  1. **Lire** les données d'un autre outil uniquement par ses vues `pub_` (R2), jamais par ses tables ;
  2. **Écrire** chez un autre outil uniquement par son API ou par une fonction `pub_` qu'il fournit (R4), jamais par `INSERT` / `UPDATE` / `DELETE` dans son schéma ;
  3. pour un **nouvel échange**, ne plus demander à Matrix de recopier une vue dans `partage/` : la migration de Keystone reste la seule définition de ses vues `pub_` (R3), et le besoin d'accès se déclare comme un lien du registre `matrix.liens` (R5) — en attendant l'API `POST /api/liens` (lot M17-4), par une entrée courte dans le `REQUESTS.md` de Matrix : lecteur, objet (`schéma.pub_…`), nature (`lecture` ou `execution`), justification ;
  4. pour une **écriture qu'un autre outil doit faire chez Keystone** : lui fournir une API, ou une fonction `pub_<verbe>_<objet>` créée par migration (`SECURITY DEFINER`, `SET search_path = <schéma>, pg_temp`, appelant identifié par `session_user`, règles et journal de Keystone appliqués, `REVOKE EXECUTE … FROM PUBLIC` ; § « Fonctions pub_ » de la note) ;
  5. reprendre ces règles dans le `CLAUDE.md` de Keystone et dans ses documents de demandes à Matrix, et faire l'inventaire de ses échanges (point de départ ci-dessous), en signalant à Matrix tout accès qui n'y serait pas conforme.
- Justification : décision du responsable produit du 30/10/2026 (M-17) : Matrix décide de chaque accès d'un outil aux données d'un autre, PostgreSQL l'applique. Les vues `pub_` restent les contrats de lecture, mais leur copie par Matrix (quatre étapes par échange, dont deux à la main) disparaît, et l'écriture entre outils devient possible sous le contrôle de Matrix sans contourner les règles métier du propriétaire.
- Détails techniques : relevé du 30/10/2026 sur `main` de Keystone (requêtes SQL vers d'autres schémas) : `matrix.pub_filiales`, `matrix.pub_organigramme`, `arche.pub_capex`, `arche.pub_besoins_machines` ; échanges avec Vigie, Cursus et Codex par leurs API (connecteurs à file d'envoi) : conformes à R4. Toutes ces lectures passent déjà par des vues `pub_` et aucune écriture directe dans un autre schéma n'a été trouvée : aucune correction urgente. Les vues, droits et fichiers de partage actuels restent en place pendant la transition (lots M17-1 à M17-5 côté Matrix) ; une vue `pub_` existante ne change pas.
- Validé par Guillaume le : 2026-10-30

## [2026-11-01] Matrix → Keystone — M-18 : Matrix définit vos vues `pub_` et décide de vos écritures croisées (plus de vue `pub_` dans vos migrations)
- Statut : FAITE (02/11/2026 : plus aucune vue `pub_` ni droit à un autre outil dans les nouvelles migrations, garde-fou `src/server/db/pub-views-owned-by-matrix.test.ts` (après 0074) ; règles dans `CLAUDE.md` ; les 22 vues listées sont exactement celles des migrations 0035 à 0071 ; écritures reçues par API seulement. Matrix peut reprendre les vues)
- Demande : appliquer dans Keystone la décision M-18 de Matrix (`docs/decisions.md` et `docs/architecture-postgres.md` § 8 septies du dépôt Matrix), qui **remplace le point 3 de la demande M-17** du 30/10/2026 (« la migration reste la seule définition des vues `pub_` ») :
  1. **ne plus créer, modifier ni supprimer de vue `pub_` dans vos migrations** (les migrations déjà appliquées ne changent pas) : une nouvelle publication, ou une colonne de plus, se demande à Matrix, qui la définit dans son écran « Publications » (`matrix.publications`) et l'applique lui-même (rôle `matrix_gestion`). Votre migration crée les tables et colonnes ; la vue est celle de Matrix ;
  2. **avant de modifier ou de supprimer une colonne lue par une vue `pub_`**, le signaler à Matrix (entrée dans son `REQUESTS.md`) : la migration échouerait, la vue en dépend. Une colonne publiée ne se retire ni ne se renomme ; un changement incompatible passe par une vue `…_v2` ;
  3. **écritures que d'autres outils font chez vous** : votre API reste permise ; pour une écriture en SQL, fournir une fonction `pub_<verbe>_<objet>` créée par migration (`SECURITY DEFINER`, `SET search_path = <schéma>, pg_temp`, appelant identifié par `session_user`, vos règles et votre journal appliqués, `REVOKE EXECUTE … FROM PUBLIC`). Le droit de l'exécuter est un lien « écriture » décidé dans Matrix ; une fonction exécutable par tous est signalée en erreur par `droits.verifier()` ;
  4. **vos besoins chez les autres** (lecture d'une vue, exécution d'une fonction) se déclarent comme liens dans Matrix (écran « Liens entre outils » ou entrée courte dans son `REQUESTS.md` : outil, objet `schéma.pub_…`, nature `lecture` ou `execution`, justification), plus par une demande de copie de vue ;
  5. reprendre ces règles dans votre `CLAUDE.md`, puis passer cette entrée à FAITE : Matrix reprend alors vos vues `pub_` (`partage/14-reprise-publications.sql` : elles passent au rôle `matrix_gestion`, leurs lecteurs gardent leur droit).
- Justification : décision du responsable produit du 01/11/2026 (M-18) : « matrix [doit] être le seul outil qui permette d'administrer la base de données postgre […] c'est matrix qui doit avoir la main sur ce que chaque outil publie, lie, écrit ». Matrix est en place (lots P1 à P4 fusionnés le 01/11/2026 : rôle `matrix_gestion`, registre et écran « Publications », liens appliqués tout de suite, liens d'écriture). Tant que la reprise n'est pas faite, rien ne change pour Keystone ; après la reprise, une migration qui recréerait une vue `pub_` échouerait (« must be owner of view »), d'où le point 1 d'abord.
- Détails techniques : vues de Keystone reprises par Matrix : pub_activites, pub_affectations, pub_articles, pub_avancement_projets, pub_avenants, pub_catalogue_machines, pub_chantiers, pub_clients, pub_expeditions, pub_fournisseurs, pub_jalons, pub_jalons_projets, pub_journal, pub_livrables, pub_nomenclatures, pub_pack_ingenierie, pub_parc_machines, pub_projets, pub_reponses_besoins, pub_reserves, pub_rex, pub_taches_jours (22 vues). Écritures reçues d'autres outils : événements RH de Cursus (webhook, flux F03) et retours de Vigie par ses connecteurs : API, conformes, rien à changer. Une vue reprise garde son nom, ses colonnes, son commentaire et ses lecteurs ; seule sa propriété change. Contrôles : `droits.verifier()` (vue `pub_` encore à l'outil : attention, « pas encore reprise »). Pour un essai local (PGlite, base de démonstration), vos migrations anciennes continuent de créer les vues : seule une **nouvelle** migration ne doit plus en créer ni en modifier.
- Validé par Guillaume le : 2026-11-01


## [2026-11-05] Matrix → Keystone — M-19 · Fonction d'édition `keystone.pub_editer` : corriger les données de Keystone depuis Matrix, par vos règles
- Statut : FAITE (07/11/2026, migration `0076_pub_editer`, notes `docs/delivery-9/notes-m19-edit.md`) — fonction générique
  `keystone.pub_editer` (pas de fonction par table), `SECURITY DEFINER`, `search_path = keystone, pg_temp`, EXECUTE retiré à
  PUBLIC. **Liste fermée** (restriction du responsable produit) : `reference_values` (ajouter `list_key`, `label` ; corriger
  `label` des catégories de risque et types de livrable ; retirer = désactivation), `storage_locations` (ajouter, corriger
  `name`, `location_type` ; retirer = désactivation), `clients` (ajouter, corriger `name`), `suppliers` (ajouter, corriger `name`,
  `x3_code`), `persons` (corriger `full_name`, `initials`, `job_title`), `projects` (corriger `name`, `short_name`). Toute autre
  table, colonne ou action est refusée avec son motif ; colonnes sensibles refusées et jamais renvoyées (`persons.email`,
  `matricule`, `rate_role_id`). Clé : `{"id": "<uuid>"}` (clé primaire). Refus : SQLSTATE `P0K01` (non ouvert), `P0K02`
  (argument invalide), `P0K03` (règle de Keystone), `P0K04` (ligne introuvable). Journal : `keystone.audit_entries`, acteur
  `p_par`, motif `p_motif`, valeurs avant / après, domaine « Matrix », texte « Matrix (<session_user>) · … ».
  **À faire par Matrix** : le lien « écriture » `matrix_app` → `keystone.pub_editer` (`droits.accorder_execution`) ; la
  visionneuse peut proposer « Ajouter / Corriger / Retirer » sur les seules tables et colonnes ci-dessus.
- Demande : fournir, par une migration de Keystone, la fonction
  `keystone.pub_editer(p_table text, p_action text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text) RETURNS jsonb`
  (`SECURITY DEFINER`, `SET search_path = keystone, pg_temp`, `REVOKE EXECUTE … FROM PUBLIC`), qui ajoute, corrige ou retire une ligne
  d'une table de Keystone en appliquant vos règles et votre journal :
  - `p_action` = `ajouter` | `corriger` | `retirer` (un retrait peut être un archivage) ; `p_cle` = clé primaire de la ligne
    (null pour `ajouter`) ; `p_valeurs` = colonnes à écrire (null pour `retirer`) ;
  - `p_par` = nom de la personne connectée à Matrix (Microsoft Entra ID, rôle Administrateur) ; `p_motif` = motif saisi
    (obligatoire) ;
  - refus par `RAISE EXCEPTION` (message montré tel quel dans Matrix) ; la fonction renvoie la ligne après modification,
    sans colonne sensible ;
  - elle refuse les tables que Keystone ne veut pas ouvrir et toute colonne de `droits.colonnes_sensibles` (Matrix ne les
    transmet jamais, mais la fonction ne doit pas en dépendre) ;
  - règle propre à Keystone à respecter : journal d'audit en ajout seul (`audit_entries`, R-168) : chaque modification y est écrite avec `p_par` et `p_motif`.
  Une fonction par table (`keystone.pub_editer_<table>`, mêmes paramètres sans `p_table`) reste possible et passe avant la
  générique. Une fois la migration passée, passer cette entrée à FAITE : la DSI autorise alors le lien d'écriture dans Matrix.
- Justification : décision M-19 du 05/11/2026 (responsable produit) : « pour le moment, l'admin IT peut modifier toutes les
  données à l'exception des données sensibles RGPD », **par les outils** : Matrix n'écrit jamais lui-même dans vos tables
  (M-18) ; la DSI corrige depuis la visionneuse de Matrix, Keystone garde ses règles et son journal.
- Détails techniques : convention complète et exemple dans `docs/edition-par-les-outils.md` du dépôt Matrix. Le droit
  d'exécution est un lien « écriture » `matrix_app` → `keystone.pub_editer`, décidé dans Matrix (« Liens entre outils ») et posé
  par `droits.accorder_execution` ; `droits.verifier()` signale une fonction `pub_` exécutable par tous ou sans
  `search_path` fixé. Rien ne change pour Keystone tant que la fonction n'existe pas : la visionneuse reste en lecture seule.
- Validé par Guillaume le : 2026-11-05

## [2026-11-05] Vigie → Keystone — NC de projet de Vigie : lecture par les vues, avancement par vigie.pub_signaler_avancement_nc (D13)
- Statut : FAITE (07/11/2026, `docs/delivery-9/notes-vigie-d12-d13.md`, migration 0077) : `VIGIE_SOURCE=server` (défaut avec `DATABASE_URL`) — miroirs rafraîchis par SELECT sur `vigie.pub_non_conformites` et `vigie.pub_hse_projet` (plus de GET), numéro = référence EV-… (CV-07, démonstration renumérotée EV-2026-0nn) ; avancement par `select vigie.pub_signaler_avancement_nc(…)` aux paramètres nommés, numéro de demande gardé (`vigie_ref`), P0V01 / P0V02 → « failed » sans renvoi, autre erreur → renvoyée ; issue lue dans `vigie.pub_demandes_recues` (rejected → « refused », motif affiché) ; règles de Vigie reprises (ni Confinement ni Clôturée demandés, vérification = proposition, NC laissée en Vérification) ; liens `/evenements?etat=tous&sel=EV-…`. Fonctionnement réel dès que Matrix applique sur le serveur le lien d’exécution et la publication `pub_demandes_recues` (préparés). « Stale » : pas de renvoi automatique, la personne redemande d’après le nouvel état
- Demande :
  1. Lecture : rafraîchir vigie_ncrs et vigie_hse_items par SELECT sur vigie.pub_non_conformites et vigie.pub_hse_projet
     (liens keystone_app de la convention ; vues reprises par Matrix) au lieu de GET /api/ncrs et /api/hse
     (quality-connector.ts) ; Vigie n'exposera pas de GET. Correspondance : pub_non_conformites.project_code →
     projectCode, number → number, vigie_ref → vigieRef, status (open … closed : étapes 0 à 5 de Vigie), closed_on,
     supplier_id, owner_matricule (voir le plan de Matrix, D13).
  2. Numéro : décision CV-07 de Vigie (04/11/2026) — le numéro d'une NC est la référence EV-… de Vigie
     (pub_non_conformites.number = vigie_ref, ex. EV-2026-130), unique ; plus de NCR-nnn (déjà accepté par le contrat
     vigie-contract.md § 2.2). Seules les NC portant un code projet de keystone.pub_projets sont publiées.
  3. Avancement (outbox vigie_ncr_progress) : au lieu de POST /api/ncrs/:project/:number/progress, appeler
     select vigie.pub_signaler_avancement_nc(p_numero => number, p_projet => projectCode, p_nature => kind
     ('step' | 'verification' | 'references'), p_etape_depuis => fromStatus, p_etape_cible => targetStatus,
     p_decision => decision ('approved' | 'rejected'), p_commentaire => comment, p_acteur_nom => actor.name,
     p_acteur_role => actor.role, p_enregistre_le => recordedAt, p_id_externe => keystoneId (même valeur au renvoi :
     même demande), p_activite, p_article, p_livrable => null hors 'references') ; le résultat est le numéro de la demande
     dans Vigie (à garder comme vigieRef de l'entrée). Erreur P0V01 (appelant non admis) ou P0V02 (argument invalide) :
     entrée « failed », non renvoyée telle quelle.
  4. Réponse asynchrone : la demande est traitée par Vigie dans les 10 minutes ; état et motif lus dans la publication de
     l'état des demandes (demandée à Matrix : statut applied | rejected, code_resultat stale | refused | not_found |
     invalid, resultat) ; rejected = état « refused » de l'outbox (fin des renvois) ; stale = l'état a changé dans Vigie
     (renvoyer d'après le nouvel état lu dans pub_non_conformites).
  5. Ce que Vigie applique (choix restrictifs, à confirmer avec Keystone) : étape suivante seulement depuis l'état vu
     (ni « containment », qui est la qualification par le QHSE de Vigie, ni « closed ») et selon les règles de Vigie
     (analyse saisie, action liée, actions vérifiées) ; vérification (approved / rejected) : proposition au QHSE de Vigie,
     qui clôt ou renvoie la NC lui-même (la NC reste « verification » d'ici là) ; références activité / article /
     livrable : posées si vides dans Vigie.
  6. Liens profonds : fiche /evenements?etat=tous&sel=<EV-…> (inchangé, vigieRef = number).
- Justification : M-17 (lecture par vues, écriture par fonction pub_ du propriétaire), décisions CV-07 et CV-08 de Vigie.
- Validé par Guillaume le : 2026-11-05

## [2026-11-06] Vigie → Keystone — Ordres de modification de Vigie : lecture par les vues, avancement par vigie.pub_signaler_avancement_eco (D12, lot 5 livré le 05/11/2026)
- Statut : FAITE (07/11/2026, côté Keystone, `docs/delivery-9/notes-vigie-d12-d13.md`) : miroir rafraîchi par SELECT sur `vigie.pub_ordres_modification`, `pub_eco_approbations`, `pub_eco_effectivite` (plus de GET) ; avancement par `select vigie.pub_signaler_avancement_eco(…)` aux paramètres nommés, numéro de demande gardé, P0V01 / P0V02 → « failed », issue lue dans `vigie.pub_demandes_recues` ; clés englead et pm seulement (la qualité décide dans Vigie), jamais released ni rejected ; liens inchangés. Reste, hors Keystone : le lien d’exécution `keystone_app` → `vigie.pub_signaler_avancement_eco` et les publications D12 sont acceptés et préparés par Matrix (entrées Vigie → Matrix du 06/11/2026, ACCEPTÉES le 07/11) ; ils seront appliqués sur le serveur en service après la migration 0029 de Vigie. D’ici là les avancements restent « en attente de synchronisation avec Vigie »
- Demande :
  1. Lecture : rafraîchir vigie_ecos par SELECT sur vigie.pub_ordres_modification (number, title, eco_type → type,
     status, interchangeability, from_revision, to_revision, cost_eur, schedule_days, stock_impact, document_refs,
     requested_by_name → requestedBy, raised_on, pending_dispositions, locked, parts, projects, released_at,
     vigie_updated_at → updatedAt), pub_eco_approbations (approvals : approval_key → key, decision, approver_text →
     approver, decided_by_name → decidedBy, decided_at) et pub_eco_effectivite (effectivity, même noms en snake_case) au
     lieu de GET /api/ecos?source=keystone ; projets = codes de keystone.pub_projets.
  2. Avancement (outbox vigie_eco_progress) : au lieu de POST /api/ecos/:number/progress, select
     vigie.pub_signaler_avancement_eco(p_numero => ecoNumber, p_nature => kind ('step' | 'approval'), p_cle => approvalKey,
     p_decision => decision, p_etape_depuis => fromStatus, p_etape_cible => targetStatus, p_commentaire => comment,
     p_acteur_nom => actor.name, p_acteur_role => actor.role, p_enregistre_le => recordedAt, p_id_externe => keystoneId) ;
     résultat : numéro de la demande dans Vigie (vigieRef). P0V01 / P0V02 : entrée « failed », non renvoyée telle quelle.
  3. Ce que Vigie applique (choix restrictifs, à confirmer) : étape suivante depuis l'état vu (draft → impact_analysis →
     in_approval, interchangeabilité évaluée) ; clés englead et pm (quality décidée dans Vigie) ; jamais released (d'office)
     ni rejected (une clé refusée rejette l'ordre). Réponse asynchrone : état lu dans la publication de l'état des demandes
     (§ 5.1) ; refus « refused » = fin des renvois.
  4. Liens : /modifications-techniques/<ECO> (inchangé, NEW-D4-1), /modifications-techniques/nouvelle?part=&project=&title=
     &source=keystone (formulaire prérempli), filtres ?part= et ?project= (projet = code de Keystone).
- Justification : M-17, M-18 ; CV-06 et CV-08 de Vigie.
- Validé par Guillaume le : 2026-11-06
