// Change control & Trends Server Functions against an in-memory database: permission gate, who decides which
// step (the viewer's role; CCB recorded by the director), the status derived from the chain (not stuck in
// review — 07 OQ1), BL2 becoming current with CR-009, new CR numbering and the viewer as actor, status reports.
// Session and project context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { role: 'director' as string, name: 'Marie Lefebvre', canEdit: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async (code: string) => ({ project: { code }, viewer: { role: viewer.role, name: viewer.name }, canEdit: () => viewer.canEdit }),
}));

import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getChangeControl } from '@/server/dal/changes';
import { listAudit } from '@/server/dal/notifications';
import { getTrends } from '@/server/dal/trends';
import { createChangeRequestAction, decideChangeStepAction, generateStatusReportAction, submitChangeRequestAction } from './actions';

const as = (role: string, name: string) => {
  viewer.role = role;
  viewer.name = name;
};
const cr = async (id: string, code = 'HLT-026') => (await getChangeControl(code))!.changeRequests.find((c) => c.id === id)!;
const decisions = (c: Awaited<ReturnType<typeof cr>>) => c.chain.map((s) => s.decision);

describe('Change control Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 180_000);
  beforeEach(() => {
    as('director', 'Marie Lefebvre');
    viewer.canEdit = true;
    viewer.lang = 'en';
  });

  it('refuses read-only / outside viewers and unknown projects or requests', async () => {
    viewer.canEdit = false;
    expect(await decideChangeStepAction('HLT-026', 'CR-008', 'director', 'ok')).toEqual({ error: 'Change control is read-only for you' });
    expect(await submitChangeRequestAction('HLT-026', 'CR-009')).toEqual({ error: 'Change control is read-only for you' });
    expect(await createChangeRequestAction('HLT-026', { title: 'X', why: 'Y' })).toEqual({ error: 'Change control is read-only for you' });
    expect(await generateStatusReportAction('HLT-026', {})).toEqual({ error: 'Trends are read-only for you' });
    viewer.canEdit = true;
    expect(await decideChangeStepAction('NOPE-000', 'CR-008', 'director', 'ok')).toEqual({ error: 'Invalid request' });
    expect(await decideChangeStepAction('HLT-026', 'CR-999', 'director', 'ok')).toEqual({ error: 'Unknown change request' });
    expect(await decideChangeStepAction('HLT-026', 'CR-008', 'board', 'ok')).toEqual({ error: 'Invalid request' });
    expect(await decideChangeStepAction('HLT-026', 'CR-008', 'director', 'maybe')).toEqual({ error: 'Invalid request' });
    expect(decisions(await cr('CR-008'))).toEqual(['ok', 'pending', 'pending', 'pending']);
  });

  it('only the step owner decides; the director also records the change control board', async () => {
    as('client', 'Nadia Bensaïd');
    expect(await decideChangeStepAction('HLT-026', 'CR-008', 'director', 'ok')).toEqual({ error: 'This approval step is not yours to decide' });
    as('pm', 'Romain Aubert');
    expect(await decideChangeStepAction('HLT-026', 'CR-008', 'pm', 'ok')).toEqual({ error: 'This approval step is no longer pending' });
    as('quality', 'Gabriel Comte');
    expect(await decideChangeStepAction('HLT-026', 'CR-008', 'ccb', 'ok')).toEqual({ error: 'This approval step is not yours to decide' });

    as('director', 'Marie Lefebvre');
    expect(await decideChangeStepAction('HLT-026', 'CR-008', 'director', 'ok')).toEqual({ ok: true });
    as('client', 'Nadia Bensaïd');
    expect(await decideChangeStepAction('HLT-026', 'CR-008', 'client', 'ok')).toEqual({ ok: true });
    expect((await cr('CR-008')).status).toBe('in_review');
    as('director', 'Marie Lefebvre');
    expect(await decideChangeStepAction('HLT-026', 'CR-008', 'ccb', 'ok')).toEqual({ ok: true });
    const c8 = await cr('CR-008');
    expect(c8.status).toBe('approved');
    expect(c8.chain.find((s) => s.step === 'client')).toMatchObject({ decision: 'ok', decidedBy: 'Nadia Bensaïd' });
    expect(c8.chain.find((s) => s.step === 'ccb')).toMatchObject({ decision: 'ok', decidedBy: 'Marie Lefebvre' });
    expect(await decideChangeStepAction('HLT-026', 'CR-008', 'ccb', 'rejected')).toEqual({ error: 'This approval step is no longer pending' });
  });

  it('CR-009: submit, then the chain approves it (no stuck "In review") and BL2 becomes current', async () => {
    as('pm', 'Romain Aubert');
    expect(await decideChangeStepAction('HLT-026', 'CR-009', 'pm', 'ok')).toEqual({ error: 'This approval step is no longer pending' });
    expect(await submitChangeRequestAction('HLT-026', 'CR-009')).toEqual({ ok: true });
    expect(await submitChangeRequestAction('HLT-026', 'CR-009')).toEqual({ error: 'This change request has already been submitted' });
    expect((await cr('CR-009')).status).toBe('in_review');
    expect(await decideChangeStepAction('HLT-026', 'CR-009', 'pm', 'ok')).toEqual({ ok: true });
    as('client', 'Nadia Bensaïd');
    expect(await decideChangeStepAction('HLT-026', 'CR-009', 'client', 'ok')).toEqual({ ok: true });
    as('director', 'Marie Lefebvre');
    expect(await decideChangeStepAction('HLT-026', 'CR-009', 'director', 'ok')).toEqual({ ok: true });
    expect(await decideChangeStepAction('HLT-026', 'CR-009', 'ccb', 'ok')).toEqual({ ok: true });
    const cc = (await getChangeControl('HLT-026'))!;
    expect(cc.changeRequests.find((c) => c.id === 'CR-009')!.status).toBe('approved');
    expect(cc.baselines.map((b) => [b.code, b.state])).toEqual([
      ['BL0', 'superseded'],
      ['BL1', 'superseded'],
      ['BL2', 'current'],
    ]);
  });

  it('new change request: validated, numbered CR-011, submitted, raised by the viewer', async () => {
    as('pm', 'Romain Aubert');
    expect(await createChangeRequestAction('HLT-026', { title: 'X', type: 'budget', amt: '5', days: '0', wbs: '1.9', why: 'Y' })).toEqual({ error: 'Unknown WBS element 1.9' });
    expect(await createChangeRequestAction('HLT-026', { title: '', why: 'Y' })).toEqual({ error: 'Title is required' });
    const r = await createChangeRequestAction('HLT-026', { title: 'Extra lighting', type: 'scope_budget', amt: '12', days: '2', wbs: '1.6', why: 'Client ask' });
    expect(r).toEqual({ toast: 'CR-011 · Change request submitted for review' });
    const c = (await getChangeControl('HLT-026'))!.changeRequests[0];
    expect(c).toMatchObject({ id: 'CR-011', status: 'in_review', types: ['scope', 'budget'], amount: 12, days: 2, by: 'R. Aubert', justification: 'Client ask' });
    expect(decisions(c)).toEqual(['pending', 'pending', 'pending', 'pending']);
    // a project without a WBS accepts any well-formed code
    as('director', 'Marie Lefebvre');
    expect(await createChangeRequestAction('EWA-051', { title: 'Scope', type: 'scope', wbs: '1.3', why: 'Why' })).toEqual({ toast: 'CR-012 · Change request submitted for review' });
    expect((await getChangeControl('EWA-051'))!.changeRequests[0]).toMatchObject({ id: 'CR-012', by: 'M. Lefebvre' });
    expect((await listAudit()).some((a) => a.object === 'CR-012')).toBe(true);
  });

  it('generate status report: validated, recorded with the viewer, prototype toast', async () => {
    as('client', 'Nadia Bensaïd');
    expect(await generateStatusReportAction('HLT-026', { period: 'year' })).toEqual({ error: 'Unknown period' });
    expect(await generateStatusReportAction('HLT-026', { period: 'quarter', audience: 'client', sections: 'summary', note: 'For the steering' })).toEqual({
      toast: 'Status report generated · PDF ready',
    });
    const reports = (await getTrends('HLT-026'))!.reports;
    expect(reports[0]).toMatchObject({ period: 'quarter', audience: 'client', sections: 'summary', note: 'For the steering', generatedBy: 'Nadia Bensaïd' });
    // FR toasts: whole dictionary sentence first, else per " · " segment after the new number
    viewer.lang = 'fr';
    expect(await generateStatusReportAction('HLT-026', {})).toEqual({ toast: 'Rapport d’avancement généré · PDF prêt' });
    expect(await createChangeRequestAction('HLT-026', { title: 'Signage', type: 'scope', wbs: '1.3', why: 'Port rules' })).toEqual({
      toast: 'CR-013 · Demande de modification soumise en revue',
    });
  });
});
