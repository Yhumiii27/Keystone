# Livraison 9 — lot « s-misc » : réponses S-03, S-15, S-19 du questionnaire de suivi

Réponses du responsable produit au questionnaire de suivi de la livraison 9 (`docs/DECISIONS.md`, dernière section ;
`docs/decisions/questions-suivi-l9.json`). Branche `s-misc`. Migration **0075** (`drizzle/0075_drop_client_communications.sql`,
numéro donné par drizzle sur une base dont la dernière migration publiée est 0074 ; à renuméroter à l’intégration si un
autre lot a pris 0075).

## 1. S-03 (décision D-5, R-171) — suppression de l’ancien journal des échanges client

Réponse : « Oui, supprimer ★ ».

- **Vérification préalable** : aucune vue `pub_` ne lit `client_communications` (la table n’apparaît que dans
  `drizzle/0005_sloppy_talos.sql`, sa création) ; aucune autre table ne la référence (ses clés étrangères vont vers
  `projects` et `persons`, pas l’inverse).
- **Migration 0075** générée par `npm run db:generate` (renommée `0075_drop_client_communications`, journal mis à jour) :
  `DROP TABLE "client_communications";` — **sans `CASCADE`** (drizzle l’ajoutait) : si un objet dépendait de la table sur un
  serveur (une vue créée hors des migrations), la migration échouerait au lieu de le supprimer en silence.
- **Retirés** : le schéma (`src/server/db/schema/client.ts`, remplacé par un commentaire), le DAL
  `src/server/dal/client-comms.ts` (`listClientCommunications`, `addClientCommunication`,
  `setClientCommunicationFollowUpDone`, `openClientFollowUps`), les règles pures `src/domain/client-comms.ts` (formulaire,
  droits, état des relances — plus aucun lecteur hors des tests), les codecs `clientCommChannel` / `clientCommDirection`
  (`src/server/db/codes.ts`), leurs tests (`ch4-misc.test.ts`, `chapter4-foundation.test.ts`), l’entrée de
  `audit-coverage.test.ts`, la contrainte unique de `transactions.ts`, les trois clés étrangères de `fk-without-index.json`,
  et dans `scripts/db-check.ts` le compte de la table et l’écriture « client exchange COM-001 ».
- Les anciennes lignes d’audit (`entityType = 'client_communication'`) restent dans `audit_entries` (journal append-only).
- Les entrées i18n de l’ancien journal (« Phone », « From the client »…) restent : plusieurs servent ailleurs, et les clés
  sans littéral ne font échouer aucun test.

**R-171 (volet D-5) : fait** une fois intégré.

## 2. S-15 (R-201) — prévenir l’assigné de l’occurrence suivante

Réponse : « Oui, par la cloche ★ ». Ce n’était **pas** fait (notes R-201 : « aucune notification »).

- `setTaskStatus`, `setTaskProgress` (`src/server/dal/tasks.ts`) et `setActivityTodoDone` (`activity-todos.ts`) renvoient
  désormais le numéro de l’occurrence créée par leur transaction ; **après le commit**, `notifyTasksAssigned([numéro], acteur)`
  (`task-notices.ts`, R-015) prévient l’assigné : notification « Tâche assignée · T-xxxx », sous-ligne = titre de la tâche,
  ouvrant la nouvelle occurrence ; e-mail selon les préférences de la personne (R-036), comme toute tâche créée pour elle.
- Rien n’est envoyé quand l’assigné a clos lui-même la tâche (l’acteur n’est jamais prévenu de sa propre action), ni pour une
  tâche portée par un rôle contractuel ou par une personne sans compte. Un échec de notification est journalisé et n’annule
  jamais la clôture.
- Test : `src/features/mywork/recurrence.test.ts` — la clôture par l’assigné ne crée aucune notification ; la clôture par le
  directeur (règle « à chaque jalon ») crée une notification adressée au seul assigné.

**Décision prise sans demander** : réutiliser le modèle existant « Tâche assignée · T-xxxx » (déjà traduit, déjà routé vers
l’e-mail) plutôt qu’un nouveau titre « Occurrence suivante ». Facile à changer (`assignedTitle`, `task-notices.ts`).

**R-201 : fait** (avec S-15) une fois intégré.

## 3. S-19 (R-203) — graphique capacité / charge dans le catalogue des tableaux de bord

Réponse : « Capacité / charge ★ ».

- Nouvelle vignette **« Capacité vs demande »** (`resources-capacity`, `src/domain/dashboards.ts`), sans paramètre, largeur
  moyenne par défaut. Écran source : **Ressources** (`widgetScreen` → `resources`) : la vignette n’est remplie que pour les
  rôles qui ont Ressources dans leur espace de travail (directeur, chef de service et achats
  selon `ROLE_SCREENS` ; pas le chef de projet, qui a « Ressources du projet ») ; les autres reçoivent « Non disponible pour votre rôle », sans chiffre — même règle que les autres vignettes,
  vérifiée par la boucle `PERSONAS` existante.
- **Aucun nouveau calcul** : les lignes sont celles de la carte « Capacité vs demande » de l’écran Ressources
  (`getCapacityDemand(currentLoadWeeks())`, `src/server/dal/resources.ts`, fenêtre de 8 semaines depuis la semaine de la date
  métier, R-085). Le dessin réutilise `CapacityBar` et la construction des barres, extraite de `resourcesView` en
  `capacityRoleBars` (`src/features/resources/model.ts`) et partagée par l’écran et la vignette. Lien « Ouvrir les
  Ressources ».
- Export du tableau de bord : la valeur de la vignette est la « Demande non couverte » (`unmetDemand`) des mêmes lignes.
- Tests : `src/domain/dashboards.test.ts` (droits, défaut), `src/features/dashboards/dashboards.test.ts` (lignes identiques à
  celles de l’écran pour le directeur, remplie pour le chef de service, refusée au membre).

**Décisions prises sans demander** : vignette du **pool entier** (l’écran Ressources), pas de variante par projet (les
barres de « Ressources du projet » se calculent sur l’équipe et une autre fenêtre ; à ajouter si demandé) ; fenêtre fixe des
8 semaines courantes (pas de `?week=` dans une vignette) ; non ajoutée à la disposition suggérée.

**R-203** : volet tableaux de bord complété de S-19 ; K-203b (Power BI) reste hors de ce lot, comme avant.

## 4. Questions ouvertes

Aucune.
