// Screen registry — single source of truth for routes, navigation, titles and role access.
// Derived from docs/spec/01 §3–§4, §15 and docs/spec/00 §4 (proposed routes).
// Labels are English source strings; render them through t() (FR via the prototype dictionary).
// No icon here: the navigation icons are in ./screen-icons.ts, so server rules and scripts (db-check, the worker) can import
// the registry without loading the icon components.

// R-044 (P-4, P-12 c, C-9): 'finance' — contract, billing (read), the rate grid and the budget rate.
// R-158 (owner's decision 7, 25 Oct 2026): 'logistics' — prepares and follows the shipments (Shipments screen, every project).
export type RoleKey = 'director' | 'pm' | 'depthead' | 'member' | 'englead' | 'quality' | 'procurement' | 'finance' | 'logistics' | 'client';

export type ScreenId =
  | 'home' | 'myprojects' | 'client' | 'mywork' | 'task' | 'myapprovals' | 'dashboards' | 'docs'
  | 'overview' | 'projects' | 'pfplan' | 'worldmap' | 'portfolio' | 'cash'
  | 'contract' | 'billing' | 'plan' | 'schedule' | 'budget' | 'hours' | 'contingency' | 'presources'
  | 'meetings' | 'stakeholders' | 'interfaces'
  | 'eng' | 'eng-process' | 'eng-meca' | 'eng-elec' | 'eng-auto' | 'pid' | 'bom'
  | 'risks' | 'changes' | 'quality' | 'itp' | 'site' | 'shipments' | 'commissioning' | 'trends' | 'rex'
  | 'plm' | 'eco' | 'drawings' | 'catalogue' | 'procurement' | 'orders' | 'deliveries' | 'stock' | 'fleet' | 'sav'
  | 'resources' | 'requests' | 'approvals' | 'whatif' | 'skills' | 'leave' | 'rates'
  | 'settings' | 'mtypes' | 'doctypes' | 'plumbing';

export type SectionKey = 'portfolio' | 'project' | 'tech' | 'catalogue' | 'stock' | 'sav' | 'res' | 'admin';

export interface ScreenDef {
  id: ScreenId;
  /** Page <h2> title (EN source string). */
  title: string;
  /** Sidebar label (EN source string); absent = not in navigation. */
  navLabel?: string;
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
  S({ id: 'home', title: 'Home', navLabel: 'Home', nav: 'fixed', scope: 'global', slug: '', built: true }),
  S({ id: 'myprojects', title: 'My projects', navLabel: 'My projects', nav: 'fixed', scope: 'global', slug: 'my/projects', built: true }),
  S({ id: 'client', title: 'My project — client view', navLabel: 'My project', nav: 'fixed', scope: 'project', slug: 'client', built: true }),
  S({ id: 'mywork', title: 'My work', navLabel: 'My tasks', nav: 'fixed', scope: 'global', slug: 'my/tasks', built: true }),
  S({ id: 'task', title: 'Task', scope: 'global', slug: 'my/tasks/[taskId]', built: true }),
  S({ id: 'myapprovals', title: 'My approvals', navLabel: 'My approvals', nav: 'fixed', scope: 'global', slug: 'my/approvals', built: true }),
  // R-203 (K-203, owner 1 Nov 2026): each user's own dashboards, composed from Keystone's existing indicators and lists.
  S({ id: 'dashboards', title: 'My dashboards', navLabel: 'My dashboards', nav: 'fixed', scope: 'global', slug: 'my/dashboards', built: true }),
  S({ id: 'docs', title: 'Documents — Codex index', navLabel: 'Documents · Codex', nav: 'fixed', scope: 'project', slug: 'documents', built: true }),
  // Portfolio
  S({ id: 'overview', title: 'Portfolio overview', navLabel: 'Overview', nav: 'portfolio', scope: 'zone', slug: 'portfolio/overview', built: true }),
  S({ id: 'projects', title: 'Projects', navLabel: 'Projects', nav: 'portfolio', scope: 'zone', slug: 'portfolio/projects', built: true }),
  S({ id: 'pfplan', title: 'Portfolio schedule — projects in progress & pipeline', navLabel: 'Schedule', nav: 'portfolio', scope: 'zone', slug: 'portfolio/schedule', built: true }),
  S({ id: 'worldmap', title: 'Projects map', navLabel: 'Projects map', nav: 'portfolio', scope: 'zone', slug: 'portfolio/map', built: true }),
  S({ id: 'portfolio', title: 'Portfolio — prioritisation & capacity', navLabel: 'Prioritisation', nav: 'portfolio', scope: 'zone', slug: 'portfolio/prioritisation', built: true }),
  S({ id: 'cash', title: 'Cash flow & billing — next 6 months', navLabel: 'Cash flow', nav: 'portfolio', scope: 'zone', slug: 'portfolio/cash', built: true }),
  // Project › Contract
  S({ id: 'contract', title: 'Contract', navLabel: 'Contract', nav: 'project', group: 'Contract', scope: 'project', slug: 'contract', built: true }),
  S({ id: 'billing', title: 'Billing & payments', navLabel: 'Billing', nav: 'project', group: 'Contract', scope: 'project', slug: 'billing', built: true }),
  // Project › Steering
  S({ id: 'plan', title: 'Plan — WBS & activities', navLabel: 'Plan — WBS', nav: 'project', group: 'Steering', scope: 'project', slug: 'plan', built: true }),
  S({ id: 'schedule', title: 'Schedule', navLabel: 'Schedule', nav: 'project', group: 'Steering', scope: 'project', slug: 'schedule', built: true }),
  S({ id: 'budget', title: 'Budget & cost', navLabel: 'Budget & cost', nav: 'project', group: 'Steering', scope: 'project', slug: 'budget', built: true }),
  S({ id: 'hours', title: 'Hours — Lucca reconciliation', navLabel: 'Hours (Lucca)', nav: 'project', group: 'Steering', scope: 'project', slug: 'hours', built: true }),
  S({ id: 'contingency', title: 'Contingency register', navLabel: 'Contingency', nav: 'project', group: 'Steering', scope: 'project', slug: 'contingency', built: true }),
  S({ id: 'presources', title: 'Project resources', navLabel: 'Project resources', nav: 'project', group: 'Steering', scope: 'project', slug: 'resources', built: true }),
  // Project › Team & exchanges
  S({ id: 'meetings', title: 'Meetings & minutes', navLabel: 'Meetings & minutes', nav: 'project', group: 'Team & exchanges', scope: 'project', slug: 'meetings', built: true }),
  S({ id: 'stakeholders', title: 'Stakeholders & RACI', navLabel: 'Stakeholders & RACI', nav: 'project', group: 'Team & exchanges', scope: 'project', slug: 'stakeholders', built: true }),
  S({ id: 'interfaces', title: 'Interface register', navLabel: 'Interfaces', nav: 'project', group: 'Team & exchanges', scope: 'project', slug: 'interfaces', built: true }),
  // Project › Project engineering
  S({ id: 'eng', title: 'Engineering synthesis', navLabel: 'Synthesis', nav: 'project', group: 'Project engineering', scope: 'project', slug: 'engineering', built: true }),
  S({ id: 'eng-process', title: 'Process engineering', navLabel: 'Process', nav: 'project', group: 'Project engineering', scope: 'project', slug: 'engineering/process', built: true }),
  S({ id: 'eng-meca', title: 'Mechanical engineering', navLabel: 'Mechanical', nav: 'project', group: 'Project engineering', scope: 'project', slug: 'engineering/mechanical', built: true }),
  S({ id: 'eng-elec', title: 'Electrical engineering', navLabel: 'Electrical', nav: 'project', group: 'Project engineering', scope: 'project', slug: 'engineering/electrical', built: true }),
  S({ id: 'eng-auto', title: 'Automation engineering', navLabel: 'Automation', nav: 'project', group: 'Project engineering', scope: 'project', slug: 'engineering/automation', built: true }),
  S({ id: 'pid', title: 'P&ID — tags, overlay & process validation', navLabel: 'P&ID validation', nav: 'project', group: 'Project engineering', scope: 'project', slug: 'pid', built: true }),
  S({ id: 'bom', title: 'Project BOM — equipment & parts', navLabel: 'Project BOM', nav: 'project', group: 'Project engineering', scope: 'project', slug: 'bom', built: true }),
  // Project › Control
  S({ id: 'risks', title: 'Risk register', navLabel: 'Risk register', nav: 'project', group: 'Control', scope: 'project', slug: 'risks', built: true }),
  S({ id: 'changes', title: 'Change control & baselines', navLabel: 'Change control', nav: 'project', group: 'Control', scope: 'project', slug: 'changes', built: true }),
  S({ id: 'quality', title: 'Quality — NCR & deliverables', navLabel: 'Quality & deliverables', nav: 'project', group: 'Control', scope: 'project', slug: 'quality', built: true }),
  S({ id: 'itp', title: 'Inspection & test plan · punch list', navLabel: 'Inspections & punch list', nav: 'project', group: 'Control', scope: 'project', slug: 'itp', built: true }),
  // Project › Site & handover
  S({ id: 'site', title: 'Site — readiness, mobilisation & execution', navLabel: 'Site (chantier)', nav: 'project', group: 'Site & handover', scope: 'project', slug: 'site', built: true }),
  // R-158 (owner's decision 1, 25 Oct 2026): the project's shipments of its equipment to the site — a project view only.
  S({ id: 'shipments', title: 'Shipments — packing, transport & customs', navLabel: 'Shipments', nav: 'project', group: 'Site & handover', scope: 'project', slug: 'shipments', built: true }),
  S({ id: 'commissioning', title: 'Commissioning & handover dossier', navLabel: 'Commissioning & handover', nav: 'project', group: 'Site & handover', scope: 'project', slug: 'commissioning', built: true }),
  // Project › Project review
  S({ id: 'trends', title: 'Trends & status report', navLabel: 'Trends & status', nav: 'project', group: 'Project review', scope: 'project', slug: 'trends', built: true }),
  S({ id: 'rex', title: 'Lessons learned & project closure', navLabel: 'Lessons learned & closure', nav: 'project', group: 'Project review', scope: 'project', slug: 'closure', built: true }),
  // Technical reference
  S({ id: 'plm', title: 'PLM — parts catalogue', navLabel: 'Parts (PLM)', nav: 'tech', scope: 'global', slug: 'reference/parts', built: true }),
  S({ id: 'eco', title: 'Engineering change orders', navLabel: 'Change orders (ECO)', nav: 'tech', scope: 'global', slug: 'reference/eco', built: true }),
  S({ id: 'drawings', title: 'Drawings — PDM vault', navLabel: 'Drawings', nav: 'tech', scope: 'global', slug: 'reference/drawings', built: true }),
  // Machine catalogue (owner, 25 Oct 2026: Keystone owns the catalogue, AC-4 — a section of its own, only to manage it). Placed
  // right after Technical reference: the catalogue is built on the machine types and read by the engineering roles.
  S({ id: 'catalogue', title: 'Machine catalogue', navLabel: 'Machine catalogue', nav: 'catalogue', scope: 'global', slug: 'catalogue/machines', built: true }),
  // Purchasing & stock
  S({ id: 'procurement', title: 'Sourcing, invoices & suppliers', navLabel: 'Sourcing & invoices', nav: 'stock', scope: 'global', slug: 'purchasing/sourcing', built: true }),
  S({ id: 'orders', title: 'Purchase orders', navLabel: 'Purchase orders', nav: 'stock', scope: 'project', slug: 'orders', built: true }),
  S({ id: 'deliveries', title: 'Deliveries & goods receipt', navLabel: 'Deliveries', nav: 'stock', scope: 'project', slug: 'deliveries', built: true }),
  S({ id: 'stock', title: 'Stock & storages', navLabel: 'Stock & storages', nav: 'stock', scope: 'global', slug: 'purchasing/stock', built: true }),
  // Warranty & after-sales
  S({ id: 'fleet', title: 'Installed base', navLabel: 'Installed base', nav: 'sav', scope: 'zone', slug: 'after-sales/fleet', built: true }),
  S({ id: 'sav', title: 'Warranty claims & interventions', navLabel: 'Warranty claims & interventions', nav: 'sav', scope: 'zone', slug: 'after-sales/claims', built: true }),
  // Resources
  S({ id: 'resources', title: 'Resources', navLabel: 'Resources', nav: 'res', scope: 'global', slug: 'resources', built: true }),
  S({ id: 'requests', title: 'Resource requests', navLabel: 'Resource requests', nav: 'res', scope: 'global', slug: 'resources/requests', built: true }),
  S({ id: 'approvals', title: 'Approvals', navLabel: 'Approvals', nav: 'res', scope: 'global', slug: 'resources/approvals', built: true }),
  S({ id: 'whatif', title: 'What-if levelling', navLabel: 'What-if levelling', nav: 'res', scope: 'global', slug: 'resources/what-if', built: true }),
  S({ id: 'skills', title: 'Skills matrix', navLabel: 'Skills matrix', nav: 'res', scope: 'global', slug: 'resources/skills', built: true }),
  S({ id: 'leave', title: 'Leave & working calendar', navLabel: 'Leave & calendar', nav: 'res', scope: 'global', slug: 'resources/leave', built: true }),
  S({ id: 'rates', title: 'Rate cards', navLabel: 'Rate cards', nav: 'res', scope: 'global', slug: 'resources/rates', built: true }),
  // Administration
  S({ id: 'settings', title: 'Settings — personalisable lists', navLabel: 'Settings', nav: 'admin', scope: 'global', slug: 'admin/settings', built: true }),
  S({ id: 'mtypes', title: 'Standard machine types', navLabel: 'Machine types', nav: 'admin', scope: 'global', slug: 'admin/machine-types', built: true }),
  S({ id: 'doctypes', title: 'Document types register (Codex)', navLabel: 'Document types register (Codex)', nav: 'admin', scope: 'global', slug: 'admin/document-types', built: true }),
  S({ id: 'plumbing', title: 'Activity, integrations & audit', navLabel: 'Activity & integrations', nav: 'admin', scope: 'global', slug: 'admin/integrations', built: true }),
];

export const SCREEN_BY_ID = Object.fromEntries(SCREENS.map((s) => [s.id, s])) as Record<ScreenId, ScreenDef>;

/** Sidebar sections, in display order (labels are EN source strings). */
export const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'project', label: 'Project' },
  { key: 'tech', label: 'Technical reference' },
  { key: 'catalogue', label: 'Machine catalogue' },
  { key: 'stock', label: 'Purchasing & stock' },
  { key: 'sav', label: 'Warranty & after-sales' },
  { key: 'res', label: 'Resources' },
  { key: 'admin', label: 'Administration' },
];

/** Project section groups, in display order. Default open: "Steering" only. */
export const PROJECT_GROUPS = ['Contract', 'Steering', 'Team & exchanges', 'Project engineering', 'Control', 'Site & handover', 'Project review'];

/** Fixed entries order (docs/spec/01 §4.3). `client` replaces `myprojects` for the client role. */
export const FIXED_ORDER: ScreenId[] = ['home', 'myprojects', 'client', 'mywork', 'myapprovals', 'dashboards', 'docs'];

/** Default project (prototype `state.project`). */
export const DEFAULT_PROJECT = 'HLT-026';

/** URL of a screen. Project-scoped screens need a project code. */
export function screenHref(id: ScreenId, opts: { code?: string; taskId?: string } = {}): string {
  const s = SCREEN_BY_ID[id];
  if (s.scope === 'project') return `/projects/${opts.code ?? DEFAULT_PROJECT}/${s.slug}`;
  if (id === 'task') return `/my/tasks/${opts.taskId ?? 'T-2314'}`;
  return '/' + s.slug;
}

// ── Role access: ./role-screens.ts (no icon import, usable by server rules and scripts) ──────────────────────
export { ROLE_SCREENS, canSee } from './role-screens';
