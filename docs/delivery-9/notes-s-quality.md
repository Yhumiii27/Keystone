# Livraison 9 — lot « s-quality » : réponses S-20 à S-28 (qualité du planning, dérive prévue, plannings fournisseurs)

Construit sur la branche `s-quality` (depuis `4fb0976`) le 4 nov. 2026, d’après les réponses du questionnaire de suivi de la
livraison 9 (`docs/DECISIONS.md`, dernière section ; `docs/decisions/questions-suivi-l9.json`). **Aucune migration** (les seuils
sont une ligne de `app_settings`, le journal d’envoi `reminder_sends` existe), aucune nouvelle dépendance, aucune vue `pub_`.

| Question | Réponse | Ce lot |
|---|---|---|
| S-20 | Une ressource affectée ou un budget (actuel) | rien à changer |
| S-21 | Oui : une fin de chaîne par équipement | **fait** (§ 1) |
| S-22 | Non, seuils de l’entreprise | rien à changer |
| S-23 | Oui : indicateur au portefeuille | **fait** (§ 2) |
| S-24 | Oui : « impact × 5 jours ouvrés » | rien à changer |
| S-25 | Oui, dans Paramètres | **fait** (§ 3) |
| S-26 | Plus tard | — |
| S-27 | Oui : acheteur et chef de projet, à partir de 5 jours ouvrés | **fait** (§ 4) |
| S-28 | Plus tard, avec les standards par type de machine (R-053) | — |

## 1. S-21 — contrôle 1 (« logique ») sur un projet multi-équipements

- Règle pure `networkFinishEnds` (`src/domain/schedule-quality.ts`) : la seule activité sans successeur du réseau reste tolérée
  comme avant ; **sur un projet multi-équipements** (`QualityInput.multiEquipment`), chaque **ligne d’équipement** (R-185,
  `activities.equipment_id`) peut finir sur sa propre fin de chaîne, et les activités communes au projet (sans ligne) sur la
  leur. Une ligne (ou la partie commune) qui a plusieurs fins les voit toutes signalées. Le début du réseau ne change pas.
- Lecture (`src/server/dal/schedule-quality.ts`) : la ligne d’équipement de chaque activité et le nombre de lignes du projet ;
  **multi-équipements = au moins deux lignes** (`project_equipments`).
- Tests : `src/domain/schedule-quality.test.ts` (réseau construit à la main), `src/server/dal/schedule-quality-equipment.test.ts`
  (NDC-031 : une ligne → cinq fins signalées ; deux lignes → les fins de EQ-01 et EQ-02 tolérées ; deux fins sur la même ligne →
  signalées).

## 2. S-23 — qualité du planning au portefeuille

- **Où** : écran **Projets** (portefeuille), vue **« Santé »** — l’écran qui liste déjà la santé de chaque projet. Une colonne
  **« Qualité du planning »** entre « Prochain jalon » et « Attention » : l’étiquette « Non conforme · n » (la même que le compteur
  de la carte du Planning), accentuée quand n > 0 ; l’infobulle donne « Contrôles DCMA non conformes · n / m applicables · #2, #5… »
  (numéros des contrôles) ; la cellule ouvre le **Planning** du projet (sa carte « Qualité du planning ») si la personne voit cet
  écran (`canSee(role, 'schedule')`), sinon le compteur seul. « — » pour un projet sans indicateurs (même règle que la santé :
  `isLiveRow`) ou sans activités.
- **Calcul** : `scheduleQualitySummaries(codes)` (`src/server/dal/schedule-quality.ts`) — les mêmes 14 contrôles que la carte
  (`getScheduleQuality(code, {}, { forensic: false, thresholds })` : sans l’analyse des retards), seuils lus une fois ; lecture
  seule. Appelé par la page pour les seuls projets « vivants » de la zone affichée.
- Pièces : `src/features/projects/register-model.ts` (`quality`, `RegisterInput.scheduleQuality` / `scheduleLinks`),
  `register.tsx`, `register-cells.tsx` (`QualityCell`), `register.module.css`, page `src/app/(app)/portfolio/projects/page.tsx`.
- Tests : `src/features/projects/register-render.test.ts` (colonne, compteur, infobulle FR, lien ou non).

## 3. S-25 — seuils de la dérive prévue et de l’alerte du portefeuille dans Paramètres

- Règles pures (`src/domain/drift-forecast.ts`) : `DriftThresholds` (13 seuils), `DRIFT_STANDARD` (**les valeurs de R-208,
  inchangées**), `DRIFT_THRESHOLD_FIELDS` (libellés, bornes, entiers), `parseDriftThreshold`, `usableDriftThresholds`,
  `driftRules` ; `DRIFT_RULES` devient la forme par défaut de `driftRules()`. `forecastDrift` lit `input.thresholds` (absent = défaut),
  `monteCarloCurrent` reçoit l’âge maximal.
- Seuils : SPI de réordonnancement (0,9), CPI de revue (0,95) et d’urgence (0,9), TCPI de réestimation (1,1), marge perdue en une
  semaine (5 j.o.), probabilités Monte-Carlo (50 % / 20 %), âge d’une analyse à jour (30 j), divergence des estimations (30 j /
  10 % du budget), avancement où la valeur acquise devient significative / fiable (15 % / 50 %), **alerte du portefeuille
  (20 %)**. Probabilités et parts saisies **en %**.
- Stockage : `app_settings` « `forecast.drift` » (`APP_SETTING_DRIFT`, `src/server/db/codes.ts`), lu par
  `src/server/dal/drift-thresholds.ts` ; la dérive prévue (`getDriftForecast`) et les alertes du portefeuille
  (`computePortfolioAlerts` → `onTimeChance`, donc aussi les alertes d’indicateurs notifiées) les suivent aussitôt.
- Écriture : `setDriftThreshold` (`src/server/dal/settings.ts`) — **directrice de portefeuille seule** (A-14, comme les autres
  seuils), une transaction, audit « Drift forecast thresholds » avec avant / après, fil d’activité ; « Rétablir les valeurs par
  défaut » remet `DRIFT_STANDARD` (audit de la remise à zéro avec les valeurs d’avant). Server Function
  `setDriftThresholdAction` (`src/features/admin/actions.ts`).
- Écran : carte **« Dérive prévue »** de Paramètres, sous « Qualité du planning » (même grille de champs, enregistrés à la sortie
  du champ / Entrée, valeur par défaut rappelée sous chaque champ ; lecture seule pour les autres rôles).
- Tests : `src/domain/drift-forecast.test.ts` (défauts, lecture, paires, seuils appliqués), `src/server/dal/drift-thresholds.test.ts`
  (droits par persona, bornes, paires, audit et fil, dérive prévue et seuil de l’alerte du portefeuille suivis, remise à zéro).

## 4. S-27 — alerte de glissement d’un planning fournisseur

- **Quand** : chaque matin, avec les alertes d’indicateurs (tâche **`indicator-alerts`**, `src/server/jobs/definitions.ts`) :
  `runSupplierSlipAlerts` (`src/server/dal/supplier-slip-notices.ts`). Pour chaque projet en exécution ayant des plannings
  fournisseurs : la prévision de chaque planning à la date d’état du projet (`supplierForecast`, celle du tiroir de la commande et
  de la carte du Plan) ; **glissement = le plus grand écart de fin** en jours ouvrés contre les dates engagées.
- **Seuil** : 5 jours ouvrés (`SUPPLIER_SLIP_ALERT_DAYS`, `src/domain/supplier-slip-alerts.ts`).
- **Une fois par niveau** : niveau 1 à partir de 5 j.o., 2 à partir de 10, 3 à partir de 15… Chaque niveau atteint est noté dans
  le journal d’envoi (`reminder_sends`, type `alert`, élément `supplier-slip:<commande>`, un créneau par niveau, occurrence
  `open`) ; la notification part au premier passage d’un niveau, jamais une deuxième fois (un planning qui redescend puis remonte au
  même niveau ne relance rien). Un planning revenu **sous 5 j.o.** voit ses niveaux effacés (`cleared:<date>`) : un nouveau
  glissement est signalé à nouveau.
- **Destinataires** : l’**acheteur de la commande** — la première personne active de [soumise par, créée par, propriétaire de
  l’appel d’offres] (la règle des avis de réception, `orderBuyer`), à défaut les utilisateurs Achats — et les **responsables du
  projet** (chef de projet titulaire, co-CP, adjoints). Comptes actifs seulement.
- **Notification** : cloche, type `alert` (famille « Alertes et suivi » de R-036 : l’e-mail suit les préférences de chacun,
  résumé quotidien par défaut). Titre « Planning fournisseur en glissement · PO-1078 · +10 jours ouvrés », sous-ligne : fournisseur
  · activité la plus en retard (texte saisi) ; ouvre les **Commandes d’achat** du projet sur la commande (`?po=`).
- Pas surveillé : commande annulée, planning dont toutes les activités sont terminées, projet hors exécution.
- Tests : `src/domain/supplier-slip-alerts.test.ts`, `src/server/dal/supplier-slip-notices.test.ts` (HLT-026 / PO-1078 : à
  l’heure → rien ; 10 j.o. → acheteur (Achats) et CP, une fois ; même niveau → rien ; niveau 3 → une notification ; redescente puis
  remontée → rien ; retour sous le seuil → effacé, nouveau glissement → signalé).

## 5. Décisions prises sans demander (faciles à changer)

1. **S-21** : « multi-équipements » = au moins **deux lignes d’équipement** (une ligne « 3 × MEMU » reste une ligne) ; les activités
   **communes** au projet gardent elles aussi une fin tolérée (la fin du projet), en plus d’une par ligne. Seules les fins sont
   concernées (le début reste unique).
2. **S-23** : une **colonne de la vue Santé** de l’écran Projets (pas de nouvel écran, pas de carte) ; nombre de contrôles **non
   conformes** (les « sans objet » ne comptent pas), avec le nombre de contrôles applicables dans l’infobulle ; mêmes projets que
   la colonne Santé. Calcul à l’affichage (jamais stocké), un projet après l’autre : sur un gros portefeuille, chaque projet coûte
   deux passes du moteur CPM en mémoire (test du chemin critique) — à mettre en cache (`versionedRead`) si l’écran ralentit.
3. **S-25** : un seul enregistrement « `forecast.drift` » pour les 13 seuils ; probabilités et parts **en %** dans Paramètres ;
   deux seuils d’une même règle doivent rester ordonnés (CPI d’urgence ≤ CPI de revue, probabilité urgente ≤ probabilité basse,
   avancement significatif ≤ fiable) — refus « Ce seuil doit rester cohérent avec son pendant » ; une valeur enregistrée invalide
   reprend le défaut. Le nombre d’activités nommées dans une mesure (3) n’est pas un seuil et reste fixe. L’alerte du portefeuille
   (20 %) est un seuil distinct de la probabilité « urgente » de la dérive prévue (20 % aussi), comme avant.
4. **S-27** : **niveaux de 5 j.o.** (5, 10, 15…) pour « une fois par niveau » ; seuil fixe (5 j.o., la réponse) plutôt qu’un
   réglage de Paramètres ; glissement mesuré sur le **planning fournisseur seul** (prévision de la commande, comme l’écran), qu’il
   soit rattaché au projet ou non ; contrôle **quotidien** (avec les alertes d’indicateurs, à l’heure des rappels) plutôt qu’à
   chaque saisie d’avancement — le glissement grandit aussi avec le temps (activité non commencée à sa date engagée) ; projets
   **en exécution** seulement ; personne n’est exclu (pas d’« auteur » : c’est la tâche planifiée qui signale).

## 6. Ce qui reste

- **S-21, S-23, S-25, S-27 : faits** (vérifiés sur la branche).
- S-26 (objet « lot d’achat ») et S-28 (planning fournisseur type par type de machine) : « plus tard » (S-28 avec R-053).
- R-204 : la ligne « Alertes » de son § 5 (glissement fournisseur → notifications) est maintenant faite.

## 7. Questions ouvertes

1. S-27 : faut-il aussi une **ligne dans les alertes du portefeuille** (Vue d’ensemble) pour un planning fournisseur en
   glissement, ou la cloche suffit-elle ?
2. S-27 : le seuil de 5 j.o. doit-il devenir un réglage de Paramètres ?
3. S-23 : faut-il la même colonne dans **Mes projets** (chef de projet) ?

## 8. Fichiers partagés touchés

`src/domain/schedule-quality.ts` (+ test), `src/domain/drift-forecast.ts` (+ test), `src/domain/portfolio-alerts.ts` (commentaire),
`src/server/dal/schedule-quality.ts`, `src/server/dal/drift-forecast.ts`, `src/server/dal/portfolio-alerts.ts`,
`src/server/dal/settings.ts`, `src/server/db/codes.ts`, `src/server/jobs/definitions.ts`, `src/features/admin/{actions.ts,model.ts,
settings-view.tsx,settings-i18n.ts}`, `src/features/projects/{register.tsx,register-cells.tsx,register-model.ts,register.module.css,
register-render.test.ts}`, `src/app/(app)/portfolio/projects/page.tsx`, `src/i18n/extra/index.ts`. Nouveaux :
`src/domain/supplier-slip-alerts.ts` (+ test), `src/server/dal/drift-thresholds.ts` (+ test), `src/server/dal/supplier-slip-notices.ts`
(+ test), `src/server/dal/schedule-quality-equipment.test.ts`, `src/i18n/extra/d9-s-quality.json`.
