// R-067 (S-12 a) and R-015 (task assigned): the tasks "Send minutes" creates — every internal owner, an external owner's action
// followed up by the stakeholder's relationship owner or the PM, the typed due, the line's plan activity — and the composer's
// Activity (minutes' writers only, the project's own plan) on the seeded in-memory database with the real project context:
// the 8 personas, malformed input, stale minutes; the client never sees the task numbers; the assignees are told, never the
// sender.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const session = { role: 'pm' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: () => {
    throw new Error('REDIRECT');
  },
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => 'HLT-026',
  };
});

import { and, eq } from 'drizzle-orm';
import { PERSONAS } from '@/config/personas';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activities, projects, stakeholders } from '@/server/db/schema';
import { addMeetingLine, createMeeting, getMeeting, listMeetings, sendMinutes } from '@/server/dal/meetings';
import { listNotifications } from '@/server/dal/notifications';
import { getTask } from '@/server/dal/tasks';
import { addMinutesLineAction } from './actions';
import { meetingsScreenView } from './model';

const HLT = 'HLT-026';
const WRITERS = 'Only the organiser or the project manager can write and send these minutes';
const READ_ONLY = 'These meetings are read-only for you';
const lineCount = async (n: string) => (await getMeeting(n))!.agenda.reduce((s, a) => s + a.lines.length, 0);
const assignedTo = async (role: string, n: string) => (await listNotifications(role)).filter((x) => x.kind === 'task' && x.title === `Task assigned · ${n}`);

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('R-067 — composer Activity (minutes’ writers, the project’s own plan)', () => {
  it('every persona: only the minutes’ writers (P-9b: the organiser A. Girard on MTG-119, the PM) link an action to an activity', async () => {
    for (const p of PERSONAS) {
      session.role = p.role;
      const before = await lineCount('MTG-119');
      const r = await addMinutesLineAction({ code: HLT, meeting: 'MTG-119', point: 0, type: 'action', text: `Check from ${p.role}`, owner: 'J. Wagner', due: '2 Oct', activity: 'A1250' });
      if (['pm', 'englead'].includes(p.role)) {
        expect(r, `${p.role} ${JSON.stringify(r)}`).toEqual({ ok: true });
        expect(await lineCount('MTG-119'), p.role).toBe(before + 1);
        const line = (await getMeeting('MTG-119'))!.agenda[0].lines.at(-1)!;
        expect([line.text, line.activity], p.role).toEqual([`Check from ${p.role}`, 'A1250']);
      } else {
        expect(r.ok, p.role).toBe(false);
        expect([WRITERS, READ_ONLY], p.role).toContain((r as { error: string }).error);
        expect(await lineCount('MTG-119'), p.role).toBe(before);
      }
    }
  });

  it('malformed or foreign activity refused (another project’s plan, unknown code, bad shape); a note without activity still works', async () => {
    session.role = 'pm';
    const db = await getDb();
    const [ndc] = await db.select({ code: activities.code }).from(activities).innerJoin(projects, eq(projects.id, activities.projectId)).where(eq(projects.code, 'NDC-031')).limit(1);
    const before = await lineCount('MTG-119');
    for (const activity of [ndc.code, 'A9999', 'A1250; drop table activities'])
      expect(await addMinutesLineAction({ code: HLT, meeting: 'MTG-119', point: 0, type: 'action', text: 'X', activity })).toEqual({ ok: false, error: 'Unknown activity' });
    session.lang = 'fr';
    expect(await addMinutesLineAction({ code: HLT, meeting: 'MTG-119', point: 0, type: 'action', text: 'X', activity: 'A9999' })).toEqual({ ok: false, error: 'Activité inconnue' });
    session.lang = 'en';
    expect(await lineCount('MTG-119')).toBe(before);
    // The writer re-checks: another project's activity is refused even when called directly.
    await expect(addMeetingLine('MTG-119', 0, { type: 'action', text: 'Direct', activity: ndc.code }, 'Romain Aubert')).rejects.toThrow('Unknown activity');
    expect(await addMinutesLineAction({ code: HLT, meeting: 'MTG-119', point: 0, type: 'action', text: 'Without activity', owner: 'J. Wagner' })).toEqual({ ok: true });
  });
});

describe('R-067 — "Send minutes" tasks (S-12 a) and R-015 notices', () => {
  let number = '';
  it('sent minutes: internal owner, follow-ups for external owners (stakeholder owner, else PM), typed due kept, activity carried', async () => {
    const db = await getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, HLT));
    // A stakeholder without relationship owner → the PM.
    await db.update(stakeholders).set({ ownerPersonId: null }).where(and(eq(stakeholders.projectId, p.id), eq(stakeholders.name, 'DREAL Normandie')));
    number = await createMeeting(HLT, { title: 'Follow-up check', type: 'external', series: 'one_off', date: '2026-09-28', invitees: ['R. Aubert', 'N. Bensaïd', 'J. Wagner'], agenda: ['Actions'] }, 'Romain Aubert');
    const lines: [string, string, string, string?][] = [
      ['Confirm the HV cell date', 'N. Bensaïd', '10 Oct'],
      ['Send the FAT protocol', 'K. Lindqvist (Nordvolt)', '—'],
      ['Share the noise survey', 'DREAL Normandie', '5 Oct'],
      ['Call back about the permit', 'Somebody External (Acme)', ''],
      ['Electrode oven on site', 'J. Wagner', '—', 'A1250'],
      ['Weld inspection report', 'H. Sauvage', '20 Sep'],
    ];
    for (const [text, owner, due, activity] of lines) await addMeetingLine(number, 0, { type: 'action', text, owner, due, activity }, 'Romain Aubert');
    const before = { pm: (await listNotifications('pm')).length };
    const sent = await sendMinutes(number, 'Romain Aubert');
    expect(sent.tasks).toHaveLength(6);
    const t = await Promise.all(sent.tasks.map(async (n) => (await getTask(n))!));
    expect(t.map((x) => [x.assignee, x.title, x.labels, x.start, x.due, x.activity?.code ?? null])).toEqual([
      ['Romain Aubert', 'Confirm the HV cell date — N. Bensaïd', ['Meeting', number, 'Follow-up'], '2026-09-25', '2026-10-10', null],
      ['Fabien Bertrand', 'Send the FAT protocol — K. Lindqvist (Nordvolt)', ['Meeting', number, 'Follow-up'], '2026-09-25', '2026-09-30', null],
      ['Romain Aubert', 'Share the noise survey — DREAL Normandie', ['Meeting', number, 'Follow-up'], '2026-09-25', '2026-10-05', null],
      ['Romain Aubert', 'Call back about the permit — Somebody External (Acme)', ['Meeting', number, 'Follow-up'], '2026-09-25', '2026-09-30', null],
      ['Julien Wagner', 'Electrode oven on site', ['Meeting', number], '2026-09-25', '2026-09-30', 'A1250'],
      // The typed due is kept even when past (S-12 a "reprend l'échéance saisie"); the task then starts on it.
      ['Hélène Sauvage', 'Weld inspection report', ['Meeting', number], '2026-09-20', '2026-09-20', null],
    ]);
    // R-015: the assignees are told once, never the sender (R. Aubert's three follow-ups).
    expect(await assignedTo('procurement', sent.tasks[1])).toHaveLength(1);
    expect(await assignedTo('member', sent.tasks[4])).toHaveLength(1);
    expect((await listNotifications('pm')).length).toBe(before.pm);
    // Lines link to their tasks; the action line keeps its activity.
    const m = (await getMeeting(number))!;
    expect(m.agenda[0].lines.map((l) => l.taskNumber)).toEqual(sent.tasks);
    expect(m.agenda[0].lines[4].activity).toBe('A1250');
  });

  it('the client never sees the internal task numbers of an external meeting; the team does', async () => {
    const ms = await listMeetings(HLT);
    const q = { view: 'meetings' as const, filter: 'all' as const, meeting: number };
    const team = meetingsScreenView({ code: HLT, meetings: ms, questions: [], query: q }, makeT('en'), 'en');
    const client = meetingsScreenView({ code: HLT, meetings: ms, questions: [], query: q, client: true }, makeT('en'), 'en');
    expect(team.detail!.agenda[0].lines.every((l) => l.taskNumber && l.taskHref)).toBe(true);
    expect(team.detail!.agenda[0].lines[4].meta).toBe('J. Wagner · — · A1250');
    expect(client.detail!.agenda[0].lines.every((l) => l.taskNumber === null && l.taskHref === null)).toBe(true);
    expect(client.detail!.agenda[0].lines[4].meta).toBe('J. Wagner · —');
    expect(client.actions.every((a) => a.taskHref === null)).toBe(true);
  });

  it('stale: the minutes already sent refuse a new line, with or without activity', async () => {
    session.role = 'pm';
    expect(await addMinutesLineAction({ code: HLT, meeting: number, point: 0, type: 'action', text: 'Late', activity: 'A1250' })).toEqual({ ok: false, error: 'Minutes already sent' });
  });
});
