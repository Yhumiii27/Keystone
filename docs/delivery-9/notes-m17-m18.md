# Demandes Matrix M-17 et M-18 — échanges entre outils décidés par Matrix

> 2 nov. 2026. Demandes de Matrix dans `REQUESTS.md` : M-17 (30/10/2026) et M-18 (01/11/2026, qui remplace le point 3 de M-17).
> Traitées à la demande du responsable produit.

## 1. Règles retenues (reprises dans `CLAUDE.md`, « Exchanges with the other tools »)

- **Lire un autre outil** : uniquement par ses vues `pub_`, jamais par ses tables. Un nouveau besoin (lecture d’une vue,
  exécution d’une fonction) se déclare comme **lien** dans Matrix : entrée courte dans le `REQUESTS.md` de Matrix (outil,
  objet `schéma.pub_…`, nature `lecture` ou `execution`, justification), après « validé » du responsable produit. Plus de
  demande de recopie de vue.
- **Écrire chez un autre outil** : uniquement par son API (connecteur et file d’envoi) ou par une fonction `pub_` qu’il
  fournit ; jamais `INSERT` / `UPDATE` / `DELETE` dans son schéma.
- **Vues `pub_` de Keystone** : définies par Matrix (écran « Publications », rôle `matrix_gestion`). Aucune nouvelle
  migration ne crée, remplace, modifie, commente ni supprime une vue `pub_`, ni n’accorde de droit au rôle d’un autre outil.
  Les migrations jusqu’à 0074 continuent de créer les 22 vues existantes sur une base neuve (PGlite, démonstration, serveur
  vierge). Une nouvelle publication ou une colonne de plus se demande à Matrix. Avant de modifier ou supprimer une colonne lue
  par une vue `pub_`, prévenir Matrix ; une colonne publiée ne se retire ni ne se renomme (vue `…_v2` sinon).
- **Écritures d’autres outils chez Keystone** : par l’API de Keystone, ou par une fonction `pub_<verbe>_<objet>` créée par
  migration (`SECURITY DEFINER`, `SET search_path = keystone, pg_temp`, appelant identifié par `session_user`, règles et
  journal d’audit de Keystone appliqués, `REVOKE EXECUTE … FROM PUBLIC`) ; le droit de l’exécuter est un lien décidé dans Matrix.

Garde-fou : `src/server/db/pub-views-owned-by-matrix.test.ts` refuse toute migration postérieure à 0074 qui toucherait une vue
`pub_` ou accorderait un droit au rôle d’un autre outil, et vérifie que les migrations antérieures définissent exactement les
22 vues reprises par Matrix.

## 2. Inventaire des échanges (relevé du 2 nov. 2026 sur `main`)

| Sens | Outil | Objet | Moyen | Conforme |
|---|---|---|---|---|
| Lecture | Matrix | `matrix.pub_filiales` (miroir des filiales, D21) | vue `pub_` | oui |
| Lecture | Matrix | `matrix.pub_organigramme` | vue `pub_` | oui |
| Lecture | Arche | `arche.pub_capex`, `arche.pub_besoins_machines` (connecteur capex, R-187) | vues `pub_` | oui |
| Écriture | Matrix | déclaration du schéma (`matrix.schema/1`) | API `MATRIX_URL` (ou dossier) | oui |
| Écriture | Vigie, Cursus, Codex | approbations ECO / NCR, relances, dépôts de documents | API, connecteurs à file d’envoi | oui |
| Écriture reçue | Cursus | événements RH (flux F03) | API de Keystone (`/api/cursus/v1`) | oui |
| Écriture reçue | Vigie | retours par ses connecteurs | API | oui |
| Publication | — | 22 vues `pub_` de Keystone (liste de M-18) | migrations 0035 à 0071, reprises par Matrix | oui |

Aucune lecture d’une table d’un autre outil ni aucune écriture SQL dans un autre schéma n’a été trouvée : rien à signaler à
Matrix. Les demandes de Keystone en cours chez Matrix (Power BI `bi_reader`, colonne `categorie` de `pub_projets`, entrée du
01/11/2026) restent valables : sous M-18, Matrix applique lui-même la définition et le droit.

## 3. Suite

- Matrix reprend les 22 vues (`partage/14-reprise-publications.sql`) : elles passent au rôle `matrix_gestion`, leurs
  lecteurs gardent leur droit ; rien ne change dans Keystone.
- Un futur besoin de publication (nouvelle vue ou colonne) passera par une entrée dans le `REQUESTS.md` de Matrix.
