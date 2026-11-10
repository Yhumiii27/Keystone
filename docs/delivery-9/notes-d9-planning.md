# Livraison 9 — lot « planning » : réponses D9-08 à D9-12 (10 nov. 2026)

Réponses du responsable produit au questionnaire de la livraison 9 (`docs/DECISIONS.md`, dernière section ;
`docs/decisions/questions-decisions-l9.json`, section « planning »). Éléments : R-012 (reprise des plannings), R-060 (date de
référence et gel du vendredi), R-063 (règles des références de planning, S-3).

Migration : `drizzle/0079_weekly_freeze.sql` (renumérotée à l’intégration : 0078 est pris par le lot Matrix ; texte d’origine :
0078). Elle ne touche à aucune vue `pub_` (la table `status_snapshots` n’est lue par aucune).

## 1. D9-08 (R-012) — reprise des plannings MS Project et GanttProject

Réponse : « L'import sera soit en format MS Project, soit en format GanttProject ».

- **Imports réactivés** (`IMPORTS_ENABLED = true`, `src/domain/ch4-defaults.ts`) pour deux formats seulement :
  `ENABLED_IMPORT_KINDS = ['mspdi', 'gan']`. Primavera P6 XER et les tables Excel / CSV restent construits et testés mais sont
  refusés à chaque étape (« This import format is not available ») et leurs cartes masquées.
- **Lecteur GanttProject** `src/server/interchange/gan.ts` (pur, vers le modèle neutre `model.ts`, puis le même chemin que
  MS Project : aperçu → confirmation → transaction unique → audit `import_job` + fil d’activité). Pas de nouvelle dépendance :
  `fast-xml-parser` sert déjà au lecteur MSPDI.
  - tâches avec sous-tâches → éléments de WBS (code = numéro de plan « 1.2 », GanttProject n’en stocke pas) ; les autres →
    activités ; `meeting="true"` → jalon (durée 0) ; `complete` → % ; la fin est calculée sur le calendrier (GanttProject ne la
    stocke pas) ;
  - liens `<depend>` (1 SS, 2 FS, 3 FF, 4 SF, `difference` = décalage en jours) ; les liens vers ou depuis une tâche
    récapitulative ne sont pas importés (signalé dans l’aperçu) ;
  - contrainte « début au plus tôt » (`thirdDate-constraint="1"`) → SNET ;
  - calendrier (au mieux) : semaine type + exceptions datées (HOLIDAY / WORKING_DAY) ; un jour férié sans année est répété sur
    les années du planning (signalé) ;
  - ressources et affectations (charge % → unités) ; références « previous-tasks » → Baseline 0, 1… ;
  - colonnes personnalisées, congés des ressources, couleurs, priorités : listés comme non importés.
- **Détection du format** dans `jobs.ts` (`scheduleKindOf`) : `.gan` ou racine `<project>` GanttProject ; les deux cartes
  « MS Project XML » et « GanttProject » acceptent les deux formats. La carte GanttProject est ajoutée en code
  (`GANTTPROJECT_CARD`, `src/features/admin/model.ts`) : la table `import_formats` vient de la maquette, pas de migration.
- **Droits** (`src/server/interchange/rights.ts`) : sur un projet existant, ses responsables (`projectAccess` lead : CP de
  référence, co-CP, adjoint) et le directeur, quel que soit le rôle de la personne ; un nouveau projet : directeur et CP.
  Le client jamais.
- Tests : `src/server/interchange/gan.test.ts` (valeurs calculées à la main sur `tests/fixtures/ch4/sample.gan`, aperçu sans
  écriture, confirmation, audit, XER et tables refusés, droits). Les tests existants des autres importeurs activent tous les
  formats par `vi.mock` de `ENABLED_IMPORT_KINDS`.

**Décisions prises sans demander**
- GanttProject n’a pas de dates réelles : une tâche commencée (% > 0) prend son début comme début réel, une tâche à 100 % sa
  fin comme fin réelle.
- Pas d’« Activity ID » dans GanttProject : la mise à jour d’un projet se fait sur l’UID (identifiant de tâche GanttProject).
- Les fichiers `.xer`, `.csv`, `.xlsx` restent acceptés au téléversement (extension) mais l’import est refusé ; rien n’est
  stocké pour ces formats.

**Reste à faire (R-012)** : la procédure de reprise projet par projet (qui importe quoi, quand) et les fichiers réels des projets
actifs ; le choix du projet dans un XER multi-projets n’est plus utile tant que P6 est coupé. La replanification des imports de
tables dans la transaction d’écriture n’a pas d’objet (tables coupées).

## 2. D9-09 (R-060) — la date de référence

Réponse : « Le chef de projet l’avance, Keystone la propose chaque vendredi ».

- Écrivain `setProjectDataDate` (`src/server/dal/weekly-freeze.ts`) : audit avant / après (message `plan.dataDateSet`, zone
  Planning) et fil d’activité. Server Function `setDataDateAction` (`src/features/plan/scheduling-actions.ts`) : droit
  « schedule » du Plan (CP du projet et directeur), contrôle serveur.
- Plan : la puce « Date de référence » devient un bouton pour ces rôles (`DataDateChip`) ; la boîte de dialogue est préremplie
  avec le vendredi proposé ; la puce affiche « Proposée … » tant qu’une proposition attend.
- Proposition du vendredi : la tâche `friday-freeze` (chaque matin à l’heure des rappels ; agit pour le vendredi de la semaine)
  envoie au CP de référence une notification « Avancer la date de référence » (une par projet et par vendredi, lien vers le Plan),
  tant que la date enregistrée est vide ou antérieure. Keystone n’écrit jamais la date.

**Décisions prises sans demander** (`src/domain/data-date.ts`)
- La date ne fait qu’avancer, jamais au-delà de la date du jour ; une date vide (= date du jour) peut être fixée à toute date
  jusqu’à aujourd’hui.
- Pas de retour à « date du jour » une fois la date fixée.

## 3. D9-10 (R-060) — le gel hebdomadaire du vendredi

Réponse : « CPI, SPI, EAC, marge, risques et avancement ».

- `status_snapshots` reçoit `risk_count`, `progress_pct`, `margin_pct` (nuls pour les semaines gelées avant) ; l’unicité passe de
  (projet, semaine « W39 ») à (projet, date de situation), la semaine se répétant chaque année.
- `runFridayFreeze` gèle, pour chaque projet avec données de planning ni clos ni annulé, la semaine du vendredi : CPI et SPI
  (valeur acquise à la date de référence du projet), EAC (règle A-13), marge à terminaison (C-10b), risques ouverts (nombre et
  exposition), avancement, plus la marge totale du chemin critique et le glissement des jalons déjà tracés par les Tendances.
  Jamais d’écrasement d’une semaine gelée ; audit « Instantané hebdomadaire figé » (acteur Keystone). Un vendredi manqué est
  rattrapé par le passage du lendemain dans la même semaine ; un vendredi plus ancien n’est pas reconstitué.
- Tendances : l’historique affiche « Risques ouverts », « Avancement » et, pour les rôles qui voient les marges
  (`canSeeMargins`), « Marge » ; l’export Excel des Tendances aussi.

**Décisions prises sans demander** : le gel a lieu le vendredi au passage du matin (07:00 Paris par défaut) ; les chiffres sont
ceux de la date de référence du projet (si le CP ne l’a pas avancée, l’avancement reste à l’ancienne date) ; un indice sans
valeur (pas de valeur planifiée ou de coût réel) est gelé à 1.

## 4. D9-11 et D9-12 (R-063) — références de planning

- **D9-11** « Gardée, marquée « rejetée » » : nouvel état `rejected` des références (`baselineState`, pas de migration : colonne
  texte sans contrainte). Au rejet d’une demande, sa référence proposée passe à `rejected` (audit de la demande
  « BL3 rejected ») ; elle reste dans la liste des références, jamais courante.
- **D9-12** « Garder la plus haute (BL3) ; « Re-baseline » passe par une demande après BL1 » :
  - `approvedBaselineBecomesCurrent` (`src/domain/baseline-policy.ts`) : à l’approbation, la référence proposée ne devient
    courante que si elle n’est pas inférieure à la courante ; sinon elle est remplie (instantané), datée et marquée
    « remplacée », la plus haute reste courante (audit « BL2 approved · superseded · BL3 stays current ») ;
  - Planning : après BL1, le bouton « Re-baseline » ouvre le formulaire de demande de modification qui propose la référence
    suivante (comme « Fixer la référence » du Plan). La Server Function garde son contrôle (après BL1, une demande ouverte citée
    est exigée).
- Tests : `src/server/dal/d9-planning.test.ts`, `src/domain/data-date.test.ts`.

Écart signalé : « Rejected » se traduit déjà « Refusé » (statut des demandes) ; la règle d’une seule traduction par clé donne
« Refusé » pour une référence rejetée. À changer seulement si le propriétaire tient au féminin « Rejetée ».

## 5. État des éléments

| Élément | État | Reste |
|---|---|---|
| R-012 | en cours | procédure de reprise par projet et fichiers réels (côté propriétaire) |
| R-060 | fait (sur la branche) | — (le volet S-4 « horloge réelle » était fait par le lot clock) |
| R-063 | fait (sur la branche) | — |

## 6. Questions ouvertes

1. Faut-il proposer la date de référence aussi aux co-CP et adjoints, ou au seul CP de référence (choix actuel) ?
2. Une référence importée en mode mise à jour (Baseline 0 d’un fichier) reste « proposée » sans demande de modification : faut-il
   l’attacher à une demande (D9-12) ?
