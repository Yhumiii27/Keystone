// Budget & cost: DAL integration (in-memory PGlite seeded from the prototype) + static render of the three tabs,
// checked against the prototype's displayed values (docs/spec/04 §1.4–§1.6).
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
        termsDays: termsDays(contract.terms), openCommit: openCommitment(cost.pv, core.evn, contract.openCommit),
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
    expect(hlt.contract).toMatchObject({ ref: 'CTR-HLT-001', amount: 5400, terms: 'Net 45 days', openCommit: 713 });
    expect(hlt.contract?.milestones.map((m) => m.status)).toEqual(['paid', 'paid', 'invoiced', 'planned', 'planned']);
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
      'Earned value €3.08M Work completed',
      'Forecast (EAC) €5.24M At current CPI',
      'Variance (VAC) −€436k -9.1% of budget',
      'CPI 0.92 Target ≥ 1.00',
      'TCPI 1.19 Needed to hit BAC',
      'Cost (EV−AC) −€280k',
      'Schedule (EV−PV) −€340k',
      'Budget at completion · €4.80M',
      'EAC €5.24M',
      'Overrun is widening ~$40k a month, led by steel labor. To finish on budget the remaining work needs a CPI of 1.19 .',
      'Labor €1.85M €1.42M €180k €2.01M',
      'Permits & fees €140k €62k — €128k',
    ])
      expect(tx).toContain(s);
    expect(out).toContain('d="M52.0 260.0 L109.7 252.6 L167.3 242.9 L225.0 229.3');
    expect(out).toContain('<title>Structural steel — columns, beams, purlins · deposit 30 % · €192k · Mar</title>');
    expect(out).toContain('--bar-h:80%');
    expect(out).toContain('href="/b?tab=setup"');
  });

  it('Performance (FR)', () => {
    const tx = text(render(hlt, 'perf', 'fr'));
    for (const s of ['Coût réel 3,36 M€ 70 % du budget', 'Écart (VAC) −436 k€ -9,1 % du budget', 'Budget à l’achèvement · 4,80 M€', 'Aujourd’hui', 'janv.', 'Main-d’œuvre', 'Matériaux'])
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
      'Pending +€85k CR-008 · review 30 Sep',
      'Contingency €150k 139% drawn · +€58k over',
      'C06 Contingency Reserve Drawn by change request €150k',
      'CR-004 Additional piling — soft ground at Bay 4 14 May · R. Aubert +€120k +12 days Approved',
      'CR-006 Crane specification upgrade to 250 t 02 Jul · Steering committee +€65k No schedule impact Approved',
      'CR-008 Steel erection acceleration — second crew Review 30 Sep · Steering committee +€85k -18 days Pending',
      'CR-005 Value engineering — paving thickness 11 Jun · Client −€40k No schedule impact Rejected',
      '1.4 Steel structure €960k +€65k €1.02M €816k €1.19M',
      'Total €4.60M +€200k €4.80M €3.36M €5.24M',
    ])
      expect(tx).toContain(s);
    // Hourglass on the 3 long-lead quotes (≥ 26 wk); WP bar of the total row; edit controls.
    expect(out.match(/<svg[^>]*><path[^>]*><\/path><\/svg>26 wk|26 wk/g)?.length).toBeGreaterThanOrEqual(2);
    expect(out).toContain('--wp-a:50%;--wp-t:71.4%;--wp-e:77.9%');
    expect(tx).toContain('Add category');
    expect(tx).toContain('New change request');
    expect(out).toContain('class="tag tag-accent">Approved');
    expect(out).toContain('class="tag tag-outline">Pending');
    expect(out).toContain('class="tag tag-neutral">Rejected');
  });

  it('Structure & changes: read-only hides edit controls; FR labels', () => {
    const ro = text(render(hlt, 'setup', 'fr', false));
    expect(ro).not.toContain('Ajouter une catégorie');
    expect(ro).not.toContain('Nouvelle demande de modification');
    for (const s of ['Budget initial', 'Réserve', '139 % consommés · +58 k€ de dépassement', 'Sans impact planning', 'Provision pour aléas (non affectée)', 'Ouvrir le plan'])
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
    for (const s of [
      'Client payments received €1.66M 2 milestones paid · 30 % of contract',
      'Committed to date €4.07M €3.36M actual cost · €713k orders placed',
      'Recovery −€2.42M we are financing the project',
      'Coverage 41 % received ÷ committed',
      'Next receipt €1.38M M3 · Nov · Net 45 days',
      'Lowest point −€2.50M Oct · still ahead',
      'Apr €552k M1 €385k −€578k',
      'Sep — €1.12M incl. €713k orders placed −€2.42M',
      'Mar ’27 €1.38M M5 €0k +€655k',
    ])
      expect(tx).toContain(s);
    expect(out).toContain('d="M467.2 91.9 L513.3 88.5 L559.5 69.6');
    expect(out).toContain('Jan’27');
    expect(out).toContain('background:var(--color-accent-900)');
  });

  it('Cash & recovery: no contract → empty state', async () => {
    const ndc = (await getBudgetData('NDC-031'))!;
    expect(text(render(ndc, 'cash', 'fr'))).toContain('Aucun contrat enregistré pour ce projet');
  });
});
