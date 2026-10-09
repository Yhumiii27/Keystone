import 'server-only';
// Meeting transcripts — chapter 4 (S-10): import (pasted text or an uploaded .txt / .vtt / .srt stored by Keystone), analysis
// (Claude when ANTHROPIC_API_KEY is configured, else the local rule-based analyser; src/server/ai/transcripts) and the human
// review of its proposals. Nothing reaches the minutes, the risk register or the client question bridge without a click:
//   - "Add to minutes" appends the decisions and actions a reviewer did not discard to the last agenda point (once);
//   - a risk proposal becomes a register risk through the "New risk" form (Server Function → createRisk → marked applied);
//   - a client question proposal becomes an open question of the internal ⇄ client bridge (addTranscriptQuestion).
// Tasks still come from "Send minutes" (actions of the minutes). The analysis runs outside any transaction (a Claude call may
// take a minute); its result is written only if the transcript did not change meanwhile.
import { and, asc, eq, sql } from 'drizzle-orm';
import { MAX, normaliseDue, TRANSCRIPT_IMPORT } from '@/domain/meetings';
import { analyseTranscriptText, type AnalysisEngine } from '@/server/ai/transcripts';
import { parseTranscript } from '@/server/ai/transcripts/parse';
import type { AnalyzerId, TranscriptAnalyzerImpl } from '@/server/ai/transcripts/types';
import { getDb } from '@/server/db/client';
import { isoOfDisplayDate, type TranscriptProposalStatus, type TranscriptProposalType } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity } from '@/server/db/helpers';
import { clientQuestions, meetingAgendaPoints, meetingParticipants, meetingTranscriptProposals, meetingTranscripts, meetings, projects } from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { deleteStoredFile, storeFile } from '@/server/storage/files';
import { appendLines, auditMeeting, loadMeeting } from './meetings-core';

/** A refused transcript operation; `message` is an EN source sentence the Server Functions translate. */
export class TranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptError';
  }
}

async function loadTranscript(tx: Tx, meetingId: string) {
  const [tr] = await tx.select().from(meetingTranscripts).where(eq(meetingTranscripts.meetingId, meetingId));
  return tr ?? null;
}

async function proposalsOf(tx: Tx, meetingId: string) {
  return tx.select().from(meetingTranscriptProposals).where(eq(meetingTranscriptProposals.meetingId, meetingId)).orderBy(asc(meetingTranscriptProposals.position));
}

const anyApplied = (ps: { status: TranscriptProposalStatus }[]) => ps.some((p) => p.status === 'applied');

// ── Import ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Text of an uploaded file: UTF-8 (BOM removed), Windows-1252 when the bytes are not valid UTF-8 (older .srt exports). */
export function decodeTranscriptFile(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(data);
  }
}

export interface TranscriptImportInput {
  /** Pasted text (source 'paste'). */
  text?: string | null;
  /** Uploaded .txt / .vtt / .srt (source 'file'), stored by Keystone. */
  file?: { name: string; data: Uint8Array } | null;
}

export interface TranscriptImportResult {
  /** A previous transcript (and its analysis) was replaced. */
  replaced: boolean;
  format: 'text' | 'vtt' | 'srt';
  words: number;
  speakers: number;
  language: string;
}

/**
 * Imports or replaces the transcript of a meeting whose minutes are not sent. The stored text is the readable form of the
 * parse ("Speaker: text" per turn); an uploaded file is kept by Keystone (data dir). A replaced transcript loses its analysis
 * and unapplied proposals — lines already added to the minutes stay there.
 */
export async function importTranscript(meetingNumber: string, input: TranscriptImportInput, actorName: string, at: Date = new Date()): Promise<TranscriptImportResult> {
  const file = input.file ?? null;
  const raw = file ? decodeTranscriptFile(file.data) : (input.text ?? '');
  if (raw.length > TRANSCRIPT_IMPORT.maxChars * 2) throw new TranscriptError('The transcript is too long');
  const parsed = parseTranscript(raw, file?.name ?? null);
  if (!parsed.text.trim()) throw new TranscriptError('The transcript is empty');
  if (parsed.text.length > TRANSCRIPT_IMPORT.maxChars) throw new TranscriptError('The transcript is too long');
  const db = await getDb();
  let oldFileId: string | null = null;
  let replaced = false;
  await db.transaction(async (tx) => {
    const m = await loadMeeting(tx, meetingNumber);
    if (m.status === 'minutes_sent') throw new TranscriptError('Minutes already sent');
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    const old = await loadTranscript(tx, m.id);
    replaced = !!old;
    oldFileId = old?.fileId ?? null;
    const stored = file
      ? await storeFile({ purpose: 'transcript', name: file.name, data: file.data, projectId: m.projectId, ownerType: 'meeting', ownerId: m.id, actor: { name: who, personId: actor?.id ?? null } }, tx)
      : null;
    const row = {
      rawText: parsed.text, source: file ? ('file' as const) : ('paste' as const), summary: '', analysedAt: null, appliedAt: null, fileId: stored?.id ?? null,
      language: parsed.language, analyzer: null, analyzerModel: null, analysisNotice: null, importedAt: at, importedByPersonId: actor?.id ?? null, importedByName: who,
    };
    await tx.delete(meetingTranscriptProposals).where(eq(meetingTranscriptProposals.meetingId, m.id));
    if (old) await tx.update(meetingTranscripts).set(row).where(eq(meetingTranscripts.meetingId, m.id));
    else await tx.insert(meetingTranscripts).values({ meetingId: m.id, ...row });
    const what = file ? `file ${stored!.name}` : 'pasted text';
    await auditMeeting(tx, actorName, meetingNumber, `transcript ${old ? 'replaced' : 'imported'} · ${what} · ${parsed.words} words · ${parsed.speakers.length} speakers`, m.projectId, m.id);
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: `Imported the transcript of ${meetingNumber}`, kind: 'comment', projectId: m.projectId });
  });
  if (oldFileId) await deleteStoredFile(oldFileId).catch((e) => console.error('importTranscript: old file not deleted', e));
  return { replaced, format: parsed.format, words: parsed.words, speakers: parsed.speakers.length, language: parsed.language };
}

/** Stored file of a meeting's transcript (an upload; null for a paste or an unknown meeting) and the meeting's project. */
export async function getTranscriptFileRef(meetingNumber: string): Promise<{ projectCode: string; fileId: string } | null> {
  const db = await getDb();
  const [r] = await db
    .select({ projectCode: projects.code, fileId: meetingTranscripts.fileId })
    .from(meetings)
    .innerJoin(projects, eq(projects.id, meetings.projectId))
    .innerJoin(meetingTranscripts, eq(meetingTranscripts.meetingId, meetings.id))
    .where(eq(meetings.number, meetingNumber));
  return r?.fileId ? { projectCode: r.projectCode, fileId: r.fileId } : null;
}

// ── Analysis ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TranscriptAnalysisRun {
  analyzer: AnalyzerId;
  model: string | null;
  /** EN source notice when Claude failed and the local rules stood in. */
  notice: string | null;
  counts: Record<TranscriptProposalType, number>;
}

export interface AnalyseTranscriptOptions {
  /** 'auto' (Claude when configured), 'local' (rules — the transcript stays in Keystone) or 'claude'. */
  engine?: AnalysisEngine;
  at?: Date;
  /** Claude analyser to use instead of the configured one (tests). */
  claude?: TranscriptAnalyzerImpl | null;
}

/**
 * "Analyse transcript" / "Analyse again": runs the analyser and stores its summary and proposals (status proposed) — the
 * previous analysis is replaced. Refused once proposals were added to the minutes, the risk register or the questions.
 */
export async function analyseTranscript(meetingNumber: string, actorName: string, opts: AnalyseTranscriptOptions = {}): Promise<TranscriptAnalysisRun> {
  const db = await getDb();
  const [m] = await db.select().from(meetings).where(eq(meetings.number, meetingNumber));
  if (!m) throw new Error(`Unknown meeting ${meetingNumber}`);
  const [tr] = await db.select().from(meetingTranscripts).where(eq(meetingTranscripts.meetingId, m.id));
  if (!tr) throw new TranscriptError('This meeting has no transcript');
  const before = await db.select({ status: meetingTranscriptProposals.status }).from(meetingTranscriptProposals).where(eq(meetingTranscriptProposals.meetingId, m.id));
  if (tr.appliedAt || (tr.analysedAt && anyApplied(before))) throw new TranscriptError('Proposals were already added · the analysis cannot be replaced');
  const participants = (await db.select({ name: meetingParticipants.name }).from(meetingParticipants).where(eq(meetingParticipants.meetingId, m.id)).orderBy(asc(meetingParticipants.position))).map((p) => p.name);

  const outcome = await analyseTranscriptText({ text: tr.rawText, meetingTitle: m.title, meetingDate: m.startsOn, participants }, { engine: opts.engine, claude: opts.claude });
  const counts: Record<TranscriptProposalType, number> = { decision: 0, action: 0, risk: 0, question: 0 };
  for (const p of outcome.proposals) counts[p.type]++;

  await db.transaction(async (tx) => {
    const now = await loadTranscript(tx, m.id);
    if (!now || now.rawText !== tr.rawText || now.appliedAt) throw new TranscriptError('The transcript changed meanwhile · analyse it again');
    await tx.delete(meetingTranscriptProposals).where(eq(meetingTranscriptProposals.meetingId, m.id));
    const rows = [];
    for (const [position, p] of outcome.proposals.entries())
      rows.push({
        meetingId: m.id, position, type: p.type, text: p.text, ownerName: p.owner, ownerPersonId: p.owner ? (await findPerson(tx, p.owner))?.id ?? null : null,
        dueText: p.due, dueDate: p.dueDate, status: 'proposed' as const, speaker: p.speaker, quote: p.quote,
      });
    if (rows.length) await tx.insert(meetingTranscriptProposals).values(rows);
    await tx
      .update(meetingTranscripts)
      .set({
        summary: outcome.summary, analysedAt: opts.at ?? new Date(), analyzer: outcome.analyzer, analyzerModel: outcome.model, analysisNotice: outcome.notice,
        language: now.language ?? (outcome.language === 'fr' || outcome.language === 'en' ? outcome.language : null),
      })
      .where(eq(meetingTranscripts.meetingId, m.id));
    const engine = outcome.analyzer === 'claude' ? `Claude (${outcome.model})` : outcome.notice ? 'local rules (Claude failed)' : 'local rules';
    await auditMeeting(
      tx, actorName, meetingNumber,
      `transcript analysed · ${engine} · ${counts.decision} decisions · ${counts.action} actions · ${counts.risk} risks · ${counts.question} questions`, m.projectId, m.id,
    );
  });
  return { analyzer: outcome.analyzer, model: outcome.model, notice: outcome.notice, counts };
}

// ── Review ────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function loadProposal(tx: Tx, meetingNumber: string, position: number) {
  const m = await loadMeeting(tx, meetingNumber);
  const tr = await loadTranscript(tx, m.id);
  if (!tr?.analysedAt) throw new TranscriptError('Analyse the transcript first');
  const [p] = await tx
    .select()
    .from(meetingTranscriptProposals)
    .where(and(eq(meetingTranscriptProposals.meetingId, m.id), eq(meetingTranscriptProposals.position, position)));
  if (!p) throw new TranscriptError('Unknown proposal');
  return { m, tr, p };
}

async function reviewer(tx: Tx, actorName: string) {
  const actor = await findPerson(tx, actorName);
  return { reviewedByPersonId: actor?.id ?? null, reviewedByName: actor ? nameOf(actor) : actorName, reviewedAt: new Date() };
}

/** Discards a proposal ('rejected') or restores it ('proposed'). Applied proposals cannot change. */
export async function setTranscriptProposalStatus(meetingNumber: string, position: number, status: 'rejected' | 'proposed', actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { m, p } = await loadProposal(tx, meetingNumber, position);
    if (p.status === 'applied') throw new TranscriptError('This proposal was already added');
    if (p.status === status) return;
    await tx.update(meetingTranscriptProposals).set({ status, ...(await reviewer(tx, actorName)) })
      .where(and(eq(meetingTranscriptProposals.meetingId, m.id), eq(meetingTranscriptProposals.position, position)));
    await auditMeeting(tx, actorName, meetingNumber, `transcript ${p.type} ${status === 'rejected' ? 'discarded' : 'restored'} · ${p.text}`, m.projectId, m.id);
  });
}

export interface TranscriptProposalEdit {
  text: string;
  /** Actions and risks. */
  owner?: string | null;
  /** Actions: due as typed ("6 Oct", "6 oct.", "06/10", "next week"); blank → none. */
  due?: string | null;
}

/** Edits a proposal before it is added (text; owner and due of an action; owner of a risk). */
export async function updateTranscriptProposal(meetingNumber: string, position: number, edit: TranscriptProposalEdit, actorName: string): Promise<void> {
  const text = edit.text.replace(/\s+/g, ' ').trim();
  if (!text) throw new TranscriptError('Write a note first');
  if (text.length > MAX.note) throw new TranscriptError('The note is too long');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { m, p } = await loadProposal(tx, meetingNumber, position);
    if (p.status === 'applied') throw new TranscriptError('This proposal was already added');
    const owner = p.type === 'action' || p.type === 'risk' ? edit.owner?.replace(/\s+/g, ' ').trim() || null : null;
    if ((owner?.length ?? 0) > MAX.name) throw new TranscriptError('The note is too long');
    const due = p.type === 'action' ? normaliseDue(edit.due) : null;
    if ((due?.length ?? 0) > MAX.due) throw new TranscriptError('The note is too long');
    await tx
      .update(meetingTranscriptProposals)
      .set({
        text, ownerName: owner, ownerPersonId: owner ? (await findPerson(tx, owner))?.id ?? null : null, dueText: due, dueDate: due ? isoOfDisplayDate(due) : null,
        status: p.status === 'rejected' ? 'proposed' : p.status, ...(await reviewer(tx, actorName)),
      })
      .where(and(eq(meetingTranscriptProposals.meetingId, m.id), eq(meetingTranscriptProposals.position, position)));
    await auditMeeting(tx, actorName, meetingNumber, `transcript ${p.type} edited · ${p.text} → ${text}`, m.projectId, m.id);
  });
}

/**
 * "Add to minutes": the decisions then the actions a reviewer did not discard go to the last agenda point (created, titled
 * like the meeting, when there is none), once. Status unchanged (as the prototype). Returns the number of lines added.
 */
export async function applyTranscriptToMinutes(meetingNumber: string, actorName: string, at: Date = new Date()): Promise<number> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const m = await loadMeeting(tx, meetingNumber);
    const tr = await loadTranscript(tx, m.id);
    if (!tr?.analysedAt) throw new TranscriptError('Analyse the transcript first');
    if (tr.appliedAt) return 0;
    const props = await proposalsOf(tx, m.id);
    const kept = (t: 'decision' | 'action') => props.filter((x) => x.type === t && x.status !== 'rejected' && x.status !== 'applied');
    const chosen = [...kept('decision'), ...kept('action')];
    if (!chosen.length) throw new TranscriptError('No decision or action to add to the minutes');
    const [{ last }] = await tx.select({ last: sql<number>`coalesce(max(${meetingAgendaPoints.position}), -1)::int` }).from(meetingAgendaPoints).where(eq(meetingAgendaPoints.meetingId, m.id));
    if (last < 0) await tx.insert(meetingAgendaPoints).values({ meetingId: m.id, position: 0, title: m.title });
    const point = Math.max(0, last);
    const positions = await appendLines(tx, m, point, chosen.map((x) => ({ type: x.type as 'decision' | 'action', text: x.text, owner: x.ownerName, due: x.dueText, origin: 'transcript' as const })));
    const rev = await reviewer(tx, actorName);
    for (const [k, x] of chosen.entries())
      await tx.update(meetingTranscriptProposals).set({ status: 'applied', appliedRef: `${m.number}|${point}|${positions[k]}`, ...rev })
        .where(and(eq(meetingTranscriptProposals.meetingId, m.id), eq(meetingTranscriptProposals.position, x.position)));
    await tx.update(meetingTranscripts).set({ appliedAt: at }).where(eq(meetingTranscripts.meetingId, m.id));
    const actor = await auditMeeting(tx, actorName, meetingNumber, `${chosen.length} proposals added to the minutes`, m.projectId, m.id);
    await recordActivity(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, text: `Added ${chosen.length} transcript proposals to the minutes of ${meetingNumber}`, kind: 'comment', projectId: m.projectId,
    });
    return chosen.length;
  });
}

/** Marks a proposal as applied elsewhere (a risk registered from it: `ref` = "R-21" — or a function of the transaction giving it). */
export async function markTranscriptProposalApplied(meetingNumber: string, position: number, ref: string | ((tx: Tx) => Promise<string>), actorName: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { m, p } = await loadProposal(tx, meetingNumber, position);
    if (p.status === 'applied') throw new TranscriptError('This proposal was already added');
    const applied = typeof ref === 'string' ? ref : await ref(tx);
    await tx.update(meetingTranscriptProposals).set({ status: 'applied', appliedRef: applied, ...(await reviewer(tx, actorName)) })
      .where(and(eq(meetingTranscriptProposals.meetingId, m.id), eq(meetingTranscriptProposals.position, position)));
    await auditMeeting(tx, actorName, meetingNumber, `transcript ${p.type} added · ${applied} · ${p.text}`, m.projectId, m.id);
    return applied;
  });
}

export interface TranscriptQuestionInput {
  text: string;
  /** Who asked ("N. Bensaïd", "Port authority"). */
  askedBy: string;
  /** Answering department ("Electrical"); "—" when blank. */
  department?: string | null;
  /** Who prepares the answer. */
  owner: string;
}

/** A question proposal → an open question of the project's internal ⇄ client bridge (appended). */
export async function addTranscriptQuestion(meetingNumber: string, position: number, input: TranscriptQuestionInput, actorName: string): Promise<void> {
  const text = input.text.replace(/\s+/g, ' ').trim();
  const askedBy = input.askedBy.replace(/\s+/g, ' ').trim();
  const owner = input.owner.replace(/\s+/g, ' ').trim();
  const department = input.department?.replace(/\s+/g, ' ').trim() || '—';
  if (!text || !askedBy || !owner) throw new TranscriptError('Fill in the required fields');
  if (text.length > MAX.note || askedBy.length > MAX.name || owner.length > MAX.name || department.length > MAX.name) throw new TranscriptError('The note is too long');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { m, p } = await loadProposal(tx, meetingNumber, position);
    if (p.type !== 'question') throw new TranscriptError('Unknown proposal');
    if (p.status === 'applied') throw new TranscriptError('This proposal was already added');
    const [{ maxPos }] = await tx.select({ maxPos: sql<number>`coalesce(max(${clientQuestions.position}), -1)::int` }).from(clientQuestions).where(eq(clientQuestions.projectId, m.projectId));
    const [asker, ownerP] = await Promise.all([findPerson(tx, askedBy), findPerson(tx, owner)]);
    await tx.insert(clientQuestions).values({
      projectId: m.projectId, position: maxPos + 1, text, askedByName: askedBy, askedByPersonId: asker?.id ?? null, department, ownerName: owner, ownerPersonId: ownerP?.id ?? null,
      state: 'open', answer: null,
    });
    await tx.update(meetingTranscriptProposals).set({ status: 'applied', appliedRef: 'Q&A', text, ...(await reviewer(tx, actorName)) })
      .where(and(eq(meetingTranscriptProposals.meetingId, m.id), eq(meetingTranscriptProposals.position, position)));
    await auditMeeting(tx, actorName, meetingNumber, `client question added from the transcript · ${text}`, m.projectId, m.id);
  });
}
