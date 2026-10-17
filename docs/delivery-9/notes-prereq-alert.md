# Delivery 9 — lot "prereq-alert" (R-121): J-15 alert on an unconfirmed client prerequisite

Owner decision D-4 ★ "Notification et proposition de risque" (X-6a). Unblocked by the business clock (R-013).

## 1. What was built

A daily job (`site-prerequisite-alerts`, every 24 h, lease 15 min, first run 50 s after the worker starts) finds the client
prerequisites that became late at the business date — the Site screen's own J-15 rule (`isPrerequisiteLate`) — on projects
whose site sheet is open (Études … Mise en service & SAT). Each one is alerted once: one bell notice to the PM of record,
kind `alert`, "Client prerequisite unconfirmed at J-15 — raise a risk?" / « Prérequis client non confirmé à J-15 — ouvrir un
risque ? », sub-line "{prerequisite} · {activity} · {need date}", link `/projects/{code}/site?prereq={position}`.

The Site row then offers **"Raise as a risk"** (« Ouvrir un risque »): the existing "New risk" form, pre-filled — title "Late
client prerequisite — {title}", category Contractual / client (else the first active one), owner the PM of record when on the
owner list (else the list's first owner), response Mitigate, P and I 3; stored with the cause as trigger and the
prerequisite's plan activity. A lead confirms; the risk is linked to the prerequisite (`site_prerequisites.risk_id`) and the
row shows the risk instead of the proposal. No new risk status.

| Piece | Where |
|---|---|
| Pure rules | `src/domain/prerequisite-alerts.ts` (which prerequisites to alert, when raising is offered, the draft, the trigger text) |
| Job writer, risk writer | `src/server/dal/prerequisite-alerts.ts` (`alertLatePrerequisites`, `raisePrerequisiteRisk`) |
| Server Function, button | `src/features/site/prerequisite-risk-actions.ts`, `prerequisite-risk-button.tsx`; Site page reads `?prereq=` |
| Schema | migration `0033`: `site_prerequisites.alerted_needed_by`, `alerted_at`, `risk_id` (FK risks, ON DELETE SET NULL) |
| Job | `src/domain/jobs.ts`, `src/server/jobs/definitions.ts`; `docs/EXPLOITATION.md` §8 |
| French | `src/i18n/extra/d9-prereq-alert.json`; system message `site.prerequisiteRiskRaised` |

**Idempotent.** The job claims each prerequisite with a conditional update (still pending, same need date, not yet alerted
for it): a rerun or a second worker sends nothing more. A prerequisite only moves forward (Pending → Confirmed → Signed), so
it is alerted again only if its need date changes while pending and it becomes late at the new date.

**Rights.** Raising is for a lead of the project (PM of record, co-PM, deputy, director) who can edit Site and Risks —
checked in the Server Function and again in the writer (stamp, not yet raised, still late). Audit row "risk raised · R-21"
on the prerequisite, activity line.

## 2. Demo data set

HLT-026 has two pending prerequisites: quai 4 (needed 2 Nov, J-15 = 18 Oct) and HT 11 kV (needed 20 Nov, J-15 = 5 Nov). At
the demo date (25 Sep 2026) the first run alerts nothing; nothing displayed changes. With the real clock the quai 4 alert
leaves on 18 Oct and the HT alert on 5 Nov.

## 3. Tests

`src/domain/prerequisite-alerts.test.ts` (7), `src/features/site/prerequisite-risk.test.ts` (6, all nine personas): the
demo run, one notice to the PM only and nothing on reruns, a moved need date, the page marking and offering, refusals
(non-leads, client, stale stamp, unknown owner, not late), the raise with its audit and activity, the writer's re-checks.

## 4. Open questions for the owner

1. Recipients: the PM of record only. Also co-PMs and deputies, or the director when the PM has no account?
2. Timing: every 24 h from the worker's start — or at a fixed hour (early morning)?
3. The "New risk" owner list is the prototype's team; on HLT-026 it lacks the PM (Romain Aubert). Add the PM of record?
4. The Site card subtitle still mentions a "client letter" at J-15 — not built (D-4 asked for the notice and the risk).
5. Raise a risk from a prerequisite before it is late too?
