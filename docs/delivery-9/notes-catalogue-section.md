# Livraison 9 — lot « section Catalogue machines »

Statut : construit sur la branche `catalogue-section` (depuis `6a1bd28`, « Merge pull request #35 ») le 25 oct. 2026.

Demande du propriétaire (25 oct. 2026) : « Si Keystone est propriétaire du catalogue machine alors il faut une section dans les
catégories qui sert uniquement à manager le catalogue machine. » Keystone est propriétaire du catalogue (décision AC-4) ; R-186
(`notes-r186-catalogue.md`) l’avait placé comme section de l’écran « Types de machine standard ». Demande explicite : l’écran est
approuvé.

## 1. Ce qui change

| Élément | Où |
|---|---|
| Section de la barre latérale « Machine catalogue » (FR « Catalogue machines ») | `SECTIONS` de `src/config/screens.ts`, clé `catalogue` |
| Écran global « Machine catalogue » | id `catalogue`, slug `catalogue/machines` → `/catalogue/machines`, icône Phosphor `Package` (`src/config/screen-icons.ts`) |
| Page | `src/app/(app)/catalogue/machines/page.tsx` |
| Fonctionnalité (déplacée de `src/features/admin/`) | `src/features/catalogue/` : `actions.ts` (ex-`catalogue-actions.ts`), `model.ts` (ex-`catalogue-model.ts`), `i18n.ts` (ex-`catalogue-i18n.ts`), `entry-detail.tsx` (ex-`catalogue-section.tsx`), `actions.test.ts` (ex-`catalogue-actions.test.ts`) ; nouveaux `catalogue-view.tsx`, `links.ts`, `catalogue.module.css`, `screen.test.ts` |
| DAL | `src/server/dal/machine-catalogue.ts` : `listCataloguePublication()` (lit la vue `pub_catalogue_machines` elle-même), `listCatalogueUses()` (lignes `project_equipments` qui citent une version) ; contrôle d’espace de travail des écrivains sur `catalogue` |
| Droits | `ROLE_SCREENS` (`src/config/role-screens.ts`), `D5_SCREEN_ROLES.catalogue` (`src/server/db/codes.ts`) |
| Export | `src/server/export/providers/catalogue.ts` (versions, lignes publiées vers Arche, lignes d’équipement) |
| Traductions | `src/i18n/extra/d9-catalogue-screen.json` (nouveau fichier, pour ne pas toucher aux fichiers du lot parallèle) |

Les fichiers ont été déplacés (`git mv`), pas copiés : il n’y a plus de code du catalogue dans `src/features/admin/`.

## 2. L’écran « Catalogue machines »

- **Indicateurs** : fiches catalogue (et nombre de types concernés), fiches proposées aux filiales (une version publiée par
  fiche), brouillons en cours, versions retirées, lignes d’équipement des projets qui ont choisi une version.
- **Filtres** (état dans l’URL) : `?type=` type de machine (code stocké ou d’affichage, sans casse ; inconnu → tous),
  `?status=published|draft|retired` (inconnu → tous). État d’une fiche : « Publiée » si une version est proposée, sinon
  « Retirée » si une version a été retirée, sinon « Brouillon » ; le filtre « Brouillon » garde toute fiche qui a un brouillon en
  cours (EMP-40T : publiée v1, brouillon v2 — la ligne affiche « v2 · Brouillon » sous l’état).
- **Liste** de toutes les fiches, tous types confondus : code, type, variante, libellé, version courante (la publiée, sinon la
  dernière), état, prix indicatif, délai type, mise à jour. Un clic ouvre la fiche (`?entry=` ; inconnue ou filtrée → la
  première de la liste).
- **Fiche** : ses versions (brouillon, publiée, retirée) avec les actions de R-186 inchangées (modifier le brouillon, publier,
  nouvelle version, retirer, abandonner le brouillon) ; en lecture seule, les lignes de `pub_catalogue_machines` pour ce code
  (ce que lit Arche : versions publiées et retirées, jamais un brouillon, avec `statut` et `maj_le`) et les lignes d’équipement
  des projets qui ont choisi une version (lien vers le Contrat du projet).
- **Action principale** « Nouvelle fiche catalogue » (directeur et responsable ingénierie) : le formulaire demande désormais le
  type de machine (types actifs ; présélectionné par `?type=`), puis ouvre la fiche créée.

## 3. Écran « Types de machine standard »

La section « Catalogue machines » est retirée de l’éditeur du type. Elle est remplacée par une carte courte : « Les fiches
catalogue proposées aux filiales se gèrent sur l’écran Catalogue machines · EMP · Fiches catalogue · 1 » et un bouton « Ouvrir
le catalogue machines » qui ouvre `/catalogue/machines?type=<type>`. L’écran garde phases standard (avec la case « Par
équipement », inchangée), catégories de coûts, systèmes ITP et REX. La Server Function de la case « Par équipement »
(`setMachineTypePhaseScopeAction`) est passée dans `src/features/admin/actions.ts`, avec les autres fonctions de l’éditeur de
type (mêmes droits : directeur, chef de projet, responsable ingénierie, qualité).

## 4. Place de la section

Juste après « Référentiel technique » et avant « Achats & stock » : le catalogue est bâti sur les types de machine et tenu par
l’ingénierie (le responsable ingénierie a « Référentiel technique » dans son espace de travail), et il précède les achats et
l’après-vente dans la chaîne produit → commande → parc. Une section d’un seul écran, comme demandé (« qui sert uniquement à
manager le catalogue machine »).

## 5. Droits

- **Voir l’écran** (espace de travail) : les rôles de « Types de machine » — directeur, chef de projet, responsable ingénierie,
  qualité. Testé : la liste des personas qui voient `catalogue` est celle de `mtypes`.
- **Modifier** : directeur et responsable ingénierie (`canEditCatalogue`, choix 5, inchangé), contrôlé dans la Server Function
  (`getScreenAccess('catalogue')` puis le rôle) et de nouveau dans le DAL (`requireWorkspace('catalogue', …)` puis le rôle).
  Le chef de projet et la qualité lisent, avec la note « Seuls le directeur et le responsable ingénierie modifient le catalogue
  machines ».
- **Finance, achats, chef de service, membre** : pas dans leur espace de travail ; ils peuvent ouvrir l’écran par son adresse, en
  lecture seule avec le bandeau « Hors de mon espace de travail » (règle commune). Choix : la Finance ne reçoit pas l’écran,
  par cohérence avec « Types de machine » qu’elle n’a pas ; le prix indicatif est un prix de catalogue (classe E50), pas une
  donnée financière du projet. Il n’y a pas de persona « commercial ».
- **Client** : renvoyé à son accueil (R-042), écran et export refusés (403).

## 6. Valeurs affichées modifiées

- Refus hors espace de travail des écritures du catalogue : « Le catalogue machines est en lecture seule pour vous » (au lieu de
  « Les types de machines sont en lecture seule pour vous ») — `src/features/catalogue/actions.test.ts` mis à jour.
- La création d’une fiche renvoie aussi son code (`{ ok, toast, code }`), pour ouvrir la fiche créée.
- Écran Types de machine : la section du catalogue devient la carte de lien ci-dessus.
- Barre latérale : une section de plus pour le directeur, le chef de projet, le responsable ingénierie et la qualité.
- Aucune valeur dorée changée ; données de démonstration inchangées (EMP-40T v1 publiée + v2 brouillon, MEMU-16 v1 publiée,
  SPUR-2X v1 retirée) ; aucune migration.

## 7. Nombre d’écrans : 60

Mis à jour : `src/config/screens.test.ts` (60), `src/server/export/providers/providers.test.ts` (60, et `catalogue` dans les
écrans refusés au client), `src/server/dal/delivery5.test.ts` (clés de `D5_SCREEN_ROLES`), `tests/e2e/01-platform.spec.ts`
(`/catalogue/machines` dans le parcours de tous les écrans sous CSP), `src/components/app/shell/coming-soon.tsx` (spécification
09), `docs/guide/directeur.md` (« les 60 écrans », section citée).

Mentions de « 59 écrans » laissées telles quelles (historiques ou hors de ce lot) : `CLAUDE.md` (« Routing: … holds the 59
screens »), `README.md` (livraison 6), `docs/spec/11-data-model.md`, `docs/DELIVERY-8-PLAN.md`, `docs/delivery-8/lot-briefs.md`,
`docs/delivery-7/notes-platform-web.md`, `docs/delivery-6/*`, `docs/reste-a-developper.json` (non modifié par consigne).

## 8. Choix faits sans question

- Identifiants : écran `catalogue`, section `catalogue`, adresse `/catalogue/machines`, icône `Package`.
- Une ligne par fiche (code) dans la liste, la version courante étant la publiée, sinon la plus récente ; les versions sont dans
  la fiche.
- Le filtre « Brouillon » retient les fiches qui ont un brouillon en cours (pas seulement celles qui n’ont jamais été publiées).
- Le rappel de ce qui est publié vers Arche est lu dans la vue `pub_catalogue_machines` elle-même (et non recalculé), pour
  montrer exactement le contrat K-01.
- Sous-titre de l’écran (fil d’Ariane) : « versions publiées aux filiales (application CAPEX) ».
- Export Excel / CSV de l’écran (tout écran du registre a un export) : versions des fiches filtrées, lignes publiées vers Arche,
  lignes d’équipement.
- L’audit garde la référence d’objet « Type de machine … » des écritures du catalogue (inchangée).

## 9. Reste à faire

- Mettre à jour `docs/reste-a-developper.json` et la page publiée à l’intégration (non fait ici, par consigne).
- `CLAUDE.md` (« 59 screens ») à passer à 60 à l’intégration si le propriétaire le souhaite.
