# Livraison 9 — lot « besoins machines des filiales » (R-187)

Statut : construit sur la branche `r187-capex-needs` (depuis `02ecefb`, « Merge pull request #32 ») le 24 oct. 2026, lancé par le
responsable produit le même jour. Demandes d’Arche **K-02** (connecteur `capex`, corbeille « Besoins des filiales »,
`pub_reponses_besoins`) et **K-10** (projet créé — ou ligne ajoutée — à la commande) de l’entrée « Catalogue machines et réponses
aux besoins des filiales » de `REQUESTS.md` ; **K-03** (classe d’estimation et fourchette des réponses) est publiée ici avec la
vue. Références : `docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md` (frontière Keystone ↔ CAPEX), cadrage
`docs/delivery-9/cadrage-r185-r186.md` § 3 (ligne « Arche (K-10) »), notes R-185 (lignes d’équipement), R-186 (catalogue versionné),
R-188 (`src/domain/estimate-class.ts`), share-views (rattachement CAPEX des projets) ; côté Arche (lecture seule) :
`docs/CONTRATS.md` (contrats de `arche.pub_capex`, `arche.pub_besoins_machines`, `pub_reponses_besoins`), `docs/DEMANDES-KEYSTONE.md`,
jeu de démonstration `src/server/db/seed/demo.ts`.

## 1. Ce qui change

| Élément | Où | Rôle |
|---|---|---|
| Tables | `drizzle/0049_capex_needs.sql` (générée) | `capex_mirror`, `capex_needs` (miroir), `capex_sync_runs` (lectures), `need_answers` (réponses) |
| Vue | `drizzle/0050_capex_needs_share.sql` (personnalisée, comme 0046) | `pub_reponses_besoins` (contrat K-02) |
| Règles pures | `src/domain/capex-needs.ts` (+ tests) | lignes d’Arche contrôlées, droits, validation d’une réponse, transitions, numérotation, réponse la plus récente, montant par défaut, ligne d’équipement d’un besoin, blocages de la commande |
| Connecteur | `src/server/integrations/capex/` : `config.ts`, `links.ts`, `simulation.ts`, `mirror.ts`, `connector.ts` (+ test) | lecture des vues d’Arche (serveur commun) ou de la source simulée, miroir remplacé à chaque lecture réussie |
| DAL | `src/server/dal/capex-needs.ts` | corbeille, réponses (création, modification, statut), création du projet et ajout de ligne à la commande |
| Server Functions | `src/features/capex-needs/actions.ts` (+ test) | droits, validation, traductions des erreurs, `revalidatePath` |
| Écran | carte « Besoins machines des filiales » sous le registre de Portefeuille › Projets (`needs-card.tsx`, `needs-buttons.tsx`, `needs.module.css`, page `portfolio/projects`) | |
| Assistant | `src/features/projects/draft.ts` (contrôle du brouillon sorti de `createProjectAction`, partagé), `createWizardProject` (lignes d’un besoin, `capexLink`, `afterCreate`), `addProjectEquipment` (`keepCatalogue`, `afterAdd`) | création « à la commande » par le chemin de l’assistant et de la carte « Équipement » |
| Activité & intégrations | ligne « Arche » (`seed/capex-needs.ts`, `dal/integrations.ts`, `dal/admin-connectors.ts`, `domain/connectors.ts` `SHARED_DB_CONNECTORS`, `features/admin/i18n.ts`) | état, volume, « Synchroniser » |
| Tâche | `capex-needs` (`src/domain/jobs.ts`, `src/server/jobs/definitions.ts`) | lecture toutes les 15 min |
| Configuration | `ARCHE_URL`, `ARCHE_SOURCE` (`src/server/config/parse.ts`, `.env.example`, `docs/EXPLOITATION.md` § 3, § 8, § 10) | |
| Contrat de partage | `src/server/db/share-contracts.ts` (`pub_reponses_besoins`, `REPONSES_VIEW_TYPES`, `SHARE_VIEW_COUNT` = 19, index `need_answers_updated_at_idx`) | vérifié par `share-views.test.ts`, `actions.test.ts`, `scripts/db-check.ts`, `postgres.integration.test.ts` |
| Traductions | `src/i18n/extra/d9-capex-needs.json`, messages système `needAnswer.*` ; « CAPEX » et « Nature » ajoutés à `same-in-french.json` | |

Aucun écran n’est ajouté à `src/config/screens.ts`.

## 2. Connecteur `capex` — modes

| `ARCHE_SOURCE` | Lecture | Défaut |
|---|---|---|
| `server` | `select to_jsonb(v) as r from arche.pub_capex v` et `… arche.pub_besoins_machines v` sur le serveur PostgreSQL commun, par la connexion de Keystone (rôle `keystone_app`, **SELECT seulement** ; le droit est posé par Matrix). Chaque ligne en `to_jsonb` : une colonne ajoutée en fin de vue par Arche ne casse rien. | avec `DATABASE_URL` |
| `simulation` | la source simulée (`simulation.ts`, mêmes noms de colonnes que les vues, même contrôle), **sur une base de démonstration seulement** (refusée sur une base `production`) | sans `DATABASE_URL` |
| `off` | rien | |

- `ARCHE_SOURCE=server` sans `DATABASE_URL` est une erreur de configuration (une base PGlite n’a pas de schéma `arche`).
- `ARCHE_URL` (défaut `http://localhost:3400`, port d’Arche sur le Mac ; avertissement en production s’il manque) : liens
  `<ARCHE_URL>/capex/<code>` (fiche CAPEX) et `<ARCHE_URL>/capex/<code>/machines` (besoins du CAPEX), d’après le contrat d’Arche.
  Les liens sont construits côté serveur (variable lue à l’exécution, pas à la construction comme les `NEXT_PUBLIC_*`).
- La DSI peut désactiver le connecteur « Arche » dans son fichier de connecteurs (R-020) : rien n’est lu.
- Lectures : tâche `capex-needs` toutes les 15 min (Arche lit Keystone au même rythme), bouton « Actualiser » de la carte
  (directeur et chefs de projet), « Synchroniser » de la ligne Arche d’Activité & intégrations. Chaque lecture écrit une ligne
  `capex_sync_runs` (source, déclencheur, résultat, nombres, lignes ignorées, erreur).
- **Miroir remplacé** à chaque lecture réussie, dans une transaction (Arche publie ses vues en entier, sans flux de suppression) : un
  besoin sorti de la vue (repassé en brouillon) sort du miroir ; les réponses de Keystone restent (référence texte, sans clé
  étrangère). Une ligne mal formée (clé, CAPEX, quantité, statut) est ignorée et comptée. Une lecture en échec garde le miroir et
  met la ligne Arche en avertissement (mode `server`).
- Le miroir ne garde pas les adresses électroniques du sponsor et du chef de projet publiées par `pub_capex` (inutiles à Keystone).

## 3. Schéma

- `capex_mirror` (clé `code`) : filiale (code, nom), zone, site, pays ISO 2, intitulé, type d’investissement, statut, phase,
  typologie, noms du sponsor et du chef de projet, dates G1 / G2 / G3, début de MES, `source_updated_at` (`maj_le`), `synced_at`.
- `capex_needs` (clé `need_ref`) : CAPEX, ligne, code et version catalogue (ou aucun : besoin libre), libellé libre, quantité
  (≥ 1), options (codes, jsonb), capacité visée et unité, date de besoin, site, statut `submitted` / `withdrawn` / `ordered`,
  commentaire, soumis le, commandé le (G2), `source_updated_at`, `synced_at`.
- `capex_sync_runs` : une ligne par lecture.
- `need_answers` : `number` (`RB-001`, unique, jamais réutilisé), `need_ref`, `capex_code`, `nature`, `qualification`, `reason`,
  `estimate_class`, `central_keur` / `low_keur` / `high_keur`, `lead_time_weeks`, `valid_until`, `document_ref` (numéro Codex),
  `project_id` (→ `projects`, `set null`), `status`, `answered_at` (`repondu_le`), auteur, horodatages ; contrôles en base : nature,
  qualification, statut, classe, **offre ferme = E10**, réponse chiffrée = montant + classe + fourchette, qualification = ni montant
  ni classe ; index `need_answers_need_ref_idx`, `need_answers_updated_at_idx` (K-11).

## 4. Règles des réponses (`src/domain/capex-needs.ts`)

- **Nature** `qualification` / `indicatif` / `devis` / `offre_ferme` ; **qualification** `faisable` / `a_etudier` / `refuse`
  (une réponse chiffrée est « faisable » par défaut, jamais « refusée » ; une offre ferme répond à un besoin faisable) ; **motif**
  obligatoire pour « à étudier » et « refusé ».
- **Réponse chiffrée** (indicatif, devis, offre ferme) : montant central > 0 en k€ et classe d’estimation ; `offerClassError`
  (R-188) : **offre ferme ⇒ E10**, une autre réponse chiffrée exige une classe. **Bas et haut calculés** par `estimateRange`
  (E50 ±50 %, E30 ±30 %, E10 −5 / +10 %), jamais saisis, stockés à l’écriture (une réponse publiée ne bouge pas).
- **Qualification** : ni montant ni classe.
- Délai 1–520 semaines ; validité AAAA-MM-JJ, pas dans le passé (horloge métier) ; référence Codex au format d’un numéro de document
  (Codex héberge le fichier, Keystone ne garde que la référence).
- **Montant par défaut** d’une nouvelle réponse : (prix indicatif de la version catalogue + prix des options choisies) × quantité,
  en **E50** (classe du prix catalogue, R-186) ; un besoin sans fiche catalogue démarre en qualification.
- **Statuts** : `en_cours` (modifiable) → `remise` (datée : `repondu_le`) ou `caduque` ; `remise` → `acceptee` (devis ou offre
  ferme) ou `caduque` ; `acceptee` et `caduque` sont finales. Pour remettre : un devis ou une offre ferme porte sa référence Codex ;
  une offre ferme porte aussi sa date de validité et son délai.
- **Une nouvelle réponse = une nouvelle ligne** (la plus récente fait foi, K-02) ; elle reprend le projet des réponses précédentes du
  besoin. Pas de réponse à un besoin retiré.

## 5. Création à la commande (K-10)

Seulement sur une **action du directeur**, pour un besoin **`ordered`** pas encore livré par un projet, qui a **au moins une
réponse** (le code du projet est publié avec elle) :

- **(a) « Créer le projet »** : l’assistant « Nouveau projet » s’ouvre prérempli (nom « intitulé du CAPEX — machine », client = la
  filiale, type = celui de la fiche catalogue, quantité, pays d’après le code ISO du CAPEX) ; le brouillon est contrôlé comme celui de
  l’assistant (`parseProjectDraft`) puis créé par `createWizardProject`. **EQ-01 = la ligne du besoin** (type de la version
  catalogue, quantité, options « CODE · libellé », capacité visée, `besoin_ref`, code et version catalogue — gardée même retirée
  depuis), les autres lignes du brouillon suivent ; `projects.capex_code` / `besoin_ref` posés ; dans la même transaction, les
  réponses du besoin pointent le projet et une réponse « remise » (devis ou offre ferme) devient « acceptée ». Le modèle doit être le
  type du besoin (ou « blank »).
- **(b) « Ajouter à un projet »** : un projet ni clos ni annulé (et, pour un besoin libre, le type de machine) ; la ligne passe par
  `addProjectEquipment` (chemin R-185 : repère suivant, plan ITP de la ligne, audit), puis même rattachement des réponses ; le projet
  prend le rattachement CAPEX **s’il n’en a pas** (un projet déjà rattaché à un autre CAPEX le garde ; la ligne porte son besoin).
- Une seconde création pour le même besoin est refusée (« déjà livré par un projet · <code> »), contrôlée de nouveau dans la
  transaction.
- Audit : `needAnswer.projectCreated` / `needAnswer.lineAdded` (+ fil d’activité), en plus des lignes de l’assistant ou de la carte
  « Équipement ».

## 6. Vue `pub_reponses_besoins` (contrat K-02)

`WITH (security_barrier)`, SQL non qualifié, `COMMENT ON VIEW` nommant le lecteur `arche_app`, aucun `GRANT` (droits de Matrix).
Une ligne par réponse ; la plus récente (`repondu_le`, puis `numero`) fait foi.

| Colonne | Type | Source |
|---|---|---|
| `besoin_ref` | text | `need_ref` |
| `capex_code` | text | `capex_code` |
| `numero` | text | `number` (`RB-001`) |
| `nature` | text | `qualification` / `indicatif` / `devis` / `offre_ferme` |
| `qualification` | text | `faisable` / `a_etudier` / `refuse` |
| `motif` | text | `reason` |
| `classe_estimation` | text | `E50` / `E30` / `E10` (null pour une qualification) |
| `montant_central_keur`, `montant_bas_keur`, `montant_haut_keur` | numeric | fourchette (K-03) |
| `delai_semaines` | integer | `lead_time_weeks` |
| `valide_jusqu_au` | date | `valid_until` |
| `document_ref` | text | référence Codex |
| `projet_code` | text | `projects.code` du projet créé ou complété à la commande, sinon null |
| `statut` | text | `en_cours` / `remise` / `acceptee` / `caduque` |
| `repondu_le` | timestamptz | `answered_at` (enregistrement, puis remise) |
| `maj_le` | timestamptz | `updated_at` (indexé, K-11) |

## 7. Droits

- **Carte** : directeur et chefs de projet (rôles qui ont Portefeuille › Projets dans leur espace) ; les autres rôles ne la voient
  pas ; le client est renvoyé à l’accueil par `getScreenAccess('projects')`. Finance n’a pas le registre des projets : pas de lecture.
- **Actualiser** : directeur et chefs de projet.
- **Répondre, modifier, changer le statut, créer le projet, ajouter à un projet** : **directeur** seulement (engagement commercial
  d’EPC2i), contrôlé dans la Server Function puis dans le DAL.

## 8. Démonstration et production

- Source simulée (= jeu de démonstration) : CAPEX `CPX-APM-2026-01` (Atlas Process Maroc, Kénitra, après G1) et `CPX-SAI-2026-01`
  (Sahel Agro Industries, Thiès, G2 le 8 juil. 2026), codes du jeu de démonstration d’Arche ; `CPX-APM-2026-02` est un brouillon dans
  Arche, jamais publié. Arche n’a pas encore de besoins de démonstration (son lot L4) : les cinq besoins suivent son contrat et le
  catalogue de démonstration de Keystone :

| Besoin | Machine | Statut | Réponses |
|---|---|---|---|
| `CPX-APM-2026-01/B01` | 1 × EMP-40T v1 + TELE | soumis | RB-004 indicatif E50 4 218 k€ (remis), RB-005 devis E30 4 150 k€ (remis, DEV-CPX-APM-2026-01-001) |
| `CPX-APM-2026-01/B02` | besoin libre « Ligne de refroidissement en ligne des profilés » | soumis | aucune (à répondre) |
| `CPX-SAI-2026-01/B01` | 1 × MEMU-16 v1 + GEN | commandé | RB-003 offre ferme E10 1 945 k€ acceptée → **RCF-019** |
| `CPX-SAI-2026-01/B02` | 1 × SPUR-2X v1 (retirée) | retiré | RB-001 qualification « à étudier » |
| `CPX-SAI-2026-01/B03` | 2 × EMP-40T v1 + TELE | commandé | RB-002 offre ferme E10 8 436 k€ acceptée, projet **à créer** |

- RCF-019 (projet existant de la démonstration) reçoit le rattachement `CPX-SAI-2026-01` / `CPX-SAI-2026-01/B01` et le besoin sur
  sa ligne EQ-01 (aucune fiche catalogue posée : les écrans Contrat, registre, budget et planning n’en changent pas autrement).
- Une base de démonstration déjà semée reçoit une fois la ligne « Arche » et ces données (miroir et réponses vides) ; une base de
  production reçoit seulement la ligne « Arche » (« Prête »). Seed de production : rien d’autre.

## 9. Valeurs affichées modifiées

- Portefeuille › Projets : nouvelle carte sous le registre (directeur, chefs de projet).
- Contrat de RCF-019 : carte « Rattachement CAPEX » renseignée (`CPX-SAI-2026-01 · CPX-SAI-2026-01/B01`), colonne « Besoin machine »
  de sa ligne EQ-01 ; `pub_projets` publie ces deux valeurs pour RCF-019.
- Activité & intégrations : une ligne de plus, « Arche » (« Simulé » sans `DATABASE_URL`) ; le décompte des connecteurs compte un
  connecteur simulé de plus. Tests mis à jour en citant R-187.
- `scripts/db-check.ts` : 19 vues `pub_` (au lieu de 18), contrôles de `pub_reponses_besoins` (types, 5 réponses de démonstration,
  offre ferme E10 refusée hors E10).
- Production : avertissement « ARCHE_URL is not set » au démarrage tant que la variable manque.

## 10. Choix faits sans question

- **Emplacement** : carte sous le registre de Portefeuille › Projets plutôt qu’un nouvel écran (règle « pas de nouvel écran ») ;
  le registre est l’endroit où les projets naissent (« Nouveau projet »).
- **Droits** : lecture directeur + chefs de projet (architecture : « pour le directeur et les chefs de projet »), écriture directeur
  seul ; Finance exclue (pas de registre).
- **Fourchette** calculée par la classe, non modifiable (K-03 ne demande pas de saisie libre ; cohérent avec la tuile « Fourchette
  d’estimation » du Budget).
- **Statut « remise »** daté (`repondu_le` = date de remise) ; une réponse remise ne se modifie plus (nouvelle ligne) ; seuls devis
  et offres fermes s’acceptent ; la commande d’un besoin (création ou ajout) accepte la réponse remise la plus récente.
- **Une réponse est exigée** avant la création à la commande (sinon `projet_code` ne serait publié nulle part).
- **Numérotation** `RB-nnn` globale (comme les autres références de Keystone).
- **Rattachement CAPEX** d’un projet existant : posé seulement s’il est vide.
- **Options** de la ligne : « CODE · libellé » du catalogue (texte, comme R-185 le prévoit), au plus 12 de 80 caractères.
- **Courriels** de `pub_capex` non recopiés (minimisation).
- **Mode affiché** de la ligne Arche : `sql` (lecture sur le serveur) / `mock` (simulation) / aucun (off).
- **Démonstration** : le projet de l’offre ferme acceptée est RCF-019 (projet existant) plutôt qu’un 18ᵉ projet (les comptes et
  valeurs dorées des 17 projets restent).

## 11. Reste à faire

- **Matrix** : recopier la définition de `pub_reponses_besoins` dans `partage/30-keystone.sql` ; vérifier le droit de lecture
  `arche_app` sur `keystone.pub_reponses_besoins` et le droit `keystone_app` (SELECT) sur `arche.pub_capex` et
  `arche.pub_besoins_machines` dans `partage/90-droits.sql` (demande à porter par Matrix après validation ; ce lot ne modifie pas
  Matrix).
- **Arche** : publier `arche.pub_capex` et `arche.pub_besoins_machines` sur le serveur commun (son lot L4) avec les colonnes du
  contrat ; tant qu’elles manquent, `ARCHE_SOURCE=server` met la ligne Arche en avertissement (miroir vide) — `off` en attendant ;
  confirmer la forme de `options` (tableau de codes, ou d’objets `{code}` : les deux sont acceptés) et l’adresse de la page des
  besoins (`/capex/<code>/machines`).
- Mettre à jour `REQUESTS.md` (K-02, K-10 faits) et `docs/reste-a-developper.json` à l’intégration du lot.
- Hors périmètre : notification au directeur d’un nouveau besoin soumis ou commandé (aucune demande) ; caducité automatique d’une
  réponse à sa date de validité (le statut se change à la main) ; configurateur (R-186, option à valider) ; R-190 « client interne ».
