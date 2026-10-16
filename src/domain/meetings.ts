// Meetings & minutes — pure domain logic (docs/spec/05 §5, prototype logic 4817–4867). Works on the meeting
// register of one project as the DAL returns it (`listMeetings`, codes not labels) and reproduces the prototype's
// derivations: status sort, chips, KPI tiles, carried-over actions, preparation pack (previous meeting, internal ⇄
// client question bridge, transcript), Decisions and Actions registers. Text is English source; screens translate.
// Also the input parsers of the writes: "New meeting" (AF `meetings`) and the minutes composer.
import { isoOfDisplayDate, monthIndexOfIso, type MeetingLineType, type MeetingSeries, type MeetingStatus, type MeetingType } from '@/server/db/codes';

// ── Input model (structurally compatible with the DAL `MeetingRow` / `ClientQuestionRow`) ──────────────────

export interface MeetingLine {
  /** Agenda point index and line index (prototype key `{id}|{i}|{j}`). */
  point: number;
  position: number;
  type: MeetingLineType;
  text: string;
  /** Actions: owner as typed and its full name when the owner is in the resource pool (`fullName`). */
  owner: string | null;
  ownerFull: string | null;
  /** Actions: due as typed ("2 Oct", "—"). */
  due: string | null;
  done: boolean;
  /** Open action due before the business date's month index (the prototype's `mIdx(due) < PG_NOW`; R-013). */
  overdue: boolean;
  /** Task created for the owner by "Send minutes". */
  taskNumber: string | null;
  /** Actions (S-12 a, R-067): the plan activity code the action serves. */
  activity?: string | null;
}

export interface MeetingParticipant {
  name: string;
  present: boolean;
  /** Receives the minutes (every invitee but the organizer, once sent). */
  minutesRecipient: boolean;
  /** "27 Sep" or "". */
  readText: string;
}

export interface TranscriptProposal {
  type: 'decision' | 'action';
  text: string;
  owner: string | null;
  due: string | null;
}

/** One proposal of a transcript analysis with its review state (chapter 4, S-10). */
export interface TranscriptItem {
  position: number;
  type: 'decision' | 'action' | 'risk' | 'question';
  text: string;
  owner: string | null;
  due: string | null;
  speaker: string | null;
  quote: string | null;
  status: 'proposed' | 'accepted' | 'rejected' | 'applied';
  /** "MTG-119|2|3" (minutes line), "R-21" (risk register), "Q&A" (client questions). */
  appliedRef: string | null;
}

export interface MeetingTranscript {
  text: string;
  analysed: boolean;
  summary: string | null;
  /** Decisions and actions for the minutes (not discarded). */
  proposals: TranscriptProposal[];
  applied: boolean;
  // Chapter 4 (S-10) — absent in the prototype's model.
  source?: 'teams' | 'paste' | 'file';
  fileName?: string | null;
  analyzer?: 'prototype' | 'local' | 'claude' | null;
  analyzerModel?: string | null;
  /** EN source notice (Claude failed → local analysis). */
  notice?: string | null;
  importedBy?: string | null;
  importedOn?: string | null;
  items?: TranscriptItem[];
}

export interface Meeting {
  /** "MTG-118". */
  number: string;
  title: string;
  series: MeetingSeries;
  type: MeetingType;
  status: MeetingStatus;
  /** "29 Sep 2026". */
  dateText: string;
  /** Month index of the date (prototype `mIdx(date)`). */
  monthIndex: number;
  time: string;
  /** "45 min", "1 h 30". */
  durationText: string;
  location: string;
  /** Short name ("R. Aubert"). */
  organizer: string;
  /** S-11 (R-037): the meeting came from Outlook / Teams (meetings.external_calendar_id) — none until the Microsoft 365 link exists. */
  syncedFromOutlook?: boolean;
  minutesNumber: string | null;
  /** The minutes record exists in the Codex index. */
  minutesIndexed: boolean;
  /** Send date "26 Sep" or "". */
  sentText: string;
  participants: MeetingParticipant[];
  agenda: { position: number; title: string; lines: MeetingLine[] }[];
  transcript: MeetingTranscript | null;
}

export interface ClientQuestion {
  text: string;
  /** "N. Bensaïd", "Infrastructure BU". */
  askedBy: string;
  /** Answering department ("Electrical"). */
  department: string;
  owner: string;
  state: 'open' | 'answered';
  answer: string | null;
}

// ── View state (URL) ────────────────────────────────────────────────────────────────────────────────────

/** `?view=` (mtgViewSeg 4862). */
export const MEETING_VIEWS = ['meetings', 'decisions', 'actions'] as const;
export type MeetingsView = (typeof MEETING_VIEWS)[number];
export const MEETING_VIEW_LABEL: Record<MeetingsView, string> = { meetings: 'Meetings', decisions: 'Decisions', actions: 'Actions' };
export const parseMeetingsView = (v: unknown): MeetingsView => (MEETING_VIEWS as readonly unknown[]).includes(v) ? (v as MeetingsView) : 'meetings';

/** `?filter=` (mtgChips 4830). */
export const MEETING_FILTERS = ['all', 'todo', 'upcoming', 'sent'] as const;
export type MeetingFilter = (typeof MEETING_FILTERS)[number];
export const MEETING_FILTER_LABEL: Record<MeetingFilter, string> = { all: 'All', todo: 'Minutes to write', upcoming: 'Upcoming', sent: 'Minutes sent' };
const FILTER_STATUS: Record<Exclude<MeetingFilter, 'all'>, MeetingStatus> = { todo: 'notes_in_progress', upcoming: 'scheduled', sent: 'minutes_sent' };
export const parseMeetingFilter = (v: unknown): MeetingFilter => (MEETING_FILTERS as readonly unknown[]).includes(v) ? (v as MeetingFilter) : 'all';

/**
 * `?decisions=` of the Decisions register (D-5): every decision, or the client decisions only — the target of the Site's
 * "Client communication log" button (the owner answered D-5 "use the project's meetings and decisions").
 */
export const DECISION_SCOPES = ['all', 'client'] as const;
export type DecisionScope = (typeof DECISION_SCOPES)[number];
export const DECISION_SCOPE_LABEL: Record<DecisionScope, string> = { all: 'All', client: 'With the client' };
export const parseDecisionScope = (v: unknown): DecisionScope => (v === 'client' ? 'client' : 'all');

/** A meeting with the client: an external meeting (the prototype's "decisions … with the client", mtgKpis 4866). */
export const isClientMeeting = (m: Pick<Meeting, 'type'>) => m.type === 'external';

/** Composer type segment (draftSeg 4861; default Action). */
export const LINE_TYPES: readonly MeetingLineType[] = ['info', 'decision', 'action'];

// ── Register ───────────────────────────────────────────────────────────────────────────────────────────

/** `mtgOrder` (4822): Notes in progress, Scheduled, Minutes sent. */
export const STATUS_ORDER: Record<MeetingStatus, number> = { notes_in_progress: 0, scheduled: 1, minutes_sent: 2 };

/** Meeting list order (4829): status order, then date descending; ties keep the register order. */
export function sortMeetings<M extends Pick<Meeting, 'status' | 'monthIndex'>>(ms: readonly M[]): M[] {
  return [...ms].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.monthIndex - a.monthIndex);
}

export const matchesFilter = (m: Pick<Meeting, 'status'>, f: MeetingFilter) => f === 'all' || m.status === FILTER_STATUS[f];

/** Chip counts (4830). */
export function filterCounts(ms: readonly Pick<Meeting, 'status'>[]): Record<MeetingFilter, number> {
  return Object.fromEntries(MEETING_FILTERS.map((f) => [f, ms.filter((m) => matchesFilter(m, f)).length])) as Record<MeetingFilter, number>;
}

/**
 * Selected meeting (`MS`, 4831): the requested one when it belongs to the project, else the first of the sorted
 * list. The prototype's default state selects MTG-118 (Harbor Line's meeting with notes in progress, first of the
 * sorted list) and falls back to the first meeting of the register for other projects.
 */
export function selectMeeting<M extends Pick<Meeting, 'number' | 'status' | 'monthIndex'>>(ms: readonly M[], requested: string | null | undefined): M | null {
  const hit = requested ? ms.find((m) => m.number === requested.toUpperCase()) : undefined;
  return hit ?? sortMeetings(ms)[0] ?? null;
}

/** Minutes can be edited until they are sent (`mtgEditable`, 4832). */
export const minutesEditable = (m: Pick<Meeting, 'status'>) => m.status !== 'minutes_sent';

/** Number of action lines of a meeting (list sub "· 3 actions"). */
export const actionCountOf = (m: Pick<Meeting, 'agenda'>) => m.agenda.reduce((s, a) => s + a.lines.filter((l) => l.type === 'action').length, 0);

// ── KPI tiles (mtgKpis 4866) ───────────────────────────────────────────────────────────────────────────

export interface MeetingKpis {
  /** Meetings within ±0.25 month of the business date (≈ ±1 week). */
  thisWeek: number;
  /** Scheduled meetings. */
  upcoming: number;
  /** Notes in progress (alert when > 0). */
  toWrite: number;
  openActions: number;
  /** Open actions past due (alert when > 0). */
  overdueActions: number;
  /** Decisions of meetings held this month (month index ≥ floor(now)). */
  decisionsThisMonth: number;
  /** Decisions of external meetings (all dates — the prototype's "with the client"). */
  decisionsWithClient: number;
}

const linesOf = (ms: readonly Meeting[]) => ms.flatMap((m) => m.agenda.flatMap((a) => a.lines.map((l) => ({ m, l }))));

/** `today`: business date (R-013) — "now" is its month index (the prototype's PG_NOW). */
export function meetingKpis(ms: readonly Meeting[], today: string): MeetingKpis {
  const now = monthIndexOfIso(today);
  const lines = linesOf(ms);
  const actions = lines.filter((x) => x.l.type === 'action');
  const decisions = lines.filter((x) => x.l.type === 'decision');
  return {
    thisWeek: ms.filter((m) => m.monthIndex >= now - 0.25 && m.monthIndex <= now + 0.25).length,
    upcoming: ms.filter((m) => m.status === 'scheduled').length,
    toWrite: ms.filter((m) => m.status === 'notes_in_progress').length,
    openActions: actions.filter((x) => !x.l.done).length,
    overdueActions: actions.filter((x) => actionState(x.l) === 'overdue').length,
    decisionsThisMonth: decisions.filter((x) => x.m.monthIndex >= Math.floor(now)).length,
    decisionsWithClient: decisions.filter((x) => isClientMeeting(x.m)).length,
  };
}

// ── Detail card ────────────────────────────────────────────────────────────────────────────────────────

/** Line reference used by the toggle writer. */
export interface LineRef {
  meeting: string;
  point: number;
  position: number;
}
export const lineKey = (r: LineRef) => `${r.meeting}|${r.point}|${r.position}`;

/** Attendance tag (4857): Scheduled → everyone outline; otherwise present neutral, absent outline "· absent" dimmed. */
export function attendanceOf(m: Pick<Meeting, 'status' | 'participants'>): { name: string; absent: boolean; tone: 'neutral' | 'outline' }[] {
  return m.participants.map((p) => {
    const absent = m.status !== 'scheduled' && !p.present;
    return { name: p.name, absent, tone: m.status === 'scheduled' || absent ? 'outline' : 'neutral' };
  });
}

/** Latest earlier meeting of the same series, any status (`prevSame`, 4853). */
export function previousInSeries<M extends Meeting>(ms: readonly M[], m: M): M | null {
  return [...ms].filter((x) => x.series === m.series && x.number !== m.number && x.monthIndex < m.monthIndex).sort((a, b) => b.monthIndex - a.monthIndex)[0] ?? null;
}

/** Latest meeting of the same series whose minutes were sent (the preparation pack's "previous meeting", 4835). */
export function previousSent<M extends Meeting>(ms: readonly M[], m: M): M | null {
  return [...ms].filter((x) => x.series === m.series && x.status === 'minutes_sent' && x.number !== m.number).sort((a, b) => b.monthIndex - a.monthIndex)[0] ?? null;
}

export interface CarriedItem extends LineRef {
  text: string;
  owner: string;
  due: string;
}

/**
 * "Carried over from {prev}" (4854): the open action lines of the previous meeting of the series (null without a
 * previous meeting; the box shows only when `items` is not empty).
 */
export function carriedOver(ms: readonly Meeting[], m: Meeting): { from: Meeting; items: CarriedItem[] } | null {
  const prev = previousInSeries(ms, m);
  if (!prev) return null;
  const items = prev.agenda
    .flatMap((a) => a.lines)
    .filter((l) => l.type === 'action' && !l.done)
    .map((l) => ({ meeting: prev.number, point: l.point, position: l.position, text: l.text, owner: l.owner ?? '', due: l.due ?? '' }));
  return { from: prev, items };
}

export interface PrepAction extends LineRef {
  text: string;
  owner: string;
  due: string;
  done: boolean;
}

export interface BridgeItem {
  text: string;
  askedBy: string;
  department: string;
  owner: string;
  answered: boolean;
  answer: string | null;
}

export interface PrepPack {
  /** Previous sent meeting of the series ("Decisions from the previous meeting" / "Actions since the previous meeting"). */
  prev: Pick<Meeting, 'number' | 'title' | 'dateText'> | null;
  prevDecisions: string[];
  prevActions: PrepAction[];
  /** "x / n" closed actions of the previous meeting. */
  closed: number;
  total: number;
  /** Internal meeting → questions from the client to prepare; external → the answers ready for the client. */
  internal: boolean;
  bridge: BridgeItem[];
  transcript: MeetingTranscript | null;
}

/** Bridge items (4840): an internal meeting lists every question; an external one only those with an answer. */
export function bridgeItems(type: MeetingType, questions: readonly ClientQuestion[]): BridgeItem[] {
  return questions
    .map((q) => ({ text: q.text, askedBy: q.askedBy, department: q.department, owner: q.owner, answered: q.state === 'answered', answer: q.answer || null }))
    .filter((q) => type === 'internal' || !!q.answer);
}

/** Preparation pack (`mtgPrep`, 4835–4846); null once the minutes are sent. */
export function prepPack(ms: readonly Meeting[], m: Meeting, questions: readonly ClientQuestion[]): PrepPack | null {
  if (m.status === 'minutes_sent') return null;
  const prev = previousSent(ms, m);
  const lines = prev ? prev.agenda.flatMap((a) => a.lines) : [];
  const prevActions = lines
    .filter((l) => l.type === 'action')
    .map((l) => ({ meeting: prev!.number, point: l.point, position: l.position, text: l.text, owner: l.owner ?? '', due: l.due ?? '', done: l.done }));
  return {
    prev: prev ? { number: prev.number, title: prev.title, dateText: prev.dateText } : null,
    prevDecisions: lines.filter((l) => l.type === 'decision').map((l) => l.text),
    prevActions,
    closed: prevActions.filter((a) => a.done).length,
    total: prevActions.length,
    internal: m.type === 'internal',
    bridge: bridgeItems(m.type, questions),
    transcript: m.transcript && m.transcript.text ? m.transcript : null,
  };
}

/** Draft lines of an analysed transcript (4843): proposed decisions first, then actions with "{owner} · {due}". */
export function draftLines(tr: MeetingTranscript | null): TranscriptProposal[] {
  if (!tr?.analysed) return [];
  return [...tr.proposals.filter((p) => p.type === 'decision'), ...tr.proposals.filter((p) => p.type === 'action')];
}

// ── Registers ──────────────────────────────────────────────────────────────────────────────────────────

export interface DecisionRow {
  meeting: Meeting;
  line: MeetingLine;
  /** Title of the agenda point the decision belongs to. */
  pointTitle: string;
}

/** Decisions register (`mtgDecisionRows`, 4864): meeting date descending, register order within a date. */
export function decisionRows(ms: readonly Meeting[]): DecisionRow[] {
  return ms
    .flatMap((m) => m.agenda.flatMap((a) => a.lines.filter((l) => l.type === 'decision').map((line) => ({ meeting: m, line, pointTitle: a.title }))))
    .sort((a, b) => b.meeting.monthIndex - a.meeting.monthIndex);
}

/** Decisions of the register in a scope (D-5: 'client' = decisions of meetings with the client). */
export const decisionRowsIn = (ms: readonly Meeting[], scope: DecisionScope): DecisionRow[] =>
  decisionRows(ms).filter((d) => scope === 'all' || isClientMeeting(d.meeting));

/**
 * "Client decisions logged" (Site tile, A-12 / D-5): decisions recorded in the minutes of the project's meetings with the
 * client. Before D-5 the tile counted the change requests whose client step was decided.
 */
export const clientDecisionCount = (ms: readonly Meeting[]) => decisionRowsIn(ms, 'client').length;

export type ActionState = 'done' | 'overdue' | 'open';
/** Done / Overdue (due before now) / Open (`stText`, 4863). */
export const actionState = (l: Pick<MeetingLine, 'done' | 'overdue'>): ActionState => (l.done ? 'done' : l.overdue ? 'overdue' : 'open');
export const ACTION_STATE_LABEL: Record<ActionState, string> = { done: 'Done', overdue: 'Overdue', open: 'Open' };

export interface ActionRow {
  meeting: Meeting;
  line: MeetingLine;
  state: ActionState;
}

/** Actions register (`mtgActionRows`, 4863): open actions first, register order otherwise. */
export function actionRows(ms: readonly Meeting[]): ActionRow[] {
  return ms
    .flatMap((m) => m.agenda.flatMap((a) => a.lines.filter((l) => l.type === 'action').map((line) => ({ meeting: m, line, state: actionState(line) }))))
    .sort((a, b) => Number(a.line.done) - Number(b.line.done));
}

// ── Input parsing (Server Functions) ───────────────────────────────────────────────────────────────────

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** French month names and abbreviations ("oct.", "octobre", "févr.", "juil."), accents optional. */
const MONTHS_FR: [RegExp, number][] = [
  [/^janv?/, 0], [/^f[ée]vr?/, 1], [/^mars?/, 2], [/^avr/, 3], [/^mai/, 4], [/^juin/, 5], [/^juil/, 6], [/^ao[uû]/, 7], [/^sept?/, 8],
  [/^oct/, 9], [/^nov/, 10], [/^d[ée]c/, 11],
];
const pad2 = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

function monthOf(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, '');
  const en = MONTHS_EN.indexOf(w.slice(0, 3));
  if (en >= 0 && /^[a-z]+$/.test(w)) return en;
  for (const [re, m] of MONTHS_FR) if (re.test(w)) return m;
  return null;
}

/**
 * Meeting date as typed ("6 Oct 2026", "6 oct. 2026", "6 octobre 2026", "06/10/2026", "2026-10-06"; the year
 * defaults to 2026, the data set's year) → ISO date, or null when it is not a real calendar date.
 */
export function parseMeetingDate(text: string | null | undefined, defaultYear = 2026): string | null {
  const s = (text ?? '').trim();
  let y: number;
  let m: number;
  let d: number;
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, d] = [+r[1], +r[2] - 1, +r[3]];
  else if ((r = s.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/))) [d, m, y] = [+r[1], +r[2] - 1, r[3] ? +r[3] + (r[3].length === 2 ? 2000 : 0) : defaultYear];
  else if ((r = s.match(/^(?:[A-Za-zÀ-ÿ]+\.?\s+)?(\d{1,2})(?:er)?\s+([A-Za-zÀ-ÿ]+\.?)(?:\s+(\d{4}))?$/))) {
    const mo = monthOf(r[2]);
    if (mo == null) return null;
    [d, m, y] = [+r[1], mo, r[3] ? +r[3] : defaultYear];
  } else return null;
  if (m < 0 || m > 11 || d < 1 || d > daysIn(y, m) || y < 2000 || y > 2100) return null;
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

/** Start time "09:00", "9:00", "9h", "9h30", "14.30" → "09:00" form, or null. */
export function parseMeetingTime(text: string | null | undefined): string | null {
  const r = (text ?? '').trim().match(/^(\d{1,2})(?:[:h.](\d{2})?)?$/i);
  if (!r) return null;
  const h = +r[1];
  const mi = r[2] ? +r[2] : 0;
  return h < 24 && mi < 60 ? `${pad2(h)}:${pad2(mi)}` : null;
}

/** "R. Aubert, L. Fabre; J. Wagner" → distinct trimmed names. */
export const parseInvitees = (text: string | null | undefined) => [...new Set((text ?? '').split(/[,;\n]/).map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean))];
/** Agenda textarea: one point per line. */
export const parseAgenda = (text: string | null | undefined) => (text ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

export interface NewMeetingInput {
  title: string;
  type: MeetingType;
  series: MeetingSeries;
  /** ISO date. */
  date: string;
  time: string;
  location: string;
  invitees: string[];
  agenda: string[];
}

const MEETING_TYPES: readonly MeetingType[] = ['internal', 'external'];
export const MEETING_SERIES: readonly MeetingSeries[] = ['weekly_site', 'steering_committee', 'engineering_coordination', 'supplier_review', 'kick_off', 'one_off'];
export const MAX = { title: 200, location: 120, name: 80, invitees: 40, points: 30, point: 200, note: 1000, due: 40 } as const;

/**
 * "New meeting" form values (AF `meetings`: title*, type, series, date*, time, loc, invited*, agenda) → input of
 * `createMeeting`. Errors are English source strings. Blank time → 09:00, blank location → Teams (prototype defaults).
 */
export function parseNewMeeting(v: Record<string, string | undefined>): Parsed<NewMeetingInput> {
  const title = (v.title ?? '').trim().replace(/\s+/g, ' ');
  if (!title) return { ok: false, error: 'Title is required' };
  if (title.length > MAX.title) return { ok: false, error: 'The title is too long' };
  const type = (v.type || 'internal') as MeetingType;
  if (!MEETING_TYPES.includes(type)) return { ok: false, error: 'Invalid meeting type' };
  const series = (v.series || 'weekly_site') as MeetingSeries;
  if (!MEETING_SERIES.includes(series)) return { ok: false, error: 'Invalid series' };
  const date = parseMeetingDate(v.date);
  if (!date) return { ok: false, error: 'Enter a valid date (e.g. 6 Oct 2026)' };
  const time = (v.time ?? '').trim() ? parseMeetingTime(v.time) : '09:00';
  if (!time) return { ok: false, error: 'Enter a valid time (e.g. 09:00)' };
  const location = (v.loc ?? '').trim().replace(/\s+/g, ' ') || 'Teams';
  if (location.length > MAX.location) return { ok: false, error: 'The location is too long' };
  const invitees = parseInvitees(v.invited);
  if (!invitees.length) return { ok: false, error: 'Invite at least one person' };
  if (invitees.length > MAX.invitees || invitees.some((n) => n.length > MAX.name)) return { ok: false, error: 'Too many invitees' };
  const agenda = parseAgenda(v.agenda);
  if (agenda.length > MAX.points || agenda.some((p) => p.length > MAX.point)) return { ok: false, error: 'The agenda is too long' };
  return { ok: true, value: { title, type, series, date, time, location, invitees, agenda } };
}

export interface MinutesLineInput {
  type: MeetingLineType;
  text: string;
  /** Actions only; blank → the organizer (set by the writer). */
  owner: string | null;
  /** Actions only; blank → "—". A recognisable date is stored in the English short form ("2 Oct", "5 Jan 2027"). */
  due: string | null;
  /** Actions only (S-12 a, R-067): the plan activity code the action serves; resolved in the meeting's project by the writer. */
  activity?: string | null;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Due as typed → "2 Oct" (2026) / "5 Jan 2027" when it is a date, else the typed text ("next week", "—"). */
export function normaliseDue(text: string | null | undefined): string | null {
  const s = (text ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const iso = parseMeetingDate(s);
  if (!iso) return s;
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MON[m - 1]}${y === 2026 ? '' : ` ${y}`}`;
}

/** Composer "+ Add" (addLine 4848): type, non-blank text; owner and due kept for actions only. */
export function parseMinutesLine(v: { type?: unknown; text?: unknown; owner?: unknown; due?: unknown; activity?: unknown }): Parsed<MinutesLineInput> {
  const type = v.type as MeetingLineType;
  if (!LINE_TYPES.includes(type)) return { ok: false, error: 'Invalid note type' };
  const text = typeof v.text === 'string' ? v.text.trim().replace(/\s+/g, ' ') : '';
  if (!text) return { ok: false, error: 'Write a note first' };
  if (text.length > MAX.note) return { ok: false, error: 'The note is too long' };
  if (type !== 'action') return { ok: true, value: { type, text, owner: null, due: null } };
  const owner = typeof v.owner === 'string' ? v.owner.trim().replace(/\s+/g, ' ') : '';
  const due = typeof v.due === 'string' ? normaliseDue(v.due) : null;
  if (owner.length > MAX.name || (due?.length ?? 0) > MAX.due) return { ok: false, error: 'The note is too long' };
  // S-12 a (R-067): an optional plan activity, by its code (checked against the project's plan by the Server Function and the writer).
  const activity = typeof v.activity === 'string' ? v.activity.trim() : '';
  if (activity && !ACTIVITY_CODE_RE.test(activity)) return { ok: false, error: 'Unknown activity' };
  return { ok: true, value: { type, text, owner: owner || null, due, ...(activity ? { activity } : {}) } };
}

/** Shape of a plan activity code ("A1250", imported codes "ACT-1020"…). */
const ACTIVITY_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

// ── Follow-up tasks of the minutes (S-12 a, R-067) ─────────────────────────────────────────────────────────────────

/** Labels of a follow-up task (an action owned by someone outside the company). */
export const FOLLOW_UP_LABEL = 'Follow-up';
/** Longest task title (the Plan's to-do composer limit). */
export const TASK_TITLE_MAX = 200;

/** A project stakeholder as the follow-up rule reads it (register order). */
export interface FollowUpStakeholder {
  personId: string | null;
  name: string;
  /** Relationship owner (internal person) — gets the follow-up. */
  ownerPersonId: string | null;
  position: number;
}

export interface FollowUpInput {
  /** The action owner as typed ("K. Lindqvist (Nordvolt)", "N. Bensaïd"). */
  ownerName: string;
  /** The person behind it when known, and whether they are internal (no client organisation, not an external user). */
  owner: { personId: string; internal: boolean } | null;
  stakeholders: readonly FollowUpStakeholder[];
  /** The project's PM of record. */
  pmPersonId: string | null;
}

export type FollowUpTarget = { personId: string; followUp: boolean } | null;

/** "K. Lindqvist (Nordvolt)" → "K. Lindqvist": the trailing organisation in parentheses is not part of the name. */
export const ownerBaseName = (owner: string) => owner.replace(/\s*\([^()]*\)\s*$/, '').trim();

/** "Karin Lindqvist" → "K. Lindqvist" (the short form people are cited by). */
const shortFormOf = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  return rest.length ? `${first[0]}. ${rest.join(' ')}` : name.trim();
};

/**
 * Who gets the task of an action when the minutes are sent (S-12 a: "Keystone crée une tâche pour chaque responsable interne";
 * an external owner's action is followed up internally):
 * - an internal person gets the task themself (`followUp` false);
 * - any other owner is external: the project's stakeholder matching them — by person, else by exact full name or short form
 *   once a trailing "(Org)" is stripped, first in register order — and its relationship owner gets a follow-up task;
 * - the project's PM when no stakeholder matches or the one matched has no relationship owner;
 * - nobody (no task) without a PM.
 */
export function followUpTarget({ ownerName, owner, stakeholders, pmPersonId }: FollowUpInput): FollowUpTarget {
  if (owner?.internal) return { personId: owner.personId, followUp: false };
  const ordered = [...stakeholders].sort((a, b) => a.position - b.position);
  const base = ownerBaseName(ownerName);
  const byPerson = owner ? ordered.find((s) => s.personId === owner.personId) : undefined;
  const byName = base ? ordered.find((s) => s.name.trim() === base || shortFormOf(s.name) === base) : undefined;
  const match = byPerson ?? byName;
  const to = match?.ownerPersonId ?? pmPersonId;
  return to ? { personId: to, followUp: true } : null;
}

/** Follow-up task title: the action + " — " + the owner as typed, at most TASK_TITLE_MAX characters. */
export function followUpTitle(action: string, ownerName: string): string {
  const title = `${action} — ${ownerName}`;
  return title.length <= TASK_TITLE_MAX ? title : title.slice(0, TASK_TITLE_MAX - 1).trimEnd() + '…';
}

/**
 * Dates of a minutes task (S-12 a "reprend l'échéance saisie"): due = the typed due date, else `defaultDue` (today + 3 working
 * days); start = today, or the due date when the typed due is earlier — kept as typed even when past (unlike the Plan's to-dos,
 * which clamp the due to the status date).
 */
export function minutesTaskDates(typedDue: string | null, today: string, defaultDue: string): { start: string; due: string } {
  const due = typedDue ?? defaultDue;
  return { start: due < today ? due : today, due };
}

/** Due shown as a date ("2 Oct" → translated months) when it parses like the DAL does, else free text. */
export const isDateDue = (due: string | null | undefined) => !!due && due !== '—' && !!isoOfDisplayDate(due);

// ── Transcripts (chapter 4, S-10) ──────────────────────────────────────────────────────────────────────────────────

/** Transcript import limits (questionnaire S-10). A Server Function request is capped at 1 MB (Next.js default). */
export const TRANSCRIPT_IMPORT = {
  /** Largest stored transcript, in characters after parsing (≈ 60 000 words — several hours of meeting). */
  maxChars: 400_000,
  /** Largest file or paste sent to the server, in bytes (a paste counts in UTF-8: accents take 2 bytes, ’ « » 3). */
  maxUploadBytes: 800_000,
} as const;

/**
 * A pasted transcript too large to send: its UTF-8 size is above `maxUploadBytes`, so the Server Function request stays under
 * Next's 1 MB body limit and the user reads "The transcript is too long" instead of a generic save error.
 */
export function pasteTooLong(text: string): boolean {
  if (text.length > TRANSCRIPT_IMPORT.maxUploadBytes) return true;
  return new TextEncoder().encode(text).length > TRANSCRIPT_IMPORT.maxUploadBytes;
}

/** Review order of the proposals: decisions, actions, risks, client questions — each in analysis order. */
export const PROPOSAL_ORDER = ['decision', 'action', 'risk', 'question'] as const;
export type ProposalKind = (typeof PROPOSAL_ORDER)[number];

export function reviewOrder<P extends { type: ProposalKind; position: number }>(items: readonly P[]): P[] {
  return [...items].sort((a, b) => PROPOSAL_ORDER.indexOf(a.type) - PROPOSAL_ORDER.indexOf(b.type) || a.position - b.position);
}

export interface ProposalEditInput {
  text: string;
  owner: string | null;
  due: string | null;
}

/** "Edit proposal" form values (text*, owner, due) → the DAL edit; owner / due are ignored by the DAL where they do not apply. */
export function parseProposalEdit(v: Record<string, string | undefined>): Parsed<ProposalEditInput> {
  const text = (v.text ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return { ok: false, error: 'Write a note first' };
  if (text.length > MAX.note) return { ok: false, error: 'The note is too long' };
  const owner = (v.owner ?? '').trim().replace(/\s+/g, ' ');
  const due = (v.due ?? '').trim().replace(/\s+/g, ' ');
  if (owner.length > MAX.name || due.length > MAX.due) return { ok: false, error: 'The note is too long' };
  return { ok: true, value: { text, owner: owner || null, due: due || null } };
}

export interface ClientQuestionInput {
  text: string;
  askedBy: string;
  department: string | null;
  owner: string;
}

/** "Add to client questions" form values (text*, askedBy*, department, owner*). */
export function parseClientQuestion(v: Record<string, string | undefined>): Parsed<ClientQuestionInput> {
  const get = (k: string) => (v[k] ?? '').trim().replace(/\s+/g, ' ');
  const [text, askedBy, department, owner] = [get('text'), get('askedBy'), get('department'), get('owner')];
  if (!text || !askedBy || !owner) return { ok: false, error: 'Fill in the required fields' };
  if (text.length > MAX.note || askedBy.length > MAX.name || owner.length > MAX.name || department.length > MAX.name) return { ok: false, error: 'The note is too long' };
  return { ok: true, value: { text, askedBy, department: department || null, owner } };
}
