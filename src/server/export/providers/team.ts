// Export providers — Team & exchanges: Meetings & minutes, Stakeholders & RACI, Interface register.
// Meetings: the register with its chip (`?filter=`), the decision and action registers (`?view=` puts the current one
// first) and the client question bridge; PDF = the minutes of the selected meeting (`?meeting=`, else the screen's default).
// A client exports what their screen shows (P-10b, R-043): external meetings only, no question bridge.
// Stakeholders: the register and the RACI matrix. Interfaces: the register with the effective (late) status.
import { MEETING_FILTER_LABEL, matchesFilter, parseMeetingFilter, parseMeetingsView, selectMeeting } from '@/domain/meetings';
import { getMeetingsScreen } from '@/server/dal/meetings-screen';
import type { MeetingRow } from '@/server/dal/meetings';
import { getInterfacesScreen, getStakeholdersScreen } from '@/server/dal/team';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportSheet, ExportWorkbook, PdfBlock, PdfDocument } from '../types';
import { col, compact, isoOf, param, projectRef, sheet } from './common';

// ── Meetings ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const LINE_LABEL: Record<string, string> = { info: 'Info', decision: 'Decision', action: 'Action' };

function lineSheets(ctx: ExportContext, ms: MeetingRow[]): { decisions: ExportSheet; actions: ExportSheet } {
  const { t } = ctx;
  const lines = ms.flatMap((m) => m.agenda.flatMap((p) => p.lines.map((l) => ({ m, p, l }))));
  return {
    decisions: sheet(t('Decisions'), [col('meeting', t('Meeting'), 'text', 10), col('date', t('Date'), 'date'), col('point', t('Agenda point'), 'text', 30), col('text', t('Decision'), 'text', 70)],
      lines.filter((x) => x.l.type === 'decision').map(({ m, p, l }) => ({ meeting: m.number, date: m.startsOn, point: t(p.title), text: t(l.text) }))),
    actions: sheet(t('Actions'), [
      col('meeting', t('Meeting'), 'text', 10), col('date', t('Date'), 'date'), col('text', t('Action'), 'text', 60), col('owner', t('Owner'), 'text', 18), col('due', t('Due'), 'date'),
      col('done', t('Done'), 'boolean'), col('overdue', t('Overdue'), 'boolean'), col('task', t('Task'), 'text', 9),
    ], lines.filter((x) => x.l.type === 'action').map(({ m, l }) => ({
      meeting: m.number, date: m.startsOn, text: t(l.text), owner: l.ownerFull ?? l.owner ?? '', due: l.dueDate ?? isoOf(l.due), done: l.done, overdue: l.overdue, task: l.taskNumber ?? '',
    }))),
  };
}

async function meetingsWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const { t } = ctx;
  const client = ctx.viewer.role === 'client';
  const data = await getMeetingsScreen(ctx.project.code, { client });
  const view = parseMeetingsView(param(ctx, 'view'));
  const filter = parseMeetingFilter(param(ctx, 'filter'));
  const shown = data.meetings.filter((m) => matchesFilter(m, filter));
  const register = sheet(t('Meetings'), [
    col('number', t('Meeting'), 'text', 10), col('date', t('Date'), 'date'), col('time', t('Time'), 'text', 7), col('duration', t('Duration (min)'), 'integer'),
    col('title', t('Title'), 'text', 40), col('series', t('Series'), 'text', 16), col('type', t('Type'), 'text', 14), col('location', t('Location'), 'text', 20),
    col('organizer', t('Organizer'), 'text', 16), col('status', t('Status'), 'text', 18), col('minutes', t('Minutes'), 'text', 14), col('sent', t('Minutes sent'), 'date'),
    col('participants', t('Participants'), 'integer'), col('actions', t('Actions'), 'integer'),
  ], shown.map((m) => ({
    number: m.number, date: m.startsOn, time: m.time, duration: m.durationMin, title: t(m.title), series: t(m.seriesLabel), type: t(m.typeLabel), location: t(m.location),
    organizer: m.organizer, status: t(m.statusLabel), minutes: m.minutesNumber ?? '', sent: m.minutesSentOn, participants: m.participants.length, actions: m.actionCount,
  })));
  const { decisions, actions } = lineSheets(ctx, data.meetings);
  const questions = sheet(t('Client questions'), [
    col('text', t('Question'), 'text', 60), col('askedBy', t('Asked by'), 'text', 18), col('department', t('Department'), 'text', 18), col('owner', t('Owner'), 'text', 16),
    col('state', t('Status'), 'text', 10), col('answer', t('Answer'), 'text', 60),
  ], data.questions.map((q) => ({ text: t(q.text), askedBy: q.askedBy, department: t(q.department), owner: q.owner, state: t(q.state === 'open' ? 'Open' : 'Answered'), answer: q.answer ? t(q.answer) : '' })));
  const order = view === 'decisions' ? [decisions, register, actions] : view === 'actions' ? [actions, register, decisions] : [register, decisions, actions];
  return {
    title: t('Meetings & minutes'),
    filters: compact([filter !== 'all' ? `${t('Filter')}: ${t(MEETING_FILTER_LABEL[filter])}` : null]),
    sheets: client ? order : [...order, questions],
  };
}

/** Minutes of one meeting (PDF): header fields, attendance, agenda points with their info / decision / action lines. */
async function minutesDocument(ctx: ExportContext): Promise<PdfDocument | null> {
  if (!ctx.project) return null;
  const { t } = ctx;
  const data = await getMeetingsScreen(ctx.project.code, { client: ctx.viewer.role === 'client' });
  const m = selectMeeting(data.meetings, param(ctx, 'meeting') ?? param(ctx, 'id'));
  if (!m) return null;
  const blocks: PdfBlock[] = [
    { kind: 'fields', columns: 3, items: [
      [t('Date'), `${t(m.dateText)} · ${m.time}`], [t('Duration'), t(m.durationText)], [t('Location'), t(m.location)], [t('Organizer'), m.organizer],
      [t('Type'), t(m.typeLabel)], [t('Status'), t(m.statusLabel)],
    ] },
    { kind: 'heading', text: t('Participants') },
    { kind: 'table', sheet: sheet(t('Participants'), [col('name', t('Name'), 'text', 30), col('present', t('Present'), 'boolean', 10), col('read', t('Minutes read on'), 'date', 14)],
      m.participants.map((p) => ({ name: p.name, present: p.present, read: p.readOn }))) },
  ];
  for (const p of m.agenda) {
    blocks.push({ kind: 'heading', text: `${p.position + 1}. ${t(p.title)}` });
    if (!p.lines.length) blocks.push({ kind: 'paragraph', text: t('No note recorded'), muted: true });
    else blocks.push({ kind: 'table', sheet: sheet(t('Lines'), [col('type', t('Type'), 'text', 10), col('text', t('Note'), 'text', 60), col('owner', t('Owner'), 'text', 16), col('due', t('Due'), 'date', 12)],
      p.lines.map((l) => ({ type: t(LINE_LABEL[l.type] ?? l.type), text: t(l.text), owner: l.ownerFull ?? l.owner ?? '', due: l.dueDate ?? isoOf(l.due) }))) });
  }
  return {
    title: `${t('Minutes')} · ${t(m.title)}`,
    subtitle: `${m.number}${m.minutesNumber ? ` · ${m.minutesNumber}` : ''}`,
    project: projectRef(ctx),
    reference: m.minutesNumber ?? m.number,
    date: m.startsOn,
    blocks,
    footnote: t('Minutes produced by Keystone from the meeting notes; the signed record is filed in Codex.'),
  };
}

// ── Stakeholders & RACI ──────────────────────────────────────────────────────────────────────────────────────────────
async function stakeholdersWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const data = await getStakeholdersScreen(ctx.project.code);
  if (!data) return null;
  const { t } = ctx;
  const { stakeholders, raci } = data.register;
  const sheets = [
    sheet(t('Stakeholders'), [
      col('name', t('Name'), 'text', 22), col('organisation', t('Organisation'), 'text', 22), col('role', t('Role'), 'text', 24), col('type', t('Type'), 'text', 14),
      col('owner', t('Relationship owner'), 'text', 16), col('last', t('Last contact'), 'date'), col('stale', t('No contact > 30 days'), 'boolean'), col('influence', t('Influence'), 'integer'),
      col('interest', t('Interest'), 'integer'), col('attitude', t('Attitude'), 'text', 12), col('email', t('E-mail'), 'text', 26), col('notes', t('Notes'), 'text', 40),
    ], stakeholders.map((s) => ({
      name: s.name, organisation: t(s.organisation), role: t(s.role), type: t(s.typeLabel), owner: s.owner, last: s.lastContactOn, stale: s.stale, influence: s.influence,
      interest: s.interest, attitude: t(s.attitude), email: s.contactEmail ?? '', notes: t(s.notes),
    }))),
  ];
  if (raci) {
    sheets.push(sheet('RACI', [col('label', t('Deliverable / decision'), 'text', 36), ...raci.columns.map((c, i) => col(`c${i}`, t(c), 'text', 12, { align: 'center' }))],
      raci.rows.map((r) => ({ label: t(r.label), ...Object.fromEntries(r.cells.map((c, i) => [`c${i}`, c ?? ''])) }))));
  }
  return { title: t('Stakeholders & RACI'), sheets };
}

// ── Interfaces ───────────────────────────────────────────────────────────────────────────────────────────────────────
async function interfacesWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const data = await getInterfacesScreen(ctx.project.code);
  if (!data) return null;
  const { t } = ctx;
  const blocking = new Set(data.blockers.map((b) => b.number));
  return {
    title: t('Interface register'),
    sheets: [
      sheet(t('Interfaces'), [
        col('number', t('Interface'), 'text', 8), col('title', t('Title'), 'text', 36), col('side', t('Keystone side'), 'text', 14), col('party', t('Other party'), 'text', 22),
        col('data', t('Data expected'), 'text', 36), col('needed', t('Needed by'), 'date'), col('days', t('Days to need'), 'integer'), col('provided', t('Provided on'), 'date'),
        col('status', t('Status'), 'text', 12), col('owner', t('Owner'), 'text', 14), col('blocking', t('Blocking commissioning'), 'boolean'),
      ], data.interfaces.map((i) => ({
        number: i.number, title: t(i.title), side: t(i.keystoneSideLabel), party: t(i.otherParty), data: t(i.dataExpected), needed: i.neededBy, days: i.daysToNeed,
        provided: i.providedOn, status: t(i.statusLabel), owner: i.owner, blocking: blocking.has(i.number),
      }))),
    ],
  };
}

registerExportProvider({ screen: 'meetings', table: meetingsWorkbook, pdf: minutesDocument, documents: { minutes: minutesDocument } });
registerExportProvider({ screen: 'stakeholders', table: stakeholdersWorkbook });
registerExportProvider({ screen: 'interfaces', table: interfacesWorkbook });
