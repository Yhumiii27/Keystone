# Delivery 9 — lot "prereq-alert" (R-121): J-15 alert on an unconfirmed client prerequisite

Owner decision D-4 ★ "Notification et proposition de risque" (X-6a). Unblocked by the business clock (R-013).

## 1. What was built

A daily job (`site-prerequisite-alerts`, every morning at 07:00 Europe/Paris since the owner's answers — §5; lease 15 min) finds the client
prerequisites that became late at the business date — the Site screen's own J-15 rule (`isPrerequisiteLate`) — on projects
whose site sheet is open (Études … Mise en service & SAT). Each one is alerted once: one bell notice to the PM of record,
kind `alert`, "Client prerequisite unconfirmed at J-15 — raise a risk?" / « Prérequis client non confirmé à J-15 — ouvrir un
risque ? », sub-line "{prerequisite} · {activity} · {need date}", link `/projects/{code}/site?prereq={position}`.

The Site row then offers **"Raise as a risk"** (« Ouvrir un risque »): the existing "New risk" form, pre-filled — title "Late
client prerequisite — {title}", category Contractual / client (else the first active one), owner the PM of record when on the
owner list (else the list's first owner), response Mitigate, P and I 3; stored with the cause as trigger and the
prerequisite's plan activity (the PM of record is on every owner list since the owner's answers — §5). A lead confirms; the risk is linked to the prerequisite (`site_prerequisites.risk_id`) and the
row shows the risk instead of the proposal. No new risk status.

| Piece | Where |
|---|---|
| Pure rules | `src/domain/prerequisite-alerts.ts` (which prerequisites to alert, when raising is offered, the draft, the trigger text) |
| Job writer, risk writer | `src/server/dal/prerequisite-alerts.ts` (`alertLatePrerequisites`, `raisePrerequisiteRisk`) |
| Server Function, button | `src/features/site/prerequisite-risk-actions.ts`, `prerequisite-risk-button.tsx`; Site page reads `?prereq=` |
| Schema | migration `0033`: `site_prerequisites.alerted_needed_by`, `alerted_at`, `risk_id` (FK risks, ON DELETE SET NULL) |
| Job | `src/domain/jobs.ts`, `src/server/jobs/definitions.ts`; `docs/EXPLOITATION.md` §8 |
| French | `src/i18n/extra/d9-prereq-alert.json`; system message `site.prerequisiteRiskRaised` |

**Idempotent.** The job claims each prerequisite with a conditional update (still pending, same need date, not yet alerted
for it): a rerun or a second worker sends nothing more. A prerequisite only moves forward (Pending → Confirmed → Signed), so
it is alerted again only if its need date changes while pending and it becomes late at the new date.

**Rights.** Raising is for a lead of the project (PM of record, co-PM, deputy, director) who can edit Site and Risks —
checked in the Server Function and again in the writer (stamp, not yet raised, still late). Audit row "risk raised · R-21"
on the prerequisite, activity line.

## 2. Demo data set

HLT-026 has two pending prerequisites: quai 4 (needed 2 Nov, J-15 = 18 Oct) and HT 11 kV (needed 20 Nov, J-15 = 5 Nov). At
the demo date (25 Sep 2026) the first run alerts nothing; nothing displayed changes. With the real clock the quai 4 alert
leaves on 18 Oct and the HT alert on 5 Nov.

## 3. Tests

`src/domain/prerequisite-alerts.test.ts` (7), `src/features/site/prerequisite-risk.test.ts` (6, all nine personas): the
demo run, one notice to the PM only and nothing on reruns, a moved need date, the page marking and offering, refusals
(non-leads, client, stale stamp, unknown owner, not late), the raise with its audit and activity, the writer's re-checks.

## 4. Open questions for the owner (asked at delivery; answered 17 Oct 2026 — §5 for 1–3, §6 second round for 4–5, §7 third round for 6)

1. Recipients: the PM of record only. Also co-PMs and deputies, or the director when the PM has no account?
2. Timing: every 24 h from the worker's start — or at a fixed hour (early morning)?
3. The "New risk" owner list is the prototype's team; on HLT-026 it lacks the PM (Romain Aubert). Add the PM of record?
4. The Site card subtitle still mentions a "client letter" at J-15 — not built (D-4 asked for the notice and the risk).
   **Answered (§6):** « On supprime la lettre au client ».
5. Raise a risk from a prerequisite before it is late too? **Answered (§6):** « Risque avant J-15 : oui on peut l'ouvrir ».
6. Should the J-15 notice still be sent for a prerequisite whose risk was already raised before J-15? **Answered (§7, third
   round):** « Si l'alerte a déjà un risque ouvert [il faut quand même alerter] car c'est soit que le risque n'a pas été maîtrisé,
   soit qu'il faudra en ouvrir un nouveau ».

## 5. Owner answers 17 Oct 2026

| # | Answer | What changed |
|---|---|---|
| 1 | Recipient: the PM of record only | Nothing — already the case (one bell notice to `projects.pm_person_id`; co-PMs, deputies and the director are not told). Recorded here and in `src/domain/prerequisite-alerts.ts`. |
| 2 | « Les alertes automatiques de rappel doivent arriver le matin » | Reminder jobs run once a day at the reminders hour, Europe/Paris, instead of every 24 h from the worker's start (below). |
| 3 | « Ajouter le CP aux propriétaires de risque proposés : Oui » | The PM of record is on every "New risk" owner list; the J-15 proposal pre-selects him (Romain Aubert on HLT-026). |

**Morning reminders (answer 2).**
- *Schedule kind.* `JobSchedule.daily: 'reminders'` (`src/domain/jobs.ts`): the job runs once a day at the reminders hour —
  `KEYSTONE_REMINDERS_AT` (`HH:MM`, Paris wall clock; `src/server/config/parse.ts`, `.env.example`, `EXPLOITATION.md` §3 and §8),
  default `DEFAULT_REMINDERS_AT = '07:00'` (early enough to be read at the start of the working day, after the night's data
  has settled; a variable because the right hour is an operating choice, not code). Pure rules: `parseTimeOfDay`,
  `dailySlotOn` (the hour on a Paris date, with that day's UTC offset: 07:00 = 05:00 UTC in summer time, 06:00 UTC in winter
  time), `passedDailySlot` (today's run is owed once the hour has passed), `nextDailySlot`, `dailyDelayMs`.
- *Timer* (`src/server/jobs/scheduler.ts`, `ScheduledEntry.dailyAt`): at start, the first delay (50 s) when today's hour has
  passed — the missed run — else a timer to today's hour; after each run, a timer to the next day's hour, recomputed from the
  real instant every time (a DST change, a long run or timer drift never shifts it; 25 h / 23 h on the nights the clocks
  change). The business clock pins only the date (`KEYSTONE_CLOCK`), never the time of day, so the real instant gives the same
  hour as `businessNow()`; timers need real durations, so the scheduler uses the real instant.
- *Once a day* (`src/server/jobs/runner.ts`, `src/server/dal/job-locks.ts`): a reminder job's lease is taken only once today's
  hour has passed and only if the job has not started since that instant (`acquireJobLock(…, notStartedSince)` on
  `job_locks.last_started_at`, replacing the ~90 % interval gap). A restart after 07:00, a second worker or the in-process
  scheduler beside a worker therefore send nothing more the same day; a worker started at 10:00 whose 07:00 run was missed
  runs it at once. `npm run worker -- --once` still runs it immediately whatever the hour (and that run counts as the day's
  when made after the hour). Before the hour a stray attempt is skipped and logged ("before the reminders hour"). The hour is
  logged at start-up (`remindersAt` on "Worker started" / "Scheduler started"). No migration.
- *Audit of the jobs.* Only `site-prerequisite-alerts` sends reminders or notices to people on a schedule. The other notice
  senders are triggered by a person's action or a Vigie read (`notifyNewNcrs`, `notifyEcosToApprove`, task, change-request,
  request, receipt and order notices); the Cursus "reminders" are a manual button queued in the Cursus outbox. Technical jobs
  keep their intervals: outboxes (5 min), plan-trash purge and Codex index (1 h), backup (5 min wake-up), orphan prune, files
  rescan, Cursus directory and events purge (24 h).

**PM of record on the owner list (answer 3).** `riskOwnerOptions` (`src/server/dal/risks-screen.ts`) — the project team
(DEFS.team + seeded referents), else the resource pool — now ends with the project's PM of record when absent
(`riskOwnersWithPm`, `src/domain/risk.ts`; `projectPmName` moved there from `prerequisite-alerts.ts`). Added at the end so the
form's default (first) owner does not change. Every "New risk" path reads and validates against the same list (Risks page and
`createRiskAction`, Meetings risk proposal, Site "Raise as a risk" — `parseNewRisk`), so the PM is offered and accepted
everywhere. Minimal by decision: co-PMs, deputies and other leads are not added (they are on the list when they are team
members).

**Displayed values that change on the demo data set.** The "New risk" owner list of every project with a PM of record not on
its team gains that PM at the end — HLT-026: Romain Aubert after Gabriel Comte; NDC-031 (team) and EWA-051 (whole pool):
"S. Perrin" (a PM seeded with a short name only, shown as stored). The J-15 "Raise as a risk" proposal on
HLT-026's quai 4 prerequisite pre-selects Romain Aubert (was Amélie Ollivier, the list's first). The job no longer runs 50 s
after start-up on the demo (it waits for 07:00, or runs at once after 07:00 if not run today); at the demo date it alerts
nothing either way.

**Tests.** `src/domain/jobs.test.ts` (reminder jobs = `site-prerequisite-alerts` only; HH:MM parsing; the hour on DST days;
next run across both DST changes, 25 h / 23 h; owed run by Paris date; start-up delays), `src/server/jobs/scheduler.test.ts`
(fake timers: start at 05:00 → 07:00 each day through the change to winter time; start at 10:00 → the missed run at once, then
07:00; a 40-min run does not shift the hour, interval entries unchanged), `src/server/jobs/jobs.test.ts` (in-memory database:
runs after the hour only, once a day — restart at noon and a second worker skip, next day 06:59 skipped, 07:00 runs; `--once`
forces; `KEYSTONE_REMINDERS_AT` read by the entries), `src/server/config/parse.test.ts` (`KEYSTONE_REMINDERS_AT`),
`src/domain/risk.test.ts` (`riskOwnersWithPm`, `parseNewRisk` accepts the PM only on the extended list),
`src/server/dal/risks-screen.test.ts` (HLT-026 owners end with Romain Aubert, NDC-031 and EWA-051 with their PM), `src/features/site/prerequisite-risk.test.ts`
(the proposal pre-selects Romain Aubert, the form's owners end with him, the PM confirms with himself as owner).

**Still open.** Questions 4 and 5 were answered in a second round (§6). New: should a worker started late in the day (e.g. 22:00) still send the day's missed morning reminders at once —
today it does, as the brief asked — or wait for the next morning? A reminders hour between 02:00 and 02:59 does not exist on
the spring-forward night: that day's run falls an hour earlier (07:00 is unaffected).

## 6. Owner answers 17 Oct 2026 — second round

| # | Answer | What changed |
|---|---|---|
| 4 | « On supprime la lettre au client » | The "Client prerequisites (readiness)" card subtitle no longer promises a client letter. |
| 5 | « Risque avant J-15 : oui on peut l'ouvrir » | "Raise as a risk" is offered on every pending prerequisite without a risk, late or not. |

**No client letter (answer 4).** Subtitle (`src/features/site/site-view.tsx`): "Dated and signed by the client · each one
conditions a site activity · J-15 unconfirmed → alert and risk proposal" / « Datés et signés par le client · chacun conditionne
une activité chantier · non confirmé à J-15 → alerte et proposition de risque » (new literal, French in
`src/i18n/extra/d9-prereq-alert.json`; no existing string fitted). The prototype's subtitle entry (the only user of "client
letter") is removed from `src/i18n/fr-dict.json` — the guards allow it (no test pins fr-dict to the prototype; the string stays in
`src/server/prototype/prototype-data.json`, the prototype's own data, and in `design/`). Spec `docs/spec/10` §d notes the new
subtitle. No guide (`docs/guide/*.md`) or `EXPLOITATION.md` mentioned the letter. "3 client letters + incremental number"
(analytic code hint) is about the alphabet, untouched.

**Raise before J-15 (answer 5).**
- *Rule* (`src/domain/prerequisite-alerts.ts`): `canRaisePrerequisiteRisk(p)` = status Pending (not Confirmed, not Signed) and no
  risk linked — no date any more (signature without `today`). Re-checked in the Server Function
  (`src/features/site/prerequisite-risk-actions.ts`) and in the writer's transaction (`raisePrerequisiteRisk`,
  `src/server/dal/prerequisite-alerts.ts`); the refusal "This prerequisite is not late any more" becomes `PREREQ_RISK_NOT_PENDING`
  "This prerequisite is not pending any more" / « Ce prérequis n’est plus en attente » (the old entry is removed from
  `d9-prereq-alert.json`). Lead right, stamp, owner list and "raised once" unchanged.
- *Draft* (`prerequisiteRiskDraft(p: { title, late })`): late at J-15 (`isPrerequisiteLate` at the business date) → "Late client
  prerequisite — {title}" (unchanged); not late → "Client prerequisite at risk — {title}" / « Prérequis client à risque — … ».
  Category, owner (PM of record), response, P and I unchanged.
- *Trigger* (`prerequisiteRiskTrigger(p: { title, activityCode, late }, …)`): late → "Client prerequisite not confirmed 15 days
  before its need date · …" (unchanged); not late → "Client prerequisite not confirmed yet · {prerequisite} · {activity} · {need
  date}" / « Prérequis client pas encore confirmé · … ». The Server Function computes `late` at the business date.
- *Activity line*: a new system message `site.pendingPrerequisiteRiskRaised` — "Raised R-21 from a client prerequisite not
  confirmed yet · {prerequisite}" / « Risque R-21 ouvert depuis un prérequis client pas encore confirmé · … » — for a raise before
  J-15; `site.prerequisiteRiskRaised` ("… from a late client prerequisite …") is kept for a late one (stored rows keep their key
  and text). The writer decides at the business date in its transaction.
- *Page* (`src/features/site/model.ts`): every pending row without a risk shows "Raise as a risk" to a lead; only the row reached
  from the notification (`?prereq=`) opens the form by itself (unchanged).
- *Unchanged*: the J-15 notification (job, recipient, title, idempotence per need date), the 07:00 schedule.

**Displayed values that change on the demo data set (25 Sep 2026).** HLT-026 › Site › Client prerequisites: the card subtitle (no
letter); for the project's leads (among the personas: the PM Romain Aubert and the director) the two pending rows — quai 4 (needed 2 Nov) and HT
11 kV (needed 20 Nov) — now show "Raise as a risk" (before: none until 18 Oct / 5 Nov), pre-filled "Client prerequisite at risk —
{title}", owner Romain Aubert; from 18 Oct the quai 4 row reads "Late client prerequisite — …" as before. Other personas see no
change. Confirmed and signed rows (4 of 6) offer nothing.

**Tests.** `src/domain/prerequisite-alerts.test.ts`: offered while pending whatever the date, not when confirmed / signed or
already raised; the draft title and the trigger late vs not late, in English and French. `src/features/site/prerequisite-risk.test.ts`
(7): leads see "Raise as a risk" on both pending rows at 19 Oct (quai 4 late, HT not late) with their titles in both languages,
only the notified row focused; a confirmed prerequisite (alimentation 400 V) is refused "not pending any more" by the Server Function
and the writer; the PM raises HT before J-15 (trigger "Client prerequisite not confirmed yet · … · 1 Dec 2026", activity
`site.pendingPrerequisiteRiskRaised`, row linked, offer gone); a member is still refused.

**Open question** (answered in the third round, §7). Should the J-15 notice still be sent for a prerequisite whose risk was already
raised before J-15?

## 7. Owner answer 17 Oct 2026 — third round

| # | Answer | What changed |
|---|---|---|
| 6 | « Si l'alerte a déjà un risque ouvert [il faut quand même alerter] car c'est soit que le risque n'a pas été maîtrisé, soit qu'il faudra en ouvrir un nouveau » | The J-15 notice still goes out and names the linked risk; once late, the row offers "Raise a new risk" beside the link. |

**The notice (still sent).** The job never filtered on the linked risk; it now reads it (left join `risks`) to say so. Idempotence
unchanged: one notice per need date (`alerted_needed_by` claim). Title unchanged; sub-line (`prerequisiteAlertSub`,
`src/domain/prerequisite-alerts.ts`) "{prerequisite} · {activity} · {need date} · R-21 · linked risk open" — or "· linked risk
closed" when the risk was closed (`risks.status`). The bell shows each " · " field as typed or through its exact FR entry
(`fieldsText`): « … · 2 nov. · R-21 · risque lié ouvert » / « risque lié clôturé ». The number and the status are separate fields
so the status has an exact French entry (a "risk R-21 open" segment could not be translated).

**Rule** (`prerequisiteRiskRefusal` / `canRaisePrerequisiteRisk(p: { status, riskNumber, late })`):
- not pending (confirmed, signed) → refused "This prerequisite is not pending any more" (checked first);
- pending without a risk → offered, late or not (second round, unchanged);
- pending with a linked risk, **before J-15** → the link only, no second risk — refused "A risk was already raised from this
  prerequisite" (one risk per prerequisite while it is not late: the PM works the risk he opened);
- pending with a linked risk, **late at J-15** (`isPrerequisiteLate` at the business date) → the link **and** "Raise a new risk"
  (« Ouvrir un nouveau risque »), the same pre-filled form with the late wording ("Late client prerequisite — {title}", cause "…
  not confirmed 15 days before its need date"), owner the PM of record.

The Server Function (`late` from `getSite` at the business date) and the writer (`late` at the business date in its transaction)
apply the same function; lead right, stamp, owner list and category parsing unchanged.

**Raising the new risk** (`raisePrerequisiteRisk`): `site_prerequisites.risk_id` points to the latest risk; the previous one stays in
the register untouched (status, links). Audit row on the prerequisite "risk raised · R-22 (after R-21)", `before: { risk: 'R-21' }`,
`after: { risk: 'R-22' }`; activity line with a new system message `site.prerequisiteRiskRaisedAgain` — "Raised R-22 from a late
client prerequisite (after R-21) · {prerequisite}" / « Risque R-22 ouvert depuis un prérequis client en retard (après R-21) · … ». No
migration (a prerequisite keeps one link; the history is in the audit trail and the register).

**Page** (`src/features/site/site-view.tsx`, `prerequisite-risk-button.tsx`): when late with a risk, the risk link's tooltip reads
"This risk did not prevent the delay" / « Ce risque n’a pas empêché le retard » (instead of "Risk raised from this prerequisite") —
the only marker, kept minimal; the button reads "Raise a new risk". Reached from the notice (`?prereq=`), such a row is marked and
scrolled into view but the form is **not** opened by itself (default): the owner's answer gives two outcomes (the risk was not
mastered, or a new one is needed), so the PM chooses between the existing risk and a new one. A row without a risk still opens
the form as before.

**French** (`src/i18n/extra/d9-prereq-alert.json`): "Raise a new risk", "This risk did not prevent the delay", "linked risk open",
"linked risk closed".

**Displayed values that change on the demo data set (25 Sep 2026).** None: no prerequisite has a risk in the seed and nothing is
late at the demo date. With the real clock, from 18 Oct on HLT-026's quai 4 row: a lead who raised a risk before 18 Oct sees the
risk link (tooltip "did not prevent the delay") and "Raise a new risk"; the 18 Oct notice reads "… · A1320 · 2 Nov · R-xx · linked
risk open".

**Tests.** `src/domain/prerequisite-alerts.test.ts` (10): the rule with a linked risk before / after J-15 and the refusal order; the
sub-line with an open / closed risk, in English and through `fieldsText` in French. `src/features/site/prerequisite-risk.test.ts`
(9): after raising on the late quai 4 row the page shows the link and still offers the late form; the director raises a new risk
(link moves, first risk still open in the register, audit "risk raised · R-b (after R-a)" with before / after, activity
`site.prerequisiteRiskRaisedAgain`), non-leads refused and see no offer (all personas); HT raised before J-15 → the link only, a
second raise refused by the Server Function and the writer; the notice of HT (risk linked) at a new need date names "R-x · linked
risk open", once per need date, then "linked risk closed" after the risk is closed, and in French « risque lié clôturé ».

**Open questions.**
- When a new risk is raised, should the previous risk be closed automatically (or flagged "superseded")? Default: untouched — the
  PM closes it in the register if it is no longer relevant.
- Should the notice's link open "Raise a new risk" by itself (as it does without a risk)? Default: no — the row is marked only.
