import 'server-only';
// Screen reads of the Engineering synthesis and the four discipline screens (docs/spec/09 §7–8) and their sidebar
// badges. The register itself is read by src/server/dal/engineering.ts (`getEngineeringRegister`, null for a project
// without one: the screens' empty state); the badges count the open blocking checks per project and per owning
// discipline (`engNav_` 4815: Synthesis = all, each discipline = its own) — no badge on a project without a register.
import { blockingCounts, engBadges, type EngRegister, type EngScreen } from '@/domain/engineering';
import { engBlockingByProject, getEngineeringRegister } from './engineering';

/** The project's engineering register, or null (empty state). */
export async function getEngScreen(projectCode: string): Promise<EngRegister | null> {
  return getEngineeringRegister(projectCode);
}

/** Sidebar badges of the five engineering entries for one project: { eng: '4', 'eng-elec': '2', … } ('' = none). */
export async function engNavBadges(projectCode: string): Promise<Record<EngScreen, string>> {
  return engBadges((await engBlockingByProject())[projectCode] ?? null);
}

/** Sidebar badges of the engineering entries for every project with open blocking checks (one query, for the shell). */
export async function engNavBadgesByProject(): Promise<Record<string, Record<EngScreen, string>>> {
  const counts = await engBlockingByProject();
  return Object.fromEntries(Object.entries(counts).map(([code, c]) => [code, engBadges(c)]));
}

/** Badges computed from an already loaded register (the screens show the same numbers as the sidebar). */
export const engNavBadgesOf = (reg: EngRegister | null) => engBadges(blockingCounts(reg));
