// R-199 — the pure rules of the deadline reminders and the weekly reports: preferences, windows (J-7, J-1, overdue once),
// idempotency keys, one reminder per person, rights, the e-mail texts in French, the ISO week of the reports. Dates are explicit
// (the demo data set's business date, Fri 25 Sep 2026).
import { describe, expect, it } from 'vitest';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { makeT } from '@/i18n/translate';
import {
  DEFAULT_REMINDER_PREFS, OVERDUE_LOOKBACK_DAYS, daysLeftText, formOfPrefs, groupByPerson, mayReceiveItem, normalisePrefs, offsetsLabel, parseOffsets, planReminders,
  prefsChanges, prefsOfForm, reminderMail, reminderNoticeSub, reminderSendKey, reminderSlot, reminderTarget, reportMail, reportPeriodKey, reportSendKey, sendKeyText,
  summaryLines, type DueItem,
} from './reminders';

const today = DEMO_TODAY_ISO;
const item = (over: Partial<DueItem> = {}): DueItem => ({
  kind: 'task', id: 'u1', projectCode: 'HLT-026', ref: 'T-2314', title: 'Crane load test report', dueOn: '2026-10-02', personIds: ['p1'], screen: 'task',
  params: { taskId: 'T-2314' }, ...over,
});

describe('preferences', () => {
  it('offsets: unique, largest first, 0 to 30, at most 4; "J-7" accepted', () => {
    expect([parseOffsets('7,1'), parseOffsets('J-1, J-7, 7'), parseOffsets([14, 7, 1]), parseOffsets('0')]).toEqual([[7, 1], [7, 1], [14, 7, 1], [0]]);
    expect([parseOffsets(''), parseOffsets('31'), parseOffsets('-1'), parseOffsets('1,2,3,4,5'), parseOffsets('x'), parseOffsets(null)]).toEqual([null, null, null, null, null, null]);
    expect(offsetsLabel([7, 1])).toBe('J-7 · J-1');
  });

  it('default: e-mail on, J-7 and J-1, overdue once; a stored value is completed field by field', () => {
    expect(DEFAULT_REMINDER_PREFS).toEqual({ emailReminders: true, emailReports: true, offsets: [7, 1], overdue: true });
    expect(normalisePrefs({ emailReports: false, offsets: 'bad' })).toEqual({ ...DEFAULT_REMINDER_PREFS, emailReports: false });
    expect(normalisePrefs(null, { emailReminders: false, emailReports: false, offsets: [3], overdue: false })).toEqual({ emailReminders: false, emailReports: false, offsets: [3], overdue: false });
  });

  it('the form: on / off and an offsets preset, both ways; anything else refused; the audit diff names what changed', () => {
    const p = prefsOfForm({ emailReminders: 'off', emailReports: 'on', offsets: '14,7,1', overdue: 'off' });
    expect(p).toEqual({ emailReminders: false, emailReports: true, offsets: [14, 7, 1], overdue: false });
    expect(formOfPrefs(p!)).toEqual({ emailReminders: 'off', emailReports: 'on', offsets: '14,7,1', overdue: 'off' });
    expect([prefsOfForm({ emailReminders: 'yes', emailReports: 'on', offsets: '7', overdue: 'on' }), prefsOfForm({ emailReminders: 'on', emailReports: 'on', offsets: '99', overdue: 'on' })]).toEqual([null, null]);
    expect(prefsChanges(DEFAULT_REMINDER_PREFS, p!)).toEqual({ before: { emailReminders: true, overdue: true, offsets: 'J-7 · J-1' }, after: { emailReminders: false, overdue: false, offsets: 'J-14 · J-7 · J-1' } });
    expect(prefsChanges(DEFAULT_REMINDER_PREFS, { ...DEFAULT_REMINDER_PREFS })).toBeNull();
  });
});

describe('windows', () => {
  const prefs = { offsets: [7, 1], overdue: true };
  it('J-7 from 7 days to 2 days left, J-1 the day before and the day itself; nothing earlier', () => {
    expect(reminderSlot('2026-10-02', today, prefs)).toEqual({ slot: 'J-7', daysLeft: 7, overdue: false });
    // A window missed (a stopped worker, an item created inside it) is caught up while it lasts.
    expect(reminderSlot('2026-09-30', today, prefs)).toEqual({ slot: 'J-7', daysLeft: 5, overdue: false });
    expect(reminderSlot('2026-09-26', today, prefs)).toEqual({ slot: 'J-1', daysLeft: 1, overdue: false });
    expect(reminderSlot(today, today, prefs)).toEqual({ slot: 'J-1', daysLeft: 0, overdue: false });
    expect(reminderSlot('2026-10-03', today, prefs)).toBeNull();
  });

  it('overdue once, up to 30 days after the due date; never when the person turned it off', () => {
    expect(reminderSlot('2026-09-20', today, prefs)).toEqual({ slot: 'overdue', daysLeft: -5, overdue: true });
    expect(OVERDUE_LOOKBACK_DAYS).toBe(30);
    expect(reminderSlot('2026-08-26', today, prefs)).toEqual({ slot: 'overdue', daysLeft: -30, overdue: true });
    expect(reminderSlot('2026-08-25', today, prefs)).toBeNull();
    expect(reminderSlot('2026-09-20', today, { offsets: [7, 1], overdue: false })).toBeNull();
  });
});

describe('planning and idempotency', () => {
  const prefsOf = (id: string) => (id === 'nobody' ? null : id === 'p3' ? { ...DEFAULT_REMINDER_PREFS, offsets: [1] } : DEFAULT_REMINDER_PREFS);
  const items = [
    item(), item({ id: 'u2', ref: 'T-2315', dueOn: '2026-09-20', personIds: ['p1', 'p2', 'p1'] }), item({ kind: 'deliverable', id: 'd1', ref: 'D-021', personIds: ['p3', 'nobody'] }),
  ];

  it('one reminder per person and item in its window; persons without an account or out of window left out', () => {
    const planned = planReminders(items, today, prefsOf, () => true);
    expect(planned.map((p) => [p.personId, p.item.ref, p.slot.slot])).toEqual([['p1', 'T-2314', 'J-7'], ['p1', 'T-2315', 'overdue'], ['p2', 'T-2315', 'overdue']]);
  });

  it('the send key: person + item + window + due date; what the log holds is never planned again; a moved due date is new', () => {
    const k = reminderSendKey('p1', items[0], 'J-7');
    expect(k).toEqual({ personId: 'p1', itemKey: 'task:u1', slot: 'J-7', occurrence: '2026-10-02' });
    const sent = new Set([sendKeyText(k)]);
    expect(planReminders(items, today, prefsOf, () => true, sent).map((p) => p.item.ref)).toEqual(['T-2315', 'T-2315']);
    expect(planReminders([item({ dueOn: '2026-10-01' })], today, prefsOf, () => true, sent)).toHaveLength(1);
  });

  it('rights: what a person may not receive is not planned', () => {
    expect(planReminders(items, today, prefsOf, (person) => person !== 'p2').map((p) => p.personId)).toEqual(['p1', 'p1']);
    expect([mayReceiveItem({ internal: true, refused: false }, false), mayReceiveItem({ internal: false, refused: false }, true), mayReceiveItem({ internal: false, refused: false }, false), mayReceiveItem({ internal: true, refused: true }, true)])
      .toEqual([true, true, false, false]);
  });

  it('one reminder per person: overdue first, then by due date; the bell line and its target', () => {
    const by = groupByPerson(planReminders(items, today, prefsOf, () => true));
    const p1 = by.get('p1')!;
    expect(p1.map((p) => p.item.ref)).toEqual(['T-2315', 'T-2314']);
    expect(reminderNoticeSub(p1)).toBe('HLT-026 T-2315 · HLT-026 T-2314');
    expect(reminderTarget(p1)).toEqual({ screen: 'mywork', params: {}, projectCode: null });
    expect(reminderTarget(by.get('p2')!)).toEqual({ screen: 'task', params: { taskId: 'T-2314' }, projectCode: 'HLT-026' });
    const many = Array.from({ length: 5 }, (_, i) => ({ personId: 'p', item: item({ ref: `T-${i}` }), slot: { slot: 'J-7', daysLeft: 7, overdue: false } }));
    expect(reminderNoticeSub(many)).toBe('HLT-026 T-0 · HLT-026 T-1 · HLT-026 T-2 · +2');
  });
});

describe('e-mails (French by default)', () => {
  const fr = { t: makeT('fr'), dt: (s: string) => s };
  it('days left in French: today, tomorrow, in n days, n days late', () => {
    expect([0, 1, 7, -5].map((d) => fr.t(daysLeftText(d)))).toEqual(['Échéance aujourd’hui', 'Échéance demain', 'dans 7 j', '5 j de retard']);
  });

  it('the reminder e-mail: subject with the count and the overdue ones, one block per item with its link', () => {
    const list = [
      { personId: 'p1', item: item({ dueOn: '2026-09-20', ref: 'T-2315' }), slot: { slot: 'overdue', daysLeft: -5, overdue: true } },
      { personId: 'p1', item: item({ kind: 'deliverable', ref: 'D-021', title: 'Load test report' }), slot: { slot: 'J-7', daysLeft: 7, overdue: false } },
    ];
    const m = reminderMail('Romain Aubert', list, today, (p) => `https://ks/x/${p.item.ref}`, 'https://ks/my/tasks', fr);
    expect(m.subject).toBe('Keystone — Rappel d’échéance · 2 éléments · 1 en retard');
    expect(m.body.split('\n')).toEqual([
      'Bonjour Romain Aubert,', '', 'Vos échéances dans Keystone · 25 sept.', '',
      '- HLT-026 · T-2315 · Crane load test report', '  Tâche · échéance 20 sept. · 5 j de retard', '  https://ks/x/T-2315',
      '- HLT-026 · D-021 · Load test report', '  Livrable · échéance 2 oct. · dans 7 j', '  https://ks/x/D-021',
      '', 'Ouvrir Keystone: https://ks/my/tasks', '', '—',
      'Message automatique de Keystone · modifiez vos e-mails de rappels et de rapports depuis la cloche des notifications › Rappels et rapports',
    ]);
  });

  it('the report e-mail: the summary of the document, what is attached, the link', () => {
    const lines = summaryLines([
      { kind: 'kpis', items: [{ label: 'Avancement', value: '62%' }, { label: 'EAC', value: '4 810 k€', sub: 'BAC 4 650 k€' }] },
      { kind: 'heading' }, { kind: 'fields', items: [['Fin prévue', '18 déc.']] },
    ]);
    expect(lines).toEqual(['- Avancement: 62%', '- EAC: 4 810 k€ (BAC 4 650 k€)', '- Fin prévue: 18 déc.']);
    const m = reportMail('Romain Aubert', { title: 'Rapport d’avancement hebdomadaire', about: 'HLT-026', period: '2026-W40', lines, attachment: 'status-report-HLT-026.pdf', link: 'https://ks/t' }, fr);
    expect(m.subject).toBe('Keystone — Rapport d’avancement hebdomadaire · HLT-026 · 2026-W40');
    expect(m.body).toContain('Pièce jointe: status-report-HLT-026.pdf\nOuvrir dans Keystone: https://ks/t');
  });
});

describe('weekly reports', () => {
  it('the ISO week of the business date (the year of its Thursday) is the period key', () => {
    expect([reportPeriodKey('2026-09-25'), reportPeriodKey('2026-09-28'), reportPeriodKey('2027-01-01'), reportPeriodKey('2026-12-31'), reportPeriodKey('2024-12-30')])
      .toEqual(['2026-W39', '2026-W40', '2026-W53', '2026-W53', '2025-W01']);
  });

  it('one report per person, report and week', () => {
    expect(reportSendKey('p1', 'project_weekly', 'HLT-026', '2026-09-28')).toEqual({ personId: 'p1', itemKey: 'project_weekly:HLT-026', slot: 'weekly', occurrence: '2026-W40' });
    expect(reportSendKey('p1', 'portfolio_weekly', null, '2026-10-02').itemKey).toBe('portfolio_weekly');
    expect(sendKeyText(reportSendKey('p1', 'portfolio_weekly', null, '2026-09-28'))).toBe(sendKeyText(reportSendKey('p1', 'portfolio_weekly', null, '2026-10-04')));
  });
});
