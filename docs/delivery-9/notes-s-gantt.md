# Livraison 9 — lot « Gantt : réponses S-06 et S-08 » (suite de R-198)

Statut : construit sur la branche `s-gantt` le 4 nov. 2026, d’après les réponses du responsable produit au questionnaire de suivi
de la livraison 9 (`docs/DECISIONS.md` § « Questions de suivi de la livraison 9 », `docs/decisions/questions-suivi-l9.json`).
Base : le Gantt interactif de R-198 (`docs/delivery-9/notes-r198-gantt.md`). Pas de migration, pas de nouvelle dépendance.

Hors périmètre (réponses « actuel » ou « plus tard ») : S-05 (recalcul immédiat pour le Gantt seulement — inchangé), S-07 (vue
par défaut « Lots de travaux » — inchangée), S-09 (glisser un lot entier — plus tard).

## 1. S-06 — glisser une activité plus tôt que ne le permettent ses prédécesseurs : refusé, avec un message

Réponse : « Refuser le glissement avec un message ». Avant, la contrainte « Début au plus tôt le » (SNET) était posée sans effet.

- **Règle pure** (`src/domain/gantt-edit.ts`) : `earliestStart(net, cals, id)` = le CPM de « Replanifier » sur le réseau, la
  contrainte de date de l’activité elle-même retirée ; il rend la date de début au plus tôt et ce qui la retient : les
  prédécesseurs pilotes (`drivingPredecessors` du moteur, avec le libellé du lien, « FS+2 »), sinon la date des données ou le début
  du projet. `applyGanttEdit` (`move`) refuse le déplacement (`error: 'held'`, `hold`) quand la date déposée — ramenée au premier
  jour ouvré — est antérieure à cette date. Mêmes règles dans le navigateur et dans la Server Function.
- **Serveur** (`src/features/schedule/gantt-actions.ts`) : `ganttEditActivityAction` recharge le réseau, applique la même règle et
  renvoie le refus traduit ; rien n’est écrit (ni l’activité, ni l’audit, ni le fil, ni « Replanifier »).
- **Message** (`heldText`, `src/features/schedule/i18n.ts`) : « A1330 ne peut pas commencer avant le 2 nov. 2026 : son prédécesseur
  A1320 (FS) la retient » (« ses prédécesseurs A1310 (FS), A1320 (FS+2) la retiennent » ; « la date des données la retient » ; « le
  début du projet la retient »). En anglais : « A1330 cannot start before 2 Nov 2026: its predecessor A1320 (FS) holds it ».
- **Écran** (`interactive-gantt.tsx`) : pendant le glisser, l’aperçu ne suit pas un dépôt refusé (la barre reste à sa place) et le
  contour pointillé sous la souris est hachuré, avec le message en infobulle ; au relâcher, la barre revient et le message s’affiche
  (toast). Le dialogue de l’activité (date de début saisie au clavier) donne le même refus ; son aide dit « jamais plus tôt que ne
  le permettent ses prédécesseurs ».

### Décisions prises sans demander

1. **La date des données et le début du projet comptent aussi** : un déplacement avant eux était lui aussi sans effet ; il est
   refusé de la même façon, le message disant ce qui retient l’activité.
2. **« Doit commencer le » (MSO) n’est pas refusée** : cette contrainte impose sa date contre la logique (le CPM signale le conflit,
   comme P6) ; elle garde donc son effet. Seule la SNET posée par le glisser (cas de toutes les autres contraintes) est contrôlée.
3. **La contrainte propre de l’activité ne compte pas** : une activité déjà contrainte plus tard peut être ramenée plus tôt, jusqu’à
   ce que permettent ses prédécesseurs.
4. **Ordre des éditions du dialogue** : la durée est appliquée avant le déplacement (dialogue et serveur), pour que le contrôle voie la
   nouvelle durée (lien fin-à-fin ou début-à-fin d’un prédécesseur).
5. **Réseau non datable** (boucle, donnée invalide) : pas de contrôle — « Replanifier » signale déjà le problème.
6. Test pur modifié : « déplacer avant la date des données » (`gantt-edit.test.ts`) était accepté sans effet ; il est désormais
   refusé (commentaire citant S-06).

## 2. S-08 — filtre par ligne d’équipement sur le Gantt des activités

Réponse : « Oui ». Projets à plusieurs lignes d’équipement (R-185).

- **URL** : `?equipment=EQ-02|common` sur le Planning, vue « Activités » (`all` par défaut, omis) — même paramètre et mêmes règles que
  l’ITP et la liste de réserves (`equipmentFilterOf`, `filterByEquipment`, `src/domain/equipment-scope.ts`). Le zoom garde le filtre
  et le filtre garde le zoom. Valeur inconnue → toutes.
- **Écran** : sélecteur « Équipement » (Tous · EQ-01 · EMP · EQ-02 · 3 × MEMU · Commun au projet) dans la barre du Gantt, **caché
  quand le projet a une seule ligne** (`showsEquipment`). Le filtre ne masque que des lignes : l’aperçu CPM porte toujours sur tout le
  réseau ; un lien vers une ligne masquée n’est pas dessiné (règle existante). Il se combine avec le filtre par code de R-204.
- **Données** : `GanttActivity.equipment` (référence de la ligne) lue par `getGanttNetwork` (`src/server/dal/gantt.ts`).
- **Règle pure** : `ganttEquipmentFilter` (`gantt-edit.ts`).

### Décisions prises sans demander

1. **Ligne d’une activité** : sa propre ligne (`activities.equipment_id`, posée par l’assistant pour les lots propres à un
   équipement), **sinon celle de son lot** (`wbs_nodes.equipment_id`). Les données de démonstration ne portent la ligne que sur les
   lots (HLT-026 : 1.5 → EQ-01, 1.6 → EQ-02) ; sans cet héritage le filtre serait vide. Le type de code dérivé « Équipement » de R-204
   (filtre par code) reste, lui, sur la seule colonne de l’activité — à aligner si le responsable produit le souhaite.
2. **« Commun au projet »** = activités sans ligne, y compris celles des plannings fournisseurs (bande « Fournisseurs ») ; un filtre
   sur une ligne les masque.
3. **Filtre dans l’URL** (comme les autres filtres de l’ITP et des réserves) ; le filtre par code de R-204 reste un état de la page.

## 3. Vérifications

- Tests : `src/domain/gantt-edit.test.ts` (refus S-06 : prédécesseur, décalage, plusieurs prédécesseurs, date des données, début du
  projet, MSO, lien fin-à-fin et ordre des éditions, réseau en boucle ; filtre S-08), `gantt-actions.test.ts` (refus côté serveur en
  anglais et en français, rien d’écrit), `schedule-page.test.ts` (liens du filtre, zoom qui le garde, héritage du lot, valeur
  inconnue, projet à une ligne), `gantt-render.test.ts` (rendu filtré), e2e `tests/e2e/d9-gantt.spec.ts` (glisser refusé, filtre).
- Voir le compte rendu du lot pour les résultats de `typecheck`, `lint`, `npm test`, du build et de Playwright.

## 4. Reste à faire / questions ouvertes

- S-06 et S-08 : faits.
- Question : faut-il aligner le type de code dérivé « Équipement » (R-204, Plan et Gantt) sur la même règle d’héritage du lot ?
