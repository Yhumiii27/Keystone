# Delivery 8 — lot "connectors" notes

Items: R-023, R-024, R-025, R-096, R-015 (deliveries, invoices and the dormant Vigie hooks), R-027, R-029, R-031, R-173
(`docs/RESTE-A-DEVELOPPER.md`). Owner answers applied: V-2 "a", V-3a "a", V-3b "a", NEW-D4-1 "a", NEW-VIGIE-1 "a", NEW-D4-3 "a",
SC-3b "a", X-6a / X-6b (Keystone bell only), NEW-CURSUS-2 "a", NEW-CURSUS-4 "a", NEW-CURSUS-5 "c" (proposal only),
NEW-CURSUS-7 "a", R-1 "a". French texts: `src/i18n/extra/d8-connectors.json` only (no prototype key overridden).

Contract documents for the sibling teams (proposals; Keystone never modifies Vigie or Cursus):
`docs/integrations/vigie-contract.md` (R-023, R-024, R-025, R-096) and `docs/integrations/cursus-contract.md` (R-027, R-029,
R-031).

Migrations (in this order):

| File | Kind | Content |
|---|---|---|
| `drizzle/0016_worried_spyke.sql` | generated (`npm run db:generate`) | table `cursus_events` (event id unique, indexes on (type, replace_key), status, received_at); `persons.matricule` (text, unique, nullable), `persons.directory_team`, `persons.directory_synced_at`; `leave_entries.source` default `'cursus'` |
| `drizzle/0017_leave_types_simple.sql` | custom (`npx drizzle-kit generate --custom --name leave_types_simple`) | a database that already has leave types gets `leave` / `absence`, its entries mapped (CP, RTT → leave; anything else → absence; days unchanged), the old types deleted; a new database (no leave type yet) is left to the seed |

No seed backfill (the custom migration maps existing databases); the `connectors` marker of `src/server/db/seed/index.ts` stays
empty. The migration test finds the custom file by name (`NNNN_leave_types_simple.sql`), so renumbering does not break it.

## 1. What changed, per item

### R-023 — Vigie connector, Keystone side (V-2 "a", V-3a "a") — partly buildable, stays en_cours

- `upsertMirror` (`vigie/mirror.ts`) and `upsertNcrMirror` (`vigie/quality-mirror.ts`): a full refresh deletes a row Vigie no
  longer lists only when it has no undelivered progress — `NOT EXISTS (… sync_status <> 'sent')` inside the DELETE, so a
  progress entry recorded concurrently on PostgreSQL is never cascade-deleted between a check and the delete. Delivered
  entries still cascade with their row (history behind `ncrVerificationDecidedCount` is lost if Vigie drops closed records:
  the contract asks Vigie to keep closed records listed).
- `NCR_NUMBER` (`src/features/quality/actions.ts`, that constant only): accepts `NCR-029` and Vigie's own numbers
  (`EV-2026-130`): letters, then 1–4 dash-separated groups of letters and digits. `VigieNcrRecord.number` comment says it is
  Vigie's number.
- `docs/integrations/vigie-contract.md`: lists (`GET /api/ecos|ncrs|hse?source=keystone`), progress
  (`POST /api/ecos/:number/progress`, `/api/ncrs/:project/:number/progress`), record fields, `keystoneId` idempotency, `{ id }`
  answer, provisional `X-Api-Key`, closed records stay listed, project key section "waiting for NEW-SYS-1 / R-022".
- Not buildable: the real endpoints, the project mapping (R-022), removing the `TODO(vigie)` markers, end-to-end checks.

### R-024 — ECO section of the Vigie contract (NEW-D4-1 "a", NEW-VIGIE-1 "a") — documentation only, stays en_cours

- Contract §2.1 / §3.1 / §4.1: routes `/modifications-techniques`, `/<ECO number>`, `/nouvelle?part&project&title&source=keystone`,
  register filters `part` / `project` (English names as agreed), `VigieEcoRecord` fields, statuses, approval keys (englead,
  quality, pm — the director holds none), progress body answered by `{ id }`, refresh at most once a minute with full-refresh
  semantics. Placeholders: authentication (V-3), project id (NEW-SYS-1), progress on an ECO no longer listed, the optional
  claim-number parameter (not agreed), long free-text titles, a stable actor id / e-mail (Entra), `partStatusChanges` (R-102).
- `links.ts`: the five "OPEN QUESTION V-1" markers replaced by "agreed by NEW-D4-1 'a'"; describe title renamed in
  `delivery4-writes.test.ts`. No URL changes.

### R-025 — project filter on Vigie lists (V-3b "a") — Keystone half, stays en_cours

- One helper `vigieProjectParam` in `links.ts` (the later NEW-SYS-1 mapping changes one place); `vigieNcrListUrl`,
  `vigieHseListUrl`, `vigieCoactivityUrl` take `{ projectCode }` → `projet=<code>`; the fallback list links of `vigieHseUrl`
  too (a record opened by its own id needs none). `quality-mirror.ts` passes `r.projectCode`; `site/model.ts` passes `code`
  (that call only). V-3 comments reworded, not deleted. No new button.

### R-096 — rejected receipt: prefilled Vigie supplier NCR and buyer alert (NEW-D4-3 "a", SC-3b "a", V-3b "a")

- `vigieReportNcrUrl` gains `fournisseur`, `code_fournisseur`, `commande`, `reception`, `quantite` (V-3 proposal; empty values
  dropped). `ReceiptRow.supplierCode` = `suppliers.x3_code` (null until the Sage supplier file, NEW-D4-4).
- Deliveries drawer, under "Quality check": one "Declare the supplier NCR in Vigie" link per line with rejected units of a
  Rejected / Partially rejected receipt ("· <ref> × <qty>" when several), `VIGIE_LINK_ATTRS`; internal viewers only (the page
  passes `vigieLinks` for every role but the client). Nothing is recorded in Keystone, no NC echo (V-3).
- Bell notice after the decision commits (`decide()` in `src/features/deliveries/actions.ts`: row Reject, drawer Reject,
  Partial rejection and the My approvals inbox): rules in `src/domain/receipt-notices.ts`, reader/sender in
  `src/server/dal/receipt-notices.ts` (no change to `decideReceipt`'s return type). Buyer = submitted by → created by → RFQ
  owner, first with an active account; the actor removed at every step (buyer = actor → nobody stands in); no buyer with an
  account → the procurement users minus the actor (`toPersonIds`, never `audience`); plus the project's leads. Title
  "Delivery rejected at receipt", sub `BL-… · PO-… · <supplier> · × <n>`, screen `deliveries`, params `{ receipt }`.
  Best effort: a failure is logged and never undoes the QC; a failed read of the invoices before the decision only loses
  the invoice notice (the rejection is still told).
- Toast on the Deliveries screen: `BL-… · Rejected · 2 rejected · declare the supplier NCR in Vigie` (FR rule for
  "<n> rejected"); the English inbox path keeps the neutral message.

### R-015 — notices (X-6a), connectors part — partly buildable, stays en_cours

- Invoice blocked: in the same `decide()` path, the invoices of the receipt or its PO are read before and after the decision;
  each one turning `awaiting_receipt` → `blocked` notifies the buyer chain (else procurement) plus the director-role users
  (prototype n8), actor removed; kind `invoice`, title "Invoice blocked by the 3-way match".
- Dormant Vigie hooks (only in `refreshFromVigie` of the HTTP connectors, diff read in the refresh's transaction and returned
  from it, notified after the commit; never in `upsertMirror` / `upsertNcrMirror`, which the seed calls):
  "Non-conformity raised in Vigie" → project leads + quality / englead referents of the project team (else the leads);
  "Change order waiting for your approval" → holders of each pending key (pm → leads of the affected projects; quality /
  englead → users holding the role). Shared helpers in `src/server/dal/person-notices.ts` (active accounts, roles, leads,
  referents, `notifyPersonIds`).
- KPI alerts deferred (S-4 / R-013); CR, mention and task events belong to cost-change and work-planning.

### R-027 — Cursus staff directory, Keystone half, dormant (NEW-CURSUS-2 "a") — partly buildable

- Pure matching `src/domain/directory.ts` (`planDirectoryImport`): matricule first, else the lower-case work e-mail among
  EPC2i persons (no client organisation); an e-mail held by several persons, by an external contact or by a person with
  another matricule matches nobody and is reported; no match → a new person "Prénom Nom", short name "P. Nom" made unique
  ("J. Wagner (2)"), initials; an existing short name, full name or e-mail is never overwritten (missing ones filled in);
  team → department only on an exact name, else kept in `directory_team`; nothing deleted.
- Writer `importStaffDirectory` (`src/server/dal/persons-directory.ts`): one transaction, audit per created / changed person
  (actor "Cursus", area Integrations, matricule only — no name or e-mail from the directory in audit or logs), one activity
  event, never a user account or a role.
- Connector `listDirectory()` (`cursus/types.ts`, `connector.ts`): `GET /api/integrations/keystone/annuaire` with `X-Api-Key`,
  `TODO(cursus)`; the mock returns nothing.
- Switch `CURSUS_DIRECTORY=on` (default off) in `parse.ts` / `.env.example`. Daily job `cursus-directory` (under the
  connectors marker; nothing while off, disabled by IT or simulated) and the Cursus row's "Sync now" run
  `runDirectoryImport`, which then replays the Cursus events left unresolved for want of a matricule. "Sync now" now imports
  the directory **before** refreshing the sites, so the refresh already names the people it imported.
- Mapping used: the go-no-go refresh names a matricule from `persons` first; `upsertClearances` sets `person_id` by
  matricule. Clearance names: a row keeps the name it was first stored under (reminders and the unique (project, name) key
  use it) — **except a placeholder name equal to its matricule** ("EMP-0018"), which takes the directory's name once known,
  unless another row of the project already has it; the reminders recorded under the placeholder follow
  (`keptClearanceName`). This reconciles the brief's two statements (never rename / change the mirror.ts:22 rule).

### R-029 — endpoint for the events Cursus pushes (NEW-CURSUS-7 "a")

- `POST /api/integrations/cursus/events` (`src/app/api/integrations/cursus/events/route.ts` → `cursus/events.ts`): no viewer,
  no same-origin check; checks in order 429 (bucket `events`, 600 / min per client address) → 503 without a configured key →
  401 (`X-Api-Key` compared in constant time on SHA-256 digests) → 413 (> 256 KB, declared or streamed) → 400 (not JSON / not
  a valid event) → 503 + `Retry-After: 60` when IT disabled the Cursus connector or the database fails → 200
  `{ ok, id, status }` or `{ ok, id, duplicate: true }`. `Cache-Control: no-store`; no answer echoes the key or the body.
- `isPublicPath` exempts exactly this path (`INBOUND_API_PATHS` in `src/domain/auth.ts`), tests in `auth.test.ts` and
  `proxy.test.ts` (Entra mode without a session reaches the route; the key is still required).
- `CURSUS_EVENTS_KEY` (secret, ≥ 16 chars): outside production the demo key `demo-cursus-events` by default; production
  refuses the demo key (start-up error) and, without a key, the endpoint answers 503 to every call. Never `CURSUS_API_KEY`.
- Envelope `{ id, type, emis_le, data }` (zod, `src/domain/cursus-events.ts`): `heures.validees` (matricule, week, hours per
  project, optional `lignes[]` proposal for NEW-CURSUS-5 "c"), `absence.validee` (provisional), `verdict.modifie`,
  `demande.decision` (only `demande` and `statut` kept); unknown types accepted and ignored, their data dropped.
- Inbox `cursus_events` (`cursus/inbox.ts`): event id unique (duplicate → 200, nothing written or audited); replacement keys
  `<matricule>|<semaine>` and the absence id (else `<matricule>|<start>|<end>`) — the latest `emis_le` wins, an older one is
  stored `ignored`; statuses received / unresolved / ignored / error; one audit row per new event (actor "Cursus", area
  Integrations); no activity event (about people, R-173). Dispatch: hours stored, never applied (R-030 awaits the owner);
  absences → R-031 writer when the matricule resolves (persons.matricule, else the Cursus mirror's person), else
  `unresolved`; verdicts → the project whose site sheet carries the Cursus site, refreshed at once in HTTP mode
  (`refreshCursusSiteNow`, bypassing the one-minute throttle, sharing an in-flight refresh), recorded only with the mock,
  `unresolved` without a linked site; request decisions stored only. `replayUnresolvedCursusEvents` replays unresolved and
  failed absence / verdict events (after a directory import).
- Activity & integrations, Cursus row: "… · Last Cursus event · 15 Oct 09:15 · Unresolved events · 2" (FR segments in the
  d8 file). Daily job `cursus-events-purge` deletes events received more than 13 months ago.
- `docs/integrations/cursus-contract.md` for the Cursus team (path, header, envelope, idempotency and replacement keys, codes,
  retries, directory endpoint, open points).

### R-031 — absences from Cursus, Lucca unplugged (NEW-CURSUS-4 "a", NEW-CURSUS-7 "a", R-1 "a") — partly buildable

- Two leave types (`codes.ts` `LeaveType = 'leave' | 'absence'`, `leaveTypeOfNature`; `LEAVE_TYPE_ROWS` in
  `src/domain/absences.ts`) in both seeds (`seedResourceReference` is shared by the demo and production seeds) and the custom
  migration. The demo seed maps the prototype's CP / RTT weeks to Leave and Sick / Training to Absence, days unchanged.
- Writer `replaceCursusAbsence` (`src/server/dal/hr.ts`, after `getLeaveCalendar`): replaces the rows of the absence's key,
  one row per week covered, source `cursus`, days = weekdays inside the range minus the Settings public holidays; runs in the
  inbox transaction. Pure splitting in `absenceWeeks` (whole days; > 400 days refused). The nature is reduced to the type at
  parsing and never stored. `absenceOverlapsRotation` is provided for R-119 (site-quality).
- `getLeaveCalendar` adds up several rows of a person's week (at most 5 days); the cell shows the type with the most days
  (Leave on a tie); `lastAbsenceReceivedAt` from the inbox.
- Leave screen: "Sync Lucca" removed (button, Server Function, form, parser and their tests, citing NEW-CURSUS-7); first tile
  "Cursus" = the last absence received (date) or "—" with "None received yet"; "Approved in Cursus", subtitle "Received from
  Cursus · …", hint "Leave is requested and approved in Cursus". Lucca → Cursus in `shell.ts` STATIC_EXTRA (leave line only)
  and the Settings holidays card sub (`domain/admin.ts`, that line only). Hours texts, the Skills certifications tile, the
  site collision subtitle, the seeded n10 notification and the "Imported 312 h" activity are left alone.

### R-173 — GDPR, buildable part — stays en_cours

- Leave display and export minimised to Leave / Absence: `LeaveLabel`, `LeaveCellTone` (`absence` replaces `sick`, CSS class
  `cellAbsence`), legend "Leave · paid leave or RTT" / "Absence · any other absence", FR strings « Maladie » removed from
  `features/hr/i18n.ts`; export cells "Leave · 5 d" / "Absence · 2 d", the "Leave types" sheet lists the two types (code,
  type; no days column). Days, hours and KPIs unchanged. Stored data minimised too (two types in both seeds, nature never
  stored, inbox data minimised).
- Start-up warning (`parse.ts`, next to the ANTHROPIC block) when `ANTHROPIC_API_KEY` is set and Claude analysis is on, in
  production or with `KEYSTONE_SEED=production`: transcripts go to Anthropic, the sub-processing agreement must be signed.
  Documented in `.env.example`. No retention purge (DPO).

## 2. Defaults chosen (owner to confirm)

| Point | Default built |
|---|---|
| R-023 pruning | rows with undelivered progress kept; rejected entries stay "failed", no auto-abandon; X-Api-Key until V-3 |
| R-024 / R-025 project id | Keystone project code (`projet` / `project`) until NEW-SYS-1 |
| R-096 buyer | submitted by → created by → RFQ owner (active account); actor never told, nobody stands in for an acting buyer; else procurement users |
| R-096 link visibility | every internal viewer of Deliveries (not only the QC deciders) |
| R-096 notice sub | `× <n>` (language-neutral: the sub-line is typed text, shown as typed) instead of "<n> rejected" |
| R-015 recipients | rejection: buyer slot + leads; invoice blocked: buyer slot + directors; NCR raised: leads + quality / englead referents; ECO to approve: pm key → leads of the affected projects, quality / englead keys → role holders |
| R-027 matching | matricule, then work e-mail; ambiguous / external e-mail reported; new persons created; never deleted; team → department on exact name only; placeholder clearance names upgraded |
| R-027 Sync now | directory first, then the sites |
| R-029 key in production | not configured → 503 at the endpoint (no start-up error, so Keystone starts without Cursus); demo key → start-up error |
| R-029 ordering | latest `emis_le` wins per replacement key; an older event is stored `ignored` |
| R-029 rate limit | 600 calls / minute / client address, per process |
| R-031 types | CP, RTT, "congé(s) payé(s)", leave → Leave; everything else (sick, training…) → Absence |
| R-031 week cell | several absences of a week add up (≤ 5 days); label = the type with most days, Leave on a tie |
| R-173 AI reminder | warning at every start while the key is set and AI on, in production or with the production seed |

## 3. Displayed values, old → new (seed)

| Where | Old | New |
|---|---|---|
| Leave & calendar, first tile | Lucca sync · 06:30 · Today · leave, RTT, sick, training | Cursus · — · None received yet (a date once an absence arrives) |
| Leave cells | CP / RTT / Sick / Training (Training in the leave tone) | Leave (FR « Congés ») / Absence; every Absence in the former sick-leave look |
| Leave legend | CP · paid leave, RTT · …, Sick · sick leave, Training, Hol. | Leave · paid leave or RTT, Absence · any other absence, Hol. · public holiday |
| Leave KPIs | 85 %, 43 d, 0 | unchanged; "Approved in Lucca" → "Approved in Cursus" |
| Leave header | "Sync Lucca" primary | no primary action; crumb extra "Lucca" → "Cursus" |
| Settings › Public holidays card | … Lucca stays the source for leave | … Cursus is the source for leave (golden overridden in `domain/admin.test.ts`, `features/admin/model.test.ts`, citing R-031) |
| Leave export | "CP · 5 d"; Leave types sheet: 4 rows with days | "Leave · 5 d"; 2 rows (code, type) |
| Deliveries › BL-2026-0533 (Partially rejected) drawer | — | "Declare the supplier NCR in Vigie" link (internal viewers) |
| Rejection toast | `BL-2026-0521 · Rejected` | `BL-2026-0521 · Rejected · 2 rejected · declare the supplier NCR in Vigie` |
| Site › HSE "Manage in Vigie" and fallback links | `/prevention`, `/evenements?etat=tous&type=PA` | `…?projet=HLT-026` added |
| db-check | `leave_types: 4` | `leave_types: 2`, `cursus_events: 0` |

No notification is added to the seed (the notices fire on new decisions only; Fabien Bertrand is both the seeded buyer and
the procurement persona, so a rejection decided as procurement notifies only the leads — demos use the quality persona).

## 4. Tests

New: `src/domain/receipt-notices.test.ts`, `src/features/deliveries/notices-d8.test.ts` (every persona refused but the QC
deciders, recipients, actor exclusion incl. buyer = actor, inbox path, failure leaves the QC committed, drawer links and
render), `src/features/quality/ncr-number-d8.test.ts`, `src/server/integrations/vigie/links.test.ts`,
`src/server/integrations/vigie/refresh-d8.test.ts` (pruning with undelivered entries + redelivery, dormant hooks with a stubbed
fetch, no second notice), `src/domain/directory.test.ts`, `src/server/dal/persons-directory.test.ts` (writer, switch, mock,
disabled connector, job with a stubbed Cursus, replay, Sync now, placeholder names), `src/domain/cursus-events.test.ts`,
`src/domain/absences.test.ts`, `src/server/integrations/cursus/events.test.ts` (keys, production, sizes, validation, disabled
connector, rate limit, duplicates, replacement, dispatch, replay, purge job, Cursus row), `src/server/config/parse-connectors.test.ts`,
`src/server/db/leave-types-migration.test.ts`, `tests/e2e/d8-connectors.spec.ts` (one post, duplicate, wrong key, invalid,
Cursus row, Leave screen). Updated with the decision id: `domain/hr.test.ts`, `dal/delivery2.test.ts`, `features/hr/forms.test.ts`,
`actions.test.ts`, `hr.render.test.ts` (NEW-CURSUS-4 / -7), `domain/admin.test.ts`, `features/admin/model.test.ts` (R-031),
`domain/auth.test.ts`, `proxy.test.ts`, `domain/jobs.test.ts`, `features/deliveries/actions.test.ts`, `features/site/render.test.ts`,
`dal/delivery4-writes.test.ts`, `dal/delivery5-writes.test.ts`, `scripts/db-check.ts`.

## 5. Open questions for the owner

1. **R-023** — Refuse (or mark) new progress on a Vigie record Vigie no longer lists? Proposal in the contract: Vigie answers
   `410 Gone`, Keystone stops sending and shows it refused. Retry limit of the outboxes (DELIVERY-7 §8).
2. **R-096** — Who is "l'acheteur" (default: submitter → author → RFQ owner)? Should the Vigie link be limited to the QC
   deciders? Vigie's names for `fournisseur`, `code_fournisseur`, `commande`, `reception`, `quantite` (V-3).
3. **R-015** — Recipients above (leads + referents for a new NCR; leads of the affected projects for the PM key of an ECO).
4. **R-027** — Cursus's directory endpoint, fields, team codes and paging (`TODO(cursus)`); is matching by work e-mail
   acceptable; should a directory person absent from a later directory be flagged (never deleted today)? The production
   sign-in gap (persons with e-mails) remains until the directory is switched on.
5. **R-029** — The envelope and event ids are Keystone's proposal; hosting must let Cursus reach Keystone (I-1a); the rate
   limit is per process and keyed on `X-Forwarded-For` (forgeable without a TLS proxy: a forger could only slow Cursus down,
   never get an event accepted without the key).
6. **R-031** — `absence.validee` fields, nature codes, a mandatory absence id, a cancellation event (`absence.annulee`), half
   days (whole days only today). Is mapping training to "Absence" right? The Leave grid's weeks still come from the demo
   allocations (R-084 / R-085).
7. **R-173** — Who may see whose absences on Leave; retention durations; the register of processing and the DPAs (host,
   Anthropic). Should the AI reminder be acknowledgeable once the DPA is signed?
8. **R-030** — `heures.validees` is stored and never applied until the owner confirms the Cursus timesheet link.

## 6. Notes for the integrator

- **Migrations:** drop `0016_worried_spyke.sql` and `0017_leave_types_simple.sql` and their snapshots, regenerate in merge
  order: `npm run db:generate` (cursus_events, persons columns, leave_entries.source default), then
  `npx drizzle-kit generate --custom --name leave_types_simple` with the SQL of `0017_leave_types_simple.sql` unchanged.
- **Shared files touched:** `schema/organisation.ts` (persons `matricule`, `directory_team`, `directory_synced_at` — next to
  roles-rates-hr's `rate_role_id`); `codes.ts` (leave codecs + `leaveTypeOfNature`; `CursusEventStatus` next to the Cursus
  codes); `parse.ts` / `.env.example` (CURSUS_EVENTS_KEY, CURSUS_DIRECTORY next to the CURSUS block; AI/DPA warning next to
  ANTHROPIC) — platform-ops edits the same files; `request-guard.ts` (`events` bucket); `domain/auth.ts` (isPublicPath);
  `jobs.ts` / `definitions.ts` under the connectors markers; `dal/hr.ts` (leave functions only), `features/hr/actions.ts`,
  `forms.ts`, `primary-buttons.tsx`, `i18n.ts`, `hr.module.css` (`.cellSick` → `.cellAbsence`), `export/providers/resources.ts`
  (leave workbook only) — roles-rates-hr edits rates / hours / skills in the same files; `dal/shell.ts` (line STATIC_EXTRA
  leave only); `domain/admin.ts` (holidays card sub only); `dal/integrations.ts` (Cursus row and Sync now — docs-client-portfolio
  and work-planning edit other rows); `site/model.ts` (the `vigieHseListUrl` call only) and `site/render.test.ts`;
  `scripts/db-check.ts` (leave_types 2, cursus_events 0, the LEAVE check); `tests/e2e/run.ts` (one env line:
  `CURSUS_EVENTS_KEY`, needed by the e2e post — production refuses the demo key).
- **Route matrix (R-016):** add `POST /api/integrations/cursus/events` (no key → 401; production without CURSUS_EVENTS_KEY →
  503); a GET answers 405.
- **Notifications helper:** `src/server/dal/person-notices.ts` (`notifyPersonIds`, leads, referents, role holders) may overlap
  with the recipients helpers of cost-change (CR notices) and work-planning (mentions, tasks): unify after merge if they
  duplicate.
- **Dictionaries:** no prototype key overridden; `fr-dict.json` still holds the now-unused « Sick · arrêt maladie »,
  « Formation », « Synchro Lucca » entries (prototype copy, not edited).
- **Remaining-work page (suggestion):** R-096, R-029 → fait; R-023, R-027, R-031 → fait for their buildable Keystone half
  (plan §3 does not keep them en_cours; what waits on Vigie / Cursus is in §5 — the integrator may prefer en_cours); R-015,
  R-024, R-025, R-173 → en_cours by design (plan §3).
