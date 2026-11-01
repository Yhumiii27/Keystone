# Livraison 9 — lot « Gantt interactif » (R-198)

Statut : construit sur la branche `r198-gantt` (depuis `main-2a2fep`, `8cd7b52`) le 29 oct. 2026, après validation de R-198 par
le responsable produit le même jour. Source : `docs/reste-a-developper.json` R-198 (analyse comparative du 25 oct. 2026, priorité
P1 : condition du remplacement de MS Project). Pas de migration, pas de nouvelle dépendance.

## 1. Ce qui change

Sur l’écran **Planning** (`/projects/<code>/schedule`), la carte du Gantt porte un sélecteur **Lots de travaux | Activités**
(`?gantt=activities`). « Lots de travaux » est le Gantt existant (13 mois, barres des lots, lecture seule, inchangé) ; « Activités »
est le nouveau **Gantt interactif** :

- une ligne par activité, regroupées sous leur lot (barre de synthèse du lot), barres de la référence affichée (BL), ligne
  « Aujourd’hui » (date métier, `useToday()`), jours non ouvrés du calendrier du projet grisés (zooms jour et semaine) ;
- **échelle jour / semaine / mois** (`?zoom=day|week|month`, semaine par défaut ; 28, 9 et 3 px par jour calendaire) ; en-tête
  à deux lignes : mois, puis jours ou semaines ISO (« S41 ») ;
- **liens** dessinés en flèches coudées (FS, SS, FF, SF ; en accent entre deux activités critiques) ;
- **glisser une barre** = nouveau début ; **glisser son bord droit** = nouvelle durée (jours ouvrés) ; **glisser le point au bout
  de la barre sur une autre barre** = lien fin-à-début sans décalage ; **cliquer une flèche** = dialogue du lien (type, décalage,
  suppression) ;
- **clavier** : chaque barre est un bouton (Tab) ; Entrée ou Espace ouvre le dialogue de l’activité — date de début, durée,
  retrait de la contrainte de date, liste des prédécesseurs (type, décalage, Enregistrer, Retirer) et ajout d’un prédécesseur.
  Tout ce que fait un glisser se fait donc sans souris.
- **recalcul immédiat** : pendant le glisser, les barres montrent l’aperçu calculé dans le navigateur avec le même moteur que
  « Replanifier » (`src/domain/cpm.ts`, progression → dates réelles comme `rescheduleProject`), le contour pointillé suit la
  souris ; au relâcher, l’aperçu reste affiché (`useOptimistic`) jusqu’à la réponse du serveur, qui revalide, écrit, **replanifie**
  et revalide les pages ; en cas de refus, les barres reviennent et le message s’affiche.

| Pièce | Où | Rôle |
|---|---|---|
| Règles pures | `src/domain/gantt-edit.ts` (+ `gantt-edit.test.ts`, 17 tests) | réseau sérialisable, éditions et refus, aperçu CPM, échelle, glisser → date / durée, géométrie des barres et des liens |
| Lecture | `src/server/dal/gantt.ts` (`getGanttNetwork`) | réseau du projet (activités, liens, calendriers, date des données, référence affichée) ; `recordGanttActivity` (fil d’activité des liens) |
| Écritures | `src/server/dal/plan.ts` | **les écrivains du Plan** : `updateActivity` (durée ; nouveau champ `constraint` ; option `audit` = ligne d’audit avant / après + événement du fil, dans sa transaction), `addActivityLink`, `removeActivityLink`, nouveau `updateActivityLink` (type et décalage, audité) |
| Server Functions | `src/features/schedule/gantt-actions.ts` (+ `gantt-actions.test.ts`) | `ganttEditActivityAction`, `ganttAddLinkAction`, `ganttEditLinkAction`, `ganttRemoveLinkAction` |
| Droits | `src/features/schedule/gantt-rights.ts` | `canEditGantt` = droits de structure du Plan (`canEditStructure`) **et** Planning modifiable (`ctx.canEdit('schedule')`) |
| Écran | `src/features/schedule/interactive-gantt.tsx`, `gantt-dialogs.tsx`, `activity-gantt-card.tsx`, `gantt.module.css`, `schedule-view.tsx`, page `schedule/page.tsx` | |
| Messages | `src/domain/system-messages.ts` | `gantt.moved`, `gantt.durationChanged`, `gantt.constraintCleared`, `gantt.linkAdded`, `gantt.linkChanged`, `gantt.linkRemoved` (fil d’activité en FR / EN) |
| Français | `src/i18n/extra/d9-gantt.json` | |
| Rendu | `src/features/schedule/gantt-render.test.ts` | carte en français, éditeur et lecture seule |
| E2E | `tests/e2e/d9-gantt.spec.ts` | glisser de A1330, durée de A1520 au clavier, Logistique en lecture |

## 2. Règles retenues (décisions prises sans demander — à confirmer)

1. **Déplacer = contrainte « Début au plus tôt le » (SNET)** à la date déposée, ramenée au premier jour ouvré du calendrier de
   l’activité (règle de MS Project quand on glisse une tâche). Une contrainte « Doit commencer le » (MSO) garde son type et prend la
   nouvelle date ; toute autre contrainte (FNLT, SNLT…) est remplacée par la SNET. La logique peut toujours repousser l’activité :
   un dépôt plus tôt que ses prédécesseurs (ou que la date des données) ne l’avance pas — l’aperçu le montre aussitôt. Le dialogue
   offre « Retirer la contrainte de date (dès que possible) ». Le modèle de données avait déjà `constraint_type` / `constraint_date`
   (lues par le CPM, l’export et l’import) : **aucune migration**.
2. **Dates réelles intouchables** : une activité commencée (date de début réelle, ou % > 0 — même règle que « Replanifier ») ne se
   déplace pas, mais sa durée d’origine peut changer ; une activité terminée ne bouge pas du tout. Un **jalon** (durée 0) se déplace
   mais n’a pas de durée à étirer.
3. **Recalcul immédiat après chaque édition du Gantt** : la Server Function appelle `rescheduleProject` (le même « Replanifier »,
   qui journalise son exécution, l’audit et le fil). C’est un écart assumé à S-1 (« recalcul manuel ») **pour le seul Gantt**, puisque
   R-198 demande le « recalcul CPM immédiat » ; les modifications du tableau du Plan restent en recalcul manuel. Conséquences : la
   première édition sur un projet jamais replanifié (données de démonstration) recalcule tout le réseau, comme le premier
   « Replanifier » (11 activités de HLT-026) ; et, comme « Replanifier », elle applique les nouvelles durées des demandes de
   modification approuvées (R-062).
4. **Droits** : ceux de la structure du Plan (P-9a, R-041 : chef de projet titulaire, co-CP, adjoints et directeur, sur un plan
   modifiable, jamais le client), plus « Planning modifiable » (hors espace de travail, projet en lecture seule, Logistique qui lit
   le Planning — R-158 — : lecture seule). Les autres voient le même Gantt, cliquent ou appuient sur Entrée pour lire l’activité,
   sans poignées. Un client reste renvoyé à son accueil par `getProjectContext`.
5. **Référence figée** : le Gantt ne touche jamais aux références (BL0…BLn) ; leurs barres restent celles de l’instantané affiché.
   Une nouvelle référence suit toujours S-3 (« Ré-baseliner », demande de modification après BL1).
6. **Liens** : un lien tracé à la souris est fin-à-début sans décalage ; type et décalage se changent ensuite (clic sur la flèche,
   ou dans le dialogue de l’activité). Mêmes refus que le tiroir du Plan : lien sur soi-même, doublon, boucle logique (message avec
   la boucle), décalage hors ±999 jours ouvrés. Changer type ou décalage conserve la place du lien dans la liste des prédécesseurs.
7. **Durée** : nombre entier de jours ouvrés de 1 à 9999 ; une durée restante importée (MSPDI / XER) cède la place à la nouvelle
   durée, comme pour la saisie dans le Plan.
8. **Audit et fil** : chaque édition d’activité a sa ligne d’audit (« Gantt edit: … », valeurs avant / après) écrite dans la
   transaction de l’écriture, et un événement du fil traduit (`gantt.*`) ; les liens gardent l’audit de leurs écrivains (« relationship
   added / changed / removed ») plus un événement du fil ; le recalcul ajoute la ligne et l’événement de « Replanifier ».
9. **Pas de bibliothèque Gantt** : glisser par événements de pointeur (capture du pointeur, seuil de 3 px entre clic et glisser,
   Échap/annulation du pointeur abandonne), SVG pour les liens. Aperçu recalculé à chaque mouvement (quelques dizaines à quelques
   centaines d’activités : instantané).
10. **Vue par défaut** : le Planning s’ouvre toujours sur « Lots de travaux » (le Gantt du prototype) ; « Activités » est un clic plus
    loin et se garde dans l’URL.

## 3. Multi-équipements (R-185)

Rien ne suppose un seul type de machine : le Gantt montre les activités de tous les lots, y compris ceux propres à un équipement
(lots `per_equipment` de l’assistant), groupées par lot. Un filtre par ligne d’équipement (comme ITP ou réserves) n’a pas été
ajouté : à décider (§ 5).

## 4. Vérifications

`npm run typecheck`, `npm run lint`, `npm test` (418 fichiers, 4508 tests) verts dans le worktree ; `next build` de production
(`KEYSTONE_DIST_DIR=.next-ci`) réussi ; Playwright sur ce build : `01-platform` (aucune violation CSP ni erreur navigateur sur les
écrans), `02-planning` et le nouveau `d9-gantt` — 11 scénarios verts. Les autres scénarios e2e n’ont pas été relancés.

## 5. Questions ouvertes pour le responsable produit

1. **Recalcul immédiat** (§ 2.3) : le garder pour le Gantt seulement, ou l’étendre aux saisies du tableau du Plan (S-1 passerait en
   « automatique ») ?
2. **Glisser vers la gauche au-delà de la logique** : aujourd’hui la contrainte SNET est posée mais sans effet (l’activité reste
   tenue par ses prédécesseurs). Préférez-vous un refus explicite, ou une contrainte « Doit commencer le » (qui force la date et
   signale le conflit, comme P6) ?
3. **Vue par défaut** du Planning : « Lots de travaux » (actuel) ou « Activités » ?
4. **Filtre par équipement** sur le Gantt des activités pour les projets à plusieurs lignes d’équipement (R-185) ?
5. **Glisser un lot entier** (déplacer toutes ses activités) : non construit — utile ?
