// Screen registry — single source of truth for routes, navigation, titles and role access.
// Derived from docs/spec/01 §3–§4, §15 and docs/spec/00 §4 (proposed routes).
// Labels are English source strings; render them through t() (FR via the prototype dictionary).
import type { Icon } from '@phosphor-icons/react';
import {
  ArrowsLeftRight, Blueprint, Books, Buildings, CalendarCheck, CalendarDots, Certificate, ChartBarHorizontal,
  ChartLine, ChartLineUp, ChatsCircle, CheckSquare, ClipboardText, ClockCountdown, Coins, Cpu, CraneTower, Cube,
  CurrencyEur, Database, FileText, FlowArrow, FolderUser, Folders, Gear, GearSix, GitBranch, GitPullRequest,
  GlobeHemisphereWest, GraduationCap, Handshake, HardHat, House, Key, Lightning, ListChecks, PaperPlaneTilt,
  PiggyBank, PlugsConnected, Receipt, Scales, SealCheck, ShieldWarning, ShoppingCart, SquaresFour, Stamp,
  Strategy, TreeStructure, Truck, UserList, UsersFour, UsersThree, Warehouse, Wrench,
} from '@phosphor-icons/react/dist/ssr';

export type RoleKey = 'director' | 'pm' | 'depthead' | 'member' | 'englead' | 'quality' | 'procurement' | 'client';

export type ScreenId =
  | 'home' | 'myprojects' | 'client' | 'mywork' | 'task' | 'myapprovals' | 'docs'
  | 'overview' | 'projects' | 'pfplan' | 'worldmap' | 'portfolio' | 'cash'
  | 'contract' | 'billing' | 'plan' | 'schedule' | 'budget' | 'hours' | 'contingency' | 'presources'
  | 'meetings' | 'stakeholders' | 'interfaces'
  | 'eng' | 'eng-process' | 'eng-meca' | 'eng-elec' | 'eng-auto' | 'pid' | 'bom'
  | 'risks' | 'changes' | 'quality' | 'itp' | 'site' | 'commissioning' | 'trends' | 'rex'
  | 'plm' | 'eco' | 'drawings' | 'procurement' | 'orders' | 'deliveries' | 'stock' | 'fleet' | 'sav'
  | 'resources' | 'requests' | 'approvals' | 'whatif' | 'skills' | 'leave' | 'rates'
  | 'settings' | 'mtypes' | 'doctypes' | 'plumbing';

export type SectionKey = 'portfolio' | 'project' | 'tech' | 'stock' | 'sav' | 'res' | 'admin';

export interface ScreenDef {
  id: ScreenId;
  /** Page <h2> title (EN source string). */
  title: string;
  /** Sidebar label (EN source string); absent = not in navigation. */
  navLabel?: string;
  icon?: Icon;
  /** 'fixed' = top entries above the sections. */
  nav?: 'fixed' | SectionKey;
  /** Group inside the Project section. */
  group?: string;
  /** project = /projects/[code]/…, shows the project switcher; zone = shows the zone bar. */
  scope: 'global' | 'project' | 'zone';
  /** URL path segment(s) after the scope prefix. */
  slug: string;
  /** Implemented in this delivery (others render the "coming soon" page). */
  built: boolean;
}

const S = (d: ScreenDef) => d;

export const SCREENS: ScreenDef[] = [
  // Fixed entries
  S({ id: 'home', title: 'Home', navLabel: 'Home', icon: House, nav: 'fixed', scope: 'global', slug: '', built: true }),
  S({ id: 'myprojects', title: 'My projects', navLabel: 'My projects', icon: FolderUser, nav: 'fixed', scope: 'global', slug: 'my/projects', built: true }),
  S({ id: 'client', title: 'My project — client view', navLabel: 'My project', icon: Buildings, nav: 'fixed', scope: 'project', slug: 'client', built: true }),
  S({ id: 'mywork', title: 'My work', navLabel: 'My tasks', icon: CheckSquare, nav: 'fixed', scope: 'global', slug: 'my/tasks', built: true }),
  S({ id: 'task', title: 'Task', scope: 'global', slug: 'my/tasks/[taskId]', built: true }),
  S({ id: 'myapprovals', title: 'My approvals', navLabel: 'My approvals', icon: Stamp, nav: 'fixed', scope: 'global', slug: 'my/approvals', built: true }),
  S({ id: 'docs', title: 'Documents — Codex index', navLabel: 'Documents · Codex', icon: Books, nav: 'fixed', scope: 'project', slug: 'documents', built: true }),
  // Portfolio
  S({ id: 'overview', title: 'Portfolio overview', navLabel: 'Overview', icon: SquaresFour, nav: 'portfolio', scope: 'zone', slug: 'portfolio/overview', built: true }),
  S({ id: 'projects', title: 'Projects', navLabel: 'Projects', icon: Folders, nav: 'portfolio', scope: 'zone', slug: 'portfolio/projects', built: true }),
  S({ id: 'pfplan', title: 'Portfolio schedule — projects in progress & pipeline', navLabel: 'Schedule', icon: ChartBarHorizontal, nav: 'portfolio', scope: 'zone', slug: 'portfolio/schedule', built: true }),
  S({ id: 'worldmap', title: 'Projects map', navLabel: 'Projects map', icon: GlobeHemisphereWest, nav: 'portfolio', scope: 'zone', slug: 'portfolio/map', built: true }),
  S({ id: 'portfolio', title: 'Portfolio — prioritisation & capacity', navLabel: 'Prioritisation', icon: Strategy, nav: 'portfolio', scope: 'zone', slug: 'portfolio/prioritisation', built: true }),
  S({ id: 'cash', title: 'Cash flow & billing — next 6 months', navLabel: 'Cash flow', icon: Coins, nav: 'portfolio', scope: 'zone', slug: 'portfolio/cash', built: true }),
  // Project › Contract
  S({ id: 'contract', title: 'Contract', navLabel: 'Contract', icon: FileText, nav: 'project', group: 'Contract', scope: 'project', slug: 'contract', built: true }),
  S({ id: 'billing', title: 'Billing & payments', navLabel: 'Billing', icon: Receipt, nav: 'project', group: 'Contract', scope: 'project', slug: 'billing', built: true }),
  // Project › Steering
  S({ id: 'plan', title: 'Plan — WBS & activities', navLabel: 'Plan — WBS', icon: TreeStructure, nav: 'project', group: 'Steering', scope: 'project', slug: 'plan', built: true }),
  S({ id: 'schedule', title: 'Schedule', navLabel: 'Schedule', icon: CalendarDots, nav: 'project', group: 'Steering', scope: 'project', slug: 'schedule', built: true }),
  S({ id: 'budget', title: 'Budget & cost', navLabel: 'Budget & cost', icon: ChartLineUp, nav: 'project', group: 'Steering', scope: 'project', slug: 'budget', built: true }),
  S({ id: 'hours', title: 'Hours — Lucca reconciliation', navLabel: 'Hours (Lucca)', icon: ClockCountdown, nav: 'project', group: 'Steering', scope: 'project', slug: 'hours', built: true }),
  S({ id: 'contingency', title: 'Contingency register', navLabel: 'Contingency', icon: PiggyBank, nav: 'project', group: 'Steering', scope: 'project', slug: 'contingency', built: true }),
  S({ id: 'presources', title: 'Project resources', navLabel: 'Project resources', icon: UserList, nav: 'project', group: 'Steering', scope: 'project', slug: 'resources', built: true }),
  // Project › Team & exchanges
  S({ id: 'meetings', title: 'Meetings & minutes', navLabel: 'Meetings & minutes', icon: ChatsCircle, nav: 'project', group: 'Team & exchanges', scope: 'project', slug: 'meetings', built: true }),
  S({ id: 'stakeholders', title: 'Stakeholders & RACI', navLabel: 'Stakeholders & RACI', icon: UsersFour, nav: 'project', group: 'Team & exchanges', scope: 'project', slug: 'stakeholders', built: true }),
  S({ id: 'interfaces', title: 'Interface register', navLabel: 'Interfaces', icon: ArrowsLeftRight, nav: 'project', group: 'Team & exchanges', scope: 'project', slug: 'interfaces', built: true }),
  // Project › Project engineering
  S({ id: 'eng', title: 'Engineering synthesis', navLabel: 'Synthesis', icon: SquaresFour, nav: 'project', group: 'Project engineering', scope: 'project', slug: 'engineering', built: true }),
  S({ id: 'eng-process', title: 'Process engineering', navLabel: 'Process', icon: FlowArrow, nav: 'project', group: 'Project engineering', scope: 'project', slug: 'engineering/process', built: true }),
  S({ id: 'eng-meca', title: 'Mechanical engineering', navLabel: 'Mechanical', icon: Gear, nav: 'project', group: 'Project engineering', scope: 'project', slug: 'engineering/mechanical', built: true }),
  S({ id: 'eng-elec', title: 'Electrical engineering', navLabel: 'Electrical', icon: Lightning, nav: 'project', group: 'Project engineering', scope: 'project', slug: 'engineering/electrical', built: true }),
  S({ id: 'eng-auto', title: 'Automation engineering', navLabel: 'Automation', icon: Cpu, nav: 'project', group: 'Project engineering', scope: 'project', slug: 'engineering/automation', built: true }),
  S({ id: 'pid', title: 'P&ID — tags, overlay & process validation', navLabel: 'P&ID validation', icon: FlowArrow, nav: 'project', group: 'Project engineering', scope: 'project', slug: 'pid', built: true }),
  S({ id: 'bom', title: 'Project BOM — equipment & parts', navLabel: 'Project BOM', icon: Cube, nav: 'project', group: 'Project engineering', scope: 'project', slug: 'bom', built: true }),
  // Project › Control
  S({ id: 'risks', title: 'Risk register', navLabel: 'Risk register', icon: ShieldWarning, nav: 'project', group: 'Control', scope: 'project', slug: 'risks', built: true }),
  S({ id: 'changes', title: 'Change control & baselines', navLabel: 'Change control', icon: GitPullRequest, nav: 'project', group: 'Control', scope: 'project', slug: 'changes', built: true }),
  S({ id: 'quality', title: 'Quality — NCR & deliverables', navLabel: 'Quality & deliverables', icon: SealCheck, nav: 'project', group: 'Control', scope: 'project', slug: 'quality', built: true }),
  S({ id: 'itp', title: 'Inspection & test plan · punch list', navLabel: 'Inspections & punch list', icon: ClipboardText, nav: 'project', group: 'Control', scope: 'project', slug: 'itp', built: true }),
  // Project › Site & handover
  S({ id: 'site', title: 'Site — readiness, mobilisation & execution', navLabel: 'Site (chantier)', icon: HardHat, nav: 'project', group: 'Site & handover', scope: 'project', slug: 'site', built: true }),
  S({ id: 'commissioning', title: 'Commissioning & handover dossier', navLabel: 'Commissioning & handover', icon: Key, nav: 'project', group: 'Site & handover', scope: 'project', slug: 'commissioning', built: true }),
  // Project › Project review
  S({ id: 'trends', title: 'Trends & status report', navLabel: 'Trends & status', icon: ChartLine, nav: 'project', group: 'Project review', scope: 'project', slug: 'trends', built: true }),
  S({ id: 'rex', title: 'Lessons learned & project closure', navLabel: 'Lessons learned & closure', icon: GraduationCap, nav: 'project', group: 'Project review', scope: 'project', slug: 'closure', built: true }),
  // Technical reference
  S({ id: 'plm', title: 'PLM — parts catalogue', navLabel: 'Parts (PLM)', icon: Database, nav: 'tech', scope: 'global', slug: 'reference/parts', built: true }),
  S({ id: 'eco', title: 'Engineering change orders', navLabel: 'Change orders (ECO)', icon: GitBranch, nav: 'tech', scope: 'global', slug: 'reference/eco', built: true }),
  S({ id: 'drawings', title: 'Drawings — PDM vault', navLabel: 'Drawings', icon: Blueprint, nav: 'tech', scope: 'global', slug: 'reference/drawings', built: true }),
  // Purchasing & stock
  S({ id: 'procurement', title: 'Sourcing, invoices & suppliers', navLabel: 'Sourcing & invoices', icon: Handshake, nav: 'stock', scope: 'global', slug: 'purchasing/sourcing', built: true }),
  S({ id: 'orders', title: 'Purchase orders', navLabel: 'Purchase orders', icon: ShoppingCart, nav: 'stock', scope: 'project', slug: 'orders', built: true }),
  S({ id: 'deliveries', title: 'Deliveries & goods receipt', navLabel: 'Deliveries', icon: Truck, nav: 'stock', scope: 'project', slug: 'deliveries', built: true }),
  S({ id: 'stock', title: 'Stock & storages', navLabel: 'Stock & storages', icon: Warehouse, nav: 'stock', scope: 'global', slug: 'purchasing/stock', built: true }),
  // Warranty & after-sales
  S({ id: 'fleet', title: 'Installed base', navLabel: 'Installed base', icon: CraneTower, nav: 'sav', scope: 'zone', slug: 'after-sales/fleet', built: true }),
  S({ id: 'sav', title: 'Warranty claims & interventions', navLabel: 'Warranty claims & interventions', icon: Wrench, nav: 'sav', scope: 'zone', slug: 'after-sales/claims', built: true }),
  // Resources
  S({ id: 'resources', title: 'Resources', navLabel: 'Resources', icon: UsersThree, nav: 'res', scope: 'global', slug: 'resources', built: true }),
  S({ id: 'requests', title: 'Resource requests', navLabel: 'Resource requests', icon: PaperPlaneTilt, nav: 'res', scope: 'global', slug: 'resources/requests', built: true }),
  S({ id: 'approvals', title: 'Approvals', navLabel: 'Approvals', icon: SealCheck, nav: 'res', scope: 'global', slug: 'resources/approvals', built: true }),
  S({ id: 'whatif', title: 'What-if levelling', navLabel: 'What-if levelling', icon: Scales, nav: 'res', scope: 'global', slug: 'resources/what-if', built: true }),
  S({ id: 'skills', title: 'Skills matrix', navLabel: 'Skills matrix', icon: Certificate, nav: 'res', scope: 'global', slug: 'resources/skills', built: true }),
  S({ id: 'leave', title: 'Leave & working calendar', navLabel: 'Leave & calendar', icon: CalendarCheck, nav: 'res', scope: 'global', slug: 'resources/leave', built: true }),
  S({ id: 'rates', title: 'Rate cards', navLabel: 'Rate cards', icon: CurrencyEur, nav: 'res', scope: 'global', slug: 'resources/rates', built: true }),
  // Administration
  S({ id: 'settings', title: 'Settings — personalisable lists', navLabel: 'Settings', icon: GearSix, nav: 'admin', scope: 'global', slug: 'admin/settings', built: true }),
  S({ id: 'mtypes', title: 'Standard machine types', navLabel: 'Machine types', icon: Cube, nav: 'admin', scope: 'global', slug: 'admin/machine-types', built: true }),
  S({ id: 'doctypes', title: 'Document types register (Codex)', navLabel: 'Document types register (Codex)', icon: ListChecks, nav: 'admin', scope: 'global', slug: 'admin/document-types', built: true }),
  S({ id: 'plumbing', title: 'Activity, integrations & audit', navLabel: 'Activity & integrations', icon: PlugsConnected, nav: 'admin', scope: 'global', slug: 'admin/integrations', built: true }),
];

export const SCREEN_BY_ID = Object.fromEntries(SCREENS.map((s) => [s.id, s])) as Record<ScreenId, ScreenDef>;

/** Sidebar sections, in display order (labels are EN source strings). */
export const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'project', label: 'Project' },
  { key: 'tech', label: 'Technical reference' },
  { key: 'stock', label: 'Purchasing & stock' },
  { key: 'sav', label: 'Warranty & after-sales' },
  { key: 'res', label: 'Resources' },
  { key: 'admin', label: 'Administration' },
];

/** Project section groups, in display order. Default open: "Steering" only. */
export const PROJECT_GROUPS = ['Contract', 'Steering', 'Team & exchanges', 'Project engineering', 'Control', 'Site & handover', 'Project review'];

/** Fixed entries order (docs/spec/01 §4.3). `client` replaces `myprojects` for the client role. */
export const FIXED_ORDER: ScreenId[] = ['home', 'myprojects', 'client', 'mywork', 'myapprovals', 'docs'];

/** Default project (prototype `state.project`). */
export const DEFAULT_PROJECT = 'HLT-026';

/** URL of a screen. Project-scoped screens need a project code. */
export function screenHref(id: ScreenId, opts: { code?: string; taskId?: string } = {}): string {
  const s = SCREEN_BY_ID[id];
  if (s.scope === 'project') return `/projects/${opts.code ?? DEFAULT_PROJECT}/${s.slug}`;
  if (id === 'task') return `/my/tasks/${opts.taskId ?? 'T-2314'}`;
  return '/' + s.slug;
}

// ── Role access (ROLE_SCREENS, design lines 3465–3466) ──────────────────────
const base: Record<Exclude<RoleKey, 'director'>, ScreenId[]> = {
  pm: ['home', 'myapprovals', 'plumbing', 'portfolio', 'cash', 'pfplan', 'worldmap', 'trends', 'risks', 'changes', 'quality', 'procurement', 'overview', 'projects', 'plan', 'schedule', 'budget', 'presources', 'orders', 'deliveries', 'stock', 'requests', 'whatif', 'rates', 'skills', 'leave', 'bom', 'eco', 'plm', 'drawings', 'settings', 'mtypes'],
  depthead: ['home', 'myapprovals', 'site', 'overview', 'worldmap', 'resources', 'approvals', 'skills', 'leave', 'whatif', 'requests', 'settings'],
  member: ['home', 'site', 'mywork', 'task', 'skills', 'leave'],
  englead: ['home', 'myapprovals', 'quality', 'pid', 'plan', 'bom', 'plm', 'eco', 'drawings', 'skills', 'requests', 'settings', 'mtypes'],
  quality: ['home', 'myapprovals', 'risks', 'quality', 'pid', 'plan', 'eco', 'plm', 'drawings', 'bom', 'approvals', 'deliveries', 'stock', 'settings', 'mtypes'],
  procurement: ['home', 'myapprovals', 'procurement', 'orders', 'deliveries', 'stock', 'bom', 'plm', 'eco', 'resources', 'settings'],
  client: ['home', 'myapprovals', 'client', 'trends', 'changes', 'quality'],
};
const ENG: ScreenId[] = ['eng', 'eng-process', 'eng-meca', 'eng-elec', 'eng-auto'];
for (const k of ['pm', 'englead', 'quality'] as const) base[k].push(...ENG);
base.pm.push('site', 'meetings', 'contract', 'billing', 'stakeholders', 'itp', 'interfaces', 'contingency', 'commissioning', 'rex', 'hours', 'fleet', 'sav');
base.englead.push('leave', 'meetings', 'interfaces', 'itp', 'commissioning', 'rex');
base.quality.push('leave', 'meetings', 'itp', 'commissioning', 'rex', 'sav', 'fleet');
base.depthead.push('meetings', 'hours');
base.procurement.push('leave', 'meetings', 'contract', 'sav', 'fleet');
base.member.push('meetings');
// P-9a (R-061): activity owners enter the progress of their activities on the Plan — the team member and procurement own
// activities (OWN) but had no Plan; they now have it, read-only except the % complete of their own activities.
base.member.push('plan');
base.procurement.push('plan');
base.client.push('meetings', 'itp', 'commissioning');
for (const k of Object.keys(base) as (keyof typeof base)[]) {
  base[k].push('docs');
  if (k !== 'client') base[k].push('myprojects');
  if (k === 'quality' || k === 'pm') base[k].push('doctypes');
}

/** Screens a role may see in navigation; null = everything (director). */
export const ROLE_SCREENS: Record<RoleKey, ScreenId[] | null> = { director: null, ...base };

/** Gating only hides navigation; a screen opened outside the role's list renders read-only with a banner. */
export function canSee(role: RoleKey, id: ScreenId): boolean {
  const allowed = ROLE_SCREENS[role];
  return !allowed || allowed.includes(id === 'task' ? 'mywork' : id);
}
