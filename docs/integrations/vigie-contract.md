# Keystone ↔ Vigie — interface contract (draft for the Vigie team)

> **Status: proposal (delivery 8, lot `connectors`; R-023, R-024, R-025, R-096).** Written from what Keystone already
> implements (`src/server/integrations/vigie/`). Vigie publishes no API yet (open questions V-2, V-3): every endpoint below
> is Keystone's proposal, marked `TODO(vigie)` in the code, until Vigie confirms or changes it. Sections marked
> **PLACEHOLDER** are not agreed and must not be built as written. Keystone never modifies Vigie; Vigie owns the ECOs, the
> project non-conformities (NCR, 8D, action plans) and the site HSE register. Keystone lists them (read-only mirror),
> opens them in Vigie (links) and sends the progress its users record (outbox "pending sync with Vigie").

## 1. Connection

| Item | Proposal |
|---|---|
| Base URL | `VIGIE_API_URL` on Keystone's side (e.g. `https://vigie.epc2i.local`). Unset → Keystone runs its local mock over the mirror. |
| Authentication | **PLACEHOLDER (V-3):** header `X-Api-Key: <VIGIE_API_KEY>` on every call. Provisional: Vigie chooses its scheme (API key, OAuth client credentials, mTLS). |
| Format | JSON, UTF-8, `content-type: application/json`. Dates `YYYY-MM-DD`, timestamps ISO 8601 with offset. |
| Time-out | Keystone waits 5 s per call; an error or time-out keeps the last mirror (the screen says when it was refreshed). |
| Disabled connector | IT can disable the Vigie row in Keystone (D-7a): nothing is exchanged; progress waits in the outbox. |

## 2. Lists Keystone reads (full refresh)

Keystone reads each list at most **once a minute** per server process, and the outbox job sends progress every 5 minutes.
Each list is a **full refresh**: what the answer omits is removed from Keystone's mirror — except a record that still has
progress Keystone has not delivered (pending or failed); that record stays until every entry is sent (R-023). Therefore:

- **closed records must stay in the lists** (a closed NCR, a released or rejected ECO) — Keystone's KPIs and history read them;
- a record must not leave `source=keystone` while Keystone may still send progress on it.

### 2.1 `GET /api/ecos?source=keystone` → `VigieEcoRecord[]`

The ECOs that concern Keystone's parts and projects (`src/server/integrations/vigie/types.ts`, `VigieEcoRecord`).

| Field | Type | Notes |
|---|---|---|
| `number` | string | Vigie's ECO number ("ECO-2026-015"); Keystone's key |
| `title` | string | Free text; may be long (Keystone also pre-fills titles that carry a warranty claim number, see §4) |
| `type` | `rev` · `sub` · `asm` · `sup` · `obs` | part revision, BOM substitution, assembly structure, supplier / make-buy, obsolescence |
| `status` | `draft` · `impact_analysis` · `in_approval` · `released` · `rejected` | release is automatic in Vigie |
| `interchangeability` | `yes` · `no` · null | null = not assessed (Keystone refuses "Submit for approval" while null) |
| `fromRevision`, `toRevision` | string | |
| `costEur`, `scheduleDays` | number | |
| `stockImpact` | string | |
| `documentRefs` | string[] | Codex document references |
| `requestedBy` | string | display name |
| `raisedOn` | date | |
| `pendingDispositions` | number | |
| `locked` | boolean | |
| `parts` | string[] | catalogue references |
| `projects` | string[] | project codes — **the Keystone code until NEW-SYS-1 / R-022 (see §6)** |
| `approvals` | `{ key, decision, approver, decidedBy, decidedAt }[]` | `key`: `englead` · `quality` · `pm` (the director holds none); `decision`: `pending` · `ok` · `rejected`; `approver`: who is expected (text); `decidedBy` / `decidedAt` when decided |
| `effectivity` | `{ targetType, targetRef, label, disposition, isAutomatic, note, fittedPartRef, fittedRevision }[]` | `targetType`: `project` · `machine`; `disposition`: `update` · `pinned` · `retrofit` (machines) · `na` · null |
| `updatedAt` | timestamp · null | last change in Vigie |
| `partStatusChanges` | **PLACEHOLDER (V-2 proposal, for R-102 later)** | optional list of `{ partRef, status }` an ECO changes on release; not read by Keystone today |

### 2.2 `GET /api/ncrs?source=keystone` → `VigieNcrRecord[]`

| Field | Type | Notes |
|---|---|---|
| `projectCode` | string | see §6 |
| `number` | string | **Vigie's own number** (V-3a, e.g. "EV-2026-130"); unique per project. Keystone never sends NCR numbers of its own and accepts letters, digits and dashes (`NCR-029`, `EV-2026-130`). |
| `vigieRef` | string · null | Vigie's record id (opens `/evenements?etat=tous&sel=<id>`) |
| `title` | string | |
| `severity` | `minor` · `major` · `critical` | |
| `source` | `site_inspection` · `goods_receipt` · `survey` · `workshop` · `client` · `audit` | |
| `status` | `open` · `containment` · `root_cause` · `corrective_action` · `verification` · `closed` | |
| `activityCode`, `partRef`, `deliverableNumber`, `supplierName` | string · null | what Keystone pre-filled, echoed |
| `inspectionNumber` | string · null | the ITP inspection the NCR was reported from (Q-6b), when Vigie echoes Keystone's `inspection` prefill |
| `raisedBy`, `owner` | string | display names |
| `raisedOn`, `dueOn` | date (dueOn may be null) | |
| `rootCause`, `action`, `isoClause` | string | |
| `costKeur` | number | |
| `updatedAt` | timestamp · null | |

### 2.3 `GET /api/hse?source=keystone` → `VigieHseRecord[]`

| Field | Type | Notes |
|---|---|---|
| `projectCode` | string | a project's register is always sent whole |
| `vigieRef` | string · null | "PP-2026-013", "PF-2026-030" |
| `kind` | `prevention_plan` · `induction` · `permit` · `register` | |
| `title` | string | |
| `status` | `signed` · `ready` · `pending` · `recorded` | |
| `statusText` | string · null | free status text ("0 déclaré") |
| `dateOn` | date · null | |

## 3. Progress Keystone sends (outbox)

Every entry carries `keystoneId`, Keystone's outbox id: **Vigie must treat a repeated `keystoneId` as the same entry**
(an entry may be sent twice after a time-out or by two workers). Vigie answers `2xx` with `{ "id": "<Vigie's id>" }`;
any other status leaves the entry "failed" and it is sent again at the next run (no retry limit today — DELIVERY-7 §8).

### 3.1 `POST /api/ecos/:number/progress`

```json
{
  "kind": "approval",                // or "step"
  "approvalKey": "pm",               // approval only: englead · quality · pm
  "decision": "ok",                  // approval only: ok · rejected
  "targetStatus": null,              // step only: impact_analysis · in_approval
  "comment": "OK for HLT",
  "actor": { "name": "Romain Aubert", "role": "pm" },
  "recordedAt": "2026-09-25T09:12:00.000Z",
  "keystoneId": "8f0c…"
}
```

**PROPOSED, not built (R-024):** with Microsoft Entra ID sign-in (R-038) Keystone can add a stable actor identity —
`actor.id` (Entra object id) and `actor.email` — so Vigie checks approval-key ownership on its own users rather than on a
display name. Vigie to confirm before Keystone sends it.

### 3.2 `POST /api/ncrs/:project/:number/progress`

```json
{
  "kind": "step",                    // or "verification"
  "decision": null,                  // verification only: approved · rejected
  "fromStatus": "containment",
  "targetStatus": "root_cause",
  "comment": null,
  "actor": { "name": "Gabriel Comte", "role": "quality" },
  "recordedAt": "2026-09-25T10:00:00.000Z",
  "keystoneId": "1b7e…"
}
```

`:project` is the project key of §6; `:number` is Vigie's NCR number.

**PLACEHOLDER (open question R-023):** progress on a record Vigie no longer lists (deleted, or moved out of
`source=keystone`) cannot be delivered (probably a 404 at every run). Proposal: Vigie answers `410 Gone`, and Keystone
stops sending it and shows it as refused. Not built — the owner and Vigie to decide.

## 4. Links Keystone opens in Vigie (`src/server/integrations/vigie/links.ts`)

All links open outside Keystone (`target=_blank`). Empty parameters are left out. `source=keystone` lets Vigie link back.

### 4.1 ECO module (R-024 — routes and parameters agreed by NEW-D4-1 "a", NEW-VIGIE-1 "a")

Vigie adopts these routes when it builds its ECO module (English parameter names, as agreed — Vigie's other routes are French):

| Route | Parameters | Used by |
|---|---|---|
| `/modifications-techniques` | `part`, `project` (register filters) | "Open in Vigie" lists (part record, BOM) |
| `/modifications-techniques/<ECO number>` | — | every ECO row and drawer |
| `/modifications-techniques/nouvelle` | `part`, `project`, `title`, `source=keystone` | "Raise ECO" (BOM node, part record, warranty claim) |

- `title` is free text and may be long (the warranty claim drawer puts the claim number in it).
- **PLACEHOLDER (not agreed, notes-quality-site §5.1):** an optional `claim` parameter carrying the warranty claim number,
  so the ECO is linked to it. Open proposal.

### 4.2 Reports and lists (V-3 proposals; Vigie's routes `/evenements`, `/signaler`, `/prevention`, `/prevention/carte`)

| Link | Route and parameters | Status |
|---|---|---|
| NCR record | `/evenements?etat=tous&sel=<vigieRef>`; without it `/evenements?etat=tous&type=NC&q=<number>` | existing routes |
| NCR list ("Manage in Vigie") | `/evenements?type=NC&projet=<project>` | `projet`: R-025 proposal (V-3b "a") |
| Report form ("Report in Vigie", ITP failure) | `/signaler?type=NC&projet&article&activite&titre&lieu&inspection&source=keystone` | Vigie reads `lieu` only today; the others are V-3b proposals |
| Supplier NCR from a rejected receipt | `/signaler?…&fournisseur&code_fournisseur&commande&reception&quantite` (plus `projet`, `article`, `titre`) | R-096 proposal (NEW-D4-3 "a", SC-3b "a"); `code_fournisseur` = Sage X3 supplier code, empty until the Sage supplier file is loaded (NEW-D4-4) |
| Incident report (site) | `/signaler?projet&lieu&source=keystone` | V-3 proposal |
| Prevention plans, permits | `/prevention?plan=<id>`, `/prevention?onglet=permis&permis=<id>`; lists `/prevention?projet=<project>`, `/prevention?onglet=permis&projet=<project>` | `projet`: R-025 proposal |
| Near-miss register | `/evenements?etat=tous&type=PA&projet=<project>` | `projet`: R-025 proposal |
| Co-activity map | `/prevention/carte?projet=<project>` | R-025 proposal |

- **No echo yet (V-3):** whether Vigie can echo `inspection` (ITP) or the receipt (`reception`) on the NCR it creates, so
  Keystone shows the NCR number there. Keystone records nothing about a declared supplier NCR today.

## 5. Notices Keystone derives from a refresh (R-015, X-6a)

Keystone compares its mirror before and after a full refresh (HTTP mode only) and notifies in its own bell — no call to Vigie:

- an NCR seen for the first time → the project's leads and its quality / engineering referents;
- an ECO entering `in_approval` → the holder of each pending key (PM key → the leads of the ECO's projects).

Vigie needs nothing more than the lists of §2 for this.

## 6. Project key — WAITING FOR NEW-SYS-1 / R-022

**Not agreed.** Keystone sends and expects its own project code ("HLT-026") in `projects`, `projectCode`, the NCR progress
URL, and the `project` / `projet` link parameters. Vigie's events carry its own project ids ("K-2025-042"). The owner's
answer to NEW-SYS-1 ("Autre réponse": #000 engineering number, XXX000 analytic code, reconciled on Keystone's project sheet)
and R-022 decide the shared key. Keystone builds every Vigie project parameter through one helper (`vigieProjectParam`), so
the mapping changes one place; this contract will be reissued with the agreed key.

## 7. Open questions (owner / Vigie)

| Id | Question |
|---|---|
| V-2 / V-3 | Endpoints, payloads and authentication of Vigie's API (this document is Keystone's proposal) |
| V-3 | `/signaler` parameter names and echo of `inspection` / `reception` on the created NCR |
| NEW-SYS-1 / R-022 | Shared project key (§6) |
| R-023 | Progress on records Vigie no longer lists (§3 placeholder); retry limit of failed deliveries |
| R-024 | Stable actor id / e-mail in progress bodies (§3.1); optional `claim` prefill; `partStatusChanges` (R-102) |
