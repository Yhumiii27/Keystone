// R-205 / R-208: the risk analysis Server Functions (rights, validation, writes with audit and activity, stored run, stale run),
// the drift forecast read from the demo data, and the rendering of the Risk register's section and of the Trends card.
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Romain Aubert', role: 'pm', lead: true, edit: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/risks', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
const lang = { current: 'en' as 'en' | 'fr' };
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: lang.current, t: makeT(lang.current) }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name, role: viewer.role }, isLead: viewer.lead, access: { lead: viewer.lead }, canEdit: () => viewer.edit }),
}));

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { frExact, makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getDriftForecast } from '@/server/dal/drift-forecast';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { getRiskAnalysis } from '@/server/dal/risk-analysis';
import { runRiskAnalysisAction, saveActivityRangeAction, saveRiskDelayAction } from './actions';
import { DRIFT_LABELS, DriftForecastCard } from './drift-card';
import { RiskAnalysisSection } from './risk-analysis-section';

const REFUSED = { error: 'Only the project’s leads and the director run the risk analysis and enter its ranges' };
const activity = async (code: string) => (await getRiskAnalysis('HLT-026'))!.activities.find((a) => a.code === code)!;

beforeAll(async () => setDb(await openDatabase()), 60_000);

describe('rights and validation', () => {
  it('refuses a team member who is not a lead and a read-only project', async () => {
    const a = await activity('A1250');
    Object.assign(viewer, { name: 'Claire Dumas', role: 'finance', lead: false, edit: true });
    expect(await runRiskAnalysisAction('HLT-026', { iterations: '500' })).toEqual(REFUSED);
    expect(await saveActivityRangeAction('HLT-026', a.id, { dMin: '1', dLikely: '2', dMax: '3' })).toEqual(REFUSED);
    Object.assign(viewer, { name: 'Romain Aubert', role: 'pm', lead: true, edit: false });
    expect(await saveRiskDelayAction('HLT-026', a.id, { delay: '3' })).toEqual(REFUSED);
    Object.assign(viewer, { edit: true });
    expect(await getRiskAnalysis('HLT-026')).toMatchObject({ latest: null });
  });

  it('validates the input', async () => {
    const a = await activity('A1250');
    expect(await runRiskAnalysisAction('HLT-026', { iterations: '50' })).toEqual({ error: 'Choose between 200 and 5,000 iterations' });
    expect(await runRiskAnalysisAction('NOPE-000', {})).toEqual({ error: 'Unknown project' });
    expect(await saveActivityRangeAction('HLT-026', 'x', {})).toEqual({ error: 'Invalid request' });
    expect(await saveActivityRangeAction('HLT-026', a.id, { dMin: '5', dLikely: '3', dMax: '9' })).toEqual({ error: 'Minimum ≤ most likely ≤ maximum' });
    const [other] = (await (await getDb()).execute(sql`select a.id from activities a join projects p on p.id = a.project_id where p.code = 'NDC-031' limit 1`)).rows as { id: string }[];
    expect(await saveActivityRangeAction('HLT-026', other.id, { dMin: '1', dLikely: '2', dMax: '3' })).toEqual({ error: 'Unknown activity' });
    expect(await saveRiskDelayAction('HLT-026', a.id, { delay: '2.5' })).toEqual({ error: 'Enter a whole number of working days between 0 and 250' });
    expect(await saveRiskDelayAction('HLT-026', a.id, { delay: '4' })).toEqual({ error: 'Unknown risk' });
  });
});

describe('writes, run, stale run (R-205)', () => {
  it('a lead enters a range and a delay: stored, audited, in the activity feed', async () => {
    const a = await activity('A1320');
    expect(await saveActivityRangeAction('HLT-026', a.id, { dMin: '10', dLikely: '12', dMax: '20', cMin: '', cLikely: '', cMax: '' })).toEqual({ toast: 'Three-point estimate saved' });
    expect((await activity('A1320')).durationRange).toEqual({ min: 10, likely: 12, max: 20 });
    expect((await activity('A1320')).costRange).toBeNull();
    const audit = (await listAudit({ projectCode: 'HLT-026', limit: 1 }))[0];
    expect(audit).toMatchObject({ change: 'Risk analysis: three-point estimate of A1320 set' });
    expect((await listActivity()).some((e) => e.what === 'Risk analysis: three-point estimate of A1320 set')).toBe(true);

    const risk = (await getRiskAnalysis('HLT-026'))!.risks.find((r) => r.number === 'R-03')!;
    expect(risk).toMatchObject({ activityCode: 'A1250', delayDays: 20, delayEntered: false });
    expect(await saveRiskDelayAction('HLT-026', risk.id, { delay: '8' })).toEqual({ toast: 'Delay saved' });
    expect((await getRiskAnalysis('HLT-026'))!.risks.find((r) => r.number === 'R-03')).toMatchObject({ delayDays: 8, delayEntered: true });
    expect((await listAudit({ projectCode: 'HLT-026', limit: 1 }))[0]).toMatchObject({ change: 'Risk analysis: delay of R-03 if it occurs · 8 working days' });
    expect(await saveRiskDelayAction('HLT-026', risk.id, { delay: '' })).toEqual({ toast: 'Back to the default delay' });
    expect((await getRiskAnalysis('HLT-026'))!.risks.find((r) => r.number === 'R-03')).toMatchObject({ delayDays: 20, delayEntered: false });
  });

  it('runs the analysis, stores it (date, inputs, result) and audits it; a later change makes it stale', async () => {
    const res = await runRiskAnalysisAction('HLT-026', { iterations: '500' });
    expect(res).toEqual({ toast: 'Risk analysis complete · 500 iterations' });
    const data = (await getRiskAnalysis('HLT-026'))!;
    expect(data.stale).toBe(false);
    expect(data.latest).toMatchObject({ iterations: 500, ranByName: 'Romain Aubert', targetFinishSource: 'baseline', targetFinish: '2026-12-18', targetCostKeur: 4800 });
    const r = data.latest!.result;
    expect(r.iterations).toBe(500);
    expect(r.finish.dates.p80 >= r.finish.dates.p50).toBe(true);
    expect(r.inputs).toMatchObject({ activities: expect.any(Number), entered: 1, risks: 7 });
    const audit = (await listAudit({ projectCode: 'HLT-026', limit: 1 }))[0];
    expect(audit.change).toMatch(/^Monte-Carlo risk analysis run · 500 iterations · P80 finish \d{4}-\d{2}-\d{2} · P80 cost \d+ k€$/);
    // Same inputs → same result (seeded by project, data date and iterations).
    await runRiskAnalysisAction('HLT-026', { iterations: '500' });
    expect((await getRiskAnalysis('HLT-026'))!.latest!.result).toEqual(r);
    // A range cleared afterwards: the run is stale.
    const a = await activity('A1320');
    expect(await saveActivityRangeAction('HLT-026', a.id, {})).toEqual({ toast: 'Back to the default range' });
    expect((await getRiskAnalysis('HLT-026'))!.stale).toBe(true);
  });
});

describe('drift forecast (R-208) and rendering', () => {
  it('HLT-026: SPI and CPI under the thresholds → slip, overrun and named suggestions', async () => {
    const d = (await getDriftForecast('HLT-026'))!;
    expect(d.forecast.finish.slipDays).toBeGreaterThan(0);
    expect(d.forecast.cost.overrunKeur).toBeGreaterThan(0);
    const rules = d.forecast.suggestions.map((s) => s.rule);
    expect(rules).toEqual(expect.arrayContaining(['spi_critical', 'cpi_review', 'mc_rerun']));
    expect(d.forecast.suggestions.find((s) => s.rule === 'spi_critical')!.targets.length).toBeGreaterThan(0);
    expect(await getDriftForecast('NOPE-000')).toBeNull();
  });

  it('renders the section (lead and reader) and the card, in English and French', async () => {
    const data = (await getRiskAnalysis('HLT-026'))!;
    const props = { code: 'HLT-026', context: 'HLT-026', data, showRanges: true, rangesHref: '/r?analysis=ranges', summaryHref: '/r', lang: 'en' as 'en' | 'fr', t: makeT('en') };
    const lead = renderToStaticMarkup(h(RiskAnalysisSection, { ...props, canEdit: true }));
    expect(lead).toContain('Risk analysis (Monte-Carlo)');
    expect(lead).toMatch(/Run again|Relancer/);
    expect(lead).toContain('P80 finish');
    expect(lead).toContain('A1320');
    const reader = renderToStaticMarkup(h(RiskAnalysisSection, { ...props, canEdit: false }));
    expect(reader).not.toMatch(/Run again|Relancer/);
    expect(reader).not.toContain('>Edit<');
    const fr = renderToStaticMarkup(h(RiskAnalysisSection, { ...props, canEdit: true, lang: 'fr', t: makeT('fr') }));
    expect(fr).toContain('Analyse de risques (Monte-Carlo)');
    expect(fr).toContain('Probabilité de tenir la date de fin');
    const drift = (await getDriftForecast('HLT-026'))!;
    const card = renderToStaticMarkup(h(DriftForecastCard, { drift, t: makeT('fr'), lang: 'fr' }));
    expect(card).toContain('Dérive prévue');
    expect(card).toContain('Réordonnancer les travaux');
  });

  it('every label of the drift card has its French', () => {
    expect(DRIFT_LABELS.filter((l) => !frExact(l))).toEqual([]);
  });
});
