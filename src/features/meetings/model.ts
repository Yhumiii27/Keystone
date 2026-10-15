// Meetings & minutes view model (docs/spec/05 §5.3–5.5, template 753–813, logic 4817–4867): the domain derivations
// (src/domain/meetings.ts) turned into the translated strings, tag classes, colours and links the screen renders.
// URL state (00 §8.3): `?view=meetings|decisions|actions`, `?filter=todo|upcoming|sent`, `?meeting=MTG-118`, and (D-5)
// `?decisions=client` — the Decisions register limited to the decisions of meetings with the client.
import { LO, OK, TAG_CLASS, statusTone } from '@/components/app/tones';
import { screenHref } from '@/config/screens';
import {
  ACTION_STATE_LABEL, DECISION_SCOPES, DECISION_SCOPE_LABEL, MEETING_FILTERS, MEETING_FILTER_LABEL, MEETING_VIEWS, MEETING_VIEW_LABEL, actionCountOf, actionRows, attendanceOf,
  carriedOver, decisionRowsIn, draftLines, filterCounts, lineKey, matchesFilter, meetingKpis, minutesEditable, prepPack, reviewOrder, selectMeeting, sortMeetings,
  type ClientQuestion, type DecisionScope, type LineRef, type Meeting, type MeetingFilter, type MeetingLine, type MeetingTranscript, type MeetingsView, type ProposalKind,
} from '@/domain/meetings';
import { docHref, documentsHref } from '@/features/docs/links';
import type { Lang, T } from '@/i18n/translate';
import { meetingLineType, meetingSeries, meetingStatus, meetingType, shortDateOfIso, transcriptProposalType, type MeetingLineType } from '@/server/db/codes';
import { actionsText, dataText, dueText, invitedText } from './i18n';

export interface MeetingsQuery {
  view: MeetingsView;
  filter: MeetingFilter;
  /** Requested meeting (`?meeting=`), validated against the register. */
  meeting: string | null;
  /** Decisions register scope (`?decisions=client`, D-5); default all. */
  decisions?: DecisionScope;
}

/** Screen URL with only the non-default parameters (view, filter, meeting, decisions scope). */
export function meetingsHref(code: string, q: Partial<MeetingsQuery>): string {
  const u = new URLSearchParams();
  if (q.view && q.view !== 'meetings') u.set('view', q.view);
  if (q.filter && q.filter !== 'all') u.set('filter', q.filter);
  if (q.meeting) u.set('meeting', q.meeting);
  if (q.decisions === 'client') u.set('decisions', 'client');
  const base = screenHref('meetings', { code });
  const qs = u.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * "Open minutes" (`openDoc`): the MIN record in the Codex index (Documents screen, record drawer) — the project's
 * vault when the record is not indexed (MIN-HLT-022 of the seed).
 */
export function minutesHref(code: string, m: Pick<Meeting, 'minutesNumber' | 'minutesIndexed'>): string {
  return m.minutesNumber && m.minutesIndexed ? docHref(m.minutesNumber, code) : documentsHref(code);
}

/** D-5: the project's client decisions — the Decisions register limited to meetings with the client (Site's "Client communication log"). */
export const clientDecisionsHref = (code: string) => meetingsHref(code, { view: 'decisions', decisions: 'client' });

const taskHref = (n: string | null) => (n ? screenHref('task', { taskId: n }) : null);

/** Type icon colour (typeColor 4856). */
export const LINE_COLOR: Record<MeetingLineType, string> = { action: 'var(--color-accent-300)', decision: 'var(--color-accent)', info: 'var(--color-neutral-500)' };

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

export interface ChipView {
  value: MeetingFilter;
  label: string;
  count: number;
  href: string;
}

export interface CardView {
  number: string;
  title: string;
  typeLabel: string;
  typeClass: string;
  statusLabel: string;
  statusClass: string;
  /** "29 Sep 2026 · 08:30 · 5 invited · 3 actions". */
  sub: string;
  selected: boolean;
  href: string;
}

export interface LineView {
  ref: LineRef;
  key: string;
  type: MeetingLineType;
  /** Uppercase type label ("Action"). */
  typeLabel: string;
  text: string;
  isAction: boolean;
  done: boolean;
  /** "{owner} · {due}" under an action. */
  meta: string;
  taskNumber: string | null;
  taskHref: string | null;
}

export interface AgendaPointView {
  position: number;
  title: string;
  lines: LineView[];
}

export interface PrepActionView {
  ref: LineRef;
  key: string;
  text: string;
  meta: string;
  done: boolean;
}

export interface PrepView {
  prev: { ref: string; decisions: string[]; actions: PrepActionView[]; closedCount: string } | null;
  bridge: { title: string; items: { key: string; text: string; sub: string; label: string; cls: string; answer: string }[] } | null;
  transcript: TranscriptView | null;
}

/** One analysis proposal under review (chapter 4, S-10). */
export interface TranscriptItemView {
  key: string;
  position: number;
  type: ProposalKind;
  /** "Decision", "Action", "Risk", "Client question" (translated). */
  typeLabel: string;
  text: string;
  /** Actions: "{owner} · {due}"; other kinds: the speaker who raised it. */
  meta: string;
  /** "A. Girard: « … »" — the excerpt the proposal comes from (tooltip). */
  source: string;
  status: 'proposed' | 'rejected' | 'applied';
  /** "Discarded", "Added to the minutes", "Added to the risk register · R-21", "Added to the client questions". */
  statusText: string | null;
  /** Initial values of the Edit / New risk / client question forms (people's text, untranslated). */
  init: { text: string; owner: string; due: string; askedBy: string };
}

export interface TranscriptView {
  text: string;
  analysed: boolean;
  summary: string;
  /** Decisions and actions kept for the minutes (prototype draft lines). */
  draft: { key: string; type: 'decision' | 'action'; text: string; meta: string }[];
  applied: boolean;
  // ── Chapter 4 (S-10) ──
  /** "Teams transcript" / "Pasted text · R. Aubert · 9 Oct" / "meeting.vtt · R. Aubert · 9 Oct". */
  sourceText: string;
  /** Uploaded file name (the head of `sourceText`, linked to its download — transcriptFileHref), null for a paste / Teams. */
  fileName: string | null;
  /** "Local analysis (rules) · the transcript stayed in Keystone" / "Analysis by Claude (Anthropic) · claude-opus-5-5 · …". */
  analyzerText: string | null;
  /** Translated fallback notice ("Claude could not be reached · local analysis used instead"). */
  notice: string | null;
  items: TranscriptItemView[];
  /** Kept decisions and actions not yet in the minutes. */
  pendingMinutes: number;
  /** Something was added from the analysis: it can no longer be replaced. */
  locked: boolean;
}

export interface DetailView {
  number: string;
  title: string;
  /** "{date} · {time} · {dur} · {loc} · {organizer}". */
  meta: string;
  /** "Synced from Outlook · {series}". */
  synced: string;
  typeLabel: string;
  typeClass: string;
  statusLabel: string;
  statusClass: string;
  /** "Attendance · 5 Invited". */
  attendanceTitle: string;
  attendance: { key: string; label: string; cls: string; absent: boolean }[];
  carried: { title: string; hint: string; items: { ref: LineRef; key: string; text: string; meta: string }[] } | null;
  prep: PrepView | null;
  agenda: AgendaPointView[];
  /** Minutes not sent yet (composer, Send minutes, point selection). */
  editable: boolean;
  sent: { text: string; dist: { key: string; label: string; cls: string }[]; openHref: string } | null;
  /** This meeting's URL in the current view (keeps the selection after a write). */
  selfHref: string;
}

export interface DecisionRowView {
  key: string;
  text: string;
  meetingTitle: string;
  meetingRef: string;
  pointTitle: string;
  typeLabel: string;
  typeClass: string;
  href: string;
}

export interface ActionRowView {
  ref: LineRef;
  key: string;
  text: string;
  owner: string;
  due: string;
  dueColor: string;
  meetingTitle: string;
  meetingRef: string;
  stateText: string;
  done: boolean;
  href: string;
  taskHref: string | null;
}

export interface MeetingsScreenView {
  view: MeetingsView;
  viewSeg: { value: MeetingsView; label: string; href: string }[];
  kpis: KpiView[];
  filter: MeetingFilter;
  chips: ChipView[];
  cards: CardView[];
  detail: DetailView | null;
  decisions: DecisionRowView[];
  /** Decisions register scope chips (D-5): All / With the client. */
  decisionScope: DecisionScope;
  decisionChips: { value: DecisionScope; label: string; count: number; href: string }[];
  actions: ActionRowView[];
}

export interface MeetingsInput {
  code: string;
  meetings: Meeting[];
  questions: ClientQuestion[];
  query: MeetingsQuery;
  /**
   * The viewer is a client (P-10b): the tasks the minutes created are internal — their numbers and links are not shown (an
   * external owner's action becomes an internal follow-up task, S-12 a); nor the plan activity of an action.
   */
  client?: boolean;
}

const tagOf = (kind: 'meetingType' | 'meetingStatus', code: string) => TAG_CLASS[statusTone(kind, code)];

export function meetingsScreenView({ code, meetings: ms, questions, query, client = false }: MeetingsInput, t: T, lang: Lang): MeetingsScreenView {
  const title = (m: Meeting) => dataText(m.title, lang);
  const ref = (m: Meeting) => `${m.number} · ${t(m.dateText)}`;
  const due = (d: string | null) => dueText(d, t, lang);
  const ownerDue = (owner: string | null, d: string | null) => `${owner ?? ''} · ${due(d)}`;
  const selected = selectMeeting(ms, query.meeting);
  const href = (q: Partial<MeetingsQuery>) => meetingsHref(code, { view: query.view, filter: query.filter, meeting: query.meeting, ...q });

  // KPI tiles (mtgKpis 4866)
  const k = meetingKpis(ms);
  const kpis: KpiView[] = [
    { label: t('Meetings this week'), value: String(k.thisWeek), sub: t(`${k.upcoming} upcoming`), color: OK },
    { label: t('Minutes to write'), value: String(k.toWrite), sub: t('send within 24 h'), color: k.toWrite > 0 ? LO : OK },
    { label: t('Open actions'), value: String(k.openActions), sub: t(`${k.overdueActions} overdue`), color: k.overdueActions > 0 ? LO : OK },
    { label: t('Decisions this month'), value: String(k.decisionsThisMonth), sub: t(`${k.decisionsWithClient} with the client`), color: OK },
  ];

  // Status chips and meeting cards (4829–4830)
  const counts = filterCounts(ms);
  const chips = MEETING_FILTERS.map((f) => ({ value: f, label: t(MEETING_FILTER_LABEL[f]), count: counts[f], href: href({ view: 'meetings', filter: f }) }));
  const cards = sortMeetings(ms.filter((m) => matchesFilter(m, query.filter))).map((m): CardView => {
    const n = actionCountOf(m);
    return {
      number: m.number,
      title: title(m),
      typeLabel: t(meetingType.label(m.type)),
      typeClass: tagOf('meetingType', m.type),
      statusLabel: t(meetingStatus.label(m.status)),
      statusClass: tagOf('meetingStatus', m.status),
      sub: `${t(m.dateText)} · ${m.time} · ${invitedText(m.participants.length, lang)}${n ? ` · ${t(actionsText(n))}` : ''}`,
      selected: m.number === selected?.number,
      href: href({ view: 'meetings', meeting: m.number }),
    };
  });

  const lineView = (m: Meeting, l: MeetingLine): LineView => {
    const r = { meeting: m.number, point: l.point, position: l.position };
    return {
      ref: r, key: lineKey(r), type: l.type, typeLabel: t(meetingLineType.label(l.type)), text: dataText(l.text, lang), isAction: l.type === 'action', done: l.done,
      meta: l.type === 'action' ? ownerDue(l.owner, l.due) + (l.activity && !client ? ` · ${l.activity}` : '') : '',
      taskNumber: client ? null : l.taskNumber, taskHref: client ? null : taskHref(l.taskNumber),
    };
  };

  // Detail card (mtgSel 4857–4861, mtgPrep 4835–4846)
  let detail: DetailView | null = null;
  if (selected) {
    const m = selected;
    const carried = carriedOver(ms, m);
    const prep = prepPack(ms, m, questions);
    let prepView: PrepView | null = null;
    if (prep) {
      const tr = prep.transcript;
      prepView = {
        prev: prep.prev
          ? {
              ref: `${dataText(prep.prev.title, lang)} · ${t(prep.prev.dateText)}`,
              decisions: prep.prevDecisions.map((d) => dataText(d, lang)),
              actions: prep.prevActions.map((a) => ({ ref: a, key: lineKey(a), text: dataText(a.text, lang), meta: ownerDue(a.owner, a.due), done: a.done })),
              closedCount: `${prep.closed} / ${prep.total}`,
            }
          : null,
        bridge: prep.bridge.length
          ? {
              title: t(prep.internal ? 'From the client meeting — questions to prepare' : 'From the internal meeting — answers to bring to the client'),
              items: prep.bridge.map((q, i) => ({
                key: String(i),
                text: dataText(q.text, lang),
                sub: t((prep.internal ? `Client question · ${q.askedBy}` : `Answer from ${q.department}`) + ` · ${q.owner}`),
                label: t(q.answered ? 'Answer ready' : 'Needs an answer'),
                cls: TAG_CLASS[statusTone('clientQuestion', q.answered ? 'answered' : 'open')],
                answer: q.answer ? dataText(q.answer, lang) : '',
              })),
            }
          : null,
        transcript: tr ? transcriptView(tr, t, lang, m.organizer) : null,
      };
    }
    detail = {
      number: m.number,
      title: title(m),
      meta: `${t(m.dateText)} · ${m.time} · ${t(m.durationText)} · ${m.location} · ${m.organizer}`,
      synced: `${t('Synced from Outlook')} · ${t(meetingSeries.label(m.series))}`,
      typeLabel: t(meetingType.label(m.type)),
      typeClass: tagOf('meetingType', m.type),
      statusLabel: t(meetingStatus.label(m.status)),
      statusClass: tagOf('meetingStatus', m.status),
      attendanceTitle: `${t('Attendance')} · ${m.participants.length} ${t('Invited')}`,
      attendance: attendanceOf(m).map((a) => ({ key: a.name, label: a.absent ? `${a.name} · ${t('absent')}` : a.name, cls: TAG_CLASS[a.tone], absent: a.absent })),
      carried:
        carried && carried.items.length
          ? {
              title: `${t('Carried over from')} ${carried.from.number}`,
              hint: t('Open points from the previous meeting · tick when closed'),
              items: carried.items.map((c) => ({ ref: c, key: lineKey(c), text: dataText(c.text, lang), meta: ownerDue(c.owner, c.due) })),
            }
          : null,
      prep: prepView,
      agenda: m.agenda.map((a) => ({ position: a.position, title: dataText(a.title, lang), lines: a.lines.map((l) => lineView(m, l)) })),
      editable: minutesEditable(m),
      sent:
        m.status === 'minutes_sent'
          ? {
              text: m.sentText && m.minutesNumber ? t(`Sent ${m.sentText} · ${m.minutesNumber}`) : '',
              dist: m.participants
                .filter((p) => p.minutesRecipient)
                .map((p) => ({ key: p.name, label: `${p.name} · ${t(p.readText ? `Read ${p.readText}` : 'Not read yet')}`, cls: TAG_CLASS[p.readText ? 'neutral' : 'outline'] })),
              openHref: minutesHref(code, m),
            }
          : null,
      selfHref: meetingsHref(code, { view: query.view, filter: query.filter, meeting: m.number }),
    };
  }

  // Registers (4863–4864)
  const decisionScope = query.decisions ?? 'all';
  const decisionChips = DECISION_SCOPES.map((sc) => ({
    value: sc, label: t(DECISION_SCOPE_LABEL[sc]), count: decisionRowsIn(ms, sc).length, href: meetingsHref(code, { view: 'decisions', filter: query.filter, decisions: sc }),
  }));
  const decisions = decisionRowsIn(ms, decisionScope).map((d): DecisionRowView => ({
    key: lineKey({ meeting: d.meeting.number, point: d.line.point, position: d.line.position }),
    text: dataText(d.line.text, lang),
    meetingTitle: title(d.meeting),
    meetingRef: ref(d.meeting),
    pointTitle: dataText(d.pointTitle, lang),
    typeLabel: t(meetingType.label(d.meeting.type)),
    typeClass: tagOf('meetingType', d.meeting.type),
    href: meetingsHref(code, { filter: query.filter, meeting: d.meeting.number }),
  }));
  const actions = actionRows(ms).map((a): ActionRowView => {
    const r = { meeting: a.meeting.number, point: a.line.point, position: a.line.position };
    return {
      ref: r,
      key: lineKey(r),
      text: dataText(a.line.text, lang),
      owner: a.line.ownerFull ?? a.line.owner ?? '',
      due: due(a.line.due),
      dueColor: a.state === 'done' ? 'var(--color-neutral-500)' : a.state === 'overdue' ? LO : 'var(--color-neutral-400)',
      meetingTitle: title(a.meeting),
      meetingRef: ref(a.meeting),
      stateText: t(ACTION_STATE_LABEL[a.state]),
      done: a.line.done,
      href: meetingsHref(code, { filter: query.filter, meeting: a.meeting.number }),
      taskHref: client ? null : taskHref(a.line.taskNumber),
    };
  });

  return {
    view: query.view,
    viewSeg: MEETING_VIEWS.map((v) => ({ value: v, label: t(MEETING_VIEW_LABEL[v]), href: href({ view: v }) })),
    kpis,
    filter: query.filter,
    chips,
    cards,
    detail,
    decisions,
    decisionScope,
    decisionChips,
    actions,
  };
}

// ── Transcript (chapter 4, S-10) ───────────────────────────────────────────────────────────────────────────────────

/** Download of a meeting's uploaded transcript file (src/app/api/meetings/[number]/transcript/route.ts). */
export const transcriptFileHref = (meeting: string) => `/api/meetings/${encodeURIComponent(meeting)}/transcript`;

/** "Teams transcript" / "Pasted text · {who} · {date}" / "{file} · {who} · {date}". */
function transcriptSource(tr: MeetingTranscript, t: T): string {
  if (!tr.source || tr.source === 'teams') return t('Teams transcript');
  const head = tr.source === 'file' && tr.fileName ? tr.fileName : t('Pasted text');
  return [head, tr.importedBy ?? '', tr.importedOn ? t(shortDateOfIso(tr.importedOn)) : ''].filter(Boolean).join(' · ');
}

function analyzerText(tr: MeetingTranscript, t: T): string | null {
  if (!tr.analysed) return null;
  if (tr.analyzer === 'claude') return [t('Analysis by Claude (Anthropic)'), tr.analyzerModel ?? '', t('the transcript was sent to Anthropic')].filter(Boolean).join(' · ');
  if (tr.analyzer === 'local') return `${t('Local analysis (rules)')} · ${t('the transcript stayed in Keystone')}`;
  return t('Pre-recorded analysis (prototype data)');
}

/** Transcript box of the preparation pack: the prototype's summary and draft lines plus the review list. */
export function transcriptView(tr: MeetingTranscript, t: T, lang: Lang, organizer: string): TranscriptView {
  const due = (d: string | null) => dueText(d, t, lang);
  const items = reviewOrder(tr.items ?? []).map((x): TranscriptItemView => {
    const status = x.status === 'applied' ? 'applied' : x.status === 'rejected' ? 'rejected' : 'proposed';
    const ref = x.appliedRef ?? '';
    const statusText =
      status === 'rejected'
        ? t('Discarded')
        : status !== 'applied'
          ? null
          : /^R-\d+$/.test(ref)
            ? `${t('Added to the risk register')} · ${ref}`
            : ref === 'Q&A'
              ? t('Added to the client questions')
              : t('Added to the minutes');
    return {
      key: `${x.type}-${x.position}`,
      position: x.position,
      type: x.type,
      typeLabel: t(transcriptProposalType.label(x.type)),
      text: dataText(x.text, lang),
      meta: x.type === 'action' ? `${x.owner ?? '—'} · ${x.due ? due(x.due) : '—'}` : x.type === 'risk' && x.owner ? x.owner : (x.speaker ?? ''),
      source: x.quote ? `${x.speaker ? `${x.speaker}: ` : ''}« ${x.quote} »` : '',
      status,
      statusText,
      init: { text: x.text, owner: x.owner ?? '', due: x.due ?? '', askedBy: x.speaker ?? '' },
    };
  });
  return {
    text: dataText(tr.text, lang),
    analysed: tr.analysed,
    summary: tr.summary ? dataText(tr.summary, lang) : '',
    draft: draftLines(tr).map((p, i) => ({
      key: String(i), type: p.type, text: dataText(p.text, lang), meta: p.type === 'action' ? `${p.owner ?? organizer} · ${due(p.due ?? '—')}` : '', // as the minutes line will read
    })),
    applied: tr.applied,
    sourceText: transcriptSource(tr, t),
    fileName: tr.source === 'file' && tr.fileName ? tr.fileName : null,
    analyzerText: analyzerText(tr, t),
    notice: tr.notice ? tr.notice.split(' · ').map(t).join(' · ') : null,
    items,
    pendingMinutes: (tr.items ?? []).filter((x) => (x.type === 'decision' || x.type === 'action') && (x.status === 'proposed' || x.status === 'accepted')).length,
    locked: tr.applied || (tr.items ?? []).some((x) => x.status === 'applied'),
  };
}
