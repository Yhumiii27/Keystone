# Delivery 7 — lot "rights" notes: project team rights, the client's limits, rates and prices, Codex, departments, My work, minutes, plan structure

Scope: `docs/DELIVERY-7-PLAN.md` §2 lot "rights" (R-041, R-042, R-043, R-045, R-046, R-047, R-048, R-049, R-050, R-061),
built on lot "auth" (`viewer.personId`, `viewer.organisation`, `viewer.department`).
Owner decisions applied: P-1, P-2, P-3, P-8a, P-9a, P-9b, P-10a, P-10b, L-4b, R-9 (answer b), NEW-D2-1, NEW-D3-1
(`docs/DECISIONS.md`).

The pure rules are in **`src/domain/rights.ts`** (one section per item); pages, Server Functions, Route Handlers and the
export providers all call them, so each rule is applied server-side in one place and the UI only hides what the server
would refuse anyway.

## 1. What changed

### R-041 — write rights follow the named project team (P-2, L-4b)

| Piece | Where | What |
|---|---|---|
| Team model | `project_members.project_role` (existing column, no migration) + `projects.pm_person_id` | Team roles `pm` (PM of record, or a co-PM when on a member row), `deputy`, `referent`, `team`. Several PMs per project are allowed. |
| Rule | `src/domain/rights.ts` `projectAccess` | `member` (on the team; the director on every project; a client on their organisation's projects), `lead` (PM of record, co-PM, deputy, or the director), `pm` (the team's PMs and deputies, not the director), `readOnly` (not on the team; never for the director), `refused` (a client on another organisation's project). Signed-in users are matched by person id, demo personas by short name. |
| Team reads | `src/server/dal/project-team.ts` | `listProjectTeams` (memoised per request, PM of record first), `getNamedTeam`, `teamCandidates` (EPC2i staff not on the team — never client contacts), `leadProjectCodes`, `memberProjectCodes`, `leadsProject`. |
| Team writes | same file, `src/features/team/team-actions.ts` | "Add to team" (person, team role), change role, remove — director and the project's PMs (`canManageTeam`; deputies, referents, members cannot). Each write: input validated (UUID, role code), one transaction, audit (area "Project team") + activity, then `revalidatePath('/', 'layout')` (rights change on every screen). The PM of record is not editable here (Projects register). A concurrent duplicate add is answered "Already on the project team". |
| UI | `src/features/team/project-team*.tsx`, Project resources page | "Project team" card: members with avatar, job title, department and team role tag; for managers, a role select and a remove button per member, and "Add to team". |
| Project context | `src/server/project-context.ts` | `getProjectContext` returns `isMine` (= member), `isLead`, `access`, `team`, `readOnly`; `getProjectScope` adds `isLead`, `access`; `readOnly` is now "not on the team" for everybody but the director (it used to apply only when the viewer owned some but not all projects — the rule flagged in `notes-auth.md` §6). `isMineProject(viewer, p, teams)` and `projectAccessResolver(viewer)` for exports and imports. |
| PM rights | `features/projects/actions.ts` (stage, deliverables — L-4b), `features/changes/actions.ts` (CR PM step), `features/eng/actions.ts` + `domain/engineering.ts` `canValidateRelease`, `dal/purchasing.ts` (PO approval), `dal/ops-common.ts`, `dal/engineering.ts`, `dal/eco.ts` + `integrations/vigie/progress.ts` (ECO PM key), `dal/myapprovals-identity.ts` (`managedProjects`), `features/requests/permissions.ts` (drafts) | Follow `isLead` / `leadProjectCodes` / `leadsProject`: the PM of record, co-PMs, deputies (and the director where the director already had it). |
| Imports | `src/server/interchange/rights.ts`, `jobs.ts`, `features/admin/interchange-actions.ts`, `app/api/import/route.ts` | On an existing project: schedules and budget lines need the PM rights; BOM and assignments need the team; a head of department imports assignments on any project (they staff every project from their department). |
| My projects | `domain/portfolio.ts`, `dal/portfolio.ts` | The role tag shows the team role ("Project manager", "Deputy project manager", "Referent", "Team member"); read-only follows the team. |
| Demo data | `src/server/db/seed/project-team.ts` | Antoine Girard (engineering lead) and Gabriel Comte (quality manager) are seeded as referents of Harbor Line (HLT-026), so the demo englead and quality personas keep editing the default project; elsewhere they read. A database seeded before delivery 7 gets them once (no team row with a role other than `team` yet). |

### R-042 — the client is refused outside their workspace and on other organisations' projects (P-1, P-10a)

- `refuseClient()` = `redirect('/')` (their Home). Applied by `getScreenAccess(screen)` and `getProjectContext(code, screen)`
  (so every page, Server Function and Route Handler that uses them refuses), by the project layout
  (`projects/[code]/layout.tsx`, another organisation's project), by `PageHeader` (backstop), and by `/projects/<code>`
  (a client lands on their portal, not the Plan). Internal roles keep the read-only view outside their workspace.
- Pages without a context helper got an explicit guard: portfolio overview, cash, map, schedule, projects register, My
  projects, Resources, Approvals index.
- Sidebar and project switcher: the client's own organisation's projects only (`getShellNav`, `getProjectScope.pool`).
- Search (`searchShell(q, code, viewer)`): a client gets their projects (opening the portal) and the change requests of
  their current project — no plan, parts, people, ECO, risk, drawing, purchase order or NCR.
- Notifications: a client only receives those whose target is in their workspace, on their projects, not about NCRs or
  purchasing (`clientSeesTarget`).
- Home: the client's current project is the last one used when it is theirs, else their first project with data; never
  another organisation's.
- Task files (`/api/tasks/...`) and meeting transcripts (`/api/meetings/.../transcript`): 403 for every client.
- Exports: unchanged route (403 outside the workspace / other organisation); the "Export" button is shown again on every
  page a client can open (they are never on an outside page any more).

### R-043 — what the client does not see of their own project (P-10b)

- Meetings: external meetings only; no transcript, no client-question bridge (`getMeetingsScreen(code, { client })`, the
  page, the export — workbook without "Client questions", minutes PDF never of an internal meeting).
- Quality: the client's view is the deliverables register only (no NCR register, NCR links stripped from deliverables;
  the PV export carries no NCR).
- Purchasing: never in search, notifications or exports for a client (screens already refused by R-042).
- My approvals: a client receives change requests and deliverable acceptances only (`CLIENT_APPROVAL_KINDS`), and nothing
  on another organisation's project (counts included).
- Documents: a client sees and downloads the documents shared with their organisation only.

### R-045 — project creation (P-3)

`CREATE_PROJECT_ROLES = ['director', 'pm']` (`features/projects/permissions.ts`): the "New project" button is hidden for the
department head (Portfolio overview) and `createProjectAction` refuses every other role.

### R-046 — rates and supplier prices (NEW-D2-1)

- Hourly rates: unchanged rule (`canSeeRates`: director, PM) now applied to the task sheet too — the rate never reaches the
  browser of another role (`taskSheetData(..., { rates })`), the cost note reads "7.0 h → Labor · WP …", the task export
  leaves out the rate and the actual cost.
- Supplier prices (`canSeeSupplierPrices`: director, PM, procurement): masked with `•••` on Purchase orders, Sourcing
  (comparisons, invoices, best-price flags), Stock, Project BOM (KPIs, tree, flat list, comparison, spares), PLM (no price
  sort, no commercial lines in the drawer); the spares order dialog sends no unit price. Exports: `pricedWorkbook` /
  `pricedPdf` remove the euro columns and mask euro amounts in fields and KPI tiles (procurement, orders + PO document,
  stock, BOM + spares document, PLM); `ExportContext.pricesMasked`.

### R-047 — Codex (NEW-D3-1)

"Deposit in Codex" and "New revision · Codex" only for the project's internal team (and the director), inside their
workspace; a revision must belong to the same project (`canDepositInCodex`). "Sync now" on Documents: the director only
(`canSyncCodex`). Client downloads: shared documents of their organisation only.

### R-048 — department heads (P-8a)

A head of department decides (approve, propose reschedule, reject) only the requests of the departments they head
(`canDecideDepartment`, Server Functions included); the director decides for all. On `/resources/approvals/<dept>` a head
sees only their departments (chips filtered; another department's page redirects to theirs); viewers heading no
department read every department as before. The approvals export follows the same rule.

### R-049 — someone else's My work (R-9 answer b)

`canViewPersonWork`: the director everybody, a head of department the people of the departments they head, a PM (co-PM,
deputy) the people working on the projects they lead (team, PM of record or tasks), everybody themselves.
`myWorkAccess(viewer)` applies it to the My work picker (only those people), `?person=` (otherwise ignored with a note),
the task sheet's back link and the My work export. `PERSON_PICKER_ROLES` is removed.

### R-050 — minutes (P-9b)

Writing and sending the minutes (send, transcript import / analysis / review, "Add to minutes", proposals) is reserved to
the meeting's organiser (by person when known, else by name) and the project's PMs and deputies (`canWriteMinutes`). The
other internal team members keep adding notes and ticking actions; the "Send minutes" button is replaced by the hint "The
organiser or the project manager sends the minutes". The client reads.

### R-061 — plan structure (P-9a)

WBS structure, names, owners, durations, budgets, links, calendars, removal and the scheduling decisions: the project's PMs,
deputies and the director (`canEditPlanStructure`). An activity's owner enters the % complete of their own activities
(`canEditActivityProgress`). To make that reachable, **Plan was added to the workspace of the team member and of
procurement** (`src/config/screens.ts`), who own activities but had no Plan. The Server Functions check the owner of the
activity (`ownerCodeOfViewer`).

### Translations

`src/i18n/extra/d7-rights.json` (registered after `d7-auth` in `src/i18n/extra/index.ts`): team roles, the team card and
its messages, the refusals (team, Codex, departments, minutes, plan), the price hint, the My work note. Test:
`src/domain/rights.test.ts` "French".

## 2. Rules and defaults chosen

- **Director**: member and lead of every project, never read-only; not "the project's PM" for P-9b (minutes) unless
  organiser or on the team as PM/deputy.
- **Deputy** = PM rights (stage, deliverables, plan structure, minutes, PO approval, ECO PM key, drafts) but cannot change
  the team (only the director and the PMs do).
- **Referent** = team member with a named responsibility; same write rights as a team member.
- **Client refusal** = redirect to their Home (not a 403 page) for pages and Server Functions; Route Handlers answer 403.
- **Internal roles** outside their workspace: unchanged read-only view (route matrix: every route 200 for internal personas).
- **Head of department and assignments**: imports of resource assignments on any project (not limited to their teams).
- **Supplier prices**: director, PM, procurement (NEW-D2-1 "+ achats pour les prix"); rates: director, PM (unchanged).
- **Codex "Synchronise"**: director only on Documents (Keystone has no administrator role); the Activity & integrations
  "Sync now" of the Codex connector row is unchanged (director and PM, the editors of that admin screen).
- **Demo referents** on HLT-026 (see §1) so the default demo keeps working for the engineering lead and the quality manager.

## 3. Old → new displayed values

| Where | Old | New | Decision |
|---|---|---|---|
| Owner lists of Harbor Line (Plan owners, risk owners, punch owners, projectData team) | DEFS team (8 people) | + Antoine Girard, Gabriel Comte (seeded referents) | R-041 / P-2 |
| `getProjectTeam('HLT-026')` | 8 | 10 | R-041 |
| My projects — quality manager | fallback "No project assigned to you — whole portfolio shown" | Harbor Line card tagged "Referent" | R-041 |
| My projects role tags | "Project manager", "Team member" | also "Deputy project manager", "Referent" | R-041 |
| Header primary / edit controls on a project the persona is not on (e.g. NDC-031 for englead, quality, depthead; HLT-026 site for depthead) | shown (workspace rule only) | hidden — read-only | R-041 / P-2 |
| Client on a screen outside their workspace / another organisation's project | read-only page with the banner | redirected to their Home | R-042 / P-1, P-10a |
| Client Home on another organisation's project | that project's figures | their own project's figures | R-042 / P-10a |
| Client search, notifications, sidebar projects | every project / hit | own organisation's projects, workspace targets only | R-042, R-043 |
| Client meetings | every meeting, transcripts, client-question bridge | external meetings only | R-043 / P-10b |
| Client quality | deliverables + NCR register | deliverables only, no NCR link | R-043 / P-10b |
| Client My approvals | all providers (empty except CR, deliverables) | CR and deliverables only | R-043 / P-10b |
| "New project" for the department head | shown on Portfolio overview | hidden | R-045 / P-3 |
| Prices for englead, quality, depthead, member, client | amounts | `•••` (screens), columns removed (exports) | R-046 / NEW-D2-1 |
| Task cost note for roles without rates | "7.0 h × €…/h = €… actual cost → Labor · WP …" | "7.0 h → Labor · WP …" | R-046 |
| Documents "Deposit" / "New revision" for off-team viewers | shown | hidden | R-047 / NEW-D3-1 |
| Documents "Sync now" for non-directors | shown | hidden | R-047 / NEW-D3-1 |
| Approvals department chips for a head | every department | their departments | R-048 / P-8a |
| My work picker | every pool person for director, pm, depthead, quality, procurement | the people the viewer may open | R-049 / R-9 |
| My work `?person=` refused | silently ignored | ignored with "You can open the work of your department and of your projects' teams only — showing yours" | R-049 |
| Minutes footer for non-organiser non-PM | "Send minutes to all invitees" | "The organiser or the project manager sends the minutes" | R-050 / P-9b |
| Sidebar of the team member and procurement | no Plan | Plan (read-only except their own activities' %) | R-061 / P-9a |

## 4. Migration

None. The team roles use the existing `project_members.project_role` column (default `team`). Existing databases get
the demo referents once through the seed backfill (`demoReferentsToBackfill`).

## 5. Tests

- `src/domain/rights.test.ts`: every rule of the module, by persona and by person id; the French strings.
- `src/features/team/team-actions.test.ts`: team DAL (order, candidates, lead/member projects, backfill idempotence), the
  three Server Functions (who manages, validation, DAL refusals, audit, activity, rights following the team, client
  redirect, FR messages).
- `src/features/requests/approvals-page.test.ts` and `actions.test.ts` (R-048), `src/features/mywork/mywork-render.test.ts`
  (R-049), `src/features/projects/wizard-actions.test.ts` (R-045), `src/server/dal/shell.test.ts` (client sidebar and
  search), `src/server/approvals/approvals.test.ts` (client inbox), `src/server/export/providers/providers.test.ts`
  (R-046 price masking, R-043 meetings export), `src/server/interchange/*` (import rights), plus the existing page and
  Server Function tests updated for the new refusals and the team-based read-only (each change commented with its
  decision id).
- Route matrix on a production build (`next build --webpack` into `.next-ci` — Turbopack refuses the worktree's symlinked
  `node_modules`; `next start` on 127.0.0.1:3317, fresh data directory): 215 routes (every global screen, every project
  screen for HLT-026, NDC-031, EWA-051, RCF-019, WSA-044, ERP-202, plus deep links) × 8 personas × EN/FR = 3 440 requests.
  Internal personas: all 200, no "being built" or error page (`/resources/what-if` lands on its `?project=` default as
  before). Client: 12 routes open (Home, My approvals, and Harbor Line's portal, documents, meetings, changes, quality, ITP,
  commissioning, trends), the 203 others send them home. Server log: start-up lines only.

## 6. Open questions for the owner

1. **Deputies' workspace**: a deputy PM whose role is not `pm` (e.g. a member) has the PM rights on the project but not
   the Projects register in their workspace (stage changes are made there). Give deputies the `pm` role, or add the
   register to their workspace?
2. **Director and minutes**: the director does not write / send minutes unless organiser or on the team as PM — keep?
3. **Plan for the team member and procurement**: added to their workspace so owners can enter their progress (P-9a). Keep,
   or should progress be entered from My work only?
4. **Change request PM step in My approvals** still goes to the PM of record named on the step; deputies decide it on
   Change control. Route it to every PM / deputy?
5. **Codex "Synchronise"**: "director and administrator" — Keystone has no administrator role; the admin connector row
   "Sync now" stays with the director and the PM. Which role is the administrator?
6. **Department heads off their teams**: they read projects they are not on (what-if, requests drafts) — should a head of
   department edit the resource side of every project of their department?
7. **Refusal style**: the client is redirected to their Home (no message). Add a toast / page "This page is not available
   in your portal"?
8. **Task sheet**: internal roles still read any task (R-049 restricts My work, the back link and the export only).
   Restrict the task sheet too?
9. **Demo referents**: the engineering lead and the quality manager are seeded as referents of Harbor Line only. Real
   teams will come from the owner (RACI matrix pending).
10. **Project team card**: naming the team needs a place in the UI; it was added as a card at the bottom of Project
    resources (no new screen, no new navigation entry). To validate (place, and whether the PM of record should be
    changeable there rather than in the Projects register).
