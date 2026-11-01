// R-206 (K-206b) — Settings › Schedule quality thresholds, against the seeded in-memory database with the real session: the
// director only (every persona tried), range checked, audit (before / after) and activity, the Schedule quality follows the new
// value at once, "Reset to defaults" restores the DCMA standard, a database without the row reads the standard.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { eq } from 'drizzle-orm';
import { PERSONAS } from '@/config/personas';
import { DCMA_STANDARD, DCMA_THRESHOLD_RANGE } from '@/domain/schedule-quality';
import { setDcmaThresholdAction } from '@/features/admin/actions';
import { getDb, setDb } from '@/server/db/client';
import { APP_SETTING_DCMA } from '@/server/db/codes';
import { openDatabase } from '@/server/db/open';
import { appSettings } from '@/server/db/schema';
import { COOKIE } from '@/server/session';
import { readDcmaThresholds } from './dcma-thresholds';
import { listActivity, listAudit } from './notifications';
import { getScheduleQuality } from './schedule-quality';
import { getSettings, resetSettings, setDcmaThreshold } from './settings';

const DIRECTOR = { name: 'Claire Moreau', role: 'director' };
const as = (role: string) => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, 'en');
};

describe('Settings › schedule quality thresholds (R-206, K-206b)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('the standard by default, also in the Settings data', async () => {
    expect(await readDcmaThresholds()).toEqual(DCMA_STANDARD);
    expect((await getSettings()).dcma).toEqual(DCMA_STANDARD);
  });

  it('the director only; audit with before / after and activity; the checks follow', async () => {
    for (const p of PERSONAS) {
      as(p.role);
      if (p.role === 'client') {
        await expect(setDcmaThresholdAction('lagsPct', '40')).rejects.toThrow('REDIRECT /');
        continue;
      }
      const r = await setDcmaThresholdAction('lagsPct', '40');
      if (p.role === 'director') expect(r).toEqual({ ok: true });
      else expect([p.role, 'error' in r]).toEqual([p.role, true]);
    }
    expect((await readDcmaThresholds()).lagsPct).toBe(40);
    const audit = (await listAudit({ limit: 5 })).find((a) => a.object === 'Schedule quality thresholds');
    expect(audit).toMatchObject({ change: 'Lags (max %): 5 → 40', before: { lagsPct: 5 }, after: { lagsPct: 40 } });
    expect((await listActivity()).some((a) => a.what === 'Schedule quality · Lags (max %): 5 → 40')).toBe(true);
    // HLT-026 has 6 lags on 19 relationships (31.6 %): it passes with 40 %.
    const q = (await getScheduleQuality('HLT-026'))!;
    expect(q.report.checks.find((c) => c.id === 'lags')).toMatchObject({ status: 'pass', limit: 40 });
  });

  it('input checked by the action and the DAL', async () => {
    as('director');
    for (const bad of ['101', '-1', 'ten', '', null]) expect(await setDcmaThresholdAction('lagsPct', bad)).toEqual({ error: DCMA_THRESHOLD_RANGE });
    expect(await setDcmaThresholdAction('highFloatDays', '30.5')).toEqual({ error: DCMA_THRESHOLD_RANGE });
    expect(await setDcmaThresholdAction('nope', '3')).toEqual({ error: 'Invalid request' });
    // Same value: nothing written.
    const n = (await listAudit()).length;
    expect(await setDcmaThresholdAction('lagsPct', 40)).toEqual({ ok: true });
    expect((await listAudit()).length).toBe(n);
    await expect(setDcmaThreshold('cpliMin', '0.9', { name: 'Romain Aubert', role: 'pm' })).rejects.toThrow('Settings are edited by the portfolio director');
    await expect(setDcmaThreshold('cpliMin', '3', DIRECTOR)).rejects.toThrow(DCMA_THRESHOLD_RANGE);
  });

  it('"Reset to defaults" restores the standard; no row reads the standard', async () => {
    await setDcmaThreshold('cpliMin', '0,9', DIRECTOR);
    expect((await readDcmaThresholds()).cpliMin).toBe(0.9);
    await resetSettings(DIRECTOR);
    expect(await readDcmaThresholds()).toEqual(DCMA_STANDARD);
    await (await getDb()).delete(appSettings).where(eq(appSettings.key, APP_SETTING_DCMA));
    expect(await readDcmaThresholds()).toEqual(DCMA_STANDARD);
  });
});
