# Delivery 9 — lot "cursus-tasks" (R-180): Keystone's planned tasks of each person, pushed to Cursus

R-180 asked Keystone to expose, per person and week, the Keystone tasks and activities assigned to a matricule, so that Cursus's
timesheet « Proposer depuis Keystone » proposes the lines (NEW-CURSUS-5 "c"). Cursus has since published its contract
(authoritative: Cursus `docs/API-KEYSTONE.md` « Tâches planifiées », « Synchronisation complète », « Ordre des envois »,
`docs/keystone-openapi.json`, implementation `server/src/integrations/keystone-routes.ts` and `keystone-entrant.ts`): Cursus does
not read Keystone, **Keystone pushes** — `PUT /v1/taches/{id}` per task or `PUT /v1/instantane` for the complete state — and
Cursus stores the tasks (table `taches`) and proposes them (`suggestLines`, `shared/rules/temps.ts`). No read route is added to
Keystone. Contract page: `docs/integrations/cursus-contract.md` § 7.

## 1. Cursus's contract, as checked in its code

| Point | Cursus's rule |
|---|---|
| Task body | `{ projet, tache, matricule, debut, fin, heures }`, all required; `tache` ≤ 160 chars; `projet` = a project already received; one task = one person; `heures` = `{ "YYYY-MM-DD": h }`, every day inside `debut` → `fin`, 0–24 h, rounded to 2 decimals, 0 = not planned |
| Ids | 1–64 chars, `[A-Za-z0-9][A-Za-z0-9._:-]*`, stable (the id recognises the object) |
| Matricule | `EMP-xxxx` by default, or the payroll matricule after Cursus's switch (`identifiantKeystone`); unknown → `400` |
| Idempotency | `PUT` creates (`201 cree`), updates (`200 modifie`) or does nothing (`200 inchange`) |
| Order | a task cites a project already received: projects first |
| Deletion | `DELETE /taches/{id}` (then `404` = already done), or absent from the `taches` section of `PUT /instantane` (deleted if it ends on or after `depuis`) |
| Snapshot | one transaction, all or nothing; a section omitted is untouched; a `projets` / `chantiers` section absent objects are **archived**; 2 MB per call |
| Weekend | Saturday and Sunday hours are proposed like the others (7-day timesheet); Cursus zeroes holidays, validated absences, days off |
| Errors | `400 VALIDATION` with `details[{ champ, message }]` (`taches[3].matricule`), `401 CLE_INVALIDE` (replay after a key change), `403` (proxy), `413`, `415`, `429` (`Retry-After`), `503 NON_CONFIGUREE`; a redirection is not followed |

## 2. What Keystone sends (`src/domain/cursus-tasks.ts`, value tests `cursus-tasks.test.ts`)

- **Named schedule assignments** (`activity_assignments` with a person): one Cursus task each, id `KA-<assignment id>`, label
  `<activity code> · <activity name>`, hours on every working day of the activity's calendar (units × h/d, else planned hours
  spread) — R-084 (A): the schedule's allocations are the one source of a person's planned hours. EPC2i labour only (external
  rate role left out), no milestones, no equipment / material.
- **Keystone tasks** (`tasks`): id `KT-<number>`, label `<number> · <title>`, hours = the rule of the share view
  `pub_taches_jours` (estimate ÷ weekdays Mon–Fri, 2 decimals) — the view and the push agree (checked against the view in
  `src/server/integrations/cursus/tasks.test.ts`) — **unless the assignee is assigned on the task's activity**: then the task is a
  to-do inside the assignment, whose hours cover it. On the demo data, 9 of the 27 tasks are covered (e.g. Julien Wagner's
  T-2320 inside his A1250 assignment, 8 h a day).
- Only persons with a matricule (`persons.matricule`, sent as is); only open projects (not `clos` / `annule`); tasks ending on or
  after `depuis` = the Monday of the current week minus 4 weeks (timesheets still filled or corrected).
- Projects: `PUT /v1/projets/{code}` `{ nom }` for every project cited, before the snapshot.

## 3. How and when (`src/server/integrations/cursus/tasks.ts`)

- `PUT /v1/instantane` `{ depuis, taches }` — section `taches` only. Choice (Cursus's « un instantané chaque nuit pour rattraper un
  envoi perdu »): the snapshot carries the deletions (a task removed, emptied or moved to a person without matricule) without
  Keystone remembering every task it sent. Unit `PUT /taches/{id}` on each change was not wired: tasks and assignments are written
  from many places (Plan, My work, approvals, schedule imports, what-if) with no single hook; "Sync now" sends at once.
- Job `cursus-tasks`, **every night at 02:00 Paris** (`daily: 'night'`, constant `NIGHT_JOBS_AT` in `src/domain/jobs.ts`; the
  worker's daily-slot rule of the reminder jobs, at another hour — no new variable), and "Sync now" of the Cursus connector.
- Table `cursus_task_pushes` (migration `0036_cursus_task_pushes`): one row per push — trigger, mode, status (`pending` / `sent`
  / `failed` / `superseded`), `since`, counts (projects, tasks, persons, persons without matricule, tasks refused), the body on
  the newest row only, Cursus's `bilan` and the refused tasks, attempts, last error, delivery claim (R-010). Rows older than 90 days
  are removed by the next push.
- Retryable (no answer, `401`, `408`, `429`, `5xx`): pending, sent again by `cursus-outbox` every 5 minutes (counted in its
  delivered / failed / pending). Final (other `4xx`, body above 2 MB): failed until the next push.
- `400 VALIDATION` naming tasks: sent again without them, 3 rounds at most, recorded as refused; if every task is refused nothing
  is applied (an empty section would delete every Keystone task in Cursus — e.g. right after Cursus's switch to payroll
  matricules).
- Mock connector: nothing sent, the push recorded with its body ("what would be sent"); a new push supersedes the older one.
  Connector disabled by IT: nothing prepared. Tests never call the network (fetch stubbed).
- Activity & integrations, Cursus row: `Last task push · <date> · Tasks · <n>`, `Task push failed` / `Task push pending`,
  `Tasks refused · <n>`, `Persons without matricule · <n>`; a failed push or refused tasks put the row in warning; a sent push
  dates the connector's last sync. "Sync now" volume: `… approvals received · <n> tasks sent` (or `pending`). French: entries in
  `src/i18n/extra/d9-cursus-tasks.json`, rules `(\d+) tasks sent|pending` in `fr-rules.ts`, `volumeT`.

## 4. Files

- `src/domain/cursus-tasks.ts` (+ test): day rules, snapshot, `depuis`, Cursus's retryable statuses, refused task indexes.
- `src/server/dal/cursus-tasks.ts`: the facts (tasks, named assignments, working calendars — `calendarsOf` / `calendarFor` now
  exported from `src/server/dal/planning-load.ts`).
- `src/server/integrations/cursus/tasks.ts` (+ test): push, retry, state; `cursusFetch` exported from `connector.ts` with a
  time-out parameter (30 s for the snapshot).
- `src/server/db/schema/cursus.ts`, `src/server/db/codes.ts` (`CursusTaskPushStatus`), `drizzle/0036_cursus_task_pushes.sql`.
- `src/domain/jobs.ts` (`cursus-tasks`, `daily: 'night'`, `NIGHT_JOBS_AT`), `src/server/jobs/runner.ts` (`jobDailyAt`),
  `src/server/jobs/definitions.ts` (job, `cursus-outbox` retry), `src/server/dal/integrations.ts` (Cursus row, "Sync now"),
  `src/features/admin/i18n.ts`, `src/i18n/fr-rules.ts`, `src/i18n/extra/d9-cursus-tasks.json`.
- Docs: `docs/integrations/cursus-contract.md` § 1, § 4, § 6, § 7; `docs/EXPLOITATION.md` § 8 (job), § 10 (matricule).

## 5. Open points (owner / EPC2i)

1. **Precedence** of an assignment over the to-dos of the same person on the same activity (§ 2): to confirm; the alternative
   (send both) would propose the work twice.
2. **Matricule**: Keystone sends `persons.matricule` as is. Today it is filled only by the staff-directory import (R-027, which
   waits for Cursus's `/annuaire`) or by IT; on the demo data nobody has one, so nothing is proposed until matricules exist.
3. **Window** `depuis` = 4 weeks back: Cursus keeps the older tasks; to change if timesheets are corrected further back.
4. **Night hour** 02:00 Paris (constant): to confirm with IT.

## 6. Gaps found on Cursus's side — requests to Cursus (not fixed here; Keystone never modifies Cursus)

1. **All-or-nothing snapshot**: one unknown matricule refuses the whole `PUT /instantane`. Keystone resends without the refused
   tasks, but a tolerant mode (apply the valid tasks, report the others) or a read of the matricules Cursus knows would avoid the
   round trips.
2. **2 MB per call with a complete section**: a section cannot be split across calls (each call's section is the complete state),
   so a `taches` section above 2 MB cannot be sent at all. Keystone refuses it before sending (failed push); paging or a higher
   limit on `/instantane` would be needed for a large portfolio.
3. **Hours come back per project, not per task**: `heures.validees` carries `projets: { code: h }`; Keystone cannot compare the
   hours spent with the hours planned per task (NEW-CURSUS-5 "c" half closed — R-030 still waits for EPC2i's confirmation).
4. **No read of the tasks Cursus holds** (`GET /taches`): Keystone cannot reconcile what Cursus has after a failed night other
   than by the next snapshot.

## 7. Tests

- `src/domain/cursus-tasks.test.ts` (11): day rules (tasks, assignments, 6-day calendar, 24 h cap), `depuis`, the snapshot
  (ids, labels, order, precedence, what is left out, reassignment), retryable statuses, refused task indexes.
- `src/server/integrations/cursus/tasks.test.ts` (11): mock record and supersession, demo data with three matricules (the
  pub_taches_jours rows equal the task's hours), removal and reassignment, HTTP order and body, a refused task, 503 then the
  `cursus-outbox` retry, a final 400, every task refused, the nightly job, "Sync now", disabled connector, 90-day purge, French.
- `src/domain/jobs.test.ts`, `src/server/jobs/jobs.test.ts`: the new job and its night hour; `src/domain/jobs-runbook.test.ts`
  checks the runbook lists it.
