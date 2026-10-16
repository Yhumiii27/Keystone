// Golden values of the Meetings & minutes domain (docs/spec/05 §5, logic 4817–4867): the prototype's own component
// runs in node:vm (src/features/meetings/prototype-harness.ts) for a series of states — default selection of each
// meeting, chips, action ticks, notes added through the composer, transcript analysed / added to the minutes,
// minutes sent, a meeting created with "New meeting" — and the domain functions, fed with the same register,
// reproduce its list order, chip counts, KPI tiles, attendance, carry-over, preparation pack and both registers.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { loadPrototype, plain } from '@/features/meetings/prototype-harness';
import { mIdx } from '@/lib/format';
import { meetingSeries, meetingStatus, meetingType } from '@/server/db/codes';
import { PROTO } from '@/server/prototype';
import {
  actionRows, actionState, attendanceOf, carriedOver, decisionRows, draftLines, filterCounts, matchesFilter, meetingKpis, normaliseDue,
  parseInvitees, parseMeetingDate, parseMeetingTime, parseMinutesLine, parseNewMeeting, prepPack, selectMeeting, sortMeetings,
  type ClientQuestion, type Meeting, type MeetingFilter,
} from './meetings';

const P = loadPrototype();
const STATUS_TAG = { neutral: 'tag tag-neutral', outline: 'tag tag-outline' } as const;

/** The project's register as the prototype holds it in `state` (overrides, extra lines, added meetings) → domain input. */
function registerOf(state: any): Meeting[] {
  const all = P.render({ ...state, mtg: { ...state.mtg, filter: 'all' } });
  const rows = plain(all.mtgActionRows) as any[];
  const proposals = (id: string) => {
    const a = P.render({ ...state, mtg: { ...state.mtg, sel: id, analysed: { [id]: true } } });
    return (plain(a.mtgPrep)?.draftLines ?? []).map((l: any) => {
      const [owner, due] = l.meta ? l.meta.split(' · ') : [null, null];
      return { type: l.type, text: l.text, owner, due };
    });
  };
  // Register order (`meetingsAll`): added meetings first, then MEETINGS order — as the DAL lists them (sort order).
  const order = (id: string) => {
    const i = (PROTO.MEETINGS as any[]).findIndex((m) => m.id === id);
    return i < 0 ? -1000 + parseInt(id.slice(4), 10) : i;
  };
  return (plain(all.mtgList) as any[]).sort((a, b) => order(a.id) - order(b.id)).map((m) => {
    const tr = (PROTO.MTG_TRANSCRIPTS as Record<string, string>)[m.id];
    const analysed = !!state.mtg?.analysed?.[m.id];
    return {
      number: m.id, title: m.title, series: meetingSeries.code(m.series), type: meetingType.code(m.type), status: meetingStatus.code(m.status),
      dateText: m.date, monthIndex: mIdx(m.date)!, time: m.time, durationText: m.dur, location: m.loc, organizer: m.organizer,
      minutesNumber: m.doc || null, minutesIndexed: !!m.doc, sentText: m.sent ?? '',
      participants: m.invited.map((name: string) => ({
        name, present: m.present.includes(name), minutesRecipient: !!m.read && name in m.read, readText: m.read?.[name] ?? '',
      })),
      agenda: m.agenda.map((a: any, i: number) => ({
        position: i, title: a.pt,
        lines: a.lines.map((l: any[], j: number) => {
          const r = rows.find((x) => x.mid === m.id && x.i === i && x.j === j);
          return {
            point: i, position: j, type: l[0], text: l[1], owner: l[0] === 'action' ? l[2] : null, ownerFull: r ? r.ownerFull : null,
            due: l[0] === 'action' ? l[3] : null, done: r ? r.done : false, overdue: r ? r.stText === 'Overdue' : false, taskNumber: null,
          };
        }),
      })),
      transcript: tr ? { text: tr, analysed, summary: analysed ? 'x' : null, proposals: analysed ? proposals(m.id) : [], applied: !!state.mtg?.applied?.[m.id] } : null,
    } satisfies Meeting;
  });
}

const questionsOf = (code: string): ClientQuestion[] =>
  ((PROTO.MTG_EXCHANGE as Record<string, any[]>)[code] ?? []).map((q) => ({ text: q.text, askedBy: q.who, department: q.dept, owner: q.owner, state: q.state, answer: q.answer ?? null }));

/** Compares every domain derivation with the prototype's render values for `state`. */
function check(state: any) {
  const v = P.render(state);
  const code = state.project ?? 'HLT-026';
  const ms = registerOf(state);
  const filter = (state.mtg?.filter ?? 'all') as MeetingFilter;

  // List, chips, KPI tiles
  expect(sortMeetings(ms.filter((m) => matchesFilter(m, filter))).map((m) => m.number)).toEqual(plain(v.mtgList).map((m: any) => m.id));
  const counts = filterCounts(ms);
  expect([counts.all, counts.todo, counts.upcoming, counts.sent].map(String)).toEqual(plain(v.mtgChips).map((c: any) => c.count));
  const k = meetingKpis(ms, '2026-09-30'); // R-013: the prototype's PG_NOW (30 Sep 2026), passed explicitly
  expect([
    k.thisWeek, `${k.upcoming} upcoming`, k.toWrite, k.toWrite > 0, k.openActions, `${k.overdueActions} overdue`, k.overdueActions > 0,
    k.decisionsThisMonth, `${k.decisionsWithClient} with the client`,
  ]).toEqual([
    v.mtgKpis[0].value, v.mtgKpis[0].sub, v.mtgKpis[1].value, v.mtgKpis[1].color === 'var(--color-accent-300)', v.mtgKpis[2].value, v.mtgKpis[2].sub,
    v.mtgKpis[2].color === 'var(--color-accent-300)', v.mtgKpis[3].value, v.mtgKpis[3].sub,
  ]);

  // Registers
  expect(decisionRows(ms).map((d) => [d.meeting.number, d.line.text, d.pointTitle, d.meeting.type === 'external' ? 'External' : 'Internal'])).toEqual(
    plain(v.mtgDecisionRows).map((d: any) => [d.mid, d.text, d.pt, d.mtype]),
  );
  expect(actionRows(ms).map((a) => [a.meeting.number, a.line.text, a.line.ownerFull, a.line.due, a.line.done, { done: 'Done', overdue: 'Overdue', open: 'Open' }[a.state]])).toEqual(
    plain(v.mtgActionRows).map((a: any) => [a.mid, a.text, a.ownerFull, a.due, a.done, a.stText]),
  );

  // Detail card
  const MS = selectMeeting(ms, state.mtg?.sel ?? 'MTG-118');
  const sel = plain(v.mtgSel);
  if (!MS) return expect(sel).toBeNull();
  expect(MS.number).toBe(sel.id);
  expect(attendanceOf(MS).map((a) => [a.name, STATUS_TAG[a.tone], a.name + (a.absent ? ' · absent' : '')])).toEqual(sel.attendance.map((a: any) => [a.name, a.cls, a.label]));
  expect(MS.agenda.map((a) => [a.title, a.lines.map((l) => [l.type, l.text, l.owner ?? '', l.due ?? '', l.done])])).toEqual(
    sel.agenda.map((a: any) => [a.pt, a.lines.map((l: any) => [l.type, l.text, l.owner, l.due, l.done])]),
  );
  const carried = carriedOver(ms, MS);
  expect(carried?.from.number ?? '').toBe(sel.carriedFrom);
  expect((carried?.items ?? []).map((c) => [c.text, c.owner, c.due, `${carried!.from.number} · ${carried!.from.dateText}`])).toEqual(sel.carried.map((c: any) => [c.text, c.owner, c.due, c.from]));
  const prep = prepPack(ms, MS, questionsOf(code));
  const gp = plain(v.mtgPrep);
  if (!prep) return expect(gp).toBeNull();
  expect({
    prevRef: prep.prev ? `${prep.prev.title} · ${prep.prev.dateText}` : '',
    prevDecisions: prep.prevDecisions.map((text) => ({ text })),
    prevActions: prep.prevActions.map((a) => [a.text, a.owner, a.due, a.done, a.done ? 'Closed since' : 'Still open']),
    closedCount: `${prep.closed} / ${prep.total}`,
    bridgeTitle: prep.internal ? 'From the client meeting — questions to prepare' : 'From the internal meeting — answers to bring to the client',
    bridge: prep.bridge.map((q) => [
      q.text, (prep.internal ? `Client question · ${q.askedBy}` : `Answer from ${q.department}`) + ` · ${q.owner}`, q.answered ? 'Answer ready' : 'Needs an answer', q.answer ?? '',
    ]),
    transcript: prep.transcript?.text ?? '',
    canAnalyse: !!prep.transcript && !prep.transcript.analysed,
    canApply: !!prep.transcript?.analysed && !prep.transcript.applied,
    draft: draftLines(prep.transcript).map((l) => [l.type, l.text, l.type === 'action' ? `${l.owner} · ${l.due}` : '']),
  }).toEqual({
    prevRef: gp.prevRef, prevDecisions: gp.prevDecisions, prevActions: gp.prevActions.map((a: any) => [a.text, a.who, a.due, a.done, a.label]), closedCount: gp.closedCount,
    bridgeTitle: gp.bridgeTitle, bridge: gp.bridge.map((q: any) => [q.text, q.sub, q.label, q.answer]), transcript: gp.transcript, canAnalyse: gp.canAnalyse,
    canApply: gp.canApply, draft: gp.draftLines.map((l: any) => [l.type, l.text, l.meta]),
  });
}

const base = (patch: any = {}, project = 'HLT-026') => ({ project, mtg: { ...P.mtg0(), ...patch } });

describe('meetings domain — golden values from the prototype logic', () => {
  it.each(['MTG-118', 'MTG-119', 'MTG-120', 'MTG-117', 'MTG-116'])('HLT-026, %s selected', (sel) => check(base({ sel })));

  it.each(['todo', 'upcoming', 'sent'])('status chip %s', (filter) => check(base({ filter })));

  it('NDC-031 (kick-off, internal bridge from the Infrastructure BU) and a project without meetings', () => {
    check(base({}, 'NDC-031'));
    check(base({}, 'EWA-051'));
  });

  it('action ticks: closing an MTG-118 action, reopening an MTG-116 action (carried over into #24, 1 / 2 closed)', () => {
    const ov = { 'MTG-118': { done: { 'MTG-118|1|1': true } }, 'MTG-116': { done: { 'MTG-116|0|0': false } } };
    check(base({ ov }));
    check(base({ ov, sel: 'MTG-116' }));
  });

  it('notes added with the composer move a scheduled meeting to Notes in progress; a past due makes the action overdue', () => {
    const lines = { 'MTG-119': { 0: [['decision', 'Freeze the I/O list on rev D'], ['action', 'Check the PLC table', 'J. Wagner', '25 Sep'], ['info', 'FYI']] } };
    const ov = { 'MTG-119': { status: 'Notes in progress' } };
    check(base({ sel: 'MTG-119', lines, ov }));
    check(base({ sel: 'MTG-119', lines, ov, filter: 'todo' }));
  });

  it('transcript analysed, then added to the last agenda point (MTG-119, MTG-120)', () => {
    check(base({ sel: 'MTG-119', analysed: { 'MTG-119': true } }));
    check(base({ sel: 'MTG-120', analysed: { 'MTG-120': true } }));
    const D119 = [
      ['decision', 'Freeze the I/O list on P&ID rev D by Friday'],
      ['decision', 'Close C-04 (drawing error); keep C-05 open until the supplier confirms the status word mapping'],
      ['decision', 'Answer to client: HV cell energised by 20 Nov at the latest'],
      ['action', 'Update electrical schematics for TT-104, PT-108, ZS-112', 'S. Haddad', '6 Oct'],
      ['action', 'Send corrected P&ID sheet for C-04', 'P. Noguès', '3 Oct'],
      ['action', 'Carry the HV cell date to the steering committee', 'A. Girard', '9 Oct'],
    ];
    check(base({ sel: 'MTG-119', analysed: { 'MTG-119': true }, applied: { 'MTG-119': true }, lines: { 'MTG-119': { 2: D119 } } }));
  });

  it('minutes of MTG-118 sent: no preparation pack, distribution, the next weekly meeting gets its carry-over', () => {
    const ov = { 'MTG-118': { status: 'Minutes sent', doc: 'MIN-HLT-025', sent: '30 Sep', read: { 'L. Fabre': '', 'J. Wagner': '', 'H. Sauvage': '', 'T. Kerbrat': '' } } };
    check(base({ ov }));
    check(base({ ov, filter: 'sent' }));
  });

  it('"New meeting" adds MTG-130 (Scheduled, organized by the viewer) whose previous weekly meeting is #24', () => {
    const added = { ...P.added0(), meetings: [{ title: 'Weekly site meeting #25', type: 'Internal', series: 'Weekly site meeting', date: '6 Oct 2026', time: '08:30', loc: 'Site office', invited: 'R. Aubert, L. Fabre, J. Wagner', agenda: 'Safety\nSteel', proj: 'HLT-026' }] };
    check({ ...base({ sel: 'MTG-130' }), added });
    check({ ...base({ sel: 'MTG-130', filter: 'upcoming' }), added });
  });
});

describe('meetings domain — input parsing', () => {
  it('dates in English, French, numeric and ISO forms; invalid calendar dates refused', () => {
    expect(['6 Oct 2026', '6 oct. 2026', '6 octobre 2026', 'mar. 6 oct. 2026', 'Tue 6 Oct 2026', '06/10/2026', '6/10', '2026-10-06', '6 Oct'].map((s) => parseMeetingDate(s))).toEqual(
      Array(9).fill('2026-10-06'),
    );
    expect([parseMeetingDate('1er févr. 2027'), parseMeetingDate('3 août 2026'), parseMeetingDate('15 déc.'), parseMeetingDate('2 mai')]).toEqual([
      '2027-02-01', '2026-08-03', '2026-12-15', '2026-05-02',
    ]);
    expect(['31 Sep 2026', '30 Feb', '6 Foo 2026', '', 'tomorrow', '2026-13-01'].map((s) => parseMeetingDate(s))).toEqual(Array(6).fill(null));
  });

  it('times, invitees and the New meeting form (prototype defaults: 09:00, Teams)', () => {
    expect(['09:00', '9:00', '9h', '9h30', '14.30', '24:00', '9:75', 'noon'].map(parseMeetingTime)).toEqual(['09:00', '09:00', '09:00', '09:30', '14:30', null, null, null]);
    expect(parseInvitees(' R. Aubert, L. Fabre ;J. Wagner,, R. Aubert ')).toEqual(['R. Aubert', 'L. Fabre', 'J. Wagner']);
    expect(parseNewMeeting({ title: ' Weekly  site meeting #25 ', type: 'internal', series: 'weekly_site', date: '6 oct. 2026', time: '', loc: '', invited: 'R. Aubert, L. Fabre', agenda: 'Safety\n\n Steel ' })).toEqual({
      ok: true,
      value: { title: 'Weekly site meeting #25', type: 'internal', series: 'weekly_site', date: '2026-10-06', time: '09:00', location: 'Teams', invitees: ['R. Aubert', 'L. Fabre'], agenda: ['Safety', 'Steel'] },
    });
    expect(parseNewMeeting({ title: '', date: '6 Oct 2026', invited: 'x' })).toEqual({ ok: false, error: 'Title is required' });
    expect(parseNewMeeting({ title: 'x', date: '32 Oct', invited: 'x' })).toEqual({ ok: false, error: 'Enter a valid date (e.g. 6 Oct 2026)' });
    expect(parseNewMeeting({ title: 'x', date: '6 Oct', time: '25:00', invited: 'x' })).toEqual({ ok: false, error: 'Enter a valid time (e.g. 09:00)' });
    expect(parseNewMeeting({ title: 'x', date: '6 Oct', invited: ' , ' })).toEqual({ ok: false, error: 'Invite at least one person' });
    expect(parseNewMeeting({ title: 'x', type: 'secret', date: '6 Oct', invited: 'x' })).toEqual({ ok: false, error: 'Invalid meeting type' });
    expect(parseNewMeeting({ title: 'x', series: 'Weekly site meeting', date: '6 Oct', invited: 'x' })).toEqual({ ok: false, error: 'Invalid series' });
  });

  it('composer lines: owner and due for actions only, dates normalised, blank text refused', () => {
    expect(parseMinutesLine({ type: 'action', text: '  Check  the rails ', owner: ' J. Wagner ', due: '2 oct.' })).toEqual({
      ok: true, value: { type: 'action', text: 'Check the rails', owner: 'J. Wagner', due: '2 Oct' },
    });
    expect(parseMinutesLine({ type: 'action', text: 'x', owner: '', due: '' })).toEqual({ ok: true, value: { type: 'action', text: 'x', owner: null, due: null } });
    expect(parseMinutesLine({ type: 'decision', text: 'Go', owner: 'A', due: '1 Oct' })).toEqual({ ok: true, value: { type: 'decision', text: 'Go', owner: null, due: null } });
    expect(parseMinutesLine({ type: 'info', text: '   ' })).toEqual({ ok: false, error: 'Write a note first' });
    expect(parseMinutesLine({ type: 'todo', text: 'x' })).toEqual({ ok: false, error: 'Invalid note type' });
    expect(parseMinutesLine({ type: 'info', text: 42 })).toEqual({ ok: false, error: 'Write a note first' });
    expect([normaliseDue('5 janv. 2027'), normaliseDue('next week'), normaliseDue('—'), normaliseDue('')]).toEqual(['5 Jan 2027', 'next week', '—', null]);
  });

  it('action state: done > overdue > open', () => {
    expect([actionState({ done: true, overdue: true }), actionState({ done: false, overdue: true }), actionState({ done: false, overdue: false })]).toEqual(['done', 'overdue', 'open']);
  });
});
