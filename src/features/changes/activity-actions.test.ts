// NEW-D2-2 = a (Delivery 7, R-062): a change request names the plan activities it touches (form field and request drawer),
// with their new duration; the Plan drawer lists the request; once approved, the next Reschedule applies the durations.
// Session and project context are mocked (the access rule — canEdit + not the client — is the real one).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { role: 'director' as string, name: 'Marie Lefebvre', canEdit: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async (code: string) => ({
    project: { code }, viewer: { role: viewer.role, name: viewer.name }, canEdit: () => viewer.canEdit, isMine: viewer.role === 'director' || viewer.name === 'Romain Aubert',
  }),
}));

import { and, desc, eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activities, auditEntries, changeRequestSteps, changeRequests, projects } from '@/server/db/schema';
import { listCrActivityLinks } from '@/server/dal/change-activities';
import { rescheduleProject } from '@/server/dal/schedule';
import { createChangeRequestAction } from './actions';
import { linkCrActivityAction, unlinkCrActivityAction } from './activity-actions';

const HLT = 'HLT-026';
const linksOf = async (cr: string) => (await listCrActivityLinks(HLT)).filter((l) => l.cr === cr);
const form = (acts: string) => ({ title: 'Second crane for erection', type: 'schedule', amt: '40', days: '-10', wbs: '1.3', acts, why: 'Recover the steel slip' });
const duration = async (code: string) => {
  const db = await getDb();
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, HLT));
  return (await db.select({ d: activities.durationDays, pct: activities.percentComplete }).from(activities).where(and(eq(activities.projectId, p.id), eq(activities.code, code))))[0];
};

describe('change request ↔ plan activities (NEW-D2-2)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 180_000);
  beforeEach(() => {
    viewer.role = 'director';
    viewer.name = 'Marie Lefebvre';
    viewer.canEdit = true;
    viewer.lang = 'en';
  });

  it('the seed links CR-008 to A1250 (the prototype hard-coded it on the activity)', async () => {
    expect((await linksOf('CR-008')).map((l) => [l.code, l.crStatus, l.newDurationDays, l.name])).toEqual([['A1250', 'in_review', null, 'Steel erection — Bays 3–4']]);
  });

  it('the form field links the activities with their new duration; bad or unknown codes refuse the whole request', async () => {
    expect(await createChangeRequestAction(HLT, form('A1250=='))).toEqual({ error: 'Enter activity codes such as A1250 or A1250=28' });
    expect(await createChangeRequestAction(HLT, form('A9999=3'))).toEqual({ error: 'Unknown activity A9999' });
    const before = (await getDb()).select({ n: changeRequests.number }).from(changeRequests);
    const n0 = (await before).length;
    const r = await createChangeRequestAction(HLT, form('A1420=30, A1430'));
    expect(r.toast).toMatch(/^CR-\d{3} · Change request submitted for review$/);
    const number = r.toast!.split(' · ')[0];
    expect((await (await getDb()).select({ n: changeRequests.number }).from(changeRequests)).length).toBe(n0 + 1);
    expect((await linksOf(number)).map((l) => [l.code, l.newDurationDays, l.crStatus])).toEqual([['A1420', 30, 'in_review'], ['A1430', null, 'in_review']]);
    // A client raising a request cannot name plan activities (the plan is internal).
    viewer.role = 'client';
    viewer.name = 'Claire Dubois';
    expect(await createChangeRequestAction(HLT, form('A1420'))).toEqual({ error: 'Only the project team links plan activities to a change request' });
  });

  it('the drawer adds, updates and removes links on open requests; rights and input are checked', async () => {
    const number = 'CR-008';
    expect(await linkCrActivityAction(HLT, number, { activity: 'A1260', days: '15' })).toEqual({ ok: true, toast: 'CR-008 · A1260 · Activity linked' });
    expect(await linkCrActivityAction(HLT, number, { activity: 'A1260', days: '12' })).toMatchObject({ ok: true });
    expect((await linksOf(number)).map((l) => [l.code, l.newDurationDays])).toEqual([['A1250', null], ['A1260', 12]]);
    expect(await linkCrActivityAction(HLT, number, { activity: 'A1260', days: '-2' })).toEqual({ error: 'Enter the new duration in working days' });
    expect(await linkCrActivityAction(HLT, number, { activity: '<x>' })).toEqual({ error: 'Choose an activity of the project plan' });
    expect(await linkCrActivityAction(HLT, number, { activity: 'A9999' })).toEqual({ error: 'Unknown activity A9999' });
    expect(await linkCrActivityAction(HLT, 'CR-1', { activity: 'A1260' })).toEqual({ error: 'Invalid request' });
    expect(await linkCrActivityAction(HLT, 'CR-999', { activity: 'A1260' })).toEqual({ error: 'Unknown change request' });
    expect(await linkCrActivityAction('NOPE-1', number, { activity: 'A1260' })).toEqual({ error: 'Invalid request' });
    // Read-only / outside viewers and the client are refused.
    viewer.canEdit = false;
    expect(await linkCrActivityAction(HLT, number, { activity: 'A1260' })).toEqual({ error: 'Only the project team links plan activities to a change request' });
    viewer.canEdit = true;
    viewer.role = 'client';
    expect(await unlinkCrActivityAction(HLT, number, 'A1260')).toEqual({ error: 'Only the project team links plan activities to a change request' });
    viewer.role = 'pm';
    viewer.name = 'Romain Aubert';
    viewer.lang = 'fr';
    expect(await unlinkCrActivityAction(HLT, number, 'A1260')).toEqual({ ok: true, toast: 'CR-008 · A1260 · Activité retirée de la demande' });
    expect(await unlinkCrActivityAction(HLT, number, 'A1260')).toEqual({ error: 'Cette activité n’est pas reliée à la demande' });
    // A decided request is frozen (CR-007 is approved in the seed).
    const decided = (await listCrActivityLinks(HLT)).length;
    expect(await linkCrActivityAction(HLT, 'CR-007', { activity: 'A1260' })).toEqual({ error: 'Une demande de modification décidée ne peut plus être modifiée' });
    expect((await listCrActivityLinks(HLT)).length).toBe(decided);
  });

  it('once the request is approved, the next Reschedule applies the new durations — once, audited', async () => {
    const db = await getDb();
    const r = await createChangeRequestAction(HLT, form('A1520=40'));
    const number = r.toast!.split(' · ')[0];
    const before = await duration('A1520');
    expect(before.pct).toBeLessThan(100);
    // Not approved yet: nothing applied.
    await rescheduleProject(HLT, 'Romain Aubert');
    expect((await duration('A1520')).d).toBe(before.d);
    // Approve the whole chain (the decision flow itself is tested with the Change control actions).
    const [cr] = await db.select({ id: changeRequests.id }).from(changeRequests).where(eq(changeRequests.number, number));
    await db.update(changeRequestSteps).set({ decision: 'ok' }).where(eq(changeRequestSteps.changeRequestId, cr.id));
    await db.update(changeRequests).set({ status: 'approved' }).where(eq(changeRequests.id, cr.id));
    const res = await rescheduleProject(HLT, 'Romain Aubert');
    expect(res).toMatchObject({ ok: true, appliedChanges: [{ cr: number, code: 'A1520', from: before.d, to: 40 }] });
    expect((await duration('A1520')).d).toBe(40);
    expect((await linksOf(number))[0]).toMatchObject({ code: 'A1520', crStatus: 'approved', appliedFromDays: before.d, newDurationDays: 40 });
    const [a] = await db.select().from(auditEntries).where(eq(auditEntries.objectRef, 'A1520')).orderBy(desc(auditEntries.occurredAt)).limit(1);
    expect(a.change).toBe(`duration ${before.d} d → 40 d · ${number} approved`);
    // Applied once: a later edit of the duration is not overwritten by the next Reschedule.
    const [act] = await db.select({ id: activities.id }).from(activities).where(eq(activities.code, 'A1520'));
    await db.update(activities).set({ durationDays: 35 }).where(eq(activities.id, act.id));
    const again = await rescheduleProject(HLT, 'Romain Aubert');
    expect(again.ok && again.appliedChanges).toBeFalsy();
    expect((await duration('A1520')).d).toBe(35);
  });
});
