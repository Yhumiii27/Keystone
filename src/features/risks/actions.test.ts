// Risk register and Contingency Server Functions against an in-memory database: permission gate, prototype
// parsing of the add-forms (numbering R-21…, clamps, toasts), drawer edits and draw-downs, with the viewer as the
// actor. Session and project context are mocked.
// Delivery 7: the cost if it occurs (Q-1, EMV derived); linked draw-downs submitted to the portfolio director, who validates
// or rejects them from My approvals (C-4) — rights, input validation, balance, stale decisions and notifications.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Marie Lefebvre', role: 'director', canEdit: true, inbox: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name, role: viewer.role }, canEdit: () => viewer.canEdit }),
  getScreenAccess: async () => ({ viewer: { name: viewer.name, role: viewer.role }, outside: !viewer.inbox, canEdit: viewer.inbox }),
}));

import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getContingency } from '@/server/dal/contingency';
import { listAudit, listNotifications } from '@/server/dal/notifications';
import { getRiskRegister } from '@/server/dal/risks';
import { createRiskAction, decideDrawDownAction, recordDrawDownAction, updateRiskAction } from './actions';

const risk = async (id: string, code = 'HLT-026') => (await getRiskRegister(code))!.risks.find((r) => r.id === id);

describe('risk Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    viewer.name = 'Marie Lefebvre';
    viewer.role = 'director';
    viewer.canEdit = true;
    viewer.inbox = true;
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
    // Q-1: the cost if it occurs (30) is entered; EMV = 30 × 5 / 5.
    const r = await createRiskAction('HLT-026', { title: ' Port strike ', cat: 'contractual_client', p: '9', i: '0', owner: 'Léa Marchand', resp: 'accept', cost: '30', plan: '' });
    expect(r).toEqual({ toast: 'R-21 · Risk registered' });
    const reg = (await getRiskRegister('HLT-026'))!;
    expect(reg.risks[0]).toMatchObject({
      id: 'R-21', title: 'Port strike', category: 'contractual_client', probability: 5, impact: 3, owner: 'Léa Marchand', response: 'accept', emv: 30, costIfOccurs: 30,
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
    expect(await createRiskAction('HLT-026', { title: 'x', cost: '-4' })).toEqual({ error: 'Enter a cost of 0 or more (k€)' });
    // Forged payloads (non-string values) are refused, never thrown on.
    expect(await createRiskAction('HLT-026', { title: 42 } as never)).toEqual({ error: 'Title is required' });
    expect(await recordDrawDownAction('HLT-026', { amount: '3', reason: ['x'], link: 'R-03' } as never)).toEqual({ error: 'Reason is required' });
    // Projects without data take owners from the whole pool and number globally (R-22).
    expect(await createRiskAction('EWA-051', { title: 'Permit appeal', owner: 'Julien Wagner' })).toEqual({ toast: 'R-22 · Risk registered' });
    expect((await risk('R-22', 'EWA-051'))!.category).toBe('supplier_delivery');
  });

  it('drawer edits: P / I / response / close and reopen; invalid values and unknown risks refused', async () => {
    expect(await updateRiskAction('HLT-026', 'R-03', { probability: 3, response: 'transfer' })).toEqual({ ok: true });
    // Q-1: the cost stays 150, the EMV follows P (120 → 90) — the prototype kept the EMV and showed a cost of 200.
    expect(await risk('R-03')).toMatchObject({ probability: 3, score: 12, level: 'high', response: 'transfer', costIfOccurs: 150, emv: 90 });
    expect(await updateRiskAction('HLT-026', 'R-03', { impact: 5 })).toEqual({ ok: true });
    expect((await risk('R-03'))!.level).toBe('critical');
    expect(await updateRiskAction('HLT-026', 'R-03', { status: 'closed' })).toEqual({ ok: true });
    expect((await getRiskRegister('HLT-026'))!.openEmv).toBe(250);
    expect(await updateRiskAction('HLT-026', 'R-03', { costKeur: 175.5 })).toEqual({ ok: true });
    expect(await risk('R-03')).toMatchObject({ costIfOccurs: 175.5, emv: 105.3 });
    expect(await updateRiskAction('HLT-026', 'R-03', { costKeur: -1 })).toEqual({ error: 'Enter a cost of 0 or more (k€)' });
    expect(await updateRiskAction('HLT-026', 'R-03', { status: 'open' })).toEqual({ ok: true });
    expect(await updateRiskAction('HLT-026', 'R-03', { probability: 7 })).toEqual({ error: 'Invalid request' });
    expect(await updateRiskAction('HLT-026', 'R-03', {})).toEqual({ error: 'Invalid request' });
    expect(await updateRiskAction('HLT-026', 'R-99', { probability: 2 })).toEqual({ error: 'Unknown risk' });
    expect(await updateRiskAction('NDC-031', 'R-07', { probability: 2 })).toEqual({ error: 'Unknown risk' });
  });

  it('"Record draw-down": linked, submitted to the director (not drawn yet), who is notified', async () => {
    viewer.name = 'Romain Aubert';
    viewer.role = 'pm';
    expect(await recordDrawDownAction('HLT-026', { amount: '10', reason: 'Night shift lighting', link: 'R-07' }))
      .toEqual({ toast: 'Draw-down recorded · Awaiting the director’s validation' });
    const c = (await getContingency('HLT-026'))!;
    expect([c.drawn, c.pending, c.remaining, c.draws.length]).toEqual([48, 10, 102, 4]);
    expect(c.draws.at(-1)).toMatchObject({ amount: 10, reason: 'Night shift lighting', linkRef: 'R-07', linkType: 'risk', status: 'submitted', approvedBy: null, requestedBy: 'R. Aubert', dateText: '25 Sep' });
    expect((await listNotifications('director'))[0]).toMatchObject({ title: 'Contingency draw-down to validate', sub: 'HLT-026 · 10 k€ · R-07' });
    expect(await recordDrawDownAction('HLT-026', { amount: '0', reason: 'x', link: 'R-07' })).toEqual({ error: 'Enter an amount greater than 0' });
    expect(await recordDrawDownAction('HLT-026', { amount: '3', reason: ' ', link: 'R-07' })).toEqual({ error: 'Reason is required' });
    // C-4: the link is required and must be one of the project's change requests, risks or NCRs.
    expect(await recordDrawDownAction('HLT-026', { amount: '3', reason: 'x' })).toEqual({ error: 'Choose the change request, risk or NCR the draw-down covers' });
    expect(await recordDrawDownAction('HLT-026', { amount: '3', reason: 'x', link: 'CR / risk / NCR' })).toEqual({ error: 'Unknown change request, risk or NCR' });
    expect(await recordDrawDownAction('HLT-026', { amount: '3', reason: 'x', link: 'CR-009' })).toEqual({ error: 'Unknown change request, risk or NCR' });
    // The provision left once the pending draw-downs are counted: 150 − 48 − 10 = 92.
    expect(await recordDrawDownAction('HLT-026', { amount: '93', reason: 'x', link: 'R-03' })).toEqual({ error: 'The draw-down exceeds the remaining provision' });
  });

  it('My approvals: only the portfolio director validates or rejects; stale and forged decisions are refused', async () => {
    const pending = (await getContingency('HLT-026'))!.draws.at(-1)!;
    viewer.name = 'Romain Aubert';
    viewer.role = 'pm';
    const input = { projectCode: 'HLT-026', drawId: pending.id, decision: 'validated' };
    expect(await decideDrawDownAction(input)).toEqual({ ok: false, error: 'Only the portfolio director validates contingency draw-downs' });
    viewer.name = 'Marie Lefebvre';
    viewer.role = 'director';
    viewer.inbox = false;
    expect(await decideDrawDownAction(input)).toEqual({ ok: false, error: 'Only the portfolio director validates contingency draw-downs' });
    viewer.inbox = true;
    expect(await decideDrawDownAction({ ...input, decision: 'ok' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await decideDrawDownAction({ ...input, drawId: 'nope' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await decideDrawDownAction({ ...input, projectCode: 'HLT' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await decideDrawDownAction(null as never)).toEqual({ ok: false, error: 'Invalid request' });
    // A draw-down of another project is not this project's.
    expect(await decideDrawDownAction({ ...input, projectCode: 'NDC-031' })).toEqual({ ok: false, error: 'This draw-down is not waiting for a decision any more' });
    expect(await decideDrawDownAction(input)).toEqual({ ok: true, toast: 'HLT-026 · Draw-down validated' });
    expect((await getContingency('HLT-026'))!).toMatchObject({ drawn: 58, pending: 0, remaining: 92 });
    expect((await listNotifications('pm'))[0]).toMatchObject({ title: 'Contingency draw-down validated', sub: 'HLT-026 · 10 k€ · R-07' });
    expect(await decideDrawDownAction(input)).toEqual({ ok: false, error: 'This draw-down is not waiting for a decision any more' });
    expect((await listAudit())[0]).toMatchObject({ who: 'Marie Lefebvre', object: 'Contingency', change: 'draw-down validated · 10 k€ · R-07', area: 'Contingency' });
  });

  it('a rejection keeps the comment the requester sees and draws nothing', async () => {
    viewer.name = 'Romain Aubert';
    viewer.role = 'pm';
    expect(await recordDrawDownAction('HLT-026', { amount: '4', reason: 'Bolts', link: 'CR-004' })).toMatchObject({ toast: expect.any(String) });
    const id = (await getContingency('HLT-026'))!.draws.at(-1)!.id;
    viewer.name = 'Marie Lefebvre';
    viewer.role = 'director';
    expect(await decideDrawDownAction({ projectCode: 'HLT-026', drawId: id, decision: 'rejected', comment: '  Covered by CR-004  ' })).toEqual({ ok: true, toast: 'HLT-026 · Draw-down rejected' });
    const c = (await getContingency('HLT-026'))!;
    expect([c.drawn, c.pending, c.draws.at(-1)!.status, c.draws.at(-1)!.decisionComment]).toEqual([58, 0, 'rejected', 'Covered by CR-004']);
    expect((await listNotifications('pm'))[0]).toMatchObject({ title: 'Contingency draw-down rejected', sub: 'HLT-026 · 4 k€ · CR-004 · Covered by CR-004' });
  });

  it('"Record draw-down" on a project without a register creates it with its budget\'s provision (A-8)', async () => {
    expect(await recordDrawDownAction('NDC-031', { amount: '5', reason: 'UPS', link: 'R-01' })).toMatchObject({ toast: expect.any(String) });
    const c = (await getContingency('NDC-031'))!;
    expect([c.initial, c.isDefault, c.drawn, c.pending, c.draws[0].linkRef, c.draws[0].requestedBy]).toEqual([100, false, 0, 5, 'R-01', 'M. Lefebvre']);
  });

  it('R-010: a drawer edit on a risk changed meanwhile by someone else is refused with who and when (conflict)', async () => {
    const token = (await risk('R-14'))!.version;
    viewer.name = 'Romain Aubert';
    expect(await updateRiskAction('HLT-026', 'R-14', { probability: 1 }, token)).toEqual({ ok: true });
    viewer.name = 'Léa Marchand';
    const r = await updateRiskAction('HLT-026', 'R-14', { impact: 1 }, token);
    expect(r).toEqual({ error: expect.stringMatching(/^Record modified meanwhile by Romain Aubert on \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} — reload to see their changes$/), conflict: true });
    expect((await risk('R-14'))!.impact).not.toBe(1);
    // After a reload (fresh token) Léa's edit is saved.
    expect(await updateRiskAction('HLT-026', 'R-14', { impact: 1 }, (await risk('R-14'))!.version)).toEqual({ ok: true });
  });
});
