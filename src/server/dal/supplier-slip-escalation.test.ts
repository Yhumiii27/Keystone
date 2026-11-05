// S-34 — a supplier slip that lasts and pushes the project's finish is told to the portfolio directors, once per slip episode, on
// the demo database (HLT-026, PO-1078 tied to A1430): the two Settings thresholds (director only, whole days in range, audit
// with before / after and activity, "Reset to defaults" back to 10 and 5), the finish impact of the slip, the notice (EN / FR
// title, opens the order), no second notice in the same episode, a new one after the schedule came back under the threshold.
// S-33: the portfolio alert line of a slip pushing the finish ranks with the end-date alerts.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/domain/portfolio-alerts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/domain/portfolio-alerts')>();
  return { ...orig, portfolioAlertRules: vi.fn(orig.portfolioAlertRules) };
});

import { eq } from 'drizzle-orm';
import { PERSONAS } from '@/config/personas';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { portfolioAlertRules } from '@/domain/portfolio-alerts';
import { SUPPLIER_SLIP_ESCALATION_RANGE } from '@/domain/supplier-slip-alerts';
import { setSupplierSlipEscalationAction } from '@/features/admin/actions';
import { settingsView } from '@/features/admin/model';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { addCalendarDays } from '@/domain/calendar';
import { APP_SETTING_SUPPLIER_SLIP_ESCALATION } from '@/server/db/codes';
import { openDatabase } from '@/server/db/open';
import { appSettings } from '@/server/db/schema';
import { COOKIE } from '@/server/session';
import { listActivity, listAudit, listNotifications } from './notifications';
import { getPortfolioAlerts } from './portfolio-alerts';
import { getSettings, resetSettings, setSupplierSlipEscalation } from './settings';
import { addSupplierTie, createSupplierSchedule, saveSupplierActivity } from './supplier-schedules';
import { runSupplierSlipAlerts, supplierSlipsOf } from './supplier-slip-notices';
import { readSupplierSlipEscalation } from './supplier-slip-threshold';

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
const slipOf = async () => (await supplierSlipsOf(['HLT-026'], DEMO_TODAY_ISO, { impactFrom: 1 })).get('HLT-026')!.find((x) => x.poNumber === 'PO-1078')!;
const escalations = async (role: 'director' | 'pm') => (await listNotifications(role)).filter((n) => n.title.startsWith('Supplier slip escalated'));
/** Calendar days later (the runs' business date). */
const later = (days: number) => addCalendarDays(DEMO_TODAY_ISO, days);

beforeAll(async () => {
  setDb(await openDatabase());
  await createSupplierSchedule('HLT-026', 'PO-1078', { template: false }, BUYER);
  await saveSupplierActivity('HLT-026', 'PO-1078', null, { code: 'F10', name: 'Manufacturing', duration: '20', committedStart: '2026-09-28', committedFinish: '2026-10-23' }, { chain: true }, BUYER);
  await saveSupplierActivity('HLT-026', 'PO-1078', null, { code: 'F20', name: 'Delivery', duration: '0', committedStart: '2026-10-26', committedFinish: '2026-10-26' }, { chain: true }, BUYER);
  await addSupplierTie('HLT-026', 'PO-1078', { supplier: 'F20', activity: 'A1430', direction: 'to_project', lag: '0' }, PM);
}, 120_000);

describe('Settings › supplier slip escalation (S-34)', () => {
  it('10 and 5 working days by default, in the Settings data and card', async () => {
    expect(await readSupplierSlipEscalation()).toEqual({ days: 10, impactDays: 5 });
    const data = await getSettings();
    expect(data.supplierSlipEscalation).toEqual({ days: 10, impactDays: 5 });
    const view = settingsView(data, makeT('fr'), 'fr').supplierSlipEscalation;
    expect(view.fields).toEqual([
      { key: 'days', label: 'Directeurs prévenus après (jours ouvrés de glissement)', value: '10', standard: '10', min: 1, max: 120, step: '1' },
      { key: 'impactDays', label: 'Si la fin du projet recule d’au moins (jours ouvrés)', value: '5', standard: '5', min: 1, max: 60, step: '1' },
    ]);
    expect(view.text).toMatch(/^Les directeurs de portefeuille sont prévenus une fois par glissement/);
  });

  it('the director only; whole days in range; audit with before / after and activity', async () => {
    for (const p of PERSONAS) {
      as(p.role);
      if (p.role === 'client') {
        await expect(setSupplierSlipEscalationAction('days', '15')).rejects.toThrow('REDIRECT /');
        continue;
      }
      const r = await setSupplierSlipEscalationAction('days', '15');
      if (p.role === 'director') expect(r).toEqual({ ok: true });
      else expect([p.role, 'error' in r]).toEqual([p.role, true]);
    }
    expect(await readSupplierSlipEscalation()).toEqual({ days: 15, impactDays: 5 });
    const audit = (await listAudit({ limit: 5 })).find((a) => a.object === 'Supplier slip escalation thresholds');
    expect(audit).toMatchObject({ change: 'Directors told after (working days of slip): 10 → 15', before: { days: 10 }, after: { days: 15 } });
    expect((await listActivity()).some((a) => a.what === 'Supplier slip escalation · Directors told after (working days of slip): 10 → 15')).toBe(true);
    as('director');
    for (const bad of ['0', '121', '2.5', 'ten', '', null]) expect(await setSupplierSlipEscalationAction('days', bad)).toEqual({ error: SUPPLIER_SLIP_ESCALATION_RANGE });
    expect(await setSupplierSlipEscalationAction('impactDays', '61')).toEqual({ error: SUPPLIER_SLIP_ESCALATION_RANGE });
    expect(await setSupplierSlipEscalationAction('other', '5')).toEqual({ error: 'Invalid request' });
    jar.set(COOKIE.lang, 'fr');
    expect(await setSupplierSlipEscalationAction('days', '0')).toEqual({ error: 'Saisissez un nombre entier de jours ouvrés dans les bornes de ce seuil' });
    const n = (await listAudit()).length;
    expect(await setSupplierSlipEscalationAction('days', 15)).toEqual({ ok: true });
    expect((await listAudit()).length).toBe(n);
    await expect(setSupplierSlipEscalation('days', 12, PM)).rejects.toThrow('Settings are edited by the portfolio director');
  });

  it('"Reset to defaults" restores 10 and 5 (audited); no row reads the defaults', async () => {
    await resetSettings(DIRECTOR);
    expect(await readSupplierSlipEscalation()).toEqual({ days: 10, impactDays: 5 });
    const reset = (await listAudit({ limit: 5 })).find((a) => a.change === 'reset to defaults');
    expect(reset?.before).toMatchObject({ [APP_SETTING_SUPPLIER_SLIP_ESCALATION]: { days: 15, impactDays: 5 } });
    expect(reset?.after).toMatchObject({ [APP_SETTING_SUPPLIER_SLIP_ESCALATION]: { days: 10, impactDays: 5 } });
    await (await getDb()).delete(appSettings).where(eq(appSettings.key, APP_SETTING_SUPPLIER_SLIP_ESCALATION));
    expect(await readSupplierSlipEscalation()).toEqual({ days: 10, impactDays: 5 });
  });
});

describe('director notice of a supplier slip (S-34)', () => {
  it('on time: no impact, nothing told', async () => {
    expect(await slipOf()).toMatchObject({ slipDays: 0 });
    expect(await runSupplierSlipAlerts(DEMO_TODAY_ISO)).toMatchObject({ slipping: 0, escalated: 0 });
  });

  it('a slip pushing the finish, not lasted yet: the buyer and the PM only', async () => {
    await manufacturing(45);
    const s = await slipOf();
    expect(s.slipDays).toBeGreaterThanOrEqual(5);
    expect(s.finishImpactDays).toBeGreaterThanOrEqual(5);
    expect(await runSupplierSlipAlerts(DEMO_TODAY_ISO)).toMatchObject({ slipping: 1, raised: 1, escalated: 0 });
    // 7 calendar days later: 5 working days, under the 10 of Settings.
    expect(await runSupplierSlipAlerts(later(7))).toMatchObject({ slipping: 1, escalated: 0 });
    expect(await escalations('director')).toEqual([]);
  }, 120_000);

  it('lasted 10 working days and pushing the finish: the directors are told once, the notice opens the order', async () => {
    const s = await slipOf();
    const r = await runSupplierSlipAlerts(later(14));
    expect(r).toMatchObject({ slipping: 1, escalated: 1 });
    expect(r.directorsNotified).toBeGreaterThanOrEqual(1);
    const [n, ...more] = await escalations('director');
    expect(more).toEqual([]);
    expect(n.title).toBe(`Supplier slip escalated to the directors · PO-1078 · +${s.slipDays} working days · project finish +${s.finishImpactDays} working days`);
    expect(makeT('fr')(n.title)).toBe(`Glissement fournisseur remonté à la direction · PO-1078 · +${s.slipDays} jours ouvrés · fin du projet +${s.finishImpactDays} jours ouvrés`);
    expect(n).toMatchObject({ screen: 'orders', params: { po: 'PO-1078' } });
    // Not to the PM (no director role): the S-27 notices only.
    expect(await escalations('pm')).toEqual([]);
    // Same episode, later and worse: no second notice.
    await manufacturing(50);
    expect(await runSupplierSlipAlerts(later(21))).toMatchObject({ escalated: 0 });
    expect(await escalations('director')).toHaveLength(1);
  }, 120_000);

  it('an impact under the Settings threshold is not told; back under the alert threshold, a new episode is told again', async () => {
    await setSupplierSlipEscalation('impactDays', 60, DIRECTOR);
    await manufacturing(20); // back on time: the episode ends
    expect(await runSupplierSlipAlerts(later(22))).toMatchObject({ slipping: 0, cleared: 1 });
    await manufacturing(45);
    await runSupplierSlipAlerts(later(22)); // new episode starts
    expect(await runSupplierSlipAlerts(later(40))).toMatchObject({ slipping: 1, escalated: 0 });
    await setSupplierSlipEscalation('impactDays', 5, DIRECTOR);
    expect(await runSupplierSlipAlerts(later(41))).toMatchObject({ escalated: 1 });
    expect(await escalations('director')).toHaveLength(2);
  }, 120_000);

  it('S-33: the portfolio alert line names the push on the finish and ranks with the end-date alerts', async () => {
    const spy = vi.mocked(portfolioAlertRules);
    spy.mockClear();
    await getPortfolioAlerts('en', DEMO_TODAY_ISO);
    const [input, , , th] = spy.mock.calls.at(-1)!;
    expect(th!.supplierImpactDays).toBe(5);
    const s = await slipOf();
    const all = portfolioAlertRules(input, 'en', makeT('en'), { ...th!, maxAlerts: 99 });
    const i = all.findIndex((a) => a.kind === 'supplier_slip');
    expect(all[i].detail).toContain(`· project finish +${s.finishImpactDays} working days`);
    // Class 1: before every cost, billing, milestone, Monte-Carlo, pool and approval alert.
    expect(all.slice(0, i).every((a) => a.kind === 'off_track' || a.kind === 'critical_slip')).toBe(true);
  }, 120_000);
});
