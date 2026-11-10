// S-30 / S-31 — the supplier schedule slip threshold in Settings and the portfolio alert line, on the demo database (HLT-026,
// PO-1078) with the real session: the director only (every persona tried), whole days 1–60, audit (before / after) and activity,
// "Reset to defaults" back to 5; the daily supplier slip alerts (S-27) and the portfolio alerts (S-30) follow the threshold; the
// indicator alerts never tell a supplier slip again (S-27 tells it).
import { beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// The portfolio rules are spied on to read the input and thresholds the DAL hands them (the list is capped at 8 alerts, worst first,
// and the seeded portfolio already fills it with higher-ranked alerts).
vi.mock('@/domain/portfolio-alerts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/domain/portfolio-alerts')>();
  return { ...orig, portfolioAlertRules: vi.fn(orig.portfolioAlertRules) };
});

import { eq } from 'drizzle-orm';
import { PERSONAS } from '@/config/personas';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { alertTargetHref, portfolioAlertRules } from '@/domain/portfolio-alerts';
import { SUPPLIER_SLIP_DAYS_RANGE } from '@/domain/supplier-slip-alerts';
import { setSupplierSlipDaysAction } from '@/features/admin/actions';
import { settingsView } from '@/features/admin/model';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { APP_SETTING_SUPPLIER_SLIP } from '@/server/db/codes';
import { openDatabase } from '@/server/db/open';
import { appSettings } from '@/server/db/schema';
import { COOKIE } from '@/server/session';
import { runIndicatorAlerts } from './event-notices';
import { listActivity, listAudit, listNotifications } from './notifications';
import { getPortfolioAlerts } from './portfolio-alerts';
import { getSettings, resetSettings, setSupplierSlipDays } from './settings';
import { createSupplierSchedule, saveSupplierActivity } from './supplier-schedules';
import { runSupplierSlipAlerts, supplierSlipsOf } from './supplier-slip-notices';
import { readSupplierSlipDays } from './supplier-slip-threshold';

const DIRECTOR = { name: 'Claire Moreau', role: 'director' };
const PM = { name: 'Romain Aubert', role: 'pm' };
const BUYER = { name: 'Fabien Bertrand', role: 'procurement' };
const as = (role: string) => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, 'en');
};
const manufacturing = (duration: number) =>
  saveSupplierActivity('HLT-026', 'PO-1078', 'F10', { code: 'F10', name: 'Manufacturing', duration: String(duration), committedStart: '2026-09-28', committedFinish: '2026-10-23' }, { chain: false }, BUYER);
const slipOf = async () => (await supplierSlipsOf(['HLT-026'], DEMO_TODAY_ISO)).get('HLT-026')?.find((x) => x.poNumber === 'PO-1078')?.slipDays ?? 0;
/** The supplier slip alert the rules give with the DAL's input and thresholds, the list uncapped. */
const supplierAlert = async (lang: 'en' | 'fr' = 'en') => {
  const spy = vi.mocked(portfolioAlertRules);
  spy.mockClear();
  await getPortfolioAlerts(lang, DEMO_TODAY_ISO);
  const [input, , , th] = spy.mock.calls.at(-1)!;
  return portfolioAlertRules(input, lang, makeT(lang), { ...th!, maxAlerts: 99 }).find((a) => a.kind === 'supplier_slip');
};

beforeAll(async () => {
  setDb(await openDatabase());
  await createSupplierSchedule('HLT-026', 'PO-1078', { template: false }, BUYER);
  await saveSupplierActivity('HLT-026', 'PO-1078', null, { code: 'F10', name: 'Manufacturing', duration: '20', committedStart: '2026-09-28', committedFinish: '2026-10-23' }, { chain: true }, BUYER);
}, 120_000);

describe('Settings › supplier schedule slip threshold (S-31)', () => {
  it('5 working days by default, also in the Settings data and card', async () => {
    expect(await readSupplierSlipDays()).toBe(5);
    const data = await getSettings();
    expect(data.supplierSlipDays).toBe(5);
    expect(settingsView(data, makeT('fr'), 'fr').supplierSlip).toMatchObject({ value: '5', standard: '5', min: 1, max: 60 });
    expect(settingsView(data, makeT('fr'), 'fr').supplierSlip.text).toMatch(/^Un planning fournisseur dont la fin prévue glisse/);
  });

  it('the director only; whole days 1–60; audit with before / after and activity', async () => {
    for (const p of PERSONAS) {
      as(p.role);
      const r = await setSupplierSlipDaysAction('8');
      if (p.role === 'director') expect(r).toEqual({ ok: true });
      else expect([p.role, 'error' in r]).toEqual([p.role, true]);
    }
    expect(await readSupplierSlipDays()).toBe(8);
    const audit = (await listAudit({ limit: 5 })).find((a) => a.object === 'Supplier schedule slip threshold');
    expect(audit).toMatchObject({ change: '5 → 8 working days', before: { days: 5 }, after: { days: 8 } });
    expect((await listActivity()).some((a) => a.what === 'Supplier schedule slip threshold · 5 → 8 working days')).toBe(true);
    as('director');
    for (const bad of ['0', '61', '2.5', 'ten', '', null]) expect(await setSupplierSlipDaysAction(bad)).toEqual({ error: SUPPLIER_SLIP_DAYS_RANGE });
    jar.set(COOKIE.lang, 'fr');
    expect(await setSupplierSlipDaysAction('0')).toEqual({ error: 'Saisissez un nombre entier de jours ouvrés entre 1 et 60' });
    // Same value: nothing written.
    const n = (await listAudit()).length;
    expect(await setSupplierSlipDaysAction(8)).toEqual({ ok: true });
    expect((await listAudit()).length).toBe(n);
    await expect(setSupplierSlipDays(10, PM)).rejects.toThrow('Settings are edited by the portfolio director');
  });

  it('"Reset to defaults" restores 5 (audited); no row reads the default', async () => {
    await resetSettings(DIRECTOR);
    expect(await readSupplierSlipDays()).toBe(5);
    const reset = (await listAudit({ limit: 5 })).find((a) => a.change === 'reset to defaults');
    expect(reset?.before).toMatchObject({ [APP_SETTING_SUPPLIER_SLIP]: { days: 8 } });
    expect(reset?.after).toMatchObject({ [APP_SETTING_SUPPLIER_SLIP]: { days: 5 } });
    await (await getDb()).delete(appSettings).where(eq(appSettings.key, APP_SETTING_SUPPLIER_SLIP));
    expect(await readSupplierSlipDays()).toBe(5);
  });
});

describe('supplier slip in the portfolio alerts (S-30) and the daily alerts (S-27) follow the threshold', () => {
  it('on time: no line', async () => {
    expect(await slipOf()).toBe(0);
    expect(await supplierAlert()).toBeUndefined();
  });

  it('a slip at the threshold: one line naming the order, opening it; the indicator alerts do not tell it again', async () => {
    await manufacturing(30);
    const slip = await slipOf();
    expect(slip).toBeGreaterThanOrEqual(5);
    const a = (await supplierAlert())!;
    expect(a).toMatchObject({ key: 'supplier-HLT-026', code: 'HLT-026', icon: 'truck', action: 'Open the order', target: { screen: 'orders', code: 'HLT-026', params: { po: 'PO-1078' } } });
    expect(a.title).toMatch(/— supplier schedule slipping$/);
    expect(a.detail).toBe(`PO-1078 · ${a.detail.split(' · ')[1]} · +${slip} working days (threshold 5) · Manufacturing.`);
    expect(alertTargetHref(a.target)).toBe('/projects/HLT-026/orders?po=PO-1078');
    expect((await supplierAlert('fr'))!.detail).toContain(`+${slip} jours ouvrés (seuil 5)`);
    await runIndicatorAlerts(DEMO_TODAY_ISO);
    for (const role of ['pm', 'director'] as const)
      expect((await listNotifications(role)).some((n) => n.title.includes('Supplier schedule slipping') && n.title.startsWith('Indicator alert'))).toBe(false);
  }, 120_000);

  it('a higher threshold hides the line and the daily alert; back to it, both come back', async () => {
    const slip = await slipOf();
    await setSupplierSlipDays(slip + 1, DIRECTOR);
    expect(await supplierAlert()).toBeUndefined();
    expect(await runSupplierSlipAlerts(DEMO_TODAY_ISO)).toMatchObject({ watched: 1, slipping: 0, raised: 0 });
    await setSupplierSlipDays(slip, DIRECTOR);
    expect((await supplierAlert())!.detail).toContain(`(threshold ${slip})`);
    // One level at the threshold: told to the buyer and the PM.
    expect(await runSupplierSlipAlerts(DEMO_TODAY_ISO)).toMatchObject({ watched: 1, slipping: 1, raised: 1 });
    expect((await listNotifications('pm')).filter((n) => n.title.startsWith('Supplier schedule slipping'))).toHaveLength(1);
  }, 120_000);
});
