// R-010 — optimistic locking rules: the token, the verdict on a version that moved, the refusal text.
import { describe, expect, it } from 'vitest';
import { freshness, parseVersionToken, staleRecordText, versionToken, type RecordChange } from './record-version';

const READ = new Date('2026-10-29T13:00:00.000Z');
const tok = { version: 3, readAt: READ.getTime() };
const me = { name: 'Marie Lefebvre', personId: 'p-marie' };
const change = (actorName: string, actorPersonId: string | null, iso: string): RecordChange => ({ actorName, actorPersonId, at: new Date(iso) });

describe('version token', () => {
  it('round-trips the version and the read time', () => {
    expect(versionToken(3, READ)).toBe(`3.${READ.getTime()}`);
    expect(parseVersionToken(versionToken(3, READ))).toEqual(tok);
    expect(parseVersionToken(` ${versionToken(12, READ)} `)).toEqual({ version: 12, readAt: READ.getTime() });
  });

  it('refuses what a form could forge or truncate', () => {
    for (const raw of [undefined, null, 3, '', '3', '3.', '.123', 'a.b', '0.123', '-1.5', '3.12.5', '1'.repeat(10) + '.1', '3.' + '9'.repeat(16)])
      expect(parseVersionToken(raw)).toBeNull();
  });
});

describe('freshness', () => {
  it('same version: saved', () => {
    expect(freshness(3, tok, [], me)).toEqual({ ok: true });
    expect(freshness(3, tok, [change('Romain Aubert', 'p-romain', '2026-10-29T13:01:00Z')], me)).toEqual({ ok: true });
  });

  it('changed by someone else since the read: refused, naming the last other change', () => {
    const r = freshness(5, tok, [
      change('Romain Aubert', 'p-romain', '2026-10-29T13:01:00Z'),
      change('Léa Marchand', 'p-lea', '2026-10-29T13:04:00Z'),
      change('Marie Lefebvre', 'p-marie', '2026-10-29T13:06:00Z'),
    ], me);
    expect(r).toEqual({ ok: false, by: 'Léa Marchand', at: new Date('2026-10-29T13:04:00Z') });
  });

  it('only the saver\'s own changes since the read (a second edit before the page refreshed): saved', () => {
    expect(freshness(4, tok, [change('Marie Lefebvre', 'p-marie', '2026-10-29T13:01:00Z')], me)).toEqual({ ok: true });
    // Without a person on either side, the display names are compared.
    expect(freshness(4, tok, [change('Marie Lefebvre', null, '2026-10-29T13:01:00Z')], { name: 'Marie Lefebvre', personId: null })).toEqual({ ok: true });
    // A system writer (an import) is someone else.
    expect(freshness(4, tok, [change('Lucca', null, '2026-10-29T13:01:00Z')], me)).toEqual({ ok: false, by: 'Lucca', at: new Date('2026-10-29T13:01:00Z') });
  });

  it('a version that moved without any recorded change: refused without a name', () => {
    expect(freshness(4, tok, [], me)).toEqual({ ok: false, by: null, at: null });
  });
});

describe('refusal text', () => {
  const at = new Date('2026-10-29T13:05:00Z'); // 14:05 in Paris
  it('names who and when, in the viewer\'s language (Paris time)', () => {
    expect(staleRecordText({ by: 'Romain Aubert', at }, 'fr')).toBe('Fiche modifiée entre-temps par Romain Aubert le 29 oct. 2026 à 14:05 — rechargez pour voir ses changements');
    expect(staleRecordText({ by: 'Romain Aubert', at }, 'en')).toBe('Record modified meanwhile by Romain Aubert on 29 Oct 2026, 14:05 — reload to see their changes');
  });
  it('without a recorded change', () => {
    expect(staleRecordText({ by: null, at: null }, 'fr')).toBe('Fiche modifiée entre-temps — rechargez pour voir les changements');
    expect(staleRecordText({ by: null, at: null }, 'en')).toBe('Record modified meanwhile by someone else — reload to see the changes');
  });
});
