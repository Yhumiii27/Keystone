'use server';
// Client communication log Server Functions (chapter 4; Site › "Client communication log", Keystone-owned): load the
// project's log when the drawer opens, log an exchange, tick / reopen a follow-up. Rules in src/domain/client-comms.ts:
// read = whoever can open the project's Site except a client contact; write = whoever may edit the project's Site (inside
// the workspace, project not read-only). Each write validates its raw input, writes through the client-comms DAL with the
// viewer as the actor (audit + activity feed) and revalidates. Messages come back translated.
import { revalidatePath } from 'next/cache';
import {
  CLIENT_COMM_CHANNELS, CLIENT_COMM_DIRECTIONS, canReadClientLog, canWriteClientLog, clientLogCounts, followUpState, parseClientCommForm,
} from '@/domain/client-comms';
import { STATUS_ISO, clientCommChannel, clientCommDirection, displayOfIso, inWorkspace, shortDateOfIso } from '@/server/db/codes';
import { addClientCommunication, listClientCommunications, setClientCommunicationFollowUpDone } from '@/server/dal/client-comms';
import { getPersonByName } from '@/server/dal/people';
import { getProject } from '@/server/dal/projects';
import { teamOwnerOptions } from '@/server/dal/team';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { clientLogCountsText } from './comm-log-model';
import { messageText } from './i18n';

export interface ClientLogRow {
  number: string;
  /** Translated texts. */
  date: string;
  channel: string;
  direction: string;
  inbound: boolean;
  contact: string;
  subject: string;
  summary: string;
  followUp: { owner: string; due: string; state: 'open' | 'overdue' | 'done' } | null;
  by: string;
}

export interface ClientLogData {
  canWrite: boolean;
  rows: ClientLogRow[];
  /** "3 exchanges · 1 follow-up open" (translated). */
  counts: string;
  /** Form options (translated labels) and defaults. */
  channels: { value: string; label: string }[];
  directions: { value: string; label: string }[];
  team: string[];
  today: string;
}

export type ClientLogResult<T> = ({ ok: true } & T) | { ok: false; error: string };

const INVALID = 'Invalid request';
const NOT_READABLE = 'The client communication log is not available to you';
const READ_ONLY = 'The client communication log is read-only for you';
const FAILED = 'The change could not be saved';
const NUMBER_RE = /^COM-\d{3,6}$/;

async function tr(english: string) {
  const { t, lang } = await getI18n();
  return messageText(english, t, lang);
}
const fail = async (english: string): Promise<{ ok: false; error: string }> => ({ ok: false, error: await tr(english) });

/** Follow-up owners offered: the project manager, then the project team (full names, once each) — src/domain/client-comms.ts. */
async function followUpOwners(code: string): Promise<string[]> {
  const [project, team] = await Promise.all([getProject(code), teamOwnerOptions(code)]);
  const pm = project?.pm && project.pm !== '—' ? ((await getPersonByName(project.pm))?.name ?? project.pm) : null;
  return [...new Set([...(pm ? [pm] : []), ...team])];
}

/** Project, viewer and rights; null + message when the project is unknown or the viewer may not read the log. */
async function access(code: unknown): Promise<{ code: string; canWrite: boolean; actor: string } | { error: string }> {
  if (typeof code !== 'string' || !/^[A-Z]{3}-\d{3}$/.test(code)) return { error: INVALID };
  const project = await getProject(code);
  if (!project) return { error: 'Unknown project' };
  const ctx = await getProjectContext(project.code, 'site');
  if (!canReadClientLog(ctx.viewer.role)) return { error: NOT_READABLE };
  const canWrite = canWriteClientLog(ctx.viewer.role, ctx.canEdit('site') && inWorkspace('site', ctx.viewer.role));
  return { code: project.code, canWrite, actor: ctx.viewer.name };
}

/** The project's log (newest first), the viewer's rights and the form options. */
export async function loadClientLogAction(code: string): Promise<ClientLogResult<{ data: ClientLogData }>> {
  const a = await access(code);
  if ('error' in a) return fail(a.error);
  const [{ t, lang }, rows, team] = await Promise.all([getI18n(), listClientCommunications(a.code), followUpOwners(a.code)]);
  const counts = clientLogCountsText(clientLogCounts(rows), lang);
  return {
    ok: true,
    data: {
      canWrite: a.canWrite,
      counts,
      rows: rows.map((r) => {
        const state = followUpState(r, STATUS_ISO);
        return {
          number: r.number, date: t(displayOfIso(r.occurredOn)), channel: t(r.channelLabel), direction: t(r.directionLabel), inbound: r.direction === 'inbound',
          contact: r.contactName, subject: r.subject, summary: r.summary, by: r.createdByName,
          followUp: state === 'none' ? null : { owner: r.followUpOwner ?? '—', due: t(shortDateOfIso(r.followUpDueOn!)), state },
        };
      }),
      channels: CLIENT_COMM_CHANNELS.map((c) => ({ value: c, label: t(clientCommChannel.label(c)) })),
      directions: CLIENT_COMM_DIRECTIONS.map((d) => ({ value: d, label: t(clientCommDirection.label(d)) })),
      team: a.canWrite ? team : [],
      today: STATUS_ISO,
    },
  };
}

/** "Log the exchange": a new entry COM-nnn of the project. */
export async function addClientExchangeAction(code: string, values: Record<string, unknown>): Promise<ClientLogResult<{ number: string; toast: string }>> {
  const a = await access(code);
  if ('error' in a) return fail(a.error);
  if (!a.canWrite) return fail(READ_ONLY);
  const parsed = parseClientCommForm(values && typeof values === 'object' ? values : {}, await followUpOwners(a.code));
  if (!parsed.ok) return fail(parsed.error);
  let number: string;
  try {
    number = await addClientCommunication(a.code, parsed.value, a.actor);
  } catch (e) {
    console.error('addClientExchangeAction', e);
    return fail(FAILED);
  }
  revalidatePath(`/projects/${a.code}`, 'layout');
  return { ok: true, number, toast: `${number} · ${await tr('Exchange logged')}` };
}

/** Ticks (done) or reopens the follow-up of an exchange. */
export async function setClientFollowUpDoneAction(code: string, number: string, done: boolean): Promise<ClientLogResult<object>> {
  if (typeof number !== 'string' || !NUMBER_RE.test(number) || typeof done !== 'boolean') return fail(INVALID);
  const a = await access(code);
  if ('error' in a) return fail(a.error);
  if (!a.canWrite) return fail(READ_ONLY);
  const row = (await listClientCommunications(a.code)).find((r) => r.number === number);
  if (!row || !row.followUpDueOn) return fail('Unknown exchange');
  try {
    await setClientCommunicationFollowUpDone(a.code, number, done, a.actor);
  } catch (e) {
    console.error('setClientFollowUpDoneAction', e);
    return fail(FAILED);
  }
  revalidatePath(`/projects/${a.code}`, 'layout');
  return { ok: true };
}
