import 'server-only';
// Client communication log (chapter 4, Site › "Client communication log"; Keystone-owned): every exchange with the client
// and its follow-up. Numbered COM-001… per project. D-5: retired from the Site screen (no Server Function calls this any
// more — the Site button opens the client decisions of the project meetings); kept with its data until the owner confirms
// deleting them in a later migration.
import { and, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb } from '@/server/db/client';
import { clientCommChannel, clientCommDirection, nextBusinessNumber, type ClientCommChannel, type ClientCommDirection } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { clientCommunications, persons } from '@/server/db/schema';

export interface ClientCommRow {
  number: string;
  occurredOn: string;
  channel: ClientCommChannel;
  /** EN source label ("Phone"). */
  channelLabel: string;
  direction: ClientCommDirection;
  directionLabel: string;
  contactName: string;
  subject: string;
  summary: string;
  followUpOwner: string | null;
  followUpDueOn: string | null;
  followUpDone: boolean;
  createdByName: string;
  createdAt: Date;
}

/** Exchanges of a project, newest first (date, then number). */
export async function listClientCommunications(code: string): Promise<ClientCommRow[]> {
  const db = await getDb();
  const p = await requireProject(db, code);
  const owner = alias(persons, 'follow_owner');
  const rows = await db
    .select({ c: clientCommunications, ownerFull: owner.fullName })
    .from(clientCommunications)
    .leftJoin(owner, eq(owner.id, clientCommunications.followUpOwnerPersonId))
    .where(eq(clientCommunications.projectId, p.id))
    .orderBy(desc(clientCommunications.occurredOn), desc(clientCommunications.number));
  return rows.map(({ c, ownerFull }) => ({
    number: c.number, occurredOn: c.occurredOn, channel: c.channel, channelLabel: clientCommChannel.label(c.channel), direction: c.direction,
    directionLabel: clientCommDirection.label(c.direction), contactName: c.contactName, subject: c.subject, summary: c.summary,
    followUpOwner: ownerFull ?? c.followUpOwnerName, followUpDueOn: c.followUpDueOn, followUpDone: !!c.followUpDoneAt, createdByName: c.createdByName, createdAt: c.createdAt,
  }));
}

export interface NewClientCommunication {
  /** ISO date of the exchange. */
  occurredOn: string;
  channel: ClientCommChannel;
  direction?: ClientCommDirection;
  contactName: string;
  subject: string;
  summary?: string;
  /** Follow-up owner (person name) and due date, both optional. */
  followUpOwner?: string | null;
  followUpDueOn?: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Logs an exchange. Validates the channel, dates and required texts. Returns its number ("COM-004"). */
export async function addClientCommunication(code: string, input: NewClientCommunication, actorName: string): Promise<string> {
  if (!ISO.test(input.occurredOn)) throw new Error('Enter the date of the exchange');
  if (!clientCommChannel.isCode(input.channel)) throw new Error('Unknown channel');
  if (input.direction && !clientCommDirection.isCode(input.direction)) throw new Error('Unknown direction');
  const contact = input.contactName.trim();
  const subject = input.subject.trim();
  if (!contact) throw new Error('Enter the client contact');
  if (!subject) throw new Error('Enter a subject');
  if (input.followUpDueOn && !ISO.test(input.followUpDueOn)) throw new Error('Invalid follow-up date');
  if (input.followUpDueOn && input.followUpDueOn < input.occurredOn) throw new Error('The follow-up cannot be due before the exchange');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, code);
    const owner = input.followUpOwner?.trim() ? await findPerson(tx, input.followUpOwner.trim()) : null;
    const contactPerson = await findPerson(tx, contact);
    const existing = (await tx.select({ n: clientCommunications.number }).from(clientCommunications).where(eq(clientCommunications.projectId, p.id))).map((r) => r.n);
    const number = nextBusinessNumber(existing, 'COM-', 3);
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    await tx.insert(clientCommunications).values({
      projectId: p.id, number, occurredOn: input.occurredOn, channel: input.channel, direction: input.direction ?? 'outbound', contactName: contact,
      contactPersonId: contactPerson?.id ?? null, subject: subject.slice(0, 200), summary: (input.summary ?? '').trim().slice(0, 4000),
      followUpOwnerName: owner ? nameOf(owner) : input.followUpOwner?.trim() || null, followUpOwnerPersonId: owner?.id ?? null, followUpDueOn: input.followUpDueOn || null,
      createdByPersonId: actor?.id ?? null, createdByName: who,
    });
    await writeAudit(tx, { actorName: who, actorPersonId: actor?.id, objectRef: `${code} ${number}`, change: `client exchange logged: ${subject}`, area: 'Client', entityType: 'client_communication', projectId: p.id });
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: `Logged a client exchange · ${subject}`, kind: 'client', projectId: p.id });
    return number;
  });
}

/** Marks the follow-up of an exchange done (or open again). */
export async function setClientCommunicationFollowUpDone(code: string, number: string, done: boolean, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, code);
    const [c] = await tx.select().from(clientCommunications).where(and(eq(clientCommunications.projectId, p.id), eq(clientCommunications.number, number)));
    if (!c) throw new Error(`Unknown exchange ${number}`);
    if (!!c.followUpDoneAt === done) return;
    await tx.update(clientCommunications).set({ followUpDoneAt: done ? new Date() : null, updatedAt: new Date() }).where(eq(clientCommunications.id, c.id));
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: `${code} ${number}`, change: `follow-up ${done ? 'done' : 'reopened'}`, area: 'Client', entityType: 'client_communication', entityId: c.id, projectId: p.id });
  });
}

/** Open follow-ups of a project (KPIs / Home), oldest due first. */
export async function openClientFollowUps(code: string): Promise<ClientCommRow[]> {
  return (await listClientCommunications(code)).filter((c) => c.followUpDueOn && !c.followUpDone).sort((a, b) => (a.followUpDueOn! < b.followUpDueOn! ? -1 : 1));
}

