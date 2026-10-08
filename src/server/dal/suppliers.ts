import 'server-only';
// Suppliers & storage locations DAL (docs/spec/08 §1.4.4 supplier scorecard, §4 stock locations; 11 §3.8 Supplier,
// StorageLocation). The scorecard figures are Sage X3 / purchasing statistics (static, SC-6); the "NCRs this quarter"
// column counts the current project's goods-receipt NCRs on parts that supplier delivered to it.
import { asc, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { locationType, type LocationType, type SupplierGrade } from '@/server/db/codes';
import { goodsReceipts, parts, projects, receiptLines, storageLocations, suppliers } from '@/server/db/schema';
import { PROTO } from '@/server/prototype';

export interface SupplierRow {
  name: string;
  isInternal: boolean;
  x3Code: string | null;
}

/** Every company known to Keystone (scorecard suppliers first, then manufacturers and other bidders). */
export async function listSuppliers(): Promise<SupplierRow[]> {
  const db = await getDb();
  return db.select({ name: suppliers.name, isInternal: suppliers.isInternal, x3Code: suppliers.x3Code }).from(suppliers).orderBy(asc(suppliers.position));
}

export interface ScorecardRow {
  name: string;
  onTimeDeliveryPct: number;
  qualityAcceptancePct: number;
  ncrRatePct: number;
  grade: SupplierGrade;
  /** Open purchase orders in Sage X3 (all company orders, a snapshot). */
  openPoCount: number;
  /** Goods-receipt NCRs of the current project on parts this supplier delivered to it. */
  ncrsThisQuarter: number;
}

export interface SupplierScorecard {
  rows: ScorecardRow[];
  /** Goods-receipt NCRs of the current project (KPI "NCRs from suppliers"). */
  supplierNcrs: number;
}

interface NcrRef { id: string; src: string; part: string }

/**
 * NCRs of a project (`allNCRs` 4614). TODO(db): NCRs are not modelled yet (phase 7) — read from the prototype data set:
 * Harbor Line's register; on the other projects with data, two re-labelled rows whose part is cleared; none on
 * projects without data (the prototype showed Harbor Line's, 00 §7.16).
 */
function projectNcrs(projectCode: string): NcrRef[] {
  const hlt = PROTO.HLT_NCRS as NcrRef[];
  if (projectCode === 'HLT-026') return hlt;
  if (!PROTO.DEFS[projectCode]) return [];
  return hlt.slice(1, 3).map((n, i) => ({ ...n, id: 'NCR-0' + (40 + i), part: '' }));
}

/** The supplier scorecard (SUPPLIERS order) with the NCR counts of the current project. */
export async function getSupplierScorecard(projectCode: string): Promise<SupplierScorecard> {
  const db = await getDb();
  const [rows, ncrs, delivered] = await Promise.all([
    db.select().from(suppliers).where(isNotNull(suppliers.scorecardPosition)).orderBy(asc(suppliers.scorecardPosition)),
    projectNcrs(projectCode),
    db.select({ supplier: suppliers.name, ref: parts.ref })
      .from(receiptLines)
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, receiptLines.receiptId))
      .innerJoin(projects, eq(projects.id, goodsReceipts.projectId))
      .innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
      .innerJoin(parts, eq(parts.id, receiptLines.partId))
      .where(eq(projects.code, projectCode)),
  ]);
  const fromReceipt = ncrs.filter((n) => n.src === 'Goods receipt');
  return {
    rows: rows.map((s) => ({
      name: s.name, onTimeDeliveryPct: s.onTimeDeliveryPct ?? 0, qualityAcceptancePct: s.qualityAcceptancePct ?? 0, ncrRatePct: s.ncrRatePct ?? 0,
      grade: s.grade ?? 'C', openPoCount: s.openPoCount ?? 0,
      ncrsThisQuarter: fromReceipt.filter((n) => !!n.part && delivered.some((d) => d.supplier === s.name && d.ref === n.part)).length,
    })),
    supplierNcrs: fromReceipt.length,
  };
}

export interface StorageLocationRow {
  name: string;
  type: LocationType;
  /** "Central warehouse". */
  typeLabel: string;
  /** Configured in Settings (chips, transfer targets); false for the generated receipts' unconfigured site store. */
  active: boolean;
  position: number;
}

/** Storage locations in Settings order (configured ones only unless asked). */
export async function listStorageLocations(opts: { includeInactive?: boolean } = {}): Promise<StorageLocationRow[]> {
  const db = await getDb();
  const rows = await db.select().from(storageLocations).where(opts.includeInactive ? undefined : eq(storageLocations.active, true)).orderBy(asc(storageLocations.position));
  return rows.map((l) => ({ name: l.name, type: l.type, typeLabel: locationType.label(l.type), active: l.active, position: l.position }));
}
