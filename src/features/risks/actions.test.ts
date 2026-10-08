// Risk register and Contingency Server Functions against an in-memory database: permission gate, prototype
// parsing of the add-forms (numbering R-21…, clamps, toasts), drawer edits and draw-downs, with the viewer as the
// actor. Session and project context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Marie Lefebvre', canEdit: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name }, canEdit: () => viewer.canEdit }),
}));

import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getContingency } from '@/server/dal/contingency';
import { listAudit } from '@/server/dal/notifications';
import { getRiskRegister } from '@/server/dal/risks';
import { createRiskAction, recordDrawDownAction, updateRiskAction } from './actions';

const risk = async (id: string, code = 'HLT-026') => (await getRiskRegister(code))!.risks.find((r) => r.id === id);

describe('risk Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    viewer.name = 'Marie Lefebvre';
    viewer.canEdit = true;
  });

  it('refuses read-only viewers and unknown projects', async () => {
    viewer.canEdit = false;
    expect(await createRiskAction('HLT-026', { title: 'x' })).toEqual({ error: 'This risk register is read-only for you' });
    expect(await updateRiskAction('HLT-026', 'R-03', { probability: 2 })).toEqual({ error: 'This risk register is read-only for you' });
    expect(await recordDrawDownAction('HLT-026', { amount: '5', reason: 'x' })).toEqual({ error: 'This contingency register is read-only for you' });
    viewer.canEdit = true;
    expect(await createRiskAction('NOPE-000', { title: 'x' })).toEqual({ error: 'Unknown project' });
    expect(await updateRiskAction('', 'R-03', { probability: 2 })).toEqual({ error: 'Invalid request' });
    expect((await risk('R-03'))!.probability).toBe(4);
  });

  it('"New risk": R-21 · Risk registered, prepended, clamps and defaults, the viewer in the audit trail', async () => {
    viewer.name = 'Romain Aubert';
    const r = await createRiskAction('HLT-026', { title: ' Port strike ', cat: 'contractual_client', p: '9', i: '0', owner: 'Léa Marchand', resp: 'accept', emv: '30', plan: '' });
    expect(r).toEqual({ toast: 'R-21 · Risk registered' });
    const reg = (await getRiskRegister('HLT-026'))!;
    expect(reg.risks[0]).toMatchObject({
      id: 'R-21', title: 'Port strike', category: 'contractual_client', probability: 5, impact: 3, owner: 'Léa Marchand', response: 'accept', emv: 30,
      plan: '—', trigger: '—', status: 'open', trend: 'flat', activity: null,
    });
    expect(reg.openEmv).toBe(370);
    expect((await listAudit())[0]).toMatchObject({ who: 'Romain Aubert', object: 'R-21' });
  });

  it('"New risk" validation: title, team owner, category and response', async () => {
    expect(await createRiskAction('HLT-026', { title: '  ' })).toEqual({ error: 'Title is required' });
    expect(await createRiskAction('HLT-026', { title: 'x', owner: 'Nadia Bensaïd' })).toEqual({ error: 'Unknown owner' });
    expect(await createRiskAction('HLT-026', { title: 'x', cat: 'weather' })).toEqual({ error: 'Unknown category' });
    expect(await createRiskAction('HLT-026', { title: 'x', resp: 'pray' })).toEqual({ error: 'Unknown response' });
    // Forged payloads (non-string values) are refused, never thrown on.
    expect(await createRiskAction('HLT-026', { title: 42 } as never)).toEqual({ error: 'Title is required' });
    expect(await recordDrawDownAction('HLT-026', { amount: '3', reason: ['x'] } as never)).toEqual({ error: 'Reason is required' });
    // Projects without data take owners from the whole pool and number globally (R-22).
    expect(await createRiskAction('EWA-051', { title: 'Permit appeal', owner: 'Julien Wagner' })).toEqual({ toast: 'R-22 · Risk registered' });
    expect((await risk('R-22', 'EWA-051'))!.category).toBe('supplier_delivery');
  });

  it('drawer edits: P / I / response / close and reopen; invalid values and unknown risks refused', async () => {
    expect(await updateRiskAction('HLT-026', 'R-03', { probability: 3, response: 'transfer' })).toEqual({ ok: true });
    expect(await risk('R-03')).toMatchObject({ probability: 3, score: 12, level: 'high', response: 'transfer', costIfOccurs: 200 });
    expect(await updateRiskAction('HLT-026', 'R-03', { impact: 5 })).toEqual({ ok: true });
    expect((await risk('R-03'))!.level).toBe('critical');
    expect(await updateRiskAction('HLT-026', 'R-03', { status: 'closed' })).toEqual({ ok: true });
    expect((await getRiskRegister('HLT-026'))!.openEmv).toBe(250);
    expect(await updateRiskAction('HLT-026', 'R-03', { status: 'open' })).toEqual({ ok: true });
    expect(await updateRiskAction('HLT-026', 'R-03', { probability: 7 })).toEqual({ error: 'Invalid request' });
    expect(await updateRiskAction('HLT-026', 'R-03', {})).toEqual({ error: 'Invalid request' });
    expect(await updateRiskAction('HLT-026', 'R-99', { probability: 2 })).toEqual({ error: 'Unknown risk' });
    expect(await updateRiskAction('NDC-031', 'R-07', { probability: 2 })).toEqual({ error: 'Unknown risk' });
  });

  it('"Record draw-down": appended with the approver, exposure from the open risks', async () => {
    expect(await recordDrawDownAction('HLT-026', { amount: '10', reason: 'Night shift lighting', link: 'R-07', approver: 'R. Aubert' })).toEqual({ toast: 'Draw-down recorded' });
    const c = (await getContingency('HLT-026'))!;
    expect([c.drawn, c.remaining, c.draws.length]).toEqual([58, 92, 4]);
    expect(c.draws.at(-1)).toMatchObject({ amount: 10, reason: 'Night shift lighting', linkRef: 'R-07', linkType: 'risk', approvedBy: 'R. Aubert', dateText: '25 Sep' });
    expect(await recordDrawDownAction('HLT-026', { amount: '0', reason: 'x' })).toEqual({ error: 'Enter an amount greater than 0' });
    expect(await recordDrawDownAction('HLT-026', { amount: '3', reason: ' ' })).toEqual({ error: 'Reason is required' });
    expect(await recordDrawDownAction('HLT-026', { amount: '3', reason: 'x', approver: 'N. Bensaïd' })).toEqual({ error: 'Unknown approver' });
  });

  it('"Record draw-down" on a project without a register creates it with the default provision', async () => {
    expect(await recordDrawDownAction('NDC-031', { amount: '5', reason: 'UPS', approver: 'M. Lefebvre' })).toEqual({ toast: 'Draw-down recorded' });
    const c = (await getContingency('NDC-031'))!;
    expect([c.initial, c.isDefault, c.drawn, c.draws[0].approvedBy, c.draws[0].linkRef]).toEqual([63, false, 5, 'M. Lefebvre', null]);
  });
});
