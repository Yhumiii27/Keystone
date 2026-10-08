// HR Server Functions against an in-memory database: permission gates (rates: director/pm; outside the workspace;
// project read-only on Hours), validation, writes through the DAL (audit actor = the viewer) and toasts.
// Session and access helpers are mocked; the gating rules use the real role matrix.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { role: 'director' as string, name: 'Marie Lefebvre', projectEditable: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', async () => {
  const { canSee } = await import('@/config/screens');
  return {
    getScreenAccess: async (screen: string) => ({
      viewer: { role: viewer.role, name: viewer.name },
      outside: !canSee(viewer.role as never, screen as never),
    }),
    getProjectContext: async (_code: string, screen: string) => ({
      viewer: { role: viewer.role, name: viewer.name },
      canEdit: () => canSee(viewer.role as never, screen as never) && viewer.projectEditable,
    }),
  };
});

import { revalidatePath } from 'next/cache';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getHoursReconciliation, getRateCard, getSkillsMatrix } from '@/server/dal/hr';
import { listAudit } from '@/server/dal/notifications';
import {
  addRateRoleAction, addSkillAction, assignHoursAction, importHoursAction, setBaseRateAction, setMultiplierAction, syncLuccaAction,
} from './actions';

const as = (role: string, name: string, projectEditable = true) => Object.assign(viewer, { role, name, projectEditable });

describe('HR Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    as('director', 'Marie Lefebvre');
    vi.mocked(revalidatePath).mockClear();
  });

  it('rate card: director/pm only; NaN-free validation; audit row by the viewer; revalidates /resources/rates', async () => {
    as('member', 'Julien Wagner');
    expect(await setBaseRateAction('Planner', 80)).toEqual({ error: 'Rates are visible to directors and project managers only' });
    as('depthead', 'Marion Kerviel');
    expect(await setMultiplierAction('sun', 2.5)).toEqual({ error: 'Rates are visible to directors and project managers only' });
    as('pm', 'Romain Aubert');
    expect(await setBaseRateAction('Planner', -5)).toEqual({ error: 'Hourly rate out of range' });
    expect(await setBaseRateAction('Nobody', 80)).toEqual({ error: 'Invalid request' });
    expect(await setBaseRateAction('Planner', 80)).toEqual({ ok: true, value: 80 });
    expect(await setMultiplierAction('sun', 2.5)).toEqual({ ok: true, value: 2.5 });
    expect(await setMultiplierAction('xx', 2)).toEqual({ error: 'Invalid request' });
    const card = await getRateCard();
    expect(card.roles.find((r) => r.role === 'Planner')!.baseRateEur).toBe(80);
    expect(card.multipliers.find((m) => m.key === 'sun')!.factor).toBe(2.5);
    expect(revalidatePath).toHaveBeenCalledWith('/resources/rates');
    const audit = await listAudit();
    expect(audit.some((a) => a.who.includes('Aubert') && /Planner base: 74 → 80/.test(a.change))).toBe(true);
    // restore the seed values
    await setBaseRateAction('Planner', 74);
    await setMultiplierAction('sun', 2);
  });

  it('Add role: appended to the rate card; duplicates refused', async () => {
    expect(await addRateRoleAction({ role: 'Commissioning engineer', rate: '78', cc: 'site', grade: 'senior' })).toEqual({ toast: 'Role added to the rate card' });
    const card = await getRateCard();
    expect(card.roles.at(-1)).toMatchObject({ role: 'Commissioning engineer', baseRateEur: 78, isExternal: false, costCenter: 'site', grade: 'senior' });
    expect(await addRateRoleAction({ role: 'commissioning ENGINEER', rate: '70' })).toEqual({ error: 'This role is already on the rate card' });
    as('quality', 'Gabriel Comte');
    expect(await addRateRoleAction({ role: 'Inspector', rate: '70' })).toEqual({ error: 'Rates are visible to directors and project managers only' });
  });

  it('Add skill: new matrix column (all levels 0); outside viewers refused', async () => {
    as('member', 'Julien Wagner');
    expect(await addSkillAction({ name: 'Welding', cat: 'site', levels: '1_4' })).toEqual({ toast: 'Skill added' });
    const m = await getSkillsMatrix();
    expect(m.skills.at(-1)).toEqual({ name: 'Welding', category: 'site' });
    expect(m.people.every((p) => p.levels.length === 11 && p.levels[10] === 0)).toBe(true);
    expect(await addSkillAction({ name: 'welding' })).toEqual({ error: 'This skill is already in the matrix' });
    as('procurement', 'Fabien Bertrand');
    expect(await addSkillAction({ name: 'Negotiation' })).toEqual({ error: 'Outside my workspace · Read-only' });
  });

  it('Sync Lucca: toast for every internal role, refused to the client (outside)', async () => {
    as('quality', 'Gabriel Comte');
    expect(await syncLuccaAction({ period: 'next_6m', teams: 'site' })).toEqual({ toast: 'Lucca synchronised · 14 absences updated' });
    expect(await syncLuccaAction({ period: 'later' })).toEqual({ error: 'Unknown period' });
    as('client', 'Nadia Bensaïd');
    expect(await syncLuccaAction({})).toEqual({ error: 'Outside my workspace · Read-only' });
  });

  it('Import Lucca hours: date flips to 30 Sep 2026, real counts; gates and refusals', async () => {
    as('pm', 'Romain Aubert', false);
    expect(await importHoursAction('HLT-026', {})).toEqual({ error: 'Hours are read-only for you on this project' });
    as('member', 'Julien Wagner');
    expect(await importHoursAction('HLT-026', {})).toEqual({ error: 'Hours are read-only for you on this project' });
    as('depthead', 'Marion Kerviel');
    expect(await importHoursAction('NOPE-1', {})).toEqual({ error: 'Invalid request' });
    expect(await importHoursAction('HLT-026', { code: 'XYZ001' })).toEqual({ error: 'This analytic code does not belong to the project' });
    expect(await importHoursAction('HLT-026', { period: '2026-08' })).toEqual({ error: 'No hours declared in Lucca for this period' });
    expect(await importHoursAction('NDC-031', {})).toEqual({ error: 'No hours declared in Lucca for this period' });
    expect((await getHoursReconciliation('HLT-026'))!.importedText).toBe('29 Sep 2026');
    expect(await importHoursAction('HLT-026', { period: '2026-q3', code: '', mode: 'resource_wp' })).toEqual({
      toast: 'Lucca hours imported · 10 lines matched · 2 to assign',
    });
    const h = (await getHoursReconciliation('HLT-026'))!;
    expect([h.importedText, h.analyticCode, h.matchingMode]).toEqual(['30 Sep 2026', 'HAV004', 'resource_wp']);
    expect(revalidatePath).toHaveBeenCalledWith('/projects/HLT-026/hours');
  });

  it('Assign: routes a line to a level-1 work package once', async () => {
    as('director', 'Marie Lefebvre');
    expect(await assignHoursAction('HLT-026', 0, '9.9')).toEqual({ error: 'Choose a work package' });
    expect(await assignHoursAction('HLT-026', 5, '1.3')).toEqual({ error: 'Invalid request' });
    expect(await assignHoursAction('HLT-026', 0, '1.3')).toEqual({ toast: '18 h assigned to 1.3 · Foundations' });
    expect(await assignHoursAction('HLT-026', 0, '1.4')).toEqual({ error: 'These hours are already assigned' });
    const h = (await getHoursReconciliation('HLT-026'))!;
    expect(h.unassigned.map((u) => [u.person, u.assignedWbs])).toEqual([['Fabien Bertrand', '1.3'], ['Pauline Noguès', null]]);
    expect(await importHoursAction('HLT-026', {})).toEqual({ toast: 'Lucca hours imported · 10 lines matched · 1 to assign' });
  });
});
