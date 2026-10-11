'use server';
// Project team Server Functions (R-041, P-2): add a person to the project's named team with a team role, change a member's role,
// remove a member. Who: the director and the project's PMs (PM of record, co-PMs — `canManageTeam`), with Project resources in
// their workspace and the project editable for them; the PM of record is changed in the Projects register, not here. Each one
// validates the raw input, writes through the team DAL (audit + activity), then revalidates every screen (rights change).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { PROJECT_TEAM_ROLE_LABEL, canManageTeam, isProjectTeamRole } from '@/domain/rights';
import { TeamError, addTeamMember, removeTeamMember, setTeamMemberRole, type TeamActor } from '@/server/dal/project-team';
import { getProject } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

export type TeamActionResult = { ok: true; toast?: string } | { error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_MANAGER = 'Only the project manager or the director changes the project team';

/** Toast / error text translated per " · " segment. */
async function tr(english: string) {
  const { t } = await getI18n();
  return english.split(' · ').map(t).join(' · ');
}

/** The project, after checking the viewer manages its team. */
async function manageable(code: unknown): Promise<{ code: string; actor: TeamActor } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: 'Invalid request' };
  const project = await getProject(code);
  if (!project) return { error: 'Unknown project' };
  const ctx = await getProjectContext(project.code, 'presources');
  if (!ctx.canEdit('presources') || !canManageTeam(ctx.viewer.role, ctx.access)) return { error: NOT_MANAGER };
  return { code: project.code, actor: { name: ctx.viewer.name, personId: ctx.viewer.personId } };
}

async function write(fn: () => Promise<void>): Promise<{ ok: true } | { error: string }> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof TeamError) return { error: e.message };
    console.error('project team', e);
    return { error: 'The change could not be saved' };
  }
}

/** Rights follow the team on every screen: refresh them all. */
const refresh = () => revalidatePath('/', 'layout');

/** "Add to team" (dialog: person, team role). */
export async function addTeamMemberAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const m = await manageable(code);
  if ('error' in m) return { error: await tr(m.error) };
  const personId = typeof values?.person === 'string' ? values.person : '';
  const role = values?.role;
  if (!UUID_RE.test(personId) || !isProjectTeamRole(role)) return { error: await tr('Invalid request') };
  const r = await write(() => addTeamMember(m.code, personId, role, m.actor));
  if ('error' in r) return { error: await tr(r.error) };
  refresh();
  return { toast: await tr(`Added to the project team · ${PROJECT_TEAM_ROLE_LABEL[role]}`) };
}

/** Role select of a member row. */
export async function setTeamMemberRoleAction(code: string, personId: string, role: string): Promise<TeamActionResult> {
  const m = await manageable(code);
  if ('error' in m) return { error: await tr(m.error) };
  if (typeof personId !== 'string' || !UUID_RE.test(personId) || !isProjectTeamRole(role)) return { error: await tr('Invalid request') };
  const r = await write(() => setTeamMemberRole(m.code, personId, role, m.actor));
  if ('error' in r) return { error: await tr(r.error) };
  refresh();
  return { ok: true, toast: await tr(`Team role changed · ${PROJECT_TEAM_ROLE_LABEL[role]}`) };
}

/** "Remove from team" of a member row (their tasks and history stay). */
export async function removeTeamMemberAction(code: string, personId: string): Promise<TeamActionResult> {
  const m = await manageable(code);
  if ('error' in m) return { error: await tr(m.error) };
  if (typeof personId !== 'string' || !UUID_RE.test(personId)) return { error: await tr('Invalid request') };
  const r = await write(() => removeTeamMember(m.code, personId, m.actor));
  if ('error' in r) return { error: await tr(r.error) };
  refresh();
  return { ok: true, toast: await tr('Removed from the project team') };
}
