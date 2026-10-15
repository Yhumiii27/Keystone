# Keystone ↔ Cursus — interface contract (draft for the Cursus team)

> **Status: proposal (delivery 8, lot `connectors`; R-027, R-029, R-031).** Written from what Keystone implements
> (`src/server/integrations/cursus/`, `src/domain/cursus-events.ts`, `src/domain/directory.ts`). Cursus logs its events
> today and has no staff-directory access; everything below that Cursus must build is Keystone's proposal, marked
> `TODO(cursus)` in the code, until Cursus confirms or changes it (the same footing as `TODO(codex)`). Sections marked
> **PLACEHOLDER** are not agreed and must not be built as written. Keystone never modifies Cursus: Cursus owns people's
> clearances and site Go / No Go, timesheets and absences. Keystone shows them, opens them in Cursus (links) and sends what
> its users record (outbox "pending sync with Cursus").

Owner decisions this contract applies: NEW-CURSUS-2 "a" (Cursus provides the staff directory), NEW-CURSUS-4 "a" (absences
come from Cursus, Lucca is unplugged, Keystone keeps the dates and a simple type only), NEW-CURSUS-5 "c" (hours per Keystone
task — proposal only, see §3.2), NEW-CURSUS-7 "a" (Cursus pushes, and re-sends after a failure).

## 1. Two directions

| Direction | What | Where in Keystone |
|---|---|---|
| Keystone → Cursus (exists) | `GET /api/integrations/keystone/chantiers/:id/go-no-go`, `POST /api/integrations/keystone/demandes` with header `X-Api-Key: <CURSUS_API_KEY>` (Cursus's `KEYSTONE_API_KEY`) | `connector.ts` |
| Keystone → Cursus (**new, proposal**) | `GET /api/integrations/keystone/annuaire` — the staff directory (§4) | `connector.ts` `listDirectory` |
| Cursus → Keystone (**new, proposal**) | `POST /api/integrations/cursus/events` — validated hours, absences, Go / No Go changes, travel-request decisions (§2, §3) | `events.ts`, `inbox.ts` |

The two keys are **different secrets**: Keystone presents `CURSUS_API_KEY` to Cursus; Cursus presents `CURSUS_EVENTS_KEY` to
Keystone. Neither side ever accepts the other's key.

## 2. Events endpoint: `POST /api/integrations/cursus/events`

| Item | Rule |
|---|---|
| URL | `<Keystone base URL>/api/integrations/cursus/events` (no session, no cookie: server to server) |
| Authentication | Header `X-Api-Key: <CURSUS_EVENTS_KEY>` (compared in constant time). **PLACEHOLDER:** the scheme may change with the hosting choice (I-1a). |
| Keys per environment | Outside production Keystone accepts the demo key `demo-cursus-events` by default. Production refuses the demo key (start-up error) and, while no key is configured, answers **503** to every call. Minimum 16 characters. |
| Format | JSON, UTF-8, `content-type: application/json`; one event per call. Timestamps ISO 8601 with an offset or `Z`; dates `YYYY-MM-DD`. |
| Size | At most **256 KB** per call (413 above). |
| Rate | At most 600 calls a minute from one address (per Keystone server process); above it **429** with `Retry-After`. |
| Transport | HTTPS only once hosted (I-1a). |

### 2.1 Envelope

```json
{ "id": "evt-2026-10-05-000123", "type": "heures.validees", "emis_le": "2026-10-05T08:30:00+02:00", "data": { … } }
```

| Field | Rule |
|---|---|
| `id` | Cursus's unique event id, 1–200 characters (letters, digits, `. _ : @ -`). **The idempotency key**: the same id sent again is answered as a duplicate and changes nothing. |
| `type` | The event type (§3). An unknown type is accepted (200, status `ignored`) and its data is not kept, so Cursus can add types first. |
| `emis_le` | When Cursus emitted the event. Orders the events of one replacement key (§2.3). |
| `data` | The event's content (§3). |

### 2.2 Answers

| Code | Body | Meaning for Cursus |
|---|---|---|
| 200 | `{ "ok": true, "id": "…", "status": "received" \| "unresolved" \| "ignored" \| "error" }` | Stored. Done: never re-send it. `unresolved` = kept until Keystone knows the person or the site (replayed later by Keystone); `error` = stored, its processing failed and is replayed by Keystone. |
| 200 | `{ "ok": true, "id": "…", "duplicate": true }` | Already received (same `id`). Done. |
| 400 | `{ "ok": false, "error": "Invalid absence.validee · start: must be a date" }` | Not JSON or not a valid event. **Do not retry as is**: fix the event (the reason names the field, never the value). |
| 401 | `{ "ok": false, "error": "Invalid API key" }` | Missing or wrong key. Do not retry until the key is fixed. |
| 413 | `{ "ok": false, "error": "Event too large (256 KB at most)" }` | Do not retry as is. |
| 429 | `{ "ok": false, "error": "Too many requests" }` + `Retry-After` | **Retry** after the given seconds. |
| 503 | `{ "ok": false, "error": "…" }` + `Retry-After: 60` | **Retry** later: no key configured, the Cursus connector disabled by EPC2i's IT (D-7a), or Keystone's database unavailable. |
| Network error / time-out / other 5xx | — | **Retry** with a growing delay (NEW-CURSUS-7 "a": Cursus keeps the event until a 200). |

Retrying is always safe: the event id makes a re-sent event a duplicate.

### 2.3 Replacement keys

| Type | Key | Rule |
|---|---|---|
| `heures.validees` | `matricule` + `semaine` | A corrected week replaces the week already received (no duplicate). |
| `absence.validee` | Cursus's absence `id`; else `matricule` + `start` + `end` | A corrected absence replaces the previous one. **Without an `id` a corrected absence with new dates cannot replace the old one** (PLACEHOLDER §5). |

The event with the latest `emis_le` wins: an older event of the same key arriving late is stored as `ignored`.

## 3. Event types

### 3.1 `absence.validee` — **PLACEHOLDER: the payload is not documented on Keystone's side (R-031)**

```json
{ "matricule": "EMP-0018", "start": "2026-11-09", "end": "2026-11-13", "nature": "CP", "id": "ABS-9" }
```

| Field | Rule |
|---|---|
| `matricule` | Cursus employee id (letters, digits, `. _ -`, ≤ 64). |
| `start`, `end` | Inclusive dates (`debut` / `fin` accepted too); `end` ≥ `start`; at most 400 days. |
| `nature` | Reduced **at reception** to one of two types — Leave (paid leave CP, RTT) or Absence (anything else) — and **never stored** (NEW-CURSUS-4, GDPR R-173). Keystone recognises `CP`, `RTT`, `conge(s)`, `conges payes`, `leave`, `paid leave` as Leave; please confirm Cursus's codes. |
| `id` | Cursus's absence id (recommended: the replacement key). |

Keystone writes one row per week the absence covers on the Leave & working calendar; a week's days are its weekdays inside the
absence minus the public holidays of Keystone's Settings. Whole days only (half days: §5). A matricule no Keystone person
carries yet is kept `unresolved` and replayed after each staff-directory import (§4).

### 3.2 `heures.validees` — stored, **not applied** (the Cursus timesheet link awaits EPC2i's confirmation, R-030)

```json
{ "matricule": "EMP-0018", "semaine": "2026-W40", "projets": { "HLT-026": 32, "NDC-031": 3 },
  "lignes": [{ "projet": "HLT-026", "activite": "A-120", "heures": 12, "date": "2026-09-29" }] }
```

`semaine` is an ISO week (`2026-W40`) or the week's Monday; hours 0–168. `lignes` is the **PLACEHOLDER** per-task proposal
of NEW-CURSUS-5 "c" (Cursus proposes the lines from Keystone's tasks and joins their id); lines without a task stay at
project level. Project codes are Keystone's codes until NEW-SYS-1 / R-022 (§5).

### 3.3 `verdict.modifie`

```json
{ "chantier": "K-2614" }
```

A site's people Go / No Go changed. Keystone finds the project whose site sheet carries that Cursus site and reads its
go-no-go again at once (`GET …/chantiers/:id/go-no-go`). No site sheet linked yet (R-028) → `unresolved`.

### 3.4 `demande.decision`

```json
{ "demande": 12, "statut": "VALIDEE" }
```

A decision on a travel request Keystone sent. Stored only for now (Keystone sends no travel request yet).

## 4. Staff directory: `GET /api/integrations/keystone/annuaire` — **PLACEHOLDER (R-027, NEW-CURSUS-2 "a")**

Cursus needs a new access for it. Keystone proposes, with the same `X-Api-Key` as the other Keystone routes of Cursus:

```json
[{ "matricule": "EMP-0018", "nom": "Wagner", "prenom": "Julien", "email": "julien.wagner@epc2i.fr", "equipe": "Engineering" }]
```

- The whole directory in one answer (or tell us the paging you prefer); EPC2i employees only (temporary staff included:
  they may have no Microsoft account).
- `email`: the work e-mail, when there is one. `equipe`: the team's name (Keystone maps it to a department only when the
  names are exactly equal) — or tell us the team codes you use.
- Keystone reads it once a day and on "Sync now", once EPC2i switches it on (`CURSUS_DIRECTORY=on`). It matches by
  matricule, else by work e-mail; creates the persons it does not know (never a user account: Microsoft Entra ID gives them
  at sign-in); never deletes anyone; never changes a name or an e-mail typed in Keystone.

## 5. Open points (to agree with the Cursus team)

| Point | Question |
|---|---|
| Project identifier | Keystone sends and expects its own project codes (`HLT-026`) until EPC2i settles the shared project key (NEW-SYS-1 / R-022). |
| Absence codes and id | The `absence.validee` field names, the nature codes, and whether every absence has an id. |
| Cancelled absence | No event removes an absence yet: propose `absence.annulee { id }` (or an empty range) so a cancelled absence stops lowering availability. |
| Half days | Keystone stores whole days per week; half-day leave cannot be represented yet. |
| Authentication | The `X-Api-Key` header is provisional (both directions). |
| Event log replay | How far back Cursus re-sends after an outage (Keystone keeps received events 13 months). |
| Directory endpoint | Route, field names, team codes, paging. |
