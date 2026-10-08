import 'server-only';
// Home DAL (docs/spec/03 §1): gathers each role's inputs and builds the HomeView (src/domain/home.ts).
// Projects, EVM series, schedule header, milestones, change requests, activities, resource requests, the resource
// pool's weekly loads, tasks, the skills matrix and certifications come from the database. The director's KPI tiles
// and "Needs attention" items are the Portfolio overview's (src/server/dal/portfolio.ts). Since Delivery 4, the parts
// catalogue, the purchase orders (and so the BOM shortfall), the drawings (PDM vault mirror) and the ECOs (Vigie
// mirror, src/server/integrations/vigie) come from the database too.
// TODO(db): client deliverables and the client's next invoice are read from the prototype data set (PROTO) at its
// initial state; switch each block to its module DAL once modelled.
import { DEFAULT_PROJECT, type RoleKey } from '@/config/screens';
import {
  clientHome, deptHeadHome, directorHome, engLeadHome, homeHref, memberHome, pmHome, procurementHome, qualityHome,
  type ChangeRequest, type ClientDeliverable, type CurrentProject, type Drawing, type Eco, type EvmSeries, type HomeView,
  type Lookups, type Part, type Persona, type PersonLoad, type PortfolioAlert, type PurchaseOrder, type ResourceRequest,
  type ScheduleHeader, type Todo,
} from '@/domain/home';
import { workingDayOf } from '@/domain/tasks';
import type { Lang } from '@/i18n/translate';
import { ecoType } from '@/server/db/codes';
import { PROTO } from '@/server/prototype';
import type { ZoneKey } from '@/server/session';
import { getCostControl, listChangeRequests } from './cost';
import { listDrawings } from './drawings';
import { listEcos } from './eco';
import { listParts } from './parts';
import { getActivities, getMilestones, getScheduleControl } from './planning';
import { getPortfolioOverview } from './portfolio';
import { getSkillsMatrix } from './hr';
import { getProject, listProjects, type ProjectRow } from './projects';
import { listPurchaseOrders } from './purchasing';
import { listApprovalDepartments, listResourceRequests } from './requests';
import { getResourcePool } from './resources';
import { listTasks } from './tasks';

export interface HomeQuery {
  role: RoleKey;
  persona: Persona;
  /** Current project (last project used); unknown codes fall back to the default project. */
  projectCode: string;
  /** Portfolio zone filter (shared with the Portfolio screens): director KPIs and alerts follow it. */
  zone: ZoneKey | null;
  lang: Lang;
}

// ── Prototype-backed modules (TODO(db)) ───────────────────────────────────────────────────────────────────

const lookups = (): Lookups => ({ projectNames: PROTO.PROJ_NAMES });

/** Client deliverables of the Home (DELIVERABLES 3424, Harbor Line). TODO(db): read the deliverables register once modelled. */
function clientDeliverables(code: string): ClientDeliverable[] {
  if (code !== 'HLT-026') return [];
  return (PROTO.DELIVERABLES as [string, string, string, string, string][]).map(([id, title, type, status, note]) => ({ id, title, type, status, note }));
}

/** Next client invoice (static in the prototype, line 4432). TODO(db): next invoiced milestone from the billing plan. */
const clientInvoice = (code: string) => (code === 'HLT-026' ? { label: 'Milestone 4 invoice', amount: 640, due: '15 Oct' } : null);

// ── Database-backed inputs ────────────────────────────────────────────────────────────────────────────────

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

/** The resource pool (PEOPLE order) with its 8 weekly loads, and each member's department. */
async function people(): Promise<{ loads: PersonLoad[]; deptOf: Record<string, string> }> {
  const pool = (await getResourcePool()).people;
  return {
    loads: pool.map((p) => ({ name: p.name, role: p.jobTitle ?? '', loads: p.loads })),
    deptOf: Object.fromEntries(pool.filter((p) => p.department).map((p) => [p.name, p.department!])),
  };
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

async function resolveProject(code: string): Promise<ProjectRow> {
  const p = (await getProject(code)) ?? (await getProject(DEFAULT_PROJECT));
  if (!p) throw new Error('No project in the database');
  return p;
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
  const names = lookups().projectNames;
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
  const project = await resolveProject(q.projectCode);
  const current = currentOf(project);
  switch (q.role) {
    case 'pm': {
      const [{ evm, schedule }, reqs, pos, ps, es] = await Promise.all([evmAndSchedule(project.code), requests(), purchaseOrders(project.code), parts(), ecos()]);
      return pmHome({ lang, persona, project: current, evm, schedule, requests: reqs, purchaseOrders: pos, parts: ps, ecos: es });
    }
    case 'depthead': {
      const [dept, reqs, pool] = await Promise.all([deptOfHead(persona.name), requests(), people()]);
      return deptHeadHome({ persona, dept, requests: reqs, people: pool.loads, deptOf: pool.deptOf, reqStatus: PROTO.REQ_STATUS, lookups: lookups() });
    }
    case 'member': {
      // The viewer's own work: the prototype always showed `state.person` = Hélène Sauvage (docs/spec/00 §7.16, 10 OQ17).
      const [tasks, pool, sk] = await Promise.all([todos(), people(), skillsMatrix()]);
      return memberHome({ persona, person: persona.name, todos: tasks, people: pool.loads, certs: sk.certs, statusLabels: PROTO.STATUS_L, lookups: lookups() });
    }
    case 'englead': {
      const [pool, sk, es, dwgs, ps] = await Promise.all([people(), skillsMatrix(), ecos(), drawings(), parts()]);
      return engLeadHome({
        persona, ecos: es, ecoTypes: ECO_TYPE_LABELS, drawings: dwgs, parts: ps, skills: sk.skills, skillLevels: sk.levels, people: pool.loads,
      });
    }
    case 'quality': {
      const [es, ps, reqs] = await Promise.all([ecos(), parts(), requests()]);
      return qualityHome({ persona, project: current, ecos: es, parts: ps, requests: reqs });
    }
    case 'procurement': {
      const [acts, pos, ps, es] = await Promise.all([getActivities(project.code), purchaseOrders(project.code), parts(), ecos()]);
      return procurementHome({
        lang, persona, project: current, purchaseOrders: pos, parts: ps, ecos: es,
        activityPct: Object.fromEntries(acts.map((a) => [a.id, a.pct])),
      });
    }
    case 'client': {
      const [{ evm, schedule }, crs] = await Promise.all([evmAndSchedule(project.code), changeRequestsOf([project])]);
      return clientHome({
        lang, persona, project: current, evm, schedule, changeRequests: crs, deliverables: clientDeliverables(project.code), invoice: clientInvoice(project.code),
      });
    }
    default: {
      // KPI tiles and "Needs attention" are the Portfolio overview's own (same zone filter, docs/spec/03 §1.2 / §4).
      const [overview, all, pos, es, reqs] = await Promise.all([getPortfolioOverview(q.zone, lang), listProjects(), purchaseOrders(project.code), ecos(), requests()]);
      return directorHome({
        lang, persona, project: current,
        portfolioKpis: overview.kpis,
        alerts: overview.alerts.map((a): PortfolioAlert => ({ title: a.title, detail: a.detail, href: homeHref(a.target.screen, { code: a.target.code }) })),
        changeRequests: await changeRequestsOf(all.filter((p) => p.hasData)),
        purchaseOrders: pos,
        ecos: es,
        requests: reqs,
      });
    }
  }
}
