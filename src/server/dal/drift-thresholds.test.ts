// S-25 — Settings › Forecast drift thresholds, against the seeded in-memory database with the real session: the director only
// (every persona tried), range and pair order checked, audit (before / after) and activity, the drift forecast and the
// portfolio's Monte-Carlo alert follow at once, "Reset to defaults" restores R-208's values, no row reads the defaults.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// The portfolio rules are spied on to read the threshold the DAL hands them (the list itself is capped at 8 alerts, worst first).
vi.mock('@/domain/portfolio-alerts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/domain/portfolio-alerts')>();
  return { ...orig, portfolioAlertRules: vi.fn(orig.portfolioAlertRules) };
});

import { eq } from 'drizzle-orm';
import { PERSONAS } from '@/config/personas';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { DRIFT_STANDARD, DRIFT_THRESHOLD_ORDER_ERROR, DRIFT_THRESHOLD_RANGE } from '@/domain/drift-forecast';
import { DEFAULT_ALERT_THRESHOLDS, portfolioAlertRules } from '@/domain/portfolio-alerts';
import { setDriftThresholdAction } from '@/features/admin/actions';
import { settingsView } from '@/features/admin/model';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { APP_SETTING_DRIFT } from '@/server/db/codes';
import { openDatabase } from '@/server/db/open';
import { appSettings } from '@/server/db/schema';
import { COOKIE } from '@/server/session';
import { getDriftForecast } from './drift-forecast';
import { readDriftThresholds } from './drift-thresholds';
import { listActivity, listAudit } from './notifications';
import { getPortfolioAlerts } from './portfolio-alerts';
import { runRiskAnalysis } from './risk-analysis';
import { getSettings, resetSettings, setDriftThreshold } from './settings';

const DIRECTOR = { name: 'Claire Moreau', role: 'director' };
const PM = { name: 'Romain Aubert', role: 'pm' };
const as = (role: string) => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, 'en');
};

describe('Settings › forecast drift thresholds (S-25)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('the R-208 defaults, also in the Settings data and card', async () => {
    expect(DRIFT_STANDARD).toMatchObject({ spiCritical: 0.9, cpiReview: 0.95, cpiHigh: 0.9, tcpiHigh: 1.1, floatErosionDays: 5, probabilityLowPct: 50, probabilityVeryLowPct: 20, portfolioOnTimePct: 20 });
    expect(await readDriftThresholds()).toEqual(DRIFT_STANDARD);
    const data = await getSettings();
    expect(data.drift).toEqual(DRIFT_STANDARD);
    const view = settingsView(data, makeT('fr'), 'fr');
    expect(view.drift.find((f) => f.key === 'portfolioOnTimePct')).toMatchObject({ value: '20', standard: '20', label: 'Alerte du portefeuille : probabilité de tenir la date de fin sous (%)' });
  });

  it('the director only; audit with before / after and activity; the drift forecast follows', async () => {
    expect((await getDriftForecast('HLT-026'))!.forecast.suggestions.map((s) => s.rule)).toContain('spi_critical');
    for (const p of PERSONAS) {
      as(p.role);
      if (p.role === 'client') {
        await expect(setDriftThresholdAction('spiCritical', '0,5')).rejects.toThrow('REDIRECT /');
        continue;
      }
      const r = await setDriftThresholdAction('spiCritical', '0,5');
      if (p.role === 'director') expect(r).toEqual({ ok: true });
      else expect([p.role, 'error' in r]).toEqual([p.role, true]);
    }
    expect((await readDriftThresholds()).spiCritical).toBe(0.5);
    const audit = (await listAudit({ limit: 5 })).find((a) => a.object === 'Drift forecast thresholds');
    expect(audit).toMatchObject({ change: 'SPI under which the critical path is resequenced: 0.9 → 0.5', before: { spiCritical: 0.9 }, after: { spiCritical: 0.5 } });
    expect((await listActivity()).some((a) => a.what === 'Drift forecast · SPI under which the critical path is resequenced: 0.9 → 0.5')).toBe(true);
    // HLT-026's SPI (0.82) is no longer under the threshold.
    expect((await getDriftForecast('HLT-026'))!.forecast.suggestions.map((s) => s.rule)).not.toContain('spi_critical');
  });

  it('input checked by the action and the DAL (range, whole days, pair order)', async () => {
    as('director');
    for (const bad of ['101', '-1', 'ten', '', null]) expect(await setDriftThresholdAction('probabilityLowPct', bad)).toEqual({ error: DRIFT_THRESHOLD_RANGE });
    expect(await setDriftThresholdAction('floatErosionDays', '2.5')).toEqual({ error: DRIFT_THRESHOLD_RANGE });
    expect(await setDriftThresholdAction('nope', '3')).toEqual({ error: 'Invalid request' });
    // The urgent level stays beyond the first one.
    expect(await setDriftThresholdAction('probabilityVeryLowPct', '60')).toEqual({ error: DRIFT_THRESHOLD_ORDER_ERROR });
    expect(await setDriftThresholdAction('cpiReview', '0.85')).toEqual({ error: DRIFT_THRESHOLD_ORDER_ERROR });
    expect((await readDriftThresholds()).probabilityVeryLowPct).toBe(20);
    // Same value: nothing written.
    const n = (await listAudit()).length;
    expect(await setDriftThresholdAction('spiCritical', 0.5)).toEqual({ ok: true });
    expect((await listAudit()).length).toBe(n);
    await expect(setDriftThreshold('tcpiHigh', '1.2', PM)).rejects.toThrow('Settings are edited by the portfolio director');
  });

  it('the portfolio Monte-Carlo alert follows its Settings threshold', async () => {
    const run = await runRiskAnalysis('HLT-026', 500, PM);
    const chance = run.result.finish.probOnTarget!;
    expect(chance).toBeLessThan(1);
    const spy = vi.mocked(portfolioAlertRules);
    const thresholdUsed = async (on: string) => {
      spy.mockClear();
      await getPortfolioAlerts('en', on);
      return spy.mock.calls.at(-1)?.[3]?.onTimeChance;
    };
    expect(await thresholdUsed(DEMO_TODAY_ISO)).toBe(0.2);
    await setDriftThreshold('portfolioOnTimePct', '100', DIRECTOR);
    expect(await thresholdUsed(DEMO_TODAY_ISO)).toBe(1);
    // With every project's chance under 100 %, HLT-026 is listed by the rules (before the cap of the list).
    const input = spy.mock.calls.at(-1)![0];
    const all = portfolioAlertRules(input, 'en', makeT('en'), { ...DEFAULT_ALERT_THRESHOLDS, maxAlerts: 99, onTimeChance: 1 });
    expect(all.some((a) => a.kind === 'risk_forecast' && a.code === 'HLT-026')).toBe(true);
    await setDriftThreshold('portfolioOnTimePct', '0', DIRECTOR);
    expect(await thresholdUsed(DEMO_TODAY_ISO)).toBe(0);
  }, 120_000);

  it('"Reset to defaults" restores R-208’s values; no row reads the defaults', async () => {
    await setDriftThreshold('tcpiHigh', '1,3', DIRECTOR);
    expect((await readDriftThresholds()).tcpiHigh).toBe(1.3);
    await resetSettings(DIRECTOR);
    expect(await readDriftThresholds()).toEqual(DRIFT_STANDARD);
    await (await getDb()).delete(appSettings).where(eq(appSettings.key, APP_SETTING_DRIFT));
    expect(await readDriftThresholds()).toEqual(DRIFT_STANDARD);
  });
});
