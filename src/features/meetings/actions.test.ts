// Meetings & minutes Server Functions against an in-memory database: permission gate (outside / read-only project
// refused server-side), meeting ↔ project check, input validation, writes with the viewer as the actor, toasts in
// EN and FR (New meeting, Send minutes). Session and project context are mocked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// `pm` = the viewer is one of the project's PMs (R-041 access.pm); P-9b: the organiser and the PM write and send the minutes.
const viewer = { name: 'Romain Aubert', short: 'R. Aubert', role: 'pm', pm: true, canEdit: true, canEditRisks: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({
    viewer: { name: viewer.name, short: viewer.short, role: viewer.role, personId: null }, access: { pm: viewer.pm },
    canEdit: (screen?: string) => (screen === 'risks' ? viewer.canEditRisks : viewer.canEdit),
  }),
}));

import { revalidatePath } from 'next/cache';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getMeeting } from '@/server/dal/meetings';
import { listAudit } from '@/server/dal/notifications';
import { listClientQuestions } from '@/server/dal/meetings';
import { listRisks } from '@/server/dal/risks';
import { listTasks } from '@/server/dal/tasks';
import { setFilesRoot } from '@/server/storage/files';
import {
  addMinutesLineAction, addProposalQuestionAction, addProposalRiskAction, analyseTranscriptAction, applyTranscriptAction, createMeetingAction, editProposalAction,
  importTranscriptAction, reviewProposalAction, sendMinutesAction, toggleMeetingActionAction,
} from './actions';

const NEW = { title: 'Weekly site meeting #25', type: 'internal', series: 'weekly_site', date: '6 oct. 2026', time: '8:30', loc: '', invited: 'R. Aubert, L. Fabre, J. Wagner', agenda: 'Safety\nSteel' };

describe('meetings Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    Object.assign(viewer, { name: 'Romain Aubert', short: 'R. Aubert', role: 'pm', pm: true, canEdit: true, canEditRisks: true, lang: 'en' });
    vi.mocked(revalidatePath).mockClear();
  });

  it('P-9b (R-050): the internal team adds notes and ticks actions; the organiser and the project’s PM write and send; the client reads', async () => {
    const WRITERS = { ok: false, error: 'Only the organiser or the project manager can write and send these minutes' };
    // Julien Wagner, on the team but neither organiser nor PM: a note yes, the transcript and the sending no.
    Object.assign(viewer, { name: 'Julien Wagner', short: 'J. Wagner', role: 'member', pm: false });
    expect(await addMinutesLineAction({ code: 'HLT-026', meeting: 'MTG-118', point: 0, type: 'info', text: 'Crane inspection booked' })).toEqual({ ok: true });
    expect(await sendMinutesAction({ code: 'HLT-026', meeting: 'MTG-118' })).toEqual(WRITERS);
    expect(await analyseTranscriptAction({ code: 'HLT-026', meeting: 'MTG-119' })).toEqual(WRITERS);
    expect(await applyTranscriptAction({ code: 'HLT-026', meeting: 'MTG-119' })).toEqual(WRITERS);
    expect(await reviewProposalAction({ code: 'HLT-026', meeting: 'MTG-119', position: 0, status: 'rejected' })).toEqual(WRITERS);
    viewer.lang = 'fr';
    expect(await sendMinutesAction({ code: 'HLT-026', meeting: 'MTG-118' })).toEqual({ ok: false, error: 'Seuls l’organisateur et le chef de projet rédigent et envoient ce compte rendu' });
    viewer.lang = 'en';
    // Antoine Girard organised MTG-119 (not MTG-118): he writes its minutes only.
    Object.assign(viewer, { name: 'Antoine Girard', short: 'A. Girard', role: 'englead', pm: false });
    expect(await sendMinutesAction({ code: 'HLT-026', meeting: 'MTG-118' })).toEqual(WRITERS);
    expect(await analyseTranscriptAction({ code: 'HLT-026', meeting: 'MTG-119', engine: 'claude' })).toEqual({ ok: false, error: 'Claude is not configured (ANTHROPIC_API_KEY)' });
    // The client reads: no meeting, no note.
    Object.assign(viewer, { name: 'Nadia Bensaïd', short: 'N. Bensaïd', role: 'client', pm: false });
    expect(await createMeetingAction('HLT-026', NEW)).toEqual({ error: 'These meetings are read-only for you' });
    expect(await addMinutesLineAction({ code: 'HLT-026', meeting: 'MTG-118', point: 0, type: 'info', text: 'x' })).toEqual({ ok: false, error: 'These meetings are read-only for you' });
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
    // S-10: a real analysis (local rules under Vitest) — its toast gives the analyser and the counts.
    expect(await analyseTranscriptAction({ code: 'HLT-026', meeting: 'MTG-119' })).toEqual({ ok: true, toast: 'Transcript analysed (local rules) · 3 decisions · 3 actions' });
    expect(await applyTranscriptAction({ code: 'HLT-026', meeting: 'MTG-119' })).toEqual({ ok: true });
    const m = (await getMeeting('MTG-119'))!;
    expect(m.transcript).toMatchObject({ analysed: true, applied: true });
    expect(m.agenda[2].lines.map((l) => l.type)).toEqual(['decision', 'decision', 'decision', 'action', 'action', 'action']);
  });

  it('"Send minutes": MIN-HLT-027, a task for every internal action owner, toast EN / FR, then the minutes are locked', async () => {
    // S-12 a (R-067): L. Fabre (internal, outside the resource pool) gets a task too — 2 → 3 actions added to tasks.
    expect(await sendMinutesAction({ code: 'HLT-026', meeting: 'MTG-118' })).toEqual({ ok: true, toast: 'MIN-HLT-027 · minutes sent to 5 invitees · 3 actions added to tasks' });
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

describe('transcript Server Functions (chapter 4, S-10)', () => {
  let dir = '';
  const form = (fields: Record<string, string | File>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const TEXT = 'R. Aubert: We agreed to keep the night shift.\nJ. Wagner: I will update the access plan by 2 October.\nL. Fabre: There is a risk the crane arrives late. Can the client confirm the exclusion zone?';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-mtg-actions-'));
    setFilesRoot(dir); // uploaded transcripts never land in ./.data
  });
  afterAll(() => {
    setFilesRoot(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    Object.assign(viewer, { name: 'Romain Aubert', canEdit: true, canEditRisks: true, lang: 'en' });
  });

  it('import: rights, nothing to import, file type, paste, file (replace, FR toast), minutes sent', async () => {
    viewer.canEdit = false;
    expect(await importTranscriptAction(form({ code: 'HLT-026', meeting: 'MTG-130', text: TEXT }))).toEqual({ ok: false, error: 'These meetings are read-only for you' });
    viewer.canEdit = true;
    expect(await importTranscriptAction({} as never)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await importTranscriptAction(form({ code: 'HLT-026', meeting: 'MTG-130', text: '  ' }))).toEqual({ ok: false, error: 'Paste the transcript or choose a file' });
    expect(await importTranscriptAction(form({ code: 'HLT-026', meeting: 'MTG-130', file: new File(['x'], 'notes.docx') }))).toEqual({ ok: false, error: 'File type not accepted' });
    expect(await importTranscriptAction(form({ code: 'HLT-026', meeting: 'MTG-118', text: TEXT }))).toEqual({ ok: false, error: 'Minutes already sent' });
    expect(await importTranscriptAction(form({ code: 'NDC-031', meeting: 'MTG-130', text: TEXT }))).toEqual({ ok: false, error: 'Unknown meeting' });
    // Under 800 000 characters but over 800 000 bytes in UTF-8 (accents): refused with its own message, before Next's 1 MB limit.
    expect(await importTranscriptAction(form({ code: 'HLT-026', meeting: 'MTG-130', text: 'Décidé. '.repeat(90_000) }))).toEqual({ ok: false, error: 'The transcript is too long' });
    expect(await importTranscriptAction(form({ code: 'HLT-026', meeting: 'MTG-130', text: TEXT }))).toEqual({ ok: true, toast: 'Transcript imported · 37 words · 3 speakers' });
    viewer.lang = 'fr';
    const srt = '1\n00:00:01,000 --> 00:00:03,000\nR. Aubert: We agreed to keep the night shift.\n';
    expect(await importTranscriptAction(form({ code: 'HLT-026', meeting: 'MTG-130', file: new File([srt], 'cr.srt') }))).toEqual({ ok: true, toast: 'Transcription remplacée · 9 mots · 1 intervenant' });
    expect((await getMeeting('MTG-130'))!.transcript).toMatchObject({ source: 'file', fileName: 'cr.srt', analysed: false });
    viewer.lang = 'en';
    expect(await importTranscriptAction(form({ code: 'HLT-026', meeting: 'MTG-130', text: TEXT }))).toMatchObject({ ok: true });
  });

  it('analyse: Claude refused when not configured; the local analysis; the counts in the toast', async () => {
    expect(await analyseTranscriptAction({ code: 'HLT-026', meeting: 'MTG-130', engine: 'claude' })).toEqual({ ok: false, error: 'Claude is not configured (ANTHROPIC_API_KEY)' });
    expect(await analyseTranscriptAction({ code: 'HLT-026', meeting: 'MTG-130', engine: 'gpt' })).toEqual({ ok: false, error: 'Invalid request' });
    viewer.lang = 'fr';
    expect(await analyseTranscriptAction({ code: 'HLT-026', meeting: 'MTG-130', engine: 'local' })).toEqual({
      ok: true, toast: 'Transcription analysée (règles locales) · 1 décision · 1 action · 1 risque · 1 question client',
    });
    expect((await getMeeting('MTG-130'))!.transcript!.items.map((x) => x.type)).toEqual(['decision', 'action', 'risk', 'question']);
  });

  it('review: discard / restore / edit; a risk needs the risk register right; a question goes to the client questions', async () => {
    expect(await reviewProposalAction({ code: 'HLT-026', meeting: 'MTG-130', position: 9, status: 'rejected' })).toEqual({ ok: false, error: 'Unknown proposal' });
    expect(await reviewProposalAction({ code: 'HLT-026', meeting: 'MTG-130', position: 0, status: 'done' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await reviewProposalAction({ code: 'HLT-026', meeting: 'MTG-130', position: 0, status: 'rejected' })).toEqual({ ok: true });
    expect(await editProposalAction('HLT-026', 'MTG-130', 1, { text: 'Update the access plan', owner: 'J. Wagner', due: '1 oct.' })).toEqual({ toast: 'Proposal updated' });
    expect(await editProposalAction('HLT-026', 'MTG-130', 1, { text: '' })).toEqual({ error: 'Write a note first' });

    viewer.canEditRisks = false;
    const RISK = { title: 'The crane arrives late', cat: 'supplier_delivery', p: '3', i: '4', resp: 'mitigate' };
    expect(await addProposalRiskAction('HLT-026', 'MTG-130', 2, RISK)).toEqual({ error: 'This risk register is read-only for you' });
    viewer.canEditRisks = true;
    expect(await addProposalRiskAction('HLT-026', 'MTG-130', 1, RISK)).toEqual({ error: 'Unknown proposal' });
    const r = await addProposalRiskAction('HLT-026', 'MTG-130', 2, RISK);
    expect(r).toEqual({ toast: expect.stringMatching(/^R-\d+ · Risk registered$/) });
    const number = (r as { toast: string }).toast.split(' · ')[0];
    expect((await listRisks('HLT-026')).find((x) => x.id === number)).toMatchObject({ title: 'The crane arrives late', category: 'supplier_delivery' });
    expect(await addProposalRiskAction('HLT-026', 'MTG-130', 2, RISK)).toEqual({ error: 'This proposal was already added' });

    expect(await addProposalQuestionAction('HLT-026', 'MTG-130', 3, { text: 'Can the client confirm the exclusion zone?', askedBy: '', owner: 'R. Aubert' })).toEqual({ error: 'Fill in the required fields' });
    expect(await addProposalQuestionAction('HLT-026', 'MTG-130', 3, { text: 'Can the client confirm the exclusion zone?', askedBy: 'L. Fabre', owner: 'R. Aubert' })).toEqual({ toast: 'Question added to the client questions' });
    expect((await listClientQuestions('HLT-026')).at(-1)).toMatchObject({ text: 'Can the client confirm the exclusion zone?', state: 'open' });

    expect(await applyTranscriptAction({ code: 'HLT-026', meeting: 'MTG-130' })).toEqual({ ok: true });
    const m = (await getMeeting('MTG-130'))!;
    expect(m.agenda.at(-1)!.lines.map((l) => [l.type, l.text, l.owner, l.due])).toEqual([['action', 'Update the access plan', 'J. Wagner', '1 Oct']]);
    expect(await analyseTranscriptAction({ code: 'HLT-026', meeting: 'MTG-130' })).toEqual({ ok: false, error: 'Proposals were already added · the analysis cannot be replaced' });
  });
});
