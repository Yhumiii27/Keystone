# Livraison 9 — lot « delegation » (R-051, R-064 partie technique)

Demande du propriétaire du 29 oct. 2026 : faire tout ce qui n’attend pas d’information de sa part. Migration **0067**
(`0067_approval_delegations.sql`, régénérée après la fusion de `main-2a2fep` (0066 = notification_mail)).

## 1. R-051 — délégation des validations à un suppléant (réponse P-7d)

> P-7d (Plus tard) : « Suppléant déclaré par l’approbateur pour une période ».

### Ce qui est construit

**Données** (`src/server/db/schema/delegations.ts`) : table `approval_delegations` — approbateur et suppléant (comptes
`users`), premier et dernier jour métier (inclus), note facultative, auteur ; jamais supprimée : une suppléance est
**annulée** (`cancelled_at`, `cancelled_by_name`, `cancel_reason`). Colonnes ajoutées : `audit_entries.on_behalf_of_name`
et `activity_events.on_behalf_of_name` (nullable, `ADD COLUMN` sans valeur par défaut : aucune ligne réécrite, le
déclencheur d’ajout seul de R-168 n’est pas sollicité ; les vues `pub_` ne changent pas).

**Règles pures** (`src/domain/delegations.ts`, tests `delegations.test.ts`) :
- état à la date métier : à venir, en cours (bornes incluses), terminée, annulée ;
- refus : soi-même, un client ou un utilisateur externe, un compte inactif, un approbateur client, dates invalides, fin
  avant début, période déjà terminée, plus d’un an (`DELEGATION_MAX_DAYS` = 366), **chevauchement** avec une autre
  suppléance non annulée du même approbateur ;
- annulation : l’approbateur (la sienne) ou le directeur de portefeuille (toutes), tant qu’elle n’est ni terminée ni
  annulée ;
- `decisionKey` : identité d’une décision de ligne (ordre des champs indifférent, libellé d’étape ignoré).

**Routage** (`src/server/approvals/index.ts`) : `getApprovalInbox(viewer)` = la file propre du lecteur
(`getOwnApprovalInbox`, inchangée) **puis**, pour chaque suppléance en cours qui le nomme (`delegatorsOf`), la file
**propre** de l’approbateur (les 12 fournisseurs, mêmes règles, même projet courant), chaque élément marqué
`onBehalfOf: { name, delegationId }` ; un élément déjà dans la file du lecteur n’est pas répété. Badges
(`approvalCount`, `approvalCountsByProject`) : comptent aussi ces éléments, une fois chacun. L’approbateur garde sa file
entière et peut toujours décider lui-même.
- **Pas de chaînage** : on ne prend que la file propre de l’approbateur (jamais ce qu’il reçoit lui-même comme suppléant) ;
  dans une décision déléguée, `delegatorsOf` ne renvoie rien et `runOnBehalf` refuse d’être imbriqué.
- Un client ne déclare ni ne reçoit de suppléance.

**Décision pour le compte de** (`src/features/myapprovals/delegation-actions.ts` `decideOnBehalfAction`, appelée par
les boutons Approuver / Refuser d’une ligne déléguée) : vérifie que la suppléance existe, nomme le lecteur, est en cours à
la date métier, puis que la décision figure **dans la file propre de l’approbateur** (la décision exécutée est la copie du
serveur, pas celle du navigateur). La Server Function du module (commandes, demandes de modification, ECO, livrables,
réception, NCR, demandes de ressources, changement de phase forcé, provision, documents Codex) est ensuite appelée dans
`runOnBehalf` (`src/server/delegation-scope.ts`, AsyncLocalStorage) :
- `getViewer()` (`src/server/session.ts`) répond l’approbateur **pendant cet appel seulement** : les droits et le routage
  de l’approbateur s’appliquent à cet élément, rien d’autre n’est élargi (les pages des projets restent ouvertes au
  suppléant selon ses propres droits, le lien de la ligne compris) ;
- `writeAudit` / `recordActivity` (`src/server/db/helpers.ts`) écrivent les lignes au nom du **suppléant** (personne et
  compte), `on_behalf_of_name` = l’approbateur. Journal d’audit et fil d’activité (Activité & intégrations, export Excel)
  affichent « Antoine Girard (pour le compte de Romain Aubert) » ; le CSV ISO 9001 a une 11ᵉ colonne « Pour le compte de ».

**Écran Mes validations** :
- bandeau du suppléant en haut (« Vous suppléez Romain Aubert · 25 sept. 2026 → 2 oct. 2026 — ses validations figurent
  ci-dessous avec « Pour le compte de » », et les suppléances à venir) ;
- chaque ligne déléguée porte « Pour le compte de <approbateur> » ;
- carte « Suppléance » sous la file : « Déclarer un suppléant » (personne interne active, du / au, note visible du
  suppléant), suppléances en cours ou à venir de l’approbateur avec « Annuler la suppléance » (motif facultatif) ; le
  directeur voit et annule toutes les suppléances.
- Déclaration et annulation : auditées (zone « My approvals »), au fil d’activité ; le suppléant est notifié dans la
  cloche (« Vous suppléez un approbateur », « Suppléance annulée » — aussi l’approbateur quand le directeur annule).

**Tests** : `src/domain/delegations.test.ts` (règles), `src/features/myapprovals/delegation.test.ts` (base de démonstration,
vraie session « Voir en tant que ») : refus de déclaration, chevauchement, routage pendant / avant la période, décision
d’une commande tracée « pour le compte de » (audit, activité, compte du suppléant), élément d’un autre, décision forgée,
autre personne utilisant la suppléance, pas de chaînage, annulation (suppléant refusé, directeur accepté), rendu FR, panneau
pour chaque persona.

### Décisions prises sans demander

1. **Nom dans les enregistrements métier** : la décision est enregistrée par le module avec ses propres règles, donc au
   nom de l’approbateur dans les colonnes métier (`decided_by` d’une étape, approbateur d’une commande, envoi à Codex /
   Vigie) ; la trace de qui a cliqué est l’audit et l’activité (au nom du suppléant, « pour le compte de »). Les
   compteurs « Décidé cette semaine » comptent donc ces décisions pour l’approbateur. Plus sûr que de modifier les 10
   écrivains ; à revoir si le propriétaire veut le nom du suppléant sur la pièce elle-même.
2. **Suppléant** : tout utilisateur interne actif (pas de contrôle « peut voir les projets concernés » : il ne voit que
   les éléments routés, et décide avec les droits de l’approbateur pour ces seuls éléments).
3. **Durée maximale** un an ; une suppléance peut commencer plus tard ; le suppléant ne peut pas l’annuler (il s’adresse
   à l’approbateur ou au directeur) ; le directeur ne déclare pas pour autrui (il voit et annule seulement).
4. **Notifications du module** (ex. « commande annulée » à l’acheteur) : envoyées comme si l’approbateur avait décidé
   (l’acteur des notifications reste l’approbateur) ; l’audit porte la vérité.
5. Les éléments sans décision en ligne (appels d’offres, factures) apparaissent chez le suppléant mais se décident sur
   leur écran, selon ses propres droits.

### Reste / questions

- R-051 : **fait** côté Keystone (à vérifier après intégration).
- Question au propriétaire : faut-il le nom du suppléant sur la pièce elle-même (étape de demande de modification,
  commande, décision envoyée à Codex) en plus de l’audit ? Faut-il prévenir Codex / Vigie qu’une décision a été prise par
  un suppléant (aujourd’hui, l’outbox porte l’approbateur) ?

## 2. R-064 — corbeille du Plan, partie technique

Constat dans le code (rien à modifier) :
- **Purge planifiée** : déjà faite (R-006, livraison 7) — tâche `plan-trash-purge` du worker, **toutes les heures**
  (`src/domain/jobs.ts`, `src/server/jobs/definitions.ts` → `purgeExpiredPlanTrash`), entrées de plus de 30 jours et
  au-delà de 20 par projet, fichiers joints supprimés ; testée (`src/server/jobs/jobs.test.ts`, « plan-trash purge
  (every project) »). Horaire plutôt que quotidien demandé : plus strict, gardé. La preuve citée dans
  `reste-a-developper.json` (« purge() appelée seulement depuis trashPlanRow ») est périmée.
- **Positions après restauration** : déjà corrigées en livraison 8 (« emplacements fantômes » :
  `shiftTrashedPositions`, `maxTrashedPosition`, repli si un emplacement est pris, liens remis en dernier ;
  `src/server/dal/plan-trash-positions.test.ts`, 4 cas). Aucun doublon restant trouvé.

R-064 reste **en cours** : il n’attend plus que la confirmation S-5 du propriétaire (30 jours, 20 entrées, suppression et
restauration réservées au CP et au directeur — `src/domain/ch4-defaults.ts`).
