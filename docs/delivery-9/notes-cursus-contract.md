# Delivery 9 — lot "cursus-contract" (R-031, R-084 absence part, R-029 alignment): Cursus's real contract

Cursus (EPC2i's HR app, owner of absences and timesheets) already sends events to Keystone, but to its own contract, which
Keystone did not accept: every event failed (wrong address, `Authorization: Bearer` refused, `donnees` unknown, `du` / `au`
refused). Cursus owns the data, so **Cursus's contract is authoritative**: Cursus `docs/API-KEYSTONE.md` (« Événements envoyés par
Cursus », « Verdict Go / No Go », « Demandes de déplacement », « Anciennes routes ») and `docs/keystone-openapi.json` (webhook
`evenement`, schemas `Evenement…`, `DemandeEntree`, `Motif`). The sender is Cursus `server/src/integrations/keystone.ts` and
`server/src/envois.ts`. Keystone's page is rewritten accordingly: `docs/integrations/cursus-contract.md` (no longer a proposal).

## 1. Inbound events (R-029, R-031)

| Change | Where |
|---|---|
| `POST /api/cursus/v1/evenements` — the address Cursus posts to — served by the same handler as `/api/integrations/cursus/events` (kept); both public in Entra mode (`INBOUND_API_PATHS`) | `src/app/api/cursus/v1/evenements/route.ts`, `src/domain/auth.ts` |
| Authentication: `Authorization: Bearer <CURSUS_EVENTS_KEY>` (Cursus's `KEYSTONE_TOKEN`) as well as `X-Api-Key`, same key, constant-time (`presentedKey`, `sameKey`) | `src/server/integrations/cursus/events.ts` |
| Envelope: `donnees` accepted as the alias of `data` (`donnees` wins) | `src/domain/cursus-events.ts` |
| `absence.validee`: `du` / `au` and `absence` (integer or string) read; key `cursus:<absence>` so a correction with new dates **replaces** the weeks written before (no stale week) | `src/domain/cursus-events.ts` |
| `absence.annulee`: new — removes the absence's `leave_entries` (source `cursus`, by key, whoever carries them); nothing to remove and no person for the matricule → `unresolved`, replayed like a validation; audited like any event (one row, actor "Cursus"; audit rows never touched) | `inbox.ts`, `removeCursusAbsence` (`src/server/dal/hr.ts`) |
| Validation and cancellation are **one object** (`sameObjectTypes`): an older event arriving after a newer one of the same absence is stored as `ignored` (Cursus's rule: apply only what is newer than the last applied — the HR department can resend an old failed event) | `inbox.ts` |
| `demande.decision`: Cursus's `decision` (`acceptee` / `refusee`) read, stored as `statut` (the earlier `statut` still read) | `src/domain/cursus-events.ts` |
| Success body: `accuse` = `"<status> · <event id>"` added to `{ ok, id, status }` and to the duplicate answer (Cursus keeps it and shows it to HR) | `events.ts` |
| Unknown types (`deplacement.modifie`, `deplacement.annule`) unchanged: 200, `ignored`, data not kept | — |
| Nature: Cursus never sends it → the absence is type **Absence**; a nature still sent by another sender is reduced to Leave / Absence and never stored (R-173). A half day arrives as the whole day (Cursus's rule). | documented in the contract page |

Keystone's earlier format (`data`, `start` / `end`, `debut` / `fin`, `id`, `X-Api-Key`, `statut`) keeps working; the only visible
difference for an old sender is the extra `accuse` field. The 400 message for missing dates now reads `du and au are required`.

## 2. Capacity (R-084, absence part)

Rule (`src/domain/planning-load.ts`): a person's capacity in a week = 40 h − 8 h (40 h ÷ 5) per day off that week, the days off
being those the Leave week view counts (`leaveWeekDays`: Leave or Absence on Monday–Friday, a Settings public holiday never a day
off, overlapping rows counted once) — `weekCapacityH`, `personWeekCapacities`, `capacityOf`. Every `leave_entries` row counts
(Cursus's and the seeded ones). Nothing else changes the 40 h base (no contractual hours are exposed by Cursus).

- `getPlanningLoad` returns `capacity` (persons with an absence in the weeks); the pool (`getResourcePool`, `getProjectTeam`)
  exposes `capacityH` per week and its `loads` are `loadPctOfHours(hours, capacity)`; `loadNextWeeks` too.
- A week entirely off (capacity 0) with hours assigned reads **100 % + the hours' share of 40 h** (52 h → 230 %): it stays
  over-allocated instead of dividing by zero; nothing assigned → 0 %.
- Week view: "hours / capacity" and "above capacity" use the person's capacity that week (`weekLoad(…, capacityH)`); the
  Resources export's week sheet now reads the schedule hours and the capacity (it re-derived hours from the % before).
- Project resources bars: a person with days off in the weeks shown brings their reduced capacity and their hours
  (`projectDepartmentDemand` `hoursH` / `capacityH`); everyone else keeps the prototype's rule (avg % × 40 h a week).
- What-if: a lever's hours move the load % on the person's capacity that week (`WhatIfPerson.capacityH`; 40 h when unknown or 0).
- Not changed: the departments' stored capacity (Resources "Capacity vs demand", `department_capacities`), Prioritisation's
  capacity model, team utilisation's rule (mean of the weekly %, the prototype's).

### Values on the demo data set (Fri 25 Sep 2026) — the capacity change, then the demo leave shifted (owner 22 Oct 2026)

The prototype's seeded leave (LEAVE) was never meant to meet the named demo assignments: once leave lowered capacity, six
people went above 110 % (a CP week with 52 h assigned read 231 %). **Owner's decision (22 Oct 2026), option 1: shift the demo
leave** — not the assignments, not the rule. `src/server/db/seed/demo-leave.ts` (`DEMO_LEAVE`) keeps the same people, types and
days on other weeks, chosen against the assigned hours per person-week: a full week of leave on a week with no hours assigned,
a day or two on a light week (at most 100 % left), never on a public holidays week; the prototype's `LEAVE` stays the golden
reference of the pure tests (`src/domain/hr.test.ts`, `resources.test.ts`).

| Person | Prototype LEAVE (assigned hours that week) | Demo leave (assigned hours) |
|---|---|---|
| Amélie Ollivier | CP 12 and 19 Oct (53 h, 43 h) | CP 7 and 14 Dec (0 h) |
| Thomas Kerbrat | CP 26 Oct and 2 Nov (30 h, 23 h) | CP 23 and 30 Nov (0 h) |
| Pauline Noguès | 3 training days 28 Sep (32 h) · CP 2 Nov (41 h) | 3 training days 11 Jan 2027 · CP 4 Jan 2027 (0 h) |
| Fabien Bertrand | CP 9 Nov (14 h; Wed 11 Nov a holiday) and 16 Nov (18 h) | CP 4 and 11 Jan 2027 (0 h) |
| Léa Marchand | RTT 5 Oct (29 h) and 16 Nov (33 h) | RTT 5 Oct (kept, 89 %) and 23 Nov (6 h) |
| Hélène Sauvage | 2 sick days 19 Oct (31 h) | 2 sick days 28 Sep (18 h, 73 %) |
| Julien Wagner | RTT 9 Nov (26 h) | kept (81 %; the site sheet's leave conflict) |

Older demo databases: a one-time backfill at the next open (`seedIfEmpty`, `shiftDemoLeave`), only while the database's seeded
leave (rows without a Cursus key) is still exactly the prototype's — Cursus's absences and an edited seed are never touched;
never on a production database (it has no seeded leave). Test: `src/server/db/seed/demo-leave.test.ts`.

| Where | Before the capacity change | Capacity change, prototype LEAVE | Demo leave shifted |
|---|---|---|---|
| Pool loads, window 21 Sep – 9 Nov | Amélie 106·100·100·131·106·106·106·85 · Pauline 69·79·…·102·105 · Thomas …·75·56·20 · Léa …·71·… · Hélène 44·44·… · Julien …·88·65 · Fabien …·49·35 | Amélie …·231·206·… · Pauline 69·197·…·202·105 · Thomas …·175·156·20 · Léa …·89·… · Hélène …·127·… · Julien …·88·81 · Fabien …·49·175 | Amélie 106·100·100·131·106·106·106·85 · Pauline 69·79·…·102·105 · Thomas …·75·56·20 · Léa …·**89**·… · Hélène 44·**73**·… · Julien …·88·**81** · Fabien …·49·35 |
| Resources (portfolio) KPIs | 83 % (84 % current window) · 3 people · peak weeks 42–44 | 98 % (97 %) · 6 people · weeks 40, 42–47 (40, 42–46) | **84 %** (**85 %**) · **3 people** · weeks **42–44** |
| Over-allocation alert (Home director, Portfolio) | "3 people over 110%" · Weeks 42–44 | "6 people over 110%" · Weeks 40, 42–46 · … and 3 more | **"3 people over 110%" · Weeks 42–44** |
| Home (head of engineering) | Team utilization 84 % · 3 people · Julien Wagner 102 % | 97 % · 6 people · 104 % | **85 %** · **3 people** · 104 % |
| Project resources HLT-026 | 83 % · 3 people · 34 h unmet · bars Site ops 521/640, Eng 320/320, MEP 354/320, C&P 720/960, Quality 240/320 | 98 % · 6 people · 147 h · 523/480, 319/312, 353/256, 720/872, 240/304 | **84 %** · **3 people** · **41 h** · **521/640, 319/312, 354/320, 719/952, 240/304**; suggestion A1260 peak +33 pts (+21) |
| Project resources NDC-031 / RCF-019 | 81 % · 1 person · 0 h / 6 h unmet | 96 % · 2 people · 57 h / 144 h | **81 % · 1 person · 0 h** (bars 314/320, 719/952) / **6 h** (326/320, 314/320, 240/304) |
| Project resources week view (12 Oct, HLT-026) | Σ capacity 40 h × team | Amélie Ollivier on leave: 40 h × (team − 1) | **40 h × team** |
| What-if HLT-026 | peak 131 % (Amélie, 12 Oct) · over 110 % [1,0,2,3,3,3,3,1] · A 17 levers, B 6 · "Protect people" 15 · weeks 42–45 · NDC-031 11 levers | peak 231 % · [1,1,2,3,4,4,4,2] · A 18, B 5 · 16 · weeks 43–45 · 13 | **as before the capacity change** (drafted requests 17) |
| Site HLT-026 conflicts | 7 | 9 (load conflicts of Amélie Ollivier and Thomas Kerbrat in their leave weeks) | **7** — the leave conflicts of Amélie Ollivier (7 → 18 Dec), Thomas Kerbrat (23 Nov → 4 Dec) and Julien Wagner (9 Nov); no one both on leave and overloaded the same week |
| Leave & calendar, 8 weeks from 28 Sep | 85 % availability · 43 leave days | (unchanged) | **97 % · 4 days** (Hélène 28 Sep, Léa 5 Oct, Julien 9 Nov); the 43 days over 28 Sep 2026 – 15 Jan 2027 |
| My work, Hélène Sauvage · RQ-042 impact | load next 2 weeks 46 % · "Hélène at 44% w/c 28 Sep → 64%" | (unchanged) | **61 %** · **"73% → 93%"** (her 2 sick days, 24 h capacity) |
| Unchanged | departments' capacity vs demand, Prioritisation, Capacity what-if WSA-044 (239 h), unmet demand of the portfolio (80 h / 102 h) | | |

Golden tests and `scripts/db-check.ts` expectations updated with a comment citing "R-084 (absences), demo leave shifted (owner
22 Oct 2026)". A leave week of a person who is also on site still shows a "Leave" conflict (the absence during the mission).

## 3. Outbound calls (Cursus API v1)

| Call | Before | After |
|---|---|---|
| Go / No Go | `GET /api/integrations/keystone/chantiers/{id}/go-no-go` (deprecated) | `GET /api/integrations/keystone/v1/chantiers/{id}/go-no-go`; reasons `{ code, niveau, libelle? }` (the note shows the label, else the code; a bare code still read) |
| Travel request | `POST /api/integrations/keystone/demandes` `{ matricule, chantier, destination, depart, retour }` → `{ id }` | `POST …/v1/demandes` with **`reference`** = Keystone's request id (required, unique); `201 { resultat, demande: { id } }` → `demande.id`; **409 `DEMANDE_EN_DOUBLE`** = already received → delivered with that id; other refusals → failed with Cursus's status and code |
| Staff directory | `GET /api/integrations/keystone/annuaire` | unchanged (Keystone's proposal; **Cursus has no such route**, off by default) |

Header `X-Api-Key` unchanged. The mock connector is unchanged.

## 4. Configuration (no new variable)

`CURSUS_EVENTS_KEY` is the token Cursus sends. For IT, on Cursus's side: `KEYSTONE_URL` = Keystone's base URL (no path),
`KEYSTONE_TOKEN` = the value of `CURSUS_EVENTS_KEY` (`.env.example`, `docs/EXPLOITATION.md` § 4 and § 10).

## 5. Gaps found on Cursus's side — requests to Cursus (not fixed here; Keystone never modifies Cursus)

1. **No staff directory route** (`/annuaire`): R-027 cannot run; a route or another source of matricule / name / e-mail / team is needed.
2. **No `pub_absences` view**: Cursus is not on the shared EPC2I PostgreSQL server (no PostgreSQL schema, no `pub_` views merged);
   Keystone depends on the events alone and cannot re-sync absences after a failed event.
3. **No contractual hours / part time exposed**: capacity stays 40 h a week less the absence days.
4. **Nothing in Cursus reads Keystone's `pub_taches_jours`** (planned hours per day): Cursus takes them by `PUT /v1/taches`.
5. **`server/src/actions/sorties.ts:71`** sends `absence.annulee` at an employee's exit with the default `EMP-xxxx` matricule
   (`absenceKeystone('absence.annulee', a)`) instead of `identifiantKeystone(…)`, unlike the other senders: after the switch to
   payroll matricules it would name an unknown matricule. Keystone copes (it removes the weeks by absence id) but the matricule
   should be consistent.

## 6. Tests

- `src/domain/cursus-events.test.ts`: `donnees`, `du` / `au`, the absence id (integer, string, `absence` over `id`), refusals,
  `absence.annulee`, `sameObjectTypes`, `decision`, `deplacement.*`.
- `src/server/integrations/cursus/events.test.ts`: both routes' `POST` with Bearer and X-Api-Key, refusals (other scheme, wrong
  token), duplicate with the same `accuse`; absence validated → corrected (weeks replaced) → cancelled (weeks removed) → an older
  event resent (ignored); cancellation unresolved then replayed; `demande.decision`; `deplacement.modifie` ignored.
- `src/domain/planning-load.test.ts`: `weekCapacityH`, `personWeekCapacities`, `capacityOf`, `loadPctOfHours` at capacity 0.
- `src/server/dal/planning-load.test.ts`: a Cursus absence lowers Damien Roux's capacity (36 h on 24 h → 150 %), removed → 90 %.
- `src/server/dal/delivery5-writes.test.ts`, `src/server/jobs/jobs.test.ts`, `src/server/dal/persons-directory.test.ts`: v1 paths,
  `reference`, 409 `DEMANDE_EN_DOUBLE`, refusal code.
- `src/domain/auth.test.ts`, `src/proxy.test.ts`: the new public path (exact path only), Bearer refused with a wrong key.
