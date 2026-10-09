// URLs of the Quality — NCR & deliverables screen and of the screens it opens (docs/spec/00 §8.3: view state in search
// params). Pure: usable from Server and Client Components, the My approvals providers and other screens.
//   /projects/{code}/quality                 NCR log (default register)
//     ?tab=dlv                               deliverables register (qTab; `?tab=ncr` is accepted, the default is omitted)
//     ?filter=minor|major|critical           NCR severity chips (ncrFilter)
//     ?status=planned|…|rejected             deliverable status chips (dlvFilter)
//     ?ncr=NCR-029                           NCR drawer (case-insensitive)
//     ?dlv=D-015                             deliverable drawer (case-insensitive; opens the deliverables register when no tab is given)
// Every Vigie URL comes from src/server/integrations/vigie/links.ts.
import { screenHref } from '@/config/screens';
import type { DeliverableStatus, NcrSeverity, QualityTab } from '@/domain/quality';

export interface QualityQuery {
  tab?: QualityTab | null;
  filter?: NcrSeverity | null;
  status?: DeliverableStatus | null;
  ncr?: string | null;
  dlv?: string | null;
}

const ORDER: (keyof QualityQuery)[] = ['tab', 'filter', 'status', 'ncr', 'dlv'];

/** `/projects/HLT-026/quality?tab=dlv&status=submitted&dlv=D-014` (the NCR tab is the default and is omitted). */
export function qualityHref(code: string, q: QualityQuery = {}): string {
  const u = new URLSearchParams();
  for (const k of ORDER) {
    const v = q[k];
    if (!v || (k === 'tab' && v === 'ncr')) continue;
    u.set(k, v);
  }
  const s = u.toString();
  const base = screenHref('quality', { code });
  return s ? `${base}?${s}` : base;
}

/** An NCR on the log of its project. */
export const ncrHref = (code: string, number: string) => qualityHref(code, { ncr: number });
/** A deliverable on the register of its project. */
export const deliverableHref = (code: string, number: string) => qualityHref(code, { tab: 'dlv', dlv: number });

const withQuery = (base: string, params: Record<string, string | null | undefined>) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
};

/** "Open activity": the activity drawer of the project plan (`{screen:'plan', sel, selOpen}`). */
export const planActivityHref = (code: string, activity: string) => withQuery(screenHref('plan', { code }), { act: activity });
/** "Open plan". */
export const planHref = (code: string) => screenHref('plan', { code });
/** "Part record": the PLM part drawer (`{screen:'plm', part}`). */
export const partRecordHref = (ref: string) => withQuery(screenHref('plm'), { part: ref });
/** The open ECO of the NCR's part (`{screen:'eco', eco}`). */
export const ecoHref = (number: string) => withQuery(screenHref('eco'), { eco: number });
/** A purchase order of the project (Orders drawer). */
export const purchaseOrderHref = (code: string, number: string) => withQuery(screenHref('orders', { code }), { po: number });
