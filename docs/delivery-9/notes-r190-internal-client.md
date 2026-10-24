# Livraison 9 — lot « client interne » (R-190, partie restante)

Statut : construit sur la branche `r190-internal-client` (depuis `8c6b3cf`, « Merge pull request #34 ») le 24 oct. 2026, lancé par le
responsable produit le même jour. Demande d’Arche **K-05** de l’entrée « Rattacher les projets EPC2i au CAPEX dans pub_projets
(R-190) » de `REQUESTS.md` : la partie « admettre qu’une filiale du groupe soit le client d’un projet (client interne) ». Le
rattachement CAPEX (`projects.capex_code`, `besoin_ref`, carte « Rattachement CAPEX ») était déjà fait (lot share-views,
`notes-share-views.md` § 4). Références : `docs/dig-prodi/ARCHITECTURE-CAPEX-KEYSTONE.md`, `notes-r187-capex-needs.md` (création du
projet à la commande), R-179 (portail client, décision I-2b).

## 1. Ce qui change

| Élément | Où | Rôle |
|---|---|---|
| Colonnes | `drizzle/0051_internal_clients.sql` (générée) | `clients.is_internal` (booléen, faux par défaut), `clients.subsidiary_code` (texte, unique), contrôles en base |
| Vue | `drizzle/0052_internal_client_share.sql` (personnalisée, comme 0038) | `pub_projets` + `client_interne`, `filiale_code` en fin de vue |
| Règles pures | `src/domain/internal-client.ts` (+ tests) | format du code, lecture du formulaire, droit (directeur), « ce client est-il la filiale du besoin » |
| Portail | `src/domain/rights.ts` (`clientRefusedProject`, `projectAccess`), `src/server/dal/current-project.ts`, `ProjectRow.clientInternal` (`src/server/dal/projects.ts`) | un client interne n’a aucun accès au portail |
| DAL | `src/server/dal/internal-client.ts` | lecture du client du projet, filiales connues, écriture du drapeau, marquage à la commande |
| Server Function | `setInternalClientAction` (`src/features/contract/actions.ts`) | droit, validation, traductions, `revalidatePath` |
| Écran | carte « Client » de l’écran Contrat (`ProjectClientCard`, `internal-client-form.tsx`), badge « Interne » du registre (`register-cells.tsx`) | |
| Création à la commande | `createProjectFromNeed` (`src/server/dal/capex-needs.ts`), assistant prérempli (`needs-card.tsx`) | la filiale devient le client interne du projet |
| Démonstration | `seed/capex-needs.ts` (`DEMO_INTERNAL_CLIENT`, rattrapage unique dans `seed/index.ts`) | Sahel Agro Industries (SAI) |
| Contrat de partage | `src/server/db/share-contracts.ts` | colonnes de `pub_projets` ; vérifié par `share-views.test.ts`, `scripts/db-check.ts`, `postgres.integration.test.ts` |
| Traductions | `src/i18n/extra/d9-internal-client.json`, messages système `client.internalSet`, `client.internalCleared` | |

Aucun écran n’est ajouté à `src/config/screens.ts`.

## 2. Schéma

- `clients.is_internal` boolean not null default false — le client est une filiale du groupe.
- `clients.subsidiary_code` text, unique (`clients_subsidiary_code_unique` : une fiche client par filiale), contrôlé
  `^[A-Z]{3}$` (`clients_subsidiary_code_check`) et seulement sur un client interne (`clients_subsidiary_internal_check`) ; null tant que
  le code n’est pas connu.
- **Codes** : ceux d’Arche (`pub_capex.filiale_code`, `SAI`, `APM`, recopiés dans `capex_mirror.subsidiary_code` par le connecteur
  capex de R-187) et de Matrix (`pub_filiales.code`, trois majuscules, demande D21). Keystone n’a **pas** de miroir des filiales de
  Matrix (`src/server/integrations/matrix/` ne fait que déclarer le schéma) : la liste proposée vient du miroir capex, aucun code
  n’est inventé.
- Aucune reprise de données : les clients existants restent externes ; seule la démonstration reçoit un client interne (§ 6).

## 3. Où le drapeau se règle, et par qui

Keystone n’a aucun écran d’administration des clients : un client naît à la volée, tapé dans l’assistant « Nouveau projet » (ou à
l’import d’un planning), et n’est jamais modifié ensuite. Le drapeau est donc posé sur l’**écran Contrat**, nouvelle carte
**« Client »** après « Rattachement CAPEX » (aussi sur un projet sans contrat) :

- pour tous ceux qui lisent l’écran : le nom du client, le badge « Interne » et le code de filiale, ou « Client externe » ;
- pour le **directeur de portefeuille seulement** (`canSetInternalClient`) : « Type de client » (Client externe / Client interne
  (filiale du groupe)) et « Filiale » (liste des filiales connues « SAI · Sahel Agro Industries », ou « Pas encore connue »).

Le drapeau est porté par le **client** : il vaut pour tous les projets de ce client (la carte le dit). La Server Function vérifie le
rôle et `canEdit('contract')`, relit le formulaire (`parseInternalClient`) ; le DAL relit, refuse un code déjà pris par un autre client
(« Cette filiale est déjà un autre client »), écrit le client, avance `projects.updated_at` de tous ses projets (donc `maj_le` de
`pub_projets`, lecture incrémentale d’Arche), écrit une ligne d’audit (entité `client`) et un événement du fil d’activité du projet,
puis revalide.

## 4. Règles

- **Portail client (R-179, I-2b)** : un projet dont le client est interne est **refusé à tout utilisateur « client »**, même de cette
  organisation : `clientRefusedProject` et `projectAccess` (donc `getProjectContext` / `refuseClient`, la mise en page des projets, le
  « Mon accueil » client, la recherche, les notifications, Mes validations, les photos, l’import) et le projet courant
  (`resolveCurrentProject`). Une filiale suit ses projets dans l’application CAPEX. Aucune connexion client n’est construite : R-179
  reste ouvert.
- **Création à la commande (R-187)** : l’assistant prérempli part du client déjà enregistré pour le code de la filiale, sinon du nom
  publié par Arche. Dans la transaction de création, si le client du projet **est** la filiale du besoin (même code, ou même nom que
  dans `pub_capex`, casse et espaces ignorés), il devient interne avec le code de la filiale (le code n’est posé que s’il est libre) ;
  audit et fil d’activité. Si le directeur a tapé un autre client, rien ne change. « Ajouter à un projet » (ligne d’équipement sur un
  projet existant) ne touche pas le client du projet.
- **Badge « Interne »** : registre de Portefeuille › Projets (après la ligne « chef de projet · client · dates ») et carte « Client »
  de l’écran Contrat ; titre « Client interne (filiale du groupe) ».

## 5. Vue `pub_projets`

`drizzle/0052_internal_client_share.sql` recrée la vue **exactement** comme `0038_share_followup` (D02 v1 + `capex_code`,
`besoin_ref`) et ajoute en fin :

| Colonne | Type | Source |
|---|---|---|
| `client_interne` | boolean | `coalesce(clients.is_internal, false)` — faux pour un projet sans client, jamais null |
| `filiale_code` | text | `clients.subsidiary_code` (null pour un client externe ou une filiale au code inconnu) |

`WITH (security_barrier)`, noms non qualifiés, `COMMENT ON VIEW` complété (mêmes lecteurs). `maj_le` reste `projects.updated_at`
(index de K-11 inchangé) : un changement du drapeau avance les projets du client. Toujours 19 vues `pub_`.

## 6. Démonstration

- Client interne **Sahel Agro Industries** (`code3` = `SAI`, filiale `SAI`, code d’Arche de `CPX-SAI-2026-01`), sans projet : son
  besoin commandé `CPX-SAI-2026-01/B03` attend encore son projet ; « Créer le projet » part de ce client, et le projet est publié
  avec `client_interne = true`, `filiale_code = 'SAI'` (code projet `SAI-…`).
- **RCF-019 n’est pas marqué** : R-187 l’a rattaché à `CPX-SAI-2026-01`, mais son client « Health trust » (rénovation de la Clinique
  Pasteur à Lyon) n’est pas la filiale sénégalaise ; le renommer changerait le registre, les codes et les valeurs dorées sans rendre
  la démonstration plus juste. Le persona client (« Port authority ») reste externe.
- Une base de démonstration déjà semée reçoit une fois ce client (tant qu’aucun client n’est interne et qu’aucun ne porte ce nom ou
  ces codes). Seed de production : rien.

## 7. Valeurs affichées modifiées

- Écran Contrat : nouvelle carte « Client » sur chaque projet (nom du client, « Client externe » ; éditeur pour le directeur).
- Registre : badge « Interne » pour un projet de client interne (aucun dans la démonstration au départ).
- Assistant de création à la commande : client prérempli = client interne enregistré pour la filiale (même nom en démonstration).
- `pub_projets` : deux colonnes en fin ; `scripts/db-check.ts` : deux contrôles de plus (client interne de démonstration, contrôle
  en base du code de filiale).
- Valeurs dorées inchangées (les champs `clientInternal` ne sont présents que pour un client interne).

## 8. Choix faits sans question

- **Emplacement** : carte « Client » de l’écran Contrat, pas d’écran d’administration des clients (règle « pas de nouvel écran »).
- **Droit** : le directeur seul (le drapeau vaut pour tous les projets du client) ; ni Finance ni les chefs de projet.
- **Une fiche client par filiale** (code unique), comme le demande Matrix (D21 : le code est réservé à sa filiale).
- **Code facultatif** sur un client interne (production : liste vide tant qu’Arche ne publie pas `pub_capex`).
- **Liste des filiales** = miroir capex + codes déjà posés ; pas de saisie libre du code dans l’écran (le DAL accepte tout code
  `^[A-Z]{3}$`).
- **Rapprochement à la commande** par code ou par nom exact (normalisé) de la filiale ; jamais par ressemblance.
- **Démonstration** : nouveau client Sahel Agro Industries plutôt que de requalifier « Health trust » (§ 6).
- `code3` du client de démonstration = code de filiale (`SAI`), dans l’esprit de D21.

## 9. Reste à faire

- **R-179** : la connexion des clients externes au portail (décision du responsable produit et de la DSI) — inchangé.
- **Matrix** : recopier la nouvelle définition de `pub_projets` (`drizzle/0052_internal_client_share.sql`, qualifiée `keystone.`)
  dans `partage/30-keystone.sql` et ajouter `clients.is_internal`, `clients.subsidiary_code` à son contrôle des prérequis ; sans
  cela, un rejeu de son fichier 30 échoue (« cannot drop columns from view »). Aucun droit nouveau. Demande à porter par Matrix
  après validation ; ce lot ne modifie pas Matrix.
- **Demande D21 de Matrix** (`REQUESTS.md`, OUVERTE) : `pub_clients.filiale_code` et le lien `code3` ↔ `matrix.pub_filiales`. Ce lot
  pose la donnée (`clients.subsidiary_code`) mais **n’ajoute pas** la colonne à `pub_clients` ni la lecture de `matrix.pub_filiales`
  (non validé pour ce lot) : à traiter avec l’accord du responsable produit.
- Mettre à jour `REQUESTS.md` (K-05 fait en entier) et `docs/reste-a-developper.json` (R-190) à l’intégration du lot.

## 10. Vérifications (24 oct. 2026)

- `npx next typegen && npm run typecheck && npm run lint` : sans erreur.
- `npm test` : Test Files 399 passed | 1 skipped (400) · Tests 4314 passed | 11 skipped (4325).
- `npx tsx --conditions=react-server scripts/db-check.ts` : All checks passed (343 contrôles, dont les deux de R-190).
- PostgreSQL 16 local, disposition du serveur commun (socle `infra/postgres-socle/` rejoué sur une base `epc2i` neuve) :
  `npm run db:migrate` (seed demo) puis `db-check --postgres` : All checks passed ; `postgres.integration.test.ts` +
  `backup.test.ts` : 2 fichiers, 25 tests passés.
- `E2E_PORT=3650 npm run test:e2e` : 26 passed.
