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

## 4. Open questions for the owner (asked at delivery; answered 17 Oct 2026 — §5)

1. Recipients: the PM of record only. Also co-PMs and deputies, or the director when the PM has no account?
2. Timing: every 24 h from the worker's start — or at a fixed hour (early morning)?
3. The "New risk" owner list is the prototype's team; on HLT-026 it lacks the PM (Romain Aubert). Add the PM of record?
4. The Site card subtitle still mentions a "client letter" at J-15 — not built (D-4 asked for the notice and the risk).
5. Raise a risk from a prerequisite before it is late too?

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

**Still open.** Questions 4 (the "client letter" in the Site card subtitle) and 5 (raising a risk before J-15) were not
answered. New: should a worker started late in the day (e.g. 22:00) still send the day's missed morning reminders at once —
today it does, as the brief asked — or wait for the next morning? A reminders hour between 02:00 and 02:59 does not exist on
the spring-forward night: that day's run falls an hour earlier (07:00 is unaffected).
