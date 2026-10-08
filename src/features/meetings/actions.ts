'use server';
// Meetings & minutes Server Functions (docs/spec/05 §5.5): New meeting (AF `meetings`), minutes notes from the
// composer, action ticks (agenda, carry-over, previous meeting, Actions register), transcript analysis and "Add to
// minutes", and "Send minutes to all invitees" (numbered MIN record in the Codex index, owners' to-dos, read
// receipts). Each one validates its raw input, checks the viewer may edit Meetings on this project (not outside the
// workspace, not a read-only project — 05 OQ7 / P-9: no finer role gate, as the prototype), checks the meeting
// belongs to the project, writes through the DAL with the viewer as the actor, then revalidates. Error messages are
// English source strings translated here.
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { parseMinutesLine, parseNewMeeting } from '@/domain/meetings';
import {
  addMeetingLine, analyseTranscript, applyTranscriptToMinutes, createMeeting, getMeeting, sendMinutes, toggleMeetingAction, type MeetingRow,
} from '@/server/dal/meetings';
import { ensureFirstAgendaPoint } from '@/server/dal/meetings-screen';
import { getProject } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { MEETING_RESULT } from './forms';
import { sentToastText } from './i18n';

export type MeetingActionResult = { ok: true; toast?: string; done?: boolean } | { ok: false; error: string };

const READ_ONLY = 'These meetings are read-only for you';
const MTG_RE = /^MTG-\d{1,6}$/;

/** Toast / error text translated per " · " segment, like the prototype's showToast. */
async function tr(english: string) {
  const { t } = await getI18n();
  return english.split(' · ').map(t).join(' · ');
}
const fail = async (error: string): Promise<MeetingActionResult> => ({ ok: false, error: await tr(error) });

/** Form values as sent by the client, keeping string entries only (a forged payload never reaches `.trim()`). */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object'
    ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000;

type Gate = { ok: true; code: string; actor: string } | { ok: false; error: string };

/** Resolves the project and checks the viewer may edit Meetings on it. */
async function editable(code: unknown): Promise<Gate> {
  if (typeof code !== 'string' || !code) return { ok: false, error: 'Invalid request' };
  const project = await getProject(code);
  if (!project) return { ok: false, error: 'Unknown project' };
  const ctx = await getProjectContext(project.code, 'meetings');
  if (!ctx.canEdit('meetings')) return { ok: false, error: READ_ONLY };
  return { ok: true, code: project.code, actor: ctx.viewer.name };
}

type MeetingGate = { ok: true; code: string; actor: string; meeting: MeetingRow } | { ok: false; error: string };

/** `editable` + the meeting exists on this project. */
async function editableMeeting(code: unknown, number: unknown): Promise<MeetingGate> {
  const g = await editable(code);
  if (!g.ok) return g;
  if (typeof number !== 'string' || !MTG_RE.test(number)) return { ok: false, error: 'Unknown meeting' };
  const meeting = await getMeeting(number);
  if (!meeting || meeting.projectCode !== g.code) return { ok: false, error: 'Unknown meeting' };
  return { ...g, meeting };
}

/** Project pages (screen, sidebar badge); `all` also refreshes My work, Home and Documents (tasks, MIN record). */
const refresh = (code: string, all = false) => revalidatePath(all ? '/' : `/projects/${code}`, 'layout');

async function write<R>(label: string, fn: () => Promise<R>): Promise<{ ok: true; value: R } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    console.error(label, e);
    return { ok: false, error: 'The change could not be saved' };
  }
}

/** "New meeting" → "Create & invite": MTG-130…, Scheduled, organized by the viewer; toast "{title} · Meeting created · …". */
export async function createMeetingAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const g = await editable(code);
  if (!g.ok) return { error: await tr(g.error) };
  const parsed = parseNewMeeting(strings(values));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const v = parsed.value;
  const r = await write('createMeetingAction', () =>
    createMeeting(g.code, { title: v.title, type: v.type, series: v.series, date: v.date, time: v.time, location: v.location, invitees: v.invitees, agenda: v.agenda }, g.actor),
  );
  if (!r.ok) return { error: await tr(r.error) };
  refresh(g.code);
  const { t } = await getI18n();
  return { toast: `${v.title} · ${t(MEETING_RESULT)}` };
}

/** Composer "+ Add" / Enter: a note on the selected agenda point; Scheduled → Notes in progress. */
export async function addMinutesLineAction(input: { code: string; meeting: string; point: number; type: string; text: string; owner?: string; due?: string }): Promise<MeetingActionResult> {
  const g = await editableMeeting(input?.code, input?.meeting);
  if (!g.ok) return fail(g.error);
  if (g.meeting.status === 'minutes_sent') return fail('Minutes already sent');
  const parsed = parseMinutesLine(input);
  if (!parsed.ok) return fail(parsed.error);
  const point = input.point;
  if (!isIndex(point)) return fail('Unknown agenda point');
  const noAgenda = g.meeting.agenda.length === 0;
  if (noAgenda ? point !== 0 : !g.meeting.agenda.some((a) => a.position === point)) return fail('Unknown agenda point');
  const r = await write('addMinutesLineAction', async () => {
    if (noAgenda) await ensureFirstAgendaPoint(g.meeting.number);
    await addMeetingLine(g.meeting.number, point, parsed.value, g.actor);
  });
  if (!r.ok) return fail(r.error);
  refresh(g.code);
  return { ok: true };
}

/** Action checkbox (agenda, carry-over, previous meeting, Actions register): ticks / unticks; returns the new state. */
export async function toggleMeetingActionAction(input: { code: string; meeting: string; point: number; position: number }): Promise<MeetingActionResult> {
  const g = await editableMeeting(input?.code, input?.meeting);
  if (!g.ok) return fail(g.error);
  if (!isIndex(input.point) || !isIndex(input.position)) return fail('Unknown agenda point');
  const line = g.meeting.agenda.find((a) => a.position === input.point)?.lines.find((l) => l.position === input.position);
  if (!line) return fail('Unknown agenda point');
  if (line.type !== 'action') return fail('Only actions can be ticked');
  const r = await write('toggleMeetingActionAction', () => toggleMeetingAction(g.meeting.number, input.point, input.position, g.actor));
  if (!r.ok) return fail(r.error);
  refresh(g.code);
  return { ok: true, done: r.value };
}

/** "Analyse transcript": reveals the (simulated, S-10) summary and proposed decisions and actions. */
export async function analyseTranscriptAction(input: { code: string; meeting: string }): Promise<MeetingActionResult> {
  const g = await editableMeeting(input?.code, input?.meeting);
  if (!g.ok) return fail(g.error);
  if (!g.meeting.transcript) return fail('This meeting has no transcript');
  if (g.meeting.status === 'minutes_sent') return fail('Minutes already sent');
  const r = await write('analyseTranscriptAction', () => analyseTranscript(g.meeting.number, g.actor));
  if (!r.ok) return fail(r.error);
  refresh(g.code);
  return { ok: true };
}

/** "Add to minutes": the proposals go to the last agenda point, once (status unchanged, as the prototype). */
export async function applyTranscriptAction(input: { code: string; meeting: string }): Promise<MeetingActionResult> {
  const g = await editableMeeting(input?.code, input?.meeting);
  if (!g.ok) return fail(g.error);
  if (!g.meeting.transcript) return fail('This meeting has no transcript');
  if (!g.meeting.transcript.analysed) return fail('Analyse the transcript first');
  if (g.meeting.status === 'minutes_sent') return fail('Minutes already sent');
  const r = await write('applyTranscriptAction', () => applyTranscriptToMinutes(g.meeting.number, g.actor));
  if (!r.ok) return fail(r.error);
  refresh(g.code);
  return { ok: true };
}

/**
 * "Send minutes to all invitees": MIN-{project}-nnn released in the Codex index, to-dos for the action owners of
 * the resource pool, read receipts; toast "{MIN} · minutes sent to {n} invitees · {k} actions added to tasks".
 */
export async function sendMinutesAction(input: { code: string; meeting: string }): Promise<MeetingActionResult> {
  const g = await editableMeeting(input?.code, input?.meeting);
  if (!g.ok) return fail(g.error);
  if (g.meeting.status === 'minutes_sent') return fail('Minutes already sent');
  const r = await write('sendMinutesAction', () => sendMinutes(g.meeting.number, g.actor));
  if (!r.ok) return fail(r.error);
  refresh(g.code, true);
  const { lang } = await getI18n();
  return { ok: true, toast: sentToastText(r.value.minutesNumber, r.value.invited, r.value.tasks.length, lang) };
}
