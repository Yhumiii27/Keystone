// R-185 (owner's choice 3): Budget › Structure & changes — "Budget by equipment" on the demo multi-equipment project (Harbor
// Line: EQ-01 1 × EMP, EQ-02 3 × MEMU; its lots 1.5 → EQ-01 and 1.6 → EQ-02, DEMO_EQUIPMENT_LOTS — no amount changed). The total
// row equals the figures the screen already shows (work packages, EV, orders placed); single-line projects show nothing new.
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/budget', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canSee } from '@/config/role-screens';
import { evmCore, workPackageTotals } from '@/domain/evm';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getBudgetData, type BudgetData } from '@/server/dal/budget';
import { budgetT } from './i18n';
import { SetupTab } from './setup-tab';

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const setup = (data: BudgetData, lang: Lang) =>
  text(renderToStaticMarkup(h(I18nProvider, {
    lang,
    children: h(SetupTab, { cost: data.cost, offer: data.cost.offer, rex: data.rex, profileText: 'PROFILE', planHref: '/p', canEdit: false, equipment: data.equipment, lang, t: budgetT(makeT(lang), lang) }),
  })));

describe('Budget by equipment (R-185)', () => {
  let hlt: BudgetData;
  beforeAll(async () => {
    setDb(await openDatabase());
    hlt = (await getBudgetData('HLT-026'))!;
  }, 60_000);

  it('HLT-026: one row per line then common, attributed through the lots and the activities', () => {
    const eq = hlt.equipment!;
    expect(eq.rows.map((r) => r.lotLabel)).toEqual(['EQ-01 · EMP', 'EQ-02 · 3 × MEMU', null]);
    const [eq01, eq02, common] = eq.rows;
    // 1.5 Crane installation (620 + CR 65): its activities' actual 372 and EAC 690; the 250 t crane order (PO-1052, A1320).
    expect(eq01).toMatchObject({ ref: 'EQ-01', budget: 685, actual: 372, eac: 690, openOrders: 3700 });
    // 1.6 MEP systems (780, no change): actual 296, EAC 830; PO-1063, PO-1071, PO-1078 (A1410–A1430).
    expect(eq02).toMatchObject({ ref: 'EQ-02', budget: 780, actual: 296, eac: 830 });
    expect(eq02.openOrders).toBeCloseTo(246.48, 6);
    expect(common).toMatchObject({ ref: null, budget: 4800 - 685 - 780 });
  });

  it('the total row equals the project figures the screen shows', () => {
    const { cost } = hlt;
    const eq = hlt.equipment!;
    const wp = workPackageTotals(cost.workPackages);
    expect(eq.total.budget).toBeCloseTo(wp.original + wp.changes, 6);
    expect(eq.total.budget).toBeCloseTo(cost.bac, 6);
    expect(eq.total.actual).toBeCloseTo(wp.actual, 6);
    expect(eq.total.eac).toBeCloseTo(wp.eac, 6);
    // EV at the data date (Performance tile) and the orders placed (R-073).
    expect(Math.round(eq.total.ev!)).toBe(evmCore({ pv: cost.pv, ev: cost.ev, ac: cost.ac, bac: cost.bac }).ev);
    expect(Math.round(eq.total.openOrders * 10) / 10).toBe(cost.ordersPlaced);
    // Rows add up to the total.
    for (const k of ['budget', 'actual', 'eac', 'ev', 'openOrders'] as const)
      expect(eq.rows.reduce((t, r) => t + (r[k] ?? 0), 0)).toBeCloseTo(eq.total[k] ?? 0, 6);
  });

  it('projects with one equipment line get no breakdown (the screen as before)', async () => {
    for (const code of ['NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012']) expect((await getBudgetData(code))?.equipment).toBeNull();
  });

  it('renders on Structure & changes (EN, FR) with its notes; rights stay the Budget screen’s (no client)', async () => {
    const en = setup(hlt, 'en');
    expect(en).toContain('Budget by equipment');
    expect(en).toContain('EQ-01 · EMP');
    expect(en).toContain('EQ-02 · 3 × MEMU');
    expect(en).toContain('Common to the project');
    expect(en).toContain('Total €4.80M €3.36M €5.24M −€436k €3.01M €3.95M');
    expect(en).toContain('Cost categories are not broken down by equipment');
    expect(en).not.toContain('Earned value is not broken down');
    const fr = setup(hlt, 'fr');
    expect(fr).toContain('Budget par équipement');
    expect(fr).toContain('Commun au projet');
    expect(fr).toContain('Les catégories de coûts ne sont pas ventilées par équipement');
    const ndc = (await getBudgetData('NDC-031'))!;
    expect(setup(ndc, 'en')).not.toContain('Budget by equipment');
    expect(canSee('client', 'budget')).toBe(false);
  });
});
