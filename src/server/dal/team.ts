import 'server-only';
// Screen-level reads of the Team & exchanges feature — Stakeholders & RACI (docs/spec/05 §6) and the Interface register
// (07 §2.5) — on top of the data-layer getters (stakeholders.ts, interfaces.ts): the TEAM option list of the two
// add-forms and the interfaces a commissioning step waits for.
import { PROTO } from '@/server/prototype';
import { listInterfaces, type InterfaceRow } from './interfaces';
import { getScheduleControl } from './planning';
import { getProject } from './projects';
import { getResourcePool } from './resources';
import { getStakeholderRegister, type StakeholderRegister } from './stakeholders';

/**
 * `TEAM` option list (afOpts, logic 5117): the project team (DEFS.team, full names) for projects with data, else every
 * person of the resource pool (PEOPLE).
 */
export async function teamOwnerOptions(projectCode: string): Promise<string[]> {
  const control = await getScheduleControl(projectCode);
  if (control?.team.length) return control.team;
  return (await getResourcePool()).people.map((p) => p.name);
}

export interface CommissioningBlocker {
  /** "IF-02". */
  number: string;
  /** Short English label of what is blocked ("HV cell"). */
  label: string;
}

/**
 * Short labels of the prototype's "Blocking commissioning" KPI sub ("HV cell · anti-collision zones", logic 4956).
 * TODO(db): commissioning (COMMISSIONING 3721) is not modelled yet — the steps waiting for an interface are read from
 * the prototype grid ("Blocked · IF-02"), and these labels go with them. Other blockers fall back to the interface title.
 */
const BLOCKER_LABEL: Record<string, string> = { 'IF-02': 'HV cell', 'IF-05': 'anti-collision zones' };

/** Interfaces a commissioning step of the project is blocked by (grid order: system by system, step by step). */
export function commissioningBlockers(projectCode: string, interfaces: readonly Pick<InterfaceRow, 'number' | 'title'>[]): CommissioningBlocker[] {
  // TODO(db): prototype COMMISSIONING grid until commissioning steps are modelled (blockingRef, docs/spec/11 §3.7).
  const grid = (PROTO.COMMISSIONING?.[projectCode]?.grid ?? {}) as Record<string, string[]>;
  const out: CommissioningBlocker[] = [];
  for (const cells of Object.values(grid))
    for (const cell of cells) {
      const m = /^Blocked · (IF-\d+)$/.exec(cell);
      if (!m || out.some((b) => b.number === m[1])) continue;
      const row = interfaces.find((i) => i.number === m[1]);
      if (row) out.push({ number: row.number, label: BLOCKER_LABEL[row.number] ?? row.title });
    }
  return out;
}

export interface StakeholdersScreenData {
  register: StakeholderRegister;
  /** "Relationship owner" options of "Add stakeholder" (TEAM, full names). */
  team: string[];
}

/** Everything the Stakeholders & RACI page reads; null for an unknown project. */
export async function getStakeholdersScreen(projectCode: string): Promise<StakeholdersScreenData | null> {
  if (!(await getProject(projectCode))) return null;
  const [register, team] = await Promise.all([getStakeholderRegister(projectCode), teamOwnerOptions(projectCode)]);
  return { register, team };
}

export interface InterfacesScreenData {
  interfaces: InterfaceRow[];
  /** Interfaces a commissioning step waits for (the "Blocking commissioning" KPI). */
  blockers: CommissioningBlocker[];
  /** "Owner" options of "New interface" (TEAM, full names). */
  team: string[];
}

/** Everything the Interface register page reads; null for an unknown project. */
export async function getInterfacesScreen(projectCode: string): Promise<InterfacesScreenData | null> {
  if (!(await getProject(projectCode))) return null;
  const [interfaces, team] = await Promise.all([listInterfaces(projectCode), teamOwnerOptions(projectCode)]);
  return { interfaces, blockers: commissioningBlockers(projectCode, interfaces), team };
}
