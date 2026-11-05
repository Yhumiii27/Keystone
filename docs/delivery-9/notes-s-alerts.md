# Livraison 9 — lot « Alertes » (S-33, S-34)

Statut : construit sur la branche `s-alerts` (depuis `0d87a07`) le 5 nov. 2026, d’après les réponses du responsable produit du même
jour (`docs/DECISIONS.md`, fin de « Suites des lots de suivi »). **Aucune migration** (les deux seuils S-34 sont une ligne de
`app_settings`). Aucune nouvelle dépendance.

| Question | Réponse | État |
|---|---|---|
| S-33 | Les alertes de la Vue d’ensemble gardent leur plafond (8) mais sont classées par urgence et importance, plus par type | **fait** (§ 1) |
| S-34 | Un glissement fournisseur qui dure trop longtemps et touche fortement le projet est aussi signalé aux directeurs, selon des seuils de Paramètres | **fait** (§ 2) |

## 1. S-33 — ordre des alertes du portefeuille

### La règle, en clair (à vérifier par le responsable produit)

Chaque alerte reçoit une **note** ; la liste va de la plus haute à la plus basse, puis est coupée à 8.

1. **D’abord la gravité (trois classes).** Une alerte d’une classe passe toujours avant toutes celles de la classe suivante.
   - **Classe 1 — la date de fin ou le contrat du projet est touché** : projet « hors trajectoire » (seuils de Paramètres),
     glissement du chemin critique (marge négative), et glissement fournisseur qui **repousse la fin prévue du projet** d’au moins
     le seuil S-34 (5 jours ouvrés par défaut).
   - **Classe 2 — un indicateur du projet dérive** : dépassement de coût, facturation en retard, jalon en retard (chemin critique
     encore dans sa marge), faible probabilité Monte-Carlo de tenir la date de fin, glissement fournisseur sans (assez d’) effet sur
     la fin du projet.
   - **Classe 3 — l’organisation du portefeuille** : personnes surchargées dans le pool commun, approbations en attente.
2. **Puis l’ampleur, à l’intérieur de la classe.** Chaque alerte est mesurée en part (0 à 100 %) d’une « taille de référence » ;
   au-delà, elle compte pour 100 % :

   | Alerte | Ce qui est mesuré | 100 % à partir de |
   |---|---|---|
   | Hors trajectoire | écart du plus faible des deux indices (CPI, SPI) sous le seuil « hors trajectoire » | 0,20 sous le seuil |
   | Glissement du chemin critique | jours ouvrés de marge négative | 60 jours ouvrés (≈ un trimestre) |
   | Glissement fournisseur qui repousse la fin (classe 1) | jours ouvrés de recul de la fin du projet | 60 jours ouvrés |
   | Glissement fournisseur (classe 2) | jours ouvrés de retard sur les dates engagées du fournisseur | 60 jours ouvrés |
   | Dépassement de coût | prévision au-dessus du budget, en part du budget | 20 % du budget |
   | Facturation en retard | jours calendaires depuis l’échéance la plus ancienne (facture échue ou jalon non facturé) | 60 jours |
   | Jalon en retard | nombre de jalons « en retard » | 3 jalons |
   | Probabilité Monte-Carlo | part manquante sous le seuil (à 0 % de chance : 100 %) | 0 % de chance |
   | Surcharge du pool | nombre de personnes au-dessus de 110 % | 5 personnes |
   | Approbations en attente | jours d’attente de la plus ancienne | 30 jours |

3. **À égalité de note** (rare) : l’ancien ordre par type (hors trajectoire, chemin critique, coût, facturation, pool,
   approbations, jalon, fournisseur, Monte-Carlo), puis l’ordre des projets dans le registre, puis la clé de l’alerte — l’ordre
   est toujours le même pour les mêmes données.

**Exemple (jeu de démonstration, 25 sept. 2026)** : RCF-019 chemin critique −29 j (48 %), HLT-026 chemin critique −27 j (45 %),
HLT-026 hors trajectoire SPI 0,82 (0,08 sous 0,90 : 40 %), MSR-012 −9 j, NDC-031 −4 j ; puis le dépassement de coût de RCF-019
(+46 k€ sur 1,35 M€ : 17 %) ; puis 3 personnes surchargées (60 %) avant l’approbation en attente depuis 15 jours (50 %).
Auparavant : hors trajectoire d’abord, puis les glissements, le coût, le pool, les approbations.

### Mise en œuvre

- Règle pure `src/domain/alert-priority.ts` : `alertClass`, `magnitude`, `alertScore` (classe 1 = 3 000 à 4 000, classe 2 =
  2 000 à 3 000, classe 3 = 1 000 à 2 000 ; l’ampleur en millièmes), `compareAlerts` (note, ancien ordre, registre, clé), tailles
  de référence `ALERT_MAGNITUDE_SCALES` (une constante, facile à changer).
- `portfolioAlertRules` (`src/domain/portfolio-alerts.ts`) note chaque alerte et trie par `compareAlerts` ; le plafond reste
  `maxAlerts` (8). Le planning fournisseur nommé dans la ligne S-30 est celui qui **repousse le plus la fin du projet**, puis le
  plus grand glissement ; la ligne affiche « · fin du projet +6 jours ouvrés » quand il la repousse.
- Les trois affichages lisent la même liste, donc le même ordre : Vue d’ensemble (filtre de zone appliqué après), « Ce qui demande
  attention » de l’accueil du directeur, widget « Alertes » des tableaux de bord (`dashboard-data.ts` filtre puis coupe, sans
  retrier).
- Effet sur les notifications « alerte d’indicateur » (`runIndicatorAlerts`) : elles partent des 8 alertes affichées ; le nouvel
  ordre peut donc changer **lesquelles** sont notifiées quand le portefeuille en a plus de 8 (les plus graves, désormais).
- Tests : `src/domain/alert-priority.test.ts` (classes, ampleur, note, départage déterministe), `src/domain/portfolio-alerts.test.ts`
  (ordre et plafond mis à jour avec un commentaire S-33, classe 1 du glissement fournisseur qui repousse la fin, texte EN / FR),
  `src/server/dal/portfolio-alerts.test.ts` (ordre du jeu de démonstration mis à jour, commentaire S-33).

## 2. S-34 — glissement fournisseur signalé aux directeurs

### La règle

Un planning fournisseur en glissement (S-27) est **aussi signalé aux directeurs de portefeuille** quand les deux conditions sont
réunies :

1. **Durée** : le glissement dure depuis au moins **10 jours ouvrés** (défaut) — comptés sur le calendrier du projet depuis le jour
   où il a atteint pour la première fois le seuil d’alerte S-31 (le jour où S-27 l’a signalé à l’acheteur) ;
2. **Impact** : il **repousse la fin prévue du projet** d’au moins **5 jours ouvrés** (défaut). Mesure : la fin des activités du
   projet calculée par le moteur CPM avec le planning fournisseur tel qu’il est prévu, comparée à la même fin si ce fournisseur
   tenait ses dates engagées (`supplierFinishImpact`, `src/domain/supplier-schedule.ts`). Un planning **non lié** au planning du
   projet ne peut pas le déplacer : impact 0, jamais signalé aux directeurs.

**Une seule notification par épisode** : un épisode commence quand le glissement atteint le seuil S-31 et finit quand le planning
repasse sous ce seuil (les paliers S-27 sont alors effacés, la marque « directeurs prévenus » aussi) ; un nouveau glissement
ouvre un nouvel épisode.

### Mise en œuvre

- Règles pures (`src/domain/supplier-slip-alerts.ts`) : `SUPPLIER_SLIP_ESCALATION_STANDARD` (`{ days: 10, impactDays: 5 }`),
  bornes (durée 1–120, impact 1–60 jours ouvrés entiers, `parseSupplierSlipEscalation`, `usableSupplierSlipEscalation` : valeur
  absente ou invalide → défaut), `shouldEscalateSupplierSlip`, titre `supplierSlipEscalationTitle`. Impact :
  `supplierOnCommitment` / `supplierFinishImpact` (`src/domain/supplier-schedule.ts`) — une activité du fournisseur avec une fin
  engagée finit à cette date (ou plus tôt si elle l’a fait), un jalon pas encore atteint garde sa logique et sa date engagée.
- Stockage : `app_settings` « `purchasing.supplierSlipEscalation` » = `{ days, impactDays }` (`APP_SETTING_SUPPLIER_SLIP_ESCALATION`),
  **à côté** du seuil S-31 (ligne distincte : écrire l’un n’efface jamais l’autre), lu par `readSupplierSlipEscalation`
  (`src/server/dal/supplier-slip-threshold.ts`).
- Écriture : `setSupplierSlipEscalation` (`src/server/dal/settings.ts`) — **directrice de portefeuille seule** (A-14), une
  transaction, audit « Supplier slip escalation thresholds » avec avant / après, fil d’activité ; « Réinitialiser » remet 10 et 5
  (audit de la remise à zéro avec les valeurs d’avant). Server Function `setSupplierSlipEscalationAction`
  (`src/features/admin/actions.ts`).
- Écran : dans la carte **« Glissement des plannings fournisseurs »** de Paramètres, sous le seuil S-31, la règle en une phrase et
  deux champs « Directeurs prévenus après (jours ouvrés de glissement) » et « Si la fin du projet recule d’au moins (jours ouvrés) »
  (enregistrés à la sortie du champ / Entrée, défaut rappelé dessous ; lecture seule pour les autres rôles).
- Tâche quotidienne (`runSupplierSlipAlerts`, tâche « indicator-alerts ») : début de l’épisode = plus ancien `run_on` des lignes
  de palier ouvertes (`reminder_sends`, `supplier-slip:<commande>`) ; si la durée est atteinte et que les directeurs ne sont pas
  déjà prévenus, l’impact est calculé (deux passes CPM, seulement dans ce cas) ; envoi par le même mécanisme que S-27 : journal
  d’envoi (créneau `directors`), cloche type `alert` (l’e-mail suit les préférences de chacun, R-036). Titre « Glissement
  fournisseur remonté à la direction · PO-1078 · +12 jours ouvrés · fin du projet +6 jours ouvrés », sous-ligne : projet ·
  fournisseur · activité la plus en retard ; ouvre la commande (`?po=`). Destinataires : tous les comptes actifs ayant le rôle
  directeur. Compteurs `escalated` / `directorsNotified` dans le résumé de la tâche.
- Le même impact sert à S-33 : `supplierSlipsOf(…, { impactFrom })` le calcule pour les plannings au-dessus du seuil S-31.
- Tests : `src/domain/supplier-slip-alerts.test.ts` (défauts, saisie, deux conditions, titre EN / FR),
  `src/domain/supplier-schedule.test.ts` (fournisseur tenu à ses dates, recul de 4 jours ouvrés, retard absorbé par la marge,
  planning non lié, boucle), `src/server/dal/supplier-slip-escalation.test.ts` (droits pour chaque persona, bornes, message
  français, audit et fil, remise à zéro ; HLT-026 / PO-1078 lié à A1430 : pas avant 10 jours ouvrés, une notification aux
  directeurs puis rien dans le même épisode, impact sous le seuil → rien, nouvel épisode → nouvelle notification ; ligne du
  portefeuille en classe 1).

## 3. Décisions prises sans demander (faciles à changer)

1. **S-33** : trois classes et tailles de référence du tableau ci-dessus (`ALERT_MAGNITUDE_SCALES`) ; la facturation en retard
   est en classe 2 (argent non encaissé, pas la date de fin) ; un jalon en retard sans marge négative reste en classe 2 (Keystone ne
   sait pas s’il est contractuel). L’urgence est mesurée par « combien de retard / d’écart », pas par la proximité d’une échéance
   future (aucune alerte actuelle ne porte d’échéance à venir).
2. **S-33** : une alerte de classe 2 ne passe jamais devant une de classe 1, même très grosse (pas de mélange des classes).
3. **S-34** : un **réglage à part** (`purchasing.supplierSlipEscalation`) plutôt que d’agrandir `purchasing.supplierSlip` (S-31) ;
   même carte de Paramètres.
4. **S-34** : impact mesuré sur la **fin prévue du projet** (ses propres activités, pas les activités du fournisseur), contre le
   même réseau avec ce fournisseur à ses dates engagées — ce qui ne compte que la part due au glissement. Un planning non lié au
   planning du projet n’est jamais remonté.
5. **S-34** : durée comptée en **jours ouvrés du calendrier du projet** depuis le premier palier S-27 de l’épisode ; un
   glissement sans acheteur ni responsable à prévenir n’ouvre pas d’épisode (cas improbable : S-27 se rabat sur les utilisateurs
   Achats).
6. **S-34** : **tous les directeurs** (rôle directeur, comptes actifs), même s’ils sont aussi responsables du projet ; une seule
   notification par épisode, même si le glissement s’aggrave ensuite (S-27 continue de signaler chaque palier à l’acheteur et aux
   responsables).
7. **S-34** : le seuil d’impact sert aussi à S-33 (glissement fournisseur en classe 1).

## 4. Ce qui reste

- **S-33 : fait. S-34 : fait** (vérifiés sur la branche : `npm run typecheck`, `npm run lint`, suite complète, build de
  production).

## 5. Questions ouvertes

1. S-33 : les tailles de référence (60 jours ouvrés de marge négative, 20 % de dépassement, 60 jours de facturation en retard…)
   conviennent-elles, et la facturation en retard doit-elle remonter en classe 1 ?
2. S-34 : faut-il relancer les directeurs si le glissement s’aggrave beaucoup dans le même épisode (par exemple à chaque nouveau
   palier d’impact) ?

## 6. Fichiers partagés touchés

`src/domain/portfolio-alerts.ts` (+ test), `src/domain/supplier-slip-alerts.ts` (+ test), `src/domain/supplier-schedule.ts`
(+ test), `src/server/db/codes.ts`, `src/server/dal/portfolio-alerts.ts` (+ test), `src/server/dal/supplier-slip-notices.ts`,
`src/server/dal/supplier-slip-threshold.ts`, `src/server/dal/settings.ts`, `src/server/jobs/definitions.ts`,
`src/features/admin/{actions.ts,model.ts,settings-view.tsx}`, `src/i18n/extra/index.ts`, `src/i18n/fr-rules.ts`. Nouveaux :
`src/domain/alert-priority.ts` (+ test), `src/server/dal/supplier-slip-escalation.test.ts`, `src/i18n/extra/d9-s-alerts.json`.
