import 'server-only';
// Data of the Project BOM screen (docs/spec/09 §1): the project BOM, plus what the selected display needs — the costed
// assembly (tree and node drawer), the Where-used analysis, the revision comparison or the PU/PR list of a system — and
// the activities offered by "Add article". Read through the BOM, parts, purchasing, stock and Vigie (ECO) DALs; the
// screen model (src/features/bom/model.ts) formats it. Projects without a BOM get empty data (no Harbor Line fallback).
import {
  getProjectAssembly, getProjectBom, getRevisionComparison, getSpareList, getWhereUsed, listBomActivityOptions, resolveWhereUsedQuery,
  type ProjectAssembly, type ProjectBom, type RevisionComparison, type SpareList, type WhereUsed,
} from './bom';

export type BomScreenView = 'flat' | 'tree' | 'used' | 'compare' | 'spares';

export interface BomScreenData {
  bom: ProjectBom;
  /** Tree view (rows and the node drawer); null when the project has no multi-level structure or another view is shown. */
  assembly: ProjectAssembly | null;
  /** Where-used view: the analysis of the resolved part. */
  whereUsed: WhereUsed | null;
  /** Compare view: the root assembly's last revision comparison. */
  comparison: RevisionComparison | null;
  /** PU/PR view: the list of the selected system (default: the complete system). */
  spares: SpareList | null;
}

/** Everything the screen shows for `view`; null for an unknown project. */
export async function getBomScreen(projectCode: string, opts: { view: BomScreenView; used?: string; system?: string | null }): Promise<BomScreenData | null> {
  const bom = await getProjectBom(projectCode);
  if (!bom) return null;
  const data: BomScreenData = { bom, assembly: null, whereUsed: null, comparison: null, spares: null };
  if (opts.view === 'tree' && bom.hasTree) data.assembly = await getProjectAssembly(projectCode);
  if (opts.view === 'used') data.whereUsed = await getWhereUsed(await resolveWhereUsedQuery(opts.used ?? ''), projectCode);
  if (opts.view === 'compare' && bom.hasTree) data.comparison = await getRevisionComparison(projectCode);
  if (opts.view === 'spares' && bom.hasTree) data.spares = await getSpareList(projectCode, opts.system ?? null);
  return data;
}

/** Activities offered by the Add article form ("A1250 · name", the project's first 12). */
export const getBomActivityOptions = (projectCode: string) => listBomActivityOptions(projectCode);
