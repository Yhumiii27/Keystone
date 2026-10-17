import 'server-only';
// Home DAL (docs/spec/03 §1): gathers each role's inputs and builds the HomeView (src/domain/home.ts).
// Projects, EVM series, schedule header, milestones, change requests, activities, resource requests, the resource
// pool's weekly loads, tasks, the skills matrix and certifications come from the database. The director's KPI tiles
// and "Needs attention" items are the Portfolio overview's (src/server/dal/portfolio.ts). Since Delivery 4, the parts
// catalogue, the purchase orders (and so the BOM shortfall), the drawings (PDM vault mirror) and the ECOs (Vigie
// mirror, src/server/integrations/vigie) come from the database too; since Delivery 5, the client's deliverables
// (the deliverables register, src/server/dal/quality.ts) and open invoice (the billing plan, as on the client portal).
import type { RoleKey } from '@/config/screens';
import { isNotNull } from 'drizzle-orm';
import {
  clientHome, clientHomeDeliverables, clientOpenInvoice, deptHeadHome, directorHome, engLeadHome, homeHref, memberHome, pmHome, procurementHome,
  qualityHome, type ChangeRequest, type CurrentProject, type Drawing, type Eco, type EvmSeries, type HomeView, type Lookups, type Part,
  type Persona, type PersonLoad, type PortfolioAlert, type PurchaseOrder, type ResourceRequest, type ScheduleHeader, type Todo,
} from '@/domain/home';
import { yearOfIso } from '@/domain/clock';
import { noProjectHome } from '@/domain/home-empty';
import { businessToday } from '@/server/clock';
import { inExecution } from '@/domain/portfolio';
import { workingDayOf } from '@/domain/tasks';
import type { Lang } from '@/i18n/translate';
import { getDb } from '@/server/db/client';
import { REQUEST_STATUS_TAG, addDaysIso, ecoType, fmtDOfIso, requestStatus, taskStatus } from '@/server/db/codes';
import { projects as projectsTable } from '@/server/db/schema';
import type { ZoneKey } from '@/server/session';
import { getCostControl, listChangeRequests } from './cost';
import { listDrawings } from './drawings';
import { listEcos } from './eco';
import { loggedThisWeek } from './kpis';
import { listParts } from './parts';
import { getClientPortal } from './client';
import { getActivities, getMilestones, getScheduleControl } from './planning';
import { getPortfolioOverview } from './portfolio';
import { getSkillsMatrix } from './hr';
import { clientRefusedProject } from '@/domain/rights';
import { getProject, listProjects, type ProjectRow } from './projects';
import { listPurchaseOrders } from './purchasing';
import { listDeliverables } from './quality';
import { listApprovalDepartments, listResourceRequests } from './requests';
import { currentLoadWeeks, getCapacityDemand, getResourcePool } from './resources';
import { listTasks } from './tasks';
import { resolveCurrentProject } from './current-project';

export interface HomeQuery {
  role: RoleKey;
  persona: Persona;
  /**
   * Current project (session getCurrentProject); an unknown code falls back to the current project of the register (R-011);
   * null when the database has no project yet.
   */
  projectCode: string | null;
  /** Client organisation of a client viewer (R-042, P-10a: their Home shows one of their organisation's projects only). */
  organisation?: string | null;
  /** Portfolio zone filter (shared with the Portfolio screens): director KPIs and alerts follow it. */
  zone: ZoneKey | null;
  lang: Lang;
}

// ── Database-backed inputs ────────────────────────────────────────────────────────────────────────────────

/** Short project names by short code (PROJ_NAMES 3263: "HLT" → "Harbor Line"), the projects' `short_name`. */
async function lookups(): Promise<Lookups> {
  const db = await getDb();
  const rows = await db.select({ code: projectsTable.shortCode, name: projectsTable.shortName }).from(projectsTable).where(isNotNull(projectsTable.shortName));
  return { projectNames: Object.fromEntries(rows.map((r) => [r.code, r.name!])) };
}

/** Resource request status labels and tags (REQ_STATUS 3282). */
const REQ_STATUS: Record<string, [string, string]> = Object.fromEntries(requestStatus.codes.map((c) => [c, [requestStatus.label(c), 'tag ' + REQUEST_STATUS_TAG[c]]]));
/** Task status labels (STATUS_L 3264). */
const TASK_STATUS: Record<string, string> = Object.fromEntries(taskStatus.codes.map((c) => [c, taskStatus.label(c)]));

/**
 * The client Home's deliverables (being produced, waiting for the client, rejected, accepted in the last 30 days) and
 * open invoice, from the deliverables register and the billing plan the client portal shows.
 */
async function clientInputs(code: string, today: string) {
  const [dlv, portal] = await Promise.all([listDeliverables(code), getClientPortal(code)]);
  const deliverables = clientHomeDeliverables(
    dlv.map((d) => ({ ...d, acceptedOnText: d.acceptedOn ? fmtDOfIso(d.acceptedOn, yearOfIso(today)) : null })),
    addDaysIso(today, -30),
  );
  const invoice = clientOpenInvoice(portal.invoices.map((m) => ({ ...m, dueText: m.dueOn ? fmtDOfIso(m.dueOn, yearOfIso(today)) : null })), portal.currency);
  return { deliverables, invoice };
}

/** The parts catalogue (PARTS order, parts created in Keystone appended): list price, quantity per project short code. */
async function parts(): Promise<Part[]> {
  return (await listParts()).map((p) => ({
    ref: p.ref, name: p.name, mfr: p.manufacturer ?? '', mb: p.makeBuyLabel, price: p.listPriceEur, status: p.statusLabel,
    usage: Object.fromEntries(p.usage.map((u) => [u.shortCode, u.quantity])),
  }));
}

/**
 * The ECOs of the Vigie mirror, with the status Vigie reports (`reported`). A decision the viewer recorded in Keystone
 * counts once recorded (it leaves "Awaiting my approval" and "Waiting for me", as in My approvals) while the status
 * waits for Vigie.
 */
async function ecos(): Promise<Eco[]> {
  const [rows, projects] = await Promise.all([listEcos(), listProjects()]);
  const short = new Map(projects.map((p) => [p.code, p.shortCode]));
  return rows.map((e) => ({
    id: e.number, type: e.type, status: e.statusLabel, reported: true, title: e.title, parts: e.parts,
    appr: Object.fromEntries(e.approvalsView.map((a) => [a.key, a.decision])) as Eco['appr'],
    projects: e.projects.map((c) => short.get(c) ?? c),
  }));
}

/** ECO type labels by code (ECO_TYPES 3430). */
const ECO_TYPE_LABELS: Record<string, string> = Object.fromEntries(ecoType.codes.map((c) => [c, ecoType.label(c)]));

/** The PDM vault mirror (DRAWINGS order). */
async function drawings(): Promise<Drawing[]> {
  return (await listDrawings()).map((d) => ({ no: d.number, title: d.title, rev: d.revision, state: d.stateLabel }));
}

/** Purchase orders of a project (genPOs order, then the drafts made in Keystone), with their own value. */
async function purchaseOrders(code: string): Promise<PurchaseOrder[]> {
  return (await listPurchaseOrders(code)).map((o) => ({
    id: o.number, supplier: o.supplier, status: o.statusLabel, lines: o.lines.map((l) => [l.ref, l.orderedQty, l.receivedQty]), act: o.neededFor?.code ?? null,
    valueEur: o.valueEur,
  }));
}

/** Resource requests in list order (REQUESTS order, new ones first), in the Home's shape. */
async function requests(): Promise<ResourceRequest[]> {
  return (await listResourceRequests()).map((r) => ({
    id: r.id, pm: r.requestedBy, project: r.projectShort, person: r.resource, dept: r.department, title: r.title, hours: r.hours,
    start: r.startDay ?? workingDayOf(r.start, 'up'), due: r.dueDay ?? workingDayOf(r.due, 'down'), status: r.status,
  }));
}

/** The resource pool (PEOPLE order) with its 8 weekly loads, each member's department, and the window's ISO Mondays. */
async function people(): Promise<{ loads: PersonLoad[]; deptOf: Record<string, string>; weekStarts: string[] }> {
  const pool = await getResourcePool();
  return {
    loads: pool.people.map((p) => ({ name: p.name, role: p.jobTitle ?? '', loads: p.loads })),
    deptOf: Object.fromEntries(pool.people.filter((p) => p.department).map((p) => [p.name, p.department!])),
    weekStarts: pool.weeks.map((w) => w.start),
  };
}

/**
 * Capacity vs demand over the current window (the Resources bars), for the unmet demand (A-12). R-084: demand from the
 * schedules, the trades outside the departments included (as on Resources).
 */
async function capacityRows() {
  return (await getCapacityDemand(await currentLoadWeeks())).map((d) => ({ name: d.name, capacityH: d.capacityH, demandH: d.demandH, kind: d.kind }));
}

/** Skill families (matrix columns), each pool member's levels, and their certifications text (CERTS). */
async function skillsMatrix() {
  const m = await getSkillsMatrix();
  return {
    skills: m.skills.map((s) => s.name),
    levels: Object.fromEntries(m.people.map((p) => [p.name, p.levels])),
    certs: Object.fromEntries(m.people.filter((p) => p.certText).map((p) => [p.name, p.certText!])),
  };
}

/** Every task (TODOS order, new tasks appended), in the Home's shape. */
async function todos(): Promise<Todo[]> {
  return (await listTasks()).map((t) => ({
    id: t.id, person: t.assignee, title: t.title, project: t.project.short, status: t.status,
    start: t.startDay ?? workingDayOf(t.start, 'up'), due: t.dueDay ?? workingDayOf(t.due, 'down'), logged: t.loggedH,
  }));
}

const currentOf = (p: ProjectRow): CurrentProject => ({ code: p.code, name: p.name, shortCode: p.shortCode });

/**
 * The project of the Home: the code when it exists (and, for a client, belongs to their organisation), else the current
 * project of the register (R-011); null when the viewer has no project.
 */
async function resolveProject(code: string | null, role: RoleKey, organisation?: string | null): Promise<ProjectRow | null> {
  const current = await resolveCurrentProject(code, { role, organisation });
  return current ? getProject(current) : null;
}

/**
 * The client's current project (P-10a): the last project used when it belongs to their organisation, else their first project
 * with data, else their first project; null when their organisation has none (never another organisation's project).
 */
async function resolveClientProject(code: string | null, organisation: string | null): Promise<ProjectRow | null> {
  const own = (await listProjects()).filter((p) => !clientRefusedProject({ role: 'client', organisation }, p));
  return own.find((p) => p.code === code) ?? own.find((p) => p.hasData) ?? own[0] ?? null;
}

async function evmAndSchedule(code: string): Promise<{ evm: EvmSeries | null; schedule: ScheduleHeader | null }> {
  const [cost, head, miles] = await Promise.all([getCostControl(code), getScheduleControl(code), getMilestones(code)]);
  const evm = cost ? { bac: cost.bac, pv: cost.pv, ev: cost.ev, ac: cost.ac } : null;
  const schedule = head
    ? {
        start: head.start, floatDays: head.floatDays, floatText: head.floatText, floatShort: head.floatShort, critText: head.critText, milesText: head.milesText,
        milestones: miles.map((m) => ({ name: m.name, baselineMonth: m.baselineMonth, forecastMonth: m.forecastMonth, statusLabel: m.statusLabel })),
      }
    : null;
  return { evm, schedule };
}

async function changeRequestsOf(projects: ProjectRow[]): Promise<ChangeRequest[]> {
  const names = (await lookups()).projectNames;
  const lists = await Promise.all(
    projects.map(async (p) =>
      (await listChangeRequests(p.code)).map((c) => ({
        code: p.code, projectName: names[p.shortCode] ?? p.name, id: c.id, title: c.title, amount: c.amount, days: c.days, date: c.date,
        status: c.status, chain: c.chain,
      })),
    ),
  );
  return lists.flat();
}

/** Department led by the viewer; the prototype default is Engineering. */
async function deptOfHead(name: string): Promise<string> {
  return (await listApprovalDepartments()).find((d) => d.head === name)?.name ?? 'Engineering';
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────────────────────

/** The Home of a role (docs/spec/03 §1.2). Roles without a dedicated Home get the director's, as the prototype. */
export async function getHomeView(q: HomeQuery): Promise<HomeView> {
  const { persona, lang } = q;
  // R-013: the business date, once for the whole Home (greeting, due buckets, "accepted in the last 30 days").
  const today = await businessToday();
  if (q.role === 'client') {
    const own = await resolveClientProject(q.projectCode, q.organisation ?? null);
    if (!own) return noProjectHome(persona, today);
    const [{ evm, schedule }, crs, { deliverables, invoice }] = await Promise.all([evmAndSchedule(own.code), changeRequestsOf([own]), clientInputs(own.code, today)]);
    return clientHome({ lang, persona, today, project: currentOf(own), evm, schedule, changeRequests: crs, deliverables, invoice });
  }
  switch (q.role) {
    case 'depthead': {
      const [dept, reqs, pool, departments] = await Promise.all([deptOfHead(persona.name), requests(), people(), capacityRows()]);
      return deptHeadHome({
        persona, today, dept, requests: reqs, people: pool.loads, deptOf: pool.deptOf, reqStatus: REQ_STATUS, lookups: await lookups(), weekStarts: pool.weekStarts, departments,
      });
    }
    case 'member': {
      // The viewer's own work: the prototype always showed `state.person` = Hélène Sauvage (docs/spec/00 §7.16, 10 OQ17).
      const [tasks, pool, sk] = await Promise.all([todos(), people(), skillsMatrix()]);
      return memberHome({
        persona, today, person: persona.name, todos: tasks, people: pool.loads, certs: sk.certs, statusLabels: TASK_STATUS, lookups: await lookups(),
        loggedThisWeekH: await loggedThisWeek(persona.name, today), // A-12: this week's time entries
      });
    }
    case 'englead': {
      const [pool, sk, es, dwgs, ps] = await Promise.all([people(), skillsMatrix(), ecos(), drawings(), parts()]);
      return engLeadHome({
        persona, today, ecos: es, ecoTypes: ECO_TYPE_LABELS, drawings: dwgs, parts: ps, skills: sk.skills, skillLevels: sk.levels, people: pool.loads,
      });
    }
  }
  // The other Homes are built around the current project; a new production database has none yet (R-011).
  const project = await resolveProject(q.projectCode, q.role, q.organisation);
  if (!project) return noProjectHome(persona, today);
  const current = currentOf(project);
  switch (q.role) {
    case 'pm': {
      const [{ evm, schedule }, reqs, pos, ps, es] = await Promise.all([evmAndSchedule(project.code), requests(), purchaseOrders(project.code), parts(), ecos()]);
      return pmHome({ lang, persona, today, project: current, evm, schedule, requests: reqs, purchaseOrders: pos, parts: ps, ecos: es });
    }
    case 'quality': {
      const [es, ps, reqs] = await Promise.all([ecos(), parts(), requests()]);
      return qualityHome({ persona, today, project: current, ecos: es, parts: ps, requests: reqs });
    }
    case 'procurement': {
      const [acts, pos, ps, es] = await Promise.all([getActivities(project.code), purchaseOrders(project.code), parts(), ecos()]);
      return procurementHome({
        lang, persona, today, project: current, purchaseOrders: pos, parts: ps, ecos: es,
        activityPct: Object.fromEntries(acts.map((a) => [a.id, a.pct])),
      });
    }
    default: {
      // KPI tiles and "Needs attention" are the Portfolio overview's own (same zone filter, docs/spec/03 §1.2 / §4).
      const [overview, all, pos, es, reqs] = await Promise.all([getPortfolioOverview(q.zone, lang), listProjects(), purchaseOrders(project.code), ecos(), requests()]);
      return directorHome({
        lang, persona, today, project: current,
        portfolioKpis: overview.kpis,
        alerts: overview.alerts.map((a): PortfolioAlert => ({ title: a.title, detail: a.detail, href: homeHref(a.target.screen, { code: a.target.code }) })),
        // A-3: change requests of the projects in execution (the Overview's population).
        changeRequests: await changeRequestsOf(all.filter(inExecution)),
        purchaseOrders: pos,
        ecos: es,
        requests: reqs,
      });
    }
  }
}
