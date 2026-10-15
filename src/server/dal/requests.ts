import 'server-only';
// Resource requests & approvals DAL (docs/spec/08 §5–7, 11 §3.6 ResourceRequest): the PM outbox, the department
// heads' queues, the My approvals sources held in this database (resource requests, change requests, forced
// stage changes), and the request workflow writers — send, withdraw, re-request, approve (creates the task
// T-2341…), propose reschedule, reject, accept reschedule. Actors are the viewer, not the prototype's
// hard-coded R. Aubert / department head (00 §7.16). P-8b (R-089): a request for a contract role (no person yet) becomes,
// once approved, a sourcing task for procurement ("Find and name: …"); procurement or the director then names an existing
// person on it (`nameSourcedPerson`), which reassigns the task and completes the request.
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb, type DB, type Tx } from '@/server/db/client';
import {
  STATUS_ISO, addDaysIso, dayLabelOfIso, dayOffsetOfIso, isoOfDayOffset, requestStatus, shortDateOfIso, stage,
  type Priority, type RequestEventAction, type RequestStatus, type StageCode,
} from '@/server/db/codes';
import { findPerson, nameOf, nextNumber, recordActivity, requirePerson, requireProject, writeAudit } from '@/server/db/helpers';
import {
  activities, departments, persons, projects, requestActivityChoices, resourceRequestEvents, resourceRequests, stageTransitions, tasks, users,
} from '@/server/db/schema';

export interface RequestEventRow {
  action: RequestEventAction;
  date: string;
  by: string | null;
  note: string | null;
}

export interface ResourceRequestRow {
  /** "RQ-044". */
  id: string;
  projectCode: string;
  /** "HLT" (prototype `project`), full and short names ("Harbor Line"). */
  projectShort: string;
  projectName: string;
  projectShortName: string | null;
  /** PM who sent it: short ("R. Aubert") and full name. */
  requestedBy: string;
  requestedByName: string;
  /** Named person (full name) or null for a contract role. */
  person: string | null;
  contractRole: string | null;
  /** person ?? contractRole. */
  resource: string;
  department: string;
  /** Department head full name ("Awaiting {head}"). */
  departmentHead: string | null;
  title: string;
  activity: { code: string; name: string; totalFloat: number | null; critical: boolean } | null;
  hours: number;
  start: string;
  due: string;
  /** Working-day offsets from Mon 21 Sep 2026 (prototype `start` / `due`). */
  startDay: number | null;
  dueDay: number | null;
  priority: Priority;
  status: RequestStatus;
  /** REQ_STATUS label ("Pending review"…). */
  statusLabel: string;
  sent: string;
  /** "Fri 25 Sep". */
  sentText: string;
  note: string;
  /** Decision line ('' while pending). */
  response: string;
  proposedStart: string | null;
  proposedDue: string | null;
  proposedStartDay: number | null;
  proposedDueDay: number | null;
  /** Task created on approval ("T-2327"). */
  taskId: string | null;
  events: RequestEventRow[];
}

export interface RequestFilter {
  projectCode?: string;
  /** Sender (full or short name). */
  requestedBy?: string;
  department?: string;
  status?: RequestStatus;
  /** Named person (full or short name). */
  person?: string;
  /** "RQ-044". */
  number?: string;
}

/** Resource requests in list order (REQUESTS order, new ones first), optionally filtered. */
export async function listResourceRequests(filter: RequestFilter = {}): Promise<ResourceRequestRow[]> {
  const db = await getDb();
  const pm = alias(persons, 'pm');
  const who = alias(persons, 'who');
  const head = alias(persons, 'head');
  const where: SQL[] = [];
  if (filter.projectCode) where.push(eq(projects.code, filter.projectCode));
  if (filter.department) where.push(eq(departments.name, filter.department));
  if (filter.status) where.push(eq(resourceRequests.status, filter.status));
  if (filter.number) where.push(eq(resourceRequests.number, filter.number));
  if (filter.requestedBy) where.push(sql`(${pm.fullName} = ${filter.requestedBy} or ${pm.shortName} = ${filter.requestedBy})`);
  if (filter.person) where.push(sql`(${who.fullName} = ${filter.person} or ${who.shortName} = ${filter.person})`);
  const rows = await db
    .select({
      r: resourceRequests, code: projects.code, short: projects.shortCode, pname: projects.name, pshort: projects.shortName,
      pmFull: pm.fullName, pmShort: pm.shortName, whoFull: who.fullName, whoShort: who.shortName, dept: departments.name,
      headFull: head.fullName, headShort: head.shortName, actCode: activities.code, actName: activities.name, actFloat: activities.totalFloatDays, task: tasks.number,
    })
    .from(resourceRequests)
    .innerJoin(projects, eq(projects.id, resourceRequests.projectId))
    .innerJoin(pm, eq(pm.id, resourceRequests.requestedByPersonId))
    .leftJoin(who, eq(who.id, resourceRequests.personId))
    .innerJoin(departments, eq(departments.id, resourceRequests.departmentId))
    .leftJoin(head, eq(head.id, departments.headPersonId))
    .leftJoin(activities, eq(activities.id, resourceRequests.activityId))
    .leftJoin(tasks, eq(tasks.id, resourceRequests.taskId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(resourceRequests.sortOrder));
  if (!rows.length) return [];
  const by = alias(persons, 'by');
  const events = await db
    .select({ e: resourceRequestEvents, full: by.fullName, short: by.shortName })
    .from(resourceRequestEvents)
    .leftJoin(by, eq(by.id, resourceRequestEvents.byPersonId))
    .where(inArray(resourceRequestEvents.requestId, rows.map((x) => x.r.id)))
    .orderBy(asc(resourceRequestEvents.position), asc(resourceRequestEvents.createdAt));
  return rows.map((x) => {
    const r = x.r;
    const person = x.whoShort ? (x.whoFull ?? x.whoShort) : null;
    return {
      id: r.number, projectCode: x.code, projectShort: x.short, projectName: x.pname, projectShortName: x.pshort,
      requestedBy: x.pmShort, requestedByName: x.pmFull ?? x.pmShort, person, contractRole: r.contractRole, resource: person ?? r.contractRole ?? '',
      department: x.dept, departmentHead: x.headShort ? (x.headFull ?? x.headShort) : null, title: r.title,
      activity: x.actCode ? { code: x.actCode, name: x.actName!, totalFloat: x.actFloat, critical: x.actFloat != null && x.actFloat < 0 } : null,
      hours: r.hours, start: r.startDate, due: r.dueDate, startDay: dayOffsetOfIso(r.startDate), dueDay: dayOffsetOfIso(r.dueDate),
      priority: r.priority, status: r.status, statusLabel: requestStatus.label(r.status), sent: r.sentOn, sentText: dayLabelOfIso(r.sentOn),
      note: r.note, response: r.response, proposedStart: r.proposedStart, proposedDue: r.proposedDue,
      proposedStartDay: r.proposedStart ? dayOffsetOfIso(r.proposedStart) : null, proposedDueDay: r.proposedDue ? dayOffsetOfIso(r.proposedDue) : null,
      taskId: x.task, events: events.filter((e) => e.e.requestId === r.id).map((e) => ({ action: e.e.action, date: e.e.onDate, by: e.short ? (e.full ?? e.short) : null, note: e.e.note })),
    };
  });
}

/** One request by number; null when unknown. */
export async function getResourceRequest(number: string): Promise<ResourceRequestRow | null> {
  return (await listResourceRequests({ number }))[0] ?? null;
}

/**
 * Activity chips of the "New resource request" dialog: the project's curated list (NR_ACTS for HLT-026), else its
 * open activities (% complete < 100) in plan order.
 */
export async function listRequestActivities(projectCode: string): Promise<{ code: string; name: string; label: string }[]> {
  const db = await getDb();
  const curated = await db
    .select({ code: activities.code, name: activities.name })
    .from(requestActivityChoices)
    .innerJoin(projects, eq(projects.id, requestActivityChoices.projectId))
    .innerJoin(activities, eq(activities.id, requestActivityChoices.activityId))
    .where(eq(projects.code, projectCode))
    .orderBy(asc(requestActivityChoices.position));
  const rows = curated.length
    ? curated
    : await db
        .select({ code: activities.code, name: activities.name })
        .from(activities)
        .innerJoin(projects, eq(projects.id, activities.projectId))
        .where(and(eq(projects.code, projectCode), sql`${activities.percentComplete} < 100`))
        .orderBy(asc(activities.position));
  return rows.map((a) => ({ ...a, label: `${a.code} · ${a.name}` }));
}

/** Departments (DEPTS order) with the number of pending requests (Approvals chips and nav badge). */
export async function listApprovalDepartments(): Promise<{ name: string; head: string | null; headTitle: string | null; pending: number }[]> {
  const db = await getDb();
  const head = alias(persons, 'head');
  const rows = await db
    .select({
      name: departments.name, headFull: head.fullName, headShort: head.shortName, headTitle: departments.headTitle,
      pending: sql<number>`(select count(*)::int from ${resourceRequests} where ${resourceRequests.departmentId} = ${departments.id} and ${resourceRequests.status} = 'pending')`,
    })
    .from(departments)
    .leftJoin(head, eq(head.id, departments.headPersonId))
    .orderBy(asc(departments.sortOrder));
  return rows.map((r) => ({ name: r.name, head: r.headShort ? (r.headFull ?? r.headShort) : null, headTitle: r.headTitle, pending: r.pending }));
}

export interface DepartmentApprovals {
  department: string;
  head: { name: string; shortName: string; initials: string; title: string | null } | null;
  /** Pending requests of the department ("Awaiting your decision"), list order. */
  pending: ResourceRequestRow[];
  /** Every other request of the department ("Decided": approved, rejected, reschedule, withdrawn). */
  decided: ResourceRequestRow[];
  /** Pending hours per named person (Team load "Pending" column). */
  pendingHoursByPerson: Record<string, number>;
}

/** Approvals queue of a department (any name of DEPTS); null when unknown. Team loads: resources.getResourcePool(). */
export async function getDepartmentApprovals(department: string): Promise<DepartmentApprovals | null> {
  const db = await getDb();
  const head = alias(persons, 'head');
  const [d] = await db
    .select({ name: departments.name, title: departments.headTitle, full: head.fullName, short: head.shortName, initials: head.initials })
    .from(departments)
    .leftJoin(head, eq(head.id, departments.headPersonId))
    .where(eq(departments.name, department));
  if (!d) return null;
  const all = await listResourceRequests({ department });
  const pending = all.filter((r) => r.status === 'pending');
  const pendingHoursByPerson: Record<string, number> = {};
  for (const r of pending) if (r.person) pendingHoursByPerson[r.person] = (pendingHoursByPerson[r.person] ?? 0) + r.hours;
  return {
    department: d.name, head: d.short ? { name: d.full ?? d.short, shortName: d.short, initials: d.initials!, title: d.title } : null,
    // Chapter 4 (S-7): drafts are not sent to the department yet.
    pending, decided: all.filter((r) => r.status !== 'pending' && r.status !== 'draft'), pendingHoursByPerson,
  };
}

export interface ForcedStageChangeRow {
  projectCode: string;
  projectName: string;
  /** Stage entered (code + prototype label). */
  stage: StageCode;
  stageLabel: string;
  reason: string | null;
  effectiveOn: string;
  requestedBy: string | null;
  /** The project PM (the prototype shows it as "who"). */
  pm: string | null;
}

/** Forced stage changes awaiting the director's validation (My approvals "Forced stage change", OPEN QUESTION L-1). */
export async function listPendingForcedStageChanges(): Promise<ForcedStageChangeRow[]> {
  const db = await getDb();
  const req = alias(persons, 'req');
  const pm = alias(persons, 'pm');
  const rows = await db
    .select({ t: stageTransitions, code: projects.code, name: projects.name, reqFull: req.fullName, reqShort: req.shortName, pmFull: pm.fullName, pmShort: pm.shortName })
    .from(stageTransitions)
    .innerJoin(projects, eq(projects.id, stageTransitions.projectId))
    .leftJoin(req, eq(req.id, stageTransitions.requestedByPersonId))
    .leftJoin(pm, eq(pm.id, projects.pmPersonId))
    .where(and(eq(stageTransitions.mode, 'forced'), eq(stageTransitions.validationStatus, 'pending')))
    .orderBy(asc(stageTransitions.createdAt));
  return rows.map((r) => ({
    projectCode: r.code, projectName: r.name, stage: r.t.toStage, stageLabel: stage.label(r.t.toStage), reason: r.t.reason, effectiveOn: r.t.effectiveOn,
    requestedBy: r.reqShort ? (r.reqFull ?? r.reqShort) : null, pm: r.pmShort ? (r.pmFull ?? r.pmShort) : null,
  }));
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────

export interface NewRequestInput {
  projectCode: string;
  /** Empty → "Untitled request". */
  title: string;
  /** Activity code (NR_ACTS: A1250, A1260, A1320, A1420, A1430). */
  activityCode: string;
  /** Named person (full or short name) — or a contract role such as "Contract structural engineer". */
  person?: string;
  contractRole?: string;
  /** Default 8 (unparsable hours → 8). */
  hours?: number;
  /** ISO dates, or prototype working-day offsets (week w/c 28 Sep = 5, duration +1 / +4 / +9). */
  startDate?: string;
  dueDate?: string;
  startDay?: number;
  dueDay?: number;
  priority: Priority;
  note?: string;
  /** Business date of sending (default the status date). */
  sentOn?: string;
  /** Chapter 4 (S-7): create a DRAFT (not sent to the department) — what-if "Apply"; `sendDraftRequest` sends it. */
  draft?: boolean;
  /** What-if scenario that drafted the request. */
  scenarioId?: string | null;
}

const today = (d?: string) => d ?? STATUS_ISO;

async function loadRequest(tx: Tx, number: string) {
  const [r] = await tx.select().from(resourceRequests).where(eq(resourceRequests.number, number));
  if (!r) throw new Error(`Unknown resource request ${number}`);
  return r;
}

async function addEvent(tx: Tx, requestId: string, action: RequestEventAction, onDate: string, byPersonId: string | null, note: string | null) {
  const [{ pos }] = await tx
    .select({ pos: sql<number>`coalesce(max(${resourceRequestEvents.position}), -1)::int` })
    .from(resourceRequestEvents)
    .where(eq(resourceRequestEvents.requestId, requestId));
  await tx.insert(resourceRequestEvents).values({ requestId, action, onDate, byPersonId, note, position: pos + 1 });
}

/**
 * "Send request" (New resource request dialog): a pending request RQ-045… prepended to the list, routed to the
 * person's department (Engineering for contract roles). `requestedBy` is the viewer. Returns the number.
 */
export async function createResourceRequest(input: NewRequestInput, requestedBy: string, q?: Tx): Promise<string> {
  // Inside the caller's transaction when given (what-if "Apply": duplicate check, drafts and the applied stamp commit together).
  if (q) return insertResourceRequest(q, input, requestedBy);
  const db = await getDb();
  return db.transaction((tx) => insertResourceRequest(tx, input, requestedBy));
}

async function insertResourceRequest(tx: Tx, input: NewRequestInput, requestedBy: string): Promise<string> {
  const p = await requireProject(tx, input.projectCode);
  const pm = await requirePerson(tx, requestedBy);
  const person = input.person ? await requirePerson(tx, input.person) : null;
  let deptId: string | null = null;
  if (person) [{ deptId }] = await tx.select({ deptId: persons.departmentId }).from(persons).where(eq(persons.id, person.id));
  if (!deptId) [{ deptId }] = await tx.select({ deptId: departments.id }).from(departments).where(eq(departments.name, 'Engineering'));
  const [act] = await tx.select({ id: activities.id }).from(activities).where(and(eq(activities.projectId, p.id), eq(activities.code, input.activityCode)));
  const number = await nextNumber(tx, resourceRequests, resourceRequests.number, 'RQ-', 3, 44);
  const [{ minOrder }] = await tx.select({ minOrder: sql<number>`coalesce(min(${resourceRequests.sortOrder}), 1)::int` }).from(resourceRequests);
  const start = input.startDate ?? isoOfDayOffset(input.startDay ?? 5);
  const due = input.dueDate ?? isoOfDayOffset(input.dueDay ?? (input.startDay ?? 5) + 4);
  const sentOn = today(input.sentOn);
  const hours = input.hours != null && Number.isFinite(input.hours) && input.hours > 0 ? input.hours : 8;
  const [r] = await tx
    .insert(resourceRequests)
    .values({
      number, projectId: p.id, requestedByPersonId: pm.id, personId: person?.id ?? null, contractRole: person ? null : (input.contractRole?.trim() || 'Contract role'),
      departmentId: deptId!, title: input.title.trim() || 'Untitled request', activityId: act?.id ?? null, hours, startDate: start, dueDate: due,
      priority: input.priority, status: input.draft ? 'draft' : 'pending', sentOn, note: input.note?.trim() ?? '', sortOrder: minOrder - 1,
      scenarioId: input.scenarioId ?? null,
    })
    .returning({ id: resourceRequests.id });
  await addEvent(tx, r.id, input.draft ? 'drafted' : 'sent', sentOn, pm.id, input.note?.trim() || null);
  await writeAudit(tx, { actorName: nameOf(pm), actorPersonId: pm.id, objectRef: `Request ${number}`, change: input.draft ? 'drafted' : 'sent → pending review', area: 'Resource requests', entityType: 'resource_request', entityId: r.id, projectId: p.id });
  return number;
}

/** Chapter 4 (S-7): sends a draft to its department (draft → pending review), stamped with the business date. */
export async function sendDraftRequest(number: string, actorName: string, on?: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const r = await loadRequest(tx, number);
    if (r.status !== 'draft') throw new Error(`${number} is not a draft (${r.status})`);
    const actor = await findPerson(tx, actorName);
    const d = today(on);
    await tx.update(resourceRequests).set({ status: 'pending', sentOn: d, updatedAt: new Date() }).where(eq(resourceRequests.id, r.id));
    await addEvent(tx, r.id, 'sent', d, actor?.id ?? null, null);
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: `Request ${number}`, change: 'draft → pending review', area: 'Resource requests', entityType: 'resource_request', entityId: r.id, projectId: r.projectId });
  });
}

/** Chapter 4 (S-7): discards a draft (deleted — it was never sent). */
export async function discardDraftRequest(number: string, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const r = await loadRequest(tx, number);
    if (r.status !== 'draft') throw new Error(`${number} is not a draft (${r.status})`);
    const actor = await findPerson(tx, actorName);
    await tx.delete(resourceRequests).where(eq(resourceRequests.id, r.id));
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: `Request ${number}`, change: 'draft discarded', area: 'Resource requests', entityType: 'resource_request', entityId: r.id, projectId: r.projectId });
  });
}

/** "Withdraw" (pending or reschedule): status withdrawn, response "Withdrawn by PM · Fri 25 Sep". */
export async function withdrawResourceRequest(number: string, actorName: string, on?: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const r = await loadRequest(tx, number);
    if (r.status !== 'pending' && r.status !== 'reschedule') throw new Error(`${number} cannot be withdrawn (${r.status})`);
    const actor = await findPerson(tx, actorName);
    const d = today(on);
    await tx.update(resourceRequests).set({ status: 'withdrawn', response: `Withdrawn by PM · ${dayLabelOfIso(d)}`, updatedAt: new Date() }).where(eq(resourceRequests.id, r.id));
    await addEvent(tx, r.id, 'withdrawn', d, actor?.id ?? null, null);
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: `Request ${number}`, change: `${r.status} → withdrawn`, area: 'Resource requests', entityType: 'resource_request', entityId: r.id, projectId: r.projectId });
  });
}

/** "Re-request" (rejected or withdrawn): back to pending, sent today, response cleared. */
export async function reRequestResourceRequest(number: string, actorName: string, on?: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const r = await loadRequest(tx, number);
    if (r.status !== 'rejected' && r.status !== 'withdrawn') throw new Error(`${number} cannot be re-requested (${r.status})`);
    const actor = await findPerson(tx, actorName);
    const d = today(on);
    await tx.update(resourceRequests).set({ status: 'pending', sentOn: d, response: '', proposedStart: null, proposedDue: null, updatedAt: new Date() }).where(eq(resourceRequests.id, r.id));
    await addEvent(tx, r.id, 'resent', d, actor?.id ?? null, null);
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: `Request ${number}`, change: `${r.status} → pending`, area: 'Resource requests', entityType: 'resource_request', entityId: r.id, projectId: r.projectId });
  });
}

// ── P-8b (R-089): sourcing a contract role through procurement ─────────────────────────────────────────────────────

/** Persons holding an active user account with `role`, in user order (users.sort_order). */
async function personsWithRole(q: DB | Tx, role: string): Promise<string[]> {
  const rows = await q
    .select({ personId: users.personId })
    .from(users)
    .where(and(eq(users.active, true), sql`${role} = any(${users.roles})`))
    .orderBy(asc(users.sortOrder));
  return rows.map((r) => r.personId);
}

/**
 * Who gets the sourcing task of an approved contract-role request: the first active user holding the procurement role (user
 * order), else the portfolio director (P-8b default — the owner may name a buyer later); null when neither exists.
 */
export async function procurementAssignee(q?: DB | Tx): Promise<string | null> {
  const db = q ?? (await getDb());
  return (await personsWithRole(db, 'procurement'))[0] ?? (await personsWithRole(db, 'director'))[0] ?? null;
}

/** Every active procurement user's person (they are all told about a new sourcing task). */
export async function procurementPersonIds(): Promise<string[]> {
  return personsWithRole(await getDb(), 'procurement');
}

/** Title of a sourcing task: "Find and name: Contract structural engineer — Steel connection checks". */
export const sourcingTaskTitle = (contractRole: string, title: string) => `Find and name: ${contractRole} — ${title}`;

/**
 * Creates the task of an approved request (assign 4111): T-2341…, todo, 0/3 checklist, label = first word of the department,
 * "fresh". P-8b (R-089): a contract role (no person) gives the sourcing task to procurement (`procurementAssignee`) —
 * "Find and name: {role} — {title}", same dates, hours and source request, the contract role kept on it until a person is
 * named.
 */
async function createTaskFromRequest(tx: Tx, r: typeof resourceRequests.$inferSelect, start: string, due: string): Promise<{ id: string; number: string; sourcing: boolean }> {
  const number = await nextNumber(tx, tasks, tasks.number, 'T-', 4, 2340);
  const [{ maxOrder }] = await tx.select({ maxOrder: sql<number>`coalesce(max(${tasks.sortOrder}), 0)::int` }).from(tasks);
  const [dept] = await tx.select({ name: departments.name }).from(departments).where(eq(departments.id, r.departmentId));
  const sourcing = !r.personId && !!r.contractRole;
  const assignee = r.personId ?? (sourcing ? await procurementAssignee(tx) : null);
  const [t] = await tx
    .insert(tasks)
    .values({
      number, assigneePersonId: assignee, contractRole: r.personId ? null : r.contractRole, title: sourcing ? sourcingTaskTitle(r.contractRole!, r.title) : r.title,
      projectId: r.projectId, activityId: r.activityId, status: 'todo', priority: r.priority, startDate: start, dueDate: due, estimateH: r.hours, loggedH: 0,
      percentComplete: 0, labels: [dept.name.split(' ')[0]], checklistDone: 0, checklistTotal: 3, isFresh: true, departmentId: r.departmentId, sourceRequestId: r.id,
      sortOrder: maxOrder + 1, origin: 'request',
    })
    .returning({ id: tasks.id });
  return { id: t.id, number, sourcing };
}

/**
 * People procurement may name on a sourcing task (P-8b): existing persons only — the internal resource pool first (pool order),
 * then the other known people who are not a client organisation's contacts (external workers already in Keystone), by name.
 * Contract-role placeholders and client users are left out. Creating a person waits for the Cursus staff directory (R-027).
 */
export async function listSourcingCandidates(q?: DB | Tx): Promise<{ personId: string; name: string; short: string; pool: boolean }[]> {
  const db = q ?? (await getDb());
  const rows = await db
    .select({ id: persons.id, full: persons.fullName, short: persons.shortName, pool: persons.resourcePoolPosition, order: persons.sortOrder, userClient: users.clientId, roles: users.roles })
    .from(persons)
    .leftJoin(users, eq(users.personId, persons.id))
    .where(and(sql`${persons.clientId} is null`, eq(persons.isContractRole, false)));
  return rows
    .filter((r) => !r.userClient && !(r.roles ?? []).includes('client'))
    .sort((a, b) => (a.pool == null) !== (b.pool == null) ? (a.pool == null ? 1 : -1) : a.pool != null && b.pool != null ? a.pool - b.pool : (a.full ?? a.short).localeCompare(b.full ?? b.short))
    .map((r) => ({ personId: r.id, name: r.full ?? r.short, short: r.short, pool: r.pool != null }));
}

/** The sourcing task changed meanwhile (named already, not a sourcing task): refused, nothing written. */
export class SourcingStaleError extends Error {}

export interface NamedSourcing {
  task: string;
  request: string;
  projectCode: string;
  /** The person named (display name) and their id; the requesting PM's person. */
  person: string;
  personId: string;
  pmPersonId: string;
}

/**
 * P-8b (R-089) "Name the person": on a sourcing task (created from a contract-role request, not named yet), procurement or the
 * director names an EXISTING person (`listSourcingCandidates`). In one transaction the writer re-checks the actor's role, the
 * task's origin and the not-yet-named state (task and request rows locked), then: the same task goes to the person (contract
 * role cleared, the request title back as its title), the request names the person (its contract role kept as history) with
 * a 'named' event, and an audit line "T-xxxx · named: {person}" is written with the activity line.
 */
export async function nameSourcedPerson(taskNumber: string, personName: string, actorName: string, on?: string): Promise<NamedSourcing> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const actor = await findPerson(tx, actorName);
    const roles = actor ? (await tx.select({ roles: users.roles }).from(users).where(and(eq(users.personId, actor.id), eq(users.active, true)))).flatMap((u) => u.roles) : [];
    if (!actor || !roles.some((r) => r === 'procurement' || r === 'director')) throw new Error('Only procurement or the portfolio director can name the person');
    const [t] = await tx.select().from(tasks).where(eq(tasks.number, taskNumber)).for('update');
    if (!t) throw new SourcingStaleError('Unknown task');
    if (!t.sourceRequestId || !t.contractRole) throw new SourcingStaleError('This task already names its person');
    const [r] = await tx.select().from(resourceRequests).where(eq(resourceRequests.id, t.sourceRequestId)).for('update');
    if (!r || r.personId || r.taskId !== t.id) throw new SourcingStaleError('This task already names its person');
    const candidates = await listSourcingCandidates(tx);
    const person = candidates.find((c) => c.name === personName || c.short === personName);
    if (!person) throw new SourcingStaleError('Choose a person known to Keystone');
    await tx.update(tasks).set({ assigneePersonId: person.personId, contractRole: null, title: r.title, updatedAt: new Date() }).where(eq(tasks.id, t.id));
    await tx.update(resourceRequests).set({ personId: person.personId, updatedAt: new Date() }).where(eq(resourceRequests.id, r.id));
    await addEvent(tx, r.id, 'named', today(on), actor.id, person.name);
    const [p] = await tx.select({ code: projects.code }).from(projects).where(eq(projects.id, t.projectId));
    await writeAudit(tx, {
      actorName: nameOf(actor), actorPersonId: actor.id, objectRef: t.number, change: `named: ${person.name} · ${t.contractRole} · ${r.number}`, area: 'Resource requests',
      entityType: 'task', entityId: t.id, projectId: t.projectId,
    });
    await recordActivity(tx, { actorName: nameOf(actor), actorPersonId: actor.id, text: `Named ${person.name} for resource request ${r.number} — ${r.title}`, kind: 'request', projectId: t.projectId });
    return { task: t.number, request: r.number, projectCode: p.code, person: person.name, personId: person.personId, pmPersonId: r.requestedByPersonId };
  });
}

/**
 * "Approve & send to {first}": creates the task in the person's list and marks the request approved with
 * "Approved · {approver} · Fri 25 Sep". Returns the task number.
 */
export async function approveResourceRequest(number: string, approverName: string, on?: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const r = await loadRequest(tx, number);
    if (r.status !== 'pending') throw new Error(`${number} is not pending (${r.status})`);
    const approver = await requirePerson(tx, approverName);
    const d = today(on);
    const task = await createTaskFromRequest(tx, r, r.startDate, r.dueDate);
    await tx.update(resourceRequests).set({ status: 'approved', response: `Approved · ${nameOf(approver)} · ${dayLabelOfIso(d)}`, taskId: task.id, updatedAt: new Date() }).where(eq(resourceRequests.id, r.id));
    await addEvent(tx, r.id, 'approved', d, approver.id, null);
    const [who] = r.personId ? await tx.select({ full: persons.fullName, short: persons.shortName }).from(persons).where(eq(persons.id, r.personId)) : [];
    // P-8b (R-089): a contract role's task goes to procurement (was "task created for {contract role}").
    await writeAudit(tx, {
      actorName: nameOf(approver), actorPersonId: approver.id, objectRef: `Request ${number}`,
      change: `approved → task created for ${who ? (who.full ?? who.short) : task.sourcing ? 'Procurement' : (r.contractRole ?? '')}`, area: 'Approvals', entityType: 'resource_request', entityId: r.id, projectId: r.projectId,
    });
    return task.number;
  });
}

/** "Send proposal": reschedule by +1/+2/+3 weeks with an optional reason for the PM. */
export async function proposeReschedule(number: string, shiftWeeks: number, note: string, approverName: string, on?: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const r = await loadRequest(tx, number);
    if (r.status !== 'pending') throw new Error(`${number} is not pending (${r.status})`);
    const approver = await requirePerson(tx, approverName);
    const d = today(on);
    const shift = Math.max(1, Math.min(3, Math.round(shiftWeeks)));
    const n = note.trim();
    await tx
      .update(resourceRequests)
      .set({
        status: 'reschedule', proposedStart: addDaysIso(r.startDate, 7 * shift), proposedDue: addDaysIso(r.dueDate, 7 * shift),
        response: `Reschedule proposed · ${nameOf(approver)} · ${dayLabelOfIso(d)}${n ? ' — ' + n : ''}`, updatedAt: new Date(),
      })
      .where(eq(resourceRequests.id, r.id));
    await addEvent(tx, r.id, 'reschedule', d, approver.id, n || null);
    await writeAudit(tx, { actorName: nameOf(approver), actorPersonId: approver.id, objectRef: `Request ${number}`, change: `reschedule proposed +${shift} wk`, area: 'Approvals', entityType: 'resource_request', entityId: r.id, projectId: r.projectId });
  });
}

/** "Confirm reject" with the reason the PM sees. */
export async function rejectResourceRequest(number: string, note: string, approverName: string, on?: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const r = await loadRequest(tx, number);
    if (r.status !== 'pending') throw new Error(`${number} is not pending (${r.status})`);
    const approver = await requirePerson(tx, approverName);
    const d = today(on);
    const n = note.trim();
    await tx.update(resourceRequests).set({ status: 'rejected', response: `Rejected · ${nameOf(approver)} · ${dayLabelOfIso(d)}${n ? ' — ' + n : ''}`, updatedAt: new Date() }).where(eq(resourceRequests.id, r.id));
    await addEvent(tx, r.id, 'rejected', d, approver.id, n || null);
    await writeAudit(tx, { actorName: nameOf(approver), actorPersonId: approver.id, objectRef: `Request ${number}`, change: 'pending → rejected', area: 'Approvals', entityType: 'resource_request', entityId: r.id, projectId: r.projectId });
  });
}

/** "Accept {dates}" (PM): the proposed dates become the request dates, the task is created. Returns the task number. */
export async function acceptReschedule(number: string, actorName: string, on?: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const r = await loadRequest(tx, number);
    if (r.status !== 'reschedule' || !r.proposedStart || !r.proposedDue) throw new Error(`${number} has no reschedule proposal`);
    const actor = await findPerson(tx, actorName);
    const task = await createTaskFromRequest(tx, r, r.proposedStart, r.proposedDue);
    await tx
      .update(resourceRequests)
      .set({
        status: 'approved', startDate: r.proposedStart, dueDate: r.proposedDue, taskId: task.id, updatedAt: new Date(),
        response: `Rescheduled to ${shortDateOfIso(r.proposedStart)} – ${shortDateOfIso(r.proposedDue)} · accepted by PM · assigned`,
      })
      .where(eq(resourceRequests.id, r.id));
    await addEvent(tx, r.id, 'accepted', today(on), actor?.id ?? null, null);
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: `Request ${number}`, change: `reschedule accepted → task ${task.number}${task.sourcing ? ' created for Procurement' : ''}`,
      area: 'Resource requests', entityType: 'resource_request', entityId: r.id, projectId: r.projectId,
    });
    return task.number;
  });
}
