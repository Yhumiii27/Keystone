'use server';
// R-203 (K-203): Server Functions of My dashboards. Each one checks the screen (a client is sent home, R-042; an internal role
// outside its workspace cannot write), takes the acting user from the viewer (signed-in user, or the demo persona's user —
// never an id from the request), validates its input (ids, name, the layout through the zod schema of src/domain/
// dashboards.ts and the widgets the role may add), writes through the DAL (owner re-checked in the transaction, audit with
// before / after), then revalidates the screen. Messages are English source strings (the client shows them with showEn).
import { revalidatePath } from 'next/cache';
import { screenHref } from '@/config/screens';
import { canUseDashboards, starterLayout, type DashboardLayout } from '@/domain/dashboards';
import { dashboardProjectChoices } from '@/server/dal/dashboard-data';
import { getDb } from '@/server/db/client';
import {
  DASHBOARD_ERRORS, DashboardRefused, copyDashboard, createDashboard, deleteDashboard, setDefaultDashboard, shareDashboard, updateDashboard,
  type DashboardActor,
} from '@/server/dal/dashboards';
import { userIdOf } from '@/server/dal/users';
import { logError } from '@/server/log';
import { getScreenAccess } from '@/server/project-context';
import { getCurrentProject, getViewer } from '@/server/session';

export type DashboardResult = { ok: true; toast: string; id?: string } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = 'Invalid request';
const FAILED = 'The dashboard could not be saved';

const isId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The acting user, or an error result (client, outside the workspace, no user account). */
async function actor(): Promise<DashboardActor | DashboardResult> {
  const { viewer, canEdit } = await getScreenAccess('dashboards');
  if (!canEdit || !canUseDashboards(viewer.role)) return { ok: false, error: DASHBOARD_ERRORS.role };
  const userId = await userIdOf(await getDb(), viewer);
  if (!userId) return { ok: false, error: DASHBOARD_ERRORS.role };
  return { userId, role: viewer.role, name: viewer.name, personId: viewer.personId };
}

const isActor = (a: DashboardActor | DashboardResult): a is DashboardActor => 'userId' in a;

async function run(where: string, toast: string, f: (a: DashboardActor) => Promise<string | void>): Promise<DashboardResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  let id: string | void;
  try {
    id = await f(a);
  } catch (e) {
    if (e instanceof DashboardRefused) return { ok: false, error: DASHBOARD_ERRORS[e.code] };
    logError(where, e);
    return { ok: false, error: FAILED };
  }
  revalidatePath(screenHref('dashboards'));
  return { ok: true, toast, ...(id ? { id } : {}) };
}

/**
 * A new dashboard of the viewer's: empty, or (`starter`) with the widgets suggested to their role (`starterLayout`, the
 * current project's widgets on the shell's current project when the viewer can read it).
 */
export async function createDashboardAction(input: { name: unknown; starter?: unknown }): Promise<DashboardResult> {
  if (!isObject(input)) return { ok: false, error: INVALID };
  const starter = input.starter === true;
  return run('createDashboardAction', 'Dashboard created', async (a) => {
    let layout: DashboardLayout | undefined;
    if (starter) {
      const viewer = await getViewer();
      const code = await getCurrentProject();
      const readable = code ? (await dashboardProjectChoices(viewer, 'en')).some((p) => p.code === code) : false;
      layout = starterLayout(a.role, readable ? code : null);
    }
    return createDashboard(a, { name: input.name, layout });
  });
}

/** Renames a dashboard and / or saves its layout (add, remove, move, resize, filters of a widget). */
export async function saveDashboardAction(input: { id: unknown; name?: unknown; layout?: unknown }): Promise<DashboardResult> {
  if (!isObject(input) || !isId(input.id) || (input.name === undefined && input.layout === undefined)) return { ok: false, error: INVALID };
  const id = input.id;
  return run('saveDashboardAction', input.name !== undefined ? 'Dashboard renamed' : 'Dashboard saved', (a) => updateDashboard(id, a, { name: input.name, layout: input.layout }));
}

export async function setDefaultDashboardAction(input: { id: unknown }): Promise<DashboardResult> {
  if (!isObject(input) || !isId(input.id)) return { ok: false, error: INVALID };
  const id = input.id;
  return run('setDefaultDashboardAction', 'Default dashboard set', (a) => setDefaultDashboard(id, a));
}

/** Replaces the people the dashboard is shared with (read-only for them, with their own rights). */
export async function shareDashboardAction(input: { id: unknown; userIds: unknown }): Promise<DashboardResult> {
  if (!isObject(input) || !isId(input.id) || !Array.isArray(input.userIds) || input.userIds.length > 200 || !input.userIds.every(isId)) return { ok: false, error: INVALID };
  const id = input.id;
  const userIds = input.userIds as string[];
  return run('shareDashboardAction', userIds.length ? 'Sharing saved' : 'Dashboard no longer shared', (a) => shareDashboard(id, a, userIds));
}

/** Copies a dashboard (own, or shared with the viewer) into a new one of the viewer's; the widgets outside their workspace are left out. */
export async function copyDashboardAction(input: { id: unknown }): Promise<DashboardResult> {
  if (!isObject(input) || !isId(input.id)) return { ok: false, error: INVALID };
  const id = input.id;
  let dropped = 0;
  const r = await run('copyDashboardAction', 'Dashboard copied', async (a) => {
    const out = await copyDashboard(id, a);
    dropped = out.dropped;
    return out.id;
  });
  return r.ok && dropped ? { ...r, toast: 'Dashboard copied — the widgets outside your workspace were left out' } : r;
}

export async function deleteDashboardAction(input: { id: unknown }): Promise<DashboardResult> {
  if (!isObject(input) || !isId(input.id)) return { ok: false, error: INVALID };
  const id = input.id;
  return run('deleteDashboardAction', 'Dashboard deleted', (a) => deleteDashboard(id, a));
}
