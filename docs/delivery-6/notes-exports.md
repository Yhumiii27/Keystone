# Delivery 6 — lot C notes: exports, plan / Gantt PDF, client portal planning, meetings polish

Scope: `docs/DELIVERY-6-PLAN.md` §3.6 (exports), §3.5 (meetings) and §4.4 (S-9a). No migration was added.

## 1. What changed

### Exports (§3.6)

| Gap | Change |
|---|---|
| FR label 'Minutes' | `"Minutes": "Compte rendu"` in `src/i18n/extra/ch4-exports.json` (meetings sheet column, minutes PDF title). |
| SPI / CPI / float pre-formatted in EN | `ratioText` and `daysText` in `providers/common.ts`. The trends and client status-report PDFs (`status-report.ts`) and the budget cost report (`budget.ts`) now print `0,90` and `−27 j` in French. The Schedule KPI tile SPI is localised the same way. |
| Date / percent columns typed as text | `resources.ts` request sheets: Start, Due and Sent are `date` columns. `my.ts` My projects: Milestone date (with a new Milestone status column) and Forecast finish are `date`. `review.ts` client portal: milestone Baseline / Forecast, decision Since and document Date are `date`. The real dates come from the EN view, and any text that is not a date stays as shown. `portfolio.ts` prioritisation Weights: Share is `percent`. |
| Lenient date parsing | `xlsx.ts` `cellValue` and `format.ts` `formatDate` only treat ISO strings as dates. Other text stays text, so V8 can no longer read "Mar 2027" or "Raised 12 Sep" as a date. |
| Client `?code=` on global screens | New `currentProjectCode(ctx, fallback)` in `providers/scope.ts`. For a client, a foreign or unknown code falls back to one of their own projects (projects with data first), or `''` when they have none. Used by `my.ts` (home, myprojects, myapprovals), `resources.ts` (labour cost tile) and `purchasing.ts` (scorecard "NCRs this quarter (code)"). |
| Client sees other organisations' codes | `admin.ts` machine types "Projects" column and `reference.ts` ECO "Projects" column are filtered with `projectFilter` for clients. |
| "Download zip" toast without a link | `showToast(message, { href, label })` (see §6). The vault passes `codexPublicUrl()` from the new `src/server/integrations/codex/config.ts` (`NEXT_PUBLIC_CODEX_URL`, default `http://localhost:3100`). The toast reads "Download zip needs Codex — …" followed by an "Open Codex" link. |
| "Coming soon" leftovers | Removed the unreachable BOM fallback "Export list — coming soon" (`SparesActions.exportHref` is now required) and its key in `bom.json`. Removed the unused "Export register (xlsx) — coming soon" and "Download zip — coming soon" keys in `docs.json`. |

### Plan and Gantt PDF (§4.4, S-9a)

- **`plan` → PDF report.** "Plan — WBS & activities / Detailed plan", landscape.
  - It starts with the Progress KPI tiles.
  - Then it lists every WBS row (project, work packages, activities), indented by level. Columns: ID, name, owner, duration, start, finish, baseline finish, variance, float, constraint, % complete and predecessors.
  - Costs stay in the Excel file.
- **`schedule` → PDF report.** "Schedule", landscape.
  - It starts with the KPI tiles.
  - Then a Gantt chart drawn by pdfkit: the new `gantt` PDF block in `types.ts` / `pdf.ts`.
    - Per work package: a thin grey baseline bar over the forecast bar. Progress is filled. The critical path is in the accent colour and marked `*`. Slip is in the attention colour above 14 days.
    - A data-date line, the month header (repeated on each page) and one row per milestone. The baseline diamond is outlined and the forecast diamond is filled.
  - It ends with the milestone table (real dates).
- Both screens are added to `PDF_REPORT_SCREENS` (`src/features/exports/catalog.ts`). The catalog test still checks that the menu matches the providers.
- The builder `scheduleDocument(ctx, 'internal' | 'client')` lives in `providers/steering.ts`.

### Client portal planning view

- `/projects/[code]/client?tab=planning` is a new display segment, "Schedule" (FR "Planning"), placed after "Progress & milestones". It holds:
  - the Schedule screen's `ProjectGantt` (work packages baseline vs forecast, today line, milestone diamonds) and its legend;
  - the forecast and baseline finish;
  - the milestone list (baseline · forecast, slip, status tag);
  - a "Download PDF" button.
- The view is read-only: there are no edit controls on this tab.
- Work-package owners (internal people) are left out, both on screen and in the client PDF. The client PDF also leaves out the SPI and float tiles.
- The PDF is the document `planning` of the `client` provider (`/api/export/client?format=pdf&code=…&variant=planning`). It is the same Gantt builder as the Schedule screen.
- The Excel export of the tab starts with a "Work packages" sheet (baseline / forecast dates, % complete, critical) with no owners.
- Model: `clientPlanningView` in `src/features/rexclient/model.ts`, built by `getClientScreen` when `tab === 'planning'`.
- `CLIENT_TABS` gains the segment. The golden tests (`src/domain/rexclient.test.ts`, `src/features/rexclient/screen.test.ts`) now expect it, with a comment citing S-9a.

### Meetings (§3.5)

- **Transcript file download.**
  - Route: `GET /api/meetings/<MTG-nnn>/transcript` (`src/app/api/meetings/[number]/transcript/route.ts`).
  - The gate is in `src/features/meetings/transcript-file.ts`, with DAL `getTranscriptFileRef`. It checks the meeting number format and finds the stored file and its project. It loads `getProjectContext(code, 'meetings')`, the same context as the screen.
  - A client contact on another organisation's project gets 403.
  - A paste or an unknown meeting gets 404.
  - The file is streamed with `streamStoredFile` and `fileResponse`, as an attachment.
  - The file name in the transcript box links to it (`transcriptFileHref`).
- **Paste size.** `pasteTooLong(text)` in `src/domain/meetings.ts` checks the UTF-8 byte length against `TRANSCRIPT_IMPORT.maxUploadBytes` (800 000). The check runs on the client (`ImportDialog`) and on the server (`importTranscriptAction`). A paste with many accents now gets "The transcript is too long" instead of Next's 1 MB rejection.
- **Model actually used.** `analyseWithClaude` returns `servedBy: response.model`. After a server-side refusal fallback, that is the fallback model, and it is what gets stored in `analyzer_model` and shown.
- **Risk proposal in one transaction.**
  - `markTranscriptProposalApplied` accepts a function of the transaction that returns the reference.
  - `createRisk` takes an optional transaction (`src/server/dal/risks.ts`, an additive parameter).
  - The risk is therefore created and the proposal marked "added" together, or neither. A second click on an added proposal creates no second risk.

## 2. Providers and PDFs

- **Providers: 59 / 59 screens**, each with tables (CSV / Excel). The count is unchanged and still checked by `providers.test.ts`.
- **Screens with a header PDF report (8):** budget (cost report), billing (account statement), meetings (minutes), risks (risk register), trends (status report), client (client status report), **plan (detailed plan)**, **schedule (Gantt)**.
- **PDF documents (variants):**
  - orders `po` — purchase order;
  - deliveries `receipt` — goods receipt;
  - billing / client `statement` — account statement;
  - trends / client `status` — status report;
  - quality `pv` — PV de réception;
  - pid `overlay` — overlay list;
  - bom `spares` — PU/PR list;
  - meetings `minutes`;
  - **client `planning`** — Gantt for the portal.

## 3. Rights rules (as implemented)

- **Project-scoped screens.** A client exports only their organisation's projects: 403 otherwise (`buildExportContext`, unchanged). This includes the portal's `planning` PDF.
- **Global screens.**
  - A client's rows are filtered with `projectFilter`.
  - A `?code=` naming another organisation's project is ignored: the client's own project is used (`currentProjectCode`).
  - Machine-type and ECO "Projects" columns list the client's own projects only.
- **Rates.** Hourly rates and premium multipliers are left out for every role that cannot see rates (`ratesMasked`). This is now tested on all 59 screens with the `member` persona.
- **Transcript file.** Same access as the Meetings screen; a client contact on a foreign project is refused.

## 4. Tests

- `providers.test.ts`:
  - `it.each` over the 59 screens with a masked-rate role: the XLSX opens, and no "Hourly rate", "Hourly rate (€)" or "Multiplier" header appears in any sheet;
  - `it.each` over the global screens with a client sending `code=NDC-031`: no foreign code in any cell, and the same sheets as with the client's own project;
  - machine types and ECO for a client;
  - typed date and percent cells, read with exceljs;
  - plan, schedule and client planning PDFs (`%PDF`, texts, file names, 403 on a foreign project);
  - FR number formats and "Compte rendu".
- `transcript-file.test.ts`: the route serves the stored file; 404 for a paste or an unknown or malformed meeting; 403 for a foreign client.
- `meetings-transcripts.test.ts`: `getTranscriptFileRef`; the risk proposal transaction, including a second click.
- `actions.test.ts`: an accented paste over 800 kB is refused with its message.
- `claude.test.ts`: the served (fallback) model is recorded.
- `render.test.ts` (rexclient): the Schedule tab in FR, no owners, a single button (export), and the empty state.

## 5. Remaining external placeholders

- **Codex.**
  - Document zip: the toast names Codex and links to the Codex home.
  - Per-document deep links remain open question D-1.
  - "Open in Codex" / "Edit in Codex" toasts.
- **PDM.** "Open in PDM — coming soon" (`eco/drawings/pdm-button.tsx`, `pid-view.tsx`) and vault sync.
- **Sage X3.** The push of supplier invoices / X3 references.
- **The remote side of each connector** (mocks until the real APIs exist).
- **Not mine, left as is:** `src/features/admin/i18n.ts` `comingSoonT` is still defined but unused (admin / settings lot).

## 6. Shared files touched outside the lot

- **`src/components/ds/Toast.tsx` / `Toast.module.css`.** Additive change, which should merge easily with an `action` option:
  - new `export interface ToastOptions { href?: string; label?: string }`;
  - `showToast(message, opts?)` and `useToast().show(message, opts?)`;
  - `ToastState.link?`, rendered as an `<a target="_blank" rel="noopener noreferrer">` between the text and the close button;
  - only `http(s)://` or same-site `/…` hrefs are rendered;
  - new `.link` class.

  Existing `showToast(message)` calls are unchanged. A second option such as `action` can be added to `ToastOptions`.
- **`src/server/dal/risks.ts`.** `createRisk(projectCode, input, actorName, inTx?)`: an optional transaction parameter, same behaviour without it.
- **`src/server/integrations/codex/config.ts`.** New file: the Codex public URL, the same pattern as Vigie and Cursus.
- **`src/features/docs/vault.tsx` / `vault-table.tsx`, `src/features/bom/client-buttons.tsx`, `src/domain/rexclient.ts`.** Small edits described above.

## 7. Open questions

1. **Codex deep link (D-1).** Should "Download zip" open a Codex selection or basket URL? Today it opens the Codex home. The base URL is `NEXT_PUBLIC_CODEX_URL`.
2. **Client portal "Schedule" tab label.**
   - "Schedule" (FR "Planning") follows the app's Schedule screen.
   - Confirm the name and position, and whether the client should also see the detailed plan (activities), not only the work-package Gantt. Today the client gets the summary Gantt only, as S-9a's "planning détaillé" may be internal.
3. **Gantt span.** The PDF Gantt follows the screen's 13-month span from the project start, so bars beyond month 13 are clipped as on screen. Should the PDF instead extend to the forecast finish?
4. **Project start / finish columns.** The Start / Finish columns of projects, overview and pfplan ("Jan 2026") are still text. Excel dates would need a month format; this is optional in the plan and not done.
5. **Plan PDF and costs.** The plan PDF leaves costs out. Should a "with costs" variant exist for internal use?
