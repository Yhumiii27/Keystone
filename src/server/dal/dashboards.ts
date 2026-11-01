import 'server-only';
// R-203 (K-203, owner 1 Nov 2026): the users' dashboards (src/server/db/schema/dashboards.ts; rules: src/domain/dashboards.ts).
// Reads: a user's own dashboards and the ones shared with them. Writers (create, rename, save the layout, set as default,
// share, copy, delete) take the acting user's account — resolved by the caller from the viewer, never from the request — and
// re-check ownership, the limits and the layout (zod schema + the widgets the owner's role may add) inside their transaction.
// Every change writes an audit row (R-168: before / after). No activity-feed line: a dashboard is a personal setting, not a
// project or portfolio event (décision prise sans demander, docs/delivery-9/notes-r203-dashboards.md).
import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { RoleKey } from '@/config/screens';
import { sortRoles } from '@/domain/auth';
import {
  DASHBOARDS_PER_USER_MAX, DASHBOARD_SHARES_MAX, EMPTY_LAYOUT, canSeeWidget, canUseDashboards, cleanDashboardName, forbiddenWidget, layoutSchema, parseLayout,
  type DashboardLayout,
} from '@/domain/dashboards';
import { isInternalUser } from '@/domain/delegations';
import { getDb } from '@/server/db/client';
import { writeAudit } from '@/server/db/helpers';
import { dashboardShares, dashboards, persons, users } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';

type Q = DB | Tx;

export interface DashboardPerson {
  userId: string;
  name: string;
  /** EN source string (the user's title). */
  title: string;
}

export interface DashboardSummary {
  id: string;
  /** Typed by the owner (dataText). */
  name: string;
  ownerUserId: string;
  ownerName: string;
  /** The reader owns it (false = shared with them, read-only). */
  own: boolean;
  isDefault: boolean;
  /** People it is shared with (the owner's view only; [] for a recipient). */
  sharedWith: DashboardPerson[];
  updatedAt: string;
}

export interface DashboardRecord extends DashboardSummary {
  layout: DashboardLayout;
  /** False when the stored layout no longer validates (shown empty, never trusted). */
  layoutValid: boolean;
}

/** Who acts: the user account (resolved from the viewer by the caller), their active role and display name. */
export interface DashboardActor {
  userId: string;
  role: RoleKey;
  name: string;
  personId?: string | null;
}

export type DashboardRefusal = 'unknown' | 'not_owner' | 'limit' | 'name' | 'layout' | 'forbidden_widget' | 'recipient' | 'role';

/** EN source messages of the refusals (the page shows them with toast showEn). */
export const DASHBOARD_ERRORS: Record<DashboardRefusal, string> = {
  unknown: 'This dashboard does not exist any more',
  not_owner: 'Only its owner can change this dashboard',
  limit: 'You have reached the maximum number of dashboards',
  name: 'Enter a name (80 characters at most)',
  layout: 'The dashboard layout is not valid',
  forbidden_widget: 'This widget shows data outside your workspace',
  recipient: 'Dashboards are shared with active internal users only',
  role: 'My dashboards is not available for your role',
};

export class DashboardRefused extends Error {
  constructor(readonly code: DashboardRefusal) {
    super(DASHBOARD_ERRORS[code]);
  }
}

const nameOfPerson = (p: { fullName: string | null; shortName: string }) => p.fullName ?? p.shortName;

async function sharesOf(q: Q, ids: string[]): Promise<Map<string, DashboardPerson[]>> {
  const out = new Map<string, DashboardPerson[]>();
  if (!ids.length) return out;
  const rows = await q
    .select({ dashboardId: dashboardShares.dashboardId, userId: users.id, title: users.title, fullName: persons.fullName, shortName: persons.shortName })
    .from(dashboardShares)
    .innerJoin(users, eq(users.id, dashboardShares.userId))
    .innerJoin(persons, eq(persons.id, users.personId))
    .where(inArray(dashboardShares.dashboardId, ids))
    .orderBy(asc(users.sortOrder));
  for (const r of rows) (out.get(r.dashboardId) ?? out.set(r.dashboardId, []).get(r.dashboardId)!).push({ userId: r.userId, name: nameOfPerson(r), title: r.title });
  return out;
}

type Row = { d: typeof dashboards.$inferSelect; ownerFull: string | null; ownerShort: string };

async function selectRows(q: Q, where: ReturnType<typeof and>): Promise<Row[]> {
  return q
    .select({ d: dashboards, ownerFull: persons.fullName, ownerShort: persons.shortName })
    .from(dashboards)
    .innerJoin(users, eq(users.id, dashboards.ownerUserId))
    .innerJoin(persons, eq(persons.id, users.personId))
    .where(where)
    .orderBy(desc(dashboards.isDefault), asc(dashboards.createdAt), asc(dashboards.id));
}

/** Ids of the dashboards shared with a user. */
const sharedIdsSql = (userId: string) => sql`${dashboards.id} in (select ${dashboardShares.dashboardId} from ${dashboardShares} where ${dashboardShares.userId} = ${userId})`;

function toRecord(r: Row, readerUserId: string, shares: Map<string, DashboardPerson[]>): DashboardRecord {
  const own = r.d.ownerUserId === readerUserId;
  const layout = parseLayout(r.d.layout);
  return {
    id: r.d.id, name: r.d.name, ownerUserId: r.d.ownerUserId, ownerName: r.ownerFull ?? r.ownerShort, own, isDefault: own && r.d.isDefault,
    sharedWith: own ? (shares.get(r.d.id) ?? []) : [], updatedAt: r.d.updatedAt.toISOString(), layout: layout ?? EMPTY_LAYOUT, layoutValid: !!layout,
  };
}

/** A user's dashboards: their own (default first, then by creation), then the ones shared with them (by creation). */
export async function listDashboardsOf(userId: string, q?: Q): Promise<DashboardRecord[]> {
  const db = q ?? (await getDb());
  const rows = await selectRows(db, or(eq(dashboards.ownerUserId, userId), sharedIdsSql(userId)));
  const shares = await sharesOf(db, rows.filter((r) => r.d.ownerUserId === userId).map((r) => r.d.id));
  const all = rows.map((r) => toRecord(r, userId, shares));
  return [...all.filter((d) => d.own), ...all.filter((d) => !d.own)];
}

/** One dashboard the user owns or that is shared with them; null otherwise (an unknown id and a foreign one look the same). */
export async function getDashboardFor(id: string, userId: string, q?: Q): Promise<DashboardRecord | null> {
  const db = q ?? (await getDb());
  const [row] = await selectRows(db, and(eq(dashboards.id, id), or(eq(dashboards.ownerUserId, userId), sharedIdsSql(userId))));
  if (!row) return null;
  return toRecord(row, userId, await sharesOf(db, row.d.ownerUserId === userId ? [row.d.id] : []));
}

/** People a dashboard can be shared with: active internal accounts (never a client or an external user), the owner excepted. */
export async function dashboardShareCandidates(exceptUserId: string, q?: Q): Promise<DashboardPerson[]> {
  const db = q ?? (await getDb());
  const rows = await db
    .select({ id: users.id, roles: users.roles, external: users.isExternal, clientId: users.clientId, title: users.title, fullName: persons.fullName, shortName: persons.shortName })
    .from(users)
    .innerJoin(persons, eq(persons.id, users.personId))
    .where(and(eq(users.active, true), ne(users.id, exceptUserId)))
    .orderBy(asc(users.sortOrder));
  return rows
    .filter((r) => !r.clientId && isInternalUser({ roles: sortRoles(r.roles), external: r.external }))
    .map((r) => ({ userId: r.id, name: nameOfPerson(r), title: r.title }));
}

// ── Writers ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A layout the actor may store: valid (zod) and made of widgets their role may add. Throws DashboardRefused. */
function checkedLayout(actor: DashboardActor, layout: unknown): DashboardLayout {
  const r = layoutSchema.safeParse(layout);
  if (!r.success) throw new DashboardRefused('layout');
  if (forbiddenWidget(actor.role, r.data)) throw new DashboardRefused('forbidden_widget');
  return r.data;
}

async function ownDashboard(tx: Tx, id: string, actor: DashboardActor): Promise<typeof dashboards.$inferSelect> {
  if (!canUseDashboards(actor.role)) throw new DashboardRefused('role');
  const [d] = await tx.select().from(dashboards).where(eq(dashboards.id, id));
  if (!d) throw new DashboardRefused('unknown');
  if (d.ownerUserId !== actor.userId) {
    // A recipient learns it is not theirs; anybody else that it does not exist.
    const [s] = await tx.select({ u: dashboardShares.userId }).from(dashboardShares).where(and(eq(dashboardShares.dashboardId, id), eq(dashboardShares.userId, actor.userId)));
    throw new DashboardRefused(s ? 'not_owner' : 'unknown');
  }
  return d;
}

const audit = (tx: Tx, actor: DashboardActor, d: { id: string; name: string }, change: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null) =>
  writeAudit(tx, {
    actorName: actor.name, actorPersonId: actor.personId ?? null, actorUserId: actor.userId, objectRef: `Dashboard “${d.name}”`, area: 'My dashboards',
    entityType: 'dashboards', entityId: d.id, change, before, after,
  });

const layoutDigest = (l: DashboardLayout) => ({ widgets: l.widgets.map((w) => w.kind + ('project' in w && w.project ? `:${w.project}` : '')) });

/** Creates a dashboard (empty, or with a layout); the user's first dashboard becomes their default. Returns its id. */
export async function createDashboard(actor: DashboardActor, input: { name: unknown; layout?: unknown }): Promise<string> {
  if (!canUseDashboards(actor.role)) throw new DashboardRefused('role');
  const name = cleanDashboardName(input.name);
  if (!name) throw new DashboardRefused('name');
  const layout = input.layout === undefined ? EMPTY_LAYOUT : checkedLayout(actor, input.layout);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(dashboards).where(eq(dashboards.ownerUserId, actor.userId));
    if (n >= DASHBOARDS_PER_USER_MAX) throw new DashboardRefused('limit');
    const [row] = await tx.insert(dashboards).values({ ownerUserId: actor.userId, name, layout, isDefault: n === 0 }).returning({ id: dashboards.id });
    await audit(tx, actor, { id: row.id, name }, 'dashboard created', null, { name, ...layoutDigest(layout), isDefault: n === 0 });
    return row.id;
  });
}

/** Renames a dashboard and / or replaces its layout (the owner only). */
export async function updateDashboard(id: string, actor: DashboardActor, input: { name?: unknown; layout?: unknown }): Promise<void> {
  const name = input.name === undefined ? undefined : cleanDashboardName(input.name);
  if (name === null) throw new DashboardRefused('name');
  const layout = input.layout === undefined ? undefined : checkedLayout(actor, input.layout);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const d = await ownDashboard(tx, id, actor);
    const set: Partial<typeof dashboards.$inferInsert> = { updatedAt: new Date() };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (name !== undefined && name !== d.name) {
      set.name = name;
      before.name = d.name;
      after.name = name;
    }
    if (layout) {
      const old = parseLayout(d.layout) ?? EMPTY_LAYOUT;
      if (JSON.stringify(old) !== JSON.stringify(layout)) {
        set.layout = layout;
        Object.assign(before, layoutDigest(old));
        Object.assign(after, layoutDigest(layout));
        // The audit keeps the full layouts too (what each widget showed), not only the kinds.
        before.layout = old;
        after.layout = layout;
      }
    }
    if (!Object.keys(after).length) return;
    await tx.update(dashboards).set(set).where(eq(dashboards.id, id));
    await audit(tx, actor, { id, name: name ?? d.name }, after.name && after.layout ? 'renamed and layout changed' : after.name ? 'renamed' : 'layout changed', before, after);
  });
}

/** Makes a dashboard the owner's default (opened first on My dashboards). */
export async function setDefaultDashboard(id: string, actor: DashboardActor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const d = await ownDashboard(tx, id, actor);
    if (d.isDefault) return;
    const [prev] = await tx.select({ id: dashboards.id, name: dashboards.name }).from(dashboards).where(and(eq(dashboards.ownerUserId, actor.userId), eq(dashboards.isDefault, true)));
    await tx.update(dashboards).set({ isDefault: false }).where(and(eq(dashboards.ownerUserId, actor.userId), eq(dashboards.isDefault, true)));
    await tx.update(dashboards).set({ isDefault: true }).where(eq(dashboards.id, id));
    await audit(tx, actor, d, 'set as default dashboard', { default: prev?.name ?? null }, { default: d.name });
  });
}

/**
 * Replaces the people a dashboard is shared with (the owner only): active internal users, never the owner, at most
 * DASHBOARD_SHARES_MAX. Recipients read it with their own rights (src/server/dal/dashboard-data.ts).
 */
export async function shareDashboard(id: string, actor: DashboardActor, userIds: readonly string[]): Promise<void> {
  const wanted = [...new Set(userIds)];
  if (wanted.length > DASHBOARD_SHARES_MAX) throw new DashboardRefused('recipient');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const d = await ownDashboard(tx, id, actor);
    const allowed = new Map((await dashboardShareCandidates(actor.userId, tx)).map((p) => [p.userId, p]));
    if (wanted.some((u) => !allowed.has(u))) throw new DashboardRefused('recipient');
    const current = (await sharesOf(tx, [id])).get(id) ?? [];
    const cur = new Set(current.map((p) => p.userId));
    const next = new Set(wanted);
    if (cur.size === next.size && [...cur].every((u) => next.has(u))) return;
    await tx.delete(dashboardShares).where(eq(dashboardShares.dashboardId, id));
    if (wanted.length) await tx.insert(dashboardShares).values(wanted.map((userId) => ({ dashboardId: id, userId })));
    await tx.update(dashboards).set({ updatedAt: new Date() }).where(eq(dashboards.id, id));
    await audit(tx, actor, d, wanted.length ? `shared with ${wanted.length} ${wanted.length > 1 ? 'people' : 'person'}` : 'no longer shared',
      { sharedWith: current.map((p) => p.name) }, { sharedWith: wanted.map((u) => allowed.get(u)!.name) });
  });
}

/**
 * Copies a dashboard the user owns or that is shared with them into a new dashboard of their own ("Copy of …"). Only the
 * widgets the user's role may add are copied; returns the new id and the number of widgets left out.
 */
export async function copyDashboard(id: string, actor: DashboardActor, name?: unknown): Promise<{ id: string; dropped: number }> {
  if (!canUseDashboards(actor.role)) throw new DashboardRefused('role');
  const src = await getDashboardFor(id, actor.userId);
  if (!src) throw new DashboardRefused('unknown');
  const widgets = src.layout.widgets.filter((w) => canSeeWidget(actor.role, w));
  const copyName = cleanDashboardName(name ?? `${src.name.slice(0, 60)} (copy)`);
  if (!copyName) throw new DashboardRefused('name');
  const newId = await createDashboard(actor, { name: copyName, layout: { version: 1, widgets } });
  return { id: newId, dropped: src.layout.widgets.length - widgets.length };
}

/** Deletes a dashboard (the owner only); its shares go with it. The default moves to the owner's oldest remaining dashboard. */
export async function deleteDashboard(id: string, actor: DashboardActor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const d = await ownDashboard(tx, id, actor);
    const recipients = (await sharesOf(tx, [id])).get(id) ?? [];
    await tx.delete(dashboards).where(eq(dashboards.id, id));
    if (d.isDefault) {
      const [next] = await tx.select({ id: dashboards.id }).from(dashboards).where(eq(dashboards.ownerUserId, actor.userId)).orderBy(asc(dashboards.createdAt), asc(dashboards.id)).limit(1);
      if (next) await tx.update(dashboards).set({ isDefault: true }).where(eq(dashboards.id, next.id));
    }
    await audit(tx, actor, d, 'dashboard deleted', { name: d.name, ...layoutDigest(parseLayout(d.layout) ?? EMPTY_LAYOUT), sharedWith: recipients.map((p) => p.name) }, null);
  });
}
