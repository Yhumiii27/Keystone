# Delivery 7 — lot "debt-ux" (R-170, R-169, R-148, R-020, R-146)

Branch `worktree-wf_1417a6af-536-8`. Commits:

| Commit | Items |
|---|---|
| `284ce3e` | R-170, R-169 |
| `f0d34c4` | R-020 (it also holds the lot's tests `src/domain/d7-debt-ux.test.ts` and `src/server/dal/d7-debt-ux.test.ts`) |
| `d650037` | R-148 |
| `fa4796d` | R-146 |
| last commit | these notes, review fixes |

- **Migration:** none. The only schema edit is a comment on `connectors.added_in_keystone`. The Settings defaults are stored as a JSON document in the existing `app_settings` table.
- **New dependency:** none.
- **UI strings:** English source strings, French in `src/i18n/extra/d7-debt-ux.json`, registered last in `src/i18n/extra/index.ts`.

---

## R-170 — no runtime reads of the prototype data

### What changed

**Header project switcher** (`src/components/app/shell/page-header.tsx`, new `project-options.ts`)
- It is built from the project records. `PROTO.DEFS` is no longer read.
- The sub-line is the record's own fields: analytic code, DAS, machine type and PM.
- The search haystack covers the code, name, display id, analytic code, PM and client.
- A project created in the wizard shows its own codes.

**Zones and zone managers** (`src/domain/zones.ts`, `src/server/dal/shell.ts`)
- Zone labels and the "zone manager" line come from the `zones` table through `listZones()`, cached per request.
- `zoneLabel()` is now async.
- Changing a zone's manager or label in the data shows at once.

**Activity numbering** (`src/server/dal/plan.ts`)
- The digit of an added activity id comes from the project's existing activity codes (`projectIdxOf`), not from `PROTO.DEFS`.

**Settings › "Reset to defaults"** (`src/domain/settings-defaults.ts`, `src/server/dal/settings.ts`, `src/server/db/seed/settings.ts`)
- Reset restores a stored document, `app_settings` key `settings.defaults`, holding:
  - the list entries (code and label, in order);
  - the storage locations (name and type);
  - the health thresholds.
- The seed writes the document. In production, the reference data IT loads writes it.
- A database seeded before Delivery 7 gets the document on its next start (backfill in `seed/index.ts`).
- Each entry of the document is validated, so a malformed document never half-resets.
- Without a document, Reset falls back to the `is_default` entries, the current locations and `HEALTH_DEFAULTS`.
- An empty stored list or location set is skipped, never wiped.
- Only the portfolio director can reset (A-14).

**X3 stock snapshot** (`src/server/integrations/x3/prototype-snapshot.ts`)
- The X3 mock's snapshot and `X3_LAST_IMPORT` moved here, the connector's own mock module.
- `src/server/dal/stock.ts` no longer imports prototype data.

### Remaining readers of `src/server/prototype/*.json`

- `src/server/db/seed/*`, which loads the initial data.
- `src/server/integrations/x3/prototype-snapshot.ts`, the mock of the X3 connector until the real API exists.
- Test fixtures and golden tests.

No page, DAL reader or Server Function reads them.

---

## R-169 — prototype constants replaced by data or Settings

Displayed values that changed (old → new). On the seed most values are unchanged.

| Screen · value | Prototype constant | Now | Rule |
|---|---|---|---|
| Site › "Site premium" tile | sub "6d · 10h calendar" | `×1.5 / ×2`, sub "Saturday / Sunday rates · rate grid" | Saturday and Sunday multipliers of Resources › Rates (`rate_multipliers`). "—" with "No weekend rate in the rate grid" when there are none. |
| Sourcing › "Award rule" tile | "PM" · "Decided per RFQ by the project manager" | `1 / 3` · "RFQs to award decided by the project manager" | RFQs not yet awarded whose rule is `pm_decides`, over all RFQs not yet awarded. "—" · "No RFQ to award". |
| Drawings › "Obsolete still referenced" sub | "Superseded by rev 2" | "Superseded · ECO-2026-012" | The ECOs of the obsolete drawings, else "Superseded revision", else "Nothing to withdraw". |
| BOM › where-used default part | `CR-BRG-SKF` | `EL-TRF-2MVA` on HLT-026 | The project's part used by the most projects, else the catalogue's, else none. |
| New purchase order › delivery terms | literal default | RFQ incoterm + winning quote's payment terms ("Net 45" for RFQ-2026-031 / Dillinger). Empty, shown "To be agreed", when nothing is known (shortfall draft). | `src/domain/order-terms.ts`. Seeded orders keep their text. |
| Change control › CCB step approver | "Monthly · next 8 Oct" | "Marie Lefebvre" | The portfolio director who records the CCB decision (P-6a). |
| Admin › "Channels" tile | constant 3 | In-app plus each enabled channel connector (e-mail, Teams). Still 3 on the seed. | `notificationChannels()` |
| Plan "Add activity" default dates, "New meeting" date, team-load week labels, new RFQ "Reply due" | "5 Oct 2026" / "30 Oct 2026", "6 Oct 2026", "28 Sep" / "5 Oct", "15 Oct 2026" | Computed from the data date. Identical on the seed (data date Fri 25 Sep 2026). | `src/domain/form-dates.ts`; `newRfqDefaultDueIso` = data date + 20 days. |

**Kept, waiting for the owner (A-12):** the seeded PDM run date.

---

## R-148 — texts entered by users shown as typed

### The rule

- Names, titles, descriptions, notes, clients, locations, part and project names are texts entered in Keystone or received from Vigie, Cursus and Codex.
- They are never passed through the prototype's segment translator, the one that turned "Sun Valley Farm" into "dim. Valley Farm" (NEW-D1-2, X-12b).
- In French such a text shows its **exact** dictionary entry when the demo data has one. Otherwise it shows the text as typed.

### Shared helper `src/i18n/data-text.ts`

- `dataText(s, lang)`: the exact FR entry, else `s`.
- `makeDataT(lang)`: the same, as a function.
- `projectLabelText(p, lang)`: `"#026 · <name>"`.
- `fieldsText(s, t, lang)`: for lists of " · " fields. Each field takes its exact entry; otherwise fields that are only Keystone-formatted values (numbers, dates, units) go through `t()`; otherwise the field stays as typed.

The nine local `dataText` / `dataT` / `exactT` / `exactText` copies now delegate to it (bom, docs, itpcom, orders, pid, rexclient, team and others).

### Where it applies

- View models, pages (28 `t(projectLabel(..))` became `projectLabelText`), dialogs and the global search.
  - Search hits: the title is as typed. In the sub-line, the data segments (PM, manufacturer, job title) are as typed and Keystone's labels are translated. The search no longer translates results.
- Every export provider: Excel and PDF.
- Codex document titles and keywords now take the exact entry only. Seeded records used to go through the segment translator.

### Still through `t()` (Keystone's own vocabulary)

Statuses, stages, calendars, countries, departments, job titles of the personas, generations, engineering check notes (system generated), alert texts (owned by lot R-130) and import formats.

### Demo data and value changes

**Demo data kept French:** 36 composite demo texts that the prototype fully translated have an exact entry in `d7-debt-ux.json`.

**Displayed values that changed (FR only)** — partial translations are now shown as typed. Each golden test cites R-148 / NEW-D1-2:

| Old | New |
|---|---|
| "Stainless mounting bracket · rév. 2" | "… · rev 2" (Stock, PLM, ECO, Drawings) |
| "Automate sécurité — E-stop loop" | "Safety PLC — E-stop loop" (P&ID) |
| "Tiers · other supplier" | "Third party · other supplier" (Interfaces) |
| "coulée 7712" | "heat 7712" (Codex keywords) |
| Contract sheet fields, site evidence and equipment notes, PLM part names | as typed |

**Became more French:** project names that have an exact entry are now French everywhere, including where the prototype left them in English:
- "Quai 7 — Anvers" and "Bloc opératoire — Lille" in Machine types › references;
- "#032 · Migration ERP — Phase 2" in the Projects register.

---

## R-020 — connectors configured by IT outside Keystone (D-7a)

### Configuration (documentation for IT)

| Connector | Where it is configured | Server variables |
|---|---|---|
| Every connector (Sage X3, PDM, SolidWorks, Teams, e-mail, Vigie, Cursus, Codex…) | JSON file named by `KEYSTONE_CONNECTORS_FILE` (example: `config/connectors.example.json`) | — |
| Vigie | file + environment | `VIGIE_API_URL` (API; unset → simulated over the local mirror), `NEXT_PUBLIC_VIGIE_URL` (web app the links open) |
| Cursus | file + environment | `CURSUS_API_URL` (API; unset → simulated), `CURSUS_API_KEY` (secret, never shown; unset → demo key), `NEXT_PUBLIC_CURSUS_URL` |
| Codex | file + environment | `NEXT_PUBLIC_CODEX_URL` |

### File format

```json
{ "connectors": { "Sage X3": { "enabled": true, "frequency": "Every 2 h", "direction": "both", "dataScope": "…", "owner": "IT · L. Fontaine" } } }
```

**Keys:**
- `enabled` (default true);
- `frequency` (≤ 60 characters);
- `direction` (`import` | `export` | `both`);
- `dataScope` (≤ 300 characters);
- `owner` (≤ 120 characters, or null).

**Validation:**
- Unknown keys are refused.
- Keys that look like credentials (`key`, `secret`, `password`, `token`…) are refused. Addresses and keys stay in the environment.
- A file with any error is not applied at all.
- The errors are logged, and shown in English in the Configure dialog. The JSON parser's message is logged only, because it quotes the file.
- To check a file before deploying it: `npx tsx scripts/connectors-check.ts <file>`.

### When and how the file is applied

- It is applied when Keystone first needs the connectors and again whenever the file changes (path, modification time and size), once per database.
- Only the fields that differ are written, in one transaction.
- A name that is not a connector yet adds it: Ready, "First sync scheduled".
- Every change is audited as "IT · configuration file". An addition also records an activity.
- Without the variable, the stored settings stay: the initial data, or the last file applied.
- A connector disabled in the file refuses "Sync now".

### UI

- "Add connector" is removed from Admin › Integrations.
- The Configure dialog is read-only. It shows:
  - the settings;
  - their source: the file name only, never the server path, or "Stored settings · not listed in a connectors file";
  - the server variables, "set" or "not set" with what applies when unset. Values never leave the server.
- No Server Function writes a connector: Configure save is refused for every role.

---

## R-146 — tablet use (X-4: online, Site / Punch list / Deliveries first)

### Breakpoints

Defined in `src/components/app/shell/tablet.ts`. The CSS repeats them; `tablet.test.ts` checks that it does.
- **Tablet layout:** `(max-width: 1024px)`.
- **Touch targets:** `(max-width: 1024px), (pointer: coarse)`, so an iPad in landscape (1180–1366 px) also gets 40 px targets.

### Collapsible menu

- Up to 1024 px the shell is one column.
- A sticky top bar (`nav-toggle.tsx`) holds the "Menu" button (`aria-controls="ks-sidebar"`, `aria-expanded`) and the wordmark.
- The sidebar becomes a drawer, 300 px wide and at most 86 vw:
  - It sits above the page's drawers and below the centered modals.
  - It is `visibility: hidden` while closed, so it is out of the tab order.
- **Closing it:** its close button, the backdrop, Escape (focus returns to the menu button), any navigation (`navDrawerAfter`; sidebar links close it too), or widening the window past 1024 px.
- While it is open, `<main>` is `inert`.

### Tables

- Every DS `<Table>` sits in a `TableScroll` box. Above 1024 px the box is `display: contents`, so the desktop layout is unchanged. Up to 1024 px it is a horizontal-scroll block.
- `scroll={false}` for tables already in a scrolling box with a sticky header (import dialogs, spares order).
- The two plain `<table>` elements of Admin › Plumbing are wrapped.

### Header, drawers, Gantt and plan

- **Header:** the actions wrap, the title is 22 px, and the global-search panel opens rightwards.
- **Drawers and dialogs:** unchanged. They were already `min(640px, 100vw)`.
- **Gantt and plan:** they already scroll inside their cards. Their controls get the touch sizes.

### Touch targets

- **`src/styles/touch.css`** (imported by the root layout):
  - `.btn`, `.input` (not textareas) and `.seg-opt` are at least 40 px high, with `!important`, so the compact variants (24–34 px) of the CSS modules do not win on touch;
  - `.btn` is at least 40 px wide;
  - `.btn-icon` is 40 × 40;
  - table rows are 40 px.
- **Component modules:**
  - Segmented options, filter chips and list rows: 40 px;
  - check rows: 40 px; check circles and icons get an invisible 40 px hit area;
  - sidebar entries, section and group heads, "View as": 40 px;
  - header project switcher, options, search hits and notifications: 40 px.

### Not done (no phone redesign, per X-4)

- Sticky first column in the Gantt and plan grids.
- Offline use (P8).
- ⌘K does not open the drawer on a tablet keyboard.

### Verification

- Unit and render tests: `src/components/app/shell/tablet.test.ts` and `shell-render.test.ts`.
- The changed CSS parses with lightningcss (CSS modules, pure mode).
- A webpack dev smoke run on port 3318 served Site, Inspections & punch list, Deliveries and Admin › Integrations (200). The drawer markup and the compiled tablet rules were present.

---

## Checks

- **Typecheck:** `npm run typecheck`, clean.
- **Lint:** `npx eslint --ignore-pattern '.claude/**' src scripts`, clean.
- **Tests:** vitest, run by groups across `src/features`, `src/server`, `src/domain`, `src/components`, `src/lib` and `src/config`. Everything passes.
  - `meetings.golden.test` timed out once under load and passes alone.

## Open questions

1. **PDM run date (A-12).** The seeded PDM run date stays until the owner provides it.
2. **New-project wizard default PM.** It still defaults to S. Perrin. It should come from the viewer, or from a Settings entry.
3. **`DEFAULT_PROJECT` fallbacks.** Pages without a project in the URL still fall back to `HLT-026` when there is no `ks-project` cookie. Should it be the viewer's first project?
4. **Job titles and department names.** They still go through `t()`, because they are a shared vocabulary. Confirm they are not considered typed text.
5. **Connectors file and the configuration module (R-007).** Should `KEYSTONE_CONNECTORS_FILE` be declared in the zod configuration module and `.env.example`? The R-007 lot owns those files.
6. **CCB next meeting.** The CCB step now names its approver. Is a next CCB date wanted, from a Settings entry?
7. **Delivery terms of a new PO.** When nothing is known the terms stay empty ("To be agreed"). Is a Settings default wanted?
8. **Stakeholder notes.** They show the text as typed. The demo note "New" stays English in French.
9. **Portfolio alerts and the FY label.** They still go through `t()`; they are owned by lots R-129 and R-130.
10. **Tablet sticky first column.** Should the Gantt and plan grids get a sticky first column on tablets? It was not built without a visual check.
