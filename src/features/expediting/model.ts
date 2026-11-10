import 'server-only';
// R-159 (P1, D9-31) — view model of the expediting section of the order drawer: the order's expediting (src/server/dal/expediting.ts)
// with the "Report the NCR in Vigie" link of each failed inspection (Vigie's report form prefilled with the project, the order,
// the supplier and the inspection reference "PO-1078/I-2", which Vigie echoes on the NCR). Serialisable (ISO dates).
import { getOrderExpediting, type OrderExpediting } from '@/server/dal/expediting';
import { vigieReportNcrUrl } from '@/server/integrations/vigie/links';

export interface ExpeditingView extends OrderExpediting {
  /** Report links of the failed inspections without an NCR yet, by inspection number. */
  reportNcr: Record<string, string>;
}

export async function expeditingView(projectCode: string, po: string, supplier: string | null, today: string): Promise<ExpeditingView | null> {
  const x = await getOrderExpediting(projectCode, po, today);
  if (!x) return null;
  const reportNcr: Record<string, string> = {};
  for (const i of x.inspections) {
    if (i.result !== 'failed' || i.ncrs.length || i.ncrRef) continue;
    reportNcr[i.number] = vigieReportNcrUrl({ projectCode, title: `${i.name} — ${po}`, inspection: i.ref, supplier, order: po });
  }
  return { ...x, reportNcr };
}
