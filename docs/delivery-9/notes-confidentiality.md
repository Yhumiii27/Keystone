# Confidentialité des projets et équipe projet (ING-29, 27 nov. 2026)

> Décisions du propriétaire du 27 nov. 2026 (citées dans `docs/DECISIONS.md`, « Confidentialité des projets et équipe projet »).

## 1. Règles

- `projects.confidentiality` : `normal` (défaut, tous les projets existants) | `confidential` (contrainte
  `projects_confidentiality_domain`, migration `0085_project_confidentiality`).
- Fixé par les responsables du projet (chef de projet titulaire, co-chef, adjoint) et le directeur (`canSetConfidentiality`),
  sur Ressources du projet › « Équipe projet », bouton « Confidentialité » (panneau latéral) ; Server Function
  `setProjectConfidentialityAction` (`src/features/team/confidentiality-actions.ts`), écriture `setProjectConfidentiality`
  (`src/server/dal/project-confidentiality.ts`) : une ligne d'audit avant / après (journal en ajout seul) et une activité.
- **Équipe d'un projet** (`projectTeam`, `src/domain/confidentiality.ts`) = union de :
  - l'équipe nommée R-041 (chef de projet titulaire et lignes `project_members` : les personnes ajoutées par le chef de projet) —
    origine `equipe` ;
  - les personnes affectées à une tâche du projet (`tasks.assignee_person_id`) ou nommées sur une activité du planning
    (`activity_assignments.person_id`) — origine `affectation` ;
  - les parties prenantes liées à une personne interne (`stakeholders.person_id`, personne sans organisation cliente) — origine
    `partie_prenante`. Un contact client n'est jamais de l'équipe.
- **Visibilité** (`canSeeProject`) : un projet confidentiel n'est vu que par son équipe ; le directeur n'est pas une exception
  (choix par défaut CF-1, `DIRECTOR_SEES_CONFIDENTIAL = false`).

## 2. Dans la couche d'accès aux données

- `listProjects()` / `getProject()` (`src/server/dal/projects.ts`) retirent les projets cachés au lecteur de la requête
  (`hiddenProjects`, `src/server/dal/project-visibility.ts`). Tout ce qui part du registre en hérite : pages du projet (404 par
  `getProjectContext`), sélecteur et pastilles de la barre latérale, registre, portefeuille et ses totaux, tableaux de bord,
  carte, flux de trésorerie, recherche globale, exports (`buildExportContext` → 404), projet courant (`resolveCurrentProject`).
- `listAllProjects()` : lecture système (jobs, publications, lectures partagées entre lecteurs mises en cache).
- Lecteurs transverses qui ne partent pas du registre : `visibleProjectRows(colonne)` — tâches (`listTasks`), commandes
  (`listAllPurchaseOrders`, recherche), demandes de ressources (`listResourceRequests`).
- Hors requête (jobs, scripts, graine, tests sans requête), rien n'est caché (lecture système). Un job qui construit un document
  pour une personne lit « comme elle » (`readAsViewer`) : rapports programmés par projet et de portefeuille (un document de
  portefeuille par destinataire).
- Limite connue (CF-3) : les compteurs globaux partagés entre lecteurs (documents à valider, factures bloquées, stock, SAV) restent
  calculés sur toute l'entreprise.

## 3. Publications demandées à Matrix (M-18 : aucune migration ne crée de vue `pub_`)

Requêtes de référence : `src/server/publications/definitions.ts` (exécutées sur une base migrée et semée par
`definitions.test.ts` ; forme serveur avec `keystone.`), recopiées dans `data/publications-depot.json` de Matrix.

### `keystone.pub_projets` + `confidentialite`

Définition de 0071 colonne pour colonne, puis `confidentialite` en fin de vue : `'normal'` | `'confidentiel'`. Les lecteurs
(Ingenium, Codex, Crucible…) appliquent la confidentialité du projet à leurs propres objets (documents d'un projet confidentiel…).

### `keystone.pub_equipes_projets` (nouvelle, contrat v1)

Une ligne par projet, personne, origine, activité et rôle. Projets confidentiels compris : les lecteurs filtrent sur
l'appartenance (un projet confidentiel ne se montre qu'à son équipe). Données de l'annuaire interne seulement ; jamais un contact
externe ni un rôle contractuel (`persons.is_contract_role`).

| Colonne | Type | Contenu |
|---|---|---|
| `projet_code` | text | code du projet Keystone (`HLT-026`) |
| `matricule` | text | matricule Cursus (`EMP-0018`), null tant que l'annuaire ne l'a pas donné |
| `personne_nom` | text | nom complet (ou forme courte) |
| `email` | text | adresse professionnelle |
| `origine` | text | `equipe` (équipe nommée R-041) \| `affectation` (tâche ou activité du planning) \| `partie_prenante` |
| `activite` | text | activité (ou titre de la tâche) d'une affectation ; null sinon |
| `personne_clavis_id` | text | identifiant de la personne chez Clavis (`oid` du jeton, `users.entra_object_id`), null avant sa première connexion |
| `role` | text | rôle dans l'équipe nommée (`pm`, `deputy`, `referent`, `team`) ou rôle saisi de la partie prenante ; null pour une affectation |
| `maj_le` | timestamptz | dernière modification connue de la ligne |

Lecteurs proposés : `ingenium_app`, `codex_app`, `crucible_app`, `vigie_app`, `arche_app`, `vector_app`, `modulus_app`,
`matrix_app`.

## 4. Démonstration

FTU-052 « Fleet Telematics Upgrade » devient un projet R&D confidentiel (`src/server/db/seed/confidential.ts`, rattrapé une fois
sur une base de démonstration existante) : chef de projet A. Naveau, Antoine Girard (référent ingénierie) et Marie Lefebvre
(directrice, ajoutée à l'équipe). Les autres profils ne le voient pas.

## 5. Suite pour Codex (note)

Codex lira `confidentialite` dans `keystone.pub_projets` et l'équipe dans `keystone.pub_equipes_projets` (liens Matrix), puis
restreindra les documents rattachés à un projet confidentiel (`project_code`) aux membres de l'équipe — par exemple niveau
minimal « Confidentiel » imposé et lecture réservée à l'équipe, rapprochement par `personne_clavis_id` ou `email` — et devra
garder ces documents hors de ses propres vues `pub_` lues par des outils non concernés.
