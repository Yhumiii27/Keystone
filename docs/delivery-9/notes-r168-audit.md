# Livraison 9 — lot « audit » (R-168) : avant / après et motif dans toutes les écritures

Point de départ : la livraison 8 (`docs/delivery-8/notes-audit-i18n-shell.md` § R-168) a rendu `audit_entries` en ajout seul
(déclencheurs, migration 0017), ajouté l’utilisateur, `before` / `after` (jsonb), `reason` et les quatre colonnes de l’export
CSV ISO. Seules quelques écritures remplissaient avant / après (connexion, puis les lots livrés depuis : expéditions, catalogue,
feuille de site…). Ce lot fait le balayage annoncé : chaque écriture qui change une valeur métier enregistre maintenant les
champs modifiés avant / après et, quand l’acteur en donne un, le motif.

Aucune migration (les colonnes existent depuis 0016). Aucune nouvelle dépendance (`typescript`, déjà en dépendance de
développement, sert au test de garde).

## 1. Ce qui a été fait

### Forme commune

- `changedValues(before, after)` (`src/domain/audit-trail.ts`, règle pure, testée dans `audit-trail.test.ts`) : ne garde que
  les champs dont la valeur change (comparaison par valeur : tableaux, objets, dates), mêmes clés des deux côtés ; un champ
  `undefined` côté « après » ne fait pas partie de la modification ; null quand rien ne change. Utilisé en étalement
  (`...changedValues(…)`) dans l’appel d’audit.
- Même forme que le lot audit de la livraison 8 : `{ champ: valeur }` compacts, noms de champs du code (`status`,
  `budgetKeur`, `dueDate`…), codes et non libellés (`status: 'in_review'`, pas « En revue »). Suppression : `before` = ce qui
  disparaît, `after` null ; création (quand elle est remplie) : `after` seul.
- Motif (`reason`) : le texte saisi par l’acteur lors d’un refus, d’une annulation, d’un rejet ou d’un commentaire de décision ;
  `writeAudit` le rogne (vide → null). Le texte de la modification (`change`) n’est pas modifié : les lecteurs qui le
  comparent (kpis.ts, quality.ts, R-184) restent identiques.

### Écritures complétées (avant / après, motif quand il existe)

| Domaine | Écritures |
|---|---|
| Contrat et facturation (`contract.ts`) | fiche contrat (champs modifiés), avenant envoyé / signé, caution libérée, jalon modifié / supprimé, facture émise, paiement — les aides `audit` / `trace` du module prennent un paramètre `values` |
| Demandes de ressources (`requests.ts`) | envoi d’un brouillon, brouillon supprimé, retrait, nouvelle demande, personne nommée, approbation, report proposé (+ motif), refus (+ motif), report accepté |
| Achats (`purchasing.ts`, `order-currency.ts`) | commande soumise, annulée / retirée (+ motif), approuvée / refusée (+ motif), devise de la commande (prix des lignes), transitions et attribution d’appel d’offres, décisions sur facture fournisseur |
| Changements (`changes.ts`, `change-activities.ts`, `change-posting.ts`) | soumission, décision d’une étape (+ commentaire), création (valeurs saisies), activités touchées / retirées, durées appliquées, imputation au budget (BAC, catégorie), avenant préparé |
| Budget et coûts | catégorie de coût modifiée, taux budgétaire du projet (`currency.ts`), réserve pour aléas : demande (+ justification) et décision (+ commentaire), grille de taux et coefficients (`hr.ts` : masqués comme avant pour qui ne voit pas les taux, R-046), import et affectation des heures |
| Planification | calendrier du projet / d’une activité, calendrier importé, exceptions, liens (ajout, suppression), corbeille (suppression, restauration), replanification (fin du projet), référence affichée, instantané de référence (`baselines.ts`) |
| Tâches | statut, avancement, case de liste, temps saisi (`tasks.ts`, `activity-todos.ts`, à-faire supprimé), fichier retiré |
| Équipe projet | ajout, changement de rôle, retrait (`project-team.ts`) |
| Documents | nouvelle révision, changement de statut, décision d’approbation (+ commentaire de rejet), lancement du circuit, accusé de réception client, synchronisation Codex (statut, révision) |
| Qualité, chantier, mise en service | livrables (statut, décision client + motif du rejet, document lié), contrôles ITP (résultat + commentaire), prérequis et matériel de chantier, SAT planifié, leçons et clôture (REX), contrôles d’ingénierie, entrées confirmées |
| Après-vente | réclamation modifiée / avancée, intervention terminée, configuration de la machine |
| Livraisons et stock | enregistrement et décision de contrôle d’une réception, mouvement de stock (en main, réservé), réservation prise par dérogation |
| Cycle de vie | changement d’étape (+ motif), décision sur un forçage (+ commentaire), livrable BL1 coché |
| Risques, priorisation | modification d’un risque (tous les champs modifiés, VAE), notes de priorisation (+ commentaire) |
| Réglages | types de machine (fiche, phases, systèmes ITP, catégories de coûts, référence REX retirée), valeurs de référence et lieux retirés, seuils (santé, CCB, écart d’heures), remise aux valeurs par défaut (seuils), connecteurs (fichier d’IT et écran ; les options `config` ne sont pas recopiées, seulement « options changed ») |
| Scénarios « et si » | priorité, levier, nivellement, renommage, suppression, application |
| Réunions | propositions de transcription écartées / restaurées / modifiées / appliquées |
| Connecteurs | progression ECO et NCR envoyée à Vigie (+ commentaire), antivirus (fichier libéré / bloqué) |
| Autres | communication client (suite faite / rouverte), demande client prise en charge / répondue / close, interfaces, imports (appliqué, annulé), mapping P&ID |

### Test de garde

`src/server/audit-coverage.test.ts` lit les sources (comme `use-server-exports.test.ts`, avec l’analyseur TypeScript) : chaque
appel de `writeAudit`, `addAudit`, `trace` et des aides d’audit des modules (`LOCAL_WRITERS` : `audit` du contrat et des
scénarios, `auditMeeting`, `auditTask`, `auditSettings`, `traceRate`…) doit passer `before`, `after` ou `reason` (objet
littéral avec une de ces clés, étalement, ou `changedValues(…)`). Les appels qui n’en portent légitimement pas sont listés
dans `ALLOWED` avec leur raison (`creation`, `event`, `system`, `wrapper`) et leur nombre ; une entrée devenue inutile fait
échouer le test (liste tenue à jour). Une nouvelle écriture d’audit doit donc remplir ses valeurs ou s’inscrire dans la liste.

Test d’intégration `src/server/dal/d9-audit-values.test.ts` (PGlite, jeu de démonstration) : refus avec motif, statut de
tâche, fiche contrat (seul le champ modifié), risque, seuil CCB.

## 2. Décisions prises sans demander

| Sujet | Choix | Pourquoi |
|---|---|---|
| Créations | Non remplies (sauf demande de changement, lien de planning, réserve pour aléas, grille de taux, connecteur ajouté : peu coûteux et utiles), listées « creation » dans la garde | Consigne du lot : la ligne créée est l’« après » ; le texte de la modification la décrit |
| Événements et systèmes | Connexion / déconnexion, commentaires, pièces jointes, exports, synchronisations, imports d’un connecteur : sans avant / après | Aucune valeur stockée ne change, ou le détail est dans l’enregistrement du connecteur |
| Replanification | Avant / après = date de fin du projet (+ nombre d’activités modifiées) | Le détail par activité est déjà dans `schedule_runs.details` ; le recopier rendrait la ligne d’audit énorme |
| Options d’un connecteur | Non recopiées dans l’audit | Elles peuvent contenir des réglages d’intégration ; le texte « options changed » suffit |
| Taux | Avant / après remplis ; masqués avec le reste de la ligne pour qui ne voit pas les taux | `ratesMaskedAudit` masquait déjà `before` / `after` / `reason` (R-046) |
| ECO / NCR Vigie | L’audit porte l’étape ou la décision **demandée** à Vigie (`requestedStatus`) | Vigie possède la fiche ; Keystone n’enregistre que sa demande (boîte d’envoi) |
| `addAudit` | Gardé (aucun appelant) | Hors du périmètre du lot ; le supprimer est une autre décision |

## 3. Écarts

Aucun : aucun texte de modification ni aucun affichage n’a changé ; seules les colonnes `before` / `after` / `reason` (déjà
exportées dans le CSV ISO depuis la livraison 8) sont maintenant remplies.

## 4. Ce qui reste

- **R-168 — REVOKE quand l’hébergement est choisi** : l’immuabilité réelle (propriétaire de table distinct,
  `REVOKE UPDATE, DELETE, TRUNCATE` au rôle applicatif) attend le choix de l’hébergement (I-1a). Les déclencheurs de 0017
  restent la protection actuelle (preuve de falsification, pas impossibilité).
- Créations, événements et écritures de systèmes listés dans `ALLOWED` : sans avant / après par choix (voir § 2) ; à remplir
  au cas par cas si l’export ISO le demande.

## 5. Questions ouvertes

Aucune pour ce lot.
