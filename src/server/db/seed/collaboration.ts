// Collaboration seed: meetings (MEETINGS 3703) with participants, agenda, minutes lines (MTG_DONE 3710 ticks),
// transcripts (MTG_TRANSCRIPTS 3711) and their pre-baked analysis (logic 4840), the client question bridge
// (MTG_EXCHANGE 3712), stakeholders (STAKEHOLDERS 3714) and the RACI matrix (RACI 3715). See schema/collaboration.ts.
import { PROTO } from '@/server/prototype';
import { isoOfDisplayDate, meetingLineType, meetingSeries, meetingStatus, meetingType, parisInstant, stakeholderType, type MeetingLineType, type RaciCode } from '../codes';
import {
  clientQuestions, meetingAgendaPoints, meetingLines, meetingParticipants, meetingTranscriptProposals, meetingTranscripts, meetings, raciCells,
  raciColumns, raciMatrices, raciRows, stakeholders,
} from '../schema';
import type { Tx } from '../types';
import { must, newId, personIdOrNull, type SeedCtx } from './context';

export interface ProtoMeeting {
  id: string; title: string; series: string; type: string; proj: string; date: string; time: string; dur: string; loc: string; organizer: string;
  invited: string[]; present: string[]; status: string; doc: string; sent?: string; read?: Record<string, string>;
  agenda: { pt: string; lines: [string, string, string?, string?][] }[];
}
interface Analysis { summary: string; decisions: string[]; actions: [string, string, string][] }

/**
 * Transcript analysis results (logic 4840): MTG-119 and MTG-121 have their own; any other meeting with a transcript
 * gets the Nordvolt FAT result (here MTG-120). Simulated analysis — OPEN QUESTION S-10.
 */
export const TRANSCRIPT_ANALYSES: Readonly<Record<string, Analysis>> = {
  'MTG-119': {
    summary: 'P&ID rev D frozen as the reference for the I/O list by Friday. C-04 closed as a drawing error; C-05 stays open pending the supplier status-word mapping. HV cell energisation needed by 20 Nov — answer carried to the client steering committee.',
    decisions: [
      'Freeze the I/O list on P&ID rev D by Friday',
      'Close C-04 (drawing error); keep C-05 open until the supplier confirms the status word mapping',
      'Answer to client: HV cell energised by 20 Nov at the latest',
    ],
    actions: [
      ['Update electrical schematics for TT-104, PT-108, ZS-112', 'S. Haddad', '6 Oct'],
      ['Send corrected P&ID sheet for C-04', 'P. Noguès', '3 Oct'],
      ['Carry the HV cell date to the steering committee', 'A. Girard', '9 Oct'],
    ],
  },
  'MTG-121': {
    summary: 'CRAC replacement in two phases to keep N+1. P&ID rev C due 10 Oct; loop B isolation (~6 h) to be confirmed with client operations; phase 2 cut-over targeted 2 Nov before the client freeze.',
    decisions: ['Phase 2 cut-over targeted on 2 Nov, before the client freeze'],
    actions: [
      ['Issue P&ID rev C for the cooling loop', 'P. Noguès', '10 Oct'],
      ['Confirm the loop B isolation window with client operations', 'D. Roux', '8 Oct'],
      ['Prepare the isolation method statement', 'D. Roux', '17 Oct'],
    ],
  },
};
const DEFAULT_ANALYSIS: Analysis = {
  summary: 'FAT lot 2 confirmed on 24 Oct in Västerås with Keystone witness. Status word mapping rev B due 10 Oct; crate drawings per sea-freight spec due 15 Oct.',
  decisions: ['FAT lot 2 confirmed on 24 Oct, Keystone witness'],
  actions: [
    ['Issue status word mapping rev B', 'K. Lindqvist', '10 Oct'],
    ['Send crate drawings per sea-freight spec', 'K. Lindqvist', '15 Oct'],
  ],
};
export const analysisOf = (meetingNumber: string) => TRANSCRIPT_ANALYSES[meetingNumber] ?? DEFAULT_ANALYSIS;

/** "45 min" → 45, "1 h" → 60, "1 h 30" → 90. */
export function durationMinOf(text: string): number {
  const m = /^(?:(\d+)\s*h)?\s*(\d+)?\s*(?:min)?$/.exec(text.trim());
  if (!m || (!m[1] && !m[2])) throw new Error(`Seed: unparseable duration "${text}"`);
  return parseInt(m[1] ?? '0', 10) * 60 + parseInt(m[2] ?? '0', 10);
}
/** Due typed on a minutes line ("2 Oct", "—") → ISO (2026 assumed, as `mIdx(due + ' 2026')`). */
export const dueDateOf = (due: string | null | undefined) => (due && due !== '—' ? isoOfDisplayDate(due) : null);

export async function seedCollaboration(tx: Tx, ctx: SeedCtx): Promise<void> {
  const list = PROTO.MEETINGS as ProtoMeeting[];
  const done = PROTO.MTG_DONE as Record<string, boolean>;
  const transcripts = PROTO.MTG_TRANSCRIPTS as Record<string, string>;
  for (const [i, m] of list.entries()) {
    const id = newId();
    const startsOn = isoOfDisplayDate(m.date)!;
    await tx.insert(meetings).values({
      id, projectId: must(ctx.projectByCode, m.proj, 'project'), number: m.id, title: m.title, series: meetingSeries.code(m.series), type: meetingType.code(m.type),
      startsOn, startTime: m.time, startsAt: parisInstant(startsOn, m.time), durationMin: durationMinOf(m.dur), location: m.loc,
      organizerPersonId: personIdOrNull(ctx, m.organizer), organizerName: m.organizer, status: meetingStatus.code(m.status), minutesNumber: m.doc || null,
      minutesDocumentId: (m.doc && ctx.document.get(m.doc)) || null, minutesSentOn: m.sent ? isoOfDisplayDate(m.sent) : null, sortOrder: i + 1,
    });
    await tx.insert(meetingParticipants).values(
      m.invited.map((name, position) => ({
        id: newId(), meetingId: id, position, personId: personIdOrNull(ctx, name), name, present: m.present.includes(name),
        minutesRecipient: !!m.read && name in m.read, minutesReadOn: m.read?.[name] ? isoOfDisplayDate(m.read[name]) : null,
      })),
    );
    for (const [pi, a] of m.agenda.entries()) {
      const pointId = newId();
      await tx.insert(meetingAgendaPoints).values({ id: pointId, meetingId: id, position: pi, title: a.pt });
      if (!a.lines.length) continue;
      await tx.insert(meetingLines).values(
        a.lines.map(([type, text, owner, due], position) => {
          const t = meetingLineType.code(type) as MeetingLineType;
          const isAction = t === 'action';
          return {
            id: newId(), agendaPointId: pointId, position, type: t, text, ownerName: isAction ? owner || null : null,
            ownerPersonId: isAction ? personIdOrNull(ctx, owner) : null, dueText: isAction ? due || null : null, dueDate: isAction ? dueDateOf(due) : null,
            done: !!done[`${m.id}|${pi}|${position}`], origin: 'seed' as const,
          };
        }),
      );
    }
    if (transcripts[m.id]) {
      const an = analysisOf(m.id);
      await tx.insert(meetingTranscripts).values({ meetingId: id, rawText: transcripts[m.id], source: 'teams', summary: an.summary });
      await tx.insert(meetingTranscriptProposals).values([
        ...an.decisions.map((text, position) => ({ meetingId: id, position, type: 'decision' as const, text })),
        ...an.actions.map(([text, owner, due], k) => ({
          meetingId: id, position: an.decisions.length + k, type: 'action' as const, text, ownerName: owner, ownerPersonId: personIdOrNull(ctx, owner),
          dueText: due, dueDate: dueDateOf(due),
        })),
      ]);
    }
  }

  const exchange = PROTO.MTG_EXCHANGE as Record<string, { text: string; who: string; dept: string; owner: string; state: 'open' | 'answered'; answer?: string }[]>;
  await tx.insert(clientQuestions).values(
    Object.entries(exchange).flatMap(([code, qs]) =>
      qs.map((q, position) => ({
        id: newId(), projectId: must(ctx.projectByCode, code, 'project'), position, text: q.text, askedByName: q.who, askedByPersonId: personIdOrNull(ctx, q.who),
        department: q.dept, ownerName: q.owner, ownerPersonId: personIdOrNull(ctx, q.owner), state: q.state, answer: q.answer ?? null,
      })),
    ),
  );

  type Stk = [string, string, string, string, number, number, string, string, string, string, string];
  await tx.insert(stakeholders).values(
    Object.entries(PROTO.STAKEHOLDERS as Record<string, Stk[]>).flatMap(([code, rows]) =>
      rows.map(([name, organisation, role, type, influence, interest, attitude, contact, owner, last, notes], position) => ({
        id: newId(), projectId: must(ctx.projectByCode, code, 'project'), name, organisation, role, type: stakeholderType.code(type), influence, interest, attitude,
        contactEmail: contact || null, ownerPersonId: personIdOrNull(ctx, owner), ownerName: owner, lastContactOn: isoOfDisplayDate(last)!, notes,
        personId: ctx.personByFull.get(name) ?? null, position,
      })),
    ),
  );

  for (const [code, raci] of Object.entries(PROTO.RACI as Record<string, { roles: string[]; rows: string[][] }>)) {
    const matrixId = newId();
    await tx.insert(raciMatrices).values({ id: matrixId, projectId: must(ctx.projectByCode, code, 'project') });
    await tx.insert(raciColumns).values(raci.roles.map((label, position) => ({ matrixId, position, label })));
    const rows = raci.rows.map(([label], position) => ({ id: newId(), matrixId, position, label }));
    await tx.insert(raciRows).values(rows);
    const cells = raci.rows.flatMap(([, ...codes], i) => codes.flatMap((c, columnPosition) => (c ? [{ rowId: rows[i].id, columnPosition, code: c as RaciCode }] : [])));
    if (cells.length) await tx.insert(raciCells).values(cells);
  }
}
