# Livraison 9 — lot « nettoyage » (R-171) : code mort, doublons et commentaires périmés

Branche `r171-cleanup`, six commits rangés par nature (un par sorte de retrait) pour garder chaque diff lisible. Aucune
migration, aucun changement de comportement : seuls du code sans appelant, des classes CSS sans lecteur et des commentaires
sont retirés ou corrigés.

## 1. Méthode

- **Exports inutilisés** : `npx knip@5` (lancé par npx, **non ajouté** à `package.json`) a listé 281 exports et 476 types
  exportés sans importeur. Chaque candidat a ensuite été vérifié par une recherche du mot exact (`grep -w`) dans `src/`,
  `scripts/` et `tests/` : n'a été retiré que ce dont le nom n'apparaît **nulle part ailleurs que sur sa propre
  déclaration** (ni appel, ni test, ni chaîne). Puis `tsc --noEmit --noUnusedLocals` a signalé les imports devenus inutiles,
  retirés aussi (le projet n'en avait aucun avant le lot).
- **Classes CSS Modules** : script qui, pour chaque `*.module.css`, cherche `styles.<classe>` ou `styles['<classe>']` dans les
  fichiers qui l'importent. Les classes écrites dans `:global(...)` (`.btn`, `.card`, `.tag`… du design system) et celles
  d'un module lu par une clé calculée (`s[\`bar_${x}\`]`, `s[size]`…) sont laissées.
- **Commentaires** : les 67 « OPEN QUESTION » restants du code (81 lors de l'audit ; une partie avait déjà disparu avec les
  lots précédents) ont été comparés à `docs/decisions/answers.json` et à `docs/DECISIONS.md`, puis réécrits avec la décision
  et l'élément de reste-à-faire qui porte la suite.

## 2. Retiré (et preuve)

### 2.1 Éléments nommés par R-171

| Élément | Preuve | Remarque |
|---|---|---|
| `addTaskAttachment` (+ `AttachmentInput`), `src/server/dal/tasks.ts` | seule occurrence | les pièces jointes passent par `task-files.ts` |
| `INDEX_ALERT`, `src/domain/portfolio.ts` | seule occurrence (marqué `@deprecated`) | les écrans passent les seuils des Paramètres à `indexAlert` |
| `availableHours`, `personAvailability`, `teamAvailability`, `weeksUnderTeamCapacity` et leurs constantes, `src/domain/resources.ts` | lus par `resources.test.ts` seulement | la règle en service est `leaveRow` / `leaveKpis` de `src/domain/hr.ts`, testée avec **les mêmes valeurs dorées** (85 %, 43 jours, 0 semaine < 60 %, `hr.test.ts`) ; le bloc de test correspondant de `resources.test.ts` part avec |
| `getPortfolioCashForecast`, `src/server/dal/cashflow.ts` | lu par `delivery3.test.ts` seulement (« no longer read by the screens since A-12 ») | assertion `CASH_M` retirée du test ; la table `portfolio_cash_forecasts` reste (schéma, migrations publiées) et son commentaire dit qu'elle n'est plus lue |
| champ `transferTargets` de `getStockPosition`, `src/server/dal/stock.ts` | lu par `delivery4.test.ts` seulement | le tiroir lit `transferTargetOptions` (`features/stock/model.ts`), dont la comparaison au prototype (`g.targets`) reste dans `features/stock/model.test.ts` ; la requête des emplacements devenue inutile part aussi |
| `priorityScore` du DAL, `src/server/dal/prioritisation.ts` | strictement identique à celui de `src/domain/portfolio-finance.ts` (Σw = 0 compte 1, échelle 5) | le DAL importe la version du domaine ; le test importe aussi celle-ci |

Déjà traités avant ce lot (vérifié) : le doublon `marginPct` (une seule règle, `marginAtCompletion` → `projectMarginPct`,
C-10b) ; les deux règles de décision d'une étape de CR (une seule, `canDecideStep` de `src/domain/change-control.ts`, R-069) ;
`listDeliverableTypes` (appelé par le formulaire « Nouveau livrable », R-115).

### 2.2 Autres exports sans aucune référence

- Présentation : `toneColor`, `checkLook`, `boardDot` (`components/app/tones.ts`), `ZONE_SCREENS` (`nav-model.ts`),
  `PROJECT_GROUPS` (`config/screens.ts`), les alias `SectionLabel` (= `Eyebrow`) et `PageSection` (= `Stack`) et leur
  réexport par `components/app/index.ts`.
- Liens et textes : `settingsHref`, `bomSparesHref`, `openDepositHref` (alias de `depositHref`), `pidTagHref`,
  `loggedSubText` (« of 40 h », règle des 40 h d'avant R-6), `photoCountText`.
- Domaine : `isDerivedCodeType`, `hoursOfDays`, `roundProgress`, `DEPOSIT_DEFAULT_TYPE`, `probabilityShare` (la règle vit
  dans `emvOf`), `shippingDocVariant`, `interfaceStatusLabel`, `maxOverPeople`.
- Serveur : `localAnalyzer` (l'entrée `transcripts/index.ts` appelle `analyseLocally`), `isEntraMode`, et les lecteurs /
  écrivains DAL sans appelant `setCalendarException`, `removeCalendarException`, `listNeedAnswers`, `getInboxNeed`,
  `STEP_DECISION_TAG`, `countOpenClientIssues`, `listProjectFx`, `ecoNextStep`, `getMissingDeliverables`, `lastPriceByRef`,
  `getCountryZones`, `getPersonByOwnerCode`, `listClients` (+ `ClientRow`), `submittedDeliverablesByProject`,
  `latestRiskAnalysis`, `listReferenceValues`, `referenceLists`, `listSuppliers` (+ `SupplierRow`), `builtinCalendarCodes`
  (seed), `nonEmpty` (exports), `xerProjects` (import XER), `cookieOf` (aide e2e).

### 2.3 Fichiers

- `src/features/budget/soon-button.tsx` : ne faisait que réexporter `NewChangeRequestLink` sous l'ancien nom (renommage du
  lot 6) ; plus aucun import.
- `src/features/docs/document-link.tsx` (`<DocumentLink>`) : aucun appelant ; les écrans utilisent `docHref`.

### 2.4 Classes CSS Modules

`.right` (DataTable), `.sub` (FormDialog), `.nowrap` et `.downloadRow` (interchange), `.rowSelected` et `.doneCell`
(aftersales), `.readNote` (catalogue : la note passe par `FilterNote`), `.dlBtn` (docs), `.stateTag` (drawings), `.segWrap`
(pid, et son intertitre devenu vide), `.mt` (page de démonstration des composants).

### 2.5 Commentaires périmés

- Les « OPEN QUESTION » : décision citée et élément de suite — Codex D-1 (D-1a/D-1b répondues ; API et liens profonds :
  R-033, dépôt pré-rempli : R-125), Vigie V-2 / V-3 (R-023, R-025), Q-7 (numérotation par projet décidée, à construire :
  R-014), Q-5 (R-113), R-6 (R-6a : Cursus envoie le détail par tâche, R-030), L-1, L-5, A-4, A-5, A-14 (tranchées et
  construites), E-1, E-7 (R-035), S-6 et S-13a (« à discuter » : R-082, R-059), SC-6 « b » (R-026), SC-7a (à discuter,
  R-100), S-7 (R-091), S-11 (R-037). Les C-1 / C-2 / C-4 des connecteurs Cursus ne sont pas des questions du responsable
  produit (DELIVERY-5 §8) : ils disent désormais qu'ils attendent Cursus.
- Comportement qui a changé depuis le commentaire : résultats d'inspection ITP saisis (Q-6a, R-112, le schéma disait
  « read-only ») ; barres du planning recalculées depuis le WBS (A-7, le schéma disait « not recomputed ») ; transcriptions
  analysées par Claude ou les règles locales (S-10, le schéma disait « simulated ») ; table de trésorerie de portefeuille plus
  lue (C-10a) ; horloge : la base de démonstration suit la date réelle sauf `KEYSTONE_CLOCK` (owner 17 Oct 2026,
  `src/domain/clock.ts` disait « frozen at Fri 25 Sep 2026 ») ; les deux `TODO(db)` du « connecteur Lucca » renvoient à la
  source Cursus (R-6a / C-2a, R-030).

## 3. Laissé, et pourquoi

- **`client_communications`**, son DAL et `openClientFollowUps` (et le commentaire « the frozen "today" » de
  `src/domain/client-comms.ts`) : attendent la décision D-5 (DELIVERY-6 §8), hors périmètre du lot.
- **Branche `ComingSoon`** des routes catch-all : gardée volontairement pour un futur écran (le commentaire de la route le
  dit déjà) ; les routes restent (404, redirection `/projects/<code>`).
- **`setLastProject`** (`'use server'`, sans appelant) : c'est le seul écrivain du cookie `ks-project` que `session.ts` lit
  encore ; le retirer touche un comportement (projet « courant »), à revoir avec l'écran qui devrait l'appeler.
  `setNavOpen` n'est appelé que par des tests : gardé de même.
- **Listes de codes et constantes de documentation** sans lecteur mais qui décrivent un ensemble de valeurs ou une décision :
  `ZONE_CODES`, `SUPPLIER_GRADES`, `CALENDAR_CODES`, `importJobStatus`, `whatIfActionKind`, `constraintTypeLabel`,
  `impactIncludesPrice` (`server/db/codes.ts`), `DEFAULT_CALENDARS`, `DURATION_UNIT` (défauts du chapitre 4, centralisés
  exprès), `FORCED_STAGE_REJECT_EFFECT` (L-1), `USAGE_OF`, `RISK_MEDIUM`, `SHIPPING_DOC_WITH_VALUES`, `ENG_SCREENS`,
  `ITP_VIEWS`, `LOAD_BANDS`, `DRAW_STATUSES`, `CATALOGUE_STATUSES`, `STANDARD_INCOTERM_CODES`, `PROJECT_TABLE_KINDS`,
  `MAX_DOCUMENT_REF`, `RESOURCE_WEEKS`. Coût nul, valeur de documentation ; à retirer si l'on préfère une règle stricte.
- **Exports utilisés seulement dans leur propre module** (plusieurs centaines signalés par knip) : retirer le mot-clé
  `export` ne change rien au code livré et gonflerait le diff ; laissés. De même pour les exports dont le nom apparaît
  ailleurs (homonymes, réexports) : sans preuve simple qu'ils sont morts, laissés.
- **Exports lus seulement par des tests ou les générateurs de valeurs dorées** (`gateText`, `pgKpis`, `rexKpis`,
  `scheduleKpis`, `fitBox`, `boxOf`, `byDue`, `EXEC_STAGES`, `LANGS`, constantes de seed lues par `db-check`…) : ils servent
  les tests dorés, à ne pas toucher.
- **Clés i18n** : 117 clés des dictionnaires `src/i18n/extra/*.json` n'apparaissent comme littéral nulle part, mais une grande
  partie sont des chaînes composées à l'exécution (« 3 projects · FY2026 », « Awaiting PM · client · CCB », textes des
  données de démonstration) puis traduites entières par `t()`. Impossible de prouver statiquement qu'elles sont inutiles :
  laissées. `fr-dict.json` (dictionnaire du prototype) n'est pas touché.
- **Scripts** signalés « fichiers inutilisés » par knip (`scripts/proto-golden-*.ts`, `proto-e2a/e2b.ts`,
  `connectors-check.ts`) : ce sont des commandes lancées à la main (documentées), pas du code mort.
- **Saisie d'heures sur les tâches** (`logTaskTime`) : la décision C-2b (« supprimer la saisie d'heures dans Keystone ») est un
  changement de produit, pas un nettoyage ; à traiter avec R-030.

## 4. Décisions prises sans demander

- Les listes de codes et constantes « documentaires » sans lecteur sont gardées (§3) ; seules les fonctions, liens, alias et
  lecteurs DAL sans aucune référence sont retirés.
- Le test doré `transferTargets` du DAL du stock est retiré avec le champ, la même comparaison au prototype restant côté
  écran (`features/stock/model.test.ts`). Idem pour la disponibilité de `resources.ts` (couverte par `hr.test.ts`) et pour
  `CASH_M` (lecteur supprimé, la table n'est plus lue depuis A-12).

## 5. État de R-171

**Fait**, sauf la part qui attend D-5 : suppression de `client_communications`, de son DAL et d'`openClientFollowUps`.

## 6. Vérifications

`npm run typecheck`, `npm run lint`, `npm test` (suite complète) et le build de production
(`KEYSTONE_DIST_DIR=.next-ci KEYSTONE_DATA_DIR=$(mktemp -d) npm run build`) au vert sur la branche.
