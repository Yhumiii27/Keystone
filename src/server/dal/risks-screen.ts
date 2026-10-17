import 'server-only';
// Screen-level reads of the Risk register and Contingency register (docs/spec/07 §2.1, 04 §5) on top of the
// data-layer getters (risks.ts, contingency.ts): the contingency the risk exposure is compared with, and the
// option lists of the two add-forms (TEAM owners; delivery 7, C-4: the items a draw-down can be linked to — the
// approver is no longer chosen, the portfolio director validates in My approvals).
import { eq } from 'drizzle-orm';
import type { DrawLinkOption } from '@/domain/contingency';
import { riskOwnersWithPm } from '@/domain/risk';
import { getDb } from '@/server/db/client';
import { nameOf } from '@/server/db/helpers';
import { persons, projects } from '@/server/db/schema';
import { drawLinkOptions, getContingency, type Contingency } from './contingency';
import { getScheduleControl } from './planning';
import { getProject } from './projects';
import { getResourcePool } from './resources';
import { getRiskRegister, type RiskRegister } from './risks';

/**
 * Owner options of "New risk" (afOpts `TEAM`, logic 5117): the project team (DEFS.team) for projects with data, else every
 * person of the resource pool (PEOPLE) — plus the project's PM of record when absent (R-121, owner's answer of 17 Oct 2026:
 * `riskOwnersWithPm`). Every "New risk" writer validates against this list (Risks, Meetings, Site).
 */
export async function riskOwnerOptions(projectCode: string): Promise<string[]> {
  const [control, pm] = await Promise.all([getScheduleControl(projectCode), projectPmName(projectCode)]);
  const base = control?.team.length ? control.team : (await getResourcePool()).people.map((p) => p.name);
  return riskOwnersWithPm(base, pm);
}

/** The PM of record's name as the owner lists show it (full name, else short name); null without one or for an unknown project. */
export async function projectPmName(projectCode: string): Promise<string | null> {
  const db = await getDb();
  const [r] = await db
    .select({ fullName: persons.fullName, shortName: persons.shortName })
    .from(projects)
    .innerJoin(persons, eq(persons.id, projects.pmPersonId))
    .where(eq(projects.code, projectCode));
  return r ? nameOf(r) : null;
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
