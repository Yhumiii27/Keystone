// R-067 (S-12 a): who gets the task of a minutes action, the follow-up title, the dates (typed due kept), and the optional plan
// activity of the composer.
import { describe, expect, it } from 'vitest';
import { FOLLOW_UP_LABEL, TASK_TITLE_MAX, followUpTarget, followUpTitle, minutesTaskDates, ownerBaseName, parseMinutesLine, type FollowUpStakeholder } from './meetings';

const SH: FollowUpStakeholder[] = [
  { personId: 'p-nb', name: 'Nadia Bensaïd', ownerPersonId: 'p-ra', position: 0 },
  { personId: null, name: 'Kjell Lindqvist', ownerPersonId: 'p-fb', position: 5 },
  { personId: null, name: 'DREAL Normandie', ownerPersonId: null, position: 6 },
  { personId: null, name: 'Kjell Lindqvist', ownerPersonId: 'p-other', position: 9 },
];
const target = (ownerName: string, owner: { personId: string; internal: boolean } | null, pm: string | null = 'p-pm') =>
  followUpTarget({ ownerName, owner, stakeholders: SH, pmPersonId: pm });

describe('followUpTarget (S-12 a)', () => {
  it('an internal owner gets the task themself', () => {
    expect(target('J. Wagner', { personId: 'p-jw', internal: true })).toEqual({ personId: 'p-jw', followUp: false });
  });

  it('an external person: the stakeholder by person, its relationship owner gets a follow-up', () => {
    expect(target('N. Bensaïd', { personId: 'p-nb', internal: false })).toEqual({ personId: 'p-ra', followUp: true });
  });

  it('an external name: "(Org)" stripped, full name or short form, first stakeholder in register order', () => {
    expect(target('K. Lindqvist (Nordvolt)', null)).toEqual({ personId: 'p-fb', followUp: true });
    expect(target('Kjell Lindqvist', null)).toEqual({ personId: 'p-fb', followUp: true });
    expect(ownerBaseName('K. Lindqvist (Nordvolt)')).toBe('K. Lindqvist');
    expect(ownerBaseName('Port authority HSE')).toBe('Port authority HSE');
  });

  it('no stakeholder, or one without relationship owner → the PM; no PM → no task', () => {
    expect(target('Somebody Else (Acme)', null)).toEqual({ personId: 'p-pm', followUp: true });
    expect(target('DREAL Normandie', null)).toEqual({ personId: 'p-pm', followUp: true });
    expect(target('Somebody Else', null, null)).toBeNull();
    expect(target('', null)).toEqual({ personId: 'p-pm', followUp: true });
  });
});

describe('follow-up title and dates', () => {
  it('title: the action, " — ", the owner as typed; at most 200 characters', () => {
    expect(followUpTitle('Confirm the HV cell date', 'N. Bensaïd')).toBe('Confirm the HV cell date — N. Bensaïd');
    const long = followUpTitle('x'.repeat(250), 'K. Lindqvist (Nordvolt)');
    expect(long).toHaveLength(TASK_TITLE_MAX);
    expect(long.endsWith('…')).toBe(true);
    expect(FOLLOW_UP_LABEL).toBe('Follow-up');
  });

  it('due = the typed due, else today + 3 working days; start = today, or the typed due when earlier', () => {
    expect(minutesTaskDates('2026-10-01', '2026-09-25', '2026-09-30')).toEqual({ start: '2026-09-25', due: '2026-10-01' });
    expect(minutesTaskDates(null, '2026-09-25', '2026-09-30')).toEqual({ start: '2026-09-25', due: '2026-09-30' });
    expect(minutesTaskDates('2026-09-20', '2026-09-25', '2026-09-30')).toEqual({ start: '2026-09-20', due: '2026-09-20' });
  });
});

describe('parseMinutesLine — activity (S-12 a)', () => {
  it('an action may name a plan activity code; other note types ignore it; a malformed code is refused', () => {
    expect(parseMinutesLine({ type: 'action', text: 'Weld check', owner: 'J. Wagner', due: '1 Oct', activity: ' A1250 ' }, 2026)).toMatchObject({ ok: true, value: { activity: 'A1250' } });
    expect(parseMinutesLine({ type: 'action', text: 'Weld check', activity: '' }, 2026)).toEqual({ ok: true, value: { type: 'action', text: 'Weld check', owner: null, due: null } });
    expect(parseMinutesLine({ type: 'info', text: 'Note', activity: 'A1250' }, 2026)).toEqual({ ok: true, value: { type: 'info', text: 'Note', owner: null, due: null } });
    for (const activity of ['A1250; drop table', 'a b', 'x'.repeat(41), '-A1']) expect(parseMinutesLine({ type: 'action', text: 'T', activity }, 2026)).toEqual({ ok: false, error: 'Unknown activity' });
    expect(parseMinutesLine({ type: 'action', text: 'T', activity: 42 }, 2026)).toMatchObject({ ok: true });
  });
});
