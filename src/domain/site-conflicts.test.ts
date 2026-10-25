// R-119 (D-6b 'a': "le conflit disparaît quand sa cause disparaît ; le chef de service peut aussi le marquer « arbitré », avec
// un commentaire") — the pure rules: conflicts computed from the rotation plan (pool load inside its window, another site,
// Cursus clearances, absences), stable keys without the load percentage, arbitrations that hold while the cause is unchanged,
// and who arbitrates (the director, the head of the person's department; for a contractor, the director and the leads).
import { describe, expect, it } from 'vitest';
import { PERSONAS } from '@/config/personas';
import { CONFLICT_FIX, canArbitrateConflict, goChantier, parseArbitration, siteConflicts, type ConflictFacts } from './site';

const WEEKS = ['2026-10-12', '2026-10-19', '2026-10-26'];
const base = (over: Partial<ConflictFacts> = {}): ConflictFacts => ({
  rotation: [
    { person: 'Julien Wagner', personId: 'p-jw', department: 'Engineering', fromOn: '2026-10-19', toOn: '2026-11-13' },
    { person: 'Contractant — 2 monteurs', personId: null, department: null, fromOn: '2026-10-26', toOn: '2026-11-27' },
  ],
  pool: { weeks: WEEKS, people: [{ name: 'Julien Wagner', loads: [130, 125, 110] }] },
  otherSites: [],
  cursus: [],
  absences: [],
  arbitrations: [],
  ...over,
});

describe('siteConflicts (D-6b a)', () => {
  it('Load: the pool weeks of the mission strictly above 110 % (the week before the mission and 110 % itself are not)', () => {
    const [c] = siteConflicts(base());
    expect(c).toMatchObject({ person: 'Julien Wagner', kind: 'load', department: 'Engineering', cause: { type: 'pool', weeks: [{ start: '2026-10-19', pct: 125 }] }, arbitration: null });
    expect(c.key).toBe('load:pool:p:p-jw:2026-10-19');
    expect(c.proposedFix).toBe(CONFLICT_FIX.load);
  });

  it('the key carries no percentage: a load change in the same weeks keeps the arbitration; another week reopens', () => {
    const arbitrations = [{ key: 'load:pool:p:p-jw:2026-10-19', comment: 'Structure work moved to W45', by: 'Marion Kerviel', at: '2026-09-30T08:00:00.000Z' }];
    const moreLoad = siteConflicts(base({ arbitrations, pool: { weeks: WEEKS, people: [{ name: 'Julien Wagner', loads: [130, 140, 100] }] } }));
    expect(moreLoad[0].arbitration).toEqual({ comment: 'Structure work moved to W45', by: 'Marion Kerviel', at: '2026-09-30T08:00:00.000Z' });
    const anotherWeek = siteConflicts(base({ arbitrations, pool: { weeks: WEEKS, people: [{ name: 'Julien Wagner', loads: [130, 125, 115] }] } }));
    expect([anotherWeek[0].key, anotherWeek[0].arbitration]).toEqual(['load:pool:p:p-jw:2026-10-19+2026-10-26', null]);
    // The cause is gone: no conflict (and the arbitration does not matter any more).
    expect(siteConflicts(base({ arbitrations, pool: { weeks: WEEKS, people: [{ name: 'Julien Wagner', loads: [130, 100, 100] }] } }))).toEqual([]);
  });

  it('weeks outside the pool window give no Load conflict', () => {
    expect(siteConflicts(base({ rotation: [{ person: 'Julien Wagner', personId: 'p-jw', department: 'Engineering', fromOn: '2026-11-30', toOn: '2026-12-18' }] }))).toEqual([]);
  });

  it('Load: the same person on another project’s site at overlapping dates (by person, a crew by its name)', () => {
    const cs = siteConflicts(base({
      pool: { weeks: [], people: [] },
      otherSites: [
        { person: 'Julien Wagner', personId: 'p-jw', projectCode: 'RCF-019', fromOn: '2026-11-09', toOn: '2026-11-20' },
        { person: 'Julien Wagner', personId: 'p-jw', projectCode: 'MSR-012', fromOn: '2026-12-01', toOn: '2026-12-10' },
        { person: 'Contractant — 2 monteurs', personId: null, projectCode: 'PRS-038', fromOn: '2026-11-01', toOn: '2026-11-05' },
      ],
    }));
    expect(cs.map((c) => [c.person, c.kind, c.key])).toEqual([
      ['Julien Wagner', 'load', 'load:site:p:p-jw:RCF-019:2026-11-09:2026-11-20'],
      ['Contractant — 2 monteurs', 'load', 'load:site:n:Contractant — 2 monteurs:PRS-038:2026-11-01:2026-11-05'],
    ]);
    expect(cs[1].department).toBeNull();
  });

  it('Cert / Doc from Cursus (expiring; pending or missing), matched by person, else by name; the note is part of the cause', () => {
    const cs = siteConflicts(base({
      pool: { weeks: [], people: [] },
      cursus: [
        { personName: 'J. W. (Cursus)', personId: 'p-jw', clearance: 'expiring', clearanceNote: 'HT B2V expires 30 Nov 2026' },
        { personName: 'Contractant — 2 monteurs', clearance: 'missing', clearanceNote: 'Badge ISPS missing' },
        { personName: 'Someone else', clearance: 'pending', clearanceNote: 'x' },
      ],
    }));
    expect(cs.map((c) => [c.person, c.kind, c.cause])).toEqual([
      ['Julien Wagner', 'cert', { type: 'cert', note: 'HT B2V expires 30 Nov 2026', missionTo: '2026-11-13' }],
      ['Contractant — 2 monteurs', 'doc', { type: 'doc', clearance: 'missing', note: 'Badge ISPS missing', missionFrom: '2026-10-26' }],
    ]);
  });

  it('Leave: absences overlapping the mission, consecutive weeks merged into one period; the type only', () => {
    const cs = siteConflicts(base({
      pool: { weeks: [], people: [] },
      absences: [
        { personId: 'p-jw', leaveType: 'leave', start: '2026-10-12', end: '2026-10-16' },
        { personId: 'p-jw', leaveType: 'leave', start: '2026-10-19', end: '2026-10-23' },
        { personId: 'p-jw', leaveType: 'absence', start: '2026-11-16', end: '2026-11-17' },
      ],
    }));
    expect(cs.map((c) => [c.kind, c.cause, c.key])).toEqual([['leave', { type: 'leave', leaveType: 'leave', start: '2026-10-12', end: '2026-10-23' }, 'leave:p:p-jw:leave:2026-10-12:2026-10-23']]);
  });

  it('the Go condition counts the open conflicts only', () => {
    const cs = siteConflicts(base({ arbitrations: [{ key: 'load:pool:p:p-jw:2026-10-19', comment: 'ok', by: 'Marie Lefebvre', at: '2026-09-30T08:00:00.000Z' }] }));
    const go = goChantier({ prerequisites: [], people: [{ verdict: 'go' }], equipment: [], collisions: cs.map((c) => ({ resolved: !!c.arbitration })), hse: [] });
    expect(go.conditions.find((c) => c.key === 'collisions')).toMatchObject({ ok: true, sub: 'Ready' });
  });
});

describe('canArbitrateConflict (D-6b a, default for contractors)', () => {
  const ENGINEERING = { department: 'Engineering' };
  const CREW = { department: null };
  it('a person of a department: the director and that department’s head; nobody else (the 9 personas)', () => {
    const headed: Record<string, string[]> = { depthead: ['Engineering'], quality: ['Quality'] };
    const out = Object.fromEntries(PERSONAS.map((p) => [p.role, canArbitrateConflict(p.role, { headed: headed[p.role] ?? [], lead: p.role === 'pm' }, ENGINEERING)]));
    expect(out).toEqual({ director: true, pm: false, depthead: true, member: false, englead: false, quality: false, procurement: false, finance: false, logistics: false, client: false });
    expect(canArbitrateConflict('quality', { headed: ['Quality'], lead: false }, { department: 'Quality' })).toBe(true);
  });

  it('a contractor crew or a person without a department: the director and the project’s leads', () => {
    const out = Object.fromEntries(PERSONAS.map((p) => [p.role, canArbitrateConflict(p.role, { headed: ['Engineering'], lead: p.role === 'pm' || p.role === 'member' }, CREW)]));
    expect(out).toEqual({ director: true, pm: true, depthead: false, member: true, englead: false, quality: false, procurement: false, finance: false, logistics: false, client: false });
    expect(canArbitrateConflict('client', { headed: [], lead: true }, CREW)).toBe(false);
    expect(canArbitrateConflict('admin' as never, { headed: ['Engineering'], lead: true }, ENGINEERING)).toBe(false);
  });

  it('the comment is required and bounded', () => {
    expect(parseArbitration({ comment: '  Accepted: QC visit moved  ' })).toEqual({ ok: true, value: { comment: 'Accepted: QC visit moved' } });
    expect(parseArbitration({})).toEqual({ ok: false, error: 'A comment is required' });
    expect(parseArbitration({ comment: 'x'.repeat(1001) })).toEqual({ ok: false, error: 'The comment is too long' });
  });
});
