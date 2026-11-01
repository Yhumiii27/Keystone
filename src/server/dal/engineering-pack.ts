import 'server-only';
// R-191 (Arche K-08): reads of the engineering pack — the standard lists of the machine types and a project's pack completeness
// (card "Engineering pack" of the Engineering synthesis). The rules are in src/domain/engineering-pack.ts; the view
// pub_pack_ingenierie (0060) publishes the same numbers (compared on the demo data by engineering-pack.test.ts).
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  normalisePackRows, packCompleteness, projectPackStandard, type PackCompleteness, type PackFamily, type PackStandardRow,
} from '@/domain/engineering-pack';
import { getDb } from '@/server/db/client';
import type { DocumentStatus } from '@/server/db/codes';
import { documentTypes, documents, machineTypePackFamilies, machineTypes, projectEquipments, projects } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';

type DbOrTx = DB | Tx;

/** Standard lists by machine type code (the five families in contract order; a missing family reads weight 0). */
export async function packStandards(db: DbOrTx, typeCodes?: readonly string[]): Promise<Map<string, PackStandardRow[]>> {
  if (typeCodes && !typeCodes.length) return new Map();
  const rows = await db.select().from(machineTypePackFamilies)
    .where(typeCodes ? inArray(machineTypePackFamilies.machineTypeCode, [...typeCodes]) : undefined);
  const by = new Map<string, PackStandardRow[]>();
  for (const r of rows) {
    const list = by.get(r.machineTypeCode) ?? [];
    list.push({ family: r.family, weight: r.weight, minExpected: r.minExpected });
    by.set(r.machineTypeCode, list);
  }
  for (const [k, v] of by) by.set(k, normalisePackRows(v));
  return by;
}

export interface PackDocumentRow {
  number: string;
  title: string;
  revision: string;
  status: DocumentStatus;
}

export interface EngineeringPack extends PackCompleteness {
  /** Display codes of the machine types the standard list comes from, main line first ("EMP", "MEMU"). */
  types: string[];
  /** The project's documents counted in each family (index order). */
  documents: Record<PackFamily, PackDocumentRow[]>;
}

/** The pack of a project, or null when the project has no machine type (nothing to measure against). */
export async function getEngineeringPack(projectCode: string, db?: DbOrTx): Promise<EngineeringPack | null> {
  const d = db ?? (await getDb());
  const [p] = await d.select({ id: projects.id, mt: projects.machineTypeCode }).from(projects).where(eq(projects.code, projectCode));
  if (!p) return null;
  const lines = await d.select({ mt: projectEquipments.machineTypeCode }).from(projectEquipments)
    .where(eq(projectEquipments.projectId, p.id)).orderBy(asc(projectEquipments.position));
  const typeCodes = lines.length ? lines.map((l) => l.mt) : p.mt ? [p.mt] : [];
  if (!typeCodes.length) return null;
  const distinct = [...new Set(typeCodes)];
  const [standards, labels, docs] = await Promise.all([
    packStandards(d, distinct),
    d.select({ code: machineTypes.code, label: machineTypes.label }).from(machineTypes).where(inArray(machineTypes.code, distinct)),
    d.select({ number: documents.number, title: documents.title, revision: documents.currentRevision, status: documents.status, family: documentTypes.packFamily })
      .from(documents).innerJoin(documentTypes, eq(documentTypes.code, documents.typeCode))
      .where(and(eq(documents.projectId, p.id), isNotNull(documentTypes.packFamily))).orderBy(asc(documents.sortOrder)),
  ]);
  const standard = projectPackStandard(typeCodes.map((c) => standards.get(c) ?? []));
  const counted = docs.filter((x): x is typeof x & { family: PackFamily } => x.family != null);
  const result = packCompleteness(standard, counted.map((x) => ({ family: x.family, status: x.status })));
  const labelOf = new Map(labels.map((l) => [l.code, l.label]));
  const byFamily = Object.fromEntries(standard.map((s) => [s.family, [] as PackDocumentRow[]])) as Record<PackFamily, PackDocumentRow[]>;
  for (const x of counted) byFamily[x.family]?.push({ number: x.number, title: x.title, revision: x.revision, status: x.status });
  return { ...result, types: distinct.map((c) => labelOf.get(c) ?? c), documents: byFamily };
}
