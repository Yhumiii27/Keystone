# Delivery 6 — Lot A notes: planning, baselines, undo

Scope: `docs/DELIVERY-6-PLAN.md` §4.2 (S-3), §4.3 (S-5), §3.1 gaps (1), (3), (4), (6) and the §3.2 hardening. To be folded into `DELIVERY-6.md`.

## 1. Baselines go through a change request (S-3 = a, L-2 = a)

### Rule

`src/domain/baseline-policy.ts`:

- `canSnapshotFreely(codes)` is true while the project's **next** baseline code (`nextBaselineCode`, over every existing baseline whatever its state) is **BL0 or BL1** (`LAST_FREE_BASELINE = 1`).
- Once the project has BL1, or any higher BLn (proposed, current or superseded), the next baseline must come from a change request.
- Every seeded project with planning data already has BL1 (the chapter-4 seed), so in practice only new projects (wizard, imports) can still snapshot freely.

### Where the rule applies

| Place | Up to BL1 | From BL2 on |
|---|---|---|
| Plan "Set baseline" (`setBaselineAction`) | Snapshots every activity into BL0/BL1. **The snapshot is current at once**: it used to be "proposed", and nothing could ever make it current. | Refused server-side ("After BL1, a new baseline goes through a change request"). The toolbar button becomes a link to `/projects/{code}/changes?new=1&baseline=1`. |
| Schedule "Re-baseline" (`rebaselineSchedule`) | Free snapshot, current when no change request is named. If one is named, it is proposed and linked to that request. | Only when the form names an **open** change request (draft or in review) that does not already propose a baseline. The snapshot is then proposed and linked to it. Anything else is refused. |
| Change control "New change request" (`createChangeRequestAction(code, values, { proposeBaseline: true })`) | — | Opened from the Plan link. It uses the same form, titled "New baseline · change request" and pre-filled with the title "New baseline BL3", type Schedule and WBS "1". It creates the request (submitted for review, as the existing flow does) and an **empty proposed baseline** BLn: name "BL3 — CR-013", source `change_request`, comment = the justification. The request's baseline column is set to BLn. Toast: "CR-013 · Change request submitted for review · BL3 proposed". |

### Approval (§3.1 gap 1)

The approval branch of `src/server/dal/changes.ts` (`decideChangeStep`, status → approved) handles the proposed baseline linked to the request as follows:

- **Without an activity snapshot** (the seeded BL2 "Pending CR-009", or one proposed from the Plan): it calls `snapshotIntoBaseline(code, bl.code, { actorName, makeCurrent: true, setOn }, tx)` in the same transaction.
- **With a snapshot** (frozen by the Schedule Re-baseline): it is only made current, keeping its snapshot.
- In both cases the previous current baseline becomes superseded.
- `setOn` is the **project data date** (`projectDataDate(project)`), no longer `STATUS_ISO`.
- The baseline is then selectable in the Plan Baseline chip, which needs an activity count > 0.
- The approval does **not** change the displayed baseline. The chip choice stays with the user.
- A rejected request leaves its proposed baseline proposed and empty. Open question: should it be marked otherwise?

### Old → new displayed values

| Where | Before | After |
|---|---|---|
| HLT-026 Change control › Baselines, after CR-009 is approved | BL2 current, set on 25 Sep 2026, 0 activities, chip option disabled ("No activity snapshot") | BL2 current, set on the project data date (25 Sep 2026 while `projects.data_date` is null), 21 activities, selectable in the chip |
| Plan toolbar "Set baseline" on seeded projects | Dialog creating a proposed BL3 | Link to the Change control form proposing BL3 (tooltip: "After BL1, a new baseline goes through a change request") |
| Schedule "Re-baseline" naming the approved CR-006, or no CR, on HLT-026 | Proposed BL3 | Refused; the form must name an open change request (e.g. CR-008) |

Tests:
- `src/features/changes/actions.test.ts`: CR-009 approval with the snapshot, `setOn` on a data date of 2 Oct, the chip showing BL2; a CR proposing BL3 that becomes current with 21 activities; a rejected proposal.
- `src/features/plan/scheduling-actions.test.ts`: free up to BL1, refused afterwards.
- `src/features/schedule/rebaseline-action.test.ts`.

### Dead code (§3.1 gap 3)

- Removed `setDisplayedBaseline` from `src/server/dal/baselines.ts`. The Baseline chip writes through `schedule.ts showProjectBaseline`, which also refreshes the roll-ups.
- `chapter4-foundation.test.ts` now exercises `showProjectBaseline`.

## 2. Undo after removing a work package or an activity (S-5)

### Design: a trash table, not `deleted_at` columns

- **Migration `drizzle/0006_square_lilith.sql`** adds the table `plan_trash`:
  - project, kind `wp`/`act`, code, name, activity count;
  - a `payload` jsonb;
  - `deleted_at` and the person who removed the rows.
- **Removing** a work package or an activity (`trashPlanRow` in `src/server/dal/plan-trash.ts`, one transaction) copies every row that belongs to it into the payload, then deletes those rows from their tables. The rows that belong to it are:
  - the node;
  - for a package: its activities and its Schedule bar;
  - for each activity:
    - its logic links in both directions, with type, lag, position and driving flag;
    - its resource assignments, request activity choices and what-if scenario actions;
    - its **Plan to-dos**, meaning tasks created by the drawer composer with no logged time, together with their checklist, comments and attachment rows.
- **References from other modules** are cleared, as before, and remembered in the payload. These are milestones, Budget WP lines, change-request WBS, risks, purchase orders, BOM lines, daily reports, site prerequisites, P&ID tags, stock movements, hours lines, deliverables, baseline snapshot rows, resource requests and other tasks.
- Tasks managed in My work (seed tasks, tasks from resource requests, tasks with logged time) are **not** deleted. They are unlinked and re-linked on undo, so no logged hours can be lost.
- **No read has to exclude soft-deleted rows**, because the rows are no longer in the business tables. This covers:
  - the Plan;
  - the Schedule;
  - the CPM network loader;
  - KPIs and Home;
  - exports;
  - the MSPDI export;
  - resources and what-if.
  
  The grep for readers of these tables is therefore not needed. A test checks that `loadScheduleNetwork` no longer sees the removed activities.
- The tables involved are found from the Drizzle schema's foreign keys:
  - cascading children go with their parent;
  - `activities.wbsNodeId` and `schedule_bars.wbsNodeId` are also owned;
  - any other foreign key is a remembered reference.
  
  A table added later that points at an activity, a work package or a task is therefore handled without code changes.
- **Restoring** (`restorePlanTrash`) re-inserts the rows with their original ids and values (timestamps revived), then re-attaches the references that are still empty. Edge cases:
  - **Conflict:** refused when a package or activity with the same code was created since. The message names the code.
  - **Missing parent:** refused when an activity's work package is gone ("Restore its work package first").
  - **To-do number taken:** to-do numbers are a global sequence, so the number of a removed to-do can be given to a new task in the meantime. The restored to-do then takes the next free T-number. This is the only value a restore can change.
  - **Missing other end:** a row whose other end is gone, such as a link to an activity removed later, is handed over to the trash entry that holds that end. It comes back when that entry is restored. A test removes A1250, then its successor, restores them in that order, and gets every row back.
- Removal and restore are audited and written to the activity feed. After both, `rescheduleIfAutomatic` runs, which does nothing in the default manual mode. This also closes the §3.2 note.

### Purge rule

- `PLAN_TRASH_RETENTION_DAYS = 30` uses the real clock (S-4: timestamps follow the real clock). `PLAN_TRASH_MAX_ENTRIES = 20` per project.
- Each new removal on a project first purges that project's entries older than 30 days, and the oldest ones beyond 20.
- An entry older than 30 days is no longer listed and cannot be restored, even before it is purged.
- At purge, the stored files of trashed attachment rows are deleted with `deleteStoredFile`, after the commit.
- The values sit in `src/server/dal/plan-trash.ts`, next to the logic, rather than in `src/domain/ch4-defaults.ts`, which belongs to another lot. They can be moved there later.

### UI and rights

- **Confirmation dialog:** unchanged.
- **Toast after removal:** "Work package 1.7 removed" / "A1250 removed", with an **Undo** action ("Annuler" in French) that calls `restoreRow`.
- **"Recently deleted" card on the Plan** (`src/features/plan/recently-deleted.tsx`):
  - lists the 5 newest restorable entries: code · name, activity count, who removed it and when (Europe/Paris);
  - has a "Restore" button on each entry;
  - is hidden when the list is empty.
- **Rights, checked server-side** in `removeRow` and `restoreRow`:
  - the project's manager and the director only (`canSchedulePlan`);
  - never read-only, outside the workspace or the client.
  - **Change:** removal used to be open to every plan editor, such as the engineering lead or quality. The Remove buttons now show only to the people who can also undo. The Plan editors' other edits are unchanged.
- Tests:
  - `src/server/dal/plan-trash.test.ts` checks a byte-for-byte comparison of 15 tables before the removal and after the restore. This covers links (types, lags, positions), assignments, to-dos with a checklist item, and references. It also covers conflicts, a missing parent, a deferred link, purge by age and by count, and the root and unknown nodes.
  - `src/features/plan/actions.test.ts` checks the rights for read-only, client, engineering lead, project manager and director, an invalid id, another project's id, and exact links after an undo.

### Toast API change (`src/components/ds/Toast.tsx`, shared DS file)

The change is backward compatible:

- `showToast(message, opts?)` and `useToast().show(message, opts?)` take `opts: { action?: { label, onClick }, durationMs? }`.
- With an action, a ghost `sm` button sits before the ×. Clicking it dismisses the toast and runs `onClick`. The toast then stays 8 s (`TOAST_ACTION_MS`) instead of 4 s, unless `durationMs` is given.
- Existing calls without options behave exactly as before. The CSS adds a `.action` class.

## 3. Not built / open questions

- **§3.1 gap (4), calendar exceptions editor:** not built. It is optional. `setCalendarException` / `removeCalendarException` still have no UI; exceptions only arrive through imports. Open.
- **§3.1 gap (6), writer for `projects.data_date` (S-4):**
  - S-4 = a says: "per-project data date; the PM updates progress, then the Friday freeze records the week's state".
  - It does not say what moves the data date: a scheduled Friday rollover, a "Freeze week" action, or Reschedule. It also does not say what a "freeze" records (EVM snapshot? progress?).
  - It is not built, because it is ambiguous. Every reader already goes through `projectDataDate()`, so a writer can be added without touching them.
  - Question for the owner: is the data date moved by an automatic Friday job, by the PM, or by Reschedule? What must the freeze store?
- **L-2 deliverable:** setting BL1 does not tick "Planning BL1 posé" automatically. Lifecycle deliverables belong to another area. Open.
- **Rejected baseline proposals:** a rejected CR leaves its proposed BLn (empty) in the register. Should it be removed or shown as rejected?
- **Re-baseline header button:** after BL1, the Schedule "Re-baseline" form still opens and asks for an open change request. Option: turn it into the same link as the Plan button.
- **Positions after restore:** restored rows keep their original `position`. If rows were inserted in the same package meanwhile, two rows can share a position. The order between them is then not guaranteed.
- **Migration number:** `0006_square_lilith` was generated on this branch. If another lot also generated a 0006, keep one and regenerate the other after merging. Never edit a generated migration.
