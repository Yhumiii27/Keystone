'use server';
// Meetings & minutes Server Functions (docs/spec/05 §5.5): New meeting (AF `meetings`), minutes notes from the
// composer, action ticks (agenda, carry-over, previous meeting, Actions register), "Send minutes to all invitees" (numbered
// MIN record in the Codex index, owners' to-dos, read receipts) and — chapter 4, S-10 — the meeting transcript: import
// (paste or .txt / .vtt / .srt), analysis (Claude when configured, else the local rules), review of the proposals (discard,
// restore, edit), "Add to minutes", a risk proposal into the risk register, a question proposal into the client questions.
// Each one validates its raw input, checks the viewer may edit Meetings on this project (not outside the workspace, not a
// read-only project — 05 OQ7 / P-9: no finer role gate, as the prototype; a risk also needs the right to edit the risk
// register), checks the meeting belongs to the project, writes through the DAL with the viewer as the actor, then
// revalidates. Error messages are English source strings translated here. R-008: transcript imports count in the upload
// rate limit and analyses in the analysis one (src/server/http/request-guard.ts).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { parseClientQuestion, parseMinutesLine, parseNewMeeting, parseProposalEdit, pasteTooLong, TRANSCRIPT_IMPORT } from '@/domain/meetings';
import { parseNewRisk } from '@/domain/risk';
import { RISK_RESULT } from '@/features/risks/forms';
import { transcriptAiInfo } from '@/server/ai/config';
import {
  addMeetingLine, analyseTranscript, applyTranscriptToMinutes, createMeeting, getMeeting, sendMinutes, toggleMeetingAction, type MeetingRow,
} from '@/server/dal/meetings';
import { ensureFirstAgendaPoint } from '@/server/dal/meetings-screen';
import {
  addTranscriptQuestion, importTranscript, markTranscriptProposalApplied, setTranscriptProposalStatus, TranscriptError, updateTranscriptProposal,
} from '@/server/dal/meetings-transcripts';
import { getProject } from '@/server/dal/projects';
import { createRisk } from '@/server/dal/risks';
import { riskOwnerOptions } from '@/server/dal/risks-screen';
import { TOO_MANY_REQUESTS, hitActionRateLimit } from '@/server/http/request-guard';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { checkUpload, FileRejectedError } from '@/server/storage/files';
import { MEETING_RESULT } from './forms';
import { analysedToastText, importedToastText, sentToastText } from './i18n';

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
    // Refusals with a user-facing reason (minutes sent meanwhile, transcript too long, file type…) keep their message.
    if (e instanceof TranscriptError || e instanceof FileRejectedError) return { ok: false, error: e.message };
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

// ── Transcript (chapter 4, S-10) ─────────────────────────────────────────────────────────────────────────────────────

/** Meeting gate for the transcript: editable, minutes not sent. */
async function transcriptMeeting(code: unknown, number: unknown): Promise<MeetingGate> {
  const g = await editableMeeting(code, number);
  if (!g.ok) return g;
  if (g.meeting.status === 'minutes_sent') return { ok: false, error: 'Minutes already sent' };
  return g;
}

/**
 * "Import transcript" / "Replace transcript": FormData `code`, `meeting` and either `file` (.txt / .vtt / .srt, stored by
 * Keystone) or `text` (pasted). Toast "Transcript imported · 412 words · 4 speakers".
 */
export async function importTranscriptAction(form: FormData): Promise<MeetingActionResult> {
  if (!(form instanceof FormData)) return fail('Invalid request');
  const g = await transcriptMeeting(form.get('code'), form.get('meeting'));
  if (!g.ok) return fail(g.error);
  if (!(await hitActionRateLimit('upload', g.actor)).ok) return fail(TOO_MANY_REQUESTS);
  const file = form.get('file');
  const text = form.get('text');
  let input: { text?: string; file?: { name: string; data: Uint8Array } };
  if (file instanceof File && file.size > 0) {
    try {
      checkUpload('transcript', file.name, file.size);
    } catch (e) {
      return fail(e instanceof FileRejectedError ? e.message : 'Invalid request');
    }
    if (file.size > TRANSCRIPT_IMPORT.maxUploadBytes) return fail('The transcript is too long');
    input = { file: { name: file.name, data: new Uint8Array(await file.arrayBuffer()) } };
  } else if (typeof text === 'string' && text.trim()) {
    if (pasteTooLong(text)) return fail('The transcript is too long');
    input = { text };
  } else return fail('Paste the transcript or choose a file');
  const r = await write('importTranscriptAction', () => importTranscript(g.meeting.number, input, g.actor));
  if (!r.ok) return fail(r.error);
  refresh(g.code);
  const { lang } = await getI18n();
  return { ok: true, toast: importedToastText(r.value, lang) };
}

/**
 * "Analyse transcript" / "Analyse again": `engine` 'auto' (Claude when configured, else local), 'local' (the transcript stays
 * in Keystone) or 'claude' (refused when not configured). Replaces a previous analysis while nothing was added from it.
 */
export async function analyseTranscriptAction(input: { code: string; meeting: string; engine?: string }): Promise<MeetingActionResult> {
  const g = await transcriptMeeting(input?.code, input?.meeting);
  if (!g.ok) return fail(g.error);
  if (!g.meeting.transcript) return fail('This meeting has no transcript');
  const engine = input.engine ?? 'auto';
  if (engine !== 'auto' && engine !== 'local' && engine !== 'claude') return fail('Invalid request');
  if (engine === 'claude' && !transcriptAiInfo().claude) return fail('Claude is not configured (ANTHROPIC_API_KEY)');
  if (!(await hitActionRateLimit('analysis', g.actor)).ok) return fail(TOO_MANY_REQUESTS);
  const r = await write('analyseTranscriptAction', () => analyseTranscript(g.meeting.number, g.actor, { engine }));
  if (!r.ok) return fail(r.error);
  refresh(g.code);
  const { t, lang } = await getI18n();
  return { ok: true, toast: analysedToastText(r.value, t, lang) };
}

/** "Add to minutes": the kept decisions then actions go to the last agenda point, once (status unchanged, as the prototype). */
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

type ProposalGate = MeetingGate & { ok: true; item: NonNullable<MeetingRow['transcript']>['items'][number] };

/** Transcript gate + the proposal at `position`, not applied yet. */
async function proposalOf(code: unknown, number: unknown, position: unknown): Promise<ProposalGate | { ok: false; error: string }> {
  const g = await transcriptMeeting(code, number);
  if (!g.ok) return g;
  if (!isIndex(position)) return { ok: false, error: 'Unknown proposal' };
  const item = g.meeting.transcript?.items.find((x) => x.position === position);
  if (!item) return { ok: false, error: 'Unknown proposal' };
  if (item.status === 'applied') return { ok: false, error: 'This proposal was already added' };
  return { ...g, item };
}

/** Discard (rejected) / restore (proposed) a proposal. */
export async function reviewProposalAction(input: { code: string; meeting: string; position: number; status: string }): Promise<MeetingActionResult> {
  const g = await proposalOf(input?.code, input?.meeting, input?.position);
  if (!g.ok) return fail(g.error);
  if (input.status !== 'rejected' && input.status !== 'proposed') return fail('Invalid request');
  const status = input.status;
  const r = await write('reviewProposalAction', () => setTranscriptProposalStatus(g.meeting.number, g.item.position, status, g.actor));
  if (!r.ok) return fail(r.error);
  refresh(g.code);
  return { ok: true };
}

const formResult = async (r: MeetingActionResult): Promise<FormDialogResult> => (r.ok ? (r.toast ? { toast: r.toast } : undefined) : { error: r.error });

/** "Edit proposal" (text; owner and due of an action, owner of a risk). */
export async function editProposalAction(code: string, meeting: string, position: number, values: Record<string, string>): Promise<FormDialogResult> {
  const g = await proposalOf(code, meeting, position);
  if (!g.ok) return { error: await tr(g.error) };
  const parsed = parseProposalEdit(strings(values));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const r = await write('editProposalAction', () => updateTranscriptProposal(g.meeting.number, g.item.position, parsed.value, g.actor));
  if (!r.ok) return { error: await tr(r.error) };
  refresh(g.code);
  return formResult({ ok: true, toast: await tr('Proposal updated') });
}

/** Risk proposal → "New risk" form → the project's risk register (R-21…); the proposal is then marked added. */
export async function addProposalRiskAction(code: string, meeting: string, position: number, values: Record<string, string>): Promise<FormDialogResult> {
  const g = await proposalOf(code, meeting, position);
  if (!g.ok) return { error: await tr(g.error) };
  if (g.item.type !== 'risk') return { error: await tr('Unknown proposal') };
  const risks = await getProjectContext(g.code, 'risks');
  if (!risks.canEdit('risks')) return { error: await tr('This risk register is read-only for you') };
  const parsed = parseNewRisk(strings(values), await riskOwnerOptions(g.code));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const v = parsed.value;
  // One transaction: the risk is created and the proposal marked added together (or neither).
  const r = await write('addProposalRiskAction', () =>
    markTranscriptProposalApplied(g.meeting.number, g.item.position, (tx) => createRisk(
      g.code,
      { title: v.title, category: v.category, probability: v.probability, impact: v.impact, owner: v.owner, response: v.response, emvKeur: v.emvKeur, plan: v.plan, trigger: `${g.meeting.number} · transcript` },
      g.actor,
      tx,
    ), g.actor));
  if (!r.ok) return { error: await tr(r.error) };
  refresh(g.code);
  return { toast: `${r.value} · ${await tr(RISK_RESULT)}` };
}

/** Question proposal → an open question of the internal ⇄ client bridge. */
export async function addProposalQuestionAction(code: string, meeting: string, position: number, values: Record<string, string>): Promise<FormDialogResult> {
  const g = await proposalOf(code, meeting, position);
  if (!g.ok) return { error: await tr(g.error) };
  if (g.item.type !== 'question') return { error: await tr('Unknown proposal') };
  const parsed = parseClientQuestion(strings(values));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const r = await write('addProposalQuestionAction', () => addTranscriptQuestion(g.meeting.number, g.item.position, parsed.value, g.actor));
  if (!r.ok) return { error: await tr(r.error) };
  refresh(g.code);
  return { toast: await tr('Question added to the client questions') };
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
