import 'server-only';
// Approver identity of the viewer (docs/spec/00 §7.8 "the server computes the inbox per user, not per role"):
// what the signed-in person is responsible for in the database — the departments they head (resource
// requests), the projects they manage (PM step of change requests, purchase orders) and the client
// organisation they represent (client step, deliverable acceptance). The role still routes the kinds the
// prototype assigns to a function without an owner (ECO keys, delivery QC, RFQ awards, invoices, NCRs).
import { eq, or } from 'drizzle-orm';
import { cache } from 'react';
import type { Persona } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { getDb } from '@/server/db/client';
import { departments, persons, projects, users } from '@/server/db/schema';
import { leadProjectCodes } from './project-team';

export interface ApproverIdentity {
  role: RoleKey;
  /** Full name ("Marion Kerviel"). */
  name: string;
  /** Short name as projects and records cite people ("M. Kerviel"). */
  short: string;
  /** EN source title of the persona ("Head of engineering"). */
  title: string;
  /** Departments headed by the viewer, DEPTS order ("Engineering"). */
  departments: string[];
  /** Codes of the projects the viewer leads: PM of record, co-PM or deputy (R-041). */
  managedProjects: string[];
  /** Codes of the projects of the viewer's client organisation (client contacts only). */
  clientProjects: string[];
}

/** The viewer's approver identity (memoised per request). Unknown people get empty responsibilities. */
export const getApproverIdentity = cache(async (viewer: Persona): Promise<ApproverIdentity> => {
  const db = await getDb();
  const [person] = await db
    .select({ id: persons.id, clientId: persons.clientId })
    .from(persons)
    // A signed-in user is their person (R-039); a demo persona is found by name.
    .where(viewer.personId ? eq(persons.id, viewer.personId) : or(eq(persons.fullName, viewer.name), eq(persons.shortName, viewer.short)));
  const base = { role: viewer.role, name: viewer.name, short: viewer.short, title: viewer.title };
  if (!person) return { ...base, departments: [], managedProjects: [], clientProjects: [] };
  const [heads, managed, user] = await Promise.all([
    db.select({ name: departments.name, order: departments.sortOrder }).from(departments).where(eq(departments.headPersonId, person.id)),
    leadProjectCodes(db, person.id).then((cs) => cs.map((code, order) => ({ code, order }))),
    db.select({ clientId: users.clientId }).from(users).where(eq(users.personId, person.id)),
  ]);
  const clientIds = [...new Set([person.clientId, ...user.map((u) => u.clientId)].filter((x): x is string => !!x))];
  const clientRows = clientIds.length
    ? (await Promise.all(clientIds.map((c) => db.select({ code: projects.code, order: projects.sortOrder }).from(projects).where(eq(projects.clientId, c))))).flat()
    : [];
  const codes = (rows: { code: string; order: number }[]) => rows.sort((a, b) => a.order - b.order).map((r) => r.code);
  return {
    ...base,
    departments: heads.sort((a, b) => a.order - b.order).map((d) => d.name),
    managedProjects: codes(managed),
    clientProjects: codes(clientRows),
  };
});
