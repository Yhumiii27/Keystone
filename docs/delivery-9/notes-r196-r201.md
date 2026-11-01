# Livraison 9 — lot E « projet R&D et tâches récurrentes » (R-196, R-201)

Statut : construit sur la branche `lotE-rd-recurring` (depuis `e239d2f`) le 1er nov. 2026, après les réponses de cadrage du
responsable produit du même jour (`docs/DECISIONS.md` § « Cadrage des prochains lots », `docs/decisions/questions-cadrage-lots-l9.json`) :

- **K-196** — « Comment reconnaître un projet R&D (pour le filtre de Crucible) ? » → « Une nature de projet “R&D” choisie à la création
  du projet » ★ ;
- **K-201** — « Tâches récurrentes dans “Mon travail” ? » → « Lancer » ★.

Migrations : `drizzle/0070_project_category_task_recurrence.sql` (générée : colonnes et contrôles) et
`drizzle/0071_project_category_share.sql` (personnalisée : `pub_projets` + `categorie`). Numéros donnés par drizzle sur la base
`e239d2f` (dernière migration publiée : 0069) ; à renuméroter à l’intégration si un autre lot a pris 0070/0071.

## 1. R-196 — catégorie « R&D » d’un projet (demande Crucible K-3)

### Ce qui change

| Élément | Où | Rôle |
|---|---|---|
| Colonne | `projects.category` (0070) | `'client'` (défaut, tous les projets existants) ou `'rd'` ; contrôle `projects_category_check` |
| Vue | `pub_projets` + `categorie` en fin de vue (0071) | définition de 0052 reprise colonne pour colonne, `security_barrier`, `COMMENT ON VIEW` mis à jour |
| Contrat | `src/server/db/share-contracts.ts` | `categorie` ajoutée en fin de `pub_projets` ; vérifiée par `share-views.test.ts`, `scripts/db-check.ts` (« categorie never null, client or rd ») |
| Règles pures | `src/domain/project-category.ts` | liste, libellés, droit `canSetProjectCategory` (= `canSetCapexLink`) |
| Assistant | `new-project-wizard.tsx` (étape 1, sélecteur « Catégorie du projet »), `draft.ts` (`category`, absent = client, inconnu refusé), `createWizardProject` | la catégorie est posée à la création ; la ligne d’audit de création porte « · R&D project » et `after: { category }` |
| Fiche projet | carte « Catégorie du projet » de l’écran Contrat (`category-card.tsx`, `category-form.tsx`, `category-actions.ts`) | modifiable ensuite, audit avant / après et fil d’activité (`project.category`) |
| DAL | `src/server/dal/project-category.ts` | lecture, écriture auditée |
| Registre | `ProjectRow.rd`, `RegisterRow.rd`, badge « R&D » sous le nom, filtre « Tous les projets / Projets clients / Projets R&D » (`?cat=client|rd`) | filtre affiché dès qu’un projet R&D existe (ou que `?cat=` est posé) |

### Décisions prises sans demander

- **Colonne distincte de `projects.kind`.** `kind` (publié `nature`, contrat Matrix D02) vaut `client` / `internal` et désigne les codes
  hors projet de Cursus (INT-PROD, ÉCOLE). Lui ajouter `rd` aurait changé le domaine d’une colonne de contrat lue par Matrix, Cursus,
  Vigie, Codex, Arche et Crucible. La catégorie est donc une nouvelle colonne, publiée en fin de vue sous le nom `categorie`
  (cohérent avec les colonnes françaises de la vue), valeurs `client` | `rd`.
- **Distincte aussi du type de machine « R&D »** (`rnd`), qui dit ce que le projet fournit, par ligne d’équipement (R-185) ; un projet
  R&D peut fournir un type EMP, et un type « R&D » n’implique pas un projet R&D. Aucune déduction automatique de l’un vers l’autre.
- **Qui la change après la création** : le directeur et les responsables du projet (chef de projet titulaire, co-chef, adjoint) qui
  voient l’écran Contrat — les mêmes que le rattachement CAPEX et les équipements ; ni Finance, ni un membre de l’équipe, ni le client,
  jamais sur un projet en lecture seule ni hors de l’espace de travail. À la création, qui crée le projet (directeur, chefs de projet).
- **Où sur la « fiche projet »** : l’écran Contrat, à côté des cartes Équipements, Rattachement CAPEX et Client (aucun écran ajouté).
- **Démonstration : aucun projet R&D.** ERP-202 porte le type de machine « R&D » du prototype mais c’est une migration d’ERP, pas un
  projet de recherche ; aucun autre projet de démonstration n’est plausible. Le filtre du registre reste donc masqué en démonstration
  jusqu’à ce qu’un projet R&D soit créé ou modifié.
- `maj_le` de `pub_projets` reste `projects.updated_at` (un changement de catégorie la fait avancer).

### Reste

- Matrix : rafraîchir `partage/30-keystone.sql` avec la définition de 0071 (comme pour 0052) ; Crucible lit `categorie = 'rd'`.
  Aucune entrée `REQUESTS.md` écrite (règle inter-dépôts : à présenter au responsable produit d’abord).
- **R-196 : fait** une fois intégré.

## 2. R-201 — tâches récurrentes dans « Mon travail »

### Ce qui change

| Élément | Où | Rôle |
|---|---|---|
| Colonnes | `tasks.recurrence_kind`, `recurrence_interval`, `recurrence_anchor`, `recurrence_until`, `recurrence_previous_task_id` (0070) | règle et lien d’une occurrence à la précédente ; index unique sur `recurrence_previous_task_id` (une seule occurrence suivante par tâche), contrôles de cohérence |
| Règles pures | `src/domain/task-recurrence.ts` (+ `task-recurrence.test.ts`) | validation (`parseRecurrence`), dates de l’occurrence suivante (`nextOccurrence`), mois bornés (`addMonthsClamped`) |
| DAL | `src/server/dal/task-recurrence.ts` | jalons du projet, calendrier du projet, création de l’occurrence suivante (`createNextOccurrence`), réglage auditée (`setTaskRecurrence`), liens de la série |
| Clôture | `setTaskStatus`, `setTaskProgress` (`src/server/dal/tasks.ts`), `setActivityTodoDone` (`activity-todos.ts`) | dans la transaction qui passe la tâche à « Terminé » : segment de statut, « Marquer terminé », case de la liste, tableau (glisser / « Déplacer vers »), % à 100, case du tiroir du Plan |
| Server Function | `setTaskRecurrenceAction` (`src/features/mywork/actions.ts`) | mêmes droits que les autres modifications de la tâche (`gate(…, 'edit')` : l’assigné ou le directeur, dans l’espace de travail) ; tâche ouverte seulement |
| Fiche tâche | carte « Récurrence » (`task-sheet.tsx`) | règle en clair, « Fait suite à T-… » / « Occurrence suivante T-… », formulaire (répétition, intervalle, fin facultative), arrêt |
| Vues | liste, tableau, calendrier (`my-work-body.tsx`) | marque ↻ avec la règle en clair (titre et `aria-label`) ; l’occurrence suivante est une tâche ordinaire, donc visible partout |
| Audit | messages système `task.recurrenceSet`, `task.recurrenceStopped`, `task.nextOccurrence`, `task.recurrenceEnded` | avant / après sur le réglage ; création de l’occurrence auditée sur la nouvelle tâche |

### Règle (décisions prises sans demander)

- **Chaque semaine / chaque mois**, toutes les *n* semaines / *n* mois (1 à 12), comptées depuis l’**ancre** = l’échéance de la tâche au
  moment où la règle est posée. Pas de dérive : une règle mensuelle ancrée le 31 janv. tombe le 28 févr., puis le 31 mars. Changer
  seulement la date de fin garde l’ancre ; changer la répétition ou l’intervalle ré-ancre sur l’échéance courante.
- **À chaque jalon du projet** : échéance = prochain jalon du planning du projet (non terminé) après l’échéance de l’occurrence close —
  date de l’activité liée, sinon la date que dessine le planning d’après le mois du jalon (même règle que les rappels R-199,
  `reminders.ts`). Plus de jalon : la série s’arrête (audit « Recurrence ended with T-… »).
- **Pas d’arriéré** : l’occurrence suivante est la première date de la série après l’échéance close **et pas avant la date métier**
  (`businessToday()`) ; une tâche close en retard ne crée pas les occurrences manquées.
- **Jours ouvrés** : l’échéance et le début sont reportés au jour ouvré suivant du **calendrier du projet** (`projects.calendar`,
  défaut « Standard 5j · 8h », jours fériés et exceptions compris). Le début garde l’avance de l’occurrence close (échéance − début, en
  jours calendaires), jamais avant la date métier ni après l’échéance.
- **Fin facultative** : aucune occurrence due après la date de fin (refusée si avant l’échéance de la tâche).
- **Ce qui est recopié** : titre, description, assigné (ou rôle contractuel), projet, activité, priorité, estimation, étiquettes,
  département, origine ; la liste de contrôle est recopiée **décochée**. Pas les heures, commentaires, fichiers ni saisies de temps.
  Statut « À faire », 0 %. La nouvelle occurrence porte la règle (la série continue d’elle-même).
- **Une seule fois** : rouvrir puis reclore une occurrence ne crée rien de plus (index unique + contrôle). Une tâche close ne change
  plus de règle (« Définissez la récurrence sur une tâche ouverte ») : la série se règle sur l’occurrence ouverte.
- **Arrêter** = choisir « Ne se répète pas » sur l’occurrence ouverte ; l’historique de la série reste (liens précédente / suivante).
- **Droits** : comme pour modifier la tâche (assigné ou directeur, dans l’espace de travail) ; aucune notification (l’assigné est
  celui qui vient de clore la tâche, sauf le directeur) — à revoir si le responsable produit le souhaite.

### Reste

- « Automatiser les tâches répétitives » au-delà de la récurrence (règles « si / alors ») : K-207 « Plus tard » (après R-094).
- **R-201 : fait** une fois intégré.

## 3. Vérifications

- `npm run typecheck`, `npm run lint` au vert ; `npm test` : 440 fichiers, 4 645 tests au vert (22 ignorés) — un seul échec, `matrix/declare-schema.test.ts`
  (délai du hook dépassé sous la charge de la machine), au vert relancé seul ; `scripts/db-check.ts` au vert (contrôle R-196 ajouté) ;
  build de production (`KEYSTONE_DIST_DIR=.next-ci`) au vert.
- Libellés des règles : « Every week » / « Every month » (FR « Chaque semaine », « Chaque mois ») — « Weekly » existait comme étiquette
  de document traduite telle quelle dans le coffre documentaire (`docs/render.test.ts`) ; une entrée « Weekly → Hebdomadaire » l’aurait changée.
- Nouveaux tests : `src/domain/task-recurrence.test.ts`, `src/features/mywork/recurrence.test.ts`,
  `src/features/contract/category-actions.test.ts`, `src/features/projects/wizard-category.test.ts`, cas `pub_projets` de
  `src/server/db/share-views.test.ts`.

## 4. Fichiers partagés touchés (conflits possibles à l’intégration)

`src/server/db/schema/portfolio.ts`, `src/server/db/schema/work.ts`, `drizzle/meta/*`, `src/server/db/share-contracts.ts`,
`src/server/db/share-views.test.ts`, `scripts/db-check.ts`, `src/domain/system-messages.ts` (clés ajoutées en fin),
`src/i18n/extra/index.ts`, `src/i18n/same-in-french.json` (« R&D »), `src/server/dal/tasks.ts`, `src/server/dal/activity-todos.ts`,
`src/server/dal/projects.ts`, `src/server/dal/projects-register.ts`, `src/features/mywork/{actions,model,i18n,my-work-body,task-sheet}.ts*`,
`mywork.module.css`, `src/features/projects/{draft,new-project-wizard,register,register-cells,register-model}.ts*`,
`src/app/(app)/projects/[code]/contract/page.tsx`, `src/app/(app)/portfolio/projects/page.tsx`.

## 5. Questions ouvertes pour le responsable produit

1. Un projet R&D peut-il avoir un client externe (R&D financée par un client) ? Aujourd’hui oui : la catégorie est indépendante du client.
2. Faut-il prévenir l’assigné (cloche) quand une occurrence suivante est créée par quelqu’un d’autre (le directeur) ?
3. La règle « à chaque jalon » doit-elle se limiter aux jalons CAPEX ou à une liste choisie de jalons ? Aujourd’hui : tous les jalons
   non terminés du planning du projet.
