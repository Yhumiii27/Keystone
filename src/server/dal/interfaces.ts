import 'server-only';
// Interface register DAL (docs/spec/07 §2.5; 11 §3.7 Interface). Effective status = stored status, except an open
// interface needed before now is Late; days to the need date = round((mIdx(need) − now) × 30) (logic 4955), now = the
// business date's month index (the prototype's PG_NOW — R-013). Writers: register (IF-10… per project), "Mark received"
// (open or late → received, the provided date stamped with the received date the user confirmed — today by default, never
// after today; Q-4 a, R-116) and "Freeze" (received → frozen, the provided date kept).
import { and, asc, eq } from 'drizzle-orm';
import { monthNowOf, yearOfIso } from '@/domain/clock';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { daysToNeed, effectiveInterfaceStatus as effective } from '@/domain/team';
import {
  interfaceStatus, keystoneSide, nextBusinessNumber, shortDateYearOfIso, type InterfaceEffectiveStatus, type InterfaceStatus, type KeystoneSide,
} from '@/server/db/codes';
import { demoFloor, findPerson, nameOf, requireProject, writeAudit } from '@/server/db/helpers';
import { persons, projectInterfaces, projects } from '@/server/db/schema';
import type { Tx } from '@/server/db/types';

export interface InterfaceRow {
  /** "IF-02". */
  number: string;
  title: string;
  keystoneSide: KeystoneSide;
  /** "Electrical". */
  keystoneSideLabel: string;
  otherParty: string;
  dataExpected: string;
  neededBy: string;
  /** "15 Oct" ("14 Jan 2027" outside the business year — R-013: a typed need date may fall in another year). */
  neededText: string;
  /** Days from the prototype's now to the need date (negative = late). */
  daysToNeed: number;
  providedOn: string | null;
  /** "12 Sep" ("… 2027" outside the business year, R-013) or "—". */
  providedText: string;
  /** Stored status and the effective one (Late derived). */
  storedStatus: InterfaceStatus;
  status: InterfaceEffectiveStatus;
  /** EN source label ("Late"). */
  statusLabel: string;
  /** Short name ("S. Haddad"). */
  owner: string;
}

/** Interfaces of a project, register order (added ones last). */
export async function listInterfaces(projectCode: string): Promise<InterfaceRow[]> {
  const db = await getDb();
  const today = await businessToday();
  const now = monthNowOf(today);
  // R-013: the dates show their year outside the business year.
  const year = yearOfIso(today);
  const rows = await db
    .select({ i: projectInterfaces, ownerShort: persons.shortName })
    .from(projectInterfaces)
    .innerJoin(projects, eq(projects.id, projectInterfaces.projectId))
    .leftJoin(persons, eq(persons.id, projectInterfaces.ownerPersonId))
    .where(eq(projects.code, projectCode))
    .orderBy(asc(projectInterfaces.position));
  return rows.map(({ i, ownerShort }) => {
    const status = effective(i.status, i.neededBy, now);
    return {
      number: i.number, title: i.title, keystoneSide: i.keystoneSide, keystoneSideLabel: keystoneSide.label(i.keystoneSide), otherParty: i.otherParty,
      dataExpected: i.dataExpected, neededBy: i.neededBy, neededText: shortDateYearOfIso(i.neededBy, year), daysToNeed: daysToNeed(i.neededBy, now),
      providedOn: i.providedOn, providedText: i.providedOn ? shortDateYearOfIso(i.providedOn, year) : '—', storedStatus: i.status, status, statusLabel: interfaceStatus.label(status),
      owner: ownerShort ?? i.ownerName,
    };
  });
}

/** Late interfaces per project code (Interfaces nav badge, `ifcBadge`). */
export async function lateInterfacesByProject(): Promise<Record<string, number>> {
  const db = await getDb();
  const now = monthNowOf(await businessToday());
  const rows = await db
    .select({ code: projects.code, status: projectInterfaces.status, neededBy: projectInterfaces.neededBy })
    .from(projectInterfaces)
    .innerJoin(projects, eq(projects.id, projectInterfaces.projectId));
  const out: Record<string, number> = {};
  for (const r of rows) if (effective(r.status, r.neededBy, now) === 'late') out[r.code] = (out[r.code] ?? 0) + 1;
  return out;
}

export interface NewInterface {
  title: string;
  keystoneSide: KeystoneSide;
  otherParty: string;
  dataExpected: string;
  /** ISO need date. */
  neededBy: string;
  /** Owner (team member, full or short name). */
  owner: string;
}

/** "New interface" (AF.interfaces, "Register"): IF-10… per project, Open, nothing provided yet. Returns the number. */
export async function createInterface(projectCode: string, input: NewInterface, actorName: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const title = input.title.trim();
    const otherParty = input.otherParty.trim();
    const dataExpected = input.dataExpected.trim();
    if (!title || !otherParty || !dataExpected) throw new Error('Interface, other party and data expected are required');
    if (!keystoneSide.isCode(input.keystoneSide)) throw new Error('Invalid Keystone side');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.neededBy)) throw new Error('Invalid need date');
    const existing = await tx.select({ number: projectInterfaces.number, position: projectInterfaces.position }).from(projectInterfaces).where(eq(projectInterfaces.projectId, p.id));
    const number = nextBusinessNumber(existing.map((e) => e.number), 'IF-', 2, await demoFloor(tx, 9));
    const owner = await findPerson(tx, input.owner);
    const [row] = await tx
      .insert(projectInterfaces)
      .values({
        projectId: p.id, number, title, keystoneSide: input.keystoneSide, otherParty, dataExpected, neededBy: input.neededBy, providedOn: null, status: 'open',
        ownerPersonId: owner?.id ?? null, ownerName: owner?.shortName ?? input.owner.trim(), position: Math.max(-1, ...existing.map((e) => e.position)) + 1,
      })
      .returning({ id: projectInterfaces.id });
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number, change: `registered · ${title}`, area: 'Interfaces',
      entityType: 'interface', entityId: row.id, projectId: p.id,
    });
    return number;
  });
}

/**
 * `today`: the business date (the effective status named in the refusal and the audit). `receivedOn`: the received date stamped
 * as the provided date (Mark received only); the audit line names it.
 */
async function transition(tx: Tx, projectCode: string, number: string, from: InterfaceStatus, to: InterfaceStatus, actorName: string, today: string, receivedOn?: string) {
  const now = monthNowOf(today);
  const p = await requireProject(tx, projectCode);
  const [i] = await tx.select().from(projectInterfaces).where(and(eq(projectInterfaces.projectId, p.id), eq(projectInterfaces.number, number)));
  if (!i) throw new Error(`Unknown interface ${number} on ${projectCode}`);
  if (i.status !== from) throw new Error(`${number} is ${interfaceStatus.label(effective(i.status, i.neededBy, now))}`);
  await tx.update(projectInterfaces).set({ status: to, ...(receivedOn ? { providedOn: receivedOn } : {}), updatedAt: new Date() }).where(eq(projectInterfaces.id, i.id));
  const actor = await findPerson(tx, actorName);
  await writeAudit(tx, {
    actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number,
    change: `status: ${interfaceStatus.label(effective(i.status, i.neededBy, now))} → ${interfaceStatus.label(to)}${receivedOn ? ` · received ${shortDateYearOfIso(receivedOn, yearOfIso(today))}` : ''}`,
    area: 'Interfaces', entityType: 'interface', entityId: i.id, projectId: p.id,
  });
}

/**
 * "Mark received" (open or late), Q-4 a (R-116): the provided date is the received date the user confirmed — today (the
 * business date, R-013) by default, never after today. Rows received before delivery 8 keep no date ('—', no backfill).
 */
export async function markInterfaceReceived(projectCode: string, number: string, actorName: string, receivedOnDate?: string): Promise<void> {
  const today = await businessToday();
  const receivedOn = receivedOnDate ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) throw new Error('Invalid received date');
  if (receivedOn > today) throw new Error('The received date cannot be after today');
  const db = await getDb();
  await db.transaction((tx) => transition(tx, projectCode, number, 'open', 'received', actorName, today, receivedOn));
}

/** "Freeze" (received). */
export async function freezeInterface(projectCode: string, number: string, actorName: string): Promise<void> {
  const today = await businessToday();
  const db = await getDb();
  await db.transaction((tx) => transition(tx, projectCode, number, 'received', 'frozen', actorName, today));
}
