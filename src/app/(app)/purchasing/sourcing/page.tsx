// Sourcing, invoices & suppliers — /purchasing/sourcing (docs/spec/08 §1, template 1972–2078, logic 4646–4676).
// Cross-project screen: requests for quotation (quote comparison, award → draft purchase order), supplier invoices
// checked by the 3-way match (approve, approve the received part, reject), and the supplier scorecard (its NCR counts
// follow the current project). URL state (docs/spec/00 §8.3): `?tab=rfq|inv|sup` (default rfq), `?rfq=` / `?inv=` open
// the drawers (a drawer parameter alone selects its tab), `?status=<invoice status code>` filters the invoices.
// Primary "New RFQ" (AF `procurement`). Roles: director, project manager, procurement; others see the screen read-only
// under the "Outside my workspace" banner. Invoice decisions belong to procurement and the director (P-5).
import { PageHeader } from '@/components/app/shell/page-header';
import { DEFAULT_PROJECT } from '@/config/screens';
import { isSourcingTab, type SourcingTab } from '@/domain/procurement';
import { newRfqFormDef } from '@/features/procurement/forms';
import { procT } from '@/features/procurement/i18n';
import {
  invoiceDrawerView, invoiceTabView, parseInvoiceFilter, rfqDrawerView, rfqTabView, segView, supplierTabView, type SourcingCtx,
} from '@/features/procurement/model';
import { NewRfqButton } from '@/features/procurement/new-rfq-button';
import { SourcingBody, type SourcingBodyProps } from '@/features/procurement/sourcing-view';
import { getProject, projectLabel } from '@/server/dal/projects';
import { getPurchaseOrder, listRfqs, listSupplierInvoices } from '@/server/dal/purchasing';
import { rfqKpiFacts } from '@/server/dal/kpis';
import { getSupplierScorecard } from '@/server/dal/suppliers';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject } from '@/server/session';
import { canSeeSupplierPrices } from '@/domain/rights';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function SourcingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [sp, i18n, access, lastProject] = await Promise.all([searchParams, getI18n(), getScreenAccess('procurement'), getLastProject()]);
  const { lang } = i18n;
  const t = procT(i18n.t, lang);
  const rawTab = first(sp.tab);
  const rfqSel = first(sp.rfq);
  const invSel = first(sp.inv);
  const tab: SourcingTab = isSourcingTab(rawTab) ? rawTab : invSel && !rfqSel ? 'inv' : 'rfq';
  // R-046 (NEW-D2-1): quotes, last prices and supplier invoices only for the director, the PMs and procurement.
  const ctx: SourcingCtx = { t, lang, role: access.viewer.role, canEdit: access.canEdit, prices: canSeeSupplierPrices(access.viewer.role) };
  const project = await getProject(lastProject);
  // Links to project screens (Purchase orders, Deliveries) need a real project: an unknown last-project cookie falls
  // back to the default project; the scorecard keeps the cookie's code (no Harbor Line data for an unknown project).
  const currentProject = project?.code ?? DEFAULT_PROJECT;

  const body: SourcingBodyProps = { tab, seg: segView(t), t };
  if (tab === 'rfq') {
    const [rfqs, facts] = await Promise.all([listRfqs(), rfqKpiFacts()]);
    const sel = rfqs.find((r) => r.number === rfqSel) ?? null;
    const order = sel?.purchaseOrderNumber ? await getPurchaseOrder(sel.purchaseOrderNumber) : null;
    body.rfq = {
      view: rfqTabView(rfqs, sel?.number ?? null, ctx, facts),
      drawer: sel ? rfqDrawerView(sel, { ...ctx, orderProject: order?.projectCode ?? null, currentProject }) : null,
    };
  } else if (tab === 'inv') {
    const invoices = await listSupplierInvoices();
    const filter = parseInvoiceFilter(first(sp.status) ?? undefined, invoices);
    const sel = invoices.find((i) => i.number === invSel) ?? null;
    body.inv = {
      view: invoiceTabView(invoices, filter, sel?.number ?? null, ctx),
      drawer: sel ? invoiceDrawerView(sel, filter, { ...ctx, currentProject }) : null,
    };
  } else {
    body.sup = supplierTabView(await getSupplierScorecard(project?.code ?? lastProject), ctx);
  }

  const primary = access.canEdit ? <NewRfqButton form={newRfqFormDef(t)} context={project ? t(projectLabel(project)) : undefined} /> : undefined;

  return (
    <>
      <PageHeader screen="procurement" primary={primary} />
      <SourcingBody {...body} />
    </>
  );
}
