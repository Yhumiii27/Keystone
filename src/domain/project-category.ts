// R-196 (Crucible K-3, owner's answer K-196 of 1 Nov 2026: « une nature de projet “R&D” choisie à la création du projet »): the
// project's category — a client project (default, every existing project) or an R&D project. Chosen in the New project wizard,
// changed afterwards by the project's leads and the director on the Contract screen (audited), published at the end of
// pub_projets (`categorie`) so Crucible filters the R&D projects.
//
// Distinct from `projects.kind` (published as `nature`: client project or internal non-project code from Cursus, Matrix D02 —
// its values stay a contract) and from the machine type « R&D » (what the project supplies, one per equipment line, R-185).
import type { RoleKey } from '@/config/screens';
import type { ProjectAccess } from './rights';
import { canSetCapexLink } from './rights';

export const PROJECT_CATEGORIES = ['client', 'rd'] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

export const DEFAULT_PROJECT_CATEGORY: ProjectCategory = 'client';

export const isProjectCategory = (v: unknown): v is ProjectCategory => typeof v === 'string' && (PROJECT_CATEGORIES as readonly string[]).includes(v);

/** EN source labels (t()). */
export const PROJECT_CATEGORY_LABEL: Record<ProjectCategory, string> = { client: 'Client project', rd: 'R&D project' };

/** EN source labels of the Projects register's filter (t()). */
export const PROJECT_CATEGORY_FILTER_LABEL: Record<ProjectCategory, string> = { client: 'Client projects', rd: 'R&D projects' };

/**
 * Who changes a project's category after its creation: the same people as its CAPEX link — the director and the project's leads
 * (PM of record, co-PM, deputy) who see the Contract screen; not Finance, not a team member, never the client.
 */
export const canSetProjectCategory = (role: RoleKey, a: Pick<ProjectAccess, 'lead'>) => canSetCapexLink(role, a);
