// Delivery 8, lot cost-change — the Budget screen: R-080 (C-1) the Performance tiles and the Variance card coloured by the Settings
// health thresholds (the prototype coloured EAC, VAC, CPI and TCPI in the attention colour whatever the value, 04 Q1) and the signed
// variance bars; R-081 (C-3a) Structure & changes after BL1 — the hint linking to Change control.
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/budget', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { evmCore } from '@/domain/evm';
import type { HealthThresholds } from '@/domain/health';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getBudgetData, type BudgetData } from '@/server/dal/budget';
import { budgetT } from './i18n';
import { PerformanceTab } from './performance-tab';
import { SetupTab } from './setup-tab';

const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const LO = 'var(--color-accent-300)';
const OK = 'var(--color-text)';

function perf(data: BudgetData, th?: HealthThresholds) {
  const t = budgetT(makeT('en'), 'en');
  const { cost } = data;
  const core = evmCore({ pv: cost.pv, ev: cost.ev, ac: cost.ac, bac: cost.bac });
  return html(h(PerformanceTab, { cost, core, offer: cost.offer, profileText: 'P', setupHref: '/b', th, lang: 'en', t }), 'en');
}
/** Colour of each tile, by label. */
const tiles = (m: string) =>
  Object.fromEntries([...m.matchAll(/--kpi-color:([^"]+)"><div class="[^"]*">([^<]+)</g)].map((x) => [x[2], x[1]]));
const variance = (m: string) => [...m.matchAll(/class="[^"]*varValue[^"]*" style="color:([^"]+)"/g)].map((x) => x[1]);

let hlt: BudgetData;
let ndc: BudgetData;
beforeAll(async () => {
  setDb(await openDatabase());
  hlt = (await getBudgetData('HLT-026'))!;
  ndc = (await getBudgetData('NDC-031'))!;
}, 60_000);

describe('R-080 — Performance tiles and Variance card follow the Settings thresholds (C-1)', () => {
  it('HLT-026 (CPI 0.89, SPI 0.82, TCPI 1.25, VAC < 0): EAC, VAC, CPI, TCPI, CV and SV in the attention colour', () => {
    const m = perf(hlt);
    expect(tiles(m)).toMatchObject({ 'Budget (BAC)': OK, 'Forecast (EAC)': LO, 'Variance (VAC)': LO, CPI: LO, TCPI: LO });
    expect(variance(m)).toEqual([LO, LO]);
    // Signed bars on the computed EV / AC (R-073): small savings Jan–May (up, 4 % stubs), June even (flat), overruns Jul–Sep (down),
    // September's −€354k the largest at 90 % of half the plot (the prototype drew every bar downwards, 3 %–80 %).
    expect([m.match(/_barUp_/g)?.length, m.match(/_barFlat_/g)?.length, m.match(/_barDown_/g)?.length]).toEqual([5, 1, 3]);
    expect(m).toMatch(/_barDown_\w+" style="--bar-h:90%" title="−€354k"/);
  });

  it('NDC-031 (CPI ≈ 1.10, VAC > 0): neutral tiles (were always in the attention colour)', () => {
    const m = perf(ndc);
    expect(tiles(m)).toMatchObject({ 'Forecast (EAC)': OK, 'Variance (VAC)': OK, CPI: OK, TCPI: OK });
    expect(variance(m)[0]).toBe(OK);
  });

  it('a custom "At risk below" moves the colours (0.85: HLT-026 CPI 0.89 no longer in alert, SPI 0.82 still)', () => {
    const m = perf(hlt, { risk: 0.85, off: 0.8 });
    expect(tiles(m)).toMatchObject({ CPI: OK, 'Forecast (EAC)': OK, 'Variance (VAC)': OK, TCPI: LO });
    expect(variance(m)).toEqual([OK, LO]);
  });
});

describe('R-081 — Structure & changes after BL1 (C-3a)', () => {
  it('the frozen hint links to a new change request (EN / FR); none before BL1 or for read-only viewers', () => {
    const setup = (lang: Lang, amountsFrozen: boolean, canEdit = true) =>
      html(h(SetupTab, { cost: hlt.cost, offer: hlt.cost.offer, rex: hlt.rex, profileText: 'P', planHref: '/p', canEdit, code: 'HLT-026', amountsFrozen, lang, t: budgetT(makeT(lang), lang) }), lang);
    const en = setup('en', true);
    expect(en).toContain('After BL1 the amount changes only through an approved change request');
    expect(en).toContain('href="/projects/HLT-026/changes?new=1"');
    expect(setup('fr', true)).toContain('Après BL1, le montant ne change que par une demande de modification approuvée');
    expect(setup('en', false)).not.toContain('After BL1 the amount');
    expect(setup('en', true, false)).not.toContain('After BL1 the amount');
  });
});
