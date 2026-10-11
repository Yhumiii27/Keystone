import 'server-only';
// Shell DAL — navigation badges, breadcrumb extras, notifications, global search and zone bar
// (docs/spec/01 §4.3–4.4, §5.1, §5.4, §5.5, §7.2).
// From the database: projects, tasks (My tasks badge, task title), resource requests and departments (Resource
// requests / Approvals badges and crumb), risks and change requests (badges, search), the resource pool (search),
// notifications with their per-user read state, the My approvals count (the myapprovals provider registry) and,
// since Delivery 3, the Codex index (Documents badge), meetings, interfaces and contracts (Meetings, Interfaces and
// Billing badges; Contract / Billing crumbs) and project sites (Projects map crumb); since Delivery 4, purchase orders
// (Purchase orders badge, search), goods receipts (Deliveries badge), supplier invoices (Sourcing & invoices badge),
// stock positions (Stock & storages badge), the parts catalogue (search), the Vigie ECO mirror (Change orders badge,
// search) and the PDM vault mirror (search); since Delivery 5, the engineering checks (Engineering badges), the P&ID
// tags (P&ID badge), the Vigie NCR mirror (Quality badge, NCR search), the ITP punch list (Inspections badge), the site
// sheet with Cursus's Go / No Go and Vigie's HSE mirror (Site badge), warranty claims (Warranty claims badge), the
// connectors (Activity & integrations badge) and the installed base (zone bar of Installed base / Warranty claims).
// Only reference constants (zones, city → country → zone) are still read from the prototype data set.
import { and, eq, sql } from 'drizzle-orm';
import { personaOf, type Persona, type PersonaRef } from '@/config/personas';
import { DEFAULT_PROJECT, canSee, screenHref, type RoleKey, type ScreenId } from '@/config/screens';
import { defaultDepartment } from '@/domain/requests';
import { clientRefusedProject, clientSeesTarget } from '@/domain/rights';
import { dueTodayBadge, workingDayOf } from '@/domain/tasks';
import { mapCrumbExtra } from '@/domain/worldmap';
import { approvalCountsByProject } from '@/server/approvals';
import { getDb } from '@/server/db/client';
import { changeRequests, projects as projectsTable } from '@/server/db/schema';
import { ncrHref } from '@/features/quality/links';
import { PROTO } from '@/server/prototype';
import type { ZoneKey } from '@/server/session';
import type { Badges } from '@/components/app/shell/nav-model';
import { listChangeRequestDetails } from './changes';
import { savNavBadge } from './claims';
import { getContractHeader, lateBillingMilestonesByProject } from './contract';
import { receiptsQcPendingByProject } from './deliveries';
import { docsBadge } from './docs-badge';
import { listDrawings } from './drawings';
import { listEcos } from './eco';
import { ecoNavBadge } from './eco-screen';
import { engNavBadgesByProject } from './eng-screen';
import { machinesByZone } from './fleet';
import { getProjectsMap } from './geo';
import { plumbingNavBadge } from './integrations';
import { lateInterfacesByProject } from './interfaces';
import { openPunchAByProject } from './itp';
import { meetingsToWriteByProject } from './meetings';
import { listNotifications } from './notifications';
import { listParts } from './parts';
import { pidBadgeByProject } from './pid';
import { getActivities } from './planning';
import { listProjects, projectLabel, type ProjectRow } from './projects';
import { countInvoicesToResolve, listPurchaseOrders, posAwaitingApprovalByProject } from './purchasing';
import { criticalOpenNcrsByProject, listNcrs } from './quality';
import { listApprovalDepartments, listResourceRequests } from './requests';
import { departmentOfPerson } from './requests-screens';
import { getResourcePool } from './resources';
import { listRisks } from './risks';
import { riskBadges } from './risks-badge';
import { siteBadgeByProject } from './site';
import { stockNavBadge } from './stock';
import { getTask, listTasks } from './tasks';
import type { UserRef } from './users';

const n2s = (n: number) => (n ? String(n) : '');
const count = <T,>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;

// ── Zones (ZONES line 3170, zoneOf line 3173) ──────────────────────────────
export interface ZoneDef { key: ZoneKey; label: string; manager: string }
export const ZONES: ZoneDef[] = (PROTO.ZONES as [ZoneKey, string, string][]).map(([key, label, manager]) => ({ key, label, manager }));
export const zoneLabel = (z: ZoneKey | null) => (z ? ZONES.find((x) => x.key === z)?.label ?? '' : '');

/** The viewer sees every resource request (director, or Resource requests outside their workspace), else the ones they sent. */
const seesAllRequests = (role: RoleKey) => role === 'director' || !canSee(role, 'requests');

/** Department whose Approvals queue the viewer gets by default: the one they head or belong to, else Engineering. */
async function approvalsDeptOf(who: PersonaRef) {
  const viewer = personaOf(who);
  const [depts, own] = await Promise.all([listApprovalDepartments(), departmentOfPerson(viewer.name)]);
  const name = defaultDepartment(depts, { name: viewer.name, department: own ?? viewer.department });
  return depts.find((d) => d.name === name) ?? null;
}

/** Badges that do not depend on the current project. */
async function globalBadges(viewer: Persona): Promise<Badges> {
  const role = viewer.role;
  const [mine, rescheduled, dept, docs, eco, invoices, stock, sav, plumbing] = await Promise.all([
    listTasks({ person: viewer.name }),
    listResourceRequests({ status: 'reschedule', ...(seesAllRequests(role) ? {} : { requestedBy: viewer.short }) }),
    approvalsDeptOf(viewer),
    docsBadge(),
    safe(ecoNavBadge, ''),
    countInvoicesToResolve(),
    stockNavBadge(),
    savNavBadge(),
    safe(plumbingNavBadge, ''),
  ]);
  return {
    // My tasks: the viewer's open tasks due today (line 5106; the prototype counted Hélène Sauvage's for everyone, 00 §7.16).
    mywork: dueTodayBadge(
      mine.map((t) => ({
        status: t.status, priority: t.priority, start: t.startDay ?? workingDayOf(t.start, 'up'), due: t.dueDay ?? workingDayOf(t.due, 'down'),
        estimateH: t.estimateH, loggedH: t.loggedH,
      })),
    ),
    // Codex records awaiting approval ("Release proposed"), all projects (logic 5150).
    docs,
    // ECOs in approval in Vigie (the Vigie mirror, src/server/dal/eco-screen.ts).
    eco,
    // Supplier invoices blocked by the 3-way match or without PO, all projects (logic 5148).
    procurement: n2s(invoices),
    // Stock lines below their minimum (logic 5150).
    stock,
    // Open Major / Critical warranty claims, every zone (logic 5148).
    sav,
    // Reschedules proposed on the requests the viewer sees on Resource requests (the prototype: R. Aubert's, 08 OQ18).
    requests: n2s(rescheduled.length),
    // Pending requests of the viewer's Approvals department (the prototype: Engineering).
    approvals: n2s(dept?.pending ?? 0),
    // A connector in warning or error (Vigie, Codex and Cursus report their live state).
    plumbing,
  };
}

/** Change requests in review per project code (Change control badge, logic 5147). */
async function changesInReview(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db
    .select({ code: projectsTable.code, n: sql<number>`count(*)::int` })
    .from(changeRequests)
    .innerJoin(projectsTable, eq(projectsTable.id, changeRequests.projectId))
    .where(and(eq(changeRequests.status, 'in_review')))
    .groupBy(projectsTable.code);
  return Object.fromEntries(rows.map((r) => [r.code, r.n]));
}

/** Project-dependent inputs read from the database once for every project. */
interface ProjectBadgeInputs {
  approvals: Record<string, number>;
  risks: Record<string, string>;
  changes: Record<string, number>;
  /** Meetings with notes in progress (`mtgBadge`, logic 4867). */
  meetings: Record<string, number>;
  /** Late interfaces: open and needed before the prototype's now (`ifcBadge`, logic 4957). */
  interfaces: Record<string, number>;
  /** Late planned contract milestones (`ctrBadge`, logic 4888). */
  billing: Record<string, number>;
  /** Goods receipts waiting for their quality check (Deliveries badge, logic 5147). */
  deliveries: Record<string, number>;
  /** Purchase orders awaiting approval (Purchase orders badge, logic 5147). */
  orders: Record<string, number>;
  /** Open blocking engineering checks: Synthesis = all, each discipline = its own (`engNav_` 4815). */
  eng: Record<string, Partial<Record<ScreenId, string>>>;
  /** Keystone-scope P&ID tags not linked while the coverage is below 100 % (logic 4766–4775). */
  pid: Record<string, number>;
  /** Open critical NCRs of the Vigie mirror (`qBadge`). */
  quality: Record<string, number>;
  /** Open category-A items of the ITP punch list (`itpBadge`). */
  itp: Record<string, number>;
  /** "NO GO" while Go chantier is not reached (`goOk`, logic 4748). */
  site: Record<string, string>;
  /** Projects with data (prototype `projectData`): their module entries carry an explicit '' when there is nothing. */
  withData: Set<string>;
}

async function projectBadgeInputs(who: PersonaRef, codes: string[]): Promise<ProjectBadgeInputs> {
  const [approvals, risks, changes, meetings, interfaces, billing, deliveries, orders, eng, pid, quality, itp, site, projects] = await Promise.all([
    approvalCountsByProject(personaOf(who), codes), riskBadges(), changesInReview(),
    meetingsToWriteByProject(), lateInterfacesByProject(), lateBillingMilestonesByProject(), receiptsQcPendingByProject(),
    posAwaitingApprovalByProject(), engNavBadgesByProject(), pidBadgeByProject(), safe(criticalOpenNcrsByProject, {}), openPunchAByProject(),
    safe(siteBadgeByProject, {}), listProjects(),
  ]);
  const withData = new Set(projects.filter((p) => p.hasData).map((p) => p.code));
  return { approvals, risks, changes, meetings, interfaces, billing, deliveries, orders, eng, pid, quality, itp, site, withData };
}

function badgesOf(code: string, inp: ProjectBadgeInputs): Badges {
  const b: Badges = { myapprovals: n2s(inp.approvals[code] ?? 0) };
  // Every module is in the database: badges follow their rows on every project (none on a project without data).
  if (inp.risks[code]) b.risks = inp.risks[code];
  if (inp.changes[code]) b.changes = n2s(inp.changes[code]);
  if (inp.meetings[code]) b.meetings = n2s(inp.meetings[code]);
  if (inp.interfaces[code]) b.interfaces = n2s(inp.interfaces[code]);
  if (inp.billing[code]) b.billing = n2s(inp.billing[code]);
  if (inp.deliveries[code]) b.deliveries = n2s(inp.deliveries[code]);
  if (inp.orders[code]) b.orders = n2s(inp.orders[code]);
  for (const [id, v] of Object.entries(inp.eng[code] ?? {})) if (v) b[id as ScreenId] = v;
  if (inp.pid[code]) b.pid = n2s(inp.pid[code]);
  if (inp.quality[code]) b.quality = n2s(inp.quality[code]);
  if (inp.itp[code]) b.itp = n2s(inp.itp[code]);
  if (inp.site[code]) b.site = inp.site[code];
  if (inp.withData.has(code)) for (const id of WITH_DATA_ENTRIES) b[id] ??= '';
  return b;
}

/** Project entries that always carry a badge value ('' = none) on a project with data, as in the prototype. */
const WITH_DATA_ENTRIES: ScreenId[] = ['meetings', 'interfaces', 'billing', 'itp', 'risks', 'changes', 'quality', 'orders', 'deliveries'];

/** Badges of the project-dependent entries (Project section, orders, deliveries, My approvals) of one project. */
export async function projectBadges(who: PersonaRef, code: string): Promise<Badges> {
  return badgesOf(code, await projectBadgeInputs(who, [code]));
}

// ── Sidebar data ──────────────────────────────────────────────────────────
export interface ShellProject { code: string; label: string; hasData: boolean }
export interface ShellNavData {
  /** Every project (EN label "#026 · Harbor Line Terminal Expansion"). */
  projects: ShellProject[];
  globalBadges: Badges;
  /** Project-dependent badges per project code (all projects). */
  projectBadges: Record<string, Badges>;
}

/**
 * Everything the sidebar needs, for the viewer (computed for every project; the client picks the current one). A role
 * stands for its demo persona (tests).
 */
export async function getShellNav(who: PersonaRef): Promise<ShellNavData> {
  const viewer = personaOf(who);
  // R-042 (P-10a): a client's sidebar and project switcher list their organisation's projects only.
  const projects = (await listProjects()).filter((p) => !clientRefusedProject(viewer, p));
  const codes = projects.map((p) => p.code);
  const [global, inputs] = await Promise.all([globalBadges(viewer), projectBadgeInputs(viewer, codes)]);
  return {
    projects: projects.map((p) => ({ code: p.code, label: projectLabel(p), hasData: p.hasData })),
    globalBadges: global,
    projectBadges: Object.fromEntries(codes.map((code) => [code, badgesOf(code, inputs)])),
  };
}

// ── Breadcrumb extras (CRUMB_EXTRA, line 5162) ────────────────────────────
const inZone = (p: ProjectRow, z: ZoneKey | null) => !z || p.zone === z;

/** Default `CRUMB_EXTRA[screen]` (EN), '' when none. Screens may override it (PageHeader `crumbExtra`). */
export async function crumbExtraOf(screen: ScreenId, ctx: { role: PersonaRef; code: string; zone: ZoneKey | null; taskId?: string }): Promise<string> {
  const viewer = personaOf(ctx.role);
  const zl = zoneLabel(ctx.zone);
  const zoneCrumb = zl ? ' · ' + zl : '';
  switch (screen) {
    case 'fleet':
    case 'sav':
      return zl;
    case 'contract':
      return (await getContractHeader(ctx.code))?.reference ?? '';
    case 'billing':
      return (await getContractHeader(ctx.code))?.paymentTerms ?? '';
    case 'worldmap':
      // Zone projects with a located site (the Projects map page passes the same value).
      return mapCrumbExtra((await getProjectsMap(ctx.zone)).points.length, zl || null);
    case 'projects': {
      const zp = (await listProjects()).filter((p) => inZone(p, ctx.zone));
      return 'FY2026 · ' + zp.length + ' projects' + zoneCrumb;
    }
    case 'overview':
    case 'portfolio':
    case 'pfplan':
    case 'cash':
      return 'FY2026' + zoneCrumb;
    case 'myprojects':
      return viewer.title;
    case 'approvals': {
      // Head of the viewer's default department (the Approvals page passes its selected department's head).
      const d = await approvalsDeptOf(viewer);
      return d?.head ? `${d.head} · ${d.headTitle ?? ''}` : '';
    }
    case 'requests': {
      // Whose outbox Resource requests shows (the prototype: always "R. Aubert, project manager", 08 OQ18).
      if (seesAllRequests(viewer.role)) return 'all project managers';
      return `${viewer.short}, ${viewer.title.charAt(0).toLowerCase()}${viewer.title.slice(1)}`;
    }
    case 'mywork':
      // The viewer (the prototype always showed Hélène Sauvage, docs/spec/00 §7.16, 10 OQ17).
      return viewer.name;
    case 'task':
      return ctx.taskId ?? 'T-2314';
    default:
      return STATIC_EXTRA[screen] ?? '';
  }
}

/**
 * Default page title (`titles[screen]`, line 5109) when it is not the registry title: Approvals carries the selected
 * department ("Approvals — Engineering"), Task the task title. EN source; null = registry title.
 */
export async function defaultTitleOf(screen: ScreenId, ctx: { taskId?: string; role?: PersonaRef } = {}): Promise<string | null> {
  if (screen === 'approvals') return 'Approvals — ' + ((ctx.role ? (await approvalsDeptOf(ctx.role))?.name : null) ?? 'Engineering');
  if (screen === 'task') {
    const task = await getTask(ctx.taskId ?? 'T-2314');
    return task ? task.title : null;
  }
  return null;
}

const STATIC_EXTRA: Partial<Record<ScreenId, string>> = {
  stock: 'Sage X3 + local',
  leave: 'Lucca',
  drawings: 'SolidWorks PDM',
  plumbing: 'all projects',
  procurement: 'all projects',
  resources: 'all projects',
  plm: 'all projects',
  eco: 'all projects',
  client: 'read-only except decisions and issues',
  doctypes: 'one circuit and one retention rule per type',
  mtypes: 'one template per product range · planning, costs, ITP, REX',
  myapprovals: 'one queue for every decision assigned to me',
  docs: 'numbered, tagged, versioned',
  trends: 'weekly snapshots',
  quality: 'ISO 9001',
  risks: '5×5 + EMV',
  site: 'international site',
};

// ── Deep links (prototype state patch → URL, docs/spec/00 §8.3) ──────────
const PARAM: Record<string, string | null> = { sel: 'act', selOpen: null, qTab: 'tab', pTab: 'tab', deliv: 'receipt' };

/** URL of a screen with the prototype's extra state (`{cr:'CR-008'}` → `?cr=CR-008`). */
export function deepLink(screen: ScreenId, extra: Record<string, unknown> = {}, code: string = DEFAULT_PROJECT): string {
  const qs = new URLSearchParams();
  // View params (tab, view) first, then the selection: stable URLs whatever the stored key order (jsonb sorts keys).
  const entries = Object.entries(extra).map(([k, v]) => [k in PARAM ? PARAM[k] : k, v] as const);
  const rank = (key: string | null) => (key === 'tab' || key === 'view' ? 0 : 1);
  for (const [key, v] of entries.sort((a, b) => rank(a[0]) - rank(b[0]))) {
    if (key && v != null && v !== false) qs.set(key, String(v));
  }
  const s = qs.toString();
  return screenHref(screen, { code }) + (s ? '?' + s : '');
}

// ── Notifications (NOTIFS line 3545, logic 4706) ──────────────────────────
export type NotifKind = 'approval' | 'alert' | 'quality' | 'delivery' | 'eco' | 'mention' | 'request' | 'invoice' | 'task' | 'sync';
export interface ShellNotification {
  id: string;
  kind: NotifKind;
  /** EN source strings. */
  title: string;
  sub: string;
  when: string;
  /** Read by the viewer (per-user read state in the database). */
  read: boolean;
  href: string;
}

/**
 * Notifications delivered to the viewer (or the demo user of a role), bell order, with their read state. A client only gets
 * those about their organisation's projects and their workspace, never about NCRs or purchasing (R-042, R-043: P-1, P-10a,
 * P-10b) — a role audience reaches every client user, whatever their organisation.
 */
export async function notificationsFor(who: UserRef): Promise<ShellNotification[]> {
  let rows = await listNotifications(who);
  const viewer = typeof who === 'string' ? personaOf(who as RoleKey) : (who as Persona);
  if (viewer.role === 'client') {
    const projects = await listProjects();
    const own = (code: string | null) => {
      const p = projects.find((x) => x.code === (code ?? DEFAULT_PROJECT));
      return !!p && !clientRefusedProject(viewer, p);
    };
    rows = rows.filter((n) => clientSeesTarget(n.screen, n.params, own(n.projectCode)));
  }
  return rows.map((n) => ({
    id: n.id, kind: n.kind as NotifKind, title: n.title, sub: n.sub, when: n.when, read: n.read,
    // Portfolio-wide notifications (no project) target global screens; the default project is only a fallback.
    href: deepLink(n.screen as ScreenId, n.params, n.projectCode ?? DEFAULT_PROJECT),
  }));
}

// ── Global search (`searchHits`, line 4695) ───────────────────────────────
export interface SearchHit {
  /** EN source strings. */
  kind: string;
  title: string;
  sub: string;
  href: string;
}

/** Resolves a DAL read, or `fallback` when the database is unavailable (search must never throw). */
async function safe<T>(p: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await p();
  } catch {
    return fallback;
  }
}

/**
 * Global search hits (≥ 2 characters). Projects come from the projects DAL; project-specific kinds
 * (purchase orders, change requests, NCRs, risks) cover the current project, as in the prototype.
 */
export async function searchShell(query: string, currentCode: string, who: PersonaRef = 'director'): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const viewer = personaOf(who);
  if (viewer.role === 'client') return searchShellClient(q, currentCode, viewer);
  const has = (s: string) => s.toLowerCase().includes(q);
  const code = currentCode;
  const hits: SearchHit[] = [];
  const add = (xs: SearchHit[], max: number) => hits.push(...xs.slice(0, max));

  const projects = await listProjects();
  add(projects.filter((p) => has(p.name + ' ' + p.code)).map((p) => ({ kind: 'Project', title: p.name, sub: `${p.code} · ${p.status} · ${p.pm}`, href: screenHref('plan', { code: p.code }) })), 4);
  // Activities of every project with data (ALL_BYID), from the planning DAL.
  const acts = await Promise.all(projects.filter((p) => p.hasData).map(async (p) => (await safe(() => getActivities(p.code), [])).map((a) => ({ a, code: p.code }))));
  const sfx = (s: string, actual: boolean) => s + (actual ? ' A' : '');
  add(acts.flat().filter(({ a }) => has(a.id + ' ' + a.name)).map(({ a, code: c }) => ({ kind: 'Activity', title: `${a.id} · ${a.name}`, sub: `${sfx(a.start, a.startActual)} → ${sfx(a.finish, a.finishActual)}`, href: deepLink('plan', { sel: a.id }, c) })), 4);
  // Parts: the PLM catalogue (parts created in Keystone included).
  const parts = await safe(listParts, []);
  add(parts.filter((p) => has(p.ref + ' ' + p.name + ' ' + (p.manufacturer ?? ''))).map((p) => ({ kind: 'Part', title: `${p.ref} · ${p.name}`, sub: `${p.manufacturer ?? '—'} · ${p.statusLabel}`, href: deepLink('plm', { part: p.ref }) })), 4);
  // People: the resource pool listed on Resources (pool order) — the hit opens that screen, so people outside the
  // pool (personas, client contacts) would land on a page that does not show them.
  const pool = (await safe(getResourcePool, { weeks: [], people: [] })).people;
  add(pool.filter((p) => has(p.name)).map((p) => ({ kind: 'Person', title: p.name, sub: p.jobTitle ?? '', href: screenHref('resources') })), 3);
  const [crs, risks, pos] = await Promise.all([safe(() => listChangeRequestDetails(code), []), safe(() => listRisks(code), []), safe(() => listPurchaseOrders(code), [])]);
  // Purchase orders of the current project (drafts made in Keystone included).
  add(pos.filter((o) => has(o.number + ' ' + o.supplier)).map((o) => ({ kind: 'Purchase order', title: `${o.number} · ${o.supplier}`, sub: o.statusLabel, href: deepLink('orders', { po: o.number }, code) })), 3);
  // ECOs: the Vigie mirror (status as Vigie reports it).
  const ecos = await safe(() => listEcos(), []);
  add(ecos.filter((e) => has(e.number + ' ' + e.title)).map((e) => ({ kind: 'ECO', title: `${e.number} · ${e.title}`, sub: e.statusLabel, href: deepLink('eco', { eco: e.number }) })), 3);
  add(crs.filter((c) => has(c.id + ' ' + c.title)).map((c) => ({ kind: 'Change request', title: `${c.id} · ${c.title}`, sub: c.statusLabel, href: deepLink('changes', { cr: c.id }, code) })), 3);
  // NCRs of the current project: the Vigie mirror (severity and status as Vigie reports them).
  const ncrs = await safe(() => listNcrs(code), []);
  add(ncrs.filter((n) => has(n.number + ' ' + n.title)).map((n) => ({ kind: 'NCR', title: `${n.number} · ${n.title}`, sub: `${n.severityLabel} · ${n.statusLabel}`, href: ncrHref(code, n.number) })), 3);
  add(risks.filter((r) => has(r.id + ' ' + r.title)).map((r) => ({ kind: 'Risk', title: `${r.id} · ${r.title}`, sub: r.categoryLabel, href: deepLink('risks', { risk: r.id }, code) })), 3);
  // Drawings: the PDM vault mirror.
  const drawings = await safe(() => listDrawings(), []);
  add(drawings.filter((d) => has(d.number + ' ' + d.title)).map((d) => ({ kind: 'Drawing', title: `${d.number} · ${d.title}`, sub: `rev ${d.revision} · ${d.stateLabel}`, href: deepLink('drawings', { dwg: d.number }) })), 3);
  return hits;
}

/**
 * The client's search (R-042, R-043: P-1, P-10a, P-10b): their organisation's projects (opening their portal) and the change
 * requests of the current project when it is theirs — nothing outside their workspace (plan, parts, people, ECOs, risks,
 * drawings), no purchase order, no NCR.
 */
async function searchShellClient(q: string, currentCode: string, viewer: Persona): Promise<SearchHit[]> {
  const has = (s: string) => s.toLowerCase().includes(q);
  const own = (await listProjects()).filter((p) => !clientRefusedProject(viewer, p));
  const hits: SearchHit[] = own
    .filter((p) => has(p.name + ' ' + p.code))
    .slice(0, 4)
    .map((p) => ({ kind: 'Project', title: p.name, sub: `${p.code} · ${p.status} · ${p.pm}`, href: screenHref('client', { code: p.code }) }));
  if (own.some((p) => p.code === currentCode)) {
    const crs = await safe(() => listChangeRequestDetails(currentCode), []);
    hits.push(...crs.filter((c) => has(c.id + ' ' + c.title)).slice(0, 3).map((c) => ({ kind: 'Change request', title: `${c.id} · ${c.title}`, sub: c.statusLabel, href: deepLink('changes', { cr: c.id }, currentCode) })));
  }
  return hits;
}

// ── Zone bar (line 4995, 5211) ────────────────────────────────────────────
export interface ZoneBarModel {
  /** EN labels; `key` null = "All zones". */
  options: { key: ZoneKey | null; label: string; count: number }[];
  ownerLabel: string;
  ownerName: string;
}

/** Zone segmented control counts: portfolio projects per zone, or installed machines for fleet/sav. */
export async function zoneBarOf(screen: ScreenId, zone: ZoneKey | null): Promise<ZoneBarModel> {
  const sav = screen === 'fleet' || screen === 'sav';
  let zoneOf: (key: ZoneKey) => number;
  let total: number;
  if (sav) {
    // The installed base (machines added in Keystone included), zone stored per machine.
    const m = await machinesByZone();
    zoneOf = (key) => m.byZone[key] ?? 0;
    total = m.total;
  } else {
    const projects = await listProjects();
    zoneOf = (key) => count(projects, (p) => p.zone === key);
    total = projects.length;
  }
  const cur = ZONES.find((z) => z.key === zone);
  return {
    options: [{ key: null, label: 'All zones', count: total }, ...ZONES.map((z) => ({ key: z.key, label: z.label, count: zoneOf(z.key) }))],
    ownerLabel: cur ? 'Zone manager' : 'Zone managers',
    // "O. Castel · A. Diallo · S. Nguyen" when no zone is selected.
    ownerName: cur ? cur.manager : ZONES.map((z) => z.manager.split(' ').map((w, i, a) => (i < a.length - 1 ? w[0] + '.' : w)).join(' ')).join(' · '),
  };
}
