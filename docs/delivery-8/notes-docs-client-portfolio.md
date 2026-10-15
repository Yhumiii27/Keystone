# Delivery 8 — lot "docs-client-portfolio": notes

Branch `worktree-wf_3e64f8c5-23c-3`, based on `e41c309` (plan base on main-2a2fep). Seven items. The decisions applied are the owner's answers in `docs/DECISIONS.md` and the defaults of `docs/DELIVERY-8-PLAN.md` §2; each test that changes a displayed value cites its decision id.

| Item | Decision | Status | Commit |
|---|---|---|---|
| R-134 Score a proposal on the 5 ranking axes | L-5a = a | done | `cdedb33` (+ persona test `835579b`) |
| R-136 Portfolio schedule: sliding 24-month window, quarter steps | L-8 = a | done | `294c686` (+ export test `835579b`) |
| R-135 Projects map: stage-coloured tag, 'Clos / annulé' legend, keyboard markers | L-7 = a | done | `24a327c` |
| R-138 Client portal: document categories computed from the Codex index | L-9 = a | done (buildable part; two categories wait for the owner) | `233eae7` |
| R-033 Codex connector, Keystone side (links, honest state, index read) | I-3a, D-1a, A-15 | partly done: everything that does not need Codex's real API; endpoints are `TODO(codex)` proposals | `da1d691` |
| R-127 Codex history stays in Codex (record, current revision, current circuit) | D-2 = a, A-15 = a | done | `da1d691` |
| R-128 Clickable Deliverable, Order and Punch-item relations | D-2 context, 10 OQ15 | done (row anchors come with site-quality, R-117) | `da1d691` |

## Migration

One generated migration for the whole lot: **`drizzle/0016_clean_gargoyle.sql`** (+ `drizzle/meta/0016_snapshot.json`, `_journal.json`). No custom migration.

```sql
DROP TABLE "document_downloads" CASCADE;
DROP TABLE "client_document_categories" CASCADE;
ALTER TABLE "document_index_syncs" ADD COLUMN "source" text DEFAULT 'keystone' NOT NULL;
```

- `document_downloads` (R-127, D-2): the Keystone download log is gone; the log stays in Codex. Destroys demo data only (no production database exists yet, I-1a); it cannot be undone once one does.
- `client_document_categories` (R-138, L-9): the prototype's typed CLIENT_DOCS rows; the categories are computed.
- `document_index_syncs.source` (R-033): `codex` marks a real read of Codex's index (banner "Last sync", the next read's `since`, the Codex row's last sync); `keystone` the seed and the mock "Sync now". Existing rows default to `keystone`, so a seeded "08:02" sync is never shown as an exchange with Codex.

Integrator: the base already had `0015`; drop this lot's `0016_*` files and regenerate in merge order (`npm run db:generate`); the SQL above is the expected content. No existing migration was edited. The first version of the lot's migration (`0016_glorious_millenium_guard`, R-138 only) was replaced in `da1d691` by the regenerated one.

## Per item

### R-134 — L-5a = a: score a proposal on the 5 axes

- `src/features/pfinance/forms.ts`: required number fields `res` "Resource fit (1–5)" and `client` "Client priority (1–5)" after `risk`, before `comment`, default 3; `parseScoreProposal` validates them with `validScore` (same message); `ScoreProposalInput` gains `res`, `client`.
- `src/server/dal/prioritisation.ts` (`ProposalScore`, `saveProposalScore` only): the 5 axes are upserted with the scorer, date and comment; "score 1 when new" stays only for an axis added to the register later. Audit text: `score: fit 5 · margin 4 · risk 5 · resources 4 · client 1`.
- `scoreProposalAction` passes the 5 values; rights unchanged (director and PM in their workspace, everyone else "Outside my workspace · Read-only"). The DAL writer now re-checks the rule when given the actor (`saveProposalScore(code, scores, { name, role })` refuses a role without the Portfolio screen; a plain name — tests, seeds — is accepted as before).
- Prototype labels kept: "Financial return" still scores the "Margin / NPV" axis (deviation for the owner, see questions).
- Displayed: the dialog has 6 fields (was 4). Re-scoring overwrites the seeded Resource fit / Client priority with what is typed; the dialog cannot prefill a proposal's current scores (FormDialog defaults are static), so leaving the defaults turns EWA-051's resource fit 2 → 3.
- FR: « Adéquation ressources (1–5) », « Priorité client (1–5) ».

### R-136 — L-8 = a: sliding 24-month window, quarter steps

- `src/domain/pfplan.ts`: window start `from` = month offset since Jan 2026, a quarter start. `defaultWindowStart(now = PG_NOW)` = 3·round((now − 12)/3) → −3 on the seed (Oct 2025 – Sep 2027). `pgPct`, `pgSeg`, `pgRow` take `from` (default 0 = the prototype's window) and clip to [from, from + 24]; `clipText` when the bar ends after the window; `pgTodayL(from)` is null when now is outside; `pgMonths(from)` uses mod arithmetic (never `monthDate`, wrong for negative offsets) with the year on each January and on the first column. `portfolioScheduleModel(input, { filter, lang, from })` returns `months`, `todayL | null` and `window { from, label, prevFrom, nextFrom, isDefault }`; `from` defaults to `defaultWindowStart()`. Board states, gates, "Decision pending" and the KPIs stay on `PG_NOW`. `parseWindowParam` / `windowParam` / `windowLabel` / `isWindowStart` are pure and tested.
- `src/app/(app)/portfolio/schedule/page.tsx`: `?from=YYYY-MM` — a quarter month (Jan/Apr/Jul/Oct) within Jan 2020 – Oct 2035, else the default.
- `src/features/pfplan/view.tsx`: a "Period" group in the existing filter bar — Previous quarter / Today (drops `?from=`) / Next quarter as server-rendered links (a disabled button at a bound), then the window ("oct. 2025 – sept. 2027" through the month dictionary). Filter links keep the window, window links keep the filter (`pfplanHref`).
- `src/components/charts/portfolio-gantt.tsx`: the today line only when `todayL` is set.
- `src/lib/format.ts` `fmtD`: the year suffix of the actual year after 2026 ("3 Mar ’28"; it always wrote ’27). 2026 / 2027 values unchanged (also used by `portfolio.ts:239/267`).
- Export (`src/server/export/providers/portfolio.ts`, pfplan only): a "Period: Oct 2025 – Sep 2027" filter line; the sheets are unchanged.
- `PG_MONTHS` kept in `pipeline.ts` (delivery3.test.ts uses it).
- Displayed on the seed: default window Oct 2025 – Sep 2027 (was Jan 2026 – Dec 2027); the today line moves from 37.38 % to 49.88 %; projects finishing Oct–Dec 2027 are clipped by default; stage segments of late 2025 become visible.
- Keystone defaults, not owner data (deviations to record): the Jan 2020 – Oct 2035 range, the round-to-nearest-quarter centring, the year on the first column.

### R-135 — L-7 = a: stage-coloured tag, legend, keyboard markers

- `src/features/worldmap/model.ts`: the tooltip's stage tag takes the list's stage tone (`tagTone(lifecycleTone(status))`); health tag and `markerStyleOf` unchanged. `tooltipStatusTone` (the prototype's `tagClass`) is removed (domain and its test). Legend `labels.closed = t('Closed / cancelled')` → « Clos / annulé » (the fr-dict entry "Closed / on hold" is now unused and left in place).
- Keyboard (`src/components/charts/projects-map.tsx` + `.module.css`): the svg is `role="group"` (keeps its aria-label); each marker `<g>` is `role="button"`, `tabIndex` 0 (−1 when its screen position is outside the frame), `aria-label` = tooltip title (+ the project name for a single marker). Focus shows the hover tooltip; blur hides it unless pinned; Enter / Space (preventDefault) apply the click rule — zoom moves focus to the svg, pin moves focus to the tooltip's first link; Esc (the existing document listener, not doubled) or × return focus to the marker that opened it, the svg when a re-cluster removed it. Focus ring = an extra SVG circle on `.mk:focus-visible`.
- Pure rules in `src/domain/worldmap.ts`: `markerKeyAction`, `markerTabIndex`, `markerAriaLabel` (unit-tested, no jsdom).
- Displayed: tooltip stage tags in stage colours (e.g. an active project at risk had an outline tag, now accent like the list); legend « Clos / annulé ». Interpretation recorded for the owner: L-7 (a) does not say "register colours" outright.
- The grey "closed" marker also covers category `other` (an execution / Garantie project with no health yet); the seed has none — owner question below.

### R-138 — L-9 = a: client document categories computed from the Codex index

- `src/domain/rexclient.ts` (new `clientDocCategories` and its constant only): one constant `CLIENT_DOC_CATEGORY_OF_TYPE` (CTR → "Contract & amendments", MIN → "Meeting minutes", HSE → "HSE documents", PV → "Accepted deliverables"), any other type → its Codex family label; fixed order (those four, then the families in Codex order); empty categories left out; stable keys (`contract`, `minutes`, `hse`, `accepted`, `eng`, `client`, …). Each category: `fileCount`, the distinct type labels, `latestIssuedOn`.
- `src/server/dal/client.ts` (`documentCategories` only): computed from the shared documents `listSharedDocuments` returns; the table read is gone.
- UI: `src/features/rexclient/model.ts` (`docCategoryViews`, `docsLabels.byCategory`) and `client-view.tsx` DocumentsTab: a "By category" strip above the table (name, "{n} files", type labels, "Last issued 26 Sep"). A grouped display only — no filter, no `?cat=` (no new interaction; the client page and `screen.ts` are untouched).
- Data: `client_document_categories` dropped (schema, seed insert, `db-check` counts, delivery5 tests).
- Displayed on HLT-026: 6 categories / 7 files — Meeting minutes 1, HSE documents 1, Accepted deliverables 1, Engineering 2, Client deliverables 1, Purchasing 1 (the prototype's 5 typed rows "Contract & amendments 3 files", "Monthly progress reports 8 files", "Meeting minutes 22 files", "HSE reports 9 files", "Accepted deliverables 3 files" were never rendered).
- Not shown (owner questions): "Contract & amendments" (CTR is not a client deliverable in Codex — the share flag is Codex's) and "Monthly progress reports" (no Codex type; Keystone's status report is not a Codex record).

### R-033 — Codex connector, Keystone side (partly buildable)

Built:
- **Links** `src/server/integrations/codex/links.ts` (new, pure, client-safe; `CODEX_LINK_ATTRS`): `codexHomeUrl(project?)`, `codexDocumentUrl(number, rev?, codexUrl?)` (Codex's own link wins once the index read brought it — http(s) only, never `javascript:`), `codexTypeRegisterUrl()`, `codexSelectionUrl(numbers)`, all on Codex's home with parameters Codex ignores today (`TODO(codex)` D-1). New-tab links for the vault banner "Open Codex", the drawer "Open in Codex", the register "Edit in Codex" (still hidden outside the workspace), My approvals' Codex rows (`codexVaultItems` takes a per-record href; `codex-documents.ts`), and the "Download zip" toast link (selection). "Download zip" keeps its explanatory toast.
- **Honest state**: `connectorLink` returns `live` for Codex in `http` mode (`src/domain/connectors.ts`); the Codex row (`integrations.ts`, Codex row only) shows pending / failed counts from `undeliveredCodexEntries` and, when live, the last read of Codex's index as its last sync; a failed run marks it Warning. "Sync now" on Activity & integrations (`admin-connectors.ts` → `syncConnector` with an `exchange` hook) delivers the outbox, then reads the index, inside the logged run; `syncConnector` dates a successful run of a live Codex (`kind !== 'static' || link === 'live'`). `codexSyncToastT` reports sent / pending / refreshed in http mode and says "index up to date" only when the index was read ("Codex sync · index not read · …" otherwise, as an error toast).
- **HTTP index read** (isolated `TODO(codex)` proposal, D-2 scope): `GET /api/documents?since=…[&project=…]` → `CodexIndexRecord[]` (record, current revision, current circuit). `applyCodexIndex` (`mirror.ts`) upserts the document (incl. `codexId`, `codexUrl`), the current `document_revisions` row and `document_approvals`; a status change, the withdrawal, the acknowledgement reset and the closing of outbox entries go through the existing `applyCodexDocumentStates` (one rule). Records with an unknown project or type code, or malformed, are skipped and logged — never filed as QMS. `refreshCodexIndex` (documents DAL) reads since the last `codex` read, records the read (`source = 'codex'`, count = Keystone's index) and throws when Codex is unreachable (nothing recorded). `syncCodexIndex` returns the real count in http mode.
- **Job** `codex-index` (hourly, lease 15 min, under the docs-client-portfolio markers of `src/domain/jobs.ts` and `src/server/jobs/definitions.ts`): http mode reads the index ("Codex index read · n records applied · n new · n skipped · n in the index", warning when records were skipped); mock: "Codex mock connector · index not read".
- **Deposits in http mode** (default, owner to confirm, A-15): "Continue in Codex" is refused with "Codex is connected — deposit the document in Codex" and an "Open Codex" link (the record in Codex for a new revision); the DAL `depositInCodex` re-checks (`DepositInCodexOnlyError`). Mock mode unchanged. R-125 later brings the prefilled deposit form.
- Mock mode unchanged everywhere; production without Codex keeps an empty index (A-15).
- Clients have no Codex access: no "Open Codex" / "Open in Codex" for the client role (vault banner, drawer), no Codex link in a client's download toast. Deviation from the brief, which only named the history link.

Not built (waits for Codex): real routes and payloads (D-1), the prefilled deposit form (R-125), file downloads and the zip, webhooks, deletions in Codex (an incremental `since` read does not see them), the relations of a record in the index payload (links are not part of the proposed D-2 payload).

Displayed (old → new): "Open Codex" / "Open in Codex" / "Edit in Codex" toasts ("Opening Codex · project HLT-026", "Opening Codex · PID-HLT-026 rev D") → links opening Codex in a new tab; My approvals "Open in Codex" → the record's Codex URL; in http mode the Codex row "Mock" → OK / Warning with a last sync and outbox counts; the http "Sync now" toast "Codex sync · index up to date · 412 records" → "Codex sync · index up to date · 42 records · 1 sent · 0 pending · 1 refreshed" (the count is Keystone's index) or "Codex sync · index not read · …". Mock texts unchanged.

### R-127 — D-2 = a: the history stays in Codex

- Drawer (`document-drawer.tsx`, `model.ts drawerView`): "Revisions" shows the current revision row only (note, date · author · working versions, status, Native / PDF), then the link "Earlier revisions and download log in Codex" (new tab, `codexDocumentUrl`, `TODO(codex)` D-1), hidden for the client role. The "Download log" section is gone. Approval proof (with the delivery 7 pending-sync rows), Distribution with the client acknowledgement and the withdrawal callout are kept.
- DAL (`documents.ts`): `getDocumentRecord` returns the current revision only and no downloads; `logDocumentDownload` is removed (nothing writes a download log); `DocDownloadSource` removed from `codes.ts`; the seed writes no download rows.
- Downloads (vault row, drawer, client portal): `logDownloadAction` keeps the access checks (vault project; a client only the shared records of their own projects, P-10a / P-10b) and answers the Codex hand-off toast "Download needs Codex — the document files are stored in Codex" with an "Open Codex" link for the internal team (none for the client). Nothing is written, no read event in the audit trail.
- KPI "Obsolete revisions withdrawn": keeps counting the stored withdrawn revision rows (not displayed any more; the seed keeps its revision rows) — never the revision-letter sum (00 §7.16, 10 OQ16). `TODO(codex)`: the D-1 payload must carry a withdrawn-revision count.
- Displayed: drawer revisions D, C, B, A → D only + the Codex link; the download log (e.g. "S. Haddad · rev D · 27 Sep · PDF") disappears; download buttons show a toast (they wrote a log row silently before).

### R-128 — clickable Deliverable, Order and Punch-item relations

- `getDocumentRecord` only: each relation of a project record resolves against the record's OWN project (never the vault page's): deliverable → `deliverables.number`; purchase order → `purchase_orders.number`, else `x3Ref` (SC-4b), linking to the Keystone number; punch item → `punch_items.number` in one small function (`findPunchItem`, any register — one list per project, A-6 — so R-117 can replace it). QMS records and unknown refs → `target: null` (inert). Light queries (one per kind, `inArray`).
- `model.ts linkHref`: deliverable → `deliverableHref`; order → `ordersHref(project, { po })`; punch item → `itpHref(project, 'punch') + '#punch-' + number`; article and change request unchanged; no `canSee` gating (as for Article and CR). A client's relations stay inert (every target is an internal screen that sends the client home, P-1) — deviation from the brief, noted.
- Row anchors `id="punch-{number}"` are added by site-quality (R-117, plan §2), not here: until it merges, the link opens the punch list without scrolling to the row.
- Displayed: PHO-HLT-011 / NCR-HLT-029 "P-01" → link to `/projects/HLT-026/itp?view=punch#punch-P-01`; PID-HLT-026 "D-016" → `/projects/HLT-026/quality?tab=dlv&dlv=D-016` (and RPT-HLT-014 D-014, MAN-HLT-015 / PV-HLT-001 D-015); the seed's PO-2026-118 / 104 / 109 stay inert (they are not HLT-026 orders — left as they are, owner question).

## Translations

`src/i18n/extra/d8-docs-client-portfolio.json` only (12 keys, none clashing with another dictionary): the two score labels, "Previous quarter", "Next quarter", "Closed / cancelled", "By category", "HSE documents", "Last issued", "1 file", "Earlier revisions and download log in Codex", "Download needs Codex — the document files are stored in Codex", "Codex is connected — deposit the document in Codex". No prototype key is overridden. The http "Sync now" texts are composed per language in `display.ts`, like the delivery 7 mock texts.

## Tests

New files: `src/domain/pfplan-window.test.ts`, `src/features/pfplan/pfplan.window.test.ts`, `src/domain/worldmap-keyboard.test.ts`, `src/domain/rexclient-categories.test.ts`, `src/features/rexclient/doc-categories.test.ts`, `src/server/integrations/codex/links.test.ts`, `src/server/integrations/codex/index-read.test.ts` (stub Codex over HTTP: index upsert incl. unknown project / type / malformed / QMS / unsafe link, incremental `since`, unreachable Codex, live Codex row and "Sync now", the job, deposits refused), `src/features/docs/d8-codex-actions.test.ts` (downloads, "Sync now" and deposits for the 8 personas + malformed input), `src/features/docs/relations.test.ts`, `src/features/pfinance/score-personas.test.ts` (8 personas, malformed axes, a project that left the pipeline), `src/server/export/providers/pfplan-period.test.ts`.

Existing tests changed, each citing its decision: pfinance `actions.test.ts` (L-5a: the AF golden check diverges on purpose — prototype fields + `res`, `client` before the comment; restore calls pass `res`/`client`), `delivery3-writes.test.ts` (L-5a scores; D-2 download log), pfplan `pfplan.test.ts` / `pfplan.render.test.ts` / `pfplan.scenarios.test.ts` (every golden comparison pins `from: 0`, L-8; the render test's filter links keep `?from=2026-01`), `worldmap.test.ts` and `worldmap/render.test.ts` (L-7: the tooltip stage tone is the list's — the prototype comparison no longer covers tooltip tones —, legend, keyboard markup), `delivery5.test.ts` / `delivery5-writes.test.ts` / `rexclient/screen.test.ts` (L-9), docs `render.test.ts` / `overlays.test.ts` / `page.test.ts` / `actions.test.ts` / `codex-approvals.test.ts` and `delivery3.test.ts` (R-033 links, D-2 current revision and no download log, R-128 targets, R-033 http sync toast), `domain/connectors.test.ts`, `domain/jobs.test.ts`, `scripts/db-check.ts` (tables and the PID-HLT-026 check). Golden generator scripts unchanged.

Checks: `npm run typecheck` clean; eslint clean on every changed file; `scripts/db-check.ts` "All checks passed"; full `npx vitest run` (load average ≈ 12 on 4 CPUs, shared with another lot): 276 files passed, 3396 tests passed, 3 tests of `src/features/plm/model.test.ts` timed out at 5 s — that file passes alone (27 / 27). An earlier full run had two load flakes (`eco/render.test.ts`, `aftersales/followup.test.ts`), both green alone.

## Notes for the integrator

- Shared files touched (sections only): `src/domain/approvals.ts` (`codexVaultItems` only), `src/domain/rexclient.ts` (new `clientDocCategories` + constant, placed after `DOCS_TAB`), `src/features/rexclient/model.ts` (docs view: `docCategories`, `docsLabels.byCategory`) and `client-view.tsx` (DocumentsTab) — cost-change edits DecisionsTab / decision rows of the same files; `src/server/dal/client.ts` (`documentCategories` and its import only; cost-change edits l.137); `src/domain/connectors.ts` (`connectorLink` Codex line + comments) and `src/server/dal/integrations.ts` (Codex row: `codexState`, `modeOf`, the `exchange` hook of `syncConnector`, the live-static update condition) — connectors edits the Cursus row there, work-planning adds a scope-text function; `src/server/db/codes.ts` (DocDownloadSource removed); jobs markers (`codex-index`); `scripts/db-check.ts` (document_downloads and client_document_categories removed from the counts); `src/server/dal/delivery5-writes.test.ts` (table list).
- Files outside the brief's list, needed by the change: `src/app/(app)/projects/[code]/documents/page.tsx` and `src/app/(app)/admin/document-types/page.tsx` (props `codexHref` / `editHref` instead of the toasts), `src/features/docs/deposit-wizard.tsx` (the "Open Codex" link of a refused deposit), `src/features/rexclient/screen.test.ts`, `src/server/export/providers/portfolio.ts` (pfplan workbook only).
- `src/features/itpcom/itp-view.tsx` and `src/features/site/site-view.tsx` are NOT touched: the `id="punch-{number}"` row anchors are site-quality's (R-117). After both merge, check that `#punch-P-01` scrolls to the unified row.
- `syncConnector(name, actor, opts?)` gained an optional third argument (`exchange`, used for a live Codex only); callers without it are unchanged.
- `src/features/docs/i18n.ts` `openingCodexProjectText` and the FR rule `^Opening Codex · (.+)$` are now unused by the screens (kept: other lots or the e2e may still reference them; remove in the post-merge dead-code sweep R-171).
- Route matrix / e2e: no new route. The e2e specs that click "Open Codex" or expect the "Opening Codex" toast (none found in `tests/e2e`) would need a link assertion instead.
- Remaining-work suggestions: R-134, R-135, R-136, R-127 → fait; R-138 → fait (note: "Contract & amendments" and "Monthly progress reports" wait for the owner); R-128 → fait once site-quality's row anchors are merged; R-033 → en_cours (Codex API D-1, R-125 deposit form, file downloads, webhooks).

## Open questions for the owner

1. **R-033 / A-15.** With Codex connected, Keystone refuses its own deposit hand-off and sends the user to Codex (no Keystone-numbered draft that Codex never receives). Confirm, until R-125 brings the prefilled deposit form?
2. **R-033 / D-1.** The Codex endpoints (`GET /api/documents?since=`, approvals, circuit, state) and the index payload are proposals; the project key is Keystone's code (NEW-SYS-1 open). The index is read hourly (the spec's Codex row says real time / webhooks). To agree with Codex.
3. **R-033.** Clients get no link to Codex anywhere (no Codex access), and the client's download gives the hand-off toast without a link. How should a client obtain a file until Codex serves files (R-033 later)?
4. **R-127.** Dropping `document_downloads` destroys the demo download log (no production data yet). Confirm before a production database exists.
5. **R-128.** The seed's PO-2026-118 / 104 / 109 are not HLT-026 orders, so the order relations stay inert in the demo. Remap them to real HLT-026 orders (PO-10xx)?
6. **R-138.** "Contract & amendments" (CTR is not shared with the client in Codex) and "Monthly progress reports" (no Codex type) do not appear. Should the contract be shared with the client in Codex, and should the monthly report be deposited in Codex? The family fallback shows "Engineering", "Client deliverables" and "Purchasing", which are not among the prototype's five; "Client deliverables" next to "Accepted deliverables" may confuse — confirm the list (one constant).
7. **R-134.** The form keeps the prototype's labels ("Financial return" scores the "Margin / NPV" axis); rename to the ranking's axis names? Re-scoring overwrites the seeded Resource fit / Client priority with the defaults if the user leaves them.
8. **R-135.** L-7 (a) read as "stage colour" for the tooltip tag (inferred from (a) ≠ (c)); confirm. The grey marker ("Closed / cancelled") also covers an execution project without a health yet — give it its own style?
9. **R-136.** Window bounds (Jan 2020 – Oct 2035), round-to-nearest-quarter centring and the year on the first column are Keystone defaults; "now" stays PG_NOW until R-013.

## Integration review fixes

- Dead code removed: `openingCodexProjectText` (`src/features/docs/i18n.ts`, replaced by the real Codex links of R-033) and its header bullet. The prototype FR rule `^Opening Codex · (.+)$` stays in `src/i18n/fr-rules.ts`.
- P-10b / R-043: a client-deliverable record is shared with the client only when released **and** of Client confidentiality (`sharedWithClient` in `documents.ts`, also guarding `acknowledgeDocument`); an internal meeting's minutes (MIN, Internal) or an Internal / Supplier record from the index read no longer reach the portal, the R-138 categories, the client vault, the register export, the download or the acknowledgement (`documents-confidentiality.test.ts`, docs `actions.test.ts`).
- R-033: a read that skips a record for an unknown project or document type keeps its own `since` as the next one (new column `document_index_syncs.next_since`, migration `drizzle/0031_curved_annihilus.sql`; `nextCodexIndexSince` replaces `lastCodexIndexRead`), so the record comes back once the project or type exists; while one stays unknown, each read asks again from that mark (the whole index if it was the first read); `synced_at` stays the banner's "Last sync" (`index-review.test.ts`). Superseded by the last line below.
- R-033: a new revision of an indexed record is audited ("revision B → C · synced from Codex"); released over a released one, it withdraws the previous revision (KPI, withdrawal line), which the status-change rule never did (`index-review.test.ts`).
- R-033 (second integration review): the held read mark made every read re-apply unchanged Codex records — a historical Codex project holds it for good, so hourly — reverting a local Freeze or Propose release and closing outbox decisions Codex had not received. The mark now always moves to the read's time; a record skipped for an unknown project or type waits in the new table `codex_index_awaiting` (migration `drizzle/0032_past_cammi.sql`); once both exist, the read asks Codex again for that project from the skipping read's `since` and creates only those records, when not indexed yet (`applyCodexIndex` `onlyNew`); a failed re-read is logged and retried by the next read; skipped entries carry the record's project and type codes (`index-review.test.ts`, `index-read.test.ts`).
