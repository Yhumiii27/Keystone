# Delivery 6 — Lot D: administration, interchange, wizard location, settings, site client log, defaults, cleanup

Working notes for `docs/DELIVERY-6.md`. They cover `docs/DELIVERY-6-PLAN.md` §4.1, §4.5, §4.6, §3.7, §3.1 (defaults), §3.4 (interchange polish) and §3.9 (orphan keys). The product owner's answers are in `docs/DECISIONS.md`.

## 1. Decisions applied

| Id | Owner's answer | What changed |
|---|---|---|
| D-7b | "Ne traite rien pour le moment concernant les imports" | The import cards are hidden behind `IMPORTS_ENABLED` (off). The importers stay. |
| D-7a | Connectors are configured by IT, outside the application | "Configure" is read-only. The save Server Function refuses every change. |
| L-3b | Required: name, client, PM, type, start and location | The wizard requires a site (city + country). The planned finish is optional and comes from the plan. |
| D-5 | Use the project's meetings and decisions | The Site's dedicated client log is retired. The button opens Meetings › Decisions › With the client. "Client decisions logged" counts those decisions. |
| A-13 | One rule, thresholds from Settings | CPI/SPI colours and the SPI/CPI attention items now use the Settings "At risk below" threshold. Before, they used a fixed 0.97. |

## 2. What changed

### 2.1 Imports and connectors (§4.1, D-7b, D-7a)

- `src/domain/ch4-defaults.ts` holds two new flags:
  - `IMPORTS_ENABLED = false`, with its refusal text `IMPORTS_OFF_MESSAGE` ("Imports are not available for now" / « Les imports ne sont pas disponibles pour le moment »);
  - `CONNECTOR_SETTINGS_BY_IT = true`.
- **Import cards.** `/admin/integrations` › Imports lists only the three "Export — …" cards (`visibleImportFormats`, `src/features/admin/model.ts`). "Export — MS Project XML" stays.
- **Server side, while imports are off:**
  - `POST /api/import` answers 403;
  - `startImport` and every later step of `src/server/interchange/jobs.ts` refuse (through `refusal` and `ownJob`);
  - `importSetupAction` offers no kind.
  - Cancelling an existing job stays possible.
- **Tests.** The importers and their tests are unchanged. `interchange.test.ts`, `imported-project.test.ts` and `interchange-actions.test.ts` turn the flag on with `vi.mock('@/domain/ch4-defaults', …)`. A new test checks the refusals with the flag off.
- **Configure.** The connector dialog (`connector-config-dialog.tsx`) shows frequency, direction, data, status and the last configuration, read-only. It explains that IT configures connectors outside Keystone. `saveConnectorConfigAction` refuses with "Connectors are configured by IT outside Keystone". The DAL writer `updateConnectorConfig` stays, for the IT path and the tests.
- **Disabled connectors:**
  - The connectors table shows "Disabled" (calm tone) for a connector whose `connectors.enabled` is false.
  - The enabled check moved into the DAL `syncConnector` (`ConnectorDisabledError`). Every "Sync now" path is now covered, including the Codex index.
  - `syncEnabledConnectorAction` is removed; the island calls `syncConnectorAction`.
  - The message reads "Connector {0} is disabled — IT configures connectors outside Keystone".
- **Interchange polish:**
  - An unrecognised file on a schedule card now says "The file is neither an MS Project XML file (MSPDI) nor a Primavera P6 XER file". The P6 card used to say "not an MS Project XML file".
  - The stale page comment is fixed.
  - Dead code is removed: `comingSoonT`, `listImportTargets`, and the admin keys "Configure — coming soon" and "File received — import coming soon".
- **Not done (still optional, and off anyway):** the multi-project XER picker, and re-planning table imports inside the write transaction.

### 2.2 Location in the new-project wizard (§4.5, L-3b)

- **Wizard step 1** adds:
  - "Site city": free text, with the known cities offered in a datalist; typing a known city fills its country.
  - "Site country": a select over the `countries` table.
  - Next stays disabled until name, client, planned start, city and country are set. "Planned finish" is optional, with the hint "Optional — taken from the plan when empty".
- **Validation in `createProjectAction`:**
  - `wizardSiteError`: "Enter the site city", "The site city is too long", "Choose the site country among the proposed countries";
  - `wizardWindowError`: the start is required ("Enter the planned start date"); the finish is checked as a window only when given;
  - the PM must resolve to a person.
  - `WIZARD_REQUIRED` now lists name, client, PM, type, start and location.
- **`createWizardProject`:**
  - It inserts `project_sites` with the city, the country, and `zone_override = null`. The zone therefore comes from `countries.zone_code`.
  - **Coordinates.** Keystone has no geocoding source. The only coordinates it holds are those of the seeded sites (prototype `GEO`). A new site copies the latitude and longitude of an existing site with the same city and country (case-insensitive). Otherwise they stay null, and the world map counts the project "without location". To be revisited if a geocoding service or a city coordinate table is provided.
  - The audit line ends with "· site <city>, <country>".
- **Planned finish:**
  - The wizard's empty finish is sent as null. `instantiateTemplate` then gives each template activity `TEMPLATE_ACTIVITY_DAYS = 30` working days (6 phases ≈ 9 months, as the prototype's default window), and the planned finish is the plan's finish. Example: EMP from Mon 11 Jan 2027 on the Atelier calendar → Thu 23 Sep 2027.
  - A blank template has no plan, so no planned finish ("—").
  - DAL callers that omit `plannedFinish` keep the prototype default of 30 Sep 2027.
  - The constant belongs to the owner's standard per machine type (A-2 / L-3a) when it arrives.

### 2.3 Client communications through meetings (§4.6, D-5)

- **Site button.** The Site HSE card's "Client communication log" is now a link to `/projects/<code>/meetings?view=decisions&decisions=client`. It is shown when the viewer may see Meetings (`canSee(role, 'meetings')`).
- **Removed:** the drawer, its Server Functions and its test (`src/features/site/comm-log*.{tsx,ts,css}`), plus the 13 now-unused `ch4-misc.json` keys.
- **Kept:** the `client_communications` table and its COM-nnn data, the DAL `src/server/dal/client-comms.ts`, which is still tested in `chapter4-foundation.test.ts`, and the domain rules in `src/domain/client-comms.ts`. Their headers say they are retired from the UI.
- **Meetings › Decisions.** New scope chips: All / With the client (`?decisions=client`). A client decision is a decision line of an external meeting, which is the prototype's own "… with the client" rule (`isClientMeeting`, `decisionRowsIn` and `clientDecisionCount` in `src/domain/meetings.ts`).
- **`clientDecisionsOf`.** In `src/server/dal/kpis.ts` it now counts those decisions (`clientDecisionCount(listMeetings(code))`) instead of the change requests whose client step was decided. That edit is the only one in the file.
- `clientDecisionsLogged` in `src/domain/kpis.ts` (CR-based) no longer has a production caller. I left it for the kpis owner, to avoid a merge conflict; its unit test still passes.

### 2.4 Settings polish (§3.7)

- **A-13 thresholds.**
  - New: `indexAlert(value, th)` in `src/domain/portfolio.ts`.
  - `portfolioKpis(…, th)`, `projectIndicators(…, th)` and `overviewMetrics(…).cpiAlert / spiAlert` follow the Settings "At risk below" threshold.
  - Callers: the overview DAL passes the thresholds to the KPIs, the register (`getRegisterData().thresholds`) and My projects pass them to the indicators, and the overview table uses `m.cpiAlert` / `m.spiAlert`.
  - `INDEX_ALERT` stays as a deprecated alias of the default threshold (0.97).
  - The inline clamp is replaced by `clampHealthCpi`.
- **Holidays.** A second holiday on an already-listed date is refused: "A holiday is already listed on that date" / « Un jour férié est déjà inscrit à cette date » (`HOLIDAY_DATE_TAKEN`).
- **Dead code.** `activeStatusCodes` is removed.
- **Rename.** `src/features/budget/soon-button.tsx` becomes `change-request-link.tsx`. `soon-button.tsx` still re-exports `NewChangeRequestLink`, so imports written against the old path keep working.
- **Orphan keys.** The budget "Add / Edit category / New change request — coming soon" keys are removed.

### 2.5 Chapter-4 defaults (§3.1)

- `DEFAULT_HOLIDAY_SET` is now defined in `src/domain/calendar.ts`, used by the three built-in calendars that observe holidays, and re-exported by `ch4-defaults`. It cannot live in `ch4-defaults` itself, which imports `calendar.ts`.
- `DURATION_UNIT` and `DEFAULT_CALENDARS` are annotated as documentation-only.
- `PDF_DEFAULT_LANG` is annotated. The export route renders in the viewer's language cookie, and a viewer without the cookie gets `DEFAULT_LANG`. The new `src/domain/ch4-defaults.test.ts` keeps `PDF_DEFAULT_LANG === DEFAULT_LANG`. I did not touch the export route, which belongs to the exports work.

### 2.6 Orphan "coming soon" keys (§3.9)

Each key was checked for use in the code first, then removed:
- `myapprovals.json`: "Approve — coming soon", "Reject — coming soon";
- `mywork.json`: "Attach — coming soon" (only a negative test assertion mentions it);
- `bom.json`: "Create spares purchase order — coming soon";
- `site.json`: "Client communication log — coming soon";
- `plan.json`: "Add a to-do — coming soon".

C-2b, R-8b and R-8c were not implemented (later work).

## 3. Old → new values

| Where | Old | New | Rule |
|---|---|---|---|
| Site › Daily execution › "Client decisions logged" (HLT-026, the only site sheet) | prototype 3; after A-12: 2 (CR-004, CR-006 client steps) | **2** (MTG-117 steering committee: phased handover, CR-006 approved) | D-5 |
| Meetings › "Decisions this month" sub "N with the client" | 2 | 2 (same rule, now shared through `isClientMeeting`) | — |
| /admin/integrations › Imports cards | 6 (3 import + 3 export) | 3 (export only) | D-7b |
| Connector "Configure" | editable (frequency, data, direction, enabled) | read-only | D-7a |
| Disabled connector status | its last sync state | "Disabled" (neutral) | D-7a |
| CPI/SPI colours and attention items (Overview, Projects, My projects, Home KPIs) | fixed 0.97 | Settings "At risk below" (default 0.97: no seeded value changes) | A-13 |
| Wizard planned finish | required, prefilled 30 Sep 2027 | optional, empty by default, taken from the plan | L-3b |
| New project zone | no `project_sites` row → "euna" | the country's zone | L-3b |

## 4. Open questions

1. **D-5 data.** `client_communications` (COM-nnn rows) and its DAL are kept. Deleting the table and its data needs the owner's confirmation, then a later migration. This lot created no migration.
2. **D-5 definition.** A "client decision" = a decision line of an external meeting. A supplier review is also external, so its decisions would count too; the seed has none. If the owner wants a stricter rule, a meeting needs a "client present" flag, for example a client-organisation participant.
3. **L-3b coordinates.** No geocoding source, so a new city is stored without coordinates and is missing from the world map until one is provided. Options: a city coordinates table maintained in Settings, or a geocoding service (a new tool needs approval).
4. **L-3b finish.** `TEMPLATE_ACTIVITY_DAYS = 30` per phase is a placeholder until the owner's standard per machine type (A-2 / L-3a) gives per-phase durations.
5. **D-7b scope.** When imports come back (S-9b one-time import at start), set `IMPORTS_ENABLED = true` and decide whether the Excel/CSV table imports stay or only the schedule imports.
6. **Exports (other lot).** The Activity & integrations export provider (`src/server/export/providers/admin.ts`) still lists all 6 import / export formats from `listImportFormats()`, so the export does not hide the import cards. The overview export (`providers/portfolio.ts`) recomputes `overviewMetrics(p)` and `portfolioKpis(…)` without the Settings thresholds when a client filter applies. Both are one-line fixes in the exports lot.
7. **Leftover orphan keys in other lots.**
   - `plan.json`: "Reschedule / Set baseline / Add relationship / Calendar / Baseline — coming soon" (planning lot).
   - Other features' "… — coming soon" keys (docs, orders, deliveries, resources, shell, pid, rexclient).
   - `clientDecisionsLogged` in `src/domain/kpis.ts` (kpis lot).
