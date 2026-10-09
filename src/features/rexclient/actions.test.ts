// Lessons learned & closure and client portal Server Functions against an in-memory database: permission gates (read-only
// project, outside the workspace, the project's client contact only for decisions and acknowledgements), input parsing,
// stale-state refusals, numbering (LL-10…, CI-08 / CI-09 / CI-10 — never "CI-010") and the viewer as the actor (no fixed
// "N. Bensaïd · 25 Sep" stamps). Session and project context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Marie Lefebvre', role: 'director', canEdit: true, isMine: true, outside: false };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async (code: string) => ({
    project: { code },
    viewer: { name: viewer.name, role: viewer.role },
    isMine: viewer.isMine,
    outside: viewer.outside,
    canEdit: () => viewer.canEdit,
  }),
}));

import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { STATUS_ISO } from '@/server/db/codes';
import { listChangeRequestDetails } from '@/server/dal/changes';
import { listClientIssues } from '@/server/dal/client';
import { listSharedDocuments } from '@/server/dal/documents';
import { listAudit } from '@/server/dal/notifications';
import { getDeliverable } from '@/server/dal/quality';
import { getRex } from '@/server/dal/rex';
import {
  acknowledgeSharedDocumentAction, addLessonAction, advanceLessonAction, cycleClosureAction, decideClientChangeAction, decideClientDeliverableAction,
  downloadStatusReportAction, raiseClientIssueAction,
} from './actions';

const as = (role: string, name: string, o: Partial<typeof viewer> = {}) => Object.assign(viewer, { role, name, canEdit: true, isMine: true, outside: false }, o);
const CLIENT = () => as('client', 'Nadia Bensaïd');
const lesson = async (n: string) => (await getRex('HLT-026')).lessons.find((l) => l.number === n)!;
const clientStep = async (cr: string) => (await listChangeRequestDetails('HLT-026')).find((c) => c.id === cr)!.chain.find((s) => s.step === 'client')!.decision;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => as('director', 'Marie Lefebvre'));

describe('lessons learned & closure Server Functions', () => {
  it('refuses read-only viewers, unknown projects and malformed requests', async () => {
    viewer.canEdit = false;
    const ro = { error: 'Lessons learned & closure is read-only for you' };
    expect(await addLessonAction('HLT-026', { what: 'x', reco: 'y' })).toEqual(ro);
    expect(await advanceLessonAction('HLT-026', 'LL-04', 'proposed')).toEqual(ro);
    expect(await cycleClosureAction('HLT-026', 0, 'not_started')).toEqual(ro);
    viewer.canEdit = true;
    expect(await addLessonAction('NOPE-000', { what: 'x', reco: 'y' })).toEqual({ error: 'Unknown project' });
    expect(await advanceLessonAction('', 'LL-04', 'proposed')).toEqual({ error: 'Invalid request' });
    expect(await advanceLessonAction('HLT-026', 'R-03', 'proposed')).toEqual({ error: 'Invalid request' });
    expect(await advanceLessonAction('HLT-026', 'LL-04', 'done' as never)).toEqual({ error: 'Invalid request' });
    expect(await cycleClosureAction('HLT-026', -1, 'not_started')).toEqual({ error: 'Invalid request' });
    expect(await cycleClosureAction('HLT-026', 1.5, 'not_started')).toEqual({ error: 'Invalid request' });
    expect(await advanceLessonAction('HLT-026', 'LL-99', 'proposed')).toEqual({ error: 'Unknown lesson' });
    expect(await cycleClosureAction('HLT-026', 42, 'not_started')).toEqual({ error: 'Unknown checklist item' });
    // A screen outside the workspace is refused by the data layer as well (defence in depth).
    as('procurement', 'Fabien Bertrand');
    expect(await advanceLessonAction('HLT-026', 'LL-04', 'proposed')).toEqual({ error: 'The change could not be saved' });
    expect((await lesson('LL-04')).status).toBe('proposed');
  });

  it('"Add lesson learned": LL-10 then LL-11, Proposed, the viewer in the audit trail; validation errors', async () => {
    as('englead', 'Antoine Girard');
    expect(await addLessonAction('HLT-026', { theme: 'quality', what: 'Weld map missing at FAT', impact: '', reco: 'Attach the weld map', apply: 'ITP template' }))
      .toEqual({ toast: 'Lesson recorded · to be validated' });
    expect(await lesson('LL-10')).toMatchObject({ theme: 'quality', impact: '—', appliesTo: 'ITP template', status: 'proposed' });
    expect((await listAudit())[0]).toMatchObject({ who: 'Antoine Girard', object: 'LL-10' });
    expect(await addLessonAction('HLT-026', { what: 'Late crane permit', reco: 'Request permits at award' })).toEqual({ toast: 'Lesson recorded · to be validated' });
    expect(await lesson('LL-11')).toMatchObject({ theme: 'engineering', appliesTo: 'WBS template' });
    expect(await addLessonAction('HLT-026', { what: ' ', reco: 'y' })).toEqual({ error: 'What happened is required' });
    expect(await addLessonAction('HLT-026', { what: 'x', reco: 'y', apply: 'Anything' })).toEqual({ error: 'Unknown template or procedure' });
    expect(await addLessonAction('HLT-026', { what: 42, reco: 'y' } as never)).toEqual({ error: 'What happened is required' });
    // Projects without REX data start their own register at LL-10.
    expect(await addLessonAction('NDC-031', { what: 'Chiller lead time', reco: 'Order at award' })).toEqual({ toast: 'Lesson recorded · to be validated' });
    expect((await getRex('NDC-031')).lessons.map((l) => l.number)).toEqual(['LL-10']);
  });

  it('Validate / Mark applied one step at a time; a stale or finished lesson is refused', async () => {
    expect(await advanceLessonAction('HLT-026', 'LL-04', 'proposed')).toEqual({ ok: true });
    expect((await lesson('LL-04')).status).toBe('validated');
    expect(await advanceLessonAction('HLT-026', 'LL-04', 'proposed')).toEqual({ error: 'This lesson has already moved on' });
    expect(await advanceLessonAction('HLT-026', 'LL-04', 'validated')).toEqual({ ok: true });
    expect(await advanceLessonAction('HLT-026', 'LL-04', 'applied')).toEqual({ error: 'This lesson has already moved on' });
    expect((await lesson('LL-04')).status).toBe('applied');
  });

  it('closure checklist click cycles; a stale click is refused', async () => {
    const item = async () => (await getRex('HLT-026')).closure[0].status;
    expect(await cycleClosureAction('HLT-026', 0, 'not_started')).toEqual({ ok: true });
    expect(await item()).toBe('in_progress');
    expect(await cycleClosureAction('HLT-026', 0, 'not_started')).toEqual({ error: 'This checklist item has already changed' });
    expect(await cycleClosureAction('HLT-026', 0, 'in_progress')).toEqual({ ok: true });
    expect(await cycleClosureAction('HLT-026', 0, 'done')).toEqual({ ok: true });
    expect(await item()).toBe('not_started');
  });
});

describe('client portal Server Functions', () => {
  it('outside the workspace: read-only', async () => {
    as('pm', 'Romain Aubert', { outside: true });
    const ro = { error: 'The client portal is read-only for you' };
    expect(await decideClientChangeAction('HLT-026', 'CR-008', 'ok')).toEqual(ro);
    expect(await raiseClientIssueAction('HLT-026', 'x')).toEqual(ro);
    expect(await acknowledgeSharedDocumentAction('HLT-026', 'PID-HLT-026')).toEqual(ro);
    expect(await downloadStatusReportAction('HLT-026', {})).toEqual(ro);
  });

  it('only the project’s client decides and acknowledges (the director previews; another project’s client cannot)', async () => {
    const no = { error: 'Only the project’s client decides here' };
    expect(await decideClientChangeAction('HLT-026', 'CR-008', 'ok')).toEqual(no);
    expect(await decideClientDeliverableAction('HLT-026', 'D-014', 'accepted')).toEqual(no);
    expect(await acknowledgeSharedDocumentAction('HLT-026', 'PID-HLT-026')).toEqual({ error: 'Only the client can acknowledge receipt' });
    as('client', 'Nadia Bensaïd', { isMine: false });
    expect(await decideClientDeliverableAction('NDC-031', 'D-112', 'accepted')).toEqual(no);
    expect(await clientStep('CR-008')).toBe('pending');
    expect((await getDeliverable('HLT-026', 'D-014'))!.status).toBe('submitted');
  });

  it('the client approves CR-008, accepts D-014 and rejects D-016; decided items cannot be decided again', async () => {
    CLIENT();
    expect(await decideClientChangeAction('HLT-026', 'CR-008', 'maybe' as never)).toEqual({ error: 'Invalid request' });
    expect(await decideClientChangeAction('HLT-026', 'CR-999', 'ok')).toEqual({ error: 'Unknown change request' });
    expect(await decideClientChangeAction('HLT-026', 'CR-004', 'ok')).toEqual({ error: 'This decision is no longer pending' });
    expect(await decideClientChangeAction('HLT-026', 'CR-008', 'ok')).toEqual({ ok: true });
    expect(await clientStep('CR-008')).toBe('ok');
    expect(await decideClientChangeAction('HLT-026', 'CR-008', 'rejected')).toEqual({ error: 'This decision is no longer pending' });

    expect(await decideClientDeliverableAction('HLT-026', 'D-014', 'accepted')).toEqual({ ok: true });
    expect(await getDeliverable('HLT-026', 'D-014')).toMatchObject({ status: 'accepted', acceptedOn: STATUS_ISO, acceptanceText: '25 Sep · N. Bensaïd' });
    expect(await decideClientDeliverableAction('HLT-026', 'D-016', 'rejected')).toEqual({ ok: true });
    expect(await getDeliverable('HLT-026', 'D-016')).toMatchObject({ status: 'rejected', acceptanceText: '25 Sep · comments issued' });
    expect(await decideClientDeliverableAction('HLT-026', 'D-014', 'rejected')).toEqual({ error: 'This decision is no longer pending' });
    expect(await decideClientDeliverableAction('HLT-026', 'D-999', 'accepted')).toEqual({ error: 'Unknown deliverable' });
    expect(await decideClientDeliverableAction('HLT-026', 'CR-008', 'accepted')).toEqual({ error: 'Invalid request' });
  });

  it('"Raise issue": CI-08, CI-09, CI-10 (not "CI-010"), raised today by the viewer; blank text refused', async () => {
    CLIENT();
    expect(await raiseClientIssueAction('HLT-026', '   ')).toEqual({ error: 'Describe the issue or request' });
    expect(await raiseClientIssueAction('HLT-026', ' Crane test witness slot ')).toEqual({ ok: true, number: 'CI-08' });
    expect(await raiseClientIssueAction('HLT-026', 'Spare parts list format')).toEqual({ ok: true, number: 'CI-09' });
    as('director', 'Marie Lefebvre');
    expect(await raiseClientIssueAction('HLT-026', 'Training dates')).toEqual({ ok: true, number: 'CI-10' });
    const issues = await listClientIssues('HLT-026');
    expect(issues.slice(0, 3).map((i) => [i.number, i.title, i.raisedOn, i.raisedBy, i.status])).toEqual([
      ['CI-10', 'Training dates', STATUS_ISO, 'Marie Lefebvre', 'open'],
      ['CI-09', 'Spare parts list format', STATUS_ISO, 'Nadia Bensaïd', 'open'],
      ['CI-08', 'Crane test witness slot', STATUS_ISO, 'Nadia Bensaïd', 'open'],
    ]);
    as('client', 'Nadia Bensaïd', { isMine: false });
    expect(await raiseClientIssueAction('NDC-031', 'Not my project')).toEqual({ error: 'Only the project’s client raises issues here' });
  });

  it('"Acknowledge receipt" of a shared document; unknown or other projects’ documents refused', async () => {
    CLIENT();
    expect(await acknowledgeSharedDocumentAction('HLT-026', 'PID-NDC-031')).toEqual({ error: 'Unknown document' });
    expect(await acknowledgeSharedDocumentAction('HLT-026', 'PID-HLT-026')).toEqual({ ok: true });
    expect((await listSharedDocuments('HLT-026')).find((d) => d.number === 'PID-HLT-026')!.acknowledged).toBe(true);
    expect(await acknowledgeSharedDocumentAction('HLT-026', 'PID-HLT-026')).toEqual({ ok: true });
  });

  it('"Download status report": recorded, toast "Report downloaded"; invalid choices refused', async () => {
    CLIENT();
    expect(await downloadStatusReportAction('HLT-026', { period: 'quarter', format: 'pptx' })).toEqual({ toast: 'Report downloaded' });
    expect((await listAudit())[0]).toMatchObject({ who: 'Nadia Bensaïd', object: 'Status report' });
    expect(await downloadStatusReportAction('HLT-026', { format: 'docx' })).toEqual({ error: 'Unknown format' });
    expect(await downloadStatusReportAction('HLT-026', { period: 'Q3 2026' })).toEqual({ error: 'Unknown period' });
  });
});
