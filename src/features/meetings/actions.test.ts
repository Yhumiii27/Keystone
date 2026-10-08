// Meetings & minutes Server Functions against an in-memory database: permission gate (outside / read-only project
// refused server-side), meeting ↔ project check, input validation, writes with the viewer as the actor, toasts in
// EN and FR (New meeting, Send minutes). Session and project context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Romain Aubert', canEdit: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name }, canEdit: () => viewer.canEdit }),
}));

import { revalidatePath } from 'next/cache';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getMeeting } from '@/server/dal/meetings';
import { listAudit } from '@/server/dal/notifications';
import { listTasks } from '@/server/dal/tasks';
import {
  addMinutesLineAction, analyseTranscriptAction, applyTranscriptAction, createMeetingAction, sendMinutesAction, toggleMeetingActionAction,
} from './actions';

const NEW = { title: 'Weekly site meeting #25', type: 'internal', series: 'weekly_site', date: '6 oct. 2026', time: '8:30', loc: '', invited: 'R. Aubert, L. Fabre, J. Wagner', agenda: 'Safety\nSteel' };

describe('meetings Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    Object.assign(viewer, { name: 'Romain Aubert', canEdit: true, lang: 'en' });
    vi.mocked(revalidatePath).mockClear();
  });

  it('refuses read-only viewers, unknown projects and meetings of another project — nothing is written', async () => {
    viewer.canEdit = false;
    const ro = { ok: false, error: 'These meetings are read-only for you' };
    expect(await createMeetingAction('HLT-026', NEW)).toEqual({ error: 'These meetings are read-only for you' });
    expect(await addMinutesLineAction({ code: 'HLT-026', meeting: 'MTG-118', point: 0, type: 'info', text: 'x' })).toEqual(ro);
    expect(await toggleMeetingActionAction({ code: 'HLT-026', meeting: 'MTG-118', point: 0, position: 1 })).toEqual(ro);
    expect(await analyseTranscriptAction({ code: 'HLT-026', meeting: 'MTG-119' })).toEqual(ro);
    expect(await applyTranscriptAction({ code: 'HLT-026', meeting: 'MTG-119' })).toEqual(ro);
    expect(await sendMinutesAction({ code: 'HLT-026', meeting: 'MTG-118' })).toEqual(ro);
    viewer.lang = 'fr';
    expect(await sendMinutesAction({ code: 'HLT-026', meeting: 'MTG-118' })).toEqual({ ok: false, error: 'Ces réunions sont en consultation pour vous' });
    viewer.canEdit = true;
    viewer.lang = 'en';
    expect(await createMeetingAction('NOPE-000', NEW)).toEqual({ error: 'Unknown project' });
    expect(await sendMinutesAction({ code: 'NDC-031', meeting: 'MTG-118' })).toEqual({ ok: false, error: 'Unknown meeting' });
    expect(await sendMinutesAction({ code: 'HLT-026', meeting: "MTG-118'; drop" })).toEqual({ ok: false, error: 'Unknown meeting' });
    expect(await sendMinutesAction(null as never)).toEqual({ ok: false, error: 'Invalid request' });
    expect((await getMeeting('MTG-118'))!.status).toBe('notes_in_progress');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('ticks: actions only, known lines only; the viewer in the audit trail', async () => {
    expect(await toggleMeetingActionAction({ code: 'HLT-026', meeting: 'MTG-118', point: 0, position: 0 })).toEqual({ ok: false, error: 'Only actions can be ticked' });
    expect(await toggleMeetingActionAction({ code: 'HLT-026', meeting: 'MTG-118', point: 9, position: 0 })).toEqual({ ok: false, error: 'Unknown agenda point' });
    expect(await toggleMeetingActionAction({ code: 'HLT-026', meeting: 'MTG-118', point: 0, position: -1 })).toEqual({ ok: false, error: 'Unknown agenda point' });
    expect(await toggleMeetingActionAction({ code: 'HLT-026', meeting: 'MTG-118', point: 0, position: 1 })).toEqual({ ok: true, done: true });
    expect(await toggleMeetingActionAction({ code: 'HLT-026', meeting: 'MTG-118', point: 0, position: 1 })).toEqual({ ok: true, done: false });
    expect((await listAudit())[0]).toMatchObject({ who: 'Romain Aubert', object: 'MTG-118' });
    expect(revalidatePath).toHaveBeenCalledWith('/projects/HLT-026', 'layout');
  });

  it('composer: validation, owner defaults to the organizer, typed French date normalised, Scheduled → Notes in progress', async () => {
    expect(await addMinutesLineAction({ code: 'HLT-026', meeting: 'MTG-119', point: 0, type: 'info', text: '  ' })).toEqual({ ok: false, error: 'Write a note first' });
    expect(await addMinutesLineAction({ code: 'HLT-026', meeting: 'MTG-119', point: 0, type: 'memo', text: 'x' })).toEqual({ ok: false, error: 'Invalid note type' });
    expect(await addMinutesLineAction({ code: 'HLT-026', meeting: 'MTG-119', point: 3, type: 'info', text: 'x' })).toEqual({ ok: false, error: 'Unknown agenda point' });
    expect(await addMinutesLineAction({ code: 'HLT-026', meeting: 'MTG-119', point: 1, type: 'action', text: 'Map the status word', owner: '', due: '2 oct.' })).toEqual({ ok: true });
    const m = (await getMeeting('MTG-119'))!;
    expect(m.status).toBe('notes_in_progress');
    expect(m.agenda[1].lines[0]).toMatchObject({ type: 'action', text: 'Map the status word', owner: 'A. Girard', due: '2 Oct', dueDate: '2026-10-02', done: false });
  });

  it('transcript: analyse first, then add to the minutes once; a meeting without transcript is refused', async () => {
    expect(await applyTranscriptAction({ code: 'HLT-026', meeting: 'MTG-119' })).toEqual({ ok: false, error: 'Analyse the transcript first' });
    expect(await analyseTranscriptAction({ code: 'HLT-026', meeting: 'MTG-118' })).toEqual({ ok: false, error: 'This meeting has no transcript' });
    expect(await analyseTranscriptAction({ code: 'HLT-026', meeting: 'MTG-119' })).toEqual({ ok: true });
    expect(await applyTranscriptAction({ code: 'HLT-026', meeting: 'MTG-119' })).toEqual({ ok: true });
    const m = (await getMeeting('MTG-119'))!;
    expect(m.transcript).toMatchObject({ analysed: true, applied: true });
    expect(m.agenda[2].lines.map((l) => l.type)).toEqual(['decision', 'decision', 'decision', 'action', 'action', 'action']);
  });

  it('"Send minutes": MIN-HLT-027, tasks for the pool owners, toast EN / FR, then the minutes are locked', async () => {
    expect(await sendMinutesAction({ code: 'HLT-026', meeting: 'MTG-118' })).toEqual({ ok: true, toast: 'MIN-HLT-027 · minutes sent to 5 invitees · 2 actions added to tasks' });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect((await listTasks({ person: 'Julien Wagner' })).some((t) => t.labels.includes('MTG-118'))).toBe(true);
    expect(await sendMinutesAction({ code: 'HLT-026', meeting: 'MTG-118' })).toEqual({ ok: false, error: 'Minutes already sent' });
    expect(await addMinutesLineAction({ code: 'HLT-026', meeting: 'MTG-118', point: 0, type: 'info', text: 'late' })).toEqual({ ok: false, error: 'Minutes already sent' });
    // Actions of sent minutes can still be ticked (Actions register).
    expect(await toggleMeetingActionAction({ code: 'HLT-026', meeting: 'MTG-118', point: 0, position: 1 })).toEqual({ ok: true, done: true });
    viewer.lang = 'fr';
    viewer.name = 'Sophie Perrin';
    expect(await sendMinutesAction({ code: 'NDC-031', meeting: 'MTG-121' })).toMatchObject({ ok: true, toast: expect.stringMatching(/^MIN-NDC-025 · CR envoyé à 3 conviés · \d action/) });
  });

  it('"New meeting": MTG-130 organized by the viewer, defaults, toast; validation errors translated', async () => {
    viewer.name = 'Marie Lefebvre';
    expect(await createMeetingAction('HLT-026', NEW)).toEqual({ toast: 'Weekly site meeting #25 · Meeting created · invitation synced to the calendar' });
    const m = (await getMeeting('MTG-130'))!;
    expect(m).toMatchObject({ status: 'scheduled', organizer: 'M. Lefebvre', dateText: '6 Oct 2026', time: '08:30', location: 'Teams', durationText: '1 h' });
    expect(m.agenda.map((a) => a.title)).toEqual(['Safety', 'Steel']);
    expect(await createMeetingAction('HLT-026', { ...NEW, date: '31 Sep' })).toEqual({ error: 'Enter a valid date (e.g. 6 Oct 2026)' });
    expect(await createMeetingAction('HLT-026', { ...NEW, invited: ' ' })).toEqual({ error: 'Invite at least one person' });
    expect(await createMeetingAction('HLT-026', { ...NEW, title: 42 } as never)).toEqual({ error: 'Title is required' });
    viewer.lang = 'fr';
    expect(await createMeetingAction('HLT-026', { ...NEW, title: 'Revue', agenda: '' })).toEqual({ toast: 'Revue · Réunion créée · invitation synchronisée avec le calendrier' });
    expect(await createMeetingAction('HLT-026', { ...NEW, type: 'secret' })).toEqual({ error: 'Type de réunion invalide' });
  });

  it('a meeting created without agenda: the first note opens point 1, titled like the meeting', async () => {
    expect(await addMinutesLineAction({ code: 'HLT-026', meeting: 'MTG-131', point: 1, type: 'info', text: 'x' })).toEqual({ ok: false, error: 'Unknown agenda point' });
    expect(await addMinutesLineAction({ code: 'HLT-026', meeting: 'MTG-131', point: 0, type: 'decision', text: 'Go' })).toEqual({ ok: true });
    const m = (await getMeeting('MTG-131'))!;
    expect(m.agenda).toMatchObject([{ position: 0, title: 'Revue', lines: [{ type: 'decision', text: 'Go' }] }]);
    expect(m.status).toBe('notes_in_progress');
  });

  it('"Send minutes": no read receipt for the organizer, even when invited under his full name', async () => {
    viewer.name = 'Romain Aubert';
    expect(await createMeetingAction('HLT-026', { ...NEW, title: 'Crane erection briefing', invited: 'Romain Aubert, L. Fabre', agenda: '' })).toMatchObject({ toast: expect.any(String) });
    const created = (await getMeeting('MTG-132'))!;
    expect(created).toMatchObject({ title: 'Crane erection briefing', organizer: 'R. Aubert' });
    expect(await sendMinutesAction({ code: 'HLT-026', meeting: 'MTG-132' })).toEqual({ ok: true, toast: 'MIN-HLT-028 · minutes sent to 2 invitees · 0 actions added to tasks' });
    const sent = (await getMeeting('MTG-132'))!;
    expect(sent.participants.map((p) => [p.name, p.minutesRecipient])).toEqual([['Romain Aubert', false], ['L. Fabre', true]]);
  });
});
