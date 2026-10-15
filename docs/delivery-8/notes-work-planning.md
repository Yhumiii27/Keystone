# Delivery 8 — lot "work-planning": notes

Branch `worktree-wf_3e64f8c5-23c-4`, based on `e41c309` (plan base on main-2a2fep). Eleven items in eight commits. The decisions applied are
the owner's answers in `docs/DECISIONS.md` and the defaults of `docs/DELIVERY-8-PLAN.md` §2; every test that changes a displayed value
cites its decision id. Where the brief and the code disagreed, the code was followed (noted per item).

| Item | Decision | Status | Commit |
|---|---|---|---|
| R-090 Re-request a withdrawn resource request | P-8c a | done | `27421e5` |
| R-152 Missing confirmation toasts | X-9, L-1 | done (e2e assertions added, not run here) | `27421e5` |
| R-116 Date an interface's receipt | Q-4 a | done | `55befe3` |
| R-172 Plan owner names, stale TODO(db) | R-062 (CR part already done), D-7b | done (owner names); P&ID ImportJob stays deferred (D-7b) | `70ebd37` |
| R-064 Plan trash: positions after a restore | S-5 (technical part) | done; stays **en_cours** (30 days / 20 entries / PM + director unconfirmed) | `48ce77f` |
| R-149 @mentions in task comments | R-8b a | done (no '@' suggestion list — owner to confirm) | `a500721` |
| R-015 (part) Task assigned notices | X-6a | done for Plan to-dos and meeting tasks; R-015 stays **en_cours** (other lots' parts) | `a500721`, `aa43dfa` |
| R-150 Board drag-and-drop | R-8c a | done | `a500721` |
| R-067 Meeting follow-up tasks with the typed due | S-12 a | done | `aa43dfa` |
| R-037 Outlook / Teams labels and read receipts | S-11 a, X-6b, A-15, I-3c | partly: labels and Keystone read receipts done; the Outlook sync waits for IT (Graph access) | `11a29bf` |
| R-089 Sourcing task sent to procurement | P-8b | partly: routing, procurement My work and "Name the person" done; creating a new person waits for R-027 | `57f7390` |

## 1. Migration

One generated migration: **`drizzle/0016_true_bastion.sql`** (+ `drizzle/meta/0016_snapshot.json`, `_journal.json`) — R-067:

```sql
ALTER TABLE "meeting_lines" ADD COLUMN "activity_id" uuid;
ALTER TABLE "meeting_lines" ADD CONSTRAINT "meeting_lines_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;
```

No custom SQL, no backfill (MTG-116 / MTG-117 keep their tasks as they are). The Plan trash follows the new foreign key automatically
(`meeting_lines.activity_id` is a reference cleared on removal and restored, like the others). Integrator: drop this lot's 0016 and
regenerate in merge order (`npm run db:generate`); the SQL above is what it must contain.

## 2. Changes per item

### R-090 — P-8c a: re-request a withdrawn request
- `src/features/requests/actions.ts` `reRequestAction`: accepts `rejected` **or** `withdrawn` (everything else stale); sender only
  (`canManageOwnRequests` + `isRequester`, unchanged), "New resource request" notice to the department head and "Re-sent resource request"
  activity (unchanged). The DAL already accepted both.
- `src/features/requests/model.ts` `RequestRowView.canReRequest` (rejected or withdrawn; `isRejected` kept); `requests-screen.tsx` and
  `request-row-actions.tsx` show "Re-request" on it.
- No new read-only guard (owner question, as the brief says). The re-request keeps the dates it was sent with.
- Seed: unchanged (no withdrawn request in the seed). `actions.test.ts:92` flipped (P-8c comment).

### R-152 — X-9, L-1: confirmation toasts
- New request: the toast is always shown, then the page goes to Resource requests when the viewer has it. Text **"Request sent · RQ-045" →
  "Request RQ-045 sent"** (FR « Demande RQ-045 envoyée », `requestSentText` in `src/features/requests/i18n.ts`).
- Register: a forced stage change (Annulé included) toasts **"WSA-044 · Validation requested from the portfolio director"** once the server
  accepted it; automatic moves stay silent.
- New project: `toast.show` with the typed name as typed (R-148) — "#052 · Sun Valley Farm · Project created" (was `showEn`, which
  segment-translated the name).
- Builders in `src/features/projects/toasts.ts` (unit tests); Playwright assertions added to `tests/e2e/06-portfolio.spec.ts` (not run
  in the lot — the integrator runs the e2e suite).

### R-116 — Q-4 a: date an interface's receipt
- "Mark received" opens a one-field dialog **"Received on"** (FormDialog, text date like "Needed by"), today (`NOW_ISO`, 30 Sep 2026)
  by default in the viewer's language, editable. `parseReceivedOn` (`src/domain/team.ts`): `parseDateInput`, empty / unreadable →
  `DATE_ERROR`, after today → "The received date cannot be after today" (new FR).
- `markInterfaceReceived(code, number, actor, receivedOn = NOW_ISO)` (date last and optional: `shell.test.ts:171`,
  `delivery3-writes.test.ts:226` unchanged) validates the date again and stamps `provided_on` in the same update as the status; audit
  **"status: Late → Received · received 28 Sep"**. Freeze keeps the date. No backfill (earlier receipts keep "—"). No edit after receipt
  (default, owner to confirm).
- Focus: after the dialog, the row's new "Freeze" button takes the focus (the dialog is mounted only while open).
- `InterfaceSummary.dueWithin30` removed (dead: the screen counts from the data date, A-12); `team.test.ts` golden assertions annotated
  (A-12 / Q-4). `src/server/dal/interfaces.ts` header comment fixed; the schema comment in `operations.ts:32` is left to site-quality.

### R-172 — owner names on the Plan; P&ID TODO(db)
- `getPlanData`: `ownerName` = full name, else **short name** (the wizard's default PM S. Perrin has no full name: the plan showed "SP"),
  plus `ownerIsCode` (the owner key came from `owner_code`; initials are not unique).
- One rule `planOwnerNames` (`src/features/plan/model.ts`): rows, the drawer's Owner line (`DrawerInput.ownerName`, optional) and the plan
  export's Owner column; activities without owner show "—" (export cell stays empty). Domain types `PlanActivity` / `PlanRow` unchanged.
- Owner select (`src/features/plan/owner-select.ts`): the current owner outside the OWN list, or "—", comes first under a value that is
  never saved (`~current`); choosing an OWN entry saves through the existing `ownerCode` patch.
- `src/server/dal/pid-import.ts`: the stale TODO(db) is now a note (re-planned in the apply transaction by design; an ImportJob `pid` waits
  for D-7b). Comment only.
- Displayed: wizard project plan / drawer / export Owner **"SP" → "S. Perrin"**; HLT-026 unchanged (`drawer-model.test.ts:65`, new
  Owner-column assertion in `providers.test.ts`).
- Flagged, not built: owner candidates are only `owner_code` persons (empty in production); "Add activity" falls back to "RA"; a team member
  without `owner_code` cannot enter progress on their own activity (follow-up: owners from the project team, R-041).

### R-064 — S-5 technical part: positions after a restore ("ghost slots")
- Work packages and activities share one position sequence per project. A trashed row keeps its slot: `insertActivity` shifts the positions
  stored in the project's `plan_trash` payloads at or above the new position (`shiftTrashedPositions`), in the same transaction as the live
  rows; `insertWorkPackage` takes `max(live, trashed) + 1` (`maxTrashedPosition`); `restorePlanTrash` re-inserts at the stored positions.
  Every entry of the project is covered (handed-over rows included).
- Defensive fallback: when a stored slot is taken anyway (a writer that does not shift the trash), the rows at or above the block move up by
  its size first. Restored links whose (successor, position) was taken since go after the successor's last predecessor.
- The project row is locked (`FOR UPDATE`, `lockProjectRow`) at the start of `insertActivity`, `insertWorkPackage`, `trashPlanRow` and
  `restorePlanTrash`.
- `PLAN_TRASH_RETENTION_DAYS` / `PLAN_TRASH_MAX_ENTRIES` moved to `src/domain/ch4-defaults.ts` (S-5 section, with the pointer to the rights
  rule `canSchedulePlan` = `canEditPlanStructure`); `plan-trash.ts` re-exports them.
- No displayed value changes. Tests: `src/server/dal/plan-trash-positions.test.ts` (fail without the fix); the 15-table comparisons of
  `plan-trash.test.ts` stay green.

### R-149 — R-8b a: @mentions in task comments
- Parser `src/domain/mentions.ts`: "@Full Name" / "@J. Wagner", case and accents ignored, longest match first, word boundaries (an e-mail
  address is not a mention), a name held by two persons is ambiguous (nobody — their unique short name works), distinct persons in order.
- `addTaskComment` resolves the mentions in its transaction among the **mentionable** people (`listMentionablePersons`: an active user that is
  not external, not a client account, not a client contact), the author excluded, and writes one audit line "mentioned: …"; it returns them.
  `addTaskCommentAction` then sends, **after the commit**, one bell notification per person: kind `mention`, title **"@you in T-xxxx"**
  (FR rule « @vous dans T-xxxx » in `src/i18n/fr-rules.ts`, first in the list), sub "“excerpt ≤ 120” · author", target the task.
- Task sheet: mentions in posted comments are highlighted (computed on the server; no list of people is sent to the browser).
- No "@" suggestion list (absent from the prototype — owner to confirm).
- The bell link: `deepLink('task', { taskId })` still opens T-2314 until the audit-i18n-shell lot's deepLink fix is merged (tests assert the
  stored screen and params, not the href).

### R-015 (work-planning part) — X-6a: task assigned
- `src/server/dal/task-notices.ts` `notifyTasksAssigned`: "Task assigned · T-xxxx" (FR « Tâche assignée · T-xxxx »), sub = the task title
  (typed text), to the assignee **after the commit**, never the actor, never a person without an active account (no orphan notification
  row), failures logged.
- Wired to the Plan drawer's to-dos (`addActivityTodo`) and to the tasks "Send minutes" creates (`sendMinutes`). Tasks born from requests keep
  their own notices (requests feature). R-015 stays en_cours (CR events in cost-change, deliveries / invoices / Vigie hooks in connectors).

### R-150 — R-8c a: board drag-and-drop
- `src/features/mywork/my-work-body.tsx`: when the viewer may edit (assignee, or the director viewing someone's board — R-9 b), each card is a
  draggable block (click opens the task) with its title link (not draggable: no URL drag) and a **"Move to…"** menu (Popover, the three
  other statuses, 40 px rows for tablets). HTML5 drag with a custom type (`application/x-keystone-task`), drops without it ignored, column
  highlight; a drop on its own column does nothing. Moves go through `setTaskStatusAction` (status ⇄ % coupling), optimistic (one
  `useOptimistic` union with the list's done toggle), toast "Moved to {status}" after success, errors roll back; the focus returns to the
  moved card (by task id). Read-only boards keep plain link cards. Order inside a column stays by due date.
- Rules in `src/features/mywork/board-move.ts` (unit tests). A deliberate departure from spec 10 §6.4 ("no drag-and-drop"), by R-8c.

### R-067 — S-12 a: meeting follow-up tasks with the typed due
- Migration (above). Composer, action type only: optional **Activity** select, loaded for the minutes' writers only (P-9b: the organiser and
  the PM — never a client), plan order, labels with `dataText`. `parseMinutesLine` accepts `activity`; the Server Function refuses it from
  someone else and checks it against the project's plan; `appendLines` re-checks (`MeetingLineError('Unknown activity')`). Transcript lines
  get none.
- `followUpTarget` (`src/domain/meetings.ts`): an internal owner (no client organisation, not an external user, no client user) gets the task;
  any other owner is external → the project's stakeholder by person, else by exact full name or short form after stripping "(Org)", first in
  register order → its relationship owner; the PM when none matches or the stakeholder has no owner; no PM → no task.
- `sendMinutes`: follow-ups titled "{action} — {owner as typed}" (≤ 200 chars) with labels Meeting, MTG-xxx, **Follow-up**; due = typed due,
  else today + 3 working days; start = today, or the typed due when earlier (kept even when past — unlike the Plan to-dos, which clamp);
  the line's activity; origin `meeting`; the audit and the toast count include the follow-ups. Assignees told after the commit (R-015).
- Clients never see the internal task numbers / links of an external meeting, nor the activity (`meetingsScreenView({ client })`).
- Displayed on the seed: MTG-118 "Send minutes" **2 → 3 actions added to tasks** (L. Fabre, internal, outside the pool, now gets one —
  a reading of S-12, default); J. Wagner's task due **30 Sep → 1 Oct** (typed), H. Sauvage 3 Oct, L. Fabre 2 Oct; task numbers T-2341 L. Fabre,
  T-2342 J. Wagner, T-2343 H. Sauvage. Updated: `delivery3-writes.test.ts`, `meetings.golden.test.ts`, `actions.test.ts`, `scripts/db-check.ts`
  (S-12 comments).

### R-037 — S-11 a, X-6b, A-15: honest labels, read receipts in Keystone
- Meeting header: the series alone; "Synced from Outlook · {series}" (with its icon) only when `meetings.external_calendar_id` is set (none
  today). **"Synced from Outlook · Weekly site meeting" → "Weekly site meeting"**.
- New meeting: submit **"Create & invite" → "Create meeting"**, toast **"{title} · Meeting created · invitation synced to the calendar" →
  "{title} · Meeting created"**; composer footer "… read receipts are tracked in Keystone".
- Connector rows, at read time (`connectorScopeText`, `src/domain/connectors.ts`, applied in `listConnectors`), over the **seeded** texts only
  (a scope IT sets in the connectors file is shown as set): Outlook / Exchange "Meetings carrying the project code, Outlook / Teams → Keystone
  (S-11)"; Microsoft Teams **requalified** "Teams meetings through the Microsoft 365 app with Outlook, no channel posts" (not retired: I-3c keeps
  Teams). Both stay "Not connected".
- Channels tile (`notificationChannels`, only this function of `src/domain/admin.ts`): Teams is no channel — **"In-app · e-mail and Teams not
  connected" → "In-app · e-mail not connected"** (count 1).
- Bell footer: **"Also sent by e-mail digest and to the project Teams channel · preferences in Settings" → "E-mail not connected yet —
  notifications stay in Keystone · preferences in Settings"**.
- Read receipts: `recordMinutesReadAction({ code, meeting })` — visibility only (`getProjectContext`: read-only projects and screens outside
  the workspace allowed; a client only on their organisation's projects and external meetings); the reader is `viewer.personId` (Entra) or the
  persona's short name (demo, `readerOf`). `recordMinutesRead` matches the participant by person, else by name, only a minutes recipient
  without a receipt (the organizer never), once, audited. Triggered by "Open minutes" in "Distribution & read receipts" (`OpenMinutesLink`,
  the link still navigates); merely viewing the meeting does not count; external recipients without an account stay "Not read yet".
- Not built: the Outlook → Keystone sync (IT must register Keystone in Microsoft 365 with Graph access, I-3c); recording a receipt when the MIN
  record is opened from Documents (optional in the brief).

### R-089 — P-8b: sourcing task sent to procurement
- An approved request for a contract role (Approvals and My approvals — both reach `approveRequestAction` — and an accepted reschedule):
  `createTaskFromRequest` gives the task to the **first active user holding the procurement role** (user order), else the director:
  **"Find and name: {contract role} — {request title}"**, same dates, hours and source request, the contract role kept on it until named.
  Every active procurement user is told ("Person to find and name · T-xxxx"), never the actor; the PM gets the usual decision notice; the
  audit and the activity say **"task created for Procurement"** (was "task created for Contract structural engineer"); the notice to a null
  person is gone.
- Procurement gets **My work** (`base.procurement.push('mywork')` next to the P-9a block, P-8b comment) — owner question.
- Task sheet card "Person to find and name" (contract role shown with `dataText` · request); **"Name the person"** for procurement and the director only:
  an EXISTING person (`listSourcingCandidates`: the resource pool first, then known people who are not client contacts; contract-role
  placeholders and client users excluded). `nameSourcedPerson` re-checks, in one transaction with the task and request rows locked, the actor's
  roles (procurement or director), the task's origin and the not-yet-named state; the same task goes to the person (contract role cleared,
  the request title back as its title), the request names them (contract role kept as history, event `named` — new `RequestEventAction`
  value in `codes.ts`, no DB change), audit "named: {person} · {role} · RQ-xxx", activity; the PM ("Person named · RQ-xxx") and the person
  ("Task assigned · T-xxxx") are told after the commit.
- Displayed on the seed: approving RQ-043 gives the task to **Fabien Bertrand** (was: no assignee, "Contract structural engineer"); the
  procurement persona's sidebar gains My work.
- Not built: creating a new external person from Keystone (waits for the Cursus staff directory, R-027, and the sign-in answer). If the person
  is not in Keystone, procurement keeps the task and comments it.

## 3. Defaults taken (owner to confirm)

| Point | Default |
|---|---|
| R-149 mentionable people | Active internal accounts only (not external, not client); author never told; no '@' suggestion list |
| R-149 ambiguous names | A full name held by two persons mentions nobody (their short names do) |
| R-150 rights | Assignee or director (`canEditTask`); a director viewing someone's board can move their cards (R-9 b) |
| R-067 internal owners | Every internal owner gets a task (L. Fabre too, outside the resource pool) |
| R-067 past typed due | Kept as typed; the task then starts on it (year-less dues still parsed in 2026) |
| R-037 Teams row | Requalified, not retired (I-3c); scope override only over the seeded text |
| R-037 receipt trigger | "Open minutes" from the meeting only |
| R-089 assignee | First active procurement user (user order), else the director |
| R-089 candidates | Resource pool, then known non-client people; no person creation |
| R-089 naming | The task's title goes back to the request title once named |
| R-116 | Today by default, never after today, no edit after receipt, no backfill |
| R-064 | 30 days / 20 entries / PM + director unchanged (S-5 unconfirmed) |

## 4. Tests

New files: `src/domain/mentions.test.ts`, `src/domain/meetings-followup.test.ts`, `src/domain/team-received.test.ts`,
`src/features/mywork/{mentions,board,sourcing-render}.test.ts`, `src/features/meetings/{followups,read-receipts}.test.ts`,
`src/features/requests/{rerequest,rerequest-personas,sourcing}.test.ts`, `src/features/team/received-personas.test.ts`,
`src/features/projects/toasts.test.ts`, `src/features/plan/owner-names.test.ts`, `src/server/dal/{plan-trash-positions,task-notices}.test.ts`.
Server Functions added or changed are exercised for the 8 personas (`PERSONAS` loops), malformed input and stale states.

Existing expectations changed (each with its decision id): `features/requests/actions.test.ts` (P-8c), `domain/team.test.ts` (A-12 / Q-4),
`features/team/{actions,render}.test.ts` (Q-4), `server/export/providers/providers.test.ts` (Owner column), `server/dal/delivery3-writes.test.ts`,
`features/meetings/{actions,meetings.golden,meetings.render}.test.ts`, `scripts/db-check.ts` (S-12, S-11 / A-15),
`domain/admin.test.ts`, `features/admin/model.test.ts`, `server/dal/{d7-debt-ux,delivery5}.test.ts` (X-6b, S-11), `tests/e2e/06-portfolio.spec.ts` (R-152).

Checks in the worktree: typecheck, eslint on the changed files, `scripts/db-check.ts` ("All checks passed"), the full vitest run (see the
structured report): 280 files, 3381 tests passed; 7 failures, none from this lot — 6 timeouts under load (`meetings.golden`, `shell`,
`plm/model`, `health`; each passes alone) and the random-ciphertext flake of `server/auth/crypto.test.ts` ("not to contain 'u1'"; passes on rerun).

## 5. For the integrator

- **Shared files touched:** `src/i18n/fr-rules.ts` (line 4 split: the R-149 rule first, with a comment — audit-i18n-shell and roles-rates-hr also
  edit this array; re-check first-match order), `src/config/role-screens.ts` (one `base.procurement.push('mywork')` line after the P-9a block;
  roles-rates-hr edits the same file), `src/server/db/codes.ts` (`RequestEventAction` + `'named'`, one line), `src/domain/admin.ts`
  (`notificationChannels` only), `src/domain/connectors.ts` (new `connectorScopeText` after `isRetiredConnector`),
  `src/server/dal/integrations.ts` (a separate import line + `dataScope: connectorScopeText(…)` in `listConnectors`),
  `src/components/app/shell/header-islands.tsx` (bell footer line), `src/features/projects/register.tsx` (`move()` toast) and
  `new-project-launcher.tsx`, `src/server/export/providers/steering.ts` (Owner column), `src/domain/ch4-defaults.ts` (S-5 section),
  `scripts/db-check.ts` (MTG-118 tasks), `src/server/dal/{d7-debt-ux,delivery5,delivery3-writes}.test.ts` and `src/features/admin/model.test.ts`
  (expectations above).
- **Route matrix:** procurement now reaches `/my/tasks` and `/my/tasks/[taskId]` (re-run after roles-rates-hr and connectors).
- **Persona count:** the new tests loop over `PERSONAS` (the Finance persona of roles-rates-hr joins them). In `sourcing.test.ts` and
  `received-personas.test.ts` a Finance persona falls in the "refused" branch unless its workspace includes the screen — re-check after merge.
- **R-149 deep link:** the bell opens the right task only with audit-i18n-shell's `deepLink('task')` fix.
- **Interfaces schema comment** (`operations.ts:32`) is site-quality's.
- **Dictionary:** `src/i18n/extra/d8-work-planning.json` only; no key clashes with any other dictionary (checked); no prototype key overridden.
- Follow-ups: the schedule importer (`src/server/interchange/schedule-import.ts`, off under D-7b) renumbers positions without shifting the
  Plan trash — call `shiftTrashedPositions` if imports into an existing project are turned on; the restore fallback covers it meanwhile.

## 6. Progress suggestions for `docs/reste-a-developper.json` (integrator)

R-090, R-152, R-116, R-149, R-150, R-067, R-172 → fait (R-172: owner names; the CR part was R-062; the P&ID ImportJob stays deferred under D-7b).
R-064 → en_cours (technical part done; S-5 values unconfirmed). R-037 → en_cours (labels and Keystone receipts done; Outlook sync waits for IT).
R-089 → en_cours (person creation waits for R-027). R-015 → en_cours (work-planning part done).

## 7. Open questions for the owner

1. **R-149.** No "@" suggestion list (absent from the prototype): names are typed. Add one? Should mentionable people be limited to the task's
   project team (today every internal account can be mentioned, and every internal role can read any task)?
2. **R-067.** Internal owners outside the resource pool (L. Fabre) now get a task — confirm. A typed due without a year is read in 2026: roll it
   forward from the meeting date? Keep a past typed due as typed (today) or clamp it to today like the Plan's to-dos?
3. **R-037.** Read receipts are recorded in Keystone only (a recipient opening the minutes from the meeting): acceptable until the Microsoft 365
   link exists? Keep the "Microsoft Teams" row (requalified) or retire it?
4. **R-089.** Procurement now has My work — confirm. Which buyer gets the sourcing task when several users hold the procurement role (today: the
   first in user order)? While a sourcing task is with procurement it carries the request's hours (e.g. 40 h) in their load. After naming, only
   the person and the director can update the task (`canEditTask`) — should the PM keep edit rights?
   The sourcing task's title is stored as the brief gives it ("Find and name: {role} — {request title}"), so a French viewer reads its prefix in
   English (task titles are typed text, shown as stored): store a French title, or a language-neutral one, instead?
5. **R-090.** A re-request keeps the dates it was sent with, and no read-only guard was added (same as for rejected requests): confirm.
6. **R-116.** Can the received date be corrected after receipt?
7. **R-064 / S-5.** 30 days, 20 entries, PM + director — still to confirm.
8. **R-150.** Drag-and-drop departs from spec 10 §6.4 by R-8c — recorded here so prototype-parity reviews do not flag it.

## Integration review fixes

- R-089 / R-148: the "Person to find and name" sub is `{role} · {title} · {date}` and the "New task assigned" sub `{title} · {decider} · {date}` — no English "due" / "Approved by" / "Accepted by" left beside the fields, so the French bell translates the date (`task-notices.ts`, `features/requests/actions.ts`; `sourcing.test.ts`, `actions.test.ts`).
- R-089 / R-015: with no active procurement user the sourcing task goes to the director (P-8b default), who is now told ("Task assigned · T-xxxx", `notifyTasksAssigned`) instead of nobody (`notifySourcingTask`; `sourcing.test.ts`).
