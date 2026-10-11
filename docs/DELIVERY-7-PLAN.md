# Delivery 7 — plan

> **Resume point.** Delivery 7 builds the items of `docs/RESTE-A-DEVELOPPER.md` that can be built now: priority "Bloquant production" or "Prochaine étape", status "non commencé" or "partiel", and nothing to wait for (or only the final values, with a working default). Each lot writes `docs/delivery-7/notes-<lot>.md`; when everything is integrated and reviewed, write `docs/DELIVERY-7.md` (same structure as `DELIVERY-6.md`).

## 1. Defaults taken for open points (owner to confirm)

| Point | Default built | Why |
|---|---|---|
| R-040 where roles are assigned | Roles come from Entra ID (app roles in the token, or group ids mapped by IT in configuration), the person from the e-mail matched to `persons`. No user-administration screen (absent from the prototype; D-7a: IT configures outside the app) | Keeps "no new tools without approval" and D-7a |
| R-038 demo mode | `KEYSTONE_AUTH=demo` (default in development and tests) keeps "View as"; `KEYSTONE_AUTH=entra` requires a signed-in session and hides "View as" | Demo and tests keep working; production is safe by configuration |
| R-002 database | `DATABASE_URL` set → PostgreSQL (node-postgres pool, migrations by `npm run db:migrate` at deploy); unset → PGlite as today | Hosting (I-1a) still open; both paths work |
| R-011 seed | `KEYSTONE_SEED=demo` (default) loads the prototype data set; `KEYSTONE_SEED=production` loads only reference data | A-15 |
| R-075 currency | Currency per contract, purchase order and invoice; budget rate per project entered by the director (or Finance), 1 for EUR | C-9 decided; finance supplies the rates |
| R-006 scheduled jobs | `npm run worker` runs the jobs on a timer (outbox redelivery, plan-trash purge, orphan-file prune); the Friday freeze waits for S-4 | Hosting-agnostic |

## 2. Lots

| Lot | Items | Depends on |
|---|---|---|
| platform-data | R-002 PostgreSQL, R-011 production seed, R-010 concurrent writes, R-009 logging and health, R-007 configuration | — |
| platform-web | R-008 HTTP hardening, R-176 error pages, R-016 CI and versioned end-to-end tests, R-006 job worker, R-021 real connector state | — |
| auth | R-038 Entra ID sign-in, R-039 real users (multi-role, department, client organisation) | — |
| rights | R-041 project team rights, R-042 P-1 on screens, R-043 P-10b, R-045 P-3, R-046 rates and supplier prices, R-047 Codex deposit, R-048 department heads, R-049 others' My work, R-050 minutes, R-061 plan structure | auth |
| cost-control | R-068 approved CRs into budget and contract, R-070 contingency register, R-071 contingency drawdowns, R-072 risk cost and EMV, R-073 EVM from Keystone data | — |
| contract-portfolio | R-075 currencies, R-076 invoice due dates, R-079 amendment milestones and signature, R-132 margin at completion, R-133 cash remaining spread, R-129 overview population, R-130 portfolio alert rules, R-131 status report per audience | — |
| operations | R-097 PO PDF as internal recap, R-098 stock issue activity and cost, R-099 reserved stock, R-103 BOM valuation, R-105 latest frozen revision, R-055 effective stage-change date, R-062 CR ↔ activities, R-124 Codex approvals outbox, R-106 "Validate release" starts the Codex circuit | — |
| quality-site | R-112 ITP results (Vigie NCR prefill when V-3 lands), R-114 rejected deliverable back in progress, R-115 New deliverable, R-120 Go needs a Cursus verdict, R-137 client issues handled by the PM, R-143 warranty claims end to end, R-144 as-built machines at delivery, R-126 photos | — |
| debt-ux | R-170 no runtime prototype reads, R-169 prototype constants, R-148 entered texts shown as typed, R-020 connector configuration by IT, R-146 tablet | — |

## 3. Not in this delivery

- Waiting for the owner or another system: R-012, R-013 (S-4), R-014 (NEW-SYS-1), R-022, R-053, R-058, R-060, R-069, R-083–R-085, R-093, R-094, R-096, R-102, R-113, R-118, R-119, R-147, the integrations R-023–R-037 and R-180, R-004 and R-005 (hosting), R-036 (mail relay), R-015 (needs real accounts in production).
- To decide: every "À décider" item and the new modules (R-158–R-166).
- R-001 (merge into `main`) and R-003 (PR #1) wait for the owner's review.
