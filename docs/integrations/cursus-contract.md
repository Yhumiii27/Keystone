# Keystone ↔ Cursus — interface contract

> **Status: aligned with Cursus's contract (delivery 9, lots `cursus-contract` and `cursus-tasks`; R-027, R-029, R-031, R-084, R-180).** Cursus owns the
> data (people's clearances and site Go / No Go, timesheets, absences), so **Cursus's documents are authoritative**:
> Cursus `docs/API-KEYSTONE.md` (version 1) and its OpenAPI 3.1 specification `docs/keystone-openapi.json` (also served by
> `GET /api/integrations/keystone/v1/openapi.json`). Where this page and Cursus's documents differ, Cursus's documents win and
> Keystone adapts. This page records how Keystone implements them (`src/server/integrations/cursus/`,
> `src/domain/cursus-events.ts`, `src/app/api/cursus/v1/evenements/route.ts`) and what Keystone still asks of Cursus (§6).
> Keystone never modifies Cursus: it shows Cursus's records, opens them in Cursus (links) and sends what its users record
> (outbox "pending sync with Cursus").

Owner decisions this contract applies: NEW-CURSUS-2 "a" (Cursus provides the staff directory), NEW-CURSUS-4 "a" (absences
come from Cursus, Lucca is unplugged, Keystone keeps the dates and a simple type only), NEW-CURSUS-5 "c" (hours per Keystone
task — proposal only), NEW-CURSUS-7 "a" (Cursus pushes, and re-sends after a failure).

## 1. Two directions

| Direction | What | Where in Keystone |
|---|---|---|
| Keystone → Cursus (Cursus API v1) | `GET /api/integrations/keystone/v1/chantiers/{id}/go-no-go`, `POST /api/integrations/keystone/v1/demandes`, header `X-Api-Key: <CURSUS_API_KEY>` (Cursus's `KEYSTONE_API_KEY`) | `connector.ts` |
| Keystone → Cursus (Cursus API v1, R-180) | `PUT /api/integrations/keystone/v1/projets/{code}`, then `PUT /api/integrations/keystone/v1/instantane` (section `taches`) — the planned tasks of each person (§ 7) | `tasks.ts` (job `cursus-tasks`, "Sync now") |
| Keystone → Cursus (**Keystone's proposal, absent from Cursus**) | `GET /api/integrations/keystone/annuaire` — the staff directory (§5) | `connector.ts` `listDirectory` (off: `CURSUS_DIRECTORY=off`) |
| Cursus → Keystone (Cursus's webhook `evenement`) | `POST /api/cursus/v1/evenements` — travel-request decisions, validated hours and absences, Go / No Go changes (§2, §3) | `events.ts`, `inbox.ts` |

The two keys are **different secrets**: Keystone presents `CURSUS_API_KEY` to Cursus (Cursus's `KEYSTONE_API_KEY`); Cursus
presents `CURSUS_EVENTS_KEY` to Keystone (Cursus's `KEYSTONE_TOKEN`). Neither side ever accepts the other's key.

**For IT (Cursus's configuration, Cursus `docs/DEPLOIEMENT.md`):** `KEYSTONE_URL` = Keystone's base URL on the internal
network (e.g. `https://keystone.interne`, no path: Cursus adds `/api/cursus/v1/evenements`); `KEYSTONE_TOKEN` = the value of
Keystone's `CURSUS_EVENTS_KEY`.

## 2. Events endpoint: `POST /api/cursus/v1/evenements`

| Item | Rule |
|---|---|
| URL | `<Keystone base URL>/api/cursus/v1/evenements` (Cursus's address). Keystone's earlier address `POST /api/integrations/cursus/events` is kept as an alias (same handler, same rules). No session, no cookie: server to server. |
| Authentication | `Authorization: Bearer <CURSUS_EVENTS_KEY>` (Cursus's `KEYSTONE_TOKEN`); `X-Api-Key: <CURSUS_EVENTS_KEY>` is accepted too. Constant-time comparison. Any other scheme or value: 401. |
| Idempotency | Header `Idempotency-Key` = the body's `id` (Cursus sends both). Keystone deduplicates on the body's `id` and keeps it 13 months (Cursus asks 90 days at least). |
| Keys per environment | Outside production Keystone accepts the demo key `demo-cursus-events` by default. Production refuses the demo key (start-up error) and, while no key is configured, answers **503** to every call. Minimum 16 characters. |
| Format | JSON, UTF-8; one event per call. |
| Size | At most **256 KB** per call (413 above). |
| Rate | At most 600 calls a minute from one address (per Keystone server process); above it **429** with `Retry-After`. |
| Time | Cursus waits 10 s at most; Keystone answers after one database transaction (and, for `verdict.modifie` in HTTP mode, one go-no-go read). |

### 2.1 Envelope

```json
{ "id": "0b9d7c1e-2f4a-4d3b-9a61-3c5e8f7a1b20", "type": "absence.validee", "emis_le": "2026-10-10T08:41:07.512Z",
  "donnees": { "absence": 31, "matricule": "EMP-0018", "du": "2026-12-14", "au": "2026-12-18" } }
```

| Field | Rule |
|---|---|
| `id` | The event's unique id (a UUID from Cursus; Keystone accepts 1–200 letters, digits, `. _ : @ -`). |
| `type` | The event type (§3). An unknown type is accepted (200, status `ignored`) and its data is not kept. |
| `emis_le` | When Cursus queued the event (ISO 8601). Orders the events of one object (§2.3). |
| `donnees` | The event's content (§3). `data` (Keystone's earlier name) is still accepted; `donnees` wins when both are sent. |

### 2.2 Answers

Cursus retries 408, 429, 5xx, time-outs and network errors; **any other 4xx is a final failure** (shown to the HR department,
who can resend it); a redirection is not followed.

| Code | Body | Meaning for Cursus |
|---|---|---|
| 200 | `{ "ok": true, "id": "…", "status": "received" \| "unresolved" \| "ignored" \| "error", "accuse": "<status> · <id>" }` | Stored. `accuse` is the acknowledgement Cursus keeps. `unresolved` = kept until Keystone knows the person or the site (replayed by Keystone); `error` = stored, its processing failed and is replayed by Keystone. |
| 200 | `{ "ok": true, "id": "…", "duplicate": true, "accuse": "<status> · <id>" }` | Already received (same `id`): not processed again; same acknowledgement unless a replay has since changed the status. |
| 400 | `{ "ok": false, "error": "Invalid absence.validee · du: must be a date" }` | Not JSON or not a valid event (final in Cursus: fix and resend). The reason names the field, never the value. |
| 401 | `{ "ok": false, "error": "Invalid API key" }` | Missing or wrong key (final: fix the key). |
| 413 | `{ "ok": false, "error": "Event too large (256 KB at most)" }` | Final. |
| 429 | `{ "ok": false, "error": "Too many requests" }` + `Retry-After` | Retried. |
| 503 | `{ "ok": false, "error": "…" }` + `Retry-After: 60` | Retried: no key configured, the Cursus connector disabled by EPC2i's IT (D-7a), or Keystone's database unavailable. |

Refusals carry `error` but no `code` yet (Cursus's suggested `{ error, code }` body; Cursus copies `error` into its log).

### 2.3 Objects, replacement and order

Cursus's rule: for one object, Keystone applies an event only when it is newer (`emis_le`) than the last one applied — the HR
department can resend an old failed event after newer ones.

| Type | Object (replacement key) | Rule |
|---|---|---|
| `heures.validees` | `matricule` + `semaine` | A corrected week replaces the week already received. |
| `absence.validee`, `absence.annulee` | Cursus's absence id (`absence`) → key `cursus:<id>`; without an id, `matricule` + dates | One object for both types: a correction (same id, new dates) replaces the weeks written before (no stale week stays); a cancellation removes them; an older event arriving later is stored as `ignored` and changes nothing. |

## 3. Event types

### 3.1 `absence.validee` and `absence.annulee` (R-031)

```json
{ "absence": 31, "matricule": "EMP-0018", "du": "2026-12-14", "au": "2026-12-18" }
```

| Field | Rule |
|---|---|
| `absence` | Cursus's absence id (integer; a string is accepted). Taken up by the cancellation. Keystone's earlier name `id` is still read. |
| `matricule` | Cursus employee id (`EMP-0018`, or the payroll matricule after Cursus's announced switch). |
| `du`, `au` | First and last day, inclusive; `au` ≥ `du`; at most 400 days. Keystone's earlier names `start` / `end`, `debut` / `fin` are still read. |
| `nature` | **Not sent by Cursus** (only the unavailability matters). Absent → the absence is stored as type **Absence**. When a sender includes it (earlier proposal), it is reduced at reception to Leave (CP, RTT, congés…) or Absence and never stored (R-173). |

- `absence.validee`: one `leave_entries` row per week the absence covers (source `cursus`, key `cursus:<id>`); a week's days
  are its weekdays inside the absence minus the public holidays of Keystone's Settings. A **half day** arrives as the whole day
  (Cursus's rule) and is stored as a whole day. A matricule no Keystone person carries yet (persons' matricule, else the Cursus
  mirror's person) is kept `unresolved` and replayed after each staff-directory import or by IT.
- `absence.annulee`: the rows of the absence's key are removed, whoever carries them (a matricule switch does not leave stale
  weeks). Nothing to remove and no person for the matricule → `unresolved` (replayed); nothing to remove but a known person →
  `received` ("nothing to remove").
- One audit row per event received (actor "Cursus", area "Integrations"); no activity event (people's data, R-173).
- Effect: the Leave & working calendar, and **the people's capacity in the load plan** (R-084: 40 h a week less 8 h per day off).

### 3.2 `heures.validees` — stored, **not applied** (the Cursus timesheet link awaits EPC2i's confirmation, R-030)

```json
{ "matricule": "EMP-0012", "semaine": "2026-10-05", "projets": { "K-2614": 15, "K-2611": 0 } }
```

`semaine` is the week's Monday (an ISO week `2026-W41` is accepted too); hours 0–168 per project, `0` for a project removed by
a correction. Keystone's `lignes` proposal (NEW-CURSUS-5 "c") is still read if sent; Cursus does not send it.

### 3.3 `verdict.modifie`

```json
{ "chantier": "K-2614", "statut": "NO_GO", "ressource": { "matricule": "EMP-0018", "statut": "NO_GO", "motifs": [{ "code": "HABILITATION_SUSPENDUE", "niveau": "NO_GO" }], "precedent": "GO" } }
```

Keystone keeps the `chantier` only, finds the project whose site sheet carries that Cursus site and reads its go-no-go again at
once (`GET …/v1/chantiers/{id}/go-no-go`, HTTP mode). No site sheet linked yet (R-028) → `unresolved`.

### 3.4 `demande.decision`

```json
{ "demande": 7, "reference": "DK-2026-0412", "matricule": "EMP-0018", "chantier": "K-2611", "decision": "acceptee", "date": "2026-10-10" }
```

Keystone keeps the request id and the decision (`decision`, stored as `statut`; Keystone's earlier `statut` still read), nothing
else. Stored only: the travel request's status in Keystone is not updated from it yet.

### 3.5 `deplacement.modifie`, `deplacement.annule` and any other type

Accepted (200) and ignored, their data not kept.

## 4. Keystone → Cursus (Cursus API v1)

| Call | Keystone sends | Keystone reads |
|---|---|---|
| `GET /api/integrations/keystone/v1/chantiers/{id}/go-no-go` | — | `{ chantier, evalue_le, statut, ressources: [{ matricule, statut, motifs: [{ code, niveau, libelle? }] }] }`; the note shows the `libelle` (detailed sharing) else the code. A bare code (deprecated route's shape) is still read. |
| `POST /api/integrations/keystone/v1/demandes` | `{ reference, matricule, chantier, destination, depart, retour }` — `reference` = Keystone's request id (unique, so a retry is recognised) | `201 { resultat: "cree", demande: { id, … } }` → `demande.id` kept; `409 DEMANDE_EN_DOUBLE` (a retry already received) → delivered, `demande.id` kept; any other refusal → failed with Cursus's status and code (`Cursus POST … → 400 VALIDATION`), redelivered by the `cursus-outbox` job. |
| `PUT /api/integrations/keystone/v1/projets/{code}` | `{ nom }` for each project a planned task cites (R-180, § 7) | `resultat` (`cree` / `modifie` / `inchange`); a refusal fails the push |
| `PUT /api/integrations/keystone/v1/instantane` | `{ depuis, taches: [{ id, projet, tache, matricule, debut, fin, heures }] }` (R-180, § 7) | `{ resultat: "synchronise", bilan }` kept on the push; `400 VALIDATION` naming tasks → sent again without them |

Header `X-Api-Key` on every call; 5 s time-out. The routes without `/v1` (deprecated by Cursus) are no longer called.

## 5. Staff directory: `GET /api/integrations/keystone/annuaire` — **PLACEHOLDER (R-027, NEW-CURSUS-2 "a")**

**Cursus has no such route** (its API v1 answers `404 ROUTE_INCONNUE`). Keystone keeps its proposal, switched off by default
(`CURSUS_DIRECTORY=off`), with the same `X-Api-Key` as the other routes:

```json
[{ "matricule": "EMP-0018", "nom": "Wagner", "prenom": "Julien", "email": "julien.wagner@epc2i.fr", "equipe": "Engineering" }]
```

Keystone reads it once a day and on "Sync now" once EPC2i switches it on; matches by matricule, else by work e-mail; creates
the persons it does not know (never a user account); never deletes anyone; never changes a name or an e-mail typed in Keystone.

## 6. Requests to Cursus and open points

| Point | Request / question |
|---|---|
| Staff directory | No `/annuaire` route in Cursus: needed for R-027 (§5), or another way to get matricule, name, e-mail and team. |
| Absences as data | No `pub_absences` view (Cursus is not on the shared EPC2I PostgreSQL server yet: no PostgreSQL schema, no `pub_` views). Keystone relies on the events only; a view would let it re-sync after a failed event. |
| Contractual hours | Cursus exposes no contractual hours / part time: Keystone's capacity stays 40 h a week less the absence days (R-084). |
| Planned hours per day | Keystone now pushes them (§ 7, R-180) by Cursus's routes; nothing in Cursus reads the `pub_taches_jours` view (kept: the push uses its rule for Keystone tasks). |
| Planned tasks: owner of the precedence | Keystone sends the schedule's named assignments and the tasks not covered by one (§ 7.2): Cursus proposes one line per task; confirm with EPC2i that a to-do inside an assignment of the same person and activity is not proposed on its own. |
| Planned tasks: weekend and holidays | Tasks follow `pub_taches_jours` (Monday–Friday); assignments follow the activity's working calendar (a 6-day site calendar includes Saturday). Cursus zeroes holidays, absences and days off itself. |
| Matricule in cancellations at exit | Cursus `server/src/actions/sorties.ts:71` sends `absence.annulee` with the default `EMP-xxxx` matricule (`absenceKeystone('absence.annulee', a)`) instead of `identifiantKeystone(...)`, unlike the other senders. Keystone removes the weeks by absence id, so it copes, but the matricule differs after the payroll-matricule switch. |
| Project identifier | Keystone sends and expects its own project codes until EPC2i settles the shared project key (NEW-SYS-1 / R-022). |
| Half days | Sent as whole days (Cursus's rule); Keystone stores whole days. A half-day field only if EPC2i asks for it. |
| Refusal body | Keystone answers `{ ok, error }`; adding Cursus's suggested `code` is possible if Cursus wants it. |
| Travel decisions | Keystone stores `demande.decision` only; updating the Keystone travel request from it (by `reference`) is a later lot. |

## 7. Planned tasks: Keystone → Cursus (R-180, NEW-CURSUS-5 "c")

Cursus's timesheet « Proposer depuis Keystone » proposes, for the week shown (Monday to Sunday), one line per Keystone task
with the hours planned each day (Cursus `docs/API-KEYSTONE.md` « Tâches planifiées », `shared/rules/temps.ts` `suggestLines`).
Keystone sends them; it exposes no read route (Cursus stores the tasks, table `taches`).

### 7.1 Calls and order

1. `PUT /api/integrations/keystone/v1/projets/{code}` `{ "nom": "<project name, 120 chars>" }` for every project the tasks cite
   (Cursus refuses a task whose project it has not received; idempotent: an unchanged project answers `inchange`).
2. `PUT /api/integrations/keystone/v1/instantane` `{ "depuis": "<Monday of the current week − 4 weeks>", "taches": [...] }` —
   only the section `taches` (never `projets`, `chantiers`, `affectations`, which would archive every project or site absent
   from them). The section is the complete state: Cursus creates or updates each task by its id and **deletes the Keystone
   tasks absent from it that end on or after `depuis`** — a task removed or emptied in Keystone, an assignment removed, a
   person who lost their matricule. Tasks ending before `depuis` are kept (timesheet history). All or nothing on Cursus's side.

```json
{ "depuis": "2026-08-24",
  "taches": [{ "id": "KA-0b9d7c1e-2f4a-4d3b-9a61-3c5e8f7a1b20", "projet": "HLT-026", "tache": "A1250 · Steel erection — Bays 3–4", "matricule": "EMP-0018",
               "debut": "2026-08-17", "fin": "2026-10-09", "heures": { "2026-08-17": 8, "2026-08-18": 8, "…": 8 } },
             { "id": "KT-T-2318", "projet": "HLT-026", "tache": "T-2318 · Weld inspection report — Bay 3", "matricule": "EMP-0012",
               "debut": "2026-09-25", "fin": "2026-10-01", "heures": { "2026-09-25": 1.2, "2026-09-28": 1.2, "2026-09-29": 1.2, "2026-09-30": 1.2, "2026-10-01": 1.2 } }] }
```

Why the snapshot rather than unit `PUT /taches/{id}` + `DELETE /taches/{id}`: Cursus's contract recommends a nightly snapshot to
catch up lost calls, and the snapshot carries the deletions without Keystone keeping a record of every task sent. Keystone has
no single write path for tasks and assignments (Plan, My work, approvals, imports, what-if), so no per-change push is wired;
"Sync now" sends at once.

### 7.2 What is sent (`src/domain/cursus-tasks.ts`)

| Source | Cursus id | Label (`tache`, 160 chars) | Hours per day |
|---|---|---|---|
| Named schedule assignment (`activity_assignments` with a person; R-084: the one source of planned hours) | `KA-<assignment id>` | `<activity code> · <activity name>` | every working day of the activity's calendar between its start and finish: units × h/d, else planned hours ÷ working days (`assignmentHoursInWeek` per day) |
| Keystone task (`tasks`, My work) | `KT-<task number>` | `<number> · <title>` | `pub_taches_jours` rule: estimate ÷ weekdays (Mon–Fri) between start and due date, 2 decimals — the view and the push agree |

- A Keystone task whose assignee is also assigned on the task's activity is **not sent**: it is a to-do inside that assignment,
  whose hours already cover it (otherwise Cursus would propose the work twice).
- Only persons with a matricule (`persons.matricule`, sent as is: the identifier Cursus is set to receive — `EMP-xxxx` by default,
  the payroll matricule after Cursus's switch); only open projects (not `clos` / `annule`); milestones, equipment, material and
  external labour (R-083) are not sent; a task without hours is not sent.
- 2 decimals, 24 h a day at most (Cursus's limit); ids, lengths and dates are checked as Cursus checks them, so one bad record
  never refuses the whole snapshot.
- A reassigned task keeps its id: Cursus updates its matricule.

### 7.3 When, retries, mock

| Situation | What happens |
|---|---|
| Every night at 02:00 Paris (job `cursus-tasks`) and on "Sync now" of the Cursus connector | the snapshot is prepared at the business date and sent; one row in `cursus_task_pushes` (body kept on the newest only, rows kept 90 days) |
| Retryable failure — no answer, `401` (Cursus's key just changed), `408`, `429`, `5xx` (`503 NON_CONFIGUREE`) | the push stays pending; job `cursus-outbox` sends it again every 5 minutes; the next night's push supersedes it |
| `400 VALIDATION` naming tasks (`details[].champ` = `taches[3].matricule`: a matricule Cursus does not know) | those tasks are left out and the snapshot sent again (3 rounds at most); recorded as refused. Every task refused: nothing applied (a snapshot without them would delete them all) |
| Any other refusal (`400` on `depuis`, `403` proxy, `413`, `415`), or a body above 2 MB | failed until the next push (warning on the connector) |
| Mock connector (`CURSUS_API_URL` unset) | nothing is sent; the push is recorded with the body that would be sent |
| Connector disabled by IT (D-7a) | nothing prepared |

Activity & integrations, Cursus row: `Last task push · <date> · Tasks · <n>`, then `Task push failed` / `Task push pending`,
`Tasks refused · <n>`, `Persons without matricule · <n>`; a failed or refused push puts the connector in warning.
