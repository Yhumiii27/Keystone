// R-149 (R-8b a): the @mention parser — full and short names, case and accents ignored, longest match first, boundaries,
// distinct persons, ambiguous names, highlighting parts and the notification excerpt.
import { describe, expect, it } from 'vitest';
import { findMentions, mentionExcerpt, mentionParts, mentionedKeys, type MentionCandidate } from './mentions';

const PEOPLE: MentionCandidate[] = [
  { key: 'jw', fullName: 'Julien Wagner', shortName: 'J. Wagner' },
  { key: 'hs', fullName: 'Hélène Sauvage', shortName: 'H. Sauvage' },
  { key: 'sp', fullName: null, shortName: 'S. Perrin' },
  { key: 'jul', fullName: 'Julien', shortName: 'Julien B.' },
  { key: 'nb', fullName: 'Nadia Bensaïd', shortName: 'N. Bensaïd' },
];

describe('mentions (R-149)', () => {
  it('full name and short name, case and accents ignored', () => {
    expect(mentionedKeys('@Julien Wagner can you check?', PEOPLE)).toEqual(['jw']);
    expect(mentionedKeys('Thanks @j. wagner', PEOPLE)).toEqual(['jw']);
    expect(mentionedKeys('cc @helene sauvage and @H. SAUVAGE', PEOPLE)).toEqual(['hs']);
    expect(mentionedKeys('@Nadia Bensaid', PEOPLE)).toEqual(['nb']);
  });

  it('a person known by the short name only (full name null)', () => {
    expect(mentionedKeys('@S. Perrin please', PEOPLE)).toEqual(['sp']);
  });

  it('longest match first: "@Julien Wagner" is J. Wagner, "@Julien," the other Julien', () => {
    expect(mentionedKeys('@Julien Wagner', PEOPLE)).toEqual(['jw']);
    expect(mentionedKeys('@Julien, see above', PEOPLE)).toEqual(['jul']);
    expect(mentionedKeys('@Julien Wagnerx', PEOPLE)).toEqual(['jul']); // "Wagnerx" is not Wagner: the shorter name still ends at a boundary
  });

  it('boundaries: not inside an e-mail address, not glued to a longer word; punctuation after the name is fine', () => {
    expect(mentionedKeys('mail julien@J. Wagner', PEOPLE)).toEqual([]);
    expect(mentionedKeys('(@J. Wagner), done.', PEOPLE)).toEqual(['jw']);
    expect(mentionedKeys('@J. Wagners', PEOPLE)).toEqual([]);
    expect(mentionedKeys('@ J. Wagner', PEOPLE)).toEqual([]);
  });

  it('distinct persons in order of first mention; unknown names ignored', () => {
    expect(mentionedKeys('@H. Sauvage @J. Wagner @Hélène Sauvage @Nobody Here', PEOPLE)).toEqual(['hs', 'jw']);
    expect(mentionedKeys('no mention', PEOPLE)).toEqual([]);
    expect(mentionedKeys('@J. Wagner', [])).toEqual([]);
  });

  it('a full name held by two persons is ambiguous (nobody); their short names still work', () => {
    const twins: MentionCandidate[] = [
      { key: 'a', fullName: 'Paul Martin', shortName: 'P. Martin' },
      { key: 'b', fullName: 'Paul Martin', shortName: 'Pa. Martin' },
    ];
    expect(mentionedKeys('@Paul Martin', twins)).toEqual([]);
    expect(mentionedKeys('@Pa. Martin and @P. Martin', twins)).toEqual(['b', 'a']);
  });

  it('ranges and parts keep the text as typed (highlighting)', () => {
    const text = 'Hi @hélène sauvage, ask @J. Wagner.';
    expect(findMentions(text, PEOPLE)).toEqual([
      { start: 3, end: 18, key: 'hs' },
      { start: 24, end: 34, key: 'jw' },
    ]);
    expect(mentionParts(text, PEOPLE)).toEqual([
      { text: 'Hi ', mention: false },
      { text: '@hélène sauvage', mention: true },
      { text: ', ask ', mention: false },
      { text: '@J. Wagner', mention: true },
      { text: '.', mention: false },
    ]);
    expect(mentionParts('plain', PEOPLE)).toEqual([{ text: 'plain', mention: false }]);
  });

  it('excerpt: one line, at most 120 characters', () => {
    expect(mentionExcerpt('  Can we confirm\nthe crane slot?  ')).toBe('Can we confirm the crane slot?');
    const long = 'x'.repeat(200);
    expect(mentionExcerpt(long)).toHaveLength(120);
    expect(mentionExcerpt(long).endsWith('…')).toBe(true);
  });
});
