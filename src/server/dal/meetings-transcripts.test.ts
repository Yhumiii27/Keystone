// Meeting transcripts DAL (chapter 4, S-10) against an in-memory database and a temporary file folder (never ./.data):
// import (paste, .vtt file stored by Keystone, replace), analysis (local rules; an injected Claude analyser — no network),
// human review (discard, restore, edit), "Add to minutes" with only the kept proposals, a risk and a client question from
// the proposals, and the refusals.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClaudeAnalysisError } from '@/server/ai/transcripts/claude';
import type { TranscriptAnalyzerImpl } from '@/server/ai/transcripts/types';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { createMeeting, getMeeting, listClientQuestions, sendMinutes } from '@/server/dal/meetings';
import { listAudit } from '@/server/dal/notifications';
import { createRisk, listRisks } from '@/server/dal/risks';
import { listStoredFiles, readStoredText, setFilesRoot } from '@/server/storage/files';
import {
  addTranscriptQuestion, analyseTranscript, applyTranscriptToMinutes, decodeTranscriptFile, importTranscript, markTranscriptProposalApplied, setTranscriptProposalStatus,
  TranscriptError, updateTranscriptProposal,
} from './meetings-transcripts';

let dir = '';
const enc = (s: string) => new TextEncoder().encode(s);
const VTT = `WEBVTT

00:00:01.000 --> 00:00:05.000
<v Romain Aubert>On valide la grue de 300 tonnes pour le levage.</v>

00:00:05.500 --> 00:00:09.000
<v Julien Wagner>Je vais envoyer le plan de levage pour le 9 octobre.</v>

00:00:09.500 --> 00:00:13.000
<v Léa Fabre>Il y a un risque de vent fort la semaine du 12. Est-ce que le client a validé la zone ?</v>
`;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-transcripts-'));
  setFilesRoot(dir);
  setDb(await openDatabase());
}, 60_000);
afterAll(() => {
  setFilesRoot(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('transcript import', () => {
  it('pasted text on MTG-118 (no transcript yet): stored readable, not analysed, audited', async () => {
    const r = await importTranscript('MTG-118', { text: 'R. Aubert: We agreed to keep the night shift.\nJ. Wagner: I will update the access plan by 2 October.' }, 'Romain Aubert');
    expect(r).toEqual({ replaced: false, format: 'text', words: 20, speakers: 2, language: 'en' });
    const m = (await getMeeting('MTG-118'))!;
    expect(m.transcript).toMatchObject({
      text: 'R. Aubert: We agreed to keep the night shift.\nJ. Wagner: I will update the access plan by 2 October.', analysed: false, applied: false, source: 'paste',
      fileName: null, language: 'en', analyzer: null, importedBy: 'Romain Aubert', items: [], proposals: [],
    });
    expect((await listAudit())[0]).toMatchObject({ object: 'MTG-118', who: 'Romain Aubert' });
  });

  it('a .vtt file on a new meeting is stored by Keystone (data dir), then replaced (the old file is deleted)', async () => {
    const n = await createMeeting('HLT-026', { title: 'Levage', type: 'internal', series: 'one_off', date: '2026-10-07', time: '09:00', location: 'Teams', invitees: ['R. Aubert', 'L. Fabre', 'J. Wagner'], agenda: ['Levage'] }, 'Romain Aubert');
    expect(n).toBe('MTG-130');
    const r = await importTranscript(n, { file: { name: 'levage.vtt', data: enc(VTT) } }, 'Romain Aubert');
    expect(r).toMatchObject({ replaced: false, format: 'vtt', speakers: 3, language: 'fr' });
    const m = (await getMeeting(n))!;
    expect(m.transcript).toMatchObject({ source: 'file', fileName: 'levage.vtt', language: 'fr' });
    expect(m.transcript!.text.split('\n')[0]).toBe('Romain Aubert: On valide la grue de 300 tonnes pour le levage.');
    const [meta] = await listStoredFiles('meeting', (await getMeetingId(n))!);
    expect(meta).toMatchObject({ purpose: 'transcript', name: 'levage.vtt', mime: 'text/vtt' });
    expect((await readStoredText(meta.id))!.text).toBe(VTT);

    const again = await importTranscript(n, { file: { name: 'levage-v2.vtt', data: enc(VTT.replace('300', '400')) } }, 'Léa Fabre');
    expect(again.replaced).toBe(true);
    const files = await listStoredFiles('meeting', (await getMeetingId(n))!);
    expect(files.map((f) => f.name)).toEqual(['levage-v2.vtt']);
    expect(await readStoredText(meta.id)).toBeNull();
  });

  it('refusals: empty, too long, minutes sent; Windows-1252 files are decoded', async () => {
    await expect(importTranscript('MTG-119', { text: '  \n ' }, 'Romain Aubert')).rejects.toThrow(new TranscriptError('The transcript is empty'));
    await expect(importTranscript('MTG-119', { text: 'a '.repeat(500_000) }, 'Romain Aubert')).rejects.toThrow('The transcript is too long');
    await expect(importTranscript('MTG-117', { text: 'R. Aubert: late' }, 'Romain Aubert')).rejects.toThrow('Minutes already sent');
    expect(decodeTranscriptFile(new Uint8Array([0x44, 0xe9, 0x63, 0x69, 0x73, 0x69, 0x6f, 0x6e]))).toBe('Décision');
    expect(decodeTranscriptFile(enc('﻿OK'))).toBe('OK');
  });
});

async function getMeetingId(n: string) {
  const { getDb } = await import('@/server/db/client');
  const { meetings } = await import('@/server/db/schema');
  const { eq } = await import('drizzle-orm');
  const [m] = await (await getDb()).select({ id: meetings.id }).from(meetings).where(eq(meetings.number, n));
  return m?.id ?? null;
}

describe('analysis and review', () => {
  it('local analysis of MTG-130: decision, action with owner and due, risk, client question — all proposed', async () => {
    const run = await analyseTranscript('MTG-130', 'Romain Aubert');
    expect(run).toEqual({ analyzer: 'local', model: null, notice: null, counts: { decision: 1, action: 1, risk: 1, question: 1 } });
    const tr = (await getMeeting('MTG-130'))!.transcript!;
    expect(tr).toMatchObject({ analysed: true, analyzer: 'local', analyzerModel: null, notice: null, applied: false });
    expect(tr.items.map((x) => [x.position, x.type, x.text, x.owner, x.due, x.status])).toEqual([
      [0, 'decision', 'On valide la grue de 400 tonnes pour le levage', null, null, 'proposed'],
      [1, 'action', 'Envoyer le plan de levage', 'Julien Wagner', '9 Oct', 'proposed'],
      [2, 'risk', 'Il y a un risque de vent fort la semaine du 12', null, null, 'proposed'],
      [3, 'question', 'Est-ce que le client a validé la zone ?', null, null, 'proposed'],
    ]);
    expect(tr.summary).toMatch(/^Décisions — On valide la grue de 400 tonnes/);
  });

  it('review: discard, restore, edit (owner and due of an action); "Add to minutes" adds only the kept decisions and actions', async () => {
    await setTranscriptProposalStatus('MTG-130', 0, 'rejected', 'Romain Aubert');
    let tr = (await getMeeting('MTG-130'))!.transcript!;
    expect(tr.items[0]).toMatchObject({ status: 'rejected', reviewedBy: 'Romain Aubert' });
    expect(tr.proposals.map((p) => p.type)).toEqual(['action']);
    await setTranscriptProposalStatus('MTG-130', 0, 'proposed', 'Romain Aubert');
    await updateTranscriptProposal('MTG-130', 1, { text: 'Envoyer le plan de levage révisé', owner: 'J. Wagner', due: '8 oct.' }, 'Romain Aubert');
    await setTranscriptProposalStatus('MTG-130', 0, 'rejected', 'Romain Aubert');
    await expect(updateTranscriptProposal('MTG-130', 1, { text: ' ' }, 'Romain Aubert')).rejects.toThrow('Write a note first');

    expect(await applyTranscriptToMinutes('MTG-130', 'Romain Aubert')).toBe(1);
    expect(await applyTranscriptToMinutes('MTG-130', 'Romain Aubert')).toBe(0);
    const m = (await getMeeting('MTG-130'))!;
    expect(m.agenda[0].lines).toEqual([
      expect.objectContaining({ type: 'action', text: 'Envoyer le plan de levage révisé', owner: 'J. Wagner', due: '8 Oct', dueDate: '2026-10-08', origin: 'transcript' }),
    ]);
    tr = m.transcript!;
    expect(tr.applied).toBe(true);
    expect(tr.items.map((x) => [x.status, x.appliedRef])).toEqual([['rejected', null], ['applied', 'MTG-130|0|0'], ['proposed', null], ['proposed', null]]);
    // Once something was added, the analysis cannot be replaced and applied proposals cannot change.
    await expect(analyseTranscript('MTG-130', 'Romain Aubert')).rejects.toThrow('Proposals were already added · the analysis cannot be replaced');
    await expect(setTranscriptProposalStatus('MTG-130', 1, 'rejected', 'Romain Aubert')).rejects.toThrow('This proposal was already added');
  });

  it('a risk proposal → the risk register (the Server Function calls createRisk, then marks the proposal)', async () => {
    const number = await createRisk('HLT-026', { title: 'Vent fort la semaine du 12', category: 'hse', response: 'mitigate', owner: 'L. Fabre' }, 'Romain Aubert');
    await markTranscriptProposalApplied('MTG-130', 2, number, 'Romain Aubert');
    expect((await getMeeting('MTG-130'))!.transcript!.items[2]).toMatchObject({ status: 'applied', appliedRef: number });
    expect((await listRisks('HLT-026')).some((r) => r.id === number)).toBe(true);
  });

  it('a question proposal → an open question of the client bridge', async () => {
    const before = (await listClientQuestions('HLT-026')).length;
    await expect(addTranscriptQuestion('MTG-130', 1, { text: 'x', askedBy: 'L. Fabre', owner: 'R. Aubert' }, 'Romain Aubert')).rejects.toThrow('Unknown proposal');
    await addTranscriptQuestion('MTG-130', 3, { text: 'Le client a-t-il validé la zone d’exclusion ?', askedBy: 'L. Fabre', department: '', owner: 'R. Aubert' }, 'Romain Aubert');
    const qs = await listClientQuestions('HLT-026');
    expect(qs).toHaveLength(before + 1);
    expect(qs.at(-1)).toEqual({ text: 'Le client a-t-il validé la zone d’exclusion ?', askedBy: 'L. Fabre', department: '—', owner: 'R. Aubert', state: 'open', answer: null });
    expect((await getMeeting('MTG-130'))!.transcript!.items[3]).toMatchObject({ status: 'applied', appliedRef: 'Q&A' });
  });

  it('Claude (injected, no network): its proposals are stored with the model; a failure falls back to the local rules with a notice', async () => {
    const claude: TranscriptAnalyzerImpl = {
      id: 'claude', model: 'claude-opus-5-5',
      analyse: vi.fn(async () => ({
        summary: 'Night shift kept; access plan due 2 Oct.', language: 'en',
        proposals: [{ type: 'action' as const, text: 'Update the access plan', owner: 'J. Wagner', due: '2 Oct', dueDate: '2026-10-02', speaker: 'J. Wagner', quote: 'I will update the access plan by 2 October.' }],
      })),
    };
    expect(await analyseTranscript('MTG-118', 'Romain Aubert', { claude })).toEqual({ analyzer: 'claude', model: 'claude-opus-5-5', notice: null, counts: { decision: 0, action: 1, risk: 0, question: 0 } });
    expect((await getMeeting('MTG-118'))!.transcript).toMatchObject({ analyzer: 'claude', analyzerModel: 'claude-opus-5-5', summary: 'Night shift kept; access plan due 2 Oct.' });

    const failing: TranscriptAnalyzerImpl = { id: 'claude', model: 'claude-opus-5-5', analyse: async () => Promise.reject(new ClaudeAnalysisError('auth')) };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = await analyseTranscript('MTG-118', 'Romain Aubert', { claude: failing });
    spy.mockRestore();
    expect(run).toEqual({ analyzer: 'local', model: null, notice: 'The Anthropic API key was refused · local analysis used instead', counts: { decision: 1, action: 1, risk: 0, question: 0 } });
    const tr = (await getMeeting('MTG-118'))!.transcript!;
    expect(tr).toMatchObject({ analyzer: 'local', notice: 'The Anthropic API key was refused · local analysis used instead' });
    expect(tr.items.map((x) => [x.type, x.text, x.owner, x.due])).toEqual([
      ['decision', 'Keep the night shift', null, null],
      ['action', 'Update the access plan', 'J. Wagner', '2 Oct'],
    ]);
  });

  it('the seeded MTG-119 transcript: the analysis replaces the pre-recorded proposals; no transcript → refused', async () => {
    expect((await analyseTranscript('MTG-119', 'Antoine Girard')).counts).toEqual({ decision: 3, action: 3, risk: 0, question: 0 });
    expect((await getMeeting('MTG-119'))!.transcript!.items).toHaveLength(6);
    await expect(analyseTranscript('MTG-116', 'Romain Aubert')).rejects.toThrow('This meeting has no transcript');
    await sendMinutes('MTG-118', 'Romain Aubert');
    await expect(importTranscript('MTG-118', { text: 'R. Aubert: again' }, 'Romain Aubert')).rejects.toThrow('Minutes already sent');
  });
});
