# Delivery 9 — lot "share views": follow-up views for Crucible and Arche (R-195, R-190, R-189)

Status: built on `main-2a2fep` on 22 Oct 2026, from the three `REQUESTS.md` entries the owner approved for this lot (Crucible
`pub_jalons`; Arche `pub_projets` + CAPEX link; Arche follow-up views). Not in this lot: `pub_catalogue_machines`,
`pub_reponses_besoins`, the `capex` connector (R-186, R-187), `pub_pack_ingenierie` (R-191), the `pub_parc_machines` columns,
the ramp-up and the shared platform (R-193, R-194), the indexes on `maj_le` (K-11).

## 1. What changed

| Piece | Where | Role |
|---|---|---|
| Columns and table | `drizzle/0037_share_followup_columns.sql` (generated) | `projects.capex_code`, `projects.besoin_ref` with format checks; `milestones.updated_at`; table `share_project_progress` |
| Views | `drizzle/0038_share_followup.sql` (custom, like 0035) | `pub_jalons`, `pub_jalons_projets`, `pub_avancement_projets`, `pub_avenants`, `pub_reserves` (new); `pub_projets` + `capex_code`, `besoin_ref`; `pub_livrables` + `type`, `accepte_le`, `maj_le` (appended) |
| Contracts | `src/server/db/share-contracts.ts` | the columns of each view in order, and the "no internal money" pattern (P-05 / AC-2) |
| Progress job | `src/server/dal/share-progress.ts`, job `share-progress` (`src/domain/jobs.ts`, `src/server/jobs/definitions.ts`, `docs/EXPLOITATION.md` § 8) | progress and SPI of every project, hourly |
| CAPEX link | `src/domain/capex-link.ts`, `src/server/dal/capex-link.ts`, `setCapexLinkAction` (`src/features/contract/actions.ts`), "CAPEX link" card (`capex-link-form.tsx`, `contract-view.tsx`, Contract page) | the project's CAPEX code and first machine need, set by its leads |
| Tests | `src/server/db/share-views.test.ts`, `src/features/contract/capex-link-actions.test.ts`, `src/domain/capex-link.test.ts`; `scripts/db-check.ts` (also `--postgres`); `postgres.integration.test.ts` (17 views) | |

Every view follows `0035_share`: unqualified names, `WITH (security_barrier)`, `COMMENT ON VIEW` naming the readers, columns
appended only (`CREATE OR REPLACE VIEW` of `pub_projets` and `pub_livrables` keeps their existing columns in place), no grant
(Matrix's `partage/90-droits.sql`). 17 `pub_` views now (12 + 5).

## 2. The views

**`pub_jalons`** (Crucible, R-195) — one row per schedule milestone: `projet_code`, `jalon_id` (uuid), `nom`, `position`,
`mois_reference` (`baseline_month`), `mois_prevu` (`forecast_month`) — fractional months from the project start, as stored —,
`statut` (`done` / `late` / `at_risk` / `on_track`), `activite_code` and `date_fin_activite` (`activities.finish_date`, null when
no activity is linked or it has no date), `maj_le` = the latest of the milestone's `updated_at` (new column, moved by the
schedule roll-up only when the milestone changes), the activity's `updated_at` and its `scheduled_at` (the last reschedule,
which moves its dates). The column names are those of the approved `REQUESTS.md` entry (`date_fin_activite`, with `position`);
Crucible's own `DEMANDES-KEYSTONE.md` K-2 still says `date_activite_fin` — Crucible reads the entry's names.

**`pub_projets`** + `capex_code`, `besoin_ref` (Arche K-05, R-190) — after `maj_le`; D02 v1 unchanged for the current readers.

**`pub_livrables`** + `type` (`deliverable_type`: `client_acceptance` = PV de réception), `accepte_le` (`accepted_on`), `maj_le`
(`updated_at`) (Arche K-06).

**`pub_avenants`** — `projet_code`, `numero` (`AV-01`… = order in the contract, `position` + 1; amendments are never deleted),
`objet` (the subject as typed), `montant_keur` (k€, below), `delai_jours` (the linked change request's `schedule_days`; null
without one — amendments carry no delay of their own), `statut` (`signe` when signed; `refuse` when the change request it carries
was rejected; else `propose`), `signe_le`, `maj_le`. **Drafts are not published**: an amendment exists for the client once sent
for signature (Keystone has no refused state of its own).

**`pub_reserves`** — the project's one punch list (R-117): `numero`, `categorie` (A / B / C, null on old site items without
category), `origine` (`itp` / `site`), `statut` (`open` / `in_progress` / `closed`), `responsable` (`client` / `keystone`, null on
old ITP items that have only a named owner), `ouverte_le` = the Paris day the item was recorded (Keystone stores no separate
raised date), `levee_le` (`closed_on`), `maj_le`. The NCR number (P-10b), the owner's name and the description stay in Keystone.

**`pub_avancement_projets`** — one row per project, **sales side only** (P-05 / AC-2): `date_situation`,
`avancement_physique_pct`, `spi`, `fin_prevue_le` (latest current finish of the activities, else the planned finish of the
wizard), `montant_contrat_keur` (contract base amount; for a project without contract, its billing plan's value),
`montant_avenants_keur` (signed amendments; null without contract), `facture_keur` (customer invoices at their frozen amount, plus
the invoiced rows of a legacy billing plan; null without contract or plan), `maj_le`. No budget, actual cost, rate, CPI, EAC or
margin column (tested in `share-views.test.ts` and `db-check`, pattern `INTERNAL_MONEY_COLUMN`). Amounts are in thousands of
euros, converted from the contract's currency at the project's budget rate (`eurRate`: 1 for EUR, the budget rate for the
project currency, 1 for a stale row without rate), as every consolidation in Keystone.

**Why a table for progress and SPI.** They are the earned value of the activities at the project's data date, computed in
TypeScript (`src/server/dal/evm.ts`: baseline snapshot, contingency draws, stock issues, calendars) — the register, Home and
Budget figures. Rewriting that in SQL would duplicate the rules and drift. So the job `share-progress` (every hour, technical
job) writes them to `share_project_progress` (`situation_on`, `progress_pct`, `spi`, `updated_at`) with the register's rule (a
project without activity budgets keeps `projects.progress` / `projects.spi`); a row changes — and `maj_le` moves — only when a
value changes. Until the first run (a fresh database, a deployment without the worker) the view publishes them as null. A
new job rather than a step of an existing one: no existing job has the same rhythm and purpose, and the runbook lists it.

## 3. `pub_jalons_projets`: mapping of the CAPEX milestones to Keystone's data

One row per project and code. `reel_le` is null while not reached; `prevu_le` is the planned date of the module that plans it,
else the actual date (a reached milestone is "planned" at its actual date); `reference_le` (BL1) is **null for every code** —
see § 5. A stage "reached" = the first transition into that stage *or a later one* that still stands (`stage_transitions`: not
a revert, not rejected, not reverted), so a skipped stage still dates the next milestone.

| `jalon_code` | `prevu_le` | `reel_le` | `maj_le` source |
|---|---|---|---|
| `commande` | — | contract signature (`contracts.signed_on`), else entry into Études (seq ≥ 4) | contract, transitions |
| `fin_etudes` | — | entry into Approvisionnements or later (seq ≥ 5) | transitions |
| `fat` | latest FAT-stage ITP inspection date (`itp_inspections.planned_on`, stage `fat`) | entry into Expédition or later (seq ≥ 8): FAT passed | ITP, transitions |
| `expedition` | — | entry into Expédition or later (seq ≥ 8) — the same stage boundary as `fat` | transitions |
| `arrivee_site` | site sheet start (`site_sheets.start_on`) | entry into Chantier or later (seq ≥ 9) | site sheet, transitions |
| `sat` | latest SAT cell date of the commissioning grid, else the latest "Plan SAT" date | latest SAT cell date once every system's SAT cell is done | SAT plans, transitions |
| `pv_reception` | latest due date of the `client_acceptance` deliverables | latest acceptance date once they are all accepted | deliverables |
| `fin_garantie` | latest warranty end of the project's machines (extended end first) | entry into Clos (seq 12) | machines, transitions |

`maj_le` = the latest of the project's `updated_at`, its last standing transition and the row's own source. The commissioning
cells have no timestamp: a SAT date set by "Plan SAT" moves `maj_le` through `sat_plans.created_at`. On the demo data set only
HLT-026 and RCF-019 carry a stage history; the other projects publish nulls for the stage-based milestones.

## 4. CAPEX link (R-190)

- `projects.capex_code` (`CPX-<subsidiary>-<year>-<nn>`, Arche N-9) and `projects.besoin_ref` (`<CAPEX code>/B<nn>`, a need of
  that CAPEX); database checks `projects_capex_code_check`, `projects_besoin_ref_check`; text, no foreign key (cross-schema).
- Edited on the **Contract** screen, card "CAPEX link" next to "Currency & budget rate" (also on a project without contract) —
  Keystone has no separate project-settings form; the card follows the budget-rate card's pattern. Rights:
  `canSetCapexLink` (`src/domain/rights.ts`) — the director and the project's leads (PM of record, co-PM, deputy) on a project
  they may edit; not Finance. The Server Function validates (`parseCapexLink`: trimmed, upper-cased, empty clears), the DAL
  re-parses, writes one audit row and one activity event (system message `project.capexLink`, FR rendering), then revalidates.
- **Internal client flag: not added.** Keystone already accepts any organisation as the client of a project (typed, created on
  the fly), a subsidiary included; Arche controls the client through `client` / `client_code3` of `pub_projets`, and a project
  with a `capex_code` is by construction a subsidiary's. A flag would need a client-administration screen, which Keystone does
  not have (a new screen: owner's approval first). It becomes useful with R-179 (portal for external clients only): open point.

## 5. Open points

1. **BL1 dates of the CAPEX milestones** (`reference_le` null): Keystone's schedule milestones carry no CAPEX milestone code. A
   code on each schedule milestone (`commande` … `fin_garantie`, chosen by the PM) would give `prevu_le` (its activity's finish),
   `reference_le` (BL1 finish of that activity) and `reel_le` (actual finish) from the schedule. A new field: owner's approval.
2. **`fat` and `expedition`** share one stage boundary (entry into Expédition); an actual FAT date would need the FAT ITP results
   (`result_on` of FAT-stage inspections) — possible later, to confirm with Arche.
3. **Multi-equipment (R-185)**: every view is per project; with several machines per project, the CAPEX milestones and the
   progress would be per equipment — to frame with R-185, no assumption added here.
4. `pub_pack_ingenierie` waits for R-191 (engineering pack's weighted list, CDC C-9).
5. Internal client flag (R-190, R-179): see § 4.

## 6. What Matrix must do (draft request for the owner — not written to Matrix)

Target repository: `Yhumiii27/Matrix`, `infra/postgres/` (Keystone never writes there; to be filed in Matrix's `REQUESTS.md`
after the owner's « validé »).

1. **Roles**: `arche_app` and `crucible_app` do not exist in the base layer (`init/01-base-et-roles.sql`, `02-schemas.sql`,
   `03-droits.sql`: lists of roles, schemas `arche`, `crucible`, `droits.partage_lecteurs_lecteur_check`, `droits.verifier()`'s
   reader table). Without them no grant below can be posted.
2. **Grants** (`partage/90-droits.sql`, list of (view, readers)):
   - `keystone.pub_jalons` → `crucible_app`, `matrix_app`;
   - `keystone.pub_projets` → add `arche_app`, `crucible_app`;
   - `keystone.pub_livrables` → add `arche_app`;
   - `keystone.pub_jalons_projets`, `keystone.pub_avancement_projets`, `keystone.pub_avenants`, `keystone.pub_reserves` →
     `arche_app`, `matrix_app`.
3. **`partage/30-keystone.sql`**: copy the 5 new views and the new definitions of `pub_projets` and `pub_livrables` from
   `drizzle/0038_share_followup.sql` (qualified `keystone.`), extend its prerequisite check with `projects.capex_code`,
   `projects.besoin_ref`, `milestones.updated_at` and the table `share_project_progress` (migration
   `0037_share_followup_columns`), and update its header ("les 12 vues" → 17).
4. Nothing to add to `droits.colonnes_sensibles`: the new views read no listed column.

Without (1)–(2) Arche and Crucible cannot read the views on the shared server (they keep their simulation); without (3) a replay
of Matrix's 30 would recreate `pub_projets` / `pub_livrables` without their new columns — PostgreSQL refuses it ("cannot drop
columns from view"), so the replay fails instead of silently losing them.

Keystone's CI is not affected: its PostgreSQL job builds the base layer from `infra/postgres-socle/` (vendored Matrix `init/`
only) and never runs Matrix's `partage/` files, and no check compares Keystone's views with a Matrix copy.
