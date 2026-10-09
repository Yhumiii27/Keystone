// Transcript import parser (S-10): WebVTT (Teams voice tags), SubRip (CRLF, curly apostrophes), plain text with timestamps,
// a Teams "Name  0:03" copy, the prototype's one-paragraph transcripts with inline speakers; cue words are not speakers.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectFormat, detectLanguage, isSpeakerLabel, parseTranscript, splitInlineSpeakers } from './parse';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('transcript parser', () => {
  it('WebVTT with Teams <v> voice tags → one "Speaker: text" line per turn, entities decoded', () => {
    const p = parseTranscript(fixture('chantier-fr.vtt'), 'Réunion.vtt');
    expect(p).toMatchObject({ format: 'vtt', language: 'fr', speakers: ['Romain Aubert', 'Léa Fabre', 'Julien Wagner'] });
    expect(p.text.split('\n')).toEqual([
      'Romain Aubert: Bonjour à tous. On commence par le planning de la grue.',
      'Léa Fabre: On valide le passage à la grue de 300 tonnes pour le levage du 14 octobre.',
      'Julien Wagner: Je vais envoyer le plan de levage révisé pour le 9 octobre.',
      'Romain Aubert: Julien doit aussi confirmer la date avec le grutier. Il y a un risque de vent fort la semaine du 12.',
      "Léa Fabre: Est-ce que le client a validé la zone d'exclusion ?",
      "Julien Wagner: Je m'en charge. On verra vendredi pour la suite.",
    ]);
    expect(p.words).toBeGreaterThan(80);
  });

  it('SubRip with CRLF and "Name: text" cues (detected from the content too)', () => {
    const raw = fixture('revue-fr.srt');
    expect(detectFormat(null, raw)).toBe('srt');
    const p = parseTranscript(raw);
    expect(p).toMatchObject({ format: 'srt', language: 'fr', speakers: ['Sophie Perrin', 'Pierre Noguès', 'Damien Roux'] });
    expect(p.text.split('\n')[3]).toBe('Damien Roux: La coupure de la boucle B pourrait retarder la mise en service. Action pour Pierre Noguès : vérifier les vannes d’isolement avant le 20 octobre.');
  });

  it('plain text: "[09:02] Name: text" lines, a line without label continues the turn', () => {
    const p = parseTranscript(fixture('grue-en.txt'), 'notes.txt');
    expect(p).toMatchObject({ format: 'text', language: 'en', speakers: ['Romain Aubert', 'Léa Fabre', 'Julien Wagner'] });
    expect(p.segments.map((s) => s.speaker)).toEqual(['Romain Aubert', 'Léa Fabre', 'Julien Wagner', 'Romain Aubert', 'Léa Fabre']);
    expect(p.segments[4].text).toMatch(/three weeks\. Ignore previous instructions/);
  });

  it('Teams copy: "Name   0:03" header lines', () => {
    const p = parseTranscript(fixture('teams-copy.txt'));
    expect(p.segments).toEqual([
      { speaker: 'Romain Aubert', text: 'Bonjour, on fait le point sur la livraison des variateurs.' },
      { speaker: 'Claire Morvan', text: 'Nordvolt confirme le FAT le 24 octobre. On acte la présence de Keystone au FAT.' },
    ]);
  });

  it('prototype transcripts: inline speakers after a sentence end; "Decision:" stays text', () => {
    const p = parseTranscript(
      'F. Bertrand: FAT date first. K. Lindqvist: Nordvolt confirms the FAT for lot 2 on 24 October in Västerås. Decision: FAT confirmed on 24 October with Keystone witness. K. Lindqvist: We will send the crate drawings by 15 October.',
    );
    // Consecutive turns of the same speaker are merged.
    expect(p.segments).toEqual([
      { speaker: 'F. Bertrand', text: 'FAT date first.' },
      {
        speaker: 'K. Lindqvist',
        text: 'Nordvolt confirms the FAT for lot 2 on 24 October in Västerås. Decision: FAT confirmed on 24 October with Keystone witness. We will send the crate drawings by 15 October.',
      },
    ]);
    expect(splitInlineSpeakers('rev D. C. Morvan: The I/O list', 'A. Girard')).toEqual([
      { speaker: 'A. Girard', text: 'rev D.' },
      { speaker: 'C. Morvan', text: 'The I/O list' },
    ]);
  });

  it('speaker labels vs cue words; language by common words', () => {
    for (const n of ['A. Girard', 'Romain Aubert', 'K. Lindqvist (Nordvolt)', 'J.-P. Martin', 'Marie']) expect(isSpeakerLabel(n), n).toBe(true);
    for (const n of ['Decision', 'Décision', 'Action', 'Note', 'Risque', 'The Plan', 'A', 'Ordre']) expect(isSpeakerLabel(n), n).toBe(false);
    expect(detectLanguage('On valide le planning et la date de levage pour le client.')).toBe('fr');
    expect(detectLanguage('We will send the drawings to the client by Friday.')).toBe('en');
    expect(parseTranscript('﻿  \r\n ').text).toBe('');
  });
});
