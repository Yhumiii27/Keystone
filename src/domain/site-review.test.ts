// Delivery 8 integration review fixes — the pure rules: a contractor crew is never typed with the name of a person Keystone
// knows (R-118 / R-119), and a Cursus clearance conflict's key stays bounded whatever the length of Cursus's note (R-119).
import { describe, expect, it } from 'vitest';
import { parseDateInput } from './contract';
import { siteConflicts, type ConflictFacts } from './site';
import { CONTRACTOR_CREW, CREW_IS_PERSON, isKnownPersonName, parseRotationForm, parseSiteLine } from './site-sheet';

const pd = (s: string) => parseDateInput(s, 2026);

describe('a contractor crew is not a known person (R-118)', () => {
  const known = ['Amélie Ollivier', 'A. Ollivier', 'Marion Kerviel', 'M. Kerviel'];
  const team = ['Julien Wagner'];
  const base = { role: 'Expertise', from: '12 Oct 2026', to: '23 Oct 2026' };
  const crew = (name: string) => {
    const r = parseRotationForm({ ...base, person: CONTRACTOR_CREW, crew: name }, team, pd, null, known);
    return r.ok ? 'ok' : r.error;
  };

  it('full or short name, whatever the case, accents and spaces: refused', () => {
    for (const name of ['Amélie Ollivier', 'amelie ollivier', '  AMÉLIE   Ollivier ', 'M. Kerviel', 'marion kerviel']) expect([name, crew(name)]).toEqual([name, CREW_IS_PERSON]);
  });

  it('a real crew, or a name merely containing a person’s: accepted; a team member chosen in the list is unaffected', () => {
    expect(crew('Sous-traitant — 3 électriciens')).toBe('ok');
    expect(crew('Équipe Kerviel Levage')).toBe('ok');
    expect(parseRotationForm({ ...base, person: 'Julien Wagner' }, team, pd, null, ['Julien Wagner'])).toMatchObject({ ok: true, value: { crew: false } });
    expect(parseSiteLine('rotation', { ...base, person: CONTRACTOR_CREW, crew: 'A. Ollivier' }, { activities: [], team, known, parseDate: pd }))
      .toEqual({ ok: false, error: CREW_IS_PERSON });
  });

  it('isKnownPersonName: blank never matches', () => {
    expect(isKnownPersonName('', ['', ' '])).toBe(false);
    expect(isKnownPersonName('J. Wagner', [])).toBe(false);
  });
});

describe('Cursus clearance conflict keys are bounded (R-119)', () => {
  const facts = (note: string, arbitrations: ConflictFacts['arbitrations'] = []): ConflictFacts => ({
    rotation: [{ person: 'Pauline Noguès', personId: 'p-pn', department: 'Engineering', fromOn: '2026-11-09', toOn: '2026-12-18' }],
    pool: { weeks: [], people: [] },
    otherSites: [],
    cursus: [
      { personName: 'Pauline Noguès', personId: 'p-pn', clearance: 'expiring', clearanceNote: note },
      { personName: 'Pauline Noguès', personId: 'p-pn', clearance: 'missing', clearanceNote: `${note} · badge` },
    ],
    absences: [],
    arbitrations,
  });

  it('a 1,000-character note: short keys (under the 600-character guard), the note kept whole in the cause', () => {
    const note = 'Habilitation électrique H0B0 à renouveler · '.repeat(30).slice(0, 1000);
    const [cert, doc] = siteConflicts(facts(note));
    expect([cert.kind, doc.kind]).toEqual(['cert', 'doc']);
    expect(cert.key.length).toBeLessThan(40);
    expect(doc.key.length).toBeLessThan(50);
    expect(cert.key).toMatch(/^cert:p:p-pn:[0-9a-z]+$/);
    expect(doc.key).toMatch(/^doc:p:p-pn:missing:[0-9a-z]+$/);
    expect(cert.cause).toEqual({ type: 'cert', note, missionTo: '2026-12-18' });
  });

  it('the same note keeps the arbitration; another note is another cause', () => {
    const [cert] = siteConflicts(facts('HT B2V expires 30 Nov 2026'));
    const arbitrated = siteConflicts(facts('HT B2V expires 30 Nov 2026', [{ key: cert.key, comment: 'ok', by: 'Marie Lefebvre', at: '2026-10-01T08:00:00.000Z' }]));
    expect(arbitrated[0].arbitration).toMatchObject({ comment: 'ok' });
    const changed = siteConflicts(facts('HT B2V expires 4 Dec 2026', [{ key: cert.key, comment: 'ok', by: 'Marie Lefebvre', at: '2026-10-01T08:00:00.000Z' }]));
    expect([changed[0].key === cert.key, changed[0].arbitration]).toEqual([false, null]);
  });
});
