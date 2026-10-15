// Meetings & minutes screen — golden values from the prototype, end to end (seeded in-memory database → DAL →
// view model), in EN and FR. The prototype's own component runs in node:vm (prototype-harness.ts); its
// renderValsEN / renderVals output for every meeting, chip and view is compared with `meetingsScreenView`. Then the
// same interactions are played on both sides — tick an action, add notes, analyse a transcript and add it to the
// minutes, send the minutes, create a meeting — and compared again.
// Deliberate differences, asserted explicitly:
//   - people's text (titles, agenda points, notes, transcripts, questions) is translated only on an exact dictionary
//     match (`dataText`), never half-translated by the segment rules; the location is never translated ("Teams");
//   - "1 action" (prototype "1 actions"); the line type label is translated (the prototype showed the raw code);
//   - the Decisions register headers name their content (Agenda point, Type — 00 §7.16);
//   - S-10 (chapter 4): "Analyse transcript" runs a real analyser (the local rules under Vitest) instead of revealing the
//     prototype's pre-baked result, so the MTG-119 summary and draft lines are the local analysis (LOCAL_119) — same three
//     decisions and three actions, the texts taken from the transcript, and no invented due date for A. Girard.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from 'vitest';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { addMeetingLine, analyseTranscript, applyTranscriptToMinutes, createMeeting, sendMinutes, toggleMeetingAction } from '@/server/dal/meetings';
import { getMeetingsScreen } from '@/server/dal/meetings-screen';
import type { MeetingFilter, MeetingsView } from '@/domain/meetings';
import { dataText } from './i18n';
import { meetingsHref, meetingsScreenView, type MeetingsScreenView } from './model';
import { loadPrototype, plain } from './prototype-harness';

const P = loadPrototype();

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

async function ours(code: string, lang: Lang, q: { view?: MeetingsView; filter?: MeetingFilter; meeting?: string | null } = {}) {
  const d = await getMeetingsScreen(code);
  return meetingsScreenView({ code, meetings: d.meetings, questions: d.questions, query: { view: q.view ?? 'meetings', filter: q.filter ?? 'all', meeting: q.meeting ?? null } }, makeT(lang), lang);
}

/** The prototype's values for a state, with the rebuild's deliberate differences applied (see header). */
function expected(state: any, lang: Lang) {
  const v = P.render(state, lang);
  const en = P.render(state, 'en');
  const t = makeT(lang);
  const dt = (s: string) => dataText(s, lang);
  const one = (s: string) => s.replace(/ · 1 actions$/, ' · 1 action');
  const enList = plain(en.mtgList) as any[];
  const sel = plain(v.mtgSel);
  const selEn = plain(en.mtgSel);
  const prep = plain(v.mtgPrep);
  const prepEn = plain(en.mtgPrep);
  return {
    kpis: plain(v.mtgKpis).map((k: any) => [k.label, String(k.value), k.sub, k.color]),
    chips: plain(v.mtgChips).map((c: any) => [c.label, c.count]),
    cards: plain(v.mtgList).map((m: any, i: number) => [m.id, dt(enList[i].title), m.type, m.typeClass, m.status, m.stClass, one(m.sub)]),
    detail: sel && {
      number: sel.id,
      title: dt(selEn.title),
      meta: `${sel.meta.split(' · ').slice(0, 3).join(' · ')} · ${selEn.loc} · ${sel.organizer}`,
      synced: `${t('Synced from Outlook')} · ${sel.series}`,
      type: [sel.type, sel.typeClass, sel.status, sel.stClass],
      attendance: sel.attendance.map((a: any) => [a.label, a.cls, a.color === 'var(--color-neutral-500)']),
      carried: sel.carried.length ? sel.carried.map((c: any, i: number) => [dt(selEn.carried[i].text), `${c.owner} · ${c.due}`]) : null,
      carriedFrom: sel.carried.length ? `${t('Carried over from')} ${sel.carriedFrom}` : null,
      agenda: sel.agenda.map((a: any, i: number) => [
        dt(selEn.agenda[i].pt),
        a.lines.map((l: any, j: number) => [l.type, dt(selEn.agenda[i].lines[j].text), l.isAction ? `${l.owner} · ${l.due}` : '', l.done]),
      ]),
      editable: sel.editable,
      sent: sel.isSent ? [sel.sentText, sel.dist.map((x: any) => [`${x.who} · ${x.state}`, x.cls])] : null,
      prep: prep && {
        prev: prep.hasPrev
          ? [
              `${dt(prepEn.prevRef.split(' · ')[0])} · ${prep.prevRef.split(' · ').slice(-1)[0]}`,
              prepEn.prevDecisions.map((d: any) => dt(d.text)),
              prep.prevActions.map((a: any, i: number) => [dt(prepEn.prevActions[i].text), `${a.who} · ${a.due}`, a.done]),
              prep.closedCount,
            ]
          : null,
        bridge: prep.hasBridge ? [prep.bridgeTitle, prep.bridge.map((q: any, i: number) => [dt(prepEn.bridge[i].text), q.sub, q.label, q.tagClass, prepEn.bridge[i].answer ? dt(prepEn.bridge[i].answer) : ''])] : null,
        transcript: prep.hasTranscript
          ? [dt(prepEn.transcript), prep.analysed, prepEn.summary ? dt(prepEn.summary) : '', prep.draftLines.map((l: any, i: number) => [l.type, dt(prepEn.draftLines[i].text), l.meta]), prep.applied]
          : null,
      },
    },
    decisions: plain(v.mtgDecisionRows).map((d: any, i: number) => {
      const e = plain(en.mtgDecisionRows)[i];
      return [dt(e.text), dt(e.mtitle), `${d.mid} · ${d.mdate}`, dt(e.pt), d.mtype, d.typeClass];
    }),
    actions: plain(v.mtgActionRows).map((a: any, i: number) => {
      const e = plain(en.mtgActionRows)[i];
      return [dt(e.text), a.ownerFull, a.due, a.dueColor, dt(e.mtitle), `${a.mid} · ${a.mdate}`, a.stText, a.done];
    }),
  };
}

/** The rebuild's view model in the same shape. */
function actual(m: MeetingsScreenView) {
  const d = m.detail;
  return {
    kpis: m.kpis.map((k) => [k.label, k.value, k.sub, k.color]),
    chips: m.chips.map((c) => [c.label, String(c.count)]),
    cards: m.cards.map((c) => [c.number, c.title, c.typeLabel, c.typeClass, c.statusLabel, c.statusClass, c.sub]),
    detail: d && {
      number: d.number,
      title: d.title,
      meta: d.meta,
      synced: d.synced,
      type: [d.typeLabel, d.typeClass, d.statusLabel, d.statusClass],
      attendance: d.attendance.map((a) => [a.label, a.cls, a.absent]),
      carried: d.carried ? d.carried.items.map((c) => [c.text, c.meta]) : null,
      carriedFrom: d.carried?.title ?? null,
      agenda: d.agenda.map((a) => [a.title, a.lines.map((l) => [l.type, l.text, l.meta, l.done])]),
      editable: d.editable,
      sent: d.sent ? [d.sent.text, d.sent.dist.map((x) => [x.label, x.cls])] : null,
      prep: d.prep && {
        prev: d.prep.prev ? [d.prep.prev.ref, d.prep.prev.decisions, d.prep.prev.actions.map((a) => [a.text, a.meta, a.done]), d.prep.prev.closedCount] : null,
        bridge: d.prep.bridge ? [d.prep.bridge.title, d.prep.bridge.items.map((q) => [q.text, q.sub, q.label, q.cls, q.answer])] : null,
        transcript: d.prep.transcript
          ? [d.prep.transcript.text, d.prep.transcript.analysed, d.prep.transcript.summary, d.prep.transcript.draft.map((l) => [l.type, l.text, l.meta]), d.prep.transcript.applied]
          : null,
      },
    },
    decisions: m.decisions.map((x) => [x.text, x.meetingTitle, x.meetingRef, x.pointTitle, x.typeLabel, x.typeClass]),
    actions: m.actions.map((a) => [a.text, a.owner, a.due, a.dueColor, a.meetingTitle, a.meetingRef, a.stateText, a.done]),
  };
}

const LANGS: Lang[] = ['en', 'fr'];

describe('meetings screen — seeded register vs the prototype', () => {
  describe.each(LANGS)('%s', (lang) => {
    it.each(['MTG-118', 'MTG-119', 'MTG-120', 'MTG-117', 'MTG-116'])('HLT-026 with %s selected', async (sel) => {
      expect(actual(await ours('HLT-026', lang, { meeting: sel }))).toEqual(expected({ mtg: { ...P.mtg0(), sel } }, lang));
    });

    it('HLT-026 default selection (MTG-118, notes in progress) and the status chips', async () => {
      expect(actual(await ours('HLT-026', lang))).toEqual(expected({ mtg: P.mtg0() }, lang));
      for (const filter of ['todo', 'upcoming', 'sent'] as const)
        expect(actual(await ours('HLT-026', lang, { filter, meeting: 'MTG-118' }))).toEqual(expected({ mtg: { ...P.mtg0(), filter } }, lang));
    });

    it('NDC-031 (one kick-off, external bridge answers from the Infrastructure BU) and EWA-051 (no meeting)', async () => {
      expect(actual(await ours('NDC-031', lang))).toEqual(expected({ project: 'NDC-031', mtg: P.mtg0() }, lang));
      expect(actual(await ours('EWA-051', lang))).toEqual(expected({ project: 'EWA-051', mtg: P.mtg0() }, lang));
    });
  });

  it('labels, links and FR spot checks', async () => {
    const fr = await ours('HLT-026', 'fr', { meeting: 'MTG-117' });
    expect(fr.cards[0]).toMatchObject({ title: 'Réunion de chantier hebdo n°24', sub: '29 sept. 2026 · 08:30 · 5 conviés · 3 actions', href: '/projects/HLT-026/meetings?meeting=MTG-118' });
    expect(fr.detail).toMatchObject({
      meta: '25 sept. 2026 · 14:00 · 1 h 30 · Port authority · room B · R. Aubert', attendanceTitle: 'Participants · 5 Conviés',
      sent: { text: 'Envoyé le 26 sept. · MIN-HLT-023', openHref: '/projects/HLT-026/documents?doc=MIN-HLT-023' },
    });
    expect(fr.detail!.agenda[0].lines.map((l) => l.typeLabel)).toEqual(['Info', 'Décision', 'Action']);
    expect(fr.viewSeg.map((o) => [o.label, o.href])).toEqual([
      ['Réunions', '/projects/HLT-026/meetings?meeting=MTG-117'],
      ['Décisions', '/projects/HLT-026/meetings?view=decisions&meeting=MTG-117'],
      ['Actions', '/projects/HLT-026/meetings?view=actions&meeting=MTG-117'],
    ]);
    expect(fr.chips.map((c) => c.href)[1]).toBe('/projects/HLT-026/meetings?filter=todo&meeting=MTG-117');
    expect(fr.decisions[2]).toMatchObject({ pointTitle: 'Demandes de modification', typeLabel: 'Externe', href: '/projects/HLT-026/meetings?meeting=MTG-117' });
    const en116 = await ours('HLT-026', 'en', { meeting: 'MTG-116' });
    expect(en116.detail!.sent!.openHref).toBe('/projects/HLT-026/documents'); // MIN-HLT-022 is not in the Codex index
    const ndc = await ours('NDC-031', 'en');
    expect(ndc.cards[0]).toMatchObject({ sub: '30 Sep 2026 · 09:00 · 3 invited · 1 action', selected: true });
    expect(meetingsHref('HLT-026', { view: 'actions', filter: 'sent', meeting: 'MTG-116' })).toBe('/projects/HLT-026/meetings?view=actions&filter=sent&meeting=MTG-116');
  });
});

/** S-10: local analysis of the MTG-119 transcript (summary, draft lines [type, text, "{owner} · {due}"]). */
const LOCAL_119 = {
  summary:
    'Decisions — Freeze the I/O list on rev D by Friday; On inconsistencies C-04 and C-05, we agree to close C-04 as a drawing error and keep C-05 open until the supplier confirms the status word…; For the client question on the HV cell date, electrical can confirm we need the cell energised by 20 November at the latest — that is the a…. 3 actions (S. Haddad, P. Noguès, A. Girard).',
  draft: [
    ['decision', 'Freeze the I/O list on rev D by Friday', ''],
    ['decision', 'On inconsistencies C-04 and C-05, we agree to close C-04 as a drawing error and keep C-05 open until the supplier confirms the status word mapping', ''],
    ['decision', 'For the client question on the HV cell date, electrical can confirm we need the cell energised by 20 November at the latest — that is the answer to give the port authority', ''],
    ['action', 'Update the electrical schematics for the three tags', 'S. Haddad · 6 Oct'],
    ['action', 'Send the corrected P&ID sheet for C-04', 'P. Noguès · 3 Oct'],
    ['action', 'Carry it to the steering committee', 'A. Girard · —'],
  ],
};

describe('meetings screen — interactions played on both sides', () => {
  const state: any = { mtg: P.mtg0(), added: P.added0() };
  const set = (patch: any) => Object.assign(state.mtg, patch);
  /** The analysed meeting whose prototype analysis is replaced by the local one (S-10). */
  let localAnalysis: string | null = null;
  const same = async (sel: string, lang: Lang = 'en') => {
    for (const view of ['meetings', 'decisions', 'actions'] as const) {
      const exp = expected({ ...state, mtg: { ...state.mtg, sel, view } }, lang);
      const tr = exp.detail?.prep?.transcript;
      if (tr && sel === localAnalysis && tr[1]) {
        tr[2] = LOCAL_119.summary; // the analysis text is people's text: the same in EN and FR
        tr[3] = LOCAL_119.draft.map(([type, text, meta]) => [type, text, lang === 'fr' ? meta.replace('6 Oct', '6 oct.').replace('3 Oct', '3 oct.') : meta]);
      }
      fixNoDue(exp, lang);
      expect(actual(await ours('HLT-026', lang, { meeting: sel, view }))).toEqual(exp);
    }
  };
  /**
   * S-10 brings the first minutes action without a due date ("—", A. Girard's): the rebuild keeps it Open, the prototype's
   * `mIdx('— 2026') < PG_NOW` made it Overdue (and counted it in the "{n} overdue" KPI).
   */
  const fixNoDue = (exp: any, lang: Lang) => {
    const t = makeT(lang);
    let n = 0;
    for (const a of exp.actions)
      if (a[2] === '—' && !a[7] && a[6] === t('Overdue')) {
        a[3] = 'var(--color-neutral-400)';
        a[6] = t('Open');
        n++;
      }
    if (n) exp.kpis[2][2] = t(`${parseInt(exp.kpis[2][2], 10) - n} overdue`);
  };

  it('tick an MTG-118 action and reopen an MTG-116 one (carried over into #24, 1 / 2 closed)', async () => {
    expect(await toggleMeetingAction('MTG-118', 1, 1, 'Romain Aubert')).toBe(true);
    expect(await toggleMeetingAction('MTG-116', 0, 0, 'Romain Aubert')).toBe(false);
    set({ ov: { 'MTG-118': { done: { 'MTG-118|1|1': true } }, 'MTG-116': { done: { 'MTG-116|0|0': false } } } });
    await same('MTG-118');
    await same('MTG-118', 'fr');
    await same('MTG-116');
  });

  it('notes added to MTG-119 (scheduled → notes in progress; a past due action is overdue)', async () => {
    await addMeetingLine('MTG-119', 0, { type: 'decision', text: 'Freeze the I/O list on rev D' }, 'Antoine Girard');
    await addMeetingLine('MTG-119', 0, { type: 'action', text: 'Check the PLC table', owner: 'J. Wagner', due: '25 Sep' }, 'Antoine Girard');
    set({ lines: { 'MTG-119': { 0: [['decision', 'Freeze the I/O list on rev D', '', ''], ['action', 'Check the PLC table', 'J. Wagner', '25 Sep']] } }, ov: { ...state.mtg.ov, 'MTG-119': { status: 'Notes in progress' } } });
    await same('MTG-119');
    await same('MTG-119', 'fr');
  });

  it('MTG-119 transcript analysed, then its proposals added to the last agenda point', async () => {
    await analyseTranscript('MTG-119', 'Antoine Girard');
    set({ analysed: { 'MTG-119': true } });
    localAnalysis = 'MTG-119';
    await same('MTG-119');
    await same('MTG-119', 'fr');
    await applyTranscriptToMinutes('MTG-119', 'Antoine Girard');
    // The prototype's state gets the lines the local analysis added (S-10), so its registers and agenda are compared as before.
    const drafts = LOCAL_119.draft.map(([type, text, meta]) => (type === 'decision' ? ['decision', text] : ['action', text, ...meta.split(' · ')]));
    set({ applied: { 'MTG-119': true }, lines: { ...state.mtg.lines, 'MTG-119': { ...state.mtg.lines['MTG-119'], 2: drafts } } });
    await same('MTG-119');
    await same('MTG-119', 'fr');
  });

  it('minutes of MTG-118 sent: MIN-HLT-027 on 30 Sep, read receipts for every invitee but the organizer', async () => {
    const r = await sendMinutes('MTG-118', 'Romain Aubert');
    expect(r).toMatchObject({ minutesNumber: 'MIN-HLT-027', invited: 5 });
    // S-12 a (R-067): L. Fabre (internal, outside the resource pool) gets a task too — the prototype made 2.
    expect(r.tasks).toHaveLength(3);
    set({ ov: { ...state.mtg.ov, 'MTG-118': { ...state.mtg.ov['MTG-118'], status: 'Minutes sent', doc: 'MIN-HLT-027', sent: '30 Sep', read: { 'L. Fabre': '', 'J. Wagner': '', 'H. Sauvage': '', 'T. Kerbrat': '' } } } });
    await same('MTG-118');
    await same('MTG-118', 'fr');
    // The action of J. Wagner now links to its task (S-12 a: the second task, after L. Fabre's).
    const m = await ours('HLT-026', 'en', { meeting: 'MTG-118' });
    expect(m.detail!.agenda[1].lines[1]).toMatchObject({ taskNumber: r.tasks[1], taskHref: `/my/tasks/${r.tasks[1]}` });
  });

  it('"New meeting" MTG-130 on top of the register, organized by the viewer', async () => {
    const n = await createMeeting(
      'HLT-026',
      { title: 'Weekly site meeting #25', type: 'internal', series: 'weekly_site', date: '2026-10-06', time: '08:30', location: 'Site office', invitees: ['R. Aubert', 'L. Fabre', 'J. Wagner'], agenda: ['Safety', 'Steel'] },
      'Marie Lefebvre',
    );
    expect(n).toBe('MTG-130');
    state.added = { ...state.added, meetings: [{ title: 'Weekly site meeting #25', type: 'Internal', series: 'Weekly site meeting', date: '6 Oct 2026', time: '08:30', loc: 'Site office', invited: 'R. Aubert, L. Fabre, J. Wagner', agenda: 'Safety\nSteel', proj: 'HLT-026' }] };
    await same('MTG-130');
    await same('MTG-130', 'fr');
  });

  it('a second meeting the same day: created meetings keep their creation order (MTG-130 before MTG-131), above the seeded register', async () => {
    const n = await createMeeting(
      'HLT-026',
      { title: 'Supplier review — Nordvolt FAT', type: 'external', series: 'supplier_review', date: '2026-10-06', time: '08:30', location: 'Teams', invitees: ['K. Lindqvist (Nordvolt)', 'S. Haddad'], agenda: [] },
      'Marie Lefebvre',
    );
    expect(n).toBe('MTG-131');
    state.added = {
      ...state.added,
      meetings: [
        ...state.added.meetings,
        { title: 'Supplier review — Nordvolt FAT', type: 'External', series: 'Supplier review', date: '6 Oct 2026', time: '08:30', loc: 'Teams', invited: 'K. Lindqvist (Nordvolt), S. Haddad', agenda: '', proj: 'HLT-026' },
      ],
    };
    await same('MTG-131');
    await same('MTG-130');
    expect((await ours('HLT-026', 'en', { filter: 'upcoming' })).cards.map((c) => c.number)).toEqual(['MTG-130', 'MTG-131', 'MTG-120']); // MTG-119 has notes in progress since the composer test
  });
});
