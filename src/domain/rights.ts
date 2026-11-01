// Access rights of delivery 7 (lot "rights"): the owner's answers P-1, P-2, P-3, P-8a, P-9a, P-9b, P-10a, P-10b, L-4b,
// R-9, NEW-D2-1 and NEW-D3-1 (docs/DECISIONS.md), as pure rules shared by the pages (which controls to render, what data
// to send), the Server Functions and Route Handlers (which re-check on the server) and the exports. No I/O here: the
// project-context helpers (src/server/project-context.ts) and the DAL feed these functions with facts from the database.
import { canSee } from '@/config/role-screens';
import type { RoleKey, ScreenId } from '@/config/screens';
import type { ApprovalKind } from './approvals';

// ── R-041 · Named project team (P-2, L-4b) ──────────────────────────────────────────────────────────────────────────

/**
 * Role of a person in a project's named team (`project_members.project_role`). The project's PM (`projects.pm_person_id`)
 * is always on the team as `pm`; further `pm` rows are co-PMs (projects with several PMs); `deputy` = deputy PM;
 * `referent` = the engineering / quality / purchasing referent of the project; `team` = team member.
 */
export const PROJECT_TEAM_ROLES = ['pm', 'deputy', 'referent', 'team'] as const;
export type ProjectTeamRole = (typeof PROJECT_TEAM_ROLES)[number];
export const isProjectTeamRole = (v: unknown): v is ProjectTeamRole => typeof v === 'string' && (PROJECT_TEAM_ROLES as readonly string[]).includes(v);

/** EN source labels (FR in src/i18n/extra/d7-rights.json). */
export const PROJECT_TEAM_ROLE_LABEL: Record<ProjectTeamRole, string> = {
  pm: 'Project manager',
  deputy: 'Deputy project manager',
  referent: 'Referent',
  team: 'Team member',
};

/** Team roles with the project manager's rights (L-4b: stage and deliverables; P-9a: plan structure; P-9b: minutes). */
export const LEAD_TEAM_ROLES: readonly ProjectTeamRole[] = ['pm', 'deputy'];

/** One person of a project's named team. */
export interface TeamMember {
  personId: string;
  /** "R. Aubert" (persons.short_name, unique) — how the demo personas are matched. */
  short: string;
  /** Full name when known, else the short name. */
  name: string;
  role: ProjectTeamRole;
  /** The project's PM of record (`projects.pm_person_id`): shown first, not editable from the team card. */
  primary: boolean;
}

/** The viewer as the rights see it (a signed-in user, or a demo persona matched by its short name). */
export interface RightsViewer {
  role: RoleKey;
  personId: string | null;
  short: string;
  name: string;
  organisation: string | null;
}

export interface ProjectFacts {
  /** Client organisation name ("Port authority"). */
  client: string;
  /** R-190: the client is a group subsidiary (internal client) — no client-portal access (R-179, I-2b). Absent = external. */
  clientInternal?: boolean;
  /** Short name of the PM of record ("R. Aubert", '—' when none). */
  pm: string;
  pmPersonId: string | null;
  team: readonly TeamMember[];
}

/** The viewer's rights on one project. */
export interface ProjectAccess {
  /** On the named team (any team role), the director on every project, a client on their organisation's projects (P-2). */
  member: boolean;
  /** The project manager's rights: PM of record, co-PM or deputy (team role pm / deputy), or the director (L-4b, P-9a). */
  lead: boolean;
  /** PM of record, co-PM or deputy by the team itself — not by the director role (P-9b "the project's PM"). */
  pm: boolean;
  /** Client contact of the project's organisation. */
  client: boolean;
  /** Project writes refused: not on the team (P-2); a client on another organisation's project. */
  readOnly: boolean;
  /** Project refused altogether: a client on another organisation's project (P-10a, R-042). */
  refused: boolean;
  /** The viewer's team role; null when not on the team. */
  teamRole: ProjectTeamRole | null;
}

/** Is this team member the viewer? By person for signed-in users, by short name for the demo personas. */
export const isViewerMember = (v: Pick<RightsViewer, 'personId' | 'short'>, m: Pick<TeamMember, 'personId' | 'short'>) =>
  v.personId ? m.personId === v.personId : m.short === v.short;

/** The viewer's rights on a project (R-041). */
export function projectAccess(v: RightsViewer, p: ProjectFacts): ProjectAccess {
  if (v.role === 'client') {
    const own = !clientRefusedProject(v, p);
    return { member: own, lead: false, pm: false, client: own, readOnly: !own, refused: !own, teamRole: null };
  }
  const isPmOfRecord = v.personId ? !!p.pmPersonId && p.pmPersonId === v.personId : p.pm === v.short;
  const rows = p.team.filter((m) => isViewerMember(v, m));
  const teamRole: ProjectTeamRole | null = isPmOfRecord
    ? 'pm'
    : (PROJECT_TEAM_ROLES.find((r) => rows.some((m) => m.role === r)) ?? null);
  const pm = !!teamRole && LEAD_TEAM_ROLES.includes(teamRole);
  const director = v.role === 'director';
  return { member: director || !!teamRole, lead: director || pm, pm, client: false, readOnly: !director && !teamRole, refused: false, teamRole };
}

/**
 * Who changes a project's team (add a person, change a role, remove): the director and the project's PMs (PM of record,
 * co-PMs). Deputies and referents do not. The PM of record itself is changed elsewhere (wizard, register).
 */
export const canManageTeam = (role: RoleKey, a: Pick<ProjectAccess, 'teamRole'>) => role === 'director' || a.teamRole === 'pm';

// ── R-044 · Finance and the contract (P-4, C-9) ────────────────────────────────────────────────────────────────────

/**
 * P-4: who edits a project's contract (sheet, amendments, bonds, milestones) — the portfolio director, Finance on every
 * project (delivery-8 default: departs from P-2's named-team rule, the owner to confirm), or one of the project's PMs (PM of
 * record, co-PM, deputy) whose workspace has the Contract screen — so a deputy whose role is 'member' gets no editing.
 * Procurement no longer has the Contract screen (P-4).
 */
export const canEditContract = (role: RoleKey, a: Pick<ProjectAccess, 'lead'>) =>
  role === 'director' || role === 'finance' || (a.lead && role !== 'client' && canSee(role, 'contract'));

/**
 * R-190 (Arche K-05): the project's CAPEX link (CAPEX code, machine need) — the director and the project's leads (PM of record,
 * co-PM, deputy) who see the Contract screen; not Finance, which edits the contract's money, not the project's origin.
 */
export const canSetCapexLink = (role: RoleKey, a: Pick<ProjectAccess, 'lead'>) =>
  role === 'director' || (a.lead && role !== 'client' && role !== 'finance' && canSee(role, 'contract'));

/**
 * R-185: the project's equipment lines (Contract screen, "Equipment" card) — the same people as the CAPEX link: the director and
 * the project's leads who see the Contract screen; not Finance, not the client.
 */
export const canSetProjectEquipment = (role: RoleKey, a: Pick<ProjectAccess, 'lead'>) => canSetCapexLink(role, a);

/**
 * R-189 (Arche K-04): which schedule milestone is which CAPEX milestone (Schedule screen) — the same people as the CAPEX link: the
 * director and the project's leads who see the Schedule screen; not Finance, not the client.
 */
export const canSetCapexMilestone = (role: RoleKey, a: Pick<ProjectAccess, 'lead'>) =>
  role === 'director' || (a.lead && role !== 'client' && role !== 'finance' && canSee(role, 'schedule'));

/** R-044: Finance reads Budget, Hours and Billing, even on a project whose team it is on (billing gate unchanged). */
export const FINANCE_READ_ONLY_SCREENS: readonly ScreenId[] = ['budget', 'hours', 'billing'];
export const financeReadOnly = (role: RoleKey, screen: ScreenId) => role === 'finance' && FINANCE_READ_ONLY_SCREENS.includes(screen);

// ── R-158 · Logistics and the shipments (owner's decisions 1 and 7, 25 Oct 2026) ──────────────────────────────────

/** R-158: Logistics reads the screens a shipment needs (BOM, Site, Schedule, Deliveries), even on a project whose team it is on. */
export const LOGISTICS_READ_ONLY_SCREENS: readonly ScreenId[] = ['bom', 'site', 'schedule', 'deliveries'];
export const logisticsReadOnly = (role: RoleKey, screen: ScreenId) => role === 'logistics' && LOGISTICS_READ_ONLY_SCREENS.includes(screen);

/** A screen of the role's workspace the role only reads (Finance: Budget, Hours, Billing — R-044; Logistics — R-158). */
export const roleReadOnly = (role: RoleKey, screen: ScreenId) => financeReadOnly(role, screen) || logisticsReadOnly(role, screen);

/**
 * R-158: who prepares and follows a project's shipments (Shipments screen: shipments, loads, content, packing control, transport
 * steps, status) — the portfolio director and Logistics on every project (like Finance on the contract: EPC2i's logistics serves
 * every project, not a named team), or one of the project's leads (PM of record, co-PM, deputy) whose workspace has the screen.
 * The rest of the team and the other internal roles read; the client is refused the screen.
 */
export const canEditShipments = (role: RoleKey, a: Pick<ProjectAccess, 'lead'>) =>
  // R-158 lot B: the team member has the screen to point the reception only (`canRecordReception`), never to edit shipments.
  role !== 'client' && role !== 'member' && canSee(role, 'shipments') && (role === 'director' || role === 'logistics' || a.lead);

/**
 * R-158 lot B (decision 5): who points a shipment's site reception (loads and content received, missing, damaged — the gaps raise
 * punch items) — the shipment editors (`canEditShipments`) and the site team: a member of the project's team who edits its Site
 * screen (the team member on site, a department head on the team).
 */
export const canRecordReception = (role: RoleKey, a: Pick<ProjectAccess, 'lead' | 'member'>) =>
  canEditShipments(role, a) || (role !== 'client' && canSee(role, 'site') && !roleReadOnly(role, 'site') && a.member);

/** C-9 (R-044 default, DELIVERY-7 §8 open question): the project currency and budget rate — the director and Finance. */
export const BUDGET_RATE_ROLES: readonly RoleKey[] = ['director', 'finance'];
export const canSetBudgetRate = (role: string) => (BUDGET_RATE_ROLES as readonly string[]).includes(role);

// ── R-139 · "View as client" (P-11) ────────────────────────────────────────────────────────────────────────────────

/**
 * P-11 (answer a): the director and the project's leads (PM of record, co-PMs, deputies) preview the client portal of the
 * project — the "View as client" entry of the project screens' header and the preview banner of the portal. Other internal
 * roles keep the read-only outside view (P-1 = a); the client never previews.
 */
export const canPreviewClientView = (role: RoleKey, a: Pick<ProjectAccess, 'lead'>) => role !== 'client' && (role === 'director' || a.lead);

// ── R-042 · Screens outside the client's workspace (P-1, P-10a) ─────────────────────────────────────────────────────

/** P-1: a client is refused (sent to their home) on any screen outside their workspace; internal roles read it. */
export const clientRefusedScreen = (role: RoleKey, screen: ScreenId) => role === 'client' && !canSee(role, screen);

/**
 * P-10a: a client is refused every project of another organisation (and every project when they have no organisation).
 * R-190 (R-179, I-2b): and every project whose client is a group subsidiary — an internal client follows its projects in the
 * CAPEX application, the client portal is for external clients only.
 */
export const clientRefusedProject = (v: Pick<RightsViewer, 'role' | 'organisation'>, p: { client: string; clientInternal?: boolean }) =>
  v.role === 'client' && !(!!v.organisation && p.client === v.organisation && !p.clientInternal);

// ── R-043 · What the client does not see of their own project (P-10b) ──────────────────────────────────────────────

/** P-10b: the client sees the external meetings only (internal meetings, their transcripts and the question bridge are hidden). */
export const clientSeesMeeting = (type: string) => type === 'external';

/** P-10b: My approvals kinds a client may receive — change requests and deliverable acceptance (no purchasing, NCR, internal). */
export const CLIENT_APPROVAL_KINDS: readonly ApprovalKind[] = ['cr', 'deliverable'];

/** Screens holding purchasing data (P-10b) — hidden from the client even through links, search or notifications. */
export const PURCHASING_SCREENS: readonly ScreenId[] = ['procurement', 'orders', 'deliveries', 'stock'];

/**
 * A notification, search hit or link target a client may see (P-1, P-10a, P-10b): a screen of their workspace, never about
 * an NCR (Quality's NCR register) or purchasing, on a project of their organisation (or no project).
 */
export function clientSeesTarget(screen: string, params: Record<string, unknown>, ownProject: boolean | null): boolean {
  if (!canSee('client', screen as ScreenId) || PURCHASING_SCREENS.includes(screen as ScreenId)) return false;
  if (screen === 'quality' && ('ncr' in params || params.tab === 'ncr' || 'filter' in params)) return false;
  return ownProject !== false;
}

// ── R-045 · Project creation (P-3) ──────────────────────────────────────────────────────────────────────────────────
// src/features/projects/permissions.ts (CREATE_PROJECT_ROLES: director and PMs).

// ── R-046 · Rates and supplier prices (NEW-D2-1) ────────────────────────────────────────────────────────────────────

/** Supplier prices, order values and supplier invoices: the director, the PMs and procurement (NEW-D2-1 "+ achats pour les prix"). */
export const SUPPLIER_PRICE_ROLES: readonly RoleKey[] = ['director', 'pm', 'procurement'];
export const canSeeSupplierPrices = (role: RoleKey) => SUPPLIER_PRICE_ROLES.includes(role);
/** What a masked price shows (the rate card's mask). */
export const PRICE_MASK = '•••';
/** Hint shown where prices are masked (EN source). */
export const PRICES_HIDDEN = 'Prices are visible to the director, the project managers and procurement';
/**
 * R-158: the customs values of a shipment (content lines, per-HS-code summary) come from the BOM valuation — ordered, last purchase
 * or catalogue prices — so they follow NEW-D2-1, plus Logistics, which declares them (export declaration, insurance).
 */
export const canSeeShipmentValues = (role: RoleKey) => canSeeSupplierPrices(role) || role === 'logistics';
// Hourly rates (task cost note, rate card, what-if helpers): `canSeeRates` in src/domain/hr.ts (director, PM, Finance — P-12 c);
// editing the grid: `canEditRates` (director, Finance).

// ── R-047 · Codex deposit and synchronisation (NEW-D3-1) ───────────────────────────────────────────────────────────

/** "Deposit in Codex" / "New revision · Codex": the project's internal team (and the director), inside the workspace. */
export const canDepositInCodex = (role: RoleKey, outside: boolean, a: Pick<ProjectAccess, 'member'>) => role !== 'client' && !outside && a.member;

/** "Sync now" of the Codex index: the director (NEW-D3-1 "directeur et administrateur" — Keystone has no administrator role). */
export const canSyncCodex = (role: RoleKey, outside: boolean) => role === 'director' && !outside;

// ── R-048 · Department heads and resource requests (P-8a) ──────────────────────────────────────────────────────────

/** Approve / reschedule / reject a request of `department`: the director for all, a head for the departments they head. */
export const canDecideDepartment = (role: RoleKey, headed: readonly string[], department: string) =>
  canSee(role, 'approvals') && (role === 'director' || headed.includes(department));

/**
 * The Approvals page of `department`: a department head sees only the departments they head (another department's page
 * sends them to theirs); the director every department; the other viewers read it as before (outside their workspace).
 */
export const canViewDepartmentApprovals = (role: RoleKey, headed: readonly string[], department: string) =>
  role === 'director' || !headed.length || headed.includes(department);

// ── R-049 · Someone else's My work (R-9) ───────────────────────────────────────────────────────────────────────────

export interface WorkScope {
  /** Departments the viewer heads (departments.head_person_id). */
  headedDepartments: readonly string[];
  /** Projects the viewer leads (PM of record, co-PM, deputy). */
  leadProjects: readonly string[];
}

/** A person whose My work may be opened. */
export interface WorkPerson {
  name: string;
  department: string | null;
  /** Projects the person works on (named team, or tasks on the project). */
  projects: readonly string[];
}

/**
 * R-9 (answer b, "selon la hiérarchie et les projets"): the director sees everyone, a department head the people of the
 * departments they head, a project manager (or co-PM / deputy) the people working on the projects they lead. Everyone sees
 * their own work.
 */
export function canViewPersonWork(v: { role: RoleKey; name: string }, scope: WorkScope, person: WorkPerson): boolean {
  if (person.name === v.name || v.role === 'director') return true;
  if (person.department && scope.headedDepartments.includes(person.department)) return true;
  return person.projects.some((c) => scope.leadProjects.includes(c));
}

// ── R-050 · Meeting minutes (P-9b) ─────────────────────────────────────────────────────────────────────────────────

/** The viewer organised the meeting (person when known, else the stored name — full or short). */
export const isOrganizer = (v: Pick<RightsViewer, 'personId' | 'name' | 'short'>, m: { organizerPersonId: string | null; organizer: string }) =>
  v.personId && m.organizerPersonId ? v.personId === m.organizerPersonId : !!m.organizer && (m.organizer === v.name || m.organizer === v.short);

/**
 * Drafting and sending the minutes — "Send minutes", the transcript (import, analysis, review, "Add to minutes", proposals into
 * the risk register or the client questions): the meeting's organiser and the project's PM (PM of record, co-PM, deputy).
 * The other internal team members add notes and tick actions; the client reads (P-9b).
 */
export const canWriteMinutes = (v: Pick<RightsViewer, 'role' | 'personId' | 'name' | 'short'>, a: Pick<ProjectAccess, 'pm'>, m: { organizerPersonId: string | null; organizer: string }) =>
  v.role !== 'client' && (a.pm || isOrganizer(v, m));

// ── R-061 · Plan structure (P-9a) ──────────────────────────────────────────────────────────────────────────────────

/**
 * WBS structure, names, owners, durations, budgets, links, calendars, removal and the scheduling decisions: the project's PM
 * team (PM of record, co-PMs, deputies) and the director. `planEditable` = the Plan is editable for the viewer at all (not
 * outside the workspace, on the team, not the client).
 */
export const canEditPlanStructure = (planEditable: boolean, a: Pick<ProjectAccess, 'lead'>) => planEditable && a.lead;

/** % complete of an activity: the PM team and the director, and the activity's owner for their own activities (P-9a). */
export const canEditActivityProgress = (planEditable: boolean, a: Pick<ProjectAccess, 'lead'>, ownsActivity: boolean) =>
  planEditable && (a.lead || ownsActivity);

/**
 * R-204: a supplier schedule (its milestones / activities, their logic and the progress the supplier reports) — the project's
 * leads and the director, and procurement (the buyer), on a project whose purchase orders they may edit; never the client.
 */
export const canEditSupplierSchedule = (role: RoleKey, a: Pick<ProjectAccess, 'lead'>, ordersEditable: boolean) =>
  role !== 'client' && ordersEditable && (a.lead || role === 'procurement');

/** R-204: the ties consolidating a supplier schedule into the project's CPM — the project's leads and the director (structure). */
export const canTieSupplierSchedule = (role: RoleKey, a: Pick<ProjectAccess, 'lead'>, planEditable: boolean) => role !== 'client' && planEditable && a.lead;
