// HR Server Functions against an in-memory database: permission gates (rates: director and Finance — P-12 c; outside the workspace;
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

  it('rate card (P-12 c, R-044): the director and Finance edit, PMs read; NaN-free validation; dated versions; audit by the viewer', async () => {
    const ON = '2026-09-25';
    const REFUSED = { error: 'Rates are edited by the portfolio director and Finance' };
    as('member', 'Julien Wagner');
    expect(await setBaseRateAction('Planner', 80, ON)).toEqual(REFUSED);
    as('depthead', 'Marion Kerviel');
    expect(await setMultiplierAction('sun', 2.5, ON)).toEqual(REFUSED);
    // P-12 (c): the PMs read the grid (they edited it before delivery 8).
    as('pm', 'Romain Aubert');
    expect(await setBaseRateAction('Planner', 80, ON)).toEqual(REFUSED);
    expect(await setMultiplierAction('sun', 2.5, ON)).toEqual(REFUSED);
    as('finance', 'Léa Marchand');
    expect(await setBaseRateAction('Planner', -5, ON)).toEqual({ error: 'Hourly rate out of range' });
    expect(await setBaseRateAction('Nobody', 80, ON)).toEqual({ error: 'Invalid request' });
    expect(await setBaseRateAction('Planner', 80, 'yesterday')).toEqual({ error: 'Enter a valid effective date' });
    expect(await setBaseRateAction('Planner', 80, '2026-02-30')).toEqual({ error: 'Enter a valid effective date' });
    expect(await setBaseRateAction('Planner', 80, ON)).toEqual({ ok: true, value: 80 });
    expect(await setMultiplierAction('sun', 2.5, ON)).toEqual({ ok: true, value: 2.5 });
    expect(await setMultiplierAction('xx', 2, ON)).toEqual({ error: 'Invalid request' });
    // R-083: the new versions apply from 25 Sep 2026; the seed grid (1 Jan 2026) still values the hours before.
    const card = await getRateCard(ON);
    expect(card.roles.find((r) => r.role === 'Planner')).toMatchObject({ baseRateEur: 80, effectiveFrom: ON });
    expect(card.multipliers.find((m) => m.key === 'sun')).toMatchObject({ factor: 2.5, effectiveFrom: ON });
    expect((await getRateCard('2026-09-24')).roles.find((r) => r.role === 'Planner')).toMatchObject({ baseRateEur: 74, effectiveFrom: '2026-01-01' });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    const audit = await listAudit();
    expect(audit.some((a) => a.who.includes('Marchand') && a.change === 'Planner base: 74 → 80 €/h from 25 Sep 2026')).toBe(true);
    // The director edits too; the same date updates the version instead of adding one.
    as('director', 'Marie Lefebvre');
    expect(await setBaseRateAction('Planner', 74, ON)).toEqual({ ok: true, value: 74 });
    expect(await setMultiplierAction('sun', 2, ON)).toEqual({ ok: true, value: 2 });
    expect((await getRateCard(ON)).roles.find((r) => r.role === 'Planner')!.versions.map((v) => v.effectiveFrom)).toEqual(['2026-01-01', ON]);
  });

  it('Add role: appended to the rate card from its effective date; duplicates refused; director and Finance only', async () => {
    expect(await addRateRoleAction({ role: 'Commissioning engineer', rate: '78', cc: 'site', grade: 'senior', from: '1 Nov 2026' })).toEqual({ toast: 'Role added to the rate card' });
    const card = await getRateCard('2026-11-01');
    expect(card.roles.at(-1)).toMatchObject({ role: 'Commissioning engineer', baseRateEur: 78, isExternal: false, costCenter: 'site', grade: 'senior', effectiveFrom: '2026-11-01' });
    // Before its effective date the role has no rate (not valued).
    expect((await getRateCard('2026-10-31')).roles.at(-1)).toMatchObject({ baseRateEur: null, effectiveFrom: null });
    expect(await addRateRoleAction({ role: 'commissioning ENGINEER', rate: '70', from: '1 Nov 2026' })).toEqual({ error: 'This role is already on the rate card' });
    expect(await addRateRoleAction({ role: 'Inspector', rate: '70', from: '31 Feb 2026' })).toEqual({ error: 'Enter a valid effective date' });
    expect(await addRateRoleAction({ role: 'Inspector', rate: '70' })).toEqual({ error: 'Enter a valid effective date' });
    for (const [role, name] of [['quality', 'Gabriel Comte'], ['pm', 'Romain Aubert']] as const) {
      as(role, name);
      expect(await addRateRoleAction({ role: 'Inspector', rate: '70', from: '1 Nov 2026' })).toEqual({ error: 'Rates are edited by the portfolio director and Finance' });
    }
  });

  it('Add skill: new matrix column (all levels 0); outside viewers refused', async () => {
    as('member', 'Julien Wagner');
    // R-5a (R-087): one 1–5 scale — the form has no "Levels" field any more.
    expect(await addSkillAction({ name: 'Welding', cat: 'site' })).toEqual({ toast: 'Skill added' });
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
    // Delivery 8: the hours writers re-check the project rule with the actor — Marion Kerviel is not on HLT-026's team (R-041),
    // which this mocked context ignores; the DAL refuses, nothing is written.
    expect(await importHoursAction('HLT-026', { period: '2026-q3', code: '', mode: 'resource_wp' })).toEqual({ error: 'Hours are read-only for you on this project' });
    expect((await getHoursReconciliation('HLT-026'))!.importedText).toBe('29 Sep 2026');
    as('pm', 'Romain Aubert');
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
