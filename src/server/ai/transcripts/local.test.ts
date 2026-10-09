// Local rule-based transcript analyser (S-10 default): golden proposals on the prototype's three transcripts and on French
// and English fixtures (VTT, SRT, plain text). Deterministic: the same input gives the same output.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROTO } from '@/server/prototype';
import { analyseLocally, findDates, resolveOwner, splitSentences } from './local';
import { parseTranscript } from './parse';
import type { ProposalDraft } from './types';

const T = PROTO.MTG_TRANSCRIPTS as Record<string, string>;
const rows = (ps: ProposalDraft[]) => ps.map((p) => [p.type, p.text, p.owner, p.due, p.speaker]);
const fixture = (name: string) => parseTranscript(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'), name).text;

describe('local transcript analyser — prototype transcripts', () => {
  it('MTG-119: three decisions, three actions; owners from the speakers, dues only when said', () => {
    const r = analyseLocally({ text: T['MTG-119'], meetingTitle: 'Engineering coordination — automation', meetingDate: '2026-10-01', participants: ['A. Girard', 'C. Morvan', 'S. Haddad', 'P. Noguès'] });
    expect(r.language).toBe('en');
    expect(rows(r.proposals)).toEqual([
      ['decision', 'Freeze the I/O list on rev D by Friday', null, null, 'C. Morvan'],
      ['action', 'Update the electrical schematics for the three tags', 'S. Haddad', '6 Oct', 'S. Haddad'],
      ['decision', 'On inconsistencies C-04 and C-05, we agree to close C-04 as a drawing error and keep C-05 open until the supplier confirms the status word mapping', null, null, 'A. Girard'],
      ['action', 'Send the corrected P&ID sheet for C-04', 'P. Noguès', '3 Oct', 'P. Noguès'],
      ['decision', 'For the client question on the HV cell date, electrical can confirm we need the cell energised by 20 November at the latest — that is the answer to give the port authority', null, null, 'C. Morvan'],
      ['action', 'Carry it to the steering committee', 'A. Girard', null, 'A. Girard'],
    ]);
    expect(r.proposals[1]).toMatchObject({ dueDate: '2026-10-06', quote: 'I will update the electrical schematics for the three tags before 6 October.' });
    expect(r.summary).toMatch(/^Decisions — Freeze the I\/O list on rev D by Friday; .* 3 actions \(S\. Haddad, P\. Noguès, A\. Girard\)\.$/);
  });

  it('MTG-120 / MTG-121: "Decision:" / "Decision —" labels, "<Org> to <verb>" with the invitee organisation', () => {
    const r120 = analyseLocally({ text: T['MTG-120'], meetingTitle: 'Supplier review', meetingDate: '2026-10-03', participants: ['F. Bertrand', 'C. Morvan', 'K. Lindqvist (Nordvolt)'] });
    expect(rows(r120.proposals)).toEqual([
      ['action', 'Issue the mapping rev B', 'K. Lindqvist', '10 Oct', 'K. Lindqvist'],
      ['action', 'Confirm crate dimensions', 'Nordvolt', null, 'F. Bertrand'],
      ['decision', 'FAT confirmed on 24 October with Keystone witness', null, null, 'F. Bertrand'],
      ['action', 'Send the crate drawings', 'K. Lindqvist', '15 Oct', 'K. Lindqvist'],
    ]);
    const r121 = analyseLocally({ text: T['MTG-121'], meetingTitle: 'Kick-off', meetingDate: '2026-09-30', participants: ['S. Perrin', 'P. Noguès', 'D. Roux'] });
    expect(rows(r121.proposals)).toEqual([
      ['action', 'Issue P&ID rev C for the cooling loop', 'P. Noguès', '10 Oct', 'P. Noguès'],
      ['action', "Confirm the window with the client's operations team", 'D. Roux', null, 'D. Roux'],
      ['decision', "Phase 2 cut-over targeted on 2 November, before the client's freeze", null, null, 'S. Perrin'],
      ['action', 'Prepare the isolation method statement', 'D. Roux', '17 Oct', 'D. Roux'],
    ]);
    expect(r121.summary).toBe("Decisions — Phase 2 cut-over targeted on 2 November, before the client's freeze. 3 actions (P. Noguès, D. Roux).");
  });
});

describe('local transcript analyser — fixtures', () => {
  const participants = ['R. Aubert', 'L. Fabre', 'J. Wagner'];

  it('French VTT: "on valide", "je vais … pour le 9 octobre", "<Prénom> doit", risque, "Est-ce que … ?"', () => {
    const r = analyseLocally({ text: fixture('chantier-fr.vtt'), meetingTitle: 'Levage', meetingDate: '2026-10-07', participants });
    expect(rows(r.proposals)).toEqual([
      ['decision', 'On valide le passage à la grue de 300 tonnes pour le levage du 14 octobre', null, null, 'Léa Fabre'],
      ['action', 'Envoyer le plan de levage révisé', 'Julien Wagner', '9 Oct', 'Julien Wagner'],
      ['action', 'Confirmer la date avec le grutier', 'Julien Wagner', null, 'Romain Aubert'],
      ['risk', 'Il y a un risque de vent fort la semaine du 12', null, null, 'Romain Aubert'],
      ['question', "Est-ce que le client a validé la zone d'exclusion ?", null, null, 'Léa Fabre'],
    ]);
    expect(r).toMatchObject({ language: 'fr', summary: 'Décisions — On valide le passage à la grue de 300 tonnes pour le levage du 14 octobre. 2 actions (Julien Wagner). 1 risque signalé. 1 question à traiter.' });
  });

  it('French SRT: future tense, "Décision :" label, "pourrait retarder", "Action pour <Nom> :" with "avant le 20 octobre"', () => {
    const r = analyseLocally({ text: fixture('revue-fr.srt'), meetingTitle: 'Revue', meetingDate: '2026-10-07', participants: [] });
    expect(rows(r.proposals)).toEqual([
      ['action', 'J’enverrai le P&ID rév. C', 'Pierre Noguès', '16 Oct', 'Pierre Noguès'],
      ['decision', 'On garde la redondance N+1 pendant les travaux', null, null, 'Sophie Perrin'],
      ['risk', 'La coupure de la boucle B pourrait retarder la mise en service', null, null, 'Damien Roux'],
      ['action', 'Vérifier les vannes d’isolement', 'Pierre Noguès', '20 Oct', 'Damien Roux'],
    ]);
  });

  it('English text: "we agreed to", "I\'ll … by October 9", "H. Sauvage will … before 13/10"; a lone capitalised word is no owner; injected instructions are just text', () => {
    const r = analyseLocally({ text: fixture('grue-en.txt'), meetingTitle: 'Crane', meetingDate: '2026-10-07', participants });
    expect(rows(r.proposals)).toEqual([
      ['decision', 'Use the 300 t crane for the lift on 14 October', null, null, 'Léa Fabre'],
      ['action', 'Send the revised lifting plan', 'Julien Wagner', '9 Oct', 'Julien Wagner'],
      ['risk', 'There is a risk of strong wind in the week of 12 October', null, null, 'Julien Wagner'],
      ['question', 'Can the client confirm the exclusion zone?', null, null, 'Romain Aubert'],
      ['action', 'Check the outrigger mats', 'H. Sauvage', '13 Oct', 'Léa Fabre'],
    ]);
  });

  it('meeting-flow phrases are not actions; nothing found → an explicit summary', () => {
    const r = analyseLocally({ text: 'R. Aubert: We will start with safety. On va commencer par la sécurité. Let me go through the agenda.', meetingTitle: 'x', meetingDate: '2026-10-07', participants });
    expect(r.proposals).toEqual([]);
    expect(r.summary).toBe('No decision, action, risk or question found in the transcript.');
  });

  it('is deterministic', () => {
    const input = { text: fixture('chantier-fr.vtt'), meetingTitle: 'Levage', meetingDate: '2026-10-07', participants };
    expect(analyseLocally(input)).toEqual(analyseLocally(input));
  });
});

describe('local analyser helpers', () => {
  it('sentences: initials and abbreviations do not end a sentence', () => {
    expect(splitSentences('S. Haddad sends rev. C today. Then we close. M. Dupont agrees!')).toEqual(['S. Haddad sends rev. C today.', 'Then we close.', 'M. Dupont agrees!']);
  });

  it('dates: day + month (EN / FR), month + day, dd/mm, ISO; next year when the month is long gone; due words preferred', () => {
    expect(findDates('lot 2 on 24 October, by 3 Nov, avant le 1er décembre, 06/10, 2027-01-15', '2026-10-01').map((d) => [d.iso, d.due])).toEqual([
      ['2026-10-24', true], ['2026-11-03', true], ['2026-12-01', true], ['2026-10-06', false], ['2027-01-15', false],
    ]);
    expect(findDates('pour le 10 janvier', '2026-12-15')[0].iso).toBe('2027-01-10');
    expect(findDates('le 31 février', '2026-10-01')).toEqual([]);
  });

  it('owners: first or last name resolved against the known names, otherwise as said', () => {
    const known = ['Julien Wagner', 'J. Wagner', 'Léa Fabre', 'Nordvolt'];
    expect(resolveOwner('Léa', known)).toBe('Léa Fabre');
    expect(resolveOwner('nordvolt', known)).toBe('Nordvolt');
    expect(resolveOwner('Martin', known)).toBe('Martin');
  });
});
