// Role access (ROLE_SCREENS, design lines 3465–3466): which screens each role sees in navigation. Kept apart from ./screens.ts
// (which imports the navigation icons) so server-side rules (src/domain/rights.ts) and scripts never load client components.
import type { RoleKey, ScreenId } from './screens';

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
