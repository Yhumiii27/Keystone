# Delivery 8 — lot audit-i18n-shell notes: append-only audit trail, French completeness, portfolio search, sidebar, day offsets, « Transfert »

Scope: `docs/DELIVERY-8-PLAN.md` §1, lot **audit-i18n-shell** — R-168, R-184, R-052, R-151, R-167, R-156, with the defaults of §2.
Branch `worktree-wf_658afd14-150-1`, forked from `main-2a2fep` at `e41c309`. This lot merges first: its trigger, its completeness
test and its dictionaries test then guard every later merge (§5).

| Commit | Items |
|---|---|
| `23accc1` | R-167, R-151 |
| `e79d2bc` | R-156 |
| `ff8b993` | R-052 (+ the R-149 `deepLink` fix for task notifications) |
| `1f8d47b` | R-184 — completeness guard, dictionaries test, missing translations |
| `5ae762f` | R-168, R-184 — append-only audit trail, user, before / after, reason, system messages, French feed and trail |
| last commit | these notes, review fixes |

Migrations: one generated (`drizzle/0016_low_shen.sql`) and one custom (`drizzle/0017_audit_append_only.sql`), in that order (§6).
No new dependency. UI strings: English source strings, French only in `src/i18n/extra/d8-audit-i18n-shell.json`, except the three
R-156 edits of existing entries the brief names (`home.json`, `portfolio.json`, §5).

## 1. What changed per item

### R-168 — audit trail: user, before / after, reason, append-only (spec 11 §3.12)

**Schema** (`src/server/db/schema/platform.ts`, migration 0016)
- `audit_entries` gains `actor_user_id` (uuid, FK `users.id`, nullable, NO ACTION), `before` / `after` (jsonb), `reason` (text) and,
  for R-184, `message_key` (text) / `message_params` (jsonb).
- Its `project_id` FK is now NO ACTION (was ON DELETE SET NULL, which would have rewritten audit rows): a project with audit rows
  cannot be deleted. No code deletes projects.

**Append-only** (custom migration 0017, in this order)
1. Backfill: `actor_user_id` from `actor_person_id` through `users.person_id` (unique), for rows written before the migration (an
   existing data directory, the Mac app, a PostgreSQL server).
2. `audit_entries_append_only()` (plpgsql): raises `audit_entries is append-only: <op> refused` (SQLSTATE 23001, hint R-168).
3. Row trigger `audit_entries_no_update_delete` (BEFORE UPDATE OR DELETE) and statement trigger `audit_entries_no_truncate` (BEFORE
   TRUNCATE). `DROP TRIGGER IF EXISTS` first, so the file can be re-run.
- Tamper evidence, not tamper proof: the table owner or a superuser can disable the triggers or set `session_replication_role`. Real
  immutability needs a separate owner role and `REVOKE UPDATE, DELETE, TRUNCATE` from the application role — that waits for the
  hosting choice (I-1a).
- A data migration that must rewrite audit rows (GDPR purge R-173, a vocabulary rename) runs, as the table owner, inside ONE
  transaction: `ALTER TABLE audit_entries DISABLE TRIGGER audit_entries_no_update_delete; … ; ALTER TABLE audit_entries ENABLE TRIGGER
  audit_entries_no_update_delete;` (same for the TRUNCATE trigger).

**Writers** (`src/server/db/helpers.ts`)
- `AuditInput` gains `actorUserId?`, `before?`, `after?`, `reason?` and `message?` (R-184; then `change` is written from the
  message's English template).
- `writeAudit` resolves the user: explicit `actorUserId` (also `null`) wins; else the account of `actorPersonId`; else, unless the
  actor is a system (`isSystemActor`, `src/domain/audit-trail.ts`: System, Keystone, Lucca, Codex, Cursus, Vigie, Sage X3, SolidWorks
  PDM, PDM, MS Project, Microsoft Teams, Outlook / Exchange, E-mail (SMTP), IT · configuration file), the account of the person
  `findPerson(actorName)` finds. A person without an account and an unknown name get none.
- `reason` is trimmed (blank → null).
- The change text is unchanged where readers parse it (`kpis.ts:123` `'status: Draft → Open'` / `'RFQ sent to %'`,
  `quality.ts:468` `'status: Submitted → '`) — tested on the message templates.
- Filled by the writers this lot owns:
  - `trace` (`src/server/dal/ops-common.ts`) passes `before` / `after` / `reason` / the actor's `userId` and accepts messages for
    both rows;
  - `addAudit` (notifications.ts) passes the whole `AuditInput`;
  - sign-in (`src/server/dal/users.ts`): the sign-in row carries the signed-in user, and `before` / `after` of the roles and the
    department when they change (first sign-in: `after` only); the active-role switch `{ activeRole }` before / after; sign-out the
    user; a refused sign-in no user. `src/server/auth/routes.ts` needed no change: it calls these writers.
- The ~49 other writer files are not touched (§5: post-delivery sweep). Their rows get the user by person resolution.

**Seed** (`src/server/db/seed/platform.ts`): the 8 AUDIT rows carry the user of their actor at insert (on a fresh database the backfill
runs on an empty table before the seed, and the rows can no longer be updated).

**Readers**
- `listAudit` / `AuditRow` gain `userEmail` (join `users`), `reason`, `before`, `after`, `messageKey`, `messageParams`.
- `auditCsv` (`src/domain/admin.ts`, the ISO 9001 `audit.csv` route only) adds four columns after the prototype's six: User (e-mail),
  Reason, Before, After (compact JSON). `AUDIT_CSV_HEADERS` holds the ten EN titles; a header list of another length throws. CSV
  injection neutralisation covers the new cells.
- The screen table and the Activity & integrations export keep the prototype's columns.
- `src/features/procurement/model.test.ts` (A-12 average cycle): the test now inserts an earlier-dated "RFQ sent to …" row with
  `writeAudit({ occurredAt })` instead of updating the row createRfq wrote.

### R-184 — French completeness and system messages (NEW-D1-2, X-12b, R-148)

**A. Completeness guard** (`src/i18n/completeness.test.ts`, new)
- Scans `src` (outside comments, `src/server/prototype`, `src/app/dev`, `src/test`, tests and goldens) for `t('…')` / `t("…")`
  literals and `t(\`…\`)` templates.
- A template's `${…}` renders as each quoted option of a choice (`${n > 1 ? 'systems' : 'system'}` → both strings checked), nothing
  when it ends a word, else "2".
- A string passes when:
  - it has an exact French entry that **differs** from the English — the prototype's identity entries ("Action due": "Action due")
    are gaps;
  - or the first FR_RULES rule matching it changes it and keeps only values or French around it (`^Approved · (.+)$` leaving
    "flux capacitor" fails);
  - or every " · ", " — ", " → ", " / " segment passes;
  - or it — or a segment, or a reviewed word with a count ("2 sites", "FS 3") — is on `src/i18n/same-in-french.json`.
- `same-in-french.json` (113 reviewed strings: acronyms CPI, EAC, WBS, NCR…, cognates Article, Budget, Zone…, names Keystone, Le
  Havre) is checked: sorted, no duplicate, nothing that has a French entry, every entry still used.
- Translations added for what the scan found:
  - entries (d8 file): "Action due" (override, « Échéance de l’action »), "Client / sponsor" (override, « Client / commanditaire »),
    "Assigned", "Declared in Lucca", "Issue date", "Released on", "TF" (« MT », marge totale), "e.g. 15 Oct", "procurement";
  - FR_RULES appended in `src/i18n/fr-rules.ts` (after the prototype's rules; none of those matches these strings): "of N", "+N day",
    "N weekly snapshots", "N% drawn", "<amount> over", "level N", "N h assigned to …", "The file is larger than …", the plan-trash
    hint "… restored for N days, …".
- The scan does not see `t()` on variables (label tables, codecs): the guarantee is for literals.

**Dictionaries test** (`src/i18n/extra/dictionaries.test.ts`): every key of every dictionary (fr-dict.json and all extra files, not only
d7) has one French translation and no value is empty. Deliberate overrides of a fr-dict.json key are listed with their file and decision
(this lot: the six R-156 keys, "Action due", "Client / sponsor"); a second test checks each listed override is still one.

**B. System messages** (`src/domain/system-messages.ts`, new)
- Message key → English and French templates with typed parameters. Kinds:
  - `data` / `dataList`: typed text, shown with `dataText`;
  - `ref`: a reference, as is;
  - `label` / `labels`: Keystone vocabulary, through `t()`;
  - `count`: Intl number;
  - `date`: ISO day, Intl date.
- `plural` helper (French singular for 0 and 1).
- Keys: `audit.status` (`status: A → B`), `rfq.sent`, `signin.signedIn`, `signin.refused`, `signin.signedOut`, `signin.activeRole`.
- Stored parameters are data: `renderMessage` checks the key (own property) and every parameter's kind, and returns null otherwise —
  the reader then shows the stored text.
- `recordActivity` and `writeAudit` (and `trace`) accept `{ message }` in place of the text: they write the English text and the key
  with its parameters (`activity_events.message_key / message_params`, migration 0016).
- Converted writers: the sign-in rows only (users.ts). The other writers are converted after delivery 8 (plan §2).

**C. Readers render in the viewer's language** (`src/features/admin/i18n.ts`, used by `plumbingView` and the Activity & integrations
export)
- Activity (`activityWhatT`):
  - the message key;
  - else the demo's exact entry (12 seeded texts, French in d8);
  - else the connector texts Keystone writes (connector name as typed) — closes R-157 item 2:
    - "Vigie sync (simulated) · 2 sent · 0 pending · 1 refreshed" → « Synchro Vigie (simulée) · 2 envoyés · 0 en attente · 1 actualisé »;
    - "… · failed" → « … en échec »;
    - "Connector X added by IT · not connected yet";
  - else `fieldsText` (typed text as typed, only formatted values translated) — never `t()`.
- Audit change (`auditChangeT`):
  - the message key;
  - else the exact entry (seed);
  - else a connector run ("sync (simulated) · volume", "sync failed · error as typed");
  - else the generic shapes (`parseChange`, `src/domain/audit-trail.ts`):
    - "status: A → B": labels through `t()`;
    - "field: old → new": known field names in French; values through `t()` for label fields (stage, type, calendar, result,
      response, coverage), else as typed;
    - lone words: added, removed, enabled…;
    - anything else: exact entry, formatted value, or as typed.
- Audit object (`auditObjectT`): the exact entry ("Rate card", "Sign-in"); else a Keystone noun translated before its reference or
  typed name ("Request RQ-014" → « Demande RQ-014 », "Prerequisite · <typed>"); else `fieldsText`.
- Who: `dataText` (screen, and now the export too).
- French entries for the 8 seeded AUDIT texts where the shape does not cover them, plus "Accepted (PV)", "Rate card", and the CSV
  titles "User", "Before", "After".
- Notifications are not converted (plan).

### R-052 — portfolio-wide search (X-5 = portfolio)

`searchShell` (`src/server/dal/shell.ts`):
- Purchase orders, change requests, NCRs and risks are searched on **every** project the readers return. They are not limited to
  `hasData`, so wizard projects are included; activities keep their `hasData` rule.
- Reads:
  - `listAllPurchaseOrders`;
  - per-project `listChangeRequestDetails` / `listRisks` over the memoised `listProjects()`;
  - ONE Vigie `listNcrs({ projectCodes })` call, straight on the connector (severity and status labels from the codecs);
  - every read inside `safe()`.
- No reader was added to other modules' DAL files.
- Each hit opens its own project: `deepLink('orders' | 'changes' | 'risks', …, hit project)`, `ncrHref(hit project, number)`.
- The project code leads the sub-line ("HLT-026 · Ordered") and is in `subData` (R-148, shown as typed by `searchHitView`). This
  applies to every project-bound hit, the current project's included (§3).
- Within each kind: the current project's hits first, then register order (`currentFirst`); 3 per kind as before.
- Doc comments updated.

`searchShellClient`:
- The change requests of every project of the client's organisation (the `own` list from `clientRefusedProject`), each opening that
  project's Changes page, current project first, 3 at most.
- The rule is one shared predicate, `clientSeesChangeRequest` (`src/domain/client-visibility.ts`, new): today every CR of the project,
  as the Changes page.
- Still no PO, NCR, risk, part, person, ECO, drawing or activity, nothing of another organisation.
- The client's project hit now has `subData: [pm]` (the PM's typed name is no longer translated).

**R-149 fix built here** (shell.ts owner): `deepLink('task', { taskId })` puts the id in the path (`/my/tasks/T-2318`), never in the
query string. Other screens keep a `taskId` query parameter.

### R-151 — collapsed section keeps its group header (X-8 = always)

`buildSidebar` (`src/components/app/shell/nav-model.ts`): the group row is pushed before the first **shown** item of its group
(`shown.find((y) => y.def.group === g) === x`), so a collapsed Project section showing only Change control reads "Control › Change
control". Open, bright, badge and count are still computed over the group's gated items. Open sections are unchanged. Spec 01 §4.5 and its
open question 21 are annotated with X-8.

### R-167 — `isoOfDayOffset` for negative offsets

`src/server/db/codes.ts`: `const w = Math.floor(o / 5); … (w * 7 + (o - w * 5))` — the floored weekday remainder, as `dayDate`. Same
result for every o ≥ 0 (no seeded or golden value changes). `docs/DELIVERY-2.md` (open-points list) corrected: line reference
`codes.ts:310`, the callers (request DAL default start, meeting action-to-task writer, `nrDates` in the request dialog and its action,
seeders), fixed in delivery 8.

### R-156 — « Transfert » for the Handover step (NEW-D5-3 'a'; English unchanged)

- d8 file (overrides of fr-dict.json, listed in the dictionaries test):
  - "Handover" → « Transfert »;
  - "Forecast handover" → « Transfert prévu »;
  - the critical-path note → « … la date de transfert. »;
  - the steel-structure sentence → « … ; le transfert passe au 14 janv. 2027. »;
  - "Re-baseline BL2 — handover 14 Jan 2027" → « Nouvelle référence BL2 — transfert 14 janv. 2027 »;
  - the client-portal line → « … ou la date de transfert · … ».
- `src/i18n/fr-rules.ts`:
  - « $1 j sur le transfert », « $1 jours sur le transfert », « Net $1 sur le transfert »;
  - the payment rule is split in place: `^(\d+) % at handover$` → « $1 % au transfert », and `^(\d+) % at (SAT|COD|IST)$` keeps
    « $1 % à la réception ($2) ».
  - First-match order is unchanged.
- `home.json` « {amt} · transfert +{n} jours · soumise le {date} ».
- `portfolio.json` « Mise en service & transfert terminés », « Réception & transfert terminés » (masculine agreement).
- Left alone: goods-delivery « livraison » texts, the « acompte / livraison / réception » pattern, the 'Delivery' milestone, the AUTRE
  template's typed « Livraison », fr-dict « livrées avec l’équipement ».

## 2. Rules and defaults chosen

| Point | Default built | Why |
|---|---|---|
| User of an audit row | Explicit `actorUserId` > account of `actorPersonId` > account of `findPerson(actorName)`; none for a system actor | Plan §2 R-168; `findPerson` matches full or short name — an ambiguous short name could attribute a row to the wrong user (writers should pass the person or the user) |
| Trigger error | SQLSTATE 23001 (`restrict_violation`), message `audit_entries is append-only: <op> refused` | A constraint-like refusal no retry loop treats as transient |
| CSV columns | Prototype's six, then User (e-mail), Reason, Before, After (JSON) | Plan §2: screen and export keep 5 columns, the ISO CSV gains the rest |
| Sign-in before / after | Roles and department, only when changed; active role switch `{ activeRole }` | Brief: users.ts role / department changes |
| Legacy activity / audit rows | Shown from exact entries, connector parsers or generic shapes, else as typed (`fieldsText`), never `t()` | R-148, NEW-D1-2; writers converted after delivery 8 |
| Search hit sub-line | Project code first on every project-bound hit, current project's included | X-5: hits now come from any project; one rule reads better than "code only when elsewhere" |
| Client CRs | Every CR of every own project (`clientSeesChangeRequest`) | P-10b; cost-control open question 4 may restrict it later — one predicate to change |
| "TF" column | « MT » (marge totale) | French scheduling abbreviation; plan.json says « Flottement total » for the drawer (owner to confirm the term) |
| Seeded activity names in French sentences | As typed ("A1250 Steel erection") | Same as the Plan screen, where these typed names have no French entry |

## 3. Old → new displayed values (seed)

| Screen · value | Before | After | Decision |
|---|---|---|---|
| Global search, PO-1082 from HLT-026 | sub "Ordered" | "HLT-026 · Ordered" | X-5 (R-052) |
| Global search from NDC-031, "po-1082" | nothing | PO-1082 → /projects/HLT-026/orders?po=PO-1082 | X-5 |
| Global search from NDC-031, "ncr-04" | NCR-040, NCR-041 (NDC-031) | NDC-031 NCR-040, NCR-041, then RCF-019 NCR-040 | X-5 |
| Global search from EWA-051, "ncr" | nothing | HLT-026 NCR-026, -027, -028 | X-5 |
| Client search from NDC-031, "cr-0" | nothing | HLT-026 CR-004, CR-006, CR-007 | X-5, P-10b |
| Sidebar, Project collapsed, on Change control | item only | "Control" header + item | X-8 |
| FR "Handover" (schedule milestone, commissioning column, client portal) | « Livraison » | « Transfert » | NEW-D5-3 |
| FR client portal tile / CR-008 sub | « Livraison prévue » / « -12 j sur la livraison » | « Transfert prévu » / « -12 j sur le transfert » | NEW-D5-3 |
| FR Changes "Net 27 d on handover" | « Net 27 j sur la livraison » | « Net 27 j sur le transfert » | NEW-D5-3 |
| FR Activity feed (12 seeded events) | English (prototype), "Submitted CR-008 for review · +85 k€ · −12 j" | French ("CR-008 soumise en revue · +85 k€ · −12 j") | R-184, NEW-D1-2 |
| FR Audit trail, CR-008 change | « status: Draft → En revue » | « statut : Brouillon → En revue » | R-184 |
| FR Audit trail, RQ-014 object | "Request RQ-014" | « Demande RQ-014 » | R-184 |
| FR "Action due" / "Client / sponsor" | English | « Échéance de l’action » / « Client / commanditaire » | R-184 |
| ISO audit CSV | 6 columns | 10 columns (User, Reason, Before, After) | R-168 |

Tests overriding prototype goldens (none regenerated), each with its decision:
- `src/features/admin/model.test.ts` (R-184);
- `src/features/admin/render.test.ts` (R-184);
- `src/features/changes/forms.test.ts`, `changes.render.test.ts`, `src/features/schedule/schedule-render.test.ts`,
  `src/features/itpcom/render.test.ts`, `src/features/rexclient/screen.test.ts` (NEW-D5-3);
- `src/server/dal/shell.test.ts` (X-5);
- `src/domain/admin.test.ts`, `src/features/admin/actions.test.ts` (R-168).

The stale French row of `src/server/dal/home.test.ts`'s DIRECTOR_D7 table was aligned (not asserted).

## 4. Verification

- `npm run typecheck`, eslint on every touched file, `npx tsx --conditions=react-server scripts/db-check.ts` ("All checks passed",
  new "Audit trail (R-168)" block: seeded rows carry their user; UPDATE, DELETE and TRUNCATE refused).
- New tests:
  - `src/server/db/migration-audit-append-only.test.ts`:
    - UPDATE / DELETE / TRUNCATE refused;
    - deleting a project with audit rows refused by `audit_entries_project_id_projects_id_fk`;
    - 0017 re-run on rows written before it: backfill, then triggers back;
    - seeded rows carry their user;
    - user resolution (person id, short name, explicit Entra user, systems, person without account, unknown name);
    - reason / before / after / key stored;
    - `trace` with messages.
  - `src/server/dal/d8-signin-audit.test.ts`: Entra sign-in user and roles before / after, unchanged re-sign-in, role switch,
    sign-out, refused sign-in.
  - `src/domain/system-messages.test.ts`:
    - English templates equal to the texts kpis.ts / quality.ts / the Entra tests read;
    - French rendering;
    - invalid stored keys / parameters;
    - Intl formats;
    - system actors;
    - change shapes.
  - `src/features/admin/d8-audit-i18n.test.ts`:
    - display helpers;
    - French render of Admin › Activity & audit (typed text never segment-translated, keyed rows, seeded rows in French);
    - the Activity & integrations export in French.
  - `src/i18n/completeness.test.ts`, extended `src/i18n/extra/dictionaries.test.ts`.
  - `src/server/dal/d8-search.test.ts`:
    - PO-1082 from NDC-031;
    - NCR-029 from EWA-051;
    - risks current-first;
    - a CR on another project and on a project without data found by every internal persona (loop over PERSONAS);
    - the client: own organisation's CRs only, current first, nothing else;
    - `searchHitView` shows the code as typed;
    - the task deep link.
  - `nav-model.test.ts` (director and PM on Change control, Steering on Schedule).
  - `delivery2.test.ts` day offsets −40…39.
- No Server Function was added or changed. `searchAction` and the audit CSV route keep their checks; the search rule is enforced
  in the DAL (`searchShell` / `searchShellClient`), the CSV route still requires `getScreenAccess('plumbing').canEdit`.
- Full suite: see the lot report (run once at the end).

## 5. Integration notes

- **Merge first.** After this lot: `audit_entries` refuses UPDATE / DELETE / TRUNCATE and its `project_id` FK is NO ACTION. No later
  lot may update or delete audit rows, or delete a project that has audit rows, in code or tests. To date an entry in a test, insert
  it with `writeAudit({ occurredAt })` (see procurement/model.test.ts).
- **Guards for every later merge.**
  - `src/i18n/completeness.test.ts`: each new `t()` literal needs a French entry that differs, a rule, or a reviewed place on
    `src/i18n/same-in-french.json`.
  - The "every entry still used" check fails when a lot removes the only use of an allowlisted string: drop it from the list.
  - `src/i18n/extra/dictionaries.test.ts` (this lot owns it): one translation per key across ALL dictionaries. Add other lots'
    deliberate overrides of fr-dict.json keys to `OVERRIDES` with their file and decision (e.g. supply-engineering R-145 'Warranty
    cost YTD').
- **Migrations:** drop and regenerate 0016 (`npm run db:generate`) first, THEN re-create the custom one
  (`npx drizzle-kit generate --custom --name audit_append_only`) with the SQL of `drizzle/0017_audit_append_only.sql` — generated
  columns before the trigger. The migration test finds the file by its `_audit_append_only.sql` suffix, whatever its number.
- **Shared files touched** (function-level):
  - `src/server/db/helpers.ts` (`AuditInput`, `writeAudit`, `ActivityInput`, `recordActivity` — all existing callers compile
    unchanged);
  - `src/server/dal/ops-common.ts` (`trace` only);
  - `src/server/dal/notifications.ts` (`ActivityRow`, `AuditRow`, `listActivity`, `listAudit`);
  - `src/server/dal/users.ts` (sign-in audit);
  - `src/domain/admin.ts` (`auditCsv` + `AUDIT_CSV_HEADERS`);
  - `src/features/admin/model.ts` (`plumbingView` only);
  - `src/features/admin/i18n.ts` (new helpers next to `auditAreaT`);
  - `src/server/export/providers/admin.ts` (activity / audit rendering only);
  - `src/server/db/codes.ts` (`isoOfDayOffset` only);
  - `src/server/dal/shell.ts` (`deepLink`, `searchShell`, `searchShellClient` + imports);
  - `src/components/app/shell/nav-model.ts`;
  - `src/i18n/fr-rules.ts` (R-156 edits inside the prototype line, a `FR_RULES.push(…)` block appended at the end: other lots
    adding rules should append their own block, then the integrator re-checks first-match order);
  - `scripts/db-check.ts` (one block after the delivery-2 counts).
- **Shared tests touched:**
  - `src/features/admin/render.test.ts` (AuditRow fields, R-184 FR line);
  - `src/features/admin/actions.test.ts` (CSV header);
  - `src/features/procurement/model.test.ts` (l.317 only);
  - `src/server/dal/delivery2.test.ts` (day offsets block);
  - `src/server/dal/home.test.ts` (one unasserted FR row);
  - `src/server/dal/shell.test.ts` (:227–228, :259–264, :279–287).
- **Other lots' writers** (roles-rates-hr rates, cost-change CR chain, work-planning…) may pass `reason`, `before`, `after` and
  `message` to `writeAudit` / `trace` / `recordActivity` from now on. A new message key goes in `src/domain/system-messages.ts`
  (English template byte-identical to any text a reader matches).
- **R-149 (work-planning):** the `deepLink` task fix is here, with its test (`d8-search.test.ts`).
- **Roles-rates-hr (Finance persona Léa Marchand):** the seeded "Rate card" audit row will get her user automatically (seed maps
  person → user); the db-check block is written to stay valid.
- **R-157 item 2** (connector texts in French) is delivered by `activityWhatT` / `auditChangeT`.

### Suggested progress for docs/reste-a-developper.json (integrator)

| Item | State | Note |
|---|---|---|
| R-168 | en_cours | Append-only trigger, user, before / after, reason, ISO CSV columns; writers other than sign-in / trace / addAudit to fill before / after / reason after delivery 8; REVOKE waits for I-1a |
| R-184 | fait | Completeness and dictionaries guards, system messages, French feed and trail; writer conversion to keys is a later sweep (plan §2) |
| R-052 | fait | Portfolio search, current project first, client CRs of own organisation |
| R-151 | fait | X-8 |
| R-167 | fait | |
| R-156 | fait | NEW-D5-3 'a' |
| R-157 item 2 | fait (item only) | Connector texts in French on Activity & audit |
| R-149 deepLink part | fait (part) | Task notification link |

## 6. Migration

1. `drizzle/0016_low_shen.sql` (generated):
   - drops and re-adds `audit_entries_project_id_projects_id_fk` as NO ACTION;
   - adds `activity_events.message_key / message_params`;
   - adds `audit_entries.actor_user_id` (+ FK) / `before` / `after` / `reason` / `message_key` / `message_params`.
2. `drizzle/0017_audit_append_only.sql` (custom, `drizzle-kit generate --custom --name audit_append_only`): backfill, function, two
   triggers.
   - Must stay after 0016.
   - drizzle-kit does not model triggers: later `db:generate` runs never drop them. Do not hand-edit 0016.

## 7. Open questions for the owner

1. **REVOKE / table owner (I-1a):** real immutability needs a separate owner role on the hosting; until then the trigger is tamper
   evidence.
2. **GDPR purge (R-173):** retention of audit rows naming people; the purge script will disable the trigger in one transaction — who
   runs it and when?
3. **Seeded wording:** the French of the 12 seeded activity events and the audit texts was written for the demo. Activity names stay as
   typed in English ("A1250 Steel erection"), as on the Plan screen. Should the demo's typed names get French entries ("Testing &
   handover" → « Essais & transfert », "Inspection & handover", "Operational readiness & handover")? Not done (R-156 judgement call).
4. **"TF" → « MT »** and "Total float" → « Flottement total » (plan.json): which French term for total float?
5. **Search limit:** with current-project-first, broad queries ("ncr", "cr-0") show mostly the current project's hits within the
   3-per-kind limit. Keep 3?
6. **Client CRs:** the shared predicate shows every CR of the client's projects; cost-control open question 4 (internal CRs, e.g.
   CR-007) may restrict it.

## Integration review fixes

- R-052 / P-10b: `src/domain/client-visibility.ts` no longer claims the portal shares its rule — it names the global search as its only caller and points to `crAwaitsClient` / `getClientPortal` (portal: requests waiting for the client only), which an answer to open question 6 must change too (`client-visibility.test.ts` pins the difference).
