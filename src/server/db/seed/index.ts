import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { APP_SETTING_DEFAULTS } from '@/domain/settings-defaults';
import { appSettings, calendars, parts, projects, referenceValues } from '../schema';
import type { DB, Tx } from '../types';
import { seedAftersales } from './aftersales';
import { seedCatalogue } from './catalogue';
import { seedChange } from './change';
import { seedChapter4 } from './chapter4';
import { seedClient } from './client';
import { seedCollaboration } from './collaboration';
import { ctxFromDb, newCtx, type SeedCtx } from './context';
import { seedControl } from './control';
import { backfillCostControl } from './cost-control';
import { backfillContractImpacts } from './cost-change';
import { seedContract } from './contract';
import { seedCost } from './cost';
import { seedCursus } from './cursus';
import { demoAssignmentsToBackfill, seedDemoAssignments } from './demo-assignments';
import { demoLeaveToShift, shiftDemoLeave } from './demo-leave';
import { seedDocuments } from './documents';
import { seedEngineering } from './engineering';
import { demoCatalogueToBackfill, seedDemoCatalogue } from './machine-catalogue';
import { demoMatrixSubsidiariesToBackfill, seedDemoMatrixSubsidiaries } from './matrix-subsidiaries';
import { demoCapexNeedsToBackfill, demoInternalClientToBackfill, ensureArcheConnector, seedDemoCapexNeeds, seedDemoInternalClient } from './capex-needs';
import { seedExecution } from './execution';
import { seedOperations } from './operations';
import { seedOrganisation } from './organisation';
import { seedPlanning } from './planning';
import { seedPlatform } from './platform';
import { seedPortfolio } from './portfolio';
import { seedPrioritisation } from './prioritisation';
import { seedPurchasing } from './purchasing';
import { seedQuality } from './quality';
import { seedRateMultipliers, seedResources } from './resources';
import { seedSettings, seedSettingsDefaults } from './settings';
import { seedSite } from './site';
import { seedStock } from './stock';
import { demoReferentsToBackfill, seedDemoReferents } from './project-team';
import { backfillDemoUsers, demoUsersToBackfill, financeUserToBackfill, logisticsUserToBackfill, seedFinanceUser, seedLogisticsUser } from './users';
import { demoShipmentLotBToBackfill, demoShipmentsToBackfill, seedDemoShipmentLotB, seedDemoShipments, seedIncoterms } from './shipments';
import { seedVigie, seedVigieQuality } from './vigie';
import { seedWork } from './work';
import { readSeedRecord, writeSeedRecord } from './mode';
import { seedReferenceData } from './reference';
import type { SeedMode } from '@/server/config/parse';
import { log, logError } from '@/server/log';

/** Delivery 4 modules: technical reference, purchasing, stock and the Vigie ECO mirror. */
async function seedDelivery4(tx: Tx, ctx: SeedCtx): Promise<void> {
  await seedCatalogue(tx, ctx);
  await seedPurchasing(tx, ctx);
  await seedStock(tx, ctx);
  await seedVigie(tx);
}

/**
 * Delivery 5 modules: quality deliverables, execution (ITP, punch lists, commissioning, REX), installed base and
 * after-sales, site, client portal, engineering register and P&ID, machine-type aggregate, administration, and the Vigie
 * NCR / HSE and Cursus mirrors.
 */
async function seedDelivery5(tx: Tx, ctx: SeedCtx): Promise<void> {
  await seedQuality(tx, ctx);
  await seedExecution(tx, ctx);
  await seedAftersales(tx, ctx);
  await seedSite(tx, ctx);
  await seedClient(tx, ctx);
  await seedEngineering(tx, ctx);
  await seedSettings(tx);
  await seedVigieQuality(tx);
  await seedCursus(tx);
}

/** The prototype data set (demo seed). */
async function seedDemoData(tx: Tx): Promise<void> {
  const ctx = newCtx();
  await seedOrganisation(tx, ctx);
  await seedPortfolio(tx, ctx);
  await seedPlanning(tx, ctx);
  await seedCost(tx, ctx);
  await seedChange(tx, ctx);
  await seedControl(tx, ctx);
  await seedWork(tx, ctx);
  await seedResources(tx, ctx);
  await seedPlatform(tx, ctx);
  await seedDocuments(tx, ctx);
  await seedContract(tx, ctx);
  await seedCollaboration(tx, ctx);
  await seedOperations(tx, ctx);
  await seedPrioritisation(tx, ctx);
  await seedDelivery4(tx, ctx);
  await seedDelivery5(tx, ctx);
  await seedChapter4(tx);
  await seedDemoReferents(tx);
  // Delivery 9 (owner answer 18 Oct 2026): named people on the demo schedules — the load is read from them (R-084).
  await seedDemoAssignments(tx);
  // Delivery 9 (R-186): the demo machine catalogue (published, draft and retired versions).
  await seedDemoCatalogue(tx);
  // Delivery 9 (R-187): the subsidiaries' machine needs mirrored from Arche (simulated) and Keystone's answers.
  await seedDemoCapexNeeds(tx);
  // Delivery 9 (Matrix D21): the group's subsidiaries mirrored from Matrix (simulated).
  await seedDemoMatrixSubsidiaries(tx);
  // Delivery 9 (R-158): the Incoterms (reference data) and the demo shipment of HLT-026 on a DAP contract.
  await seedIncoterms(tx);
  await seedDemoShipments(tx);
}

/**
 * Seeds an empty database in one transaction and records its seed (./mode.ts): `demo` (default) loads the prototype data set
 * (src/server/prototype: PROTO constants + PROTO_GEN, the materialised initialProjects() / projectData()); `production` loads
 * reference data only (./reference.ts, R-011). A database is empty when it has no seed record and no project.
 *
 * A demo database seeded before Delivery 4 (migration 0003 applied to an existing data dir) gets the Delivery 4 modules seeded
 * once, when its catalogue is empty, against its own people, projects and activities; one seeded before Delivery 5 (migration
 * 0004) gets the Delivery 5 modules once, when its Settings lists are empty; one seeded before chapter 4 (migration 0005) gets
 * the chapter 4 data (calendars, BL1 snapshots, assignment quantities) once, when it has no calendar; one seeded before
 * delivery 7 (migration 0007) gets its demo persona users' roles, e-mails and departments once (R-039), and its demo project
 * referents once (R-041). Each backfill runs in its own transaction; a failure there is logged and leaves the database as it was. A production database never gets them (they
 * load prototype data). Returns true when it seeded.
 */
export async function seedIfEmpty(db: DB, opts: { mode?: SeedMode } = {}): Promise<boolean> {
  const record = await readSeedRecord(db);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(projects);
  if (record || n > 0) {
    if ((record?.mode ?? 'demo') !== 'demo') {
      // ── Delivery 8 · production backfills · roles-rates-hr ──
      // R-178: the premium multipliers (placeholders to confirm) of a production database seeded before delivery 8. Idempotent:
      // only missing keys are added, an edited factor is never overwritten; here rather than in a SQL migration (PostgreSQL gets
      // it through db:migrate, which seeds after migrating).
      await db.transaction(async (tx) => seedRateMultipliers(tx)).catch((e) => logError('Delivery 8 rate multipliers backfill', e, { component: 'seed' }));
      // R-187: Arche's connector row (idempotent: added once, never changed).
      await ensureArcheConnector(db).catch((e) => logError('Delivery 9 Arche connector backfill', e, { component: 'seed' }));
      // R-158: the 11 Incoterms 2020 (idempotent: missing codes only, an edited row is never overwritten).
      await db.transaction(async (tx) => { await seedIncoterms(tx); }).catch((e) => logError('Delivery 9 Incoterms backfill', e, { component: 'seed' }));
      return false;
    }
    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(parts);
    if (c === 0) {
      await db.transaction(async (tx) => seedDelivery4(tx, await ctxFromDb(tx))).catch((e) => logError('Delivery 4 backfill', e, { component: 'seed' }));
    }
    const [{ r }] = await db.select({ r: sql<number>`count(*)::int` }).from(referenceValues);
    if (r === 0) {
      await db.transaction(async (tx) => seedDelivery5(tx, await ctxFromDb(tx))).catch((e) => logError('Delivery 5 backfill', e, { component: 'seed' }));
    }
    const [{ k }] = await db.select({ k: sql<number>`count(*)::int` }).from(calendars);
    if (k === 0) {
      await db.transaction(async (tx) => seedChapter4(tx)).catch((e) => logError('Chapter 4 backfill', e, { component: 'seed' }));
    }
    if ((await demoUsersToBackfill(db)) > 0) {
      await db.transaction(async (tx) => backfillDemoUsers(tx)).catch((e) => logError('Delivery 7 users backfill', e, { component: 'seed' }));
    }
    if (await demoReferentsToBackfill(db)) {
      await db.transaction(async (tx) => seedDemoReferents(tx)).catch((e) => logError('Delivery 7 project team backfill', e, { component: 'seed' }));
    }
    // Delivery 7 (cost-control): risk costs of a database seeded before migration 0007 (idempotent).
    await backfillCostControl(db).catch((e) => logError('Delivery 7 cost-control backfill', e, { component: 'seed' }));
    // Delivery 7 (R-170): the stored "Reset to defaults" document (idempotent, never overwrites an existing one).
    const [{ d }] = await db.select({ d: sql<number>`count(*)::int` }).from(appSettings).where(eq(appSettings.key, APP_SETTING_DEFAULTS));
    if (d === 0) {
      await db.transaction(async (tx) => seedSettingsDefaults(tx)).catch((e) => logError('Delivery 7 Settings defaults backfill', e, { component: 'seed' }));
    }
    // ── Delivery 8 · demo backfills · cost-change ──
    // R-069: the contractual impact of the change requests raised before it was asked (idempotent).
    await backfillContractImpacts(db).catch((e) => logError('Delivery 8 cost-change backfill', e, { component: 'seed' }));
    // ── Delivery 8 · demo backfills · roles-rates-hr ──
    // R-044: the Finance persona's user on a demo database seeded before delivery 8 (idempotent).
    if (await financeUserToBackfill(db)) {
      await db.transaction(async (tx) => seedFinanceUser(tx)).catch((e) => logError('Delivery 8 Finance user backfill', e, { component: 'seed' }));
    }
    // ── Delivery 9 · demo backfills · planning-load ──
    // Owner answer 18 Oct 2026 (fourth round): the named demo assignments of a demo database seeded before them (once: only while
    // its schedules name at most the prototype's one person).
    if (await demoAssignmentsToBackfill(db)) {
      await db.transaction(async (tx) => { await seedDemoAssignments(tx); }).catch((e) => logError('Delivery 9 demo assignments backfill', e, { component: 'seed' }));
    }
    // R-084 (absences), owner 22 Oct 2026: demo leave shifted off the assignments (./demo-leave.ts) — once, while the database's
    // seeded leave is still exactly the prototype's.
    if (await demoLeaveToShift(db)) {
      await db.transaction(async (tx) => { await shiftDemoLeave(tx); }).catch((e) => logError('Delivery 9 demo leave shift', e, { component: 'seed' }));
    }
    // R-186: the demo machine catalogue of a demo database seeded before it (once: while nobody has written to the catalogue).
    if (await demoCatalogueToBackfill(db)) {
      await db.transaction(async (tx) => { await seedDemoCatalogue(tx); }).catch((e) => logError('Delivery 9 demo catalogue backfill', e, { component: 'seed' }));
    }
    // R-187: Arche's connector row, then the demo machine needs and answers of a demo database seeded before them (once: while
    // the mirror and the answers are empty).
    await ensureArcheConnector(db).catch((e) => logError('Delivery 9 Arche connector backfill', e, { component: 'seed' }));
    if (await demoCapexNeedsToBackfill(db)) {
      await db.transaction(async (tx) => { await seedDemoCapexNeeds(tx); }).catch((e) => logError('Delivery 9 demo machine needs backfill', e, { component: 'seed' }));
    }
    // R-190: the demo subsidiary registered as an internal client (once: while no client is internal nor uses its name or codes).
    if (await demoInternalClientToBackfill(db)) {
      await db.transaction(async (tx) => { await seedDemoInternalClient(tx); }).catch((e) => logError('Delivery 9 demo internal client backfill', e, { component: 'seed' }));
    }
    // Matrix D21: the demo subsidiaries mirrored from Matrix (once: while the mirror is empty).
    if (await demoMatrixSubsidiariesToBackfill(db)) {
      await db.transaction(async (tx) => { await seedDemoMatrixSubsidiaries(tx); }).catch((e) => logError('Delivery 9 demo Matrix subsidiaries backfill', e, { component: 'seed' }));
    }
    // R-158: the Incoterms (idempotent), the Logistics persona's person and user, and the demo shipment (once: while no shipment
    // exists).
    await db.transaction(async (tx) => { await seedIncoterms(tx); }).catch((e) => logError('Delivery 9 Incoterms backfill', e, { component: 'seed' }));
    if (await logisticsUserToBackfill(db)) {
      await db.transaction(async (tx) => { await seedLogisticsUser(tx); }).catch((e) => logError('Delivery 9 Logistics user backfill', e, { component: 'seed' }));
    }
    if (await demoShipmentsToBackfill(db)) {
      await db.transaction(async (tx) => { await seedDemoShipments(tx); }).catch((e) => logError('Delivery 9 demo shipment backfill', e, { component: 'seed' }));
    }
    // R-158 lot B: EXP-01 arrived with its partial reception (once: while EXP-01 is still "prepared" and nothing is pointed).
    if (await demoShipmentLotBToBackfill(db)) {
      await db.transaction(async (tx) => { await seedDemoShipmentLotB(tx); }).catch((e) => logError('Delivery 9 demo shipment lot B backfill', e, { component: 'seed' }));
    }
    // ── Delivery 8 · demo backfills · connectors ──
    // Databases seeded before delivery 7 adopt their (demo) record.
    if (!record) await writeSeedRecord(db, 'demo').catch((e) => logError('Seed record', e, { component: 'seed' }));
    return false;
  }
  const mode = opts.mode ?? 'demo';
  // Emptiness is checked again inside the seeding transaction: of two processes that both found the database empty (two
  // instances starting together), one seeds and the other finds it seeded — after it on a server (write lock, and
  // `db:migrate` holds the migration lock), or run again after the serialization failure (SERIALIZABLE, R-010).
  const seeded = await db.transaction(async (tx) => {
    const [{ n: already }] = await tx.select({ n: sql<number>`count(*)::int` }).from(projects);
    if (already > 0 || (await readSeedRecord(tx))) return false;
    if (mode === 'production') await seedReferenceData(tx);
    else await seedDemoData(tx);
    await writeSeedRecord(tx, mode);
    return true;
  });
  if (seeded) log.info('Database seeded', { component: 'seed', seed: mode });
  return seeded;
}
