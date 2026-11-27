// Project confidentiality and the project team (owner's decisions of 27 Nov 2026, ING-29; docs/delivery-9/notes-confidentiality.md).
//
// « Tous les projets industriels ou R&D doivent être dans Keystone ; c'est donc Keystone qui donnera le niveau de confidentialité à
// Ingenium et aux autres softs » — a project is `normal` (default, every existing project) or `confidential`; Keystone publishes
// it at the end of pub_projets (`confidentialite`: normal | confidentiel).
// « Quand une personne de l'ingénierie est appelée dans l'équipe projet (affectée à une tâche ou ajoutée à la liste des parties
// prenantes) alors le projet apparaît dans Ingenium. Keystone publie qui fait partie de l'équipe des projets » — the project's
// TEAM is the union of its named team (R-041: PM of record, co-PMs, deputies, referents, members — the people the project's lead
// added), the people assigned to one of its tasks (task assignee, or named on a planning activity) and its stakeholders who are internal persons; published in
// pub_equipes_projets (one row per person and origin).
// ING-29: a confidential project is seen only by its team; for anybody else it is absent from every list, search, counter,
// export and portfolio aggregate, and its pages answer 404. The portfolio director is NOT an exception (default
// DIRECTOR_SEES_CONFIDENTIAL = false, open question for the owner): a director sees a confidential project once on its team.
// Pure rules here; the data layer (src/server/dal/project-visibility.ts) feeds them.
import type { RoleKey } from '@/config/screens';
import type { ProjectAccess } from './rights';

export const PROJECT_CONFIDENTIALITIES = ['normal', 'confidential'] as const;
export type ProjectConfidentiality = (typeof PROJECT_CONFIDENTIALITIES)[number];
export const DEFAULT_PROJECT_CONFIDENTIALITY: ProjectConfidentiality = 'normal';
export const isProjectConfidentiality = (v: unknown): v is ProjectConfidentiality =>
  typeof v === 'string' && (PROJECT_CONFIDENTIALITIES as readonly string[]).includes(v);

/** EN source labels (t()). */
export const PROJECT_CONFIDENTIALITY_LABEL: Record<ProjectConfidentiality, string> = { normal: 'Not confidential', confidential: 'Confidential' };

/** Published value of `pub_projets.confidentialite` (French, like the other published states). */
export const PUBLISHED_CONFIDENTIALITY: Record<ProjectConfidentiality, 'normal' | 'confidentiel'> = { normal: 'normal', confidential: 'confidentiel' };

/** Default (27 Nov 2026, open for the owner): the portfolio director sees a confidential project only when on its team. */
export const DIRECTOR_SEES_CONFIDENTIAL = false;

/** Where a person's place in the project team comes from (`pub_equipes_projets.origine`). */
export const TEAM_ORIGINS = ['equipe', 'affectation', 'partie_prenante'] as const;
export type TeamOrigin = (typeof TEAM_ORIGINS)[number];

/** One fact that puts a person in a project's team. */
export interface TeamFact {
  personId: string;
  /** persons.short_name ("R. Aubert"): how the demo personas are matched. */
  short: string;
  origin: TeamOrigin;
  /** Named team role (pm, deputy…), the stakeholder's role as typed; null for a task assignment. */
  role: string | null;
}

/** Facts of one project, as read from the database. */
export interface ProjectTeamSources {
  /** PM of record (projects.pm_person_id). */
  pm: { personId: string; short: string } | null;
  /** project_members rows (the people the project's lead added). */
  members: readonly { personId: string; short: string; role: string }[];
  /** People assigned to the project's work: task assignees (tasks.assignee_person_id) and named planning assignments (activity_assignments.person_id). */
  assignees: readonly { personId: string; short: string }[];
  /** Stakeholders linked to a person (stakeholders.person_id), with whether that person is internal (no client organisation). */
  stakeholders: readonly { personId: string; short: string; role: string; internal: boolean }[];
}

/**
 * The project's team: one fact per person and origin (a person may be on the named team AND assigned to a task). Order: named
 * team (PM of record first), then assignees, then internal stakeholders; external contacts (client people) are never on it.
 */
export function projectTeam(s: ProjectTeamSources): TeamFact[] {
  const out: TeamFact[] = [];
  const seen = new Set<string>();
  const push = (f: TeamFact) => {
    const k = `${f.personId}|${f.origin}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };
  if (s.pm) push({ personId: s.pm.personId, short: s.pm.short, origin: 'equipe', role: 'pm' });
  for (const m of s.members) push({ personId: m.personId, short: m.short, origin: 'equipe', role: m.role });
  for (const a of s.assignees) push({ personId: a.personId, short: a.short, origin: 'affectation', role: null });
  for (const st of s.stakeholders) if (st.internal) push({ personId: st.personId, short: st.short, origin: 'partie_prenante', role: st.role || null });
  return out;
}

/** The viewer as this rule sees it (a signed-in user by person, a demo persona by short name). */
export interface VisibilityViewer {
  role: RoleKey;
  personId: string | null;
  short: string;
}

/** Is the viewer on the project's team (any origin)? */
export const onProjectTeam = (v: VisibilityViewer, team: readonly Pick<TeamFact, 'personId' | 'short'>[]) =>
  team.some((f) => (v.personId ? f.personId === v.personId : f.short === v.short));

/** Can the viewer see the project at all (lists, search, counters, exports, aggregates, pages)? */
export function canSeeProject(v: VisibilityViewer, confidentiality: ProjectConfidentiality, team: readonly Pick<TeamFact, 'personId' | 'short'>[]): boolean {
  if (confidentiality !== 'confidential') return true;
  if (DIRECTOR_SEES_CONFIDENTIAL && v.role === 'director') return true;
  return onProjectTeam(v, team);
}

/**
 * Who sets a project's confidentiality: its leads (PM of record, co-PM, deputy) and the director — the director only on a project
 * it sees (a confidential one: once on its team). Audited.
 */
export const canSetConfidentiality = (role: RoleKey, a: Pick<ProjectAccess, 'lead'>) => role === 'director' || a.lead;
