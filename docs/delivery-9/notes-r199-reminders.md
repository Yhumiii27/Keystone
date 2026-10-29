# Livraison 9 — lot « r199-reminders » (R-199, début de R-036) : rappels d’échéance et rapports programmés

Validé par le propriétaire le 29 oct. 2026. Migration **0065** (`0065_reminders.sql`).

## 1. Ce qui est construit

### Rappels d’échéance — tâche `deadline-reminders`

Chaque matin à l’heure des rappels (`KEYSTONE_REMINDERS_AT`, 07:00 heure de Paris par défaut), avec la date métier
(`businessToday()`), la tâche relève les éléments ouverts qui ont une échéance et un responsable, sur les projets en cours
(ni clos ni annulés) :

| Élément | Date | Responsable(s) | Lien |
|---|---|---|---|
| Tâche (non terminée) | `tasks.due_date` | la personne affectée | fiche tâche `/my/tasks/T-…` |
| Activité du planning (ni jalon ni terminée) | `finish_date` | responsable + personnes nommées sur les affectations | Planning `?act=` |
| Jalon du planning (non atteint) | fin de l’activité liée, sinon la date que trace le planning (mois du jalon) | chef de projet en titre | Planning (Gantt) |
| Livrable à émettre (prévu, en cours, revue interne, refusé) | `due_on` | R du RACI, sinon le chef de projet en titre | Qualité `?tab=dlv&dlv=` |
| Action de réunion (non faite, sans tâche créée) | `due_date` | le responsable (personne) | Réunions `?meeting=` |
| Prérequis client en attente | `needed_by` | chef de projet en titre | Chantier `?prereq=` |

Fenêtres (règles pures `src/domain/reminders.ts`) : par défaut J-7 et J-1, puis **une fois** en retard. Une fenêtre manquée
(worker arrêté, élément créé dedans) est rattrapée tant qu’elle dure (la fenêtre est le plus petit délai ≥ jours restants ;
le jour même appartient à J-1). Les retards de plus de 30 jours ne sont pas rappelés (`OVERDUE_LOOKBACK_DAYS`) pour qu’une
première exécution sur une base réelle ne déverse pas l’arriéré.

**Idempotence** : table `reminder_sends`, clé unique (personne, élément, fenêtre, date d’échéance). Les lignes sont
réclamées (INSERT … ON CONFLICT DO NOTHING) avant tout envoi : une relance, un deuxième worker ou un redémarrage n’envoie
rien deux fois ; une échéance déplacée relance les fenêtres. Un envoi qui échoue après la réclamation n’est pas réessayé
(« au plus une fois » : un rappel en double est pire qu’un rappel manqué) — l’échec est noté sur la ligne et au journal.

**Un rappel par personne et par exécution** : une notification dans la cloche (titre « Rappel d’échéance », les trois
premières références puis « +n », lien vers l’élément s’il est seul, sinon Mes tâches ; type `alert` s’il y a un retard,
sinon `task`) et un e-mail en français listant chaque élément (projet, référence, titre tel que saisi, nature, échéance,
« dans n j » / « n j de retard », lien).

### Rapports hebdomadaires — tâche `scheduled-reports`

Tâche du matin elle aussi, qui n’envoie qu’à la **première exécution de chaque semaine ISO** (le lundi ; un lundi manqué est
rattrapé le lendemain, jamais deux fois la même semaine — même table, clé = semaine `2026-W40`) :

- **rapport d’avancement** de chaque projet en cours ayant un planning, à chacun de ses responsables (CP en titre, co-CP,
  adjoints, R-041) : le rapport de R-131 tel quel (`statusReportDocument`, public « pilotage », période « semaine », toutes
  sections), construit avec les droits du destinataire (marge selon le rôle, C-10b), en PDF joint ; le corps de l’e-mail
  reprend les indicateurs et champs du rapport ;
- **portefeuille** aux directeurs : l’export Excel de la Vue d’ensemble en pièce jointe, le corps reprend ses indicateurs et
  ses points d’attention (10 premiers).

Aucun nouvel indicateur : tout vient des calculs existants. Notification dans la cloche (toujours), e-mail si la personne a
gardé « e-mail des rapports ».

### Canal e-mail (début de R-036)

`src/server/mail/` : `mime.ts` (message RFC 5322 / MIME pur : en-têtes UTF-8 encodés RFC 2047, corps base64, pièces jointes
multipart/mixed, `Auto-Submitted: auto-generated`) et `transport.ts` :

- `KEYSTONE_MAIL_TRANSPORT=none` (défaut) : rien ne part, les lignes notent `no_transport` ;
- `file` : un fichier `.eml` par message dans `KEYSTONE_MAIL_DIR` (défaut `<KEYSTONE_DATA_DIR>/mail`, refusé dans `files/`
  ou `pg/`), écrit sous un nom temporaire puis renommé ;
- `smtp`, `graph` : **refusés par la validation de la configuration** avec le message « awaits IT … use "none" or "file" »
  (en production le serveur ne démarre pas ; ailleurs la valeur par défaut `none` s’applique).

Autres variables : `KEYSTONE_MAIL_FROM` (expéditeur, défaut `Keystone <keystone@epc2i.invalid>`), `KEYSTONE_PUBLIC_URL`
(adresse de Keystone dans les liens ; défaut l’origine de `ENTRA_REDIRECT_URI`, sinon `http://localhost:3000`). Toutes dans
`parse.ts` (+ `parse-mail.test.ts`), `.env.example` et `docs/EXPLOITATION.md` § 3 et § 8.

### Préférences

- **Par utilisateur** (table `reminder_preferences`, pas de ligne = valeur par défaut) : e-mail des rappels oui/non, e-mail
  des rapports oui/non, délais (J-7 · J-1, J-14 · J-7 · J-1, J-7 · J-3 · J-1, J-3 · J-1, J-7, J-1), rappel après l’échéance
  oui/non, ou « la valeur par défaut de l’entreprise ». La cloche reçoit toujours.
- **Valeur par défaut de l’entreprise** : réglage `reminders.defaults` (`app_settings`), carte « Rappels et rapports — valeur
  par défaut » de **Paramètres**, modifiée par le directeur de portefeuille (A-14, mêmes éditeurs que les autres cartes).
- Server Functions `src/server/actions/reminders.ts` : validation par `prefsOfForm`, l’utilisateur est toujours celui de la
  personne connectée (jamais un identifiant reçu), écriture par le DAL (`src/server/dal/reminder-preferences.ts`), ligne
  d’audit avec avant / après (et ligne d’activité pour la valeur par défaut), `revalidatePath`.

### Droits

Une personne ne reçoit que ce qu’elle peut voir : un rôle interne ouvre tout projet (lecture seule hors de son équipe,
R-041) ; un client seulement les éléments des projets de son organisation que son portail montre (`clientSeesTarget` :
pas de tâche, pas d’action d’une réunion interne, `clientSeesMeeting`), jamais un projet refusé (`clientRefusedProject`).
Les rapports ne vont qu’aux responsables internes et aux directeurs. Seuls les comptes actifs sont avertis.

## 2. Décisions prises sans demander

1. **Pas d’écran de profil** dans Keystone : les préférences personnelles sont dans la **cloche des notifications** (pied du
   panneau, bouton « Rappels et rapports », boîte de dialogue), présente sur toutes les pages pour tous les rôles. Le pied
   annonçait « préférences dans Paramètres » sans rien derrière : il dit maintenant si l’e-mail est connecté.
2. Valeur par défaut : e-mail **activé** pour rappels et rapports, J-7 et J-1, rappel en retard activé. Sans transport
   configuré, rien ne part de toute façon.
3. E-mails en **français** pour tous (langue par défaut ; la langue de chacun n’est qu’un cookie du navigateur).
4. Un e-mail **groupé** par personne et par matin (pas un e-mail par élément).
5. Jalons : responsable = chef de projet en titre ; date = fin de l’activité liée, sinon la date tracée par le planning.
6. Livrables : seulement ceux encore à émettre ; l’acceptation attendue du client (soumis) n’est pas rappelée (c’est
   l’échéance du client).
7. Actions de réunion devenues tâches : seule la tâche est rappelée.
8. Les prérequis clients reçoivent les rappels J-n en plus de l’alerte J-15 de R-121.
9. Rapports : public « pilotage » pour les responsables ; portefeuille = Vue d’ensemble (zone : toutes).
10. Un rappel ou rapport dont l’envoi échoue n’est pas renvoyé (au plus une fois).
11. **Worker** : les rapports réutilisent l’export et la vue d’ensemble, dont les modules importent `next/navigation` ; hors
    de Next ce module charge sa version navigateur et échoue. `src/server/jobs/next-shims.ts`, importé en premier par
    `scripts/worker.ts` seulement, donne au worker la résolution de Next (`navigation.react-server`). Vérifié :
    `npm run worker -- --once --job deadline-reminders` et `--job scheduled-reports` (fichiers `.eml` avec PDF et classeur).

## 3. En attente de la DSI

- **Envoi réel** : relais SMTP (hôte, port, authentification, TLS) **ou** déclaration de Keystone dans Microsoft 365
  (permission `Mail.Send` de l’application Entra et boîte d’envoi). Le message MIME est prêt pour l’un ou l’autre ; il
  restera à écrire le transport correspondant et à retirer le refus de la configuration.
- Adresse d’expéditeur réelle (`KEYSTONE_MAIL_FROM`) et adresse publique de Keystone (`KEYSTONE_PUBLIC_URL`).
- Comptes réels avec adresse e-mail (R-038/R-039) : seuls les comptes actifs reçoivent ; dans le jeu de démonstration,
  seuls les 10 personas ont un compte (10 rappels le 25 sept. 2026, 3 personnes ; 1 projet a un responsable avec compte).
- **Teams** : pas un canal (X-6b a retenu Keystone + e-mail) ; à rouvrir si le propriétaire le souhaite.

## 4. Questions ouvertes pour le propriétaire

1. Délais par défaut J-7 et J-1, rappel une fois en retard : à confirmer ? Faut-il des rappels répétés en retard (chaque
   semaine) ?
2. Jalons et prérequis au seul CP en titre, ou aussi aux co-CP et adjoints ?
3. Rapport hebdomadaire : public « pilotage » ou « interne » (avec les ressources affectées) pour les responsables ?
   Faut-il l’envoyer aussi au client (public « client ») ?
4. Rapport portefeuille : aux seuls directeurs, ou aussi à la Finance ? Jour et heure (lundi à l’heure des rappels) ?
5. E-mail activé par défaut pour tous : d’accord, ou désactivé jusqu’à ce que chacun l’active ?
6. Reste de R-036 : envoi immédiat des autres notifications (approbations, mentions…) et résumé quotidien — non construit
   dans ce lot.

## 5. Fichiers

| Partie | Fichiers |
|---|---|
| Règles pures | `src/domain/reminders.ts` (+ `reminders.test.ts`) |
| Schéma, migration | `src/server/db/schema/reminders.ts`, `drizzle/0065_reminders.sql` |
| E-mail | `src/server/mail/mime.ts`, `transport.ts` (+ `mail.test.ts`) |
| Configuration | `src/server/config/parse.ts` (+ `parse-mail.test.ts`), `.env.example`, `docs/EXPLOITATION.md` |
| DAL | `src/server/dal/reminders.ts`, `scheduled-reports.ts`, `reminder-preferences.ts` (+ `reminders.test.ts`) |
| Tâches | `src/domain/jobs.ts`, `src/server/jobs/definitions.ts`, `src/server/jobs/next-shims.ts`, `scripts/worker.ts` |
| Server Functions, interface | `src/server/actions/reminders.ts`, `src/features/reminders/*`, cloche (`header-islands.tsx`), Paramètres |
| Français | `src/i18n/extra/d9-reminders.json` |
