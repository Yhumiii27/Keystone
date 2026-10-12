// Delivery 8, lot cost-change — R-069 (P-6c): the "Change control board" threshold of Settings. The Server Function for the
// 8 personas (the client is sent home, the member reads Settings, the other workspace roles are refused, the portfolio
// director edits), malformed input, the audit row in the viewer's name, the view model and "Reset to defaults" (50 k€).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const viewer = { role: 'director' as RoleKey, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }),
    getViewer: async () => PERSONA_BY_ROLE[viewer.role],
    getLastProject: async () => 'HLT-026',
  };
});

import { revalidatePath } from 'next/cache';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { readCcbThreshold } from '@/server/dal/change-settings';
import { listAudit } from '@/server/dal/notifications';
import { getSettings } from '@/server/dal/settings';
import { resetSettingsAction, setCcbThresholdAction } from './actions';
import { settingsView } from './model';

const ROLES: RoleKey[] = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];

beforeAll(async () => setDb(await openDatabase()), 60_000);
beforeEach(() => {
  viewer.role = 'director';
  viewer.lang = 'en';
  vi.mocked(revalidatePath).mockClear();
});

describe('R-069 — Settings › Change control board threshold', () => {
  for (const role of ROLES)
    it(role, async () => {
      viewer.role = role;
      if (role === 'client') {
        await expect(setCcbThresholdAction('80')).rejects.toThrow('NEXT_REDIRECT');
      } else if (role === 'member') {
        expect(await setCcbThresholdAction('80')).toEqual({ error: 'Settings are read-only for you' });
      } else if (role !== 'director') {
        expect(await setCcbThresholdAction('80')).toEqual({ error: 'Settings are edited by the portfolio director' });
      } else {
        expect(await setCcbThresholdAction('80')).toEqual({ ok: true });
        expect(await readCcbThreshold()).toBe(80);
        expect((await listAudit({ limit: 1 }))[0]).toMatchObject({ who: 'Marie Lefebvre', object: 'Change control board', change: 'threshold 50 → 80 k€', area: 'Settings' });
        expect(revalidatePath).toHaveBeenCalled();
        return;
      }
      expect(await readCcbThreshold()).toBe(80); // the director's value (first persona) is kept
      expect(revalidatePath).not.toHaveBeenCalled();
    });

  it('malformed input is refused (EN / FR); decimals and 0 are accepted; unchanged writes no audit line', async () => {
    for (const bad of ['', 'abc', '-1', '1000001', null, undefined, {}, [], Number.NaN, Number.POSITIVE_INFINITY])
      expect(await setCcbThresholdAction(bad)).toEqual({ error: 'Enter a threshold in k€ (0 or more)' });
    viewer.lang = 'fr';
    expect(await setCcbThresholdAction('-5')).toEqual({ error: 'Saisissez un seuil en k€ (0 ou plus)' });
    viewer.lang = 'en';
    expect(await setCcbThresholdAction('12,5')).toEqual({ ok: true });
    expect(await readCcbThreshold()).toBe(12.5);
    expect(await setCcbThresholdAction(0)).toEqual({ ok: true });
    expect(await readCcbThreshold()).toBe(0);
    const n = (await listAudit({ limit: 50 })).filter((a) => a.object === 'Change control board').length;
    expect(await setCcbThresholdAction('0')).toEqual({ ok: true });
    expect((await listAudit({ limit: 50 })).filter((a) => a.object === 'Change control board').length).toBe(n);
  });

  it('the Settings card value, then "Reset to defaults" restores 50 k€', async () => {
    expect(await setCcbThresholdAction('120')).toEqual({ ok: true });
    const settings = await getSettings();
    expect(settings.ccbThresholdKeur).toBe(120);
    expect(settingsView(settings, makeT('en'), 'en').ccb.text).toBe('120');
    expect(settingsView(settings, makeT('fr'), 'fr').ccb.text).toBe('120');
    expect(await resetSettingsAction()).toEqual({ ok: true, toast: 'Settings reset to defaults' });
    expect(await readCcbThreshold()).toBe(50);
  });
});
