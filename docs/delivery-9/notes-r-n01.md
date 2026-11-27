# R-N01 — Tables déclarées dans le schéma `keystone` (`pgSchema(...).table(...)`) : évaluation et proposition

> 27 nov. 2026. Point R-N01 du reste à faire (Norma `reste-a-faire/keystone.json`, audit Norma 1.0, Keystone#81) :
> `norma/REGLES.md` § 4 demande des tables déclarées dans le schéma de l'outil (`pgSchema(...).table(...)`, objet de schéma
> jamais exporté). **Aucun code n'est changé** : le passage n'est pas sûr sans décision du responsable produit (ci-dessous).

## 1. Situation actuelle

- 252 tables déclarées par `pgTable(...)` dans `src/server/db/schema/` ; aucun `pgEnum`, `pgView` ni `pgSchema`.
- 85 migrations publiées (`drizzle/0000` à `0084`), écrites par drizzle-kit avec `"public"."…"` ; l'instantané
  `drizzle/meta/0084_snapshot.json` range les 252 tables dans le schéma `""` (public). 11 migrations créent des vues `pub_`
  (déjà appliquées, reprises par Matrix depuis M-18), 5 créent des fonctions (dont `"public"."pub_editer"`, M-19).
- **Serveur commun** (décisions du 18 oct. 2026, `src/server/db/server-schema.ts`) : le migrateur propre
  (`applyServerMigrations`) remplace `"public".` par `"keystone".`, chaque connexion pose `search_path=keystone` ; tables,
  fonctions et journal (`keystone.__drizzle_migrations`) sont donc déjà **dans le schéma `keystone`**. L'écart avec Norma est
  dans la *déclaration*, pas dans la base du serveur.
- **PGlite** (développement, tests, application Mac `Keystone.app`) : tables dans `public`, journal de Drizzle dans
  `drizzle`, migrateur de Drizzle (`src/server/db/open.ts`). Des bases PGlite existantes portent des données (dossier `.data`
  des postes, données de l'application Mac).

## 2. Ce que changerait `pgSchema('keystone').table(...)`

1. **Requêtes** : Drizzle qualifierait chaque table (`"keystone"."projects"`). Sur le serveur, rien ne change (les tables y
   sont). En PGlite, toutes les requêtes échoueraient tant que les tables restent dans `public`.
2. **drizzle-kit** : la prochaine `npm run db:generate` comparerait l'instantané 0084 (tables dans public) au nouveau schéma
   (tables dans `keystone`) et proposerait, table par table, de les **déplacer** (`ALTER TABLE "public"."x" SET SCHEMA
   "keystone"`) — sans `CREATE SCHEMA`, l'objet de schéma n'étant pas exporté. Ce SQL :
   - sur le serveur, après réécriture `"public".` → `"keystone".`, devient `ALTER TABLE "keystone"."x" SET SCHEMA "keystone"`,
     que PostgreSQL **refuse** (« already in schema ») : la migration échouerait au déploiement ;
   - en PGlite, échouerait faute de schéma `keystone` (jamais créé par une migration, Norma § 4).
   Il faudrait donc une migration écrite à la main et un migrateur qui la saute sur le serveur — une exception à « migrations
   générées », et une migration dont l'effet diffère selon la base.
3. **PGlite** : il faudrait créer le schéma `keystone` à l'ouverture, y déplacer tables, séquences, fonctions (journal
   d'audit, `pub_editer`) et vues `pub_` d'une base existante (code de reprise, hors migration, avec sauvegarde), puis
   `search_path=keystone, public`. Déplacer les vues `pub_` en PGlite touche des objets que Norma § 5 réserve à Matrix (sans
   effet sur le serveur, mais à faire valider).
4. **Tests** : toute la suite ouvre des bases PGlite neuves par les migrations ; les tests de forme (`formats.test.ts`,
   `fk-indexes.test.ts`, `pub-views-owned-by-matrix.test.ts`, `postgres.integration.test.ts`, contrats `share-*`) lisent
   `public` ou comparent le schéma : à reprendre.

## 3. Options

| Option | Ce qui est fait | Risques | Effort |
| --- | --- | --- | --- |
| **A. Statu quo documenté** (recommandée à court terme) | Garder `pgTable` + réécriture au serveur ; inscrire une dérogation dans `norma/dependances.json` / Norma (Keystone déclare `public`, le serveur range dans `keystone`) ; ajouter un test qui prouve qu'aucune table n'est dans `public` sur le serveur après `db:migrate`. | Aucun sur les données ; l'écart reste un écart de forme. | S |
| **B. Même disposition partout, sans changer les déclarations** | PGlite prend aussi le migrateur du serveur : schéma `keystone` créé à l'ouverture (PGlite le permet), `"public".` → `"keystone".`, journal `keystone.__drizzle_migrations`, `search_path=keystone` ; reprise automatique d'une ancienne base PGlite (sauvegarde puis déplacement, comme Codex au 21 oct.). | Reprise des bases PGlite existantes (application Mac) ; déclarations toujours en `pgTable`. | M |
| **C. Passage complet à `pgSchema`** | B, puis `const keystone = pgSchema('keystone')` non exporté et `keystone.table(...)` pour les 252 tables ; instantané drizzle-kit **réaligné** par une migration sans SQL (ou SQL neutralisé au serveur) ; tests de forme repris. | Migration particulière (exception à « générées, jamais modifiées ») ; un oubli bloquerait `db:migrate` sur le serveur commun. Le passage doit être répété sur une copie restaurée de la base du serveur avant déploiement. | L |

## 4. Ce que le responsable produit doit décider

1. Accepter **A** (dérogation inscrite dans Norma, aucune migration) ou demander **B** puis **C** ?
2. Pour B / C : accepte-t-on la reprise automatique des bases PGlite existantes (sauvegarde puis déplacement vers `keystone`),
   notamment celle de l'application Mac ?
3. Pour C : accepte-t-on **une** migration d'alignement de l'instantané dont le SQL n'est pas celui de drizzle-kit (ou qu'un
   migrateur saute sur le serveur), et sa répétition préalable sur une copie de la base du serveur (Matrix) ?
4. Le déplacement des vues `pub_` en PGlite (base locale seulement) est-il à faire valider par Matrix ?

Sans décision, Keystone reste en **A** de fait : le serveur commun range déjà tout dans `keystone`, rien n'y change.
