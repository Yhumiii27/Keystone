// R-198 — Server Functions of the interactive Gantt against an in-memory database (HLT-026, data date 25 Sep 2026): rights (the
// project's PMs and the director on a Schedule they may edit; never the client, a read-only project or a role reading the
// Schedule only), validation (actual dates, milestones, bad input, loops), the writes with their audit rows and activity events,
// and the immediate recalculation (the stored dates are the CPM's right after the edit).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { role: 'pm' as string, name: 'Romain Aubert', plan: true, schedule: true, lead: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', async () => {
  const { getProject } = await import('@/server/dal/projects');
  return {
    getProjectContext: async (code: string) => ({
      project: await getProject(code), viewer: { role: viewer.role, name: viewer.name, short: viewer.name, personId: null },
      canEdit: (s?: string) => (s === 'schedule' ? viewer.schedule : viewer.plan), isMine: true, isLead: viewer.lead,
    }),
  };
});

import { getGanttNetwork } from '@/server/dal/gantt';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { ganttAddLinkAction, ganttEditActivityAction, ganttEditLinkAction, ganttRemoveLinkAction } from './gantt-actions';

const STRUCTURE = { error: 'Only the project manager or the director can change the plan structure — you can update the progress of your own activities' };
const READ_ONLY = { error: 'This schedule is read-only for you' };
const net = async () => (await getGanttNetwork('HLT-026'))!;
/** The activity as the Gantt reads it; its R-010 token keeps the version only (the read time differs between reads). */
const act = async (id: string) => {
  const a = (await net()).activities.find((x) => x.id === id)!;
  return { ...a, version: a.version?.split('.')[0] };
};
const links = async () => (await net()).links.map((l) => `${l.pred}>${l.succ} ${l.type}${l.lag}`);

describe('Gantt Server Functions (R-198)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => Object.assign(viewer, { role: 'pm', name: 'Romain Aubert', plan: true, schedule: true, lead: true, lang: 'en' }));

  it('rights: the project’s PMs and the director; read-only outside the workspace, on a read-only project, for the client', async () => {
    const before = await act('A1330');
    Object.assign(viewer, { role: 'englead', name: 'Antoine Girard', lead: false });
    expect(await ganttEditActivityAction('HLT-026', 'A1330', { start: '2026-12-01' })).toEqual(STRUCTURE);
    expect(await ganttAddLinkAction('HLT-026', { pred: 'A1330', succ: 'A1520' })).toEqual(STRUCTURE);
    expect(await ganttEditLinkAction('HLT-026', { pred: 'A1320', succ: 'A1330', type: 'SS' })).toEqual(STRUCTURE);
    expect(await ganttRemoveLinkAction('HLT-026', 'A1320', 'A1330')).toEqual(STRUCTURE);
    Object.assign(viewer, { role: 'pm', name: 'Romain Aubert', lead: true, plan: false });
    expect(await ganttEditActivityAction('HLT-026', 'A1330', { start: '2026-12-01' })).toEqual(READ_ONLY);
    // The Schedule read only (Logistics, R-158), the Plan editable: still refused.
    Object.assign(viewer, { plan: true, schedule: false });
    expect(await ganttEditActivityAction('HLT-026', 'A1330', { start: '2026-12-01' })).toEqual(READ_ONLY);
    Object.assign(viewer, { role: 'client', name: 'Nadia Bensaïd', schedule: true });
    expect(await ganttEditActivityAction('HLT-026', 'A1330', { start: '2026-12-01' })).toEqual(READ_ONLY);
    Object.assign(viewer, { role: 'pm', name: 'Romain Aubert' });
    expect(await ganttEditActivityAction('NOPE-1', 'A1330', { start: '2026-12-01' })).toEqual({ error: 'Invalid request' });
    expect(await act('A1330')).toEqual(before);
  });

  it('validation: actual dates, milestones, unknown activities, bad dates and durations', async () => {
    expect(await ganttEditActivityAction('HLT-026', 'A1250', { start: '2026-12-01' })).toEqual({ error: 'This activity has started: its start is actual' });
    expect(await ganttEditActivityAction('HLT-026', 'A1010', { start: '2026-12-01' })).toEqual({ error: 'This activity is complete: its dates are actual' });
    expect(await ganttEditActivityAction('HLT-026', 'A1010', { duration: '50' })).toEqual({ error: 'This activity is complete: its dates are actual' });
    expect(await ganttEditActivityAction('HLT-026', 'A9999', { duration: '5' })).toEqual({ error: 'Invalid request' });
    expect(await ganttEditActivityAction('HLT-026', 'A1330', { start: '1 Dec 2026' })).toEqual({ error: 'Enter a valid start date' });
    expect(await ganttEditActivityAction('HLT-026', 'A1330', { duration: '0' })).toEqual({ error: 'The duration is a whole number of working days between 1 and 9999' });
    expect(await ganttEditActivityAction('HLT-026', 'A1330', { duration: '15' })).toEqual({ ok: true, toast: 'A1330 · No change' });
    viewer.lang = 'fr';
    expect(await ganttEditActivityAction('HLT-026', 'A1250', { start: '2026-12-01' })).toEqual({ error: 'Cette activité a commencé : son début est réel' });
  });

  it('move: a "Start no earlier than" constraint, audited and on the activity feed; the CPM dates the network at once', async () => {
    const r = await ganttEditActivityAction('HLT-026', 'A1330', { start: '2026-11-28' });
    // Sat 28 Nov → Mon 30 Nov 2026.
    expect(r).toMatchObject({ ok: true });
    expect('toast' in r && r.toast).toMatch(/^A1330 · Activity moved · Rescheduled at 25 Sep 2026 · finish .+ · \d+ activit(y|ies) changed$/);
    const a = await act('A1330');
    expect([a.constraint, a.startDate, a.finishDate]).toEqual([{ type: 'SNET', date: '2026-11-30' }, '2026-11-30', '2026-12-18']);
    // Its successor A1610 (FS) cannot start before 21 Dec.
    expect((await act('A1610')).startDate! >= '2026-12-21').toBe(true);
    const audit = (await listAudit({ projectCode: 'HLT-026', limit: 5 })).find((x) => x.object === 'A1330')!;
    expect([audit.area, audit.change, audit.before, audit.after]).toEqual([
      'Planning', 'Gantt edit: constraint ASAP → SNET 2026-11-30', { constraint: null }, { constraint: { type: 'SNET', date: '2026-11-30' } },
    ]);
    const feed = (await listActivity({ limit: 5 })).find((x) => x.messageKey === 'gantt.moved')!;
    expect([feed.what, feed.messageParams, feed.projectCode]).toEqual([
      'Moved A1330 on the Gantt · start no earlier than 2026-11-30', { activity: 'A1330', date: '2026-11-30' }, 'HLT-026',
    ]);
    // The Reschedule run is audited too.
    expect((await listAudit({ projectCode: 'HLT-026', limit: 5 })).some((x) => x.change.startsWith('rescheduled at 2026-09-25'))).toBe(true);
  });

  it('duration and removal of the constraint', async () => {
    expect(await ganttEditActivityAction('HLT-026', 'A1520', { duration: '30' })).toMatchObject({ ok: true });
    expect((await act('A1520')).duration).toBe(30);
    const audit = (await listAudit({ projectCode: 'HLT-026', limit: 5 })).find((x) => x.object === 'A1520')!;
    expect([audit.change, audit.before, audit.after]).toEqual(['Gantt edit: duration 25 → 30 d', { durationDays: 25 }, { durationDays: 30 }]);
    expect((await listActivity({ limit: 5 })).find((x) => x.messageKey === 'gantt.durationChanged')?.messageParams).toEqual({ activity: 'A1520', days: 30 });
    expect(await ganttEditActivityAction('HLT-026', 'A1320', { clearConstraint: true })).toMatchObject({ ok: true, toast: expect.stringMatching(/^A1320 · Date constraint removed · /) });
    expect((await act('A1320')).constraint).toBeNull();
    // A milestone-free in-progress activity may change its duration, not its start.
    expect(await ganttEditActivityAction('HLT-026', 'A1410', { duration: '45' })).toMatchObject({ ok: true });
  });

  it('relationships: add (loops refused), change type and lag, remove — audited, rescheduled', async () => {
    expect(await ganttAddLinkAction('HLT-026', { pred: 'A1620', succ: 'A1010' })).toEqual({
      error: 'This relationship would create a logic loop: A1010 → A1020 → A1110 → A1120 → A1130 → A1220 → A1250 → A1260 → A1430 → A1610 → A1620 → A1010',
    });
    expect(await ganttAddLinkAction('HLT-026', { pred: 'A1320', succ: 'A1330' })).toEqual({ error: 'This relationship already exists' });
    expect(await ganttAddLinkAction('HLT-026', { pred: 'A1330', succ: 'A1330' })).toEqual({ error: 'An activity cannot be linked to itself' });
    expect(await ganttAddLinkAction('HLT-026', { pred: 'A1330', succ: 'A1520', type: 'XX' })).toEqual({ error: 'Unknown relationship type' });
    expect(await ganttAddLinkAction('HLT-026', { pred: 'A1330', succ: 'A1520', lag: '1000' })).toEqual({ error: 'The lag is a whole number of working days between −999 and 999' });
    expect(await ganttAddLinkAction('HLT-026', { pred: 'A1330', succ: 'nope' })).toEqual({ error: 'Choose an activity' });

    const added = await ganttAddLinkAction('HLT-026', { pred: 'A1330', succ: 'A1520' });
    expect(added).toMatchObject({ ok: true, toast: expect.stringMatching(/^A1330 FS → A1520 · Relationship added · Rescheduled at /) });
    expect(await links()).toContain('A1330>A1520 FS0');
    // A1520 now follows A1330 (finish 18 Dec): it starts on 21 Dec at the earliest.
    expect((await act('A1520')).startDate! >= '2026-12-21').toBe(true);

    expect(await ganttEditLinkAction('HLT-026', { pred: 'A1330', succ: 'A1520', type: 'SS', lag: '−2' })).toMatchObject({ ok: true });
    expect(await links()).toContain('A1330>A1520 SS-2');
    const audit = (await listAudit({ projectCode: 'HLT-026', limit: 5 })).find((x) => x.change.startsWith('relationship changed'))!;
    expect([audit.change, audit.before, audit.after]).toEqual(['relationship changed: A1330 FS → SS-2 → A1520', { type: 'FS', lag: 0 }, { type: 'SS', lag: -2 }]);
    expect(await ganttEditLinkAction('HLT-026', { pred: 'A1330', succ: 'A1420', type: 'SS' })).toEqual({ error: 'This relationship no longer exists' });

    expect(await ganttRemoveLinkAction('HLT-026', 'A1330', 'A1520')).toMatchObject({ ok: true, toast: expect.stringMatching(/^A1330 → A1520 · Relationship removed · /) });
    expect(await links()).not.toContain('A1330>A1520 SS-2');
    expect(await ganttRemoveLinkAction('HLT-026', 'A1330', 'A1520')).toEqual({ error: 'This relationship no longer exists' });
    expect((await listActivity({ limit: 10 })).filter((x) => x.messageKey?.startsWith('gantt.link')).map((x) => x.what)).toEqual([
      'Removed the link A1330 → A1520 on the Gantt', 'Changed the link A1330 → A1520 on the Gantt · SS−2', 'Linked A1330 → A1520 on the Gantt · FS',
    ]);
  });

  it('R-010: a bar dragged on a Gantt read before someone else changed the activity is refused (who and when); the editor\'s own second drag passes', async () => {
    const read = (await net()).activities.find((x) => x.id === 'A1520')!.version!;
    Object.assign(viewer, { role: 'pm', name: 'Romain Aubert' });
    expect(await ganttEditActivityAction('HLT-026', 'A1520', { duration: '12', version: read })).toMatchObject({ ok: true });
    // Romain drags it again before his page refreshed: his own change, saved.
    expect(await ganttEditActivityAction('HLT-026', 'A1520', { duration: '13', version: read })).toMatchObject({ ok: true });
    // Marie's Gantt was read before both.
    Object.assign(viewer, { role: 'director', name: 'Marie Lefebvre' });
    const r = await ganttEditActivityAction('HLT-026', 'A1520', { duration: '20', version: read });
    expect(r).toEqual({ error: expect.stringMatching(/^Record modified meanwhile by Romain Aubert on .+ — reload to see their changes$/), conflict: true });
    expect((await act('A1520')).duration).toBe(13);
    // A Reschedule (CPM dates only) never makes the Gantt stale.
    const fresh = (await net()).activities.find((x) => x.id === 'A1520')!.version!;
    await ganttEditActivityAction('HLT-026', 'A1330', { duration: '4', version: (await net()).activities.find((x) => x.id === 'A1330')!.version! });
    expect(await ganttEditActivityAction('HLT-026', 'A1520', { duration: '14', version: fresh })).toMatchObject({ ok: true });
  });
});
