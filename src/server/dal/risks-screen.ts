import 'server-only';
// Screen-level reads of the Risk register and Contingency register (docs/spec/07 §2.1, 04 §5) on top of the
// data-layer getters (risks.ts, contingency.ts): the contingency the risk exposure is compared with, and the
// option lists of the two add-forms (TEAM owners; delivery 7, C-4: the items a draw-down can be linked to — the
// approver is no longer chosen, the portfolio director validates in My approvals).
import type { DrawLinkOption } from '@/domain/contingency';
import { drawLinkOptions, getContingency, type Contingency } from './contingency';
import { getScheduleControl } from './planning';
import { getProject } from './projects';
import { getResourcePool } from './resources';
import { getRiskRegister, type RiskRegister } from './risks';

/**
 * `TEAM` option list (afOpts, logic 5117): the project team (DEFS.team) for projects with data, else every person of
 * the resource pool (PEOPLE).
 */
export async function riskOwnerOptions(projectCode: string): Promise<string[]> {
  const control = await getScheduleControl(projectCode);
  if (control?.team.length) return control.team;
  return (await getResourcePool()).people.map((p) => p.name);
}

export interface RiskScreenData {
  register: RiskRegister;
  /**
   * Contingency the exposure KPI compares with (PD.recon.cont: HLT 150, DEFS.cont for the other projects with
   * data). Projects without data fall back to their contingency register (default round(BAC × 3 %)).
   */
  contingency: number;
  /** Owner options of "New risk". */
  team: string[];
}

/** Everything the Risk register page reads; null for an unknown project. */
export async function getRiskScreen(projectCode: string): Promise<RiskScreenData | null> {
  const [register, team] = await Promise.all([getRiskRegister(projectCode), riskOwnerOptions(projectCode)]);
  if (!register) return null;
  const contingency = register.contingency ?? (await getContingency(projectCode))?.initial ?? 0;
  return { register, contingency, team };
}

export interface ContingencyScreenData {
  contingency: Contingency;
  /** "Linked to" options (C-4): the project's change requests, risks and NCRs. */
  links: DrawLinkOption[];
}

/** Everything the Contingency register page reads; null for an unknown project. */
export async function getContingencyScreen(projectCode: string): Promise<ContingencyScreenData | null> {
  const [contingency, project, links] = await Promise.all([getContingency(projectCode), getProject(projectCode), drawLinkOptions(projectCode)]);
  if (!contingency || !project) return null;
  return { contingency, links };
}
