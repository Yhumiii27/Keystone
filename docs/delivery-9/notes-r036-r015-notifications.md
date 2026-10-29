# Livraison 9 — lot « notifications » (R-036 suite, R-015 reste)

Construit le 29 oct. 2026 sur la branche `lotB-notifications`, à la suite de R-199 (`notes-r199-reminders.md`), dont il réutilise
le transport (`src/server/mail/`), les préférences (`reminder_preferences`, cloche), le journal d’envoi (`reminder_sends`) et les
tâches du matin. Migration **0066** (`0066_notification_mail.sql`, générée).

## 1. R-036 — notifications par e-mail, préférences par personne

### Ce qui part, et quand

Chaque notification de la cloche appartient à une **famille** (`src/domain/notification-mail.ts`, `FAMILY_OF_KIND`) :

| Famille | Types de notification | Défaut de Keystone |
|---|---|---|
| Approbations et réponses attendues | `approval`, `eco`, `request` | e-mail immédiat |
| Tâches qui me sont confiées | `task` | e-mail immédiat |
| Mentions (@) | `mention` | e-mail immédiat |
| Alertes et suivi | `alert`, `quality`, `delivery`, `invoice`, `sync` | résumé quotidien |

Pour chaque famille, la personne choisit : **e-mail immédiat**, **résumé quotidien** ou **pas d’e-mail**. La cloche reçoit
toujours. Les rappels d’échéance et les rapports hebdomadaires de R-199 gardent leur propre e-mail (`createNotification({ email:
false })`) et ne passent pas par ce canal.

- **Immédiat** : `createNotification` choisit l’état de chaque destinataire dans sa transaction (`notification-routing.ts`), puis,
  après l’enregistrement, envoie les e-mails immédiats (`sendImmediateMails`). Chaque ligne est réclamée (`immediate → sending`,
  un seul `UPDATE … RETURNING`) avant l’envoi : deux envois concurrents n’envoient jamais deux fois. La tâche
  **`notification-mails`** (toutes les 5 min) envoie ce qu’un arrêt a laissé en attente et passe en échec, sans nouvel essai, une
  ligne restée « en cours d’envoi » plus de 30 min (au plus une fois, comme les rappels).
- **Résumé quotidien** : tâche **`notification-digest`**, chaque matin à l’heure des rappels (07:00 Paris par défaut) : un
  e-mail par personne avec les notifications gardées pour le résumé et **pas encore lues** dans la cloche (une notification lue
  avant le résumé n’est pas envoyée : état `seen`). Une seule fois par personne et par jour (`reminder_sends`, type `digest`,
  clé personne + `notification_digest` + `daily` + date métier) ; une deuxième exécution le même jour remet les lignes en attente
  pour le lendemain.
- **Clients** : un compte qui n’a que le rôle client reçoit tout de suite ce que les autres reçoivent dans le résumé (« envoi
  immédiat … pour les clients ») ; « pas d’e-mail » reste son choix.
- **Sans transport** (`KEYSTONE_MAIL_TRANSPORT=none`, le défaut) : l’état `no_transport` est noté à la création ; rien n’est
  envoyé plus tard quand la DSI branchera le transport (pas de rattrapage d’un arriéré).
- État de chaque e-mail : `notification_recipients.mail_state` (`immediate`, `digest`, `sending`, `sent`, `digested`, `seen`,
  `off`, `no_transport`, `no_address`, `not_visible`, `failed`), `mail_at`, `mail_error`. Les lignes d’avant R-036 restent à
  `null`.

### Droits

Une personne ne reçoit par e-mail que ce que sa cloche lui montre (`noticeVisibility`, même règle que le filtre de lecture de
`dal/shell.ts`) : un compte interne, toute notification qui lui est adressée ; un client, seulement les notifications des projets
de son organisation sur les écrans de son espace, jamais une NCR ni les achats, jamais un projet d’une filiale (R-190). Sinon :
`not_visible`, rien n’est envoyé.

### Textes

En français (langue par défaut, comme les rappels) : objet « Keystone — <titre> · <projet> », corps = la notification telle que la
cloche l’affiche (titre traduit, sous-ligne par `fieldsText`), le projet, le lien absolu (`KEYSTONE_PUBLIC_URL`), le pied « Message
automatique … › Notifications et rappels ». Résumé : « Keystone — Résumé quotidien · n notifications », la liste des notifications
(projet, titre, sous-ligne, heure, lien).

### Préférences (interface)

- `ReminderPrefs` reçoit `notifications` (un mode par famille), stocké dans `reminder_preferences.notification_modes` (jsonb ;
  `null` = celui de la valeur par défaut de l’entreprise) et dans le réglage `reminders.defaults` pour la valeur par défaut.
- Cloche › bouton **« Notifications et rappels »** (renommé, ex-« Rappels et rapports ») : la boîte de dialogue reçoit quatre
  listes « E-mail · <famille> ». Carte de Paramètres renommée « Notifications, rappels et rapports — valeur par défaut », avec les
  quatre familles. Mêmes Server Functions (`src/server/actions/reminders.ts`), même audit (avant / après ; le texte d’audit nomme
  les modes quand ils diffèrent du défaut de Keystone).
- Pied du panneau de notifications : plus aucune annonce de Teams ni de préférences inexistantes (déjà corrigé par R-199) ; il
  dit maintenant « Les notifications, les rappels et les rapports hebdomadaires partent aussi par e-mail, selon vos choix » quand
  un transport est configuré, sinon « E-mail pas encore connecté ».

### Invitations SAT et notifications client « envoyées »

- **Planifier la SAT** (`planSat`) : l’invitation part maintenant aux **contacts du client externe** du projet (comptes actifs au
  rôle client de l’organisation cliente) — notification « Invitation à la SAT » (système · date · témoins) et e-mail immédiat. Le
  message « SAT planifiée · invitation envoyée au client » n’est affiché que si quelqu’un a été invité ; sinon « SAT planifiée ·
  aucun contact client à inviter ».
- **Décision du 25 oct. 2026** : un client **interne** (filiale du groupe, `clients.is_internal`) suit ses projets dans Arche —
  ses contacts ne reçoivent rien de Keystone (`clientContactIds` renvoie vide) ; le portail et ses notifications ne concernent
  que les clients externes.
- Les autres notifications client existantes (réponse et clôture d’un point client, demandes de modification à approuver,
  nouveau : livrable à accepter) passent par le même canal, donc partent par e-mail tout de suite.

### Reste à faire (R-036 reste « en cours », attend la DSI)

1. **Transport réel** : relais SMTP (hôte, port, authentification, TLS) **ou** déclaration de Keystone dans Microsoft 365
   (permission `Mail.Send` de l’application Entra et boîte d’envoi). Le message MIME est prêt ; il restera à écrire le transport
   dans `src/server/mail/transport.ts` et à retirer le refus de `smtp` / `graph` de `src/server/config/parse.ts` (aujourd’hui
   refusés avec le message « awaits IT … use "none" or "file" »).
2. Adresse d’expéditeur réelle (`KEYSTONE_MAIL_FROM`) et adresse publique de Keystone (`KEYSTONE_PUBLIC_URL`).
3. Comptes réels avec adresse e-mail (R-038 / R-039, `KEYSTONE_AUTH=entra`) : sans adresse, l’état est `no_address`.

## 2. R-015 — événements clés aux personnes concernées (X-6a)

État trouvé : la livraison 8 avait déjà fait les demandes de modification, les réceptions refusées (`delivery`), les factures
bloquées par le rapprochement (`invoice`), les tâches affectées (`task`), les @mentions des commentaires de tâche (`mention`,
R-149), les réunions, les points client ; les ECO à approuver (`eco`) et les NCR levées (`quality`) existent côté connecteur Vigie
mais **dorment** jusqu’à l’API de Vigie (V-3 : appelés seulement par le rafraîchissement HTTP, jamais par le simulateur).
`createNotification` savait déjà viser des personnes (`toPersonIds`) tout en gardant les audiences par rôle (notifications du
prototype) ; rien n’a changé de ce côté, sinon le canal e-mail.

Ajouté dans ce lot (`src/server/dal/event-notices.ts`, envoyé après l’enregistrement, au mieux, jamais à l’auteur) :

| Événement | Destinataires | Type |
|---|---|---|
| SAT planifiée | contacts du client externe du projet | `request` |
| Livrable soumis au client | contacts du client externe | `approval` (« Livrable à accepter · D-018 ») |
| Livrable accepté / refusé par le client | R du RACI du livrable et responsables du projet (CP en titre, co-CP, adjoints) | `approval` / `quality` |
| Inspection (ITP) non conforme | responsables du projet et référents qualité / ingénierie de l’équipe | `quality` |
| Alerte d’indicateur (règles de R-130) | responsables du projet et directeurs ; surcharge et approbations : directeurs ; comptes internes seulement | `alert` |

Alertes d’indicateur : tâche **`indicator-alerts`** chaque matin (avant le résumé, qui les porte par défaut) ; une notification
par personne et par alerte tant qu’elle dure (`reminder_sends`, type `alert`, occurrence `open`) ; une alerte disparue est
marquée `cleared:<date>` et notifiée à nouveau si elle revient.

**R-015 peut passer « fait »** côté Keystone : chaque type défini dans `codes.ts` est produit, adressé à des personnes. Seule
réserve, hors Keystone : ECO et NCR ne partent qu’une fois l’API de Vigie publiée (V-3) — c’est le connecteur qui attend, pas
R-015.

## 3. Décisions prises sans demander

1. **Quatre familles** (approbations, tâches, mentions, alertes et suivi) plutôt qu’un réglage par type (dix) : assez fin, lisible.
2. Défauts : immédiat pour ce qui attend une action, résumé pour le reste ; les clients reçoivent tout de suite.
3. Le résumé ne reprend pas les notifications déjà lues dans la cloche.
4. Résumé à l’heure des rappels (07:00), même si aucune notification n’est neuve depuis la veille : pas de résumé vide (aucun
   e-mail quand il n’y a rien).
5. Sans transport, pas de rattrapage : `no_transport` est définitif (sinon le branchement du SMTP déverserait l’arriéré).
6. Notifications d’alerte en **français** (sous-ligne calculée par les règles dans la langue par défaut).
7. Pas de @mention ailleurs que dans les commentaires de tâche : c’est le seul fil de commentaires de Keystone (les autres
   « commentaires » sont des motifs de décision). Les mentions partent maintenant aussi par e-mail.
8. La facture émise et l’avenant « envoyé pour signature » ne notifient pas le client : l’écran Contrat n’est pas dans l’espace du
   client (R-042), et l’envoi réel de ces pièces reste hors Keystone (Sage, signature).
9. Pas de « livraison en retard » supplémentaire : la famille « livraison » est couverte par les réceptions refusées (livraison 8).

## 4. Questions ouvertes pour le propriétaire

1. Les quatre familles et leurs défauts conviennent-ils ? Faut-il un réglage par type ?
2. Le résumé quotidien : à 07:00 avec les rappels, ou en fin de journée ?
3. Alertes d’indicateur : aux seuls responsables du projet et directeurs, ou aussi à la Finance (dépassement de coût,
   facturation) ?
4. Invitation SAT : aussi aux témoins nommés qui n’ont pas de compte (adresse saisie) ? Aujourd’hui seuls les comptes clients.

## 5. Fichiers

| Partie | Fichiers |
|---|---|
| Règles pures | `src/domain/notification-mail.ts` (+ `notification-mail.test.ts`), `src/domain/reminders.ts` (préférences étendues) |
| Schéma, migration | `src/server/db/schema/platform.ts` (`mail_state`, `mail_at`, `mail_error`), `schema/reminders.ts` (`notification_modes`), `drizzle/0066_notification_mail.sql` |
| DAL | `src/server/dal/notification-routing.ts`, `notification-mail.ts`, `event-notices.ts` (+ `notification-mail.test.ts`), `notifications.ts` (`createNotification`), `reminder-preferences.ts` ; points d’appel : `commissioning.ts` (`planSat`), `quality.ts` (`moveDeliverable`, `decideDeliverable`), `itp.ts` (`recordItpResult`) |
| Tâches | `src/domain/jobs.ts`, `src/server/jobs/definitions.ts` (`notification-mails`, `notification-digest`, `indicator-alerts`) |
| Interface | `src/features/reminders/*`, cloche (`header-islands.tsx`), `src/features/itpcom/actions.ts`, `forms.ts` |
| Français | `src/i18n/extra/d9-notification-mail.json` (+ pied des rappels dans `d9-reminders.json`) |
| Exploitation | `docs/EXPLOITATION.md` § 8 (tâches, e-mail) |
