// Budget & cost: DAL integration (in-memory PGlite seeded from the prototype) + static render of the three tabs,
// checked against the prototype's displayed values (docs/spec/04 §1.4–§1.6).
// Delivery 7 (lot cost-control) changes these displayed values on purpose, each citing its owner decision:
//  - R-073 / C-2a, A-12: EV = progress × BAC from the activities (€3.08M → €3.01M), PV from the cost-loaded BL1, AC = activities'
//    actual cost + validated contingency draw-downs (€3.36M, unchanged) — so CPI 0.92 → 0.89, EAC €5.24M → €5.37M, VAC −€436k →
//    −€565k, TCPI 1.19 → 1.25, CV −€280k → −€354k, SV −€340k → −€657k; orders placed = the open purchase orders (€713k → €3.95M);
//  - R-068 / A-4: the change list, "Pending" and the work packages' changes read the single register (CR-007 "Yard drainage
//    re-routing", CR-008 "Second steel crew — schedule recovery" −12 days in review; 1.3 +€120k, 1.5 +€65k, 1.7 +€15k);
//  - R-070 / A-8: contingency drawn = the register's validated draw-downs (139 % · +€58k over → 32 %), forecast €208k apart.
// Delivery 7 (lot contract-portfolio): NEW-D3-3 (R-079) milestones priced on the base amount plus Amendment 1's own M6, and C-6
// (R-076) receipts at the payment rule's dates — combined with R-073 in Cash & recovery (see that test).
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/budget', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { swapProjectInPath } from '@/components/app/shell/nav-model';
import { cashRecovery, contractValue, evmCore, openCommitment, termsDays } from '@/domain/evm';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getBudgetContract, getBudgetData, getRexPattern, type BudgetData } from '@/server/dal/budget';
import { CashTab } from './cash-tab';
import { budgetT } from './i18n';
import { PerformanceTab } from './performance-tab';
import { SetupTab } from './setup-tab';
import { BudgetViewBar, budgetTabHref, parseBudgetTab } from './view-bar';

const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function render(data: BudgetData, tab: 'perf' | 'setup' | 'cash', lang: Lang, canEdit = true) {
  const t = budgetT(makeT(lang), lang);
  const { cost, contract } = data;
  const core = evmCore({ pv: cost.pv, ev: cost.ev, ac: cost.ac, bac: cost.bac });
  const profileText = 'PROFILE';
  if (tab === 'perf') return html(h(PerformanceTab, { cost, core, offer: cost.offer, profileText, setupHref: '/b?tab=setup', lang, t }), lang);
  if (tab === 'setup') return html(h(SetupTab, { cost, offer: cost.offer, rex: data.rex, profileText, planHref: '/p', canEdit, lang, t }), lang);
  const total = contract ? contractValue(contract.amount, contract.amendments) : 0;
  const recovery = contract
    ? cashRecovery({
        pv: cost.pv, ac: cost.ac, bac: cost.bac, evn: core.evn, cpi: core.cpi, contractTotal: total, milestones: contract.milestones,
        termsDays: termsDays(contract.terms), openCommit: openCommitment(cost.pv, core.evn, contract.openCommit), year: contract.year,
      })
    : null;
  return html(h(CashTab, { recovery, contractTotal: total, terms: contract?.terms ?? '', ac: core.ac, lang, t }), lang);
}

describe('Budget & cost', () => {
  let hlt: BudgetData;
  beforeAll(async () => {
    setDb(await openDatabase());
    hlt = (await getBudgetData('HLT-026'))!;
  }, 60_000);

  it('DAL: HLT-026 data, REX pattern, contract; no data → null', async () => {
    expect(hlt.cost.bac).toBe(4800);
    expect(hlt.rex).toMatchObject({ mt: 'EMP', dep: 30, deliv: 60, acc: 10 });
    expect(hlt.rex?.refs.map((r) => r.id)).toEqual(['HAV001', 'ANT002']);
    expect(hlt.contract).toMatchObject({ ref: 'CTR-HLT-001', amount: 5400, terms: 'Net 45 days', openCommit: 3946.5 });
    // NEW-D3-3 (R-079): Amendment 1's own milestone M6 (signed, billable) follows the base contract's five.
    expect(hlt.contract?.milestones.map((m) => [m.id, m.status, m.amount])).toEqual([
      ['M1', 'paid', 540], ['M2', 'paid', 1080], ['M3', 'invoiced', 1350], ['M4', 'planned', 1080], ['M5', 'planned', 1350], ['M6', 'planned', 120],
    ]);
    expect(await getBudgetData('SCP-033')).toBeNull();
    expect(await getBudgetContract('NDC-031')).toBeNull();
    expect((await getRexPattern('ERP-202'))?.mt).toBe('R&D');
    expect((await getRexPattern('ERP-202'))?.acc).toBe(0);
    expect((await getRexPattern('NDC-031'))?.mt).toBe('AUTRE');
  });

  it('view bar: tab parsing, hrefs and segmented', () => {
    expect([parseBudgetTab(undefined), parseBudgetTab('setup'), parseBudgetTab('cash'), parseBudgetTab('x')]).toEqual(['perf', 'setup', 'cash', 'perf']);
    expect(budgetTabHref('/projects/HLT-026/budget', 'perf')).toBe('/projects/HLT-026/budget');
    const out = html(h(BudgetViewBar, { tab: 'cash', base: '/b', t: makeT('fr') }), 'fr');
    expect(text(out)).toContain('Vue Performance Structure & modifications Trésorerie & recouvrement');
    expect(out).toContain('href="/b?tab=cash"');
  });

  it('project switch keeps the tab (budgetTab survives project switches, §1.3) and drops selections', () => {
    expect(swapProjectInPath('/projects/HLT-026/budget', 'NDC-031', '?tab=cash')).toBe('/projects/NDC-031/budget?tab=cash');
    expect(swapProjectInPath('/projects/HLT-026/plan', 'NDC-031', '?view=structure&act=A1250')).toBe('/projects/NDC-031/plan?view=structure');
    expect(swapProjectInPath('/projects/HLT-026/budget', 'NDC-031')).toBe('/projects/NDC-031/budget');
  });

  it('Performance (EN): KPIs, variance, chart, cost breakdown', () => {
    const out = render(hlt, 'perf', 'en');
    const tx = text(out);
    for (const s of [
      'Budget (BAC) €4.80M Approved baseline',
      'Actual cost €3.36M 70% of budget',
      'Earned value €3.01M Work completed',
      // R-154: a value in LO carries the alert mark, read out as "· Alert".
      'Forecast (EAC) €5.37M · Alert At current CPI',
      'Variance (VAC) −€565k · Alert -11.8% of budget',
      'CPI 0.89 · Alert Target ≥ 1.00',
      'TCPI 1.25 · Alert Needed to hit BAC',
      'Cost (EV−AC) −€354k · Alert',
      'Schedule (EV−PV) −€657k · Alert',
      'Budget at completion · €4.80M',
      'EAC €5.37M',
      'Planned value follows the cost-loaded baseline · Earned value = progress × budget · PROFILE',
      'Overrun is widening ~$40k a month, led by steel labor. To finish on budget the remaining work needs a CPI of 1.25 .',
      'Labor €1.85M €1.42M €180k €2.01M',
      // R-073: the material line commits the open purchase orders.
      'Materials €1.32M €960k €3.95M €1.46M',
      'Permits & fees €140k €62k — €128k',
      // A-8: the reserve line is the register (drawn 48, forecast 208).
      'Contingency €150k €48k — €208k −€58k',
    ])
      expect(tx).toContain(s);
    expect(out).toContain('d="M52.0 260.0 L109.7 255.8 L167.3 251.5 L225.0 248.1');
    expect(out).toContain('<title>Structural steel — columns, beams, purlins · deposit 30 % · €192k · Mar</title>');
    // Delivery 8 (R-080, C-1): signed variance bars — the largest is 90 % of half the plot (was 80 % of the plot, always downwards).
    expect(out).toContain('_barDown_');
    expect(out).toContain('--bar-h:90%');
    expect(out).toContain('href="/b?tab=setup"');
  });

  it('Performance (FR)', () => {
    const tx = text(render(hlt, 'perf', 'fr'));
    for (const s of [
      'Coût réel 3,36 M€ 70 % du budget', 'Écart (VAC) −565 k€ · Alerte -11,8 % du budget', 'Budget à l’achèvement · 4,80 M€', 'Aujourd’hui', 'janv.', 'Main-d’œuvre', 'Matériaux',
      'La valeur planifiée suit la référence chargée en coûts · Valeur acquise = avancement × budget',
    ])
      expect(tx).toContain(s);
  });

  it('Structure & changes (EN): offer, REX, streams, reconciliation, categories, CRs, work packages', () => {
    const out = render(hlt, 'setup', 'en');
    const tx = text(out);
    for (const s of [
      'Structural steel — columns, beams, purlins Keystone Steelworks €640k 30 / 60 / 10 % Mar → Jun → Sep 14 wk',
      'Crane rails A100 + fixings Halvorsen Cranes €290k 30 / 70 % Apr → Oct',
      'Financial REX · same product category · EMP',
      'HAV001 Terminal Ouest — Dunkerque 29 % deposits · peak M8 · 8 % at SAT 2023',
      'Labor Timesheets × role rate, per activity',
      'Original budget €4.60M BL1 · 12 Mar 2026',
      'Approved changes +€200k 3 change requests',
      'Current budget (BAC) €4.80M Basis for CPI / EAC',
      'Pending +€85k CR-008 · In review',
      'Contingency €150k 32% drawn · Forecast €208k',
      'C06 Contingency Reserve Drawn by change request €150k',
      'CR-004 Additional piling — soft ground at Bay 4 14 May · R. Aubert +€120k +12 days Approved',
      'CR-006 Crane specification upgrade to 250 t 02 Jul · Steering committee +€65k No schedule impact Approved',
      'CR-007 Yard drainage re-routing 20 Aug · R. Aubert +€15k No schedule impact Approved',
      'CR-008 Second steel crew — schedule recovery 24 Sep · R. Aubert +€85k -12 days In review',
      'CR-005 Value engineering — paving thickness 11 Jun · Client −€40k No schedule impact Rejected',
      '1.3 Foundations €740k +€120k €860k €802k €802k',
      '1.4 Steel structure €960k — €960k €816k €1.19M',
      '1.5 Crane installation €620k +€65k €685k €372k €690k',
      'Total €4.60M +€200k €4.80M €3.36M €5.24M',
    ])
      expect(tx).toContain(s);
    // Hourglass on the 3 long-lead quotes (≥ 26 wk); WP bar of the total row; edit controls.
    expect(out.match(/<svg[^>]*><path[^>]*><\/path><\/svg>26 wk|26 wk/g)?.length).toBeGreaterThanOrEqual(2);
    expect(out).toContain('--wp-a:50%;--wp-t:71.4%;--wp-e:77.9%');
    expect(tx).toContain('Add category');
    expect(tx).toContain('New change request');
    // X-13b / R-154: same tones as change control (approved neutral, in review accent, rejected outline).
    expect(out).toContain('class="tag tag-neutral">Approved');
    expect(out).toContain('class="tag tag-accent">In review');
    expect(out).toContain('class="tag tag-outline">Rejected');
  });

  it('Structure & changes: read-only hides edit controls; FR labels', () => {
    const ro = text(render(hlt, 'setup', 'fr', false));
    expect(ro).not.toContain('Ajouter une catégorie');
    expect(ro).not.toContain('Nouvelle demande de modification');
    for (const s of ['Budget initial', 'Réserve', '32 % consommés · Prévision 208 k€', 'CR-008 · En revue', 'Sans impact planning', 'Provision pour aléas (non affectée)', 'Ouvrir le plan'])
      expect(ro).toContain(s);
  });

  it('Structure & changes: project without change requests shows the empty state', async () => {
    const ndc = (await getBudgetData('NDC-031'))!;
    const tx = text(render(ndc, 'setup', 'en'));
    expect(tx).toContain('No change requests raised — the current budget equals the original baseline');
    expect(tx).toContain('Approved changes — 0 change requests');
    expect(tx).toContain('Financial REX · same product category · AUTRE');
  });

  it('Cash & recovery (EN): KPIs, chart and monthly schedule', () => {
    const out = render(hlt, 'cash', 'en');
    const tx = text(out);
    // Both delivery-7 lots move these figures; the expected values are their combination.
    //  - R-073 (cost-control; C-2a, A-12): committed = actual cost by month from the activities' actual spans + the open purchase
    //    orders (€3.95M at their line prices; the prototype's literal was €713k) — committed to date €4.07M → €7.31M, Apr €385k →
    //    €97k, Sep €1.12M → €4.54M;
    //  - NEW-D3-3 (R-079, contract-portfolio): milestones at base-amount prices plus Amendment 1's M6 (prototype €1.66M received,
    //    30 %, next €1.38M, M1 €552k); C-6 (R-076): each receipt in the month of its payment date (invoice due date, else
    //    contractual date + 45 days) — M4 and M6 in Jan ’27, M5 in Feb ’27 (the prototype rounded M5 to Mar ’27).
    // Combined: received €1.62M (29 %) against €7.31M committed → recovery and lowest point −€5.69M in Sep (cost-control alone:
    // −€5.65M, coverage 23 %; contract-portfolio alone: −€2.45M, coverage 40 %, low −€2.54M in Oct).
    for (const s of [
      'Client payments received €1.62M 2 milestones paid · 29 % of contract',
      'Committed to date €7.31M €3.36M actual cost · €3.95M orders placed',
      'Recovery −€5.69M we are financing the project',
      'Coverage 22 % received ÷ committed',
      'Next receipt €1.35M M3 · Nov · Net 45 days',
      'Lowest point −€5.69M Sep · already passed',
      'Apr €540k M1 €97k +€181k',
      'Sep — €4.54M incl. €3.95M orders placed −€5.69M',
      'Jan ’27 €1.20M M4 · M6 €0k −€3.14M',
      'Feb ’27 €1.35M M5 €0k −€1.79M',
      'Mar ’27 — €0k −€1.79M',
    ])
      expect(tx).toContain(s);
    expect(out).toContain('d="M467.2 32.2 L513.3 32.2 L559.5 32.2');
    expect(out).toContain('Jan’27');
    expect(out).toContain('background:var(--color-accent-900)');
  });

  it('Cash & recovery: no contract → empty state', async () => {
    const ndc = (await getBudgetData('NDC-031'))!;
    expect(text(render(ndc, 'cash', 'fr'))).toContain('Aucun contrat enregistré pour ce projet');
  });
});
