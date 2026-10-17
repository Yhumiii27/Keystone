import 'server-only';
// Stakeholders & RACI DAL (docs/spec/05 §6; 11 §3.4 Stakeholder / RaciMatrix). Register with relationship owner and
// last contact (stale when (now − mIdx(last)) × 30 > 30 days, logic 4932; now = the business date's month index, the
// prototype's PG_NOW — R-013), the project RACI matrix (dynamic columns), and "Add stakeholder" (AF.stakeholders: last
// contact = the business date, the prototype's NOWD; notes "New", owner normalised to the
// person's short name — the prototype stored the TEAM full name, S-13).
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { monthNowOf, yearOfIso } from '@/domain/clock';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { isStaleContact, stakeholderInitials } from '@/domain/team';
import { shortDateYearOfIso, stakeholderType, type RaciCode, type StakeholderType } from '@/server/db/codes';
import { findPerson, nameOf, requireProject, writeAudit } from '@/server/db/helpers';
import { persons, projects, raciCells, raciColumns, raciMatrices, raciRows, stakeholders } from '@/server/db/schema';

export interface StakeholderRow {
  name: string;
  organisation: string;
  role: string;
  type: StakeholderType;
  /** EN source label ("Third party"). */
  typeLabel: string;
  /** First letters of the first two words ("Port authority HSE" → "Pa"). */
  initials: string;
  contactEmail: string | null;
  /** Relationship owner, short name ("R. Aubert"). */
  owner: string;
  lastContactOn: string;
  /** "25 Sep" (with the year outside the business year, R-013). */
  lastText: string;
  /** No contact for more than 30 days (before the business date, R-013). */
  stale: boolean;
  notes: string;
  influence: number;
  interest: number;
  attitude: string;
}

export interface RaciMatrix {
  columns: string[];
  /** Cells in column order; null = empty. */
  rows: { label: string; cells: (RaciCode | null)[] }[];
}

export interface StakeholderRegister {
  stakeholders: StakeholderRow[];
  /** Null when the project has no RACI matrix. */
  raci: RaciMatrix | null;
}

/** Register (STAKEHOLDERS order, added ones last) and RACI matrix of a project. */
export async function getStakeholderRegister(projectCode: string): Promise<StakeholderRegister> {
  const db = await getDb();
  const today = await businessToday();
  const now = monthNowOf(today);
  const rows = await db
    .select({ s: stakeholders, ownerShort: persons.shortName })
    .from(stakeholders)
    .innerJoin(projects, eq(projects.id, stakeholders.projectId))
    .leftJoin(persons, eq(persons.id, stakeholders.ownerPersonId))
    .where(eq(projects.code, projectCode))
    .orderBy(asc(stakeholders.position));
  const [matrix] = await db.select({ id: raciMatrices.id }).from(raciMatrices).innerJoin(projects, eq(projects.id, raciMatrices.projectId)).where(eq(projects.code, projectCode));
  let raci: RaciMatrix | null = null;
  if (matrix) {
    const [cols, rws] = await Promise.all([
      db.select().from(raciColumns).where(eq(raciColumns.matrixId, matrix.id)).orderBy(asc(raciColumns.position)),
      db.select().from(raciRows).where(eq(raciRows.matrixId, matrix.id)).orderBy(asc(raciRows.position)),
    ]);
    const cells = rws.length ? await db.select().from(raciCells).where(inArray(raciCells.rowId, rws.map((r) => r.id))) : [];
    raci = {
      columns: cols.map((c) => c.label),
      rows: rws.map((r) => ({ label: r.label, cells: cols.map((c) => cells.find((x) => x.rowId === r.id && x.columnPosition === c.position)?.code ?? null) })),
    };
  }
  return {
    stakeholders: rows.map(({ s, ownerShort }) => ({
      name: s.name, organisation: s.organisation, role: s.role, type: s.type, typeLabel: stakeholderType.label(s.type), initials: stakeholderInitials(s.name),
      contactEmail: s.contactEmail, owner: ownerShort ?? s.ownerName, lastContactOn: s.lastContactOn, lastText: shortDateYearOfIso(s.lastContactOn, yearOfIso(today)),
      stale: isStaleContact(s.lastContactOn, now), notes: s.notes, influence: s.influence, interest: s.interest, attitude: s.attitude,
    })),
    raci,
  };
}

export interface NewStakeholder {
  name: string;
  organisation: string;
  role?: string | null;
  type: StakeholderType;
  contactEmail?: string | null;
  /** Relationship owner (full or short name of a team member). */
  owner: string;
}

/** "Add stakeholder" (AF.stakeholders, "Add"): appended with last contact = `on` (default the business date, R-013) and notes "New". */
export async function addStakeholder(projectCode: string, input: NewStakeholder, actorName: string, onDate?: string): Promise<void> {
  const db = await getDb();
  const on = onDate ?? (await businessToday());
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const name = input.name.trim();
    const organisation = input.organisation.trim();
    if (!name || !organisation) throw new Error('Name and organisation are required');
    if (!stakeholderType.isCode(input.type)) throw new Error('Invalid stakeholder type');
    const email = input.contactEmail?.trim() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid e-mail address');
    const owner = await findPerson(tx, input.owner);
    const [{ maxPos }] = await tx.select({ maxPos: sql<number>`coalesce(max(${stakeholders.position}), -1)::int` }).from(stakeholders).where(eq(stakeholders.projectId, p.id));
    const self = await findPerson(tx, name);
    const [s] = await tx
      .insert(stakeholders)
      .values({
        projectId: p.id, name, organisation, role: input.role?.trim() ?? '', type: input.type, contactEmail: email, ownerPersonId: owner?.id ?? null,
        ownerName: owner?.shortName ?? input.owner.trim(), lastContactOn: on, notes: 'New', personId: self?.id ?? null, position: maxPos + 1,
      })
      .returning({ id: stakeholders.id });
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: name, change: `stakeholder added · ${organisation} · ${stakeholderType.label(input.type)}`,
      area: 'Stakeholders', entityType: 'stakeholder', entityId: s.id, projectId: p.id,
    });
  });
}
