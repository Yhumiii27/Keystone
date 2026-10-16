// Golden values reproduced from the prototype's own logic (design lines 4930–4936 and 4952–4957 run in node:vm on
// STAKEHOLDERS / RACI / INTERFACES, renderValsEN, director): src/server/dal/delivery3.golden.json for the seed, and
// literal values from the same run for the override / added-record states (ifcOv, added.interfaces).
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import GOLDEN from '@/server/dal/delivery3.golden.json';
import { isoOfDisplayDate, interfaceStatus, keystoneSide, stakeholderType } from '@/server/db/codes';
import {
  KEYSTONE_SIDES, STAKEHOLDER_TYPES, daysToNeed, effectiveInterfaceStatus, interfaceRowState, interfacesBadge, isStaleContact, parseNeedDate,
  parseNewInterface, parseNewStakeholder, raciGrid, stakeholderInitials, stakeholderTone, summariseInterfaces, summariseStakeholders,
  type InterfaceFacts, type InterfaceStatus,
} from './team';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
const G = GOLDEN;

type StkTuple = [string, string, string, string, number, number, string, string, string, string, string];
type IfcTuple = [string, string, string, string, string, string, string, string, string];
const STK: StkTuple[] = P.STAKEHOLDERS['HLT-026'];
const IFC: IfcTuple[] = P.INTERFACES['HLT-026'];
const RACI: { roles: string[]; rows: string[][] } = P.RACI['HLT-026'];
const raci = { columns: RACI.roles, rows: RACI.rows };

const iso = (d: string) => isoOfDisplayDate(d)!;
/** The prototype's now (`PG_NOW`, ≈ 30 Sep 2026): the golden comparison passes it explicitly since R-013. */
const PG_NOW = 8.97;
/** Stored status as the seed keeps it ("Late" in the prototype tuple is derived → stored open). */
const stored = (label: string): InterfaceStatus => (label === 'Late' ? 'open' : (interfaceStatus.code(label) as InterfaceStatus));
const facts = (rows: { n: string; needed: string; st: InterfaceStatus }[]): InterfaceFacts[] =>
  rows.map((r) => ({ number: r.n, status: effectiveInterfaceStatus(r.st, iso(r.needed), PG_NOW), daysToNeed: daysToNeed(iso(r.needed), PG_NOW) }));
const seedFacts = (ov: Record<string, InterfaceStatus> = {}) => facts(IFC.map((x) => ({ n: x[0], needed: x[5], st: ov[x[0]] ?? stored(x[7]) })));

/** The EN sentences of ifcKpis, rebuilt from the summary (the feature model formats them the same way). */
const neededSubEn = (f: InterfaceFacts) => {
  const s = interfaceRowState(f).neededSub;
  return !s ? '' : s.kind === 'late' ? `${s.days} d late` : `in ${s.days} d`;
};

describe('stakeholders (stkRows / stkKpis 4931–4936)', () => {
  const rows = STK.map((x) => ({ name: x[0], type: stakeholderType.code(x[3]), owner: x[8], last: x[9], stale: isStaleContact(iso(x[9]), PG_NOW) }));

  it('initials, kind tones and the > 30 days rule match the prototype rows', () => {
    expect(rows.map((r) => stakeholderInitials(r.name))).toEqual(G.stakeholders.rows.map((r) => r.initials));
    expect(rows.map((r) => r.last + (r.stale ? ' · > 30 d' : ''))).toEqual(G.stakeholders.rows.map((r) => r.lastText));
    expect(rows.map((r) => stakeholderTone(r.type))).toEqual(['accent', 'accent', 'outline', 'neutral', 'neutral', 'outline', 'outline', 'outline']);
    // 31 Aug is 30 days before the prototype's now (8.97 → ≈ 30 Sep): not stale; 30 Aug is.
    expect([isStaleContact('2026-08-31', PG_NOW), isStaleContact('2026-08-30', PG_NOW), isStaleContact('2026-09-30', PG_NOW)]).toEqual([false, true, false]);
  });

  it('KPI figures: 8 (2 client · 2 authorities · 2 suppliers & third parties) · 4 owners · 7 RACI rows / 6 roles · 1 stale', () => {
    const s = summariseStakeholders(rows, raci);
    expect(s).toEqual({
      count: 8, clients: 2, authorities: 2, suppliersAndThirdParties: 2, owners: ['R. Aubert', 'L. Fabre', 'F. Bertrand', 'C. Morvan'], raciRows: 7, raciRoles: 6, stale: 1,
    });
    const k = G.stakeholders.kpis;
    expect([s.count, `${s.clients} client · ${s.authorities} authorities · ${s.suppliersAndThirdParties} suppliers & third parties`]).toEqual([k[0].value, k[0].sub]);
    expect([s.owners.length, s.owners.join(' · ')]).toEqual([k[1].value, k[1].sub]);
    expect([s.raciRows, `${s.raciRoles} roles`, s.stale]).toEqual([k[2].value, k[2].sub, k[3].value]);
  });

  it('a project without register or RACI: zeros', () => {
    expect(summariseStakeholders([], null)).toEqual({ count: 0, clients: 0, authorities: 0, suppliersAndThirdParties: 0, owners: [], raciRows: 0, raciRoles: 0, stale: 0 });
  });

  it('added stakeholder (third party, last contact 30 Sep): 9 · 3 suppliers & third parties · not stale', () => {
    const s = summariseStakeholders([...rows, { name: 'Yves Morel', type: 'third_party', owner: 'A. Ollivier', last: '30 Sep', stale: isStaleContact('2026-09-30', PG_NOW) }], raci);
    expect([s.count, s.suppliersAndThirdParties, s.owners.length, s.stale]).toEqual([9, 3, 5, 1]);
  });

  it('RACI grid: 220px label column + one 96px-min column per role; min-width 820px for 6 roles', () => {
    expect(raciGrid(6)).toEqual({ template: '220px repeat(6, minmax(96px,1fr))', minWidth: 820 });
    expect(raciGrid(4).minWidth).toBe(620);
  });
});

describe('interfaces (ifcRows / ifcKpis / ifcBadge 4954–4957)', () => {
  it('effective status, need-date sub-line, alert colour and row actions match the prototype rows', () => {
    const f = seedFacts();
    expect(f.map((r) => interfaceStatus.label(r.status))).toEqual(G.interfaces.rows.map((r) => r.status));
    expect(f.map(neededSubEn)).toEqual(G.interfaces.rows.map((r) => r.neededSub));
    expect(f.map((r) => interfaceRowState(r).neededAlert)).toEqual([false, true, false, false, false, false, true]);
    expect(f.map((r) => [interfaceRowState(r).canReceive, interfaceRowState(r).canFreeze])).toEqual([
      [false, true], [true, false], [false, false], [false, true], [true, false], [false, false], [true, false],
    ]);
  });

  it('KPI figures: 7 (2 frozen · 2 received) · 2 open · 1 late (IF-07) · 2 blocking', () => {
    const s = summariseInterfaces(seedFacts(), ['IF-02', 'IF-05']);
    // A-12 / Q-4 (R-116): the summary no longer carries the prototype's "due within 30 days" count (every future need
    // date); the screen computes it from the data date (dueWithinDays, src/features/team/render.test.ts), so the golden
    // KPI sub k[1].sub is not compared here.
    expect(s).toEqual({ count: 7, frozen: 2, received: 2, open: 2, late: ['IF-07'], blocking: ['IF-02', 'IF-05'] });
    const k = G.interfaces.kpis;
    expect([s.count, `${s.frozen} frozen · ${s.received} received`, s.open, s.late.length, s.late.join(' · '), s.blocking.length]).toEqual([
      k[0].value, k[0].sub, k[1].value, k[2].value, k[2].sub, k[3].value,
    ]);
    expect(interfacesBadge(seedFacts())).toBe('1');
  });

  it('after Mark received IF-07 and IF-02, Freeze IF-01 (ifcOv): 3 frozen · 3 received · 1 open · no late · 1 blocking', () => {
    const f = seedFacts({ 'IF-07': 'received', 'IF-02': 'received', 'IF-01': 'frozen' });
    expect(summariseInterfaces(f, ['IF-02', 'IF-05'])).toEqual({ count: 7, frozen: 3, received: 3, open: 1, late: [], blocking: ['IF-05'] }); // A-12 / Q-4: no dueWithin30
    expect(f.map((r) => [r.number, interfaceStatus.label(r.status), neededSubEn(r), interfaceRowState(r).canReceive, interfaceRowState(r).canFreeze])).toEqual([
      ['IF-01', 'Frozen', '', false, false], ['IF-02', 'Received', '', false, true], ['IF-03', 'Frozen', '', false, false], ['IF-04', 'Received', '', false, true],
      ['IF-05', 'Open', 'in 45 d', true, false], ['IF-06', 'Frozen', '', false, false], ['IF-07', 'Received', '', false, true],
    ]);
    expect(interfacesBadge(f)).toBe('');
  });

  it('added interfaces needed 2 Nov / 1 Oct / 28 Sep: in 32 d · in 1 d (alert) · 2 d late; 4 open, late IF-07 · IF-12', () => {
    const f = [
      ...seedFacts(),
      ...facts([{ n: 'IF-10', needed: '2 Nov', st: 'open' }, { n: 'IF-11', needed: '1 Oct', st: 'open' }, { n: 'IF-12', needed: '28 Sep', st: 'open' }]),
    ];
    expect(f.slice(7).map((r) => [r.number, interfaceStatus.label(r.status), neededSubEn(r), interfaceRowState(r).neededAlert])).toEqual([
      ['IF-10', 'Open', 'in 32 d', false], ['IF-11', 'Open', 'in 1 d', true], ['IF-12', 'Late', '2 d late', true],
    ]);
    const s = summariseInterfaces(f, ['IF-02', 'IF-05']);
    expect([s.count, s.frozen, s.received, s.open, s.late, s.blocking.length]).toEqual([10, 2, 2, 4, ['IF-07', 'IF-12'], 2]); // A-12 / Q-4: no dueWithin30
    expect(interfacesBadge(f)).toBe('2');
  });

  it('a project without interfaces or commissioning blockers: zeros', () => {
    expect(summariseInterfaces([], [])).toEqual({ count: 0, frozen: 0, received: 0, open: 0, late: [], blocking: [] });
  });

  it('received / frozen interfaces are never late, whatever their date; open and needed 30 Sep is late (mIdx 8.967 < PG_NOW 8.97), 0 d', () => {
    expect(effectiveInterfaceStatus('received', '2026-01-01', PG_NOW)).toBe('received');
    expect(effectiveInterfaceStatus('frozen', '2026-01-01', PG_NOW)).toBe('frozen');
    expect([effectiveInterfaceStatus('open', '2026-09-30', PG_NOW), effectiveInterfaceStatus('open', '2026-10-01', PG_NOW)]).toEqual(['late', 'open']);
    expect([daysToNeed('2026-09-30', PG_NOW), daysToNeed('2026-10-01', PG_NOW)]).toEqual([0, 1]);
    expect(interfaceRowState({ number: 'IF-99', status: 'late', daysToNeed: 0 }).neededSub).toEqual({ kind: 'late', days: 0 });
  });
});

describe('add-forms', () => {
  const team = ['Romain Aubert', 'Amélie Ollivier', 'Sami Haddad'];

  it('"Add stakeholder": required name and organisation, Client by default, first TEAM owner, e-mail checked', () => {
    expect(parseNewStakeholder({ name: ' Yves Morel ', org: 'Bureau Veritas', role: 'Inspector', type: 'third_party', contact: 'y.morel@bv.com', owner: 'Amélie Ollivier' }, team)).toEqual({
      ok: true, value: { name: 'Yves Morel', organisation: 'Bureau Veritas', role: 'Inspector', type: 'third_party', contactEmail: 'y.morel@bv.com', owner: 'Amélie Ollivier' },
    });
    expect(parseNewStakeholder({ name: 'A', org: 'B' }, team)).toEqual({
      ok: true, value: { name: 'A', organisation: 'B', role: '', type: 'client', contactEmail: null, owner: 'Romain Aubert' },
    });
    expect(parseNewStakeholder({ name: 'A', org: 'B', type: 'Third party' }, team)).toMatchObject({ ok: true, value: { type: 'third_party' } });
    expect(parseNewStakeholder({ name: ' ', org: 'B' }, team)).toEqual({ ok: false, error: 'Name is required' });
    expect(parseNewStakeholder({ name: 'A', org: '' }, team)).toEqual({ ok: false, error: 'Organisation is required' });
    expect(parseNewStakeholder({ name: 'A', org: 'B', type: 'regulator' }, team)).toEqual({ ok: false, error: 'Unknown stakeholder type' });
    expect(parseNewStakeholder({ name: 'A', org: 'B', contact: 'nope' }, team)).toEqual({ ok: false, error: 'Enter a valid e-mail address' });
    expect(parseNewStakeholder({ name: 'A', org: 'B', owner: 'Nadia Bensaïd' }, team)).toEqual({ ok: false, error: 'Unknown owner' });
    expect(parseNewStakeholder({ name: 'x'.repeat(201), org: 'B' }, team)).toEqual({ ok: false, error: 'Text is too long' });
    expect(STAKEHOLDER_TYPES.map((c) => stakeholderType.label(c))).toEqual(['Client', 'Internal', 'Supplier', 'Authority', 'Third party']);
  });

  it('"New interface": required interface, other party, data and need date; Process by default; first TEAM owner', () => {
    expect(parseNewInterface({ title: 'Port Wi-Fi coverage', a: 'automation', b: 'Client · IT', data: 'Coverage map', needed: '2 Nov', owner: 'Sami Haddad' }, team)).toEqual({
      ok: true, value: { title: 'Port Wi-Fi coverage', keystoneSide: 'automation', otherParty: 'Client · IT', dataExpected: 'Coverage map', neededBy: '2026-11-02', owner: 'Sami Haddad' },
    });
    expect(parseNewInterface({ title: 'T', b: 'B', data: 'D', needed: '15/10' }, team)).toMatchObject({ ok: true, value: { keystoneSide: 'process', neededBy: '2026-10-15', owner: 'Romain Aubert' } });
    expect(parseNewInterface({ title: 'T', a: 'Electrical', b: 'B', data: 'D', needed: '1 Oct' }, team)).toMatchObject({ ok: true, value: { keystoneSide: 'electrical' } });
    expect(parseNewInterface({ title: '', b: 'B', data: 'D', needed: '1 Oct' }, team)).toEqual({ ok: false, error: 'Interface is required' });
    expect(parseNewInterface({ title: 'T', b: '', data: 'D', needed: '1 Oct' }, team)).toEqual({ ok: false, error: 'Other party is required' });
    expect(parseNewInterface({ title: 'T', b: 'B', data: ' ', needed: '1 Oct' }, team)).toEqual({ ok: false, error: 'Data expected is required' });
    expect(parseNewInterface({ title: 'T', b: 'B', data: 'D', needed: '' }, team)).toEqual({ ok: false, error: 'Needed by is required' });
    expect(parseNewInterface({ title: 'T', b: 'B', data: 'D', needed: 'soon' }, team)).toEqual({ ok: false, error: 'Enter the need date as a date, e.g. 15 Oct' });
    expect(parseNewInterface({ title: 'T', a: 'Civil', b: 'B', data: 'D', needed: '1 Oct' }, team)).toEqual({ ok: false, error: 'Unknown Keystone side' });
    expect(parseNewInterface({ title: 'T', b: 'B', data: 'D', needed: '1 Oct', owner: 'Someone' }, team)).toEqual({ ok: false, error: 'Unknown owner' });
    expect(KEYSTONE_SIDES.map((c) => keystoneSide.label(c))).toEqual(['Process', 'Mechanical', 'Electrical', 'Automation', 'Site']);
  });

  it('need dates: EN / FR month names, numeric and ISO forms; impossible dates refused', () => {
    const cases: [string, string | null][] = [
      ['15 Oct', '2026-10-15'], ['15 Oct 2026', '2026-10-15'], ['15 oct.', '2026-10-15'], ['1er décembre', '2026-12-01'], ['3 févr. 2027', '2027-02-03'],
      ['14 Jan ’27', '2027-01-14'], ['20 juillet', '2026-07-20'], ['2 juin', '2026-06-02'], ['15/10/2026', '2026-10-15'], ['5.11', '2026-11-05'], ['2026-10-15', '2026-10-15'],
      ['31 Feb', null], ['2026-13-01', null], ['Oct 15', null], ['', null], ['32 Oct', null],
    ];
    for (const [input, out] of cases) expect([input, parseNeedDate(input)]).toEqual([input, out]);
  });
});
