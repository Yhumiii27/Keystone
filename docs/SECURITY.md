# Security policy — Keystone PM

Keystone PM is EPC2i's internal project and portfolio management application. This page says how its dependencies are watched
and updated, how to report a vulnerability, which advisories are known, and what an external penetration test must cover
before production (R-174). The French runbook for IT is [`docs/EXPLOITATION.md`](EXPLOITATION.md).

> **Status.** The dependency watch below acts once delivery 7 and 8 are merged into the default branch `main` (R-001, waiting
> for the owner): until then GitHub ignores `.github/dependabot.yml` and the weekly audit schedule. The external penetration
> test waits for the hosted beta server (I-1a, R-003) and a provider chosen by the owner. **R-174 stays "en cours".**

## 1. Update policy (default — the owner and IT confirm it)

| What | Default | Where it is enforced |
|---|---|---|
| High or critical advisory in a **production** dependency | Fixed or mitigated within **7 days** | `.github/workflows/audit.yml` fails on it (pull requests, pushes to `main`, every Monday) |
| Moderate / low advisory | Reviewed at the monthly update | Reported by the same workflow, does not fail it |
| Minor and patch updates | Grouped weekly pull request, merged **at least monthly** after review and a green CI | `.github/dependabot.yml` (npm and GitHub Actions) |
| Next.js | Patch releases followed as they come out (security fixes are shipped as patches); `next` and `eslint-config-next` always move together (one Dependabot group) | Dependabot group `nextjs` |
| Major updates | Planned work, never merged from a Dependabot pull request without reading the upgrade guide (see `AGENTS.md`: Next.js 16 has breaking changes) | Review |

Rules:
- **Never merged automatically.** Every Dependabot pull request is reviewed by the team and passes the full CI (typecheck, lint,
  unit tests, build, end-to-end, container image).
- **Security updates:** the owner turns on *Dependabot alerts* and *Dependabot security updates* in the repository settings
  (Settings › Code security). `dependabot.yml` alone only gives the weekly version updates.
- **A new advisory turns the audit red on an unrelated pull request** (the advisory feed changes, not the code). Triage, in this
  order: update the package (or its parent); pin the fixed version with an `overrides` entry in `package.json` and re-run the
  tests that use it; or record a **dated risk acceptance** in §3 below with the reason it is not exploitable and the date it
  will be reviewed. The check is never removed or weakened.

## 2. Reporting a vulnerability

Report it privately — never in a public issue — to: **`[contact sécurité à fournir par le responsable produit / la DSI]`**.

Give the affected screen or route, the steps to reproduce and the impact you observed. You get an acknowledgement within
3 working days (default to confirm). Please do not test against production data and do not access other people's records
beyond what is needed to show the problem.

## 3. Known advisories (12 October 2026)

`npm audit --omit=dev` (production dependencies): **0 vulnerabilities** since the `uuid` override below.

| Package | Severity | Where | Status |
|---|---|---|---|
| `uuid` < 11.1.1 (GHSA-w5hq-g745-h8pq, missing buffer bounds check in v3/v5/v6 when `buf` is given) | moderate | production, through `exceljs` 4.4.0 (Excel exports and imports) | **Fixed by an override** `"overrides": { "uuid": "11.1.1" }` in `package.json` — pinned exactly: 11.1.1 still ships CommonJS (`exceljs` loads it with `require`), uuid ≥ 12 is ESM-only. The Excel export and import tests pass with it. It was not exploitable anyway: `exceljs` only calls `v4()` without a buffer. Review when `exceljs` publishes a release with a fixed `uuid`. |
| `braces`, `micromatch`, `fast-glob`, `@next/eslint-plugin-next`, `eslint-config-next` | high | **development only** (ESLint configuration of Next.js 16.4.0) | Not in the server or the browser bundles. Fixed by moving `next` and `eslint-config-next` together to a release whose ESLint plugin no longer pulls the vulnerable `fast-glob` chain — a Next.js upgrade, planned work (§1). |
| `esbuild` ≤ 0.24.2, `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `drizzle-kit` | moderate | **development only** (`npm run db:generate`) | The esbuild development server is never started; `drizzle-kit` only generates migration files on a developer's machine. Review at the next `drizzle-kit` release. |

The audit gate (`--omit=dev --audit-level=high`) does not see the development advisories: they are tracked here and in the
weekly report step of the audit workflow.

## 4. Penetration test — scope for the provider

The test runs on the **hosted beta server** (I-1a) with **`KEYSTONE_AUTH=entra`** — never in demo mode, whose "View as"
switcher is a demonstration feature with no sign-in (and is only ever exposed behind the host's basic authentication).

### 4.1 Test accounts

- IT creates, in the EPC2i Entra ID tenant, one test account per Keystone role — `director`, `pm`, `depthead`, `member`,
  `englead`, `quality`, `procurement` (and `finance` once R-044 is merged) — each with the matching app role of the Keystone app
  registration (or a group mapped by `ENTRA_GROUP_ROLES`). A client account waits for the client portal (I-2b).
- Each account's e-mail must be on a person in Keystone: the base is seeded for the test (the demo data set, whose persona
  e-mails are listed in `src/config/personas.ts`, or a first list of people from the owner — open question of
  `DELIVERY-7.md` §8). Two PM accounts on different projects are needed to test the project-team rule.
- Accounts are disabled after the test.

### 4.2 What to test

| Area | What Keystone promises | Where |
|---|---|---|
| Sign-in (R-038) | OIDC authorization code + PKCE; sealed, `HttpOnly`, `Secure` session cookie (12 h, absolute); state and nonce checked; sign-out clears the session; a token without a Keystone role is refused | `/api/auth/sign-in`, `/api/auth/callback`, `/api/auth/sign-out`, `src/proxy.ts` |
| Rights by role × named project team (R-041) | Write rights follow the project's team (PM of record, co-PM, deputy, director = PM rights; referents and members = their own items); read-only outside one's team; re-checked server-side in every Server Function and DAL writer | every screen of `src/config/screens.ts` |
| Client refusal (R-042, P-1, P-10a, P-10b) | A client is sent home on any screen outside their workspace and on another organisation's project; never sees internal meetings, purchasing, NCRs, internal approvals, supplier prices | pages, exports, search, notifications |
| Prices (R-046) | Hourly rates for the director and PMs; supplier prices for the director, PMs and procurement; masked elsewhere, exports included | `/api/export/[screen]` |
| Server Functions | Each validates its input and the viewer server-side (Next.js checks the origin of Server Function calls) | `src/features/*/actions.ts` |
| Route Handlers | Same-origin check on state-changing ones, rights, rate limits | `/api/import`, `/api/export/[screen]`, `/api/tasks/[taskId]/files`, `/api/tasks/[taskId]/files/[fileId]`, `/api/meetings/[number]/transcript`, `/api/photos`, `/api/photos/[id]`, `/api/interchange/mspdi/[code]`, `/admin/integrations/audit.csv`, `/api/health`, and the Cursus events endpoint of the connectors lot (`/api/integrations/cursus/events`, API key) |
| Uploads | 20 MB cap (also for chunked bodies), extension allowlist and content sniffing per purpose, antivirus when `KEYSTONE_FILE_SCAN=clamav` (R-175: 422 infected, 503 scanner down, 410 for a flagged stored file), files stored under generated names | upload routes above, `importTranscriptAction` |
| Rate limits (R-008) | Per viewer and address, per instance: uploads 30/min, imports 10/min, exports 60/min, transcript analyses 10/min, browser error reports 20/min → 429 with `Retry-After` | `src/server/http/request-guard.ts` |
| Headers and CSP (R-008) | Nonce-based Content-Security-Policy with `strict-dynamic`, `frame-ancestors 'none'`, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy (camera for Keystone only), COOP, HSTS on the host (production builds) | every response |
| Error pages (R-176) | No stack trace or internal detail; an incident id to quote | every route |
| Health (R-009) | Public, no host, driver, version or error text | `/api/health` |
| Audit trail | Who changed what, append-only once the audit lot (R-168) is merged | Admin › Activity & audit |

Out of scope: the sibling applications (Codex, Vigie, Cursus — their own owners), the hosting platform itself (Coolify, the
server, its TLS), Microsoft Entra ID.

### 4.3 Report

Findings with severity, reproduction steps and the affected role / route; a re-test of the fixes. The report is kept by the
owner; this page lists the open findings that are accepted.
