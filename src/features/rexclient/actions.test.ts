// Lessons learned & closure Server Functions against an in-memory database: permission gates (read-only project, outside the
// workspace), input parsing, stale-state refusals, numbering (LL-10…) and the viewer as the actor. Session and project context
// are mocked. D9-06: the client portal's Server Functions and their cases were removed (clients never see Keystone).
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
import { listAudit } from '@/server/dal/notifications';
import { getRex } from '@/server/dal/rex';
import { addLessonAction, advanceLessonAction, cycleClosureAction } from './actions';

const as = (role: string, name: string, o: Partial<typeof viewer> = {}) => Object.assign(viewer, { role, name, canEdit: true, isMine: true, outside: false }, o);
const lesson = async (n: string) => (await getRex('HLT-026')).lessons.find((l) => l.number === n)!;

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
