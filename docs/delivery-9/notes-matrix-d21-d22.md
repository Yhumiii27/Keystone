# Livraison 9 — lot « Matrix D21 / D22 » (filiales et REX)

Statut : construit sur la branche `matrix-d21-d22` (depuis `6a1bd28`, « Merge pull request #35 ») le 25 oct. 2026. Deux demandes de
Matrix dans `REQUESTS.md`, validées par le responsable produit le 23 oct. et lancées le 25 oct. 2026 :

- **D22** — « Publier les leçons apprises des projets (vue pub_rex, D22) » : vue `keystone.pub_rex` au contrat commun du REX ;
- **D21** — « Relier les clients filiales au code de la filiale de Matrix (D21) » : liste des filiales lue dans `matrix.pub_filiales`,
  `clients.code3` = code de la filiale pour un client interne, code réservé, `pub_clients.filiale_code`.

Références : `docs/delivery-9/notes-r190-internal-client.md` (client interne, R-190), `notes-share-views.md` (règles des vues `pub_`,
K-11), Matrix `infra/postgres/partage/10-matrix-referentiels.sql` (`matrix.pub_filiales`, contrat D21 v1),
`96-matrix-rex-unifie.sql` (contrat commun du REX, union `matrix.rex_unifie`), `90-droits.sql` (droits `keystone.pub_rex` →
`matrix_app`, `matrix.pub_filiales` → `keystone_app`, déjà posés), Arche `70-arche.sql` (`arche.pub_rex_v2`, même contrat).

## 1. Ce qui change

| Élément | Où | Rôle |
|---|---|---|
| Table miroir | `drizzle/0053_matrix_subsidiaries.sql` (générée), `src/server/db/schema/matrix.ts` | `matrix_subsidiaries` : copie en lecture seule de `matrix.pub_filiales` |
| Index | même migration, `lessons_learned_updated_at_idx` | lecture incrémentale de `pub_rex` (`maj_le`, K-11) |
| Vues | `drizzle/0054_matrix_rex_clients_share.sql` (personnalisée) | `pub_rex` (nouvelle) ; `pub_clients` + `filiale_code` en fin de vue |
| Règles pures | `src/domain/subsidiaries.ts` (+ tests) | lecture d’une ligne de `pub_filiales`, filiales proposées (Matrix d’abord), code réservé |
| Connecteur | `src/server/integrations/matrix/subsidiaries.ts`, `subsidiaries-mirror.ts`, `simulation.ts` (+ tests) | lecture serveur / simulation / arrêt, miroir remplacé à chaque lecture réussie |
| Configuration | `MATRIX_SOURCE` (`src/server/config/parse.ts`, `.env.example`, `docs/EXPLOITATION.md` § 4 et § 10) | `server` \| `simulation` \| `off` |
| Tâche planifiée | `matrix-subsidiaries` (`src/domain/jobs.ts`, `src/server/jobs/definitions.ts`) | toutes les heures |
| DAL | `src/server/dal/internal-client.ts` | `listSubsidiaries` (Matrix, sinon miroir capex), `assertClientCodeFree`, `code3` aligné dans `writeFlag` |
| Création de projet | `createWizardProject` (`projects-register.ts`), `createProject` (`projects.ts`), import de planning (`schedule-import.ts`) | refus d’un code proposé réservé à une filiale |
| Server Functions | `setInternalClientAction` (nouveaux messages), `refreshSubsidiariesAction` (`src/features/contract/actions.ts`), `createProjectAction` (message du code réservé) | |
| Écran | carte « Client » de l’écran Contrat (`contract-view.tsx`, `internal-client-form.tsx`) | origine de la liste, bouton « Actualiser la liste » |
| Démonstration | `src/server/db/seed/matrix-subsidiaries.ts`, `seed/index.ts` | miroir APM, SAI (et rattrapage unique d’une base de démonstration existante) |
| Contrats | `src/server/db/share-contracts.ts` (`pub_rex`, `pub_clients`, `REX_VIEW_TYPES`, 20 vues, index K-11) | vérifiés par `share-views.test.ts`, `scripts/db-check.ts`, `postgres.integration.test.ts` |
| Traductions | `src/i18n/extra/d9-matrix-subsidiaries.json` | |

Aucun écran n’est ajouté à `src/config/screens.ts`.

## 2. Schéma

- `matrix_subsidiaries` : `code` (clé, trois majuscules), `name`, `country_iso2`, `zone_code`, `currency`, `position` (`ordre`),
  `active` (`actif`), `synced_at`. Aucune clé étrangère vers `clients` : un client garde son code quand la filiale quitte la vue.
- `lessons_learned_updated_at_idx` sur `lessons_learned.updated_at` (source de `pub_rex.maj_le`, modèle K-11).
- **Pas de contrainte en base `code3 = subsidiary_code`** : `clients.code3` est unique et une base de production peut déjà porter,
  depuis R-190, un client interne dont le `code3` diffère du code de filiale ; une reprise automatique pourrait heurter l’unicité
  et faire échouer la migration. La règle est appliquée par le DAL (§ 4) ; `scripts/db-check.ts` contrôle la démonstration.

## 3. Vues (contrats)

Mêmes règles que 0035 / 0038 / 0052 : `WITH (security_barrier)`, noms non qualifiés, `COMMENT ON VIEW` nommant les lecteurs, aucune
colonne retirée ni renommée, colonnes nouvelles en fin de vue. Keystone publie désormais **20 vues `pub_`**.

### `pub_rex` (D22) — lecteur `matrix_app`

| Colonne | Type | Source |
|---|---|---|
| `ref_source` | text | `'lessons_learned:' \|\| id` |
| `outil` | text | `'keystone'` |
| `projet_code` | text | `projects.code` |
| `capex_code` | text | `projects.capex_code` (rattachement CAPEX, R-190 ; null sinon) |
| `numero` | text | `number` (`LL-01`) |
| `categorie` | text | `theme` (code : `engineering`, `procurement`, `site`, `client`, `planning`, `quality`, `hse`) |
| `titre` | text | `number \|\| ' · ' \|\|` début du constat (80 caractères au plus, espaces réduits, `…` si coupé) |
| `constat` | text | `what_happened` |
| `impact` | text | `impact` (`—` quand il n’a pas été saisi) |
| `recommandation` | text | `recommendation` |
| `portee` | text | `applies_to` |
| `statut` | text | `status` (`validated`, `applied`) |
| `auteur` | text | `raised_by_name` (seule donnée personnelle ; vide pour les leçons du prototype) |
| `cree_le` | timestamptz | `created_at` |
| `maj_le` | timestamptz | `updated_at` (avancé par chaque changement de statut) |

**Seules les leçons validées ou appliquées sont publiées** : une leçon « proposée » doit encore être validée par le projet (comme
Arche ne publie que ses REX publiés). En démonstration : LL-01, LL-02, LL-03 de HLT-026 ; LL-04 (proposée) ne l’est pas. Les 15
colonnes ont exactement les noms et types que contrôle `96-matrix-rex-unifie.sql` ; aucune colonne propre à Keystone.

### `pub_clients` (D16 v1 + D21) — lecteurs inchangés (`codex_app`, `cursus_app`, `vigie_app`, `matrix_app`)

`id`, `name`, `code3` (inchangés) puis **`filiale_code`** (text) = `clients.subsidiary_code` : le code de la filiale pour un client
interne, null pour un client extérieur (la base refuse déjà un code de filiale sur un client extérieur,
`clients_subsidiary_internal_check`).

## 4. Connecteur des filiales et règles

### Modes (`MATRIX_SOURCE`)

- `server` (défaut avec `DATABASE_URL`) : `select to_jsonb(v) from matrix.pub_filiales v` sur le serveur commun, par la connexion de
  Keystone (`keystone_app`, droit de Matrix) ; une colonne ajoutée en fin de vue ne gêne pas la lecture. Un échec (vue ou droit
  absent, serveur arrêté) garde le miroir et laisse un avertissement au journal (et dans le journal de la tâche).
- `simulation` (défaut sans `DATABASE_URL`) : les filiales de démonstration — **APM** Atlas Process Maroc (MA, AFN, MAD) et **SAI**
  Sahel Agro Industries (SN, AFO, XOF), celles du jeu de démonstration d’Arche — sur une base de démonstration seulement.
- `off` : rien n’est lu. `server` sans `DATABASE_URL` est une erreur de configuration.

Chaque lecture réussie **remplace** le miroir (Matrix publie la vue entière) ; une ligne mal formée (code hors `^[A-Z]{3}$`, nom vide,
`actif` absent) est écartée et comptée. Lancée par la tâche `matrix-subsidiaries` (toutes les heures, la liste change rarement), par
« Actualiser la liste » de la carte « Client » (directeur, sur un projet dont il peut modifier le Contrat) et par le seed de
démonstration.

### Filiales proposées (carte « Client »)

- Dès que Matrix publie au moins une filiale : ses filiales **actives**, dans l’ordre de Matrix (`ordre`, puis code). Une filiale
  inactive n’est ni proposée ni réservée.
- Tant que Matrix n’en publie aucune (cas de la production au 25 oct. 2026 : « la liste réelle des filiales n’est pas encore saisie
  dans Matrix ») : **repli** sur la liste de R-190 (filiales du miroir capex d’Arche et codes déjà posés). La carte indique l’origine
  (« Filiales publiées par Matrix » / « Filiales de l’application CAPEX (Matrix n’en publie pas encore) »).
- Avec Matrix comme source, un **nouveau** code hors de la liste est refusé (« Choisissez une filiale publiée par Matrix ») ; le code
  déjà porté par le client reste affiché et conservé. À la création d’un projet depuis un besoin (R-187), le code de la filiale n’est
  posé que s’il est publié par Matrix (et libre).

### `code3` d’un client interne

- Un client interne avec un code de filiale prend ce code comme `code3` (D21 : « `clients.code3` prend le code de la filiale »),
  au réglage par le directeur comme au marquage à la commande. Refus si un autre client porte déjà ce `code3` (« Le code de cette
  filiale est déjà celui d’un autre client »). L’audit garde l’ancien et le nouveau `code3`.
- Quand le code de filiale est retiré (client redevenu extérieur, ou « Pas encore connue ») ou changé, un `code3` égal à l’ancien code
  de filiale est retiré (il reste réservé à la filiale) ; tout autre `code3` est gardé. Les codes des projets existants ne changent
  pas (ils sont enregistrés) ; seuls les codes analytiques et codes de projet suivants en dépendent.

### Code réservé

Un `code3` égal au code d’une filiale proposée est réservé à cette filiale. Contrôlé là où un code est **proposé** à partir du nom
d’un client sans code enregistré : assistant « Nouveau projet » (et création depuis un besoin, même chemin), `createProject`, import
d’un planning en mode « nouveau projet ». Message : « Ce code client est réservé à une filiale du groupe : choisissez le client de la
filiale ou un autre nom de client ». Un client qui a déjà un `code3` enregistré le garde (aucun blocage rétroactif).

## 5. Démonstration

- Miroir des filiales de Matrix : APM et SAI (simulés, datés du matin de démonstration) ; rattrapage unique d’une base de
  démonstration existante tant que le miroir est vide. Seed de production : rien.
- `pub_clients.filiale_code` = `SAI` pour Sahel Agro Industries (déjà `code3` = `SAI` depuis R-190), null ailleurs.
- `pub_rex` : 3 lignes (HLT-026 LL-01, LL-02, LL-03).

## 6. Valeurs affichées modifiées

- Carte « Client » de l’écran Contrat (directeur) : ligne d’origine de la liste et bouton « Actualiser la liste » ; liste « Filiale »
  = filiales de Matrix (démonstration : APM, SAI — inchangé dans les faits).
- Assistant « Nouveau projet » / import de planning : refus d’un client dont le code proposé est celui d’une filiale (aucun cas dans
  les données du prototype).
- Marquer un client interne change son `code3` (donc `pub_clients.code3`, `pub_projets.client_code3` et les prochains codes de
  projet de ce client).
- `scripts/db-check.ts` : 2 contrôles de plus (REX, filiales). Valeurs dorées inchangées.

## 7. Choix faits sans question

- **Leçons publiées** : validées et appliquées seulement (une leçon proposée n’est pas encore un REX).
- **`titre`** : numéro + début du constat (plus parlant que le thème, déjà dans `categorie`).
- **`categorie` / `statut`** : codes Keystone (anglais, comme `pub_reserves.statut`) ; Matrix peut les traduire.
- **Pas de contrainte en base** `code3 = subsidiary_code` (§ 2) ; règle dans le DAL.
- **Retrait du code** : un `code3` égal à l’ancien code de filiale est effacé quand le code de filiale l’est (§ 4).
- **Réservation** contrôlée seulement quand le code est proposé à partir du nom, jamais sur un `code3` déjà enregistré.
- **Miroir capex en repli** tant que Matrix ne publie aucune filiale (et non en complément).
- **Pas de ligne « Matrix » dans Activité & intégrations** (l’intégration Matrix n’y figurait pas ; aucun écran nouveau) : l’état se
  lit dans le journal des tâches ; tâche horaire.

## 8. Ce que Matrix doit faire

- Recopier dans `partage/30-keystone.sql` (qualifiées `keystone.`) : la nouvelle vue **`pub_rex`** et la nouvelle définition de
  **`pub_clients`** (`drizzle/0054_matrix_rex_clients_share.sql`), ainsi que la définition de **`pub_projets`** de R-190
  (`drizzle/0052_internal_client_share.sql`, `client_interne`, `filiale_code`) ; ajouter `lessons_learned`,
  `clients.is_internal`, `clients.subsidiary_code` et `projects.capex_code` à son contrôle des prérequis. Sans cela, un rejeu de son fichier 30 échoue
  (« cannot drop columns from view »).
- Rejouer `90-droits.sql` (le droit `keystone.pub_rex` → `matrix_app` est déjà prévu) puis `96-matrix-rex-unifie.sql` : `keystone.pub_rex`
  rejoint `matrix.rex_unifie`.
- Saisir la liste réelle des filiales (`matrix.filiales`) : dès qu’elle est publiée, Keystone la propose à la place du repli.
- Mettre à jour le statut des deux entrées de `REQUESTS.md` (non modifié par ce lot) et `docs/reste-a-developper.json` à l’intégration.

## 9. Vérifications (25 oct. 2026)

- `npx next typegen && npm run typecheck && npm run lint` : sans erreur ni avertissement.
- `npm test` : Test Files 401 passed | 1 skipped (402) · Tests 4326 passed | 12 skipped (4338).
- `npx tsx --conditions=react-server scripts/db-check.ts` : All checks passed (348 contrôles, dont les trois de ce lot et les
  colonnes de `pub_rex` et `pub_clients`).
- PostgreSQL 16 local, disposition du serveur commun (socle `infra/postgres-socle/` rejoué sur une base `epc2i` neuve) :
  `npm run db:migrate` (seed demo) puis `db-check --postgres` : All checks passed (348) ; `postgres.integration.test.ts` +
  `src/server/backup/backup.test.ts` : 2 fichiers, 26 tests passés.
- `E2E_PORT=3660 npm run test:e2e` : 26 passed.
