// Role access (ROLE_SCREENS, design lines 3465–3466): which screens each role sees in navigation. Kept apart from ./screens.ts
// (which imports the navigation icons) so server-side rules (src/domain/rights.ts) and scripts never load client components.
import type { RoleKey, ScreenId } from './screens';

const base: Record<Exclude<RoleKey, 'director'>, ScreenId[]> = {
  pm: ['home', 'myapprovals', 'plumbing', 'portfolio', 'cash', 'pfplan', 'worldmap', 'trends', 'risks', 'changes', 'quality', 'procurement', 'overview', 'projects', 'plan', 'schedule', 'budget', 'presources', 'orders', 'deliveries', 'stock', 'requests', 'whatif', 'rates', 'skills', 'leave', 'bom', 'eco', 'plm', 'drawings', 'settings', 'mtypes', 'catalogue'],
  depthead: ['home', 'myapprovals', 'site', 'overview', 'worldmap', 'resources', 'approvals', 'skills', 'leave', 'whatif', 'requests', 'settings'],
  member: ['home', 'site', 'mywork', 'task', 'skills', 'leave'],
  englead: ['home', 'myapprovals', 'quality', 'pid', 'plan', 'bom', 'plm', 'eco', 'drawings', 'skills', 'requests', 'settings', 'mtypes', 'catalogue'],
  quality: ['home', 'myapprovals', 'risks', 'quality', 'pid', 'plan', 'eco', 'plm', 'drawings', 'bom', 'approvals', 'deliveries', 'stock', 'settings', 'mtypes', 'catalogue'],
  procurement: ['home', 'myapprovals', 'procurement', 'orders', 'deliveries', 'stock', 'bom', 'plm', 'eco', 'resources', 'settings'],
  // R-044 (P-4, P-12 c, C-9): Finance — the contract (edited on every project), billing, budget and hours (read), the rate
  // grid, the portfolio's money screens; plan (own activities' % only, P-9a), My work, leave and meetings because the
  // persona owns activities and tasks. No Prioritisation: scoring and weights are not decided for Finance.
  finance: ['home', 'overview', 'cash', 'contract', 'billing', 'budget', 'hours', 'rates', 'plan', 'mywork', 'task', 'leave', 'meetings'],
  // R-158 (owner's decisions 7 and 1, 25 Oct 2026): Logistics — the Shipments screen (edited on every project) and what a
  // shipment needs, read-only (`roleReadOnly`, src/domain/rights.ts): the project BOM, the Site, the Schedule, the suppliers'
  // Deliveries; Settings for the Incoterms (edited by the director). No Contract, Budget or Billing: the contract's Incoterm is
  // shown on the Shipments screen; nothing financial beyond the shipment's customs values.
  logistics: ['home', 'shipments', 'bom', 'site', 'schedule', 'deliveries', 'settings', 'leave'],
  client: ['home', 'myapprovals', 'client', 'trends', 'changes', 'quality'],
};
// Machine catalogue (owner, 25 Oct 2026): the roles of the Machine types screen (director, PM, engineering lead, quality); the
// director and the engineering lead edit it (`canEditCatalogue`), the PM and quality read. Finance and procurement open it
// read-only outside their workspace; the client is refused (R-042).
const ENG: ScreenId[] = ['eng', 'eng-process', 'eng-meca', 'eng-elec', 'eng-auto'];
for (const k of ['pm', 'englead', 'quality'] as const) base[k].push(...ENG);
base.pm.push('site', 'shipments', 'meetings', 'contract', 'billing', 'stakeholders', 'itp', 'interfaces', 'contingency', 'commissioning', 'rex', 'hours', 'fleet', 'sav');
base.englead.push('leave', 'meetings', 'interfaces', 'itp', 'commissioning', 'rex');
base.quality.push('leave', 'meetings', 'itp', 'commissioning', 'rex', 'sav', 'fleet');
base.depthead.push('meetings', 'hours');
// P-4 (R-044): the contract is edited by the director, Finance and the project's PMs — procurement no longer has it.
base.procurement.push('leave', 'meetings', 'sav', 'fleet');
// R-158: procurement follows the shipments of the equipment it bought (Shipments in its workspace; edits as a project lead only).
base.procurement.push('shipments');
base.member.push('meetings');
// R-158 lot B (decision 5): the site team points the reception of the shipments on site (Shipments in its workspace; the rest
// of the screen read-only — `canRecordReception`, src/domain/rights.ts).
base.member.push('shipments');
// P-9a (R-061): activity owners enter the progress of their activities on the Plan — the team member and procurement own
// activities (OWN) but had no Plan; they now have it, read-only except the % complete of their own activities.
base.member.push('plan');
base.procurement.push('plan');
// P-8b (R-089): an approved request for a contract role becomes a task for procurement to find and name the person — procurement
// gets My work (and the task sheet) to work it. A consequence of the answer, listed for the owner to confirm.
base.procurement.push('mywork');
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
