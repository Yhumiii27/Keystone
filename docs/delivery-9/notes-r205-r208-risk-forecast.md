# Livraison 9 — lot « lotG-montecarlo-forecast » (R-205, R-208) : analyse de risques Monte-Carlo et dérive prévue

Réponses du propriétaire du 1er nov. 2026 (`docs/DECISIONS.md` § « Cadrage des prochains lots ») : **K-205** (lancer, sur le
délai et le coût), **K-205b** (fourchettes saisies par le chef de projet, défaut −10 % / +25 %), **K-208 alt1** (première
version fondée sur les règles et la valeur acquise). Migration **0070** (`drizzle/0070_risk_analysis.sql`, générée ; numéro à
recaler à l’intégration).

## 1. R-205 — analyse de risques Monte-Carlo (délai et coût)

### Modèle (pur, `src/domain/monte-carlo.ts`, tests `monte-carlo.test.ts`)

- **Estimations à trois points** (min / plus probable / max) sur la **durée** (jours ouvrés) et le **coût à terminaison**
  (k€) de chaque activité. Sans saisie : fourchette par défaut **−10 % / +25 %** autour de la valeur actuelle (durée de
  l’activité, EAC de l’activité) — `defaultRange`.
- **Loi triangulaire** (choix noté : c’est la formulation de l’item « lois triangulaires » ; une PERT-bêta resserrerait les
  queues autour du plus probable — la triangulaire est la plus prudente et vérifiable à la main).
- Le tirage s’applique au **reste à faire** : facteur = valeur tirée / valeur de référence, appliqué à la durée restante
  (telle que le CPM la calcule) et au coût restant (EAC − réel). Activité terminée : figée. Jalon (durée 0) : 0 sauf retard de
  risque.
- **Risques** : les risques **ouverts** du registre sont des événements discrets ; à chaque tirage un risque survient avec la
  probabilité P / 5 (échelle de l’EMV, Q-1). S’il survient : son **retard** s’ajoute à la durée restante de l’activité liée
  (`risks.activity_id`) et son **coût s’il survient** au coût à terminaison. Un risque sans activité n’ajoute que son coût.
- Chaque itération exécute le **CPM** (`schedule()` de `src/domain/cpm.ts`, consommé comme fonction pure, mêmes options que
  « Recalculer ») sur le réseau tiré → date de fin, activités critiques.
- Résultats : P10 / P50 / P80 / P90, min, max, moyenne de la **date de fin** et du **coût à terminaison** ; probabilité de
  tenir la **date cible** et le **budget (BAC)** ; histogramme (≤ 20 classes) et courbe en S (41 points) de chacun ; **indice
  de criticité** (part des tirages où l’activité est critique) ; **tornade** (corrélation de Pearson avec la date de fin du
  facteur de durée d’une activité — seulement si elle a été critique au moins une fois — ou de la survenue d’un risque ;
  |r| ≥ 0,1, 10 premiers).
- **Graine** : FNV-1a de « projet | date d’avancement | itérations » → mêmes données, même résultat (tests déterministes, run
  reproductible). Générateur Mulberry32.
- **Itérations** : 2 000 par défaut ; choix 500 / 1 000 / 2 000 / 5 000 (bornes 200–5 000).
- **Performance** : ~0,3 s pour 2 000 itérations sur HLT-026 (21 activités) ; un réseau de 120 activités × 2 000 itérations
  passe en quelques secondes (test de bornage, pas de test de charge en CI).

### Données (`src/server/db/schema/risk-analysis.ts`, migration 0070)

| Table | Rôle |
|---|---|
| `risk_analysis_ranges` | estimations à trois points d’une activité (durée, coût ; un triplet nul = défaut), une ligne au plus par activité, contraintes min ≤ plus probable ≤ max |
| `risk_analysis_delays` | retard d’un risque s’il survient (jours ouvrés) ; pas de ligne = impact × 5 |
| `risk_analysis_runs` | chaque analyse lancée : date, auteur, date d’avancement, itérations, graine, cible (date et source, budget), résumé des entrées (avec l’empreinte), résultat (JSON), durée de calcul |

Pas de vue `pub_`. Pas de numéro de version (R-010) sur les fourchettes : dernière écriture gagnante, avant / après au journal.

### Serveur

- `src/server/dal/risk-analysis.ts` : `getRiskAnalysis` (réseau comme « Recalculer » via `loadScheduleNetwork`, coûts des
  activités, fourchettes, risques ouverts avec retard, dernière analyse, cible, **empreinte** des entrées), `runRiskAnalysis`
  (calcul côté serveur sur demande, enregistrement + audit + fil d’activité dans une transaction), `saveActivityRange`,
  `saveRiskDelay` (audit avant / après + fil), `latestRiskAnalysisRuns(ByCode)`.
- **Analyse périmée** : l’empreinte des entrées (réseau avec avancement et liens, date d’avancement, coûts, fourchettes,
  risques et retards, cible) est enregistrée avec l’analyse ; si elle diffère de l’empreinte actuelle, l’écran l’indique
  (« relancez-la ») et la dérive prévue ne l’utilise plus. Couvre les suppressions (fourchette effacée, risque clos). Les
  jours fériés d’un calendrier ne sont pas dans l’empreinte (seul son code).
- Server Functions `src/features/risk-analysis/actions.ts` : `runRiskAnalysisAction`, `saveActivityRangeAction`,
  `saveRiskDelayAction` — validation, droits, écriture DAL, `revalidatePath`.
- Messages système (R-184) : `riskAnalysis.run`, `riskAnalysis.rangeSet`, `riskAnalysis.rangeCleared`,
  `riskAnalysis.delaySet`, `riskAnalysis.delayCleared` (`src/domain/system-messages.ts`).

### Écran

Section **« Analyse de risques (Monte-Carlo) »** sous le registre des risques (`/projects/<code>/risks`) — choix noté : le
registre est l’endroit où le chef de projet traite les risques que la simulation fait survenir ; le Planning est déjà chargé
(Gantt, jalons). Contenu : dernière analyse (date, auteur, itérations, date d’avancement) et bouton « Lancer l’analyse » /
« Relancer » ; avertissement si périmée ; tuiles fin P50 / P80 (P90), probabilité de tenir la date de fin (avec la cible et
sa source), coût P50 / P80 (P90), probabilité de rester dans le budget ; histogramme et courbe en S de la date de fin et du
coût (deux graphiques séparés — jamais deux échelles sur un même graphique ; repères P50 / P80 et cible nommés ; infobulles
sur barres et points) ; tornade ; indice de criticité ; tableau des risques simulés (probabilité, retard, « défaut », coût,
part des tirages où il est survenu) ; tableau des estimations à trois points (`?analysis=ranges`) avec « Modifier ».

## 2. R-208 — dérive prévue (règles et valeur acquise)

Règles pures `src/domain/drift-forecast.ts` (tests `drift-forecast.test.ts`) ; entrées `src/server/dal/drift-forecast.ts`
(valeurs enregistrées seulement : EVM de `getProjectEvm`, sinon les chiffres du projet ; dates, marges et drapeau critique
écrits par le dernier « Recalculer » ; jalons et marge de leur activité ; marge du dernier instantané hebdomadaire ;
engagements ouverts ; provision restante ; dernière analyse Monte-Carlo).

- **Fin prévue** : la plus pessimiste des estimations disponibles — planning (fin CPM actuelle), rythme de la valeur acquise
  (temps restant jusqu’à la cible étiré par 1 / SPI) et, si l’analyse Monte-Carlo est à jour (empreinte inchangée et au plus
  30 jours avant la date d’avancement), sa **P80**. Glissement = fin prévue − cible (jours calendaires).
- **Coût prévu** : le plus pessimiste de EAC = BAC / CPI (ou EAC = AC + (BAC − EV) / (CPI × SPI) quand SPI < 0,9) et du coût
  P80 Monte-Carlo à jour.
- **Confiance** : faible < 15 % d’avancement, moyenne < 50 %, élevée au-delà ; un cran de moins sans analyse Monte-Carlo à
  jour, un cran de moins si les estimations divergent (> 30 jours ou > 10 % du BAC).
- **Raisons** (codes + valeurs) : SPI, CPI, TCPI, fin planifiée après la cible, marge négative, marge consommée, jalons en
  retard, probabilités Monte-Carlo, coût prévu > budget, pas de valeur acquise / début de projet, analyse absente ou périmée.
- **Table de règles des mesures** (`DRIFT_RULES`) :

| Règle | Condition | Suggestion (cibles nommées) | Gravité |
|---|---|---|---|
| `spi_critical` | SPI < 0,9 et activités critiques ouvertes | réordonnancer / renforcer les ressources sur les 3 activités critiques les plus urgentes | haute |
| `cpi_review` | CPI < 0,95 | revoir les engagements ouverts (montant) et les restes à faire (activités EAC > budget) | haute si CPI < 0,9 |
| `tcpi_reestimate` | TCPI > 1,1 | réestimer l’EAC ou prévoir un tirage sur la provision | moyenne |
| `milestone_float` | jalon non atteint en retard ou sans marge | alerte précoce au chef de projet (jalons nommés) | haute si en retard |
| `negative_float` | marge du projet < 0 | plan de rattrapage : comprimer le chemin critique (activités les plus négatives) | haute |
| `float_eroding` | marge perdue ≥ 5 j.o. depuis l’instantané précédent | revoir le chemin critique chaque semaine | moyenne |
| `mc_drivers` | probabilité de tenir la fin < 50 % | traiter d’abord ce qui pilote la fin (tête de la tornade) | haute si < 20 % |
| `mc_budget` | probabilité de tenir le budget < 50 % | revoir les réponses aux risques et la provision | haute si < 20 % |
| `contingency_short` | dépassement prévu > provision restante | demande de modification ou revue budgétaire (écart) | haute |
| `mc_run` / `mc_rerun` | pas d’analyse / analyse périmée | lancer / relancer l’analyse | faible |

- **Écran** : carte **« Dérive prévue »** en tête de « Tendances & rapport » (`/projects/<code>/trends`, l’écran de pilotage du
  projet ; aussi quand le projet n’a pas d’instantané) : fin prévue (méthode), glissement, coût prévu (formule), dépassement,
  badge de confiance, « Pourquoi », « Mesures suggérées ». Libellée **« Estimation par règles … · pas un modèle prédictif »**.
- **Alertes du portefeuille** (peu coûteux, fait) : nouvelle règle `risk_forecast` dans `portfolioAlertRules`
  (`src/domain/portfolio-alerts.ts`) — la **dernière analyse Monte-Carlo enregistrée** d’un projet en exécution donne moins de
  20 % de chances de tenir la date de fin → « faible probabilité de tenir la date de fin », bouton « Ouvrir le registre des
  risques ». Une seule lecture pour tout le portefeuille, aucun calcul ; rang le plus bas. Elle passe aussi par les alertes
  d’indicateurs notifiées (`ALERT_KIND_TITLE`).

## 3. Décisions prises sans demander

1. **Retard d’un risque** : le registre n’a pas de retard en jours ; ajout d’un retard saisi par le chef de projet dans la
   section, avec un **défaut = impact × 5 jours ouvrés** (impact 1 → 5 j, 5 → 25 j), signalé « défaut ». Probabilité = P / 5.
2. **Date cible** : fin planifiée du projet (assistant), sinon fin de la référence (plus tardive des fins BL1 des activités) ;
   pas de date contractuelle dans le contrat. **Budget cible** = BAC du projet (provision comprise).
3. **Droits** : lancer l’analyse et saisir fourchettes et retards = responsables du projet (chef de projet titulaire, co-CP,
   adjoint) et directeur (`isLead`), sur un projet modifiable (`canEdit('risks')`) — `canEditRiskAnalysis`. Les autres lisent.
4. **Loi triangulaire**, graine déterministe, tornade limitée aux activités critiques au moins une fois et |r| ≥ 0,1.
5. Les fourchettes portent sur la **durée totale** et le **coût à terminaison** de l’activité ; appliquées au reste à faire
   par facteur.
6. Dérive prévue = **la plus pessimiste** des estimations disponibles ; seuils de `DRIFT_RULES` tirés des exemples de l’item.
7. Pas de verrou optimiste sur les fourchettes et retards (petites saisies du seul CP ; audit avant / après).

## 4. Ce qui reste

- **R-205 : fait** (vérifié sur la branche ; reste à recaler le numéro de migration à l’intégration).
- **R-208 : fait pour la première version demandée (K-208 alt1)**. Une prédiction apprise (historique de projets, REX)
  attend un historique réel de projets clos : hors de cette version.

## 5. Questions ouvertes pour le propriétaire

1. Le défaut « impact × 5 jours ouvrés » pour le retard d’un risque convient-il, ou faut-il une échelle d’impact en jours
   (par exemple dans Paramètres) ?
2. Corrélations entre activités (une même cause qui allonge plusieurs activités) : non modélisées (tirages indépendants) —
   à ajouter si le besoin se confirme.
3. Seuils de la dérive prévue et de l’alerte de portefeuille (20 %) : à déplacer dans Paramètres ?

## 6. Fichiers partagés touchés

`src/server/db/schema/index.ts`, `drizzle/meta/_journal.json` (+ `0070_snapshot.json`), `src/domain/system-messages.ts`,
`src/domain/portfolio-alerts.ts` (+ test), `src/server/dal/portfolio-alerts.ts`, `src/server/dal/event-notices.ts`,
`src/i18n/extra/index.ts`, `src/app/(app)/projects/[code]/risks/page.tsx`, `src/app/(app)/projects/[code]/trends/page.tsx`.
