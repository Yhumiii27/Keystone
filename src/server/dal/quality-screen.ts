import 'server-only';
// Screen data of Quality — NCR & deliverables (docs/spec/07 §2.3): the project's NCRs as Vigie reports them (mirror +
// progress waiting for Vigie, src/server/dal/quality.ts), its deliverables register, and what the drawers link to — the
// open ECO of each NCR part (Vigie ECO mirror, `ecoOpenFor`), the project's purchase orders carrying that part, and the
// project's Codex index records (the deliverable's issued document). Projects without data get empty lists.
import { businessToday } from '@/server/clock';
import { listVaultDocuments } from './documents';
import { openEcoByPart } from './eco';
import { ncrClosureDates, projectDataDateOf } from './kpis';
import { listPurchaseOrders } from './purchasing';
import { listDeliverables, listNcrs, type DeliverableRow, type NcrRow } from './quality';

export type { DeliverableRow, NcrRow };

/** A Codex index record of the project, as the deliverable drawer shows and offers it. */
export interface QualityDocument {
  number: string;
  title: string;
  revision: string;
  /** EN source label ("Released"). */
  statusLabel: string;
}

export interface QualityScreenData {
  ncrs: NcrRow[];
  deliverables: DeliverableRow[];
  /** First open ECO of each NCR part (ref → ECO number); parts without one are absent. */
  ecoByPart: Record<string, string>;
  /** Purchase orders of the project carrying each NCR part (ref → PO numbers, register order). */
  ordersByPart: Record<string, string[]>;
  /** The project's own Codex records (number order), for the deliverable's issued document. */
  documents: QualityDocument[];
  /** The project's data date (A-12: "closed this quarter" is the quarter of this date). */
  dataDate: string;
  /** Business date (ISO, R-013): "Overdue actions" as of a week later, "Due in 30 days" from it. */
  today: string;
}

export async function getQualityScreen(projectCode: string): Promise<QualityScreenData> {
  const [listed, deliverables, closedOn, dataDate, today] = await Promise.all([
    listNcrs(projectCode), listDeliverables(projectCode), ncrClosureDates(projectCode), projectDataDateOf(projectCode), businessToday(),
  ]);
  // A-12: closure date of a closed NCR = Vigie's last update of the record, when the mirror has it.
  const ncrs = listed.map((n) => (n.status === 'closed' ? { ...n, closedOn: closedOn.get(n.number) ?? null } : n));
  const parts = [...new Set(ncrs.map((n) => n.partRef).filter((r): r is string => !!r))];
  const [ecos, orders, docs] = await Promise.all([
    parts.length ? openEcoByPart() : Promise.resolve({} as Record<string, string>),
    parts.length ? listPurchaseOrders(projectCode) : Promise.resolve([]),
    deliverables.length ? listVaultDocuments() : Promise.resolve([]),
  ]);
  const ecoByPart: Record<string, string> = {};
  const ordersByPart: Record<string, string[]> = {};
  for (const ref of parts) {
    if (ecos[ref]) ecoByPart[ref] = ecos[ref];
    const pos = orders.filter((o) => o.lines.some((l) => l.ref === ref)).map((o) => o.number);
    if (pos.length) ordersByPart[ref] = pos;
  }
  const documents = docs
    .filter((d) => d.project === projectCode)
    .map((d) => ({ number: d.number, title: d.title, revision: d.revision, statusLabel: d.statusLabel }))
    .sort((a, b) => a.number.localeCompare(b.number));
  return { ncrs, deliverables, ecoByPart, ordersByPart, documents, dataDate, today };
}
