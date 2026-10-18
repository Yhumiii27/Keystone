// End-to-end database check: opens a PGlite in a temporary directory, applies ./drizzle, seeds from the
// prototype data set, prints row counts and verifies golden values through the DAL.
//   npx tsx --conditions=react-server scripts/db-check.ts
// R-013: the golden values are the demo data set's at its date (the real clock is the default since 17 Oct 2026).
process.env.KEYSTONE_CLOCK = '2026-09-25';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { healthOf } from '@/domain/health';
import { D7_ACTUAL, D7_HEALTH, D7_PROGRESS_PCT, D7_SPI } from '@/test/d7-cost-control';
import { getCostControl, listChangeRequests } from '@/server/dal/cost';
import { getStageChecklist, getStageHistory, listStages, toggleStageDeliverable } from '@/server/dal/lifecycle';
import { getOwnerDirectory, getPersonByName, listDepartmentCapacities, listPeople, listUsers, listZones } from '@/server/dal/people';
import { getActivities, getActivityAssignments, getBaselines, getPipelinePlans, listScheduleSummaries } from '@/server/dal/planning';
import { createProject, getProject, getProjectData, listProjects, nextAnalyticCode, nextProjectNumber } from '@/server/dal/projects';
import { createChangeRequest, getChangeControl } from '@/server/dal/changes';
import { getContingency } from '@/server/dal/contingency';
import { getHoursReconciliation, getLeaveCalendar, getRateCard, getSkillsMatrix } from '@/server/dal/hr';
import { countUnreadNotifications, listActivity, listAudit } from '@/server/dal/notifications';
import { approveResourceRequest, createResourceRequest, getDepartmentApprovals, listResourceRequests } from '@/server/dal/requests';
import { getResourcePool, getWhatIf } from '@/server/dal/resources';
import { listUnassignedActivities, listUndeclaredActivities } from '@/server/dal/planning-load';
import { createRisk, getRiskRegister, listRisks } from '@/server/dal/risks';
import { getTask, listTasks } from '@/server/dal/tasks';
import { getTrends } from '@/server/dal/trends';
import { getBudgetContract } from '@/server/dal/budget';
import { getCashFlow, listBillingPlans } from '@/server/dal/cashflow';
import { getContract, issueInvoice, lateBillingMilestonesByProject } from '@/server/dal/contract';
import { depositInCodex, recordDocumentDecision, getCodexSyncState, getDocumentRecord, listDocumentTypes, listProjectDocuments, listVaultDocuments } from '@/server/dal/documents';
import { getProjectsMap } from '@/server/dal/geo';
import { createInterface, lateInterfacesByProject, listInterfaces } from '@/server/dal/interfaces';
import { createMeeting, listMeetings, meetingsToWriteByProject, sendMinutes } from '@/server/dal/meetings';
import { getPortfolioSchedule } from '@/server/dal/pipeline';
import { getCapacityWhatIf, getPrioritisation } from '@/server/dal/prioritisation';
import { getStakeholderRegister } from '@/server/dal/stakeholders';
import { getProjectAssembly, getProjectBom, getRevisionComparison, getSpareList } from '@/server/dal/bom';
import { acceptReceipt, announceDelivery, listReceipts, qcQueue, registerReceipt } from '@/server/dal/deliveries';
import { getVaultSyncState, listDrawings } from '@/server/dal/drawings';
import { ecoApprovalQueue, getEco, listEcos, recordEcoProgress } from '@/server/dal/eco';
import { listParts } from '@/server/dal/parts';
import {
  approvePurchaseOrder, awardRfq, countOrdersToReceive, createDraftPurchaseOrders, createRfq, getBomShortfall, getPurchaseOrder, invoiceQueue, listPurchaseOrders, listRfqs,
  listSupplierInvoices, poApprovalQueue, rfqAwardQueue, submitPurchaseOrder,
} from '@/server/dal/purchasing';
import { getX3StockSync, listStock } from '@/server/dal/stock';
import { getSupplierScorecard, listStorageLocations } from '@/server/dal/suppliers';
import { getVigieEcoConnector } from '@/server/integrations/vigie/eco-connector';
import { getVigieQualityConnector } from '@/server/integrations/vigie/quality-connector';
import { getCursusConnector } from '@/server/integrations/cursus/connector';
import { getClientPortal, raiseClientIssue } from '@/server/dal/client';
import { listClaims, listInterventions, openClaim } from '@/server/dal/claims';
import { getCommissioning } from '@/server/dal/commissioning';
import { getEngineeringRegister } from '@/server/dal/engineering';
import { addMachine, listMachines, machinesByZone } from '@/server/dal/fleet';
import { getPlumbingCounts, listConnectors, listImportFormats } from '@/server/dal/integrations';
import { addPunchItem, getItpPlan, listPunchItems } from '@/server/dal/itp';
import { listMachineTypes } from '@/server/dal/mtypes';
import { getPidValidation } from '@/server/dal/pid';
import { advanceNcr, decideDeliverable, deliverableAcceptanceQueue, getNcr, listDeliverables, listNcrs, ncrVerificationQueue } from '@/server/dal/quality';
import { addLesson, getRex } from '@/server/dal/rex';
import { getSettings } from '@/server/dal/settings';
import { getSite, remindInCursus, saveDailyReport } from '@/server/dal/site';
import { setDb } from '@/server/db/client';
import { riskCategory, riskResponse, riskStatus, stage } from '@/server/db/codes';
import { openDatabase } from '@/server/db/open';
import * as schema from '@/server/db/schema';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { schedule } from '@/domain/cpm';
import { createBaselineSnapshot, getBaselineActivities, listProjectBaselines } from '@/server/dal/baselines';
import { listCalendars, loadWorkCalendars, setProjectCalendar } from '@/server/dal/calendars';
import { getBaselineRegister } from '@/server/dal/changes-baselines';
import { addClientCommunication } from '@/server/dal/client-comms';
import { createImportJob, getImportJob, saveImportPreview } from '@/server/dal/import-jobs';
import { loadScheduleNetwork } from '@/server/dal/schedule-network';

/**
 * Seed row counts of the delivery-2 tables: risks 8 (HLT) + 5 × 4 generated; snapshots 6 projects × 13 weeks;
 * request events = 10 "sent" + 6 decisions; notification recipients = Σ NOTIFS audiences; person skills 8 × 10.
 */
const D2_COUNTS: Record<string, number> = {
  risks: 28, status_snapshots: 78, status_reports: 0, contingency_registers: 1, contingency_draws: 3,
  tasks: 27, task_checklist_items: 11, task_comments: 3, task_attachments: 3, time_entries: 4, resource_requests: 10, resource_request_events: 16, request_activity_choices: 5,
  // R-083: the dated grid — one version per role and multiplier from 1 Jan 2026; the job-title rates (RATES) are retired.
  // R-031 / R-173 (connectors lot): two simple leave types, Leave and Absence.
  allocations: 64, rate_roles: 10, rate_role_rates: 10, rate_multipliers: 5, rate_multiplier_rates: 5, skills: 10, person_skills: 80, certifications: 8, leave_types: 2,
  leave_entries: 12, public_holidays: 11, hours_imports: 1, hours_lines: 10, unassigned_hours: 2,
  whatif_levers: 5, whatif_auto_levers: 9, whatif_contexts: 1, whatif_scenarios: 2, whatif_scenario_levers: 10,
  notifications: 10, notification_recipients: 24, activity_events: 12, audit_entries: 8,
};

/**
 * Seed row counts of the delivery-3 tables: 42 DOCS with revisions A…current (Σ = 68), one approval row per circuit
 * step (Σ = 96), acknowledgements of the 7 shared documents not released on 26/28/29 Sep (the download log — 2 × 30
 * released — was dropped in delivery 8, D-2 = a / R-127: it stays in Codex; the revision rows stay for the KPI);
 * HLT-026 contract (2 amendments, 2 bonds, 5 milestones + Amendment 1's own M6 — delivery 7, NEW-D3-3 / R-079 —, 3 invoices) +
 * the BILLING rows of NDC, RCF, WSA, MSR (15);
 * MEETINGS 6 (25 invitees, 14 agenda points, 18 lines, 3 transcripts with 13 proposals); SCORES 10 × 5 axes.
 */
const D3_COUNTS: Record<string, number> = {
  document_types: 28, document_type_circuit_steps: 65, document_approver_assignments: 10, documents: 42, document_revisions: 68, document_approvals: 96,
  document_links: 18, document_acknowledgements: 7, document_deposits: 0, document_index_syncs: 1, codex_index_awaiting: 0,
  contracts: 1, contract_amendments: 2, contract_bonds: 2, billing_plans: 6, payment_milestones: 21, customer_invoices: 3, portfolio_cash_forecasts: 6,
  meetings: 6, meeting_participants: 25, meeting_agenda_points: 14, meeting_lines: 18, meeting_transcripts: 3, meeting_transcript_proposals: 13,
  client_questions: 5, stakeholders: 8, raci_matrices: 1, raci_columns: 6, raci_rows: 7, raci_cells: 35, project_interfaces: 7,
  score_axes: 5, portfolio_scores: 50, score_weights: 0, capacity_demand_rates: 5,
};

/**
 * Seed row counts of the delivery-4 tables: 31 companies (8 rated + manufacturers, bidders, invoice issuers); 6 Settings
 * locations + the generated receipts' unconfigured "Magasin chantier — Lyon"; PARTS 54 (12 equivalence rows, 15 last
 * prices, 28 assembly links of TREE, 25 spare-list lines, 59 BOM lines); 13 drawings with revisions A…current (28);
 * RFQS 4 (8 quotes); 21 orders (HLT_POS 6 + genPOs 15, 35 lines); 15 receipts (HLT_DELIV 5 + 10 generated, 25 lines,
 * 44 documents & photos); INVOICES 6; STOCK0 18, MOVES0 5; the Vigie mirror of the 6 ECOS (18 approval keys, 12 parts,
 * 7 projects, 24 effectivity targets) with an empty outbox.
 */
const D4_COUNTS: Record<string, number> = {
  suppliers: 31, storage_locations: 7, parts: 54, part_equivalents: 12, part_last_prices: 15, assembly_links: 28, spare_list_lines: 25, project_bom_lines: 59,
  project_assembly_roots: 1, revision_diffs: 1, revision_diff_lines: 5, drawings: 13, drawing_revisions: 28, pdm_vault_syncs: 1,
  rfqs: 4, rfq_quotes: 8, purchase_orders: 21, po_lines: 35, goods_receipts: 15, receipt_lines: 25, receipt_attachments: 44, supplier_invoices: 6,
  stock_positions: 18, stock_movements: 5, x3_sync_runs: 1,
  vigie_ecos: 6, vigie_eco_approvals: 18, vigie_eco_parts: 12, vigie_eco_projects: 7, vigie_eco_effectivity: 24, vigie_eco_progress: 0,
};

/**
 * Seed row counts of the delivery-5 tables: deliverables HLT_DELIVS 10 + 5 × 4 generated (RACI 5 each); the Vigie NCR
 * mirror HLT_NCRS 5 + 5 × 2 generated and the site HSE register 5; ITP 13 inspections and the plan's 6 frozen systems (R-057);
 * punch PUNCH 5 + SITE_PUNCH 3 (one list, R-117);
 * commissioning 6 systems × 5 steps, 8 dossier items; LESSONS 4, CLOSURE 10, SATISFACTION 5; FLEET 8 (AS_MAINT 31 part
 * revisions), CLAIMS 8, INTERVENTIONS 6; the site sheet with 8 equipment, 6 prerequisites, 6 rotations, 4 collisions (no longer read, R-119),
 * 6 cost lines, 2 reports; Cursus 5 people (1 sync); CLIENT_ISSUES 3 (CLIENT_DOCS dropped, L-9: computed from Codex); ENG_* registers; PID 1 / 24 / 5;
 * machine-type aggregate 28 phases, 25 cost categories, 17 ITP systems; SETTINGS0 60 values; CONNECTORS 9 + Vigie; IMPORTS 6.
 */
const D5_COUNTS: Record<string, number> = {
  deliverables: 30, deliverable_raci: 150, vigie_ncrs: 15, vigie_ncr_progress: 0, vigie_hse_items: 5, itp_plans: 1, itp_plan_systems: 6, itp_inspections: 13, punch_items: 8,
  commissioning_systems: 6, commissioning_steps: 30, handover_items: 8, sat_plans: 0, lessons_learned: 4, closure_items: 10, satisfaction_scores: 5,
  machines: 8, machine_part_revisions: 31, warranty_claims: 8, interventions: 6, site_sheets: 1, site_equipment: 8, site_prerequisites: 6, site_rotations: 6,
  site_collisions: 4, site_conflict_arbitrations: 0, mission_cost_lines: 6, daily_reports: 2, cursus_clearances: 5, cursus_requests: 0, cursus_sync_runs: 1, cursus_events: 0,
  client_issues: 3,
  eng_disciplines: 4, eng_inputs: 12, eng_consistency_rules: 6, eng_checks: 10, eng_outputs: 6, eng_changes: 4, eng_import_tools: 4,
  eng_column_mappings: 6, eng_import_deltas: 4, eng_imports: 0, pid_sheets: 1, pid_tags: 24, pid_validation_steps: 5, machine_type_phases: 28,
  // app_settings: the health thresholds and, since delivery 7, the seed record "keystone.seed" (R-011, A-15), the "Reset to
  // defaults" document (R-170) and the record that the demo referents were seeded (R-041); delivery 8, the hours-variance
  // threshold (R-088) and the change control board threshold (R-069, P-6c).
  machine_type_cost_categories: 25, machine_type_itp_systems: 17, reference_values: 60, app_settings: 6, connectors: 10, connector_sync_runs: 0, import_formats: 6,
};

/**
 * Seed row counts of the chapter 4 tables: the 4 built-in calendars; BL1 of the 5 generated projects (+ BL0/BL1/BL2 of
 * HLT-026) and its snapshot of every activity (ALL_BYID 145); everything else starts empty.
 */
const CH4_COUNTS: Record<string, number> = {
  calendars: 4, calendar_exceptions: 0, baselines: 8, baseline_activities: 145, schedule_runs: 0, stored_files: 0, import_jobs: 0, import_job_rows: 0, export_log: 0,
  client_communications: 0, whatif_scenario_actions: 0,
};

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${!ok && detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 600) : ''}`);
}
const norm = (x: unknown) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const same = (a: unknown, b: unknown) => isDeepStrictEqual(norm(a), norm(b));

/** First differing path between two JSON values (for failure messages). */
function diff(a: unknown, b: unknown, p = ''): string | null {
  if (same(a, b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${p}.${k}`);
      if (d) return d;
    }
  }
  return `${p}: ${JSON.stringify(a)?.slice(0, 200)} ≠ ${JSON.stringify(b)?.slice(0, 200)}`;
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-db-check-'));
  const t0 = Date.now();
  const db = await openDatabase(path.join(dir, 'pg'));
  setDb(db);
  console.log(`Database ${dir}/pg migrated and seeded in ${Date.now() - t0} ms\n\nRow counts`);

  const counts: Record<string, number> = {};
  for (const t of Object.values(schema)) {
    if (!is(t, PgTable)) continue;
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t);
    counts[getTableName(t)] = n;
    console.log(`  ${getTableName(t).padEnd(34)} ${String(n).padStart(5)}`);
  }

  console.log('\nDelivery 2 tables (golden row counts)');
  for (const [table, n] of Object.entries(D2_COUNTS)) check(`${table} = ${n}`, counts[table] === n, counts[table]);

  // Delivery 8, R-168: the seeded audit rows carry the user of their actor, and the trail is append-only (database trigger).
  console.log('\nAudit trail (R-168)');
  const auditUsers = await db.execute(sql`select count(*) filter (where a.actor_user_id is not null)::int as with_user,
    count(*) filter (where a.actor_user_id is distinct from u.id)::int as wrong from audit_entries a left join users u on u.person_id = a.actor_person_id`);
  const au = auditUsers.rows[0] as { with_user: number; wrong: number };
  check('seeded audit rows carry the user of their actor (people with an account)', au.with_user > 0 && au.wrong === 0, au);
  let refused = 0;
  for (const stmt of [sql`update audit_entries set reason = 'db-check'`, sql`delete from audit_entries`, sql`truncate audit_entries`]) {
    try {
      await db.execute(stmt);
    } catch {
      refused++;
    }
  }
  check('audit_entries refuses UPDATE, DELETE and TRUNCATE', refused === 3 && (await listAudit()).length === 8, refused);

  console.log('\nDelivery 3 tables (golden row counts)');
  for (const [table, n] of Object.entries(D3_COUNTS)) check(`${table} = ${n}`, counts[table] === n, counts[table]);

  console.log('\nDelivery 4 tables (golden row counts)');
  for (const [table, n] of Object.entries(D4_COUNTS)) check(`${table} = ${n}`, counts[table] === n, counts[table]);

  console.log('\nDelivery 5 tables (golden row counts)');
  for (const [table, n] of Object.entries(D5_COUNTS)) check(`${table} = ${n}`, counts[table] === n, counts[table]);

  console.log('\nChapter 4 tables (golden row counts)');
  for (const [table, n] of Object.entries(CH4_COUNTS)) check(`${table} = ${n}`, counts[table] === n, counts[table]);

  console.log('\nProjects');
  const list = await listProjects();
  check('17 projects', list.length === 17, list.length);
  check('6 projects with data', list.filter((p) => p.hasData).length === 6);
  const hlt = await getProject('HLT-026');
  // Delivery 7 (R-073, C-2a): progress computed from the activities and BL1 at the data date (0.64 → 0.63, SPI 0.90 → 0.82).
  check('HLT-026 budget 4800 · actual 3360 · progress .63 · SPI .82', hlt?.budget === 4800 && hlt.actual === 3360 && Math.round(hlt.progress * 100) === 63
    && Math.round((hlt.spi ?? 0) * 100) === 82, hlt);
  check('HLT-026 #026 · HAV004 · DAS 2 · EMP · Fabrication & Assemblage · R. Aubert · Le Havre · euna',
    hlt?.displayId === '#026' && hlt.analytic === 'HAV004' && hlt.das === '2' && hlt.machineType === 'EMP' && hlt.status === 'Fabrication & Assemblage'
      && hlt.stage === 'fabrication_assemblage' && hlt.pm === 'R. Aubert' && hlt.city === 'Le Havre' && hlt.zone === 'euna', hlt);
  // Delivery 7 (R-073; A-13 one health rule): health follows the computed SPI / CPI (was HLT-026 at risk, RCF-019 off track).
  check('Health HLT-026 off track, RCF-019 at risk', hlt?.health === 'off_track' && (await getProject('RCF-019'))?.health === 'at_risk');
  check('ERP-202 machine type R&D (stored rnd)', (await getProject('ERP-202'))?.machineType === 'R&D');

  // Same values as the former prototype-backed contract (TEMPORARY implementation of projects.ts). Delivery 7 (R-073; C-2a, A-12,
  // A-13): the six projects with activities show the progress, actual cost and SPI computed from them, and their health follows
  // (src/test/d7-cost-control.ts); progress and SPI are compared rounded.
  const legacy = PROTO_GEN.initialProjects.map((p) => {
    const id = PROTO.PROJ_ID[p.code];
    const geo = PROTO.GEO[p.code];
    const d7 = D7_ACTUAL[p.code] != null;
    return {
      code: p.code, name: p.name, displayId: id?.id ?? p.code, analytic: id?.ana ?? null, das: id?.das ?? null, machineType: id?.mt ?? null,
      status: p.status, pm: p.pm, client: p.client, start: p.start, finish: p.finish, budget: p.budget,
      actual: d7 ? D7_ACTUAL[p.code] : p.actual, progress: d7 ? D7_PROGRESS_PCT[p.code] / 100 : p.progress, spi: d7 ? D7_SPI[p.code] : p.spi ?? null,
      city: geo?.city ?? null, country: geo?.country ?? null, zone: (geo && (geo.zone || PROTO.COUNTRY_ZONE[geo.country])) || 'euna',
      hasData: !!PROTO_GEN.projectData[p.code], health: d7 ? D7_HEALTH[p.code] : healthOf(p),
    };
  });
  const current = list.map((p) => {
    const row = Object.fromEntries(Object.keys(legacy[0]).map((k) => [k, p[k as keyof typeof p]]));
    return D7_ACTUAL[p.code] != null ? { ...row, progress: Math.round(p.progress * 100) / 100, spi: p.spi == null ? null : Math.round(p.spi * 100) / 100 } : row;
  });
  check('listProjects() = prototype initialProjects() (legacy contract fields)', same(current, legacy), diff(current, legacy));

  console.log('\nprojectData() reproduced from the DB');
  // Delivery 7 (lot cost-control) computes these keys from Keystone data instead of the seeded values: PV / EV / AC and pct (R-073,
  // C-2a), categories, work packages and reconciliation (R-070 / A-8 contingency register, R-068 / A-4 change register), the change
  // list and the generated note (A-12). They are checked in src/server/dal/cost-control.test.ts; the rest stays deep-equal.
  const D7_KEYS = ['PV', 'EV', 'AC', 'pct', 'CATS', 'WPS', 'CRS', 'recon', 'note'];
  const omitD7 = (o: unknown) => o && Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(o)) as Record<string, unknown>).filter(([k]) => !D7_KEYS.includes(k)));
  for (const code of Object.keys(PROTO_GEN.projectData)) {
    const pd = omitD7(await getProjectData(code));
    const proto = PROTO_GEN.projectData[code] as { team: string[] };
    // R-041 (P-2): Harbor Line's named team adds the seeded referents (engineering lead, quality manager) to DEFS.team.
    const want = omitD7(code === 'HLT-026' ? { ...proto, team: [...proto.team, 'Antoine Girard', 'Gabriel Comte'] } : proto);
    check(`${code} projectData deep-equal (except the delivery 7 cost-control keys)`, same(pd, want), diff(pd, want));
  }
  const sums = await listScheduleSummaries();
  check('listScheduleSummaries() = projectData headers + MILES', same(Object.keys(sums), Object.keys(PROTO_GEN.projectData))
    && Object.entries(sums).every(([c, s]) => s.finishText === PROTO_GEN.projectData[c].finishText && same(s.milestones.map((m) => [m.name, m.baselineMonth, m.forecastMonth, m.statusLabel]), PROTO_GEN.projectData[c].MILES)));
  check('EWA-051 (no data) → null', (await getProjectData('EWA-051')) === null && (await getCostControl('EWA-051')) === null);
  const cc = await getCostControl('HLT-026');
  check('HLT-026 streams carry HLT_STREAMS monthly values', same(cc?.streams.map((s) => [s.name, s.basis, s.monthly]), PROTO.HLT_STREAMS));
  // Delivery 7 (R-073, C-2a): PV follows the cost-loaded BL1, EV = progress × BAC (was PV 3420 · EV 3080 · AC 3360).
  check('HLT-026 EVM at data date: PV 3663 · EV 3006 · AC 3360', cc?.pv[8] === 3663 && cc.ev.at(-1) === 3006 && cc.ac.at(-1) === 3360, cc && [cc.pv[8], cc.ev.at(-1), cc.ac.at(-1)]);
  const acts = await getActivities('HLT-026');
  const a1620 = acts.find((a) => a.id === 'A1620');
  check('A1620 FNLT 18 Dec violated, 05 Jan ’27 → 2027-01-05', a1620?.constraint === 'FNLT 18 Dec' && a1620.violated && a1620.startDate === '2027-01-05', a1620);
  check('A1250 resource assignments (4)', (await getActivityAssignments('HLT-026', 'A1250')).length === 4);

  console.log('\nLifecycle');
  const stages = await listStages();
  check('13 stages, deliverables = STAGE_DELIVS', stages.length === 13 && same(Object.fromEntries(stages.filter((s) => s.deliverables.length).map((s) => [s.label, s.deliverables])), PROTO.STAGE_DELIVS));
  check('transitions = TRANS', same(Object.fromEntries(stages.map((s) => [s.label, s.next.map((n) => stage.label(n))])), PROTO.TRANS));
  check('gates = GATES, descriptions = LIFE',
    same(Object.fromEntries(stages.filter((s) => s.gate).map((s) => [s.label, s.gate])), PROTO.GATES) && same(Object.fromEntries(stages.map((s) => [s.label, s.description])), PROTO.LIFE));
  for (const code of Object.keys(PROTO.STAGE_HISTORY)) {
    const h = (await getStageHistory(code)).map((e) => [e.label, e.date, e.mode, e.reason]);
    check(`${code} stage history = STAGE_HISTORY`, same(h, PROTO.STAGE_HISTORY[code]), diff(h, PROTO.STAGE_HISTORY[code]));
  }
  for (const [code, byStage] of Object.entries(PROTO.STAGE_DONE_DEFAULT as Record<string, Record<string, number[]>>)) {
    const cl = await getStageChecklist(code);
    const got = Object.fromEntries(Object.keys(byStage).map((label) => [label, cl[stage.code(label)].map(Number)]));
    check(`${code} stage deliverables = STAGE_DONE_DEFAULT`, same(got, byStage), diff(got, byStage));
  }

  console.log('\nPeople & organisation');
  check('OWN directory', same(await getOwnerDirectory(), PROTO.OWN), diff(await getOwnerDirectory(), PROTO.OWN));
  const people = await listPeople();
  check('PMs cited by projects resolve to persons', PROTO_GEN.initialProjects.every((p) => people.some((x) => x.shortName === p.pm)));
  check('Marion Kerviel heads Engineering', (await getPersonByName('M. Kerviel'))?.department === 'Engineering');
  // R-044: the prototype's 8 personas, then the Finance persona (Léa Marchand, not in the prototype).
  check('9 users (personas)', same((await listUsers()).map((u) => [u.role, u.name, u.title]), [
    ...Object.entries(PROTO.PERSONAS as Record<string, [string, string]>).map(([r, [n, t]]) => [r, n, t]), ['finance', 'Léa Marchand', 'Cost controller'],
  ]));
  check('zones + bounds', same((await listZones()).map((z) => [z.code, z.label, z.manager]), PROTO.ZONES) && same(Object.fromEntries((await listZones()).map((z) => [z.code, z.bounds])), PROTO.ZONE_BOUNDS));
  check('department capacities = ROLES', same((await listDepartmentCapacities()).map((d) => [d.department, d.capacityH, d.demandH]), PROTO.ROLES));

  console.log('\nChange & baselines');
  const crs = await listChangeRequests('HLT-026');
  check('HLT-026 register: HLT_CRS_X + CR-005', crs.length === 6 && crs.find((c) => c.id === 'CR-008')?.status === 'in_review' && crs.find((c) => c.id === 'CR-005')?.status === 'rejected');
  const bls = await getBaselines('HLT-026');
  check('BASELINES reproduced', same(bls.map((b) => [b.code, b.name, b.setOn, b.bac, b.finish, b.stateLabel]), PROTO.BASELINES), diff(bls.map((b) => [b.code, b.name, b.setOn, b.bac, b.finish, b.stateLabel]), PROTO.BASELINES));
  check('pipeline plans (5 projects × 6 windows)', same(Object.fromEntries(Object.entries(await getPipelinePlans()).map(([c, w]) => [c, w.map((x) => [x.label, x.startMonth, x.endMonth])])), PROTO.PIPE_PLAN));

  console.log('\nDelivery 2 data (DAL vs prototype)');
  const risksHlt = await listRisks('HLT-026');
  const risksProto = risksHlt.map((r) => ({
    id: r.id, title: r.title, cat: riskCategory.label(r.category), p: r.probability, i: r.impact, owner: r.owner, resp: riskResponse.label(r.response), plan: r.plan,
    act: r.activity?.code ?? '', emv: r.emv, trig: r.trigger, status: riskStatus.label(r.status), trend: r.trend,
  }));
  check('RISKS_HLT reproduced', same(risksProto, PROTO.RISKS_HLT), diff(risksProto, PROTO.RISKS_HLT));
  const reg = await getRiskRegister('HLT-026');
  check('risk KPIs: 7 open · 5 score ≥ 8 · EMV 340 · contingency 150', reg?.risks.filter((r) => r.status === 'open').length === 7
    && reg.risks.filter((r) => r.status === 'open' && r.score >= 8).length === 5 && reg.openEmv === 340 && reg.contingency === 150);
  check('generated risk registers (NDC-031 EMV 53/26/20/16, owner S. Perrin)', same((await listRisks('NDC-031')).map((r) => [r.id, r.emv, r.ownerShort]), [['R-01', 53, 'S. Perrin'], ['R-02', 26, 'S. Perrin'], ['R-03', 20, 'S. Perrin'], ['R-04', 16, 'S. Perrin']]));
  const chg = await getChangeControl('HLT-026');
  // R-169: the CCB step names the portfolio director who records the decision (was the prototype's "Monthly · next 8 Oct").
  check('change register = HLT_CRS_X + CR-005, approver chain follows the project', chg?.changeRequests.length === 6
    && same(chg.changeRequests[3].chain.map((c) => c.approver), ['Romain Aubert', 'Marie Lefebvre', 'Nadia Bensaïd', 'Marie Lefebvre']));
  const tr = await getTrends('HLT-026');
  check('HLT_SNAPS reproduced, next status report 2 Oct', same(tr?.series, PROTO.HLT_SNAPS) && tr?.nextReport?.text === '2 Oct');
  const cg = await getContingency('HLT-026');
  check('contingency 150 · drawn 48 · remaining 102 · exposure 340', cg?.initial === 150 && cg.drawn === 48 && cg.remaining === 102 && cg.exposure === 340);
  // Delivery 7 (A-8: one contingency figure): without a register, the budget's contingency line (NDC-031 = 100, was round(BAC × 3 %)
  // = 63); round(BAC × 3 %) stays for a project without a budget line (EWA-051 = 66).
  check('contingency without a register: budget line (NDC-031 = 100), else round(BAC × 3 %) (EWA-051 = 66)',
    (await getContingency('NDC-031'))?.initial === 100 && (await getContingency('EWA-051'))?.initial === 66);
  // R-084 (owner answers 17 Oct 2026, third round): the loads come from the schedules' assignments (the PEOPLE percentages stay
  // seeded in `allocations`, no longer read). Owner answer 18 Oct 2026 (fourth round): 61 named demo assignments
  // (src/server/db/seed/demo-assignments.ts) fitted to PEOPLE — 4 A1250_RES rows + 61 = 65; on the prototype's weeks 83 %
  // utilisation and 3 people above 110 % in weeks 42–44 (Julien Wagner 100 · 106 · 125 · 125 · 108 · 88 · 65 · 81).
  const PROTO_WEEKS = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'];
  const pool = await getResourcePool(PROTO_WEEKS);
  check('PEOPLE reproduced (pool order, job titles); loads from the schedules (R-084)',
    same(pool.people.map((p) => [p.name, p.jobTitle]), (PROTO.PEOPLE as [string, string][]).map(([n, j]) => [n, j]))
      && same(pool.people.find((p) => p.name === 'Julien Wagner')?.loads, [100, 106, 125, 125, 108, 88, 65, 81])
      && Math.round(pool.people.reduce((a, p) => a + p.avg, 0) / pool.people.length) === 83
      && same(pool.people.filter((p) => p.max > 110).map((p) => p.name), ['Amélie Ollivier', 'Julien Wagner', 'Pauline Noguès']));
  check('activity_assignments = 65 (A1250_RES 4 + 61 named demo assignments)', counts.activity_assignments === 65, counts.activity_assignments);
  // Owner answer 18 Oct 2026 (J-15 alert): HLT-026 A1410 is left owner-only on purpose; no activity without any declared resource.
  check('without an assignment at J-15: HLT-026 A1410; undeclared: none',
    same((await listUnassignedActivities('2026-09-25')).map((a) => `${a.projectCode} ${a.code}`), ['HLT-026 A1410']) && (await listUndeclaredActivities()).length === 0);
  const reqs = (await listResourceRequests()).map((r) => ({
    id: r.id, pm: r.requestedBy, project: r.projectShort, person: r.resource, dept: r.department, title: r.title, act: r.activity?.code, hours: r.hours,
    start: r.startDay, due: r.dueDay, prio: r.priority, status: r.status, sent: r.sentText, note: r.note, response: r.response,
    propStart: r.proposedStartDay, propDue: r.proposedDueDay, todoId: r.taskId,
  }));
  check('REQUESTS reproduced', same(reqs, PROTO.REQUESTS), diff(reqs, PROTO.REQUESTS));
  check('Engineering approvals: RQ-043, RQ-041 pending (52 h)', same((await getDepartmentApprovals('Engineering'))?.pending.map((r) => r.id), ['RQ-043', 'RQ-041']));
  const todos = (await listTasks()).map((t) => ({
    id: t.id, person: t.assignee, title: t.title, project: t.project.short, act: t.activity?.code, status: t.status, prio: t.priority, start: t.startDay, due: t.dueDay,
    est: t.estimateH, logged: t.loggedH, cl: [t.checklist.done, t.checklist.total], labels: t.labels, pct: t.pct,
  }));
  check('TODOS reproduced', same(todos, PROTO.TODOS), diff(todos, PROTO.TODOS));
  const t2314 = await getTask('T-2314');
  check('T-2314 comments, files, entries', same(t2314?.comments.map((c) => [c.author, c.when, c.text]), PROTO.COMMENTS['T-2314'])
    && same(t2314?.attachments.map((f) => [f.name, f.meta, f.icon]), PROTO.FILES['T-2314']) && same(t2314?.entries.map((e) => [e.dateText, e.hours, e.note]), PROTO.ENTRIES['T-2314']));
  const rc = await getRateCard();
  check('RATE_ROLES and MULTS reproduced', same(rc.roles.map((r) => [r.role, r.baseRateEur]), PROTO.RATE_ROLES) && same(rc.multipliers.map((m) => [m.key, m.label, m.factor]), PROTO.MULTS));
  const sm = await getSkillsMatrix();
  check('SKILL_LV and CERTS reproduced', same(Object.fromEntries(sm.people.map((p) => [p.name, p.levels])), PROTO.SKILL_LV)
    && same(Object.fromEntries(sm.people.filter((p) => p.certText).map((p) => [p.name, p.certText])), PROTO.CERTS));
  const lc = await getLeaveCalendar('FR', PROTO_WEEKS);
  // NEW-CURSUS-4 (R-031, R-173): the prototype's CP / RTT weeks are Leave, its Sick / Training weeks Absence (no reason kept).
  const simpleLeave: Record<string, string> = { CP: 'Leave', RTT: 'Leave', Sick: 'Absence', Training: 'Absence' };
  const protoLeave = Object.fromEntries(Object.entries(PROTO.LEAVE as Record<string, Record<string, string>>).map(([n, ws]) => [n, Object.fromEntries(Object.entries(ws).map(([i, l]) => [i, simpleLeave[l]]))]));
  check('LEAVE and HOLIDAYS reproduced', same(Object.fromEntries(lc.people.map((p) => [p.name, Object.fromEntries(p.weeks.flatMap((w, i) => (w.typeLabel ? [[String(i), w.typeLabel]] : [])))])), protoLeave)
    && same(Object.fromEntries(lc.holidays.map((h) => [h.weekIndex, h.label])), PROTO.HOLIDAYS));
  const hr = await getHoursReconciliation('HLT-026');
  check('HOURS reproduced', same(hr && { imported: hr.importedText, code: hr.analyticCode, lines: hr.lines.map((l) => [l.person, l.wbsLabel, l.plannedH, l.declaredH]), unassigned: hr.unassigned.map((u) => [u.person, u.hours, u.reason]) }, PROTO.HOURS['HLT-026']));
  const wi = await getWhatIf('HLT-026');
  // Chapter 4 (S-7): levers derived from the plan (A1250 assignments) replace the prototype's LEVERS / AUTO.
  // R-084 + named demo assignments (18 Oct 2026): 23 levers on HLT-026 — A1250's relief of Julien Wagner, the crew's overtime and
  // unit first.
  check('what-if levers derived from the HLT-026 assignments (23, A1250 first), scenarios A/B', wi?.levers.length === 23
    && same(wi.levers.slice(0, 3).map((l) => l.code), ['extra_resource:A1250:julien-wagner', 'overtime:A1250:steel-erection-crew', 'extra_resource:A1250:steel-erection-crew'])
    && same(wi.scenarios.map((x) => x.name), ['A', 'B']));
  check('unread notifications per role 3/4/1/2/1/1/1/1', same(await Promise.all(['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'].map(countUnreadNotifications)), [3, 4, 1, 2, 1, 1, 1, 1]));
  check('ACTIVITY and AUDIT reproduced', same((await listActivity()).map((a) => [a.when, a.who, a.what, a.kind]), PROTO.ACTIVITY) && same((await listAudit()).map((a) => [a.when, a.who, a.object, a.change, a.area]), PROTO.AUDIT));

  await delivery3Reads();
  await delivery4Reads();
  await delivery5Reads();
  await chapter4Reads();

  console.log('\nNumbering & writes (temporary database)');
  check('next project number #045', (await nextProjectNumber()) === PROTO_GEN.nextProjectId);
  check('next analytic HAV002 / LOG001', (await nextAnalyticCode('Port authority')) === 'HAV002' && (await nextAnalyticCode('Logistics BU')) === 'LOG001');
  const r1 = await toggleStageDeliverable('HLT-026', 'fabrication_assemblage', 2);
  const r2 = await toggleStageDeliverable('HLT-026', 'fabrication_assemblage', 3);
  const hlt2 = await getProject('HLT-026');
  check('ticking the last deliverable auto-advances HLT-026 to FAT', r1 === null && r2 === 'fat' && hlt2?.status === 'FAT', { r1, r2, s: hlt2?.status });
  const h2 = await getStageHistory('HLT-026');
  check('history entry FAT · 25 Sep 2026 · auto', h2.length === 7 && same(h2.at(-1) && [h2.at(-1)!.label, h2.at(-1)!.date, h2.at(-1)!.mode], ['FAT', '25 Sep 2026', 'auto']));
  const code = await createProject({
    name: 'Eastbank Annex', client: 'Logistics BU', das: '2', machineType: 'EMP', currency: 'EUR', templateCode: 'EMP',
    categories: [{ name: 'Études', type: 'labor', budget: 160 }, { name: 'Matière & structure', type: 'material', budget: 560 }], contingencyPct: 5, calendar: 'standard_5x8_workshop',
  });
  const created = (await listProjects())[0];
  check('createProject → LOG-045, first in register, Initiative, New, €756k', code === 'LOG-045' && created.code === code && created.status === 'Initiative' && created.isNew && created.budget === 756 && created.analytic === 'LOG001', created);
  check('next project number then #046', (await nextProjectNumber()) === '#046');
  check('new risk R-21, CR-011, request RQ-045', (await createRisk('HLT-026', { title: 'Check', category: 'technical', response: 'mitigate' }, 'Romain Aubert')) === 'R-21'
    && (await createChangeRequest('HLT-026', { title: 'Check', types: ['scope'], amountKeur: 1, scheduleDays: 0 }, 'Romain Aubert')) === 'CR-011'
    && (await createResourceRequest({ projectCode: 'HLT-026', title: 'Check', activityCode: 'A1250', person: 'Julien Wagner', priority: 'med' }, 'Romain Aubert')) === 'RQ-045');
  // P-8b (Delivery 8, R-089): an approved request for a contract role becomes a "Find and name" task for procurement.
  check('approving RQ-043 creates task T-2341 for procurement to find and name the contract role',
    (await approveResourceRequest('RQ-043', 'Marion Kerviel')) === 'T-2341' && (await getTask('T-2341'))?.assignee === 'Fabien Bertrand'
      && (await getTask('T-2341'))?.contractRole === 'Contract structural engineer');
  // L-4c (Delivery 7, R-055): the automatic stage change is audited too.
  check('audit rows appended (8 seed + 4 + the stage change)', (await listAudit()).length === 13);
  await delivery3Writes();
  await delivery4Writes();
  await delivery5Writes();
  await chapter4Writes();

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

/** Delivery 3 data through the DAL vs the prototype figures quoted by the specs (10 §4–5, 04 §3–4, 03 §3, §6–7, 05 §3, §5–6, 07 §2.5). */
async function delivery3Reads() {
  console.log('\nDelivery 3 data (DAL vs prototype)');
  const docs = await listProjectDocuments('HLT-026');
  check('vault HLT-026 + QMS: 40 records · 28 released · 1 awaiting approval · 7 shared · 1 acknowledgement pending · 25 withdrawn revisions',
    same([docs.length, docs.filter((d) => d.status === 'released').length, docs.filter((d) => d.status === 'release_proposed').length, docs.filter((d) => d.shared).length,
      docs.filter((d) => d.shared && !d.acknowledged).length, docs.reduce((s, d) => s + d.withdrawnRevisions, 0)], [40, 28, 1, 7, 1, 25]));
  check('vault all projects: 42 records (DOCS)', same((await listVaultDocuments()).map((d) => d.number), PROTO.DOCS.map((d: { id: string }) => d.id)));
  const sync = await getCodexSyncState();
  check('Codex sync 08:02 · 412 records', sync?.time === '08:02' && sync.records === 412, sync);
  const pid = await getDocumentRecord('PID-HLT-026');
  // D-2 = a (R-127): the drawer reads the current revision only (rows C, B, A stay stored for the "Obsolete revisions" KPI).
  check('PID-HLT-026: rev D (current revision only), proof signed 24/25/26 Sep, client acknowledgement pending',
    same(pid?.revisions.map((r) => [r.revision, r.issuedOn, r.withdrawnOn]), [['D', '2026-09-26', null]])
      && same(pid?.approvals.map((a) => a.signedOn), ['2026-09-24', '2026-09-25', '2026-09-26']) && pid?.acknowledged === false, pid?.revisions);
  const types = await listDocumentTypes();
  check('document types register = DOC_TYPES, In Codex counts', same(types.map((t) => [t.code, t.label, t.circuitText, t.retention, t.isoClause, t.isClientDeliverable]),
    PROTO.DOC_TYPES.map((t: { code: string; label: string; circuit: string; retention: string; iso: string; client: boolean }) => [t.code, t.label, t.circuit, t.retention, t.iso, t.client]))
    && types.find((t) => t.code === 'LST')?.inCodex === 4);
  const ct = await getContract('HLT-026');
  // Delivery 7 (NEW-D3-3, R-079): the base milestones are priced on the base amount (was invoiced 3 036, paid 1 656, retention 83).
  check('contract HLT-026: €5.52M (5 400 + signed 120), invoiced 2 970, paid 1 620, retention 81, next INV-2026-004',
    ct?.valueKeur === 5520 && ct.invoicedKeur === 2970 && ct.paidKeur === 1620 && ct.retentionKeur === 81 && ct.nextInvoiceNumber === 'INV-2026-004', ct && [ct.valueKeur, ct.invoicedKeur, ct.paidKeur, ct.retentionKeur]);
  check('invoices INV-2026-001…003, M3 due 10 Nov (calendar days)', same(ct?.invoices.map((i) => [i.number, i.milestoneNumber, i.dueOn, i.statusLabel]),
    [['INV-2026-001', 'M1', '2026-04-26', 'Paid'], ['INV-2026-002', 'M2', '2026-08-29', 'Paid'], ['INV-2026-003', 'M3', '2026-11-10', 'Awaiting payment']]));
  check('no late billing milestone (badge), no contract on NDC-031', same(await lateBillingMilestonesByProject(), {}) && (await getContract('NDC-031')) === null);
  // Delivery 7 (R-073): orders placed = the open purchase orders (PO-1052, PO-1063, PO-1071, PO-1078), no longer the literal 713.
  check('Budget cash tab reads the contract from the DB, orders placed 3 946.5 (open POs)', (await getBudgetContract('HLT-026'))?.openCommit === 3946.5);
  const plans = await listBillingPlans();
  check('billing plans: HLT-026 from the contract, BILLING elsewhere', plans['HLT-026']?.fromContract === true && plans['NDC-031']?.contractValueKeur === 2350 && plans['ERP-202']?.internal === true);
  const cash = await getCashFlow(null);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  // A-12 (chapter 4): the forecast is computed from the billing plans and cost forecasts (prototype plan: net +365, low −490).
  // Delivery 7: R-073 the cost to complete starts from the EAC and actual cost computed from the activities, spread along the
  // computed PV curve (C-10a, R-133); receipts at the payment rule's dates (C-6, R-076); HLT-026 milestones at base-amount prices
  // (NEW-D3-3) — net +2 836 → +2 746, low −521 → −1 412 (R-073 alone: +2 709 / −570; the contract-portfolio lot alone: +2 870 / −1 085).
  check('cash flow: 5 rows · contract 10 090 · invoiced 5 192 · outstanding 1 910 · net +2 746 · low −1 412',
    same([cash.rows.map((r) => r.project.code), sum(cash.rows.map((r) => r.plan.contractValueKeur)), sum(cash.rows.map((r) => r.plan.invoicedKeur)),
      sum(cash.rows.map((r) => sum(r.plan.milestones.filter((m) => m.status === 'invoiced').map((m) => m.amountKeur)))),
      sum(cash.forecast.map((m) => m.cashInKeur - m.cashOutKeur)), Math.min(...cash.forecast.map((_, i) => sum(cash.forecast.slice(0, i + 1).map((m) => m.cashInKeur - m.cashOutKeur))))],
    [['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'MSR-012'], 10090, 5192, 1910, 2746, -1412]));
  const pf = await getPrioritisation('director', null);
  // Delivery 7 (C-10b, R-132): margin at completion (contract − EAC) / contract, with R-073's EAC 5 366 k€ (was 13 %: contract − budget).
  check('prioritisation: 10 ranked (SCORES remapped), WSA-044 first (81), HLT-026 72 · margin at completion 3 %',
    pf.ranking.length === 10 && pf.ranking[0].project.code === 'WSA-044' && pf.ranking[0].score === 81
      && same(pf.ranking.find((r) => r.project.code === 'HLT-026') && [pf.ranking.find((r) => r.project.code === 'HLT-026')!.score, pf.ranking.find((r) => r.project.code === 'HLT-026')!.marginPct], [72, 3]));
  // A-12: capacity from the pool, demand per €1M from the active portfolio (prototype constants: 1 560 h). R-084: commitments from
  // the schedules' planning load (151 h on the seeded allocation rows; 239 h with the named demo assignments of 18 Oct 2026).
  check('capacity what-if WSA-044: gap 239 h', (await getCapacityWhatIf('WSA-044'))?.gapH === 239);
  const ms = await listMeetings('HLT-026');
  const acts = ms.flatMap((m) => m.agenda.flatMap((a) => a.lines)).filter((l) => l.type === 'action');
  check('meetings HLT-026: 5 · 1 notes in progress · 6 open actions · 0 overdue; MTG-121 on NDC-031',
    ms.length === 5 && ms.filter((m) => m.status === 'notes_in_progress').length === 1 && acts.filter((l) => !l.done).length === 6 && !acts.some((l) => l.overdue)
      && same(await meetingsToWriteByProject(), { 'HLT-026': 1, 'NDC-031': 1 }));
  const stk = await getStakeholderRegister('HLT-026');
  check('stakeholders 8 · 1 stale (DREAL Normandie) · RACI 7 × 6', stk.stakeholders.length === 8 && same(stk.stakeholders.filter((s) => s.stale).map((s) => s.name), ['DREAL Normandie'])
    && stk.raci?.rows.length === 7 && stk.raci.columns.length === 6);
  const ifc = await listInterfaces('HLT-026');
  // R-013: one business date (25 Sep 2026 on the demo data set), not the prototype's 30 Sep: IF-07 is 5 days late, not 10.
  check('interfaces: 7 · IF-07 late (5 d) · badge 1', ifc.length === 7 && same(ifc.filter((i) => i.status === 'late').map((i) => [i.number, i.daysToNeed]), [['IF-07', -5]])
    && same(await lateInterfacesByProject(), { 'HLT-026': 1 }));
  const ps = await getPortfolioSchedule(null);
  check('portfolio schedule: 7 in progress · 5 pipeline · average board wait 28 d', ps.rows.filter((r) => !r.pipeline).length === 7 && ps.rows.filter((r) => r.pipeline).length === 5 && ps.averageBoardWaitDays === 28);
  const map = await getProjectsMap(null);
  check('projects map: 17 located · 11 sites · 6 countries · 7 active · 5 pipeline · 3 at risk (1 off track)',
    same([map.points.length, map.groups.length, map.countries.length, map.points.filter((p) => p.category === 'active').length, map.points.filter((p) => p.category === 'pipeline').length,
      map.points.filter((p) => p.health && p.health !== 'on_track').length, map.points.filter((p) => p.health === 'off_track').length], [17, 11, 6, 7, 5, 3, 1]));
}

/** Delivery 3 numbering and writers (after the Delivery 2 writes: T-2341 is taken). */
async function delivery3Writes() {
  check('deposit → CER-HLT-042 (count + 40), first in the vault', (await depositInCodex({ typeCode: 'CER', project: 'HLT-026', linkedPo: 'PO-2026-118' }, 'Marie Lefebvre')).number === 'CER-HLT-042'
    && (await listVaultDocuments())[0].number === 'CER-HLT-042');
  // Delivery 7 (P-7b, R-124): the approvals go to Codex through the outbox; the second one requests the release.
  await recordDocumentDecision('RPT-HLT-014', { decision: 'approved' }, { name: 'Gabriel Comte', role: 'quality' });
  check('RPT-HLT-014 release requested after its 2 approvals (pending sync with Codex)',
    (await recordDocumentDecision('RPT-HLT-014', { decision: 'approved' }, { name: 'Romain Aubert', role: 'pm' })).releaseRequested);
  check('issue invoice on M4 → INV-2026-004', (await issueInvoice('HLT-026', { milestone: 'M4' }, 'Romain Aubert')) === 'INV-2026-004');
  check('new meeting MTG-130', (await createMeeting('HLT-026', { title: 'Check', type: 'internal', series: 'one_off', date: '2026-10-06', invitees: ['R. Aubert'], agenda: [] }, 'Romain Aubert')) === 'MTG-130');
  const sent = await sendMinutes('MTG-118', 'Romain Aubert');
  // S-12 a (R-067): every internal action owner gets a task (L. Fabre too, outside the resource pool).
  check('MTG-118 minutes → MIN-HLT-027, tasks T-2342 / T-2343 / T-2344', same(sent, { minutesNumber: 'MIN-HLT-027', invited: 5, tasks: ['T-2342', 'T-2343', 'T-2344'] }), sent);
  check('new interface IF-10', (await createInterface('HLT-026', { title: 'Check', keystoneSide: 'site', otherParty: 'Client', dataExpected: 'Data', neededBy: '2026-11-02', owner: 'R. Aubert' }, 'Romain Aubert')) === 'IF-10');
  check('audit rows appended (13 + 7)', (await listAudit()).length === 20);
}

/** Delivery 4 data through the DAL vs the prototype figures quoted by the specs (09 §1–5, 08 §1–4, §7.5). */
async function delivery4Reads() {
  console.log('\nDelivery 4 data (DAL vs prototype)');
  const keur = (v: number) => Math.round(v / 10) / 100;
  const bom = (await getProjectBom('HLT-026'))!;
  check('BOM HLT-026: 35 articles · 2 042 units · €14.05M at list price (prototype sum) · 2 not validated · 1 outdated · 7 restricted',
    same([bom.summary.articles, bom.summary.units, Math.round(bom.summary.listValueEur / 10000) / 100, bom.summary.notValidated, bom.summary.outdatedOrObsolete, bom.summary.exportRestricted], [35, 2042, 14.05, 2, 1, 7]), bom.summary);
  check('BOM value without the assembly double count (09 OQ6) < list sum', bom.summary.valueEur < bom.summary.listValueEur && bom.lines.filter((l) => l.valuedByComponents).length === 8);
  const others = await Promise.all(['NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012'].map(async (c) => { const b = (await getProjectBom(c))!; return [b.summary.articles, keur(b.summary.listValueEur)]; }));
  check('BOM articles / value: NDC 8 / €3.83M, RCF 5 / €150k, ERP 2 / €1.32M, WSA 6 / €4.01M, MSR 3 / €351k', same(others.map(([n, v]) => [n, v >= 1000 ? Math.round(v / 10) / 100 : Math.round(v)]), [[8, 3.83], [5, 150], [2, 1.32], [6, 4.01], [3, 351]]), others);
  check('no BOM, tree or orders on EWA-051 (no Harbor Line fallback)', (await getProjectBom('EWA-051'))!.lines.length === 0 && (await getProjectAssembly('EWA-051')) === null && (await listPurchaseOrders('EWA-051')).length === 0);
  const asm = (await getProjectAssembly('HLT-026'))!;
  const bog = asm.rows.find((r) => r.ref === 'ASM-BOG-300')!;
  // E-2a (Delivery 7, R-103): roll-ups at the ordered price, else last purchase, else catalogue (was €713,996 at list price).
  check('assembly tree: ASM-RMG-250 ×2 unit €720,396 · extended €1,440,792; ASM-BOG-300 ext 8 · unit €11,222',
    same([asm.root.unitCostEur, asm.root.extendedCostEur, bog.extended, bog.unitCostEur], [720396, 1440792, 8, 11222]), [asm.root.unitCostEur, bog.unitCostEur]);
  // E-2b (R-104): the substitutions EL-HMI-10 → EL-HMI-15 (+€750) and FD-DET-OPT → FD-DET-OPT2 (+€12) are priced.
  check('compare revisions B → C: +€19,942 per crane (ECO-2026-014)', (await getRevisionComparison('HLT-026'))?.totalDeltaEur === 19942);
  const sp = (await getSpareList('HLT-026'))!;
  check('PU/PR complete system ×2: 12 lines (4 PU) · €235k · 4 long lead · 3 under change · 10 below recommended stock (real on-hand)',
    same([sp.rows.length, sp.rows.filter((r) => r.kind === 'PU').length, Math.round(sp.rows.reduce((a, r) => a + r.totalEur, 0) / 1000), sp.rows.filter((r) => (r.leadWeeks ?? 0) > 8).length,
      sp.rows.filter((r) => r.underChange).length, sp.rows.filter((r) => r.inStock < r.recommendedQty).length], [12, 4, 235, 4, 3, 10]));
  const parts = await listParts();
  check('PLM: 54 parts · 16 manufactured · 87 % validated · 4 awaiting · FD-DET-OPT, SG-BRK-SS outdated in use · 13 restricted · 9 wks',
    same([parts.length, parts.filter((p) => p.makeBuy === 'manufactured').length, Math.round((parts.filter((p) => p.status === 'validated').length / parts.length) * 100), parts.filter((p) => p.status === 'not_validated').length,
      parts.filter((p) => (p.status === 'outdated' || p.status === 'obsolete') && p.usage.length).map((p) => p.ref), parts.filter((p) => p.exportRestriction).length,
      Math.round(parts.filter((p) => p.leadWeeks).reduce((a, p) => a + p.leadWeeks!, 0) / parts.filter((p) => p.leadWeeks).length)], [54, 16, 87, 4, ['FD-DET-OPT', 'SG-BRK-SS'], 13, 9]));
  const ecos = await listEcos();
  const open = ecos.filter((e) => e.open);
  check('ECOs (Vigie mirror, mock connector): 6 · 3 open · 1 in approval · 2 released (€10,360) · 2 projects · 5 parts · 12 dispositions pending',
    getVigieEcoConnector().mode === 'mock' && same([ecos.length, open.length, ecos.filter((e) => e.status === 'in_approval').length, ecos.filter((e) => e.status === 'released').reduce((a, e) => a + e.costEur, 0),
      new Set(open.flatMap((e) => e.projects)).size, new Set(open.flatMap((e) => e.parts)).size, open.reduce((a, e) => a + e.pendingDispositions, 0)], [6, 3, 1, 10360, 2, 5, 12]));
  check('ECO-2026-015: open POs PO-1082 (HLT) and none elsewhere; PM approval pending for R. Aubert', same((await getEco('ECO-2026-015'))!.openPurchaseOrders.map((o) => o.number), ['PO-1082'])
    && same((await ecoApprovalQueue({ name: 'Romain Aubert', role: 'pm' })).map((e) => e.number), ['ECO-2026-015']));
  const dw = await listDrawings();
  const vs = (await getVaultSyncState())!;
  check('drawings: 13 · 10 released · 2 WIP/under review · 1 obsolete · vault 1 248 · last sync 07:40',
    same([dw.length, dw.filter((d) => d.state === 'released').length, dw.filter((d) => d.state === 'wip' || d.state === 'under_review').length, dw.filter((d) => d.state === 'obsolete').length, vs.drawingsInVault, vs.time], [13, 10, 2, 1, 1248, '07:40']));
  const pos = await listPurchaseOrders('HLT-026');
  const sf = await getBomShortfall('HLT-026');
  check('orders HLT-026: 5 open / 6 · committed €6.09M · 1 late (PO-1063) · 1 awaiting approval · shortfall 15 articles €884k',
    same([pos.filter((o) => !['received', 'cancelled'].includes(o.status)).length, pos.length, Math.round(pos.filter((o) => o.status !== 'cancelled' && o.status !== 'draft').reduce((a, o) => a + o.valueEur, 0) / 10000) / 100,
      pos.filter((o) => o.late).map((o) => o.number), pos.filter((o) => o.status === 'awaiting_approval').length, sf.lines.length, Math.round(sf.valueEur / 1000)], [5, 6, 6.09, ['PO-1063'], 1, 15, 884]));
  const rs = await listReceipts('HLT-026');
  check('deliveries HLT-026: 5 · 1 announced · 1 QC pending · 4 rejected (0.5 %) · 4 orders to receive',
    same([rs.length, rs.filter((r) => r.status === 'announced').length, rs.filter((r) => r.status === 'qc_pending').length, rs.reduce((a, r) => a + r.totals.rejected, 0),
      Math.round((rs.reduce((a, r) => a + r.totals.rejected, 0) / rs.reduce((a, r) => a + r.totals.delivered, 0)) * 1000) / 10, await countOrdersToReceive('HLT-026')], [5, 1, 1, 4, 0.5, 4]));
  const stock = await listStock();
  const x3 = (await getX3StockSync())!;
  check('stock: €1.25M · 18 lines · 6 locations · 1 below min (MD-GAS-OUT) · 2 in quarantine · X3 07:15 · 15 lines · 3 local',
    same([Math.round(stock.reduce((a, r) => a + r.valueEur, 0) / 10000) / 100, stock.length, (await listStorageLocations()).length, stock.filter((r) => r.belowMin).map((r) => r.ref),
      stock.filter((r) => r.locationType === 'quarantine').reduce((a, r) => a + r.onHand, 0), x3.time, x3.x3Lines, x3.localLines], [1.25, 18, 6, ['MD-GAS-OUT'], 2, '07:15', 15, 3]));
  const rfqs = await listRfqs();
  const inv = await listSupplierInvoices();
  const sc = await getSupplierScorecard('HLT-026');
  check('sourcing: 3 open RFQs (1 to award) · 8 quotes · 5 invoices to process €1,724,160 · 3 blocked · 2 awaiting receipt · 8 suppliers (4 A, 1 C) · OTD 90 % · quality 97 % · 3 supplier NCRs',
    same([rfqs.filter((r) => r.status !== 'awarded').length, rfqs.filter((r) => r.status === 'comparing').length, rfqs.reduce((a, r) => a + r.quotes.length, 0),
      inv.filter((i) => i.status !== 'paid').length, inv.filter((i) => i.status !== 'paid').reduce((a, i) => a + i.amountEur, 0), inv.filter((i) => i.status === 'blocked' || i.status === 'no_po').length,
      inv.filter((i) => i.status === 'awaiting_receipt').length, sc.rows.length, sc.rows.filter((s) => s.grade === 'A').length, sc.rows.filter((s) => s.grade === 'C').length,
      Math.round(sc.rows.reduce((a, s) => a + s.onTimeDeliveryPct, 0) / 8), Math.round(sc.rows.reduce((a, s) => a + s.qualityAcceptancePct, 0) / 8), sc.supplierNcrs],
    [3, 1, 8, 5, 1724160, 3, 2, 8, 4, 1, 90, 97, 3]));
  check('My approvals queues: PO-1082 (director, PM) · BL-2026-0521 (quality, procurement) · RFQ-2026-031 · 3 invoices',
    same([(await poApprovalQueue('HLT-026', 'Marie Lefebvre')).map((o) => o.number), (await poApprovalQueue('HLT-026', 'Romain Aubert')).map((o) => o.number), (await poApprovalQueue('HLT-026', 'Fabien Bertrand')).length,
      (await qcQueue('HLT-026')).map((r) => r.number), (await rfqAwardQueue()).map((r) => r.number), (await invoiceQueue()).map((i) => i.number)],
    [['PO-1082'], ['PO-1082'], 0, ['BL-2026-0521'], ['RFQ-2026-031'], ['INV-HC-7781', 'INV-BX-55120', 'INV-LE-2210']]));
}

/** Delivery 4 numbering and writers (after the Delivery 2 and 3 writes). */
async function delivery4Writes() {
  const before = (await listAudit()).length;
  const drafts = await createDraftPurchaseOrders('HLT-026', 'Fabien Bertrand');
  check('shortfall → 13 drafts PO-1100…PO-1112, one per manufacturer', drafts.length === 13 && drafts[0] === 'PO-1100' && drafts[12] === 'PO-1112', drafts);
  await submitPurchaseOrder('PO-1100', 'Fabien Bertrand');
  await approvePurchaseOrder('PO-1100', 'Romain Aubert');
  const bl = await announceDelivery('HLT-026', {}, 'Fabien Bertrand');
  await registerReceipt(bl, {}, 'Hélène Sauvage');
  await acceptReceipt(bl, {}, 'Gabriel Comte');
  check('PO-1100 approved → announce BL-2026-0600 → register → accept: order received, 192 plates in the Le Havre store',
    bl === 'BL-2026-0600' && (await getPurchaseOrder('PO-1100'))?.status === 'received' && (await listStock()).find((s) => s.ref === 'KS-PLT-S355')?.onHand === 192);
  check('award RFQ-2026-031 to Dillinger → draft PO-1113 at 1 195 €; new RFQ → RFQ-2026-035',
    (await awardRfq('RFQ-2026-031', 'Dillinger', 'Fabien Bertrand')).purchaseOrderNumber === 'PO-1113'
      && (await createRfq({ title: 'Check', suppliers: 'ABB', articles: 'EL-VFD-200', replyDueOn: '2026-10-15' }, 'Fabien Bertrand')) === 'RFQ-2026-035');
  const rec = await recordEcoProgress('ECO-2026-015', { key: 'pm', decision: 'ok' }, { name: 'Romain Aubert', role: 'pm' });
  check('ECO-2026-015 PM approval recorded, pending sync with Vigie (Vigie status unchanged)', rec.syncStatus === 'pending' && (await getEco('ECO-2026-015'))?.status === 'in_approval'
    && (await getEco('ECO-2026-015'))?.approvalsView.find((a) => a.key === 'pm')?.pendingSync === true);
  check('audit rows appended (20 + 21)', (await listAudit()).length === before + 21 && before === 20, [before, (await listAudit()).length]);
}

async function delivery5Reads() {
  console.log('\nDelivery 5 data (DAL vs prototype)');
  const ncrs = await listNcrs('HLT-026');
  const open = ncrs.filter((n) => n.open);
  check('NCRs HLT-026 (Vigie mirror, mock): 5 · 4 open · 1 critical · €44k · 3 from goods receipt; 2 on each other project with data; none on EWA-051',
    getVigieQualityConnector().mode === 'mock' && same([ncrs.length, open.length, open.filter((n) => n.severity === 'critical').length, ncrs.reduce((a, n) => a + n.costKeur, 0),
      ncrs.filter((n) => n.source === 'goods_receipt').length, (await listNcrs('NDC-031')).map((n) => n.number), (await listNcrs('EWA-051')).length], [5, 4, 1, 44, 3, ['NCR-040', 'NCR-041'], 0]));
  const dl = await listDeliverables('HLT-026');
  check('deliverables HLT-026: 10 · 3 accepted · 2 submitted (D-014 "Accept by 2 Oct", D-016) · D-021 due 2027-01-14; D-110…D-113 elsewhere',
    same([dl.length, dl.filter((d) => d.status === 'accepted').length, dl.filter((d) => d.status === 'submitted').map((d) => d.number), dl[2].acceptanceText, dl.at(-1)!.dueOn,
      (await listDeliverables('RCF-019')).map((d) => d.number)], [10, 3, ['D-014', 'D-016'], 'Accept by 2 Oct', '2027-01-14', ['D-110', 'D-111', 'D-112', 'D-113']]));
  const plan = (await getItpPlan('HLT-026'))!;
  const punch = (await listPunchItems('HLT-026', 'itp')).filter((p) => p.open);
  check('ITP HLT-026: 3 / 13 passed · 1 failed · 5 hold points ahead · EMP 6 systems · 2 custom · 4 open punch (B 2 · C 2)',
    same([plan.inspections.filter((i) => i.result === 'passed').length, plan.inspections.length, plan.inspections.filter((i) => i.result === 'failed').length,
      plan.inspections.filter((i) => i.pointType === 'hold' && i.result !== 'passed').length, plan.template, plan.systems.length, plan.customCount, punch.length,
      punch.filter((p) => p.category === 'B').length, punch.filter((p) => p.category === 'C').length], [3, 13, 1, 5, 'EMP', 6, 2, 4, 2, 2]));
  const all = await listPunchItems('HLT-026');
  // A-6 'a' (R-117): one punch list per project, numbered over it — the Site items renumbered after the ITP items.
  check('punch HLT-026: one list P-01…P-08 · ITP items Keystone · Site items P-06…P-08 category B · P-06 carries NCR-029',
    same(all.map((p) => [p.number, p.origin, p.category, p.ownerParty, p.ncrNumber]), [
      ['P-01', 'itp', 'A', 'keystone', null], ['P-02', 'itp', 'B', 'keystone', null], ['P-03', 'itp', 'C', 'keystone', null], ['P-04', 'itp', 'B', 'keystone', null],
      ['P-05', 'itp', 'C', 'keystone', null], ['P-06', 'site', 'B', 'client', 'NCR-029'], ['P-07', 'site', 'B', 'keystone', null], ['P-08', 'site', 'B', 'client', null],
    ]), all.map((p) => p.number));
  const cm = (await getCommissioning('HLT-026'))!;
  const cells = cm.systems.flatMap((x) => x.cells);
  check('commissioning HLT-026: 0 / 6 handed over · 1 / 30 steps done · 2 blocked (IF-02, IF-05) · dossier 19 % · 4 missing',
    same([cm.systems.filter((x) => x.cells[4].status === 'done').length, cells.filter((c) => c.status === 'done').length, cells.filter((c) => c.status === 'blocked').map((c) => c.blockingRef),
      Math.round(((cm.dossier.filter((x) => x.status === 'ready').length + cm.dossier.filter((x) => x.status === 'partial').length * 0.5) / cm.dossier.length) * 100),
      cm.dossier.filter((x) => x.status === 'missing').length], [0, 1, ['IF-02', 'IF-05'], 19, 4]));
  const rex = await getRex('HLT-026');
  check('REX HLT-026: 4 lessons (1 applied, 1 to validate) · closure 1 done 3 in progress · satisfaction 4.0 / 5',
    same([rex.lessons.length, rex.lessons.filter((l) => l.status === 'applied').length, rex.lessons.filter((l) => l.status === 'proposed').length,
      rex.closure.filter((c) => c.status === 'done').length, rex.closure.filter((c) => c.status === 'in_progress').length,
      (rex.satisfaction.reduce((a, x) => a + x.score, 0) / rex.satisfaction.length).toFixed(1)], [4, 1, 1, 1, 3, '4.0']));
  const ms = await listMachines();
  const z = await machinesByZone();
  // R-013: MCH-035's warranty end is counted from 25 Sep 2026 (the business date), not the prototype's 30 Sep.
  check('installed base: 8 machines · 6 clients · 6 in warranty · 1 extended · MCH-035 ends in 36 d · 4 with open claims · zones 6 / 1 / 1',
    same([ms.length, new Set(ms.map((m) => m.client)).size, ms.filter((m) => m.warrantyStatus === 'in_warranty').length, ms.filter((m) => m.warrantyStatus === 'extended').length,
      ms.filter((m) => m.warrantyEndingSoon).map((m) => [m.number, m.warrantyEndsInDays]), ms.filter((m) => m.openClaims).length, [z.byZone.euna, z.byZone.afr, z.byZone.apac]],
    [8, 6, 6, 1, [['MCH-035', 36]], 4, [6, 1, 1]]));
  const claims = await listClaims();
  const ivs = await listInterventions();
  check('warranty claims: 5 open (2 major) · 4 interventions planned (next 6 Oct 2026) · €34k warranty · €6k chargeable · 1 linked to an ECO',
    same([claims.filter((c) => c.open).length, claims.filter((c) => c.open && c.severity !== 'minor').length, ivs.filter((i) => i.status === 'planned').length,
      ivs.filter((i) => i.status === 'planned').map((i) => i.scheduledOn).sort()[0], claims.filter((c) => c.coverage !== 'chargeable').reduce((a, c) => a + c.costKeur, 0),
      claims.filter((c) => c.coverage === 'chargeable').reduce((a, c) => a + c.costKeur, 0), claims.filter((c) => c.ecoNumber).length], [5, 2, 4, '2026-10-06', 34, 6, 1]));
  const site = (await getSite('HLT-026'))!;
  // D-6b 'a' (R-119): the conflicts are computed from the rotation plan, the pool, Cursus and the absences — 7 (the prototype's 4;
  // R-084 + named demo assignments: Julien Wagner's load conflict — 8 with the seeded allocation rows).
  check('site HLT-026: NO GO (5 conditions open) · prerequisites 4 / 6 · Cursus 3 / 5 (1 reserve, mock) · equipment 6 / 8 · 7 conflicts · budget 98.3 k€ (11.3 committed) · 2 permits pending',
    getCursusConnector().mode === 'mock' && same([site.go.ok, site.go.conditions.filter((c) => !c.ok).length, site.prerequisites.filter((p) => p.status !== 'pending').length,
      site.cursus.people.filter((p) => p.verdict !== 'no_go').length, site.cursus.people.filter((p) => p.verdict === 'go_with_reserve').length,
      site.equipment.filter((e) => e.status === 'confirmed').length, site.collisions.length, Math.round(site.missionCosts.reduce((a, m) => a + m.budgetKeur, 0) * 10) / 10,
      Math.round(site.missionCosts.reduce((a, m) => a + m.actualKeur, 0) * 10) / 10, site.hse.filter((h) => h.status === 'pending').length], [false, 5, 4, 3, 1, 6, 7, 98.3, 11.3, 2]));
  check('no site sheet, commissioning, ITP, REX, register or P&ID on NDC-031 / EWA-051', (await getSite('NDC-031')) === null && (await getCommissioning('EWA-051')) === null
    && (await getItpPlan('NDC-031')) === null && (await getRex('EWA-051')).lessons.length === 0 && (await getEngineeringRegister('NDC-031')) === null && (await getPidValidation('EWA-051')) === null);
  const cp = await getClientPortal('HLT-026');
  // Delivery 8 (R-069, P-6b): CR-008 reaches the client once the portfolio director approved it — not in the seed.
  check('client portal HLT-026: waiting D-014, D-016 (CR-008 waits for the director) · 5 decided · 2 open issues · 7 shared documents',
    same([cp.decisions.map((d) => d.id), cp.decided.length, cp.issues.filter((i) => i.status !== 'closed').length, cp.documents.length], [['D-014', 'D-016'], 5, 2, 7]));
  const eng = (await getEngineeringRegister('HLT-026'))!;
  // E-5 (Delivery 7, R-105): LST-IO-026 rev B (Frozen) is the reference, no longer outdated.
  check('engineering HLT-026: 4 blocking · 3 outdated inputs · 5 / 13 released · 2 / 6 outputs ready',
    same([eng.checks.filter((c) => c.open && c.severity === 'blocking').length, eng.inputs.filter((i) => i.outdated).length, eng.deliverables.filter((d) => d.status === 'released').length,
      eng.deliverables.length, eng.outputs.filter((o) => o.state === 'ready').length, eng.outputs.length], [4, 3, 5, 13, 2, 6]));
  const pid = (await getPidValidation('HLT-026'))!;
  check('P&ID HLT-026: rev C · 22 in scope · 13 linked (59 %) · 6 unmapped · 3 reference issues', same([pid.sheet.revision, pid.coverage.inScope, pid.coverage.linked, pid.coverage.pct, pid.coverage.unmapped, pid.coverage.referenceIssues], ['C', 22, 13, 59, 6, 3]));
  const mts = await listMachineTypes();
  check('machine types: 5 active · 17 ITP systems · EMP reference budget 1 940 k€ · 5 REX patterns',
    same([mts.filter((m) => m.active).length, mts.reduce((a, m) => a + m.itpSystems.length, 0), mts[0].costTotalKeur, mts.filter((m) => m.rexReferences.length).length], [5, 17, 1940, 5]));
  const st = await getSettings();
  check('settings: 6 locations (5 types) · 10 skills · 6 cost categories · 0.97 / 0.9 · 11 holidays',
    same([st.locations.length, new Set(st.locations.map((l) => l.type)).size, st.lists.skills.length, st.lists.costCats.length, st.health, st.lists.holidays.length], [6, 5, 10, 6, { risk: 0.97, off: 0.9 }, 11]));
  const conns = await listConnectors();
  const pc = await getPlumbingCounts();
  // A-12: "Events today" = events of the data date (Paris day); the prototype's 6 included one of 26 Sep.
  // R-021 (NEW-CURSUS-4): Lucca is no longer listed (hours come from Cursus) — 8 + Vigie.
  check('connectors: 8 + Vigie (live: 6 ECOs · 15 NCRs · 5 HSE items) · Cursus live · 1 warning · 5 events today · 8 audit entries · 6 formats',
    same([conns.length, conns.at(-1)!.lastVolume, conns.find((c) => c.name === 'Cursus')!.lastVolume, conns.filter((c) => c.status === 'warning').map((c) => c.name), pc.eventsToday,
      pc.auditLast7Days, (await listImportFormats()).length], [9, '6 ECOs · 15 NCRs · 5 HSE items', '5 people · HLT-026', ['Outlook / Exchange'], 5, 8, 6]));
  check('My approvals: client contact D-014, D-016 · quality no NCR in verification',
    same([(await deliverableAcceptanceQueue('HLT-026', { name: 'Nadia Bensaïd', role: 'client' })).map((d) => d.number), (await ncrVerificationQueue('HLT-026', { name: 'Gabriel Comte', role: 'quality' })).length],
      [['D-014', 'D-016'], 0]));
}

/** Delivery 5 numbering and writers (after the Delivery 2–4 writes). */
async function delivery5Writes() {
  const before = (await listAudit()).length;
  const pm = { name: 'Romain Aubert', role: 'pm' };
  const r = await advanceNcr('HLT-026', 'NCR-028', pm);
  check('NCR-028 → Root cause recorded, pending sync with Vigie (Vigie status unchanged)', r.syncStatus === 'pending' && (await getNcr('HLT-026', 'NCR-028'))?.status === 'containment');
  await decideDeliverable('HLT-026', 'D-014', 'accepted', { name: 'Nadia Bensaïd', role: 'client' });
  check('D-014 accepted by the client contact (PV): "25 Sep · N. Bensaïd"', (await listDeliverables('HLT-026')).find((d) => d.number === 'D-014')?.acceptanceText === '25 Sep · N. Bensaïd');
  const numbers = [
    await addPunchItem('HLT-026', { description: 'Check', category: 'C', source: 'site_walk' }, pm),
    await addLesson('HLT-026', { theme: 'site', whatHappened: 'Check', recommendation: 'Check', appliesTo: 'Other' }, pm),
    await addMachine({ name: 'Check crane', machineType: 'EMP', client: 'Port authority', site: 'Le Havre · quay 5' }, pm),
    await openClaim({ machineNumber: 'MCH-050', issue: 'Check', severity: 'minor', coverage: 'warranty', owner: 'T. Kerbrat' }, pm),
    await raiseClientIssue('HLT-026', 'Check', { name: 'Nadia Bensaïd', role: 'client' }),
    await saveDailyReport('HLT-026', { date: '2026-09-30', weather: 'clear', progress: 'Check' }, pm),
  ];
  check('numbering: P-10 · LL-10 · MCH-050 · WC-020 · CI-08 · DR-003', same(numbers, ['P-10', 'LL-10', 'MCH-050', 'WC-020', 'CI-08', 'DR-003']), numbers);
  const rem = await remindInCursus('HLT-026', 'Thomas Kerbrat', pm);
  check('Cursus reminder for T. Kerbrat pending sync with Cursus (mock)', rem.syncStatus === 'pending');
  check('audit rows appended (9 writes)', (await listAudit()).length === before + 9, [before, (await listAudit()).length]);
}

async function chapter4Reads() {
  console.log('\nChapter 4 data (seed, calendars, CPM)');
  check('built-in calendars', same((await listCalendars()).map((c) => c.code), ['standard_5x8', 'standard_5x8_workshop', 'site_6x10', 'continuous_24h']));
  const cals = await loadWorkCalendars('HLT-026');
  check('Standard calendar skips the French holidays (Easter Monday 6 Apr 2026)', !cals.standard_5x8.isWorkDay('2026-04-06') && cals.site_6x10.isWorkDay('2026-09-26'));
  check('Change control register unchanged for a generated project (seeded BL1)', same(await getBaselineRegister('NDC-031'), [
    { code: 'BL1', name: 'Approved baseline', setOn: '9 Apr 2026', setOnDate: '2026-04-09', bac: 2100, finish: '1 Apr 2027', finishDate: '2027-04-01', state: 'current', stateLabel: 'Current', changeRequest: null },
  ]));
  check('HLT-026 baselines BL0 (no snapshot) · BL1 (21 activities, displayed) · BL2 (proposed)', same((await listProjectBaselines('HLT-026')).map((b) => [b.code, b.activityCount, b.displayed]), [['BL0', 0, false], ['BL1', 21, true], ['BL2', 0, false]]));
  check('A1250 BL1 finish 31 Aug', (await getBaselineActivities('HLT-026', 'BL1')).find((a) => a.activityCode === 'A1250')?.finishText === '31 Aug');
  const net = await loadScheduleNetwork('HLT-026');
  check('HLT-026 network: 21 activities, 30 links, data date 25 Sep 2026', net?.activities.length === 21 && net.links.length === 30 && net.dataDate === '2026-09-25');
  const r = net && schedule(net.input);
  check('CPM on HLT-026 (not persisted): A1250 → 9 Oct, A1260 5 Oct → 6 Nov, A1620 FNLT 18 Dec missed',
    r?.activities.A1250.finish === '2026-10-09' && r.activities.A1260.start === '2026-10-05' && r.activities.A1260.finish === '2026-11-06' && r.activities.A1620.violation?.type === 'FNLT');
}

async function chapter4Writes() {
  console.log('\nChapter 4 writes');
  const bl = await createBaselineSnapshot('HLT-026', { actorName: 'Romain Aubert', comment: 'db-check' });
  check('"Set baseline" → BL3 with 21 activities', bl.code === 'BL3' && bl.activityCount === 21, bl);
  await setProjectCalendar('NDC-031', 'site_6x10', 'Romain Aubert');
  check('project calendar set', (await loadScheduleNetwork('NDC-031'))?.projectCalendar === 'site_6x10');
  check('client exchange COM-001', (await addClientCommunication('HLT-026', { occurredOn: '2026-09-25', channel: 'phone', contactName: 'N. Bensaïd', subject: 'db-check' }, 'Romain Aubert')) === 'COM-001');
  const job = await createImportJob({ kind: 'parts', mode: 'update', fileName: 'parts.csv', actorName: 'Antoine Girard' });
  await saveImportPreview(job, [{ status: 'ok', action: 'update', key: 'EL-PLC-S7', data: {} }], { rows: 1 });
  check('import job previewed (nothing written)', (await getImportJob(job))?.status === 'previewed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
