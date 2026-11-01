// R-203 (K-203): My dashboards on the seeded in-memory database with the real session ("View as" cookie). A user creates,
// lays out, renames, shares, copies and deletes their dashboards through the Server Functions; the widgets are resolved for
// the VIEWER: a dashboard shared with someone never shows them a figure, a name or a row their own role could not see —
// checked for every persona. Writes are audited; a client is refused; someone else's dashboard cannot be changed.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({
  redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); },
  useRouter: () => ({ push() {}, prefetch() {}, refresh() {} }), usePathname: () => '/my/dashboards',
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { and, eq } from 'drizzle-orm';
import { PERSONA_BY_ROLE, PERSONAS } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { WIDGET_KINDS, canSeeWidget, defaultWidget, type DashboardLayout, type Widget } from '@/domain/dashboards';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries, dashboards, users } from '@/server/db/schema';
import { resolveWidgets } from '@/server/dal/dashboard-data';
import { getDashboardFor, listDashboardsOf } from '@/server/dal/dashboards';
import { COOKIE } from '@/server/session';
import {
  copyDashboardAction, createDashboardAction, deleteDashboardAction, saveDashboardAction, setDefaultDashboardAction, shareDashboardAction,
} from './actions';

const as = (role: RoleKey) => jar.set(COOKIE.role, role);
const userOf = async (role: RoleKey) => {
  const [u] = await (await getDb()).select({ id: users.id }).from(users).where(eq(users.personaRole, role));
  return u.id;
};
const okId = (r: Awaited<ReturnType<typeof createDashboardAction>>) => {
  expect(r).toMatchObject({ ok: true });
  return (r as { id: string }).id;
};

/** One widget of every kind (and every metric of the KPI kinds) on Harbor Line. */
function everyWidget(): DashboardLayout {
  const widgets: Widget[] = [];
  let i = 0;
  for (const d of WIDGET_KINDS) {
    const base = defaultWidget(d.kind, { role: 'director', project: 'HLT-026' });
    const metrics = d.kind === 'portfolio-kpi' ? ['budget', 'cpi', 'risk'] : d.kind === 'my-kpi' ? ['openTasks', 'overdueTasks', 'pendingApprovals'] : d.kind === 'project-kpi' ? ['progress', 'cpi', 'openRisks', 'riskExposure', 'openPunch', 'lateMilestones'] : [null];
    for (const m of metrics) widgets.push({ ...base, ...(m ? { metric: m } : {}), id: `w${++i}` } as Widget);
  }
  return { version: 1, widgets };
}

describe('R-203 — user dashboards', () => {
  let director = '';
  let directorUser = '';
  let memberUser = '';

  beforeAll(async () => {
    setDb(await openDatabase());
    directorUser = await userOf('director');
    memberUser = await userOf('member');
  }, 60_000);

  it('the director creates a dashboard (first = default) and lays out every kind of widget; the writes are audited', async () => {
    as('director');
    director = okId(await createDashboardAction({ name: '  Pilotage   portefeuille ' }));
    expect(await saveDashboardAction({ id: director, layout: everyWidget() })).toMatchObject({ ok: true, toast: 'Dashboard saved' });
    const d = (await getDashboardFor(director, directorUser))!;
    expect(d).toMatchObject({ name: 'Pilotage portefeuille', own: true, isDefault: true, layoutValid: true });
    expect(d.layout.widgets).toHaveLength(everyWidget().widgets.length);
    const audit = await (await getDb()).select().from(auditEntries).where(and(eq(auditEntries.entityType, 'dashboards'), eq(auditEntries.entityId, director)));
    expect(audit.map((a) => a.change)).toEqual(['dashboard created', 'layout changed']);
    expect(audit[1]).toMatchObject({ actorName: 'Marie Lefebvre', area: 'My dashboards', actorUserId: directorUser });
    expect((audit[1].after as { widgets: string[] }).widgets).toContain('project-risks:HLT-026');
  });

  it('the director sees every widget filled with the screens’ own figures', async () => {
    const d = (await getDashboardFor(director, directorUser))!;
    const r = await resolveWidgets(PERSONA_BY_ROLE.director, d.layout.widgets, 'en');
    expect(r.filter((x) => x.data.state !== 'ok').map((x) => x.widget.kind)).toEqual([]);
    const kpi = (kind: string, metric: string) => {
      const x = r.find((y) => y.widget.kind === kind && 'metric' in y.widget && y.widget.metric === metric)!.data;
      return x.state === 'ok' && x.view.type === 'kpi' ? x.view.kpi : null;
    };
    // Same tile as the Portfolio overview's "Cost perf. (CPI)".
    expect(kpi('portfolio-kpi', 'cpi')?.label).toBe('Cost perf. (CPI)');
    expect(kpi('project-kpi', 'openRisks')?.sub).toContain('Harbor Line');
  });

  it('refusals: bad name, invalid layout, a widget outside the role, someone else’s dashboard, a client', async () => {
    as('director');
    expect(await createDashboardAction({ name: '   ' })).toEqual({ ok: false, error: 'Enter a name (80 characters at most)' });
    expect(await saveDashboardAction({ id: director, layout: { version: 1, widgets: [{ id: 'a', kind: 'sql', size: 's' }] } })).toEqual({ ok: false, error: 'The dashboard layout is not valid' });
    expect(await saveDashboardAction({ id: 'not-an-id', name: 'x' })).toEqual({ ok: false, error: 'Invalid request' });
    as('member');
    const mine = okId(await createDashboardAction({ name: 'Mon suivi' }));
    const portfolio: DashboardLayout = { version: 1, widgets: [{ id: 'a', kind: 'portfolio-kpi', size: 's', metric: 'eac', scope: 'all', zone: null }] };
    expect(await saveDashboardAction({ id: mine, layout: portfolio })).toEqual({ ok: false, error: 'This widget shows data outside your workspace' });
    // The director's dashboard is not shared with the member yet: it "does not exist" for them.
    expect(await saveDashboardAction({ id: director, name: 'Pris' })).toEqual({ ok: false, error: 'This dashboard does not exist any more' });
    expect(await deleteDashboardAction({ id: director })).toEqual({ ok: false, error: 'This dashboard does not exist any more' });
    expect(await getDashboardFor(director, memberUser)).toBeNull();
    as('client');
    await expect(createDashboardAction({ name: 'Client' })).rejects.toThrow('REDIRECT /');
  });

  it('sharing: only active internal users; the recipient reads it, cannot change it, and sees only what their role allows', async () => {
    as('director');
    expect(await shareDashboardAction({ id: director, userIds: [await userOf('client')] })).toEqual({ ok: false, error: 'Dashboards are shared with active internal users only' });
    expect(await shareDashboardAction({ id: director, userIds: [directorUser] })).toEqual({ ok: false, error: 'Dashboards are shared with active internal users only' });
    expect(await shareDashboardAction({ id: director, userIds: [memberUser] })).toMatchObject({ ok: true });
    expect((await getDashboardFor(director, directorUser))!.sharedWith.map((p) => p.name)).toEqual(['Julien Wagner']);

    const listed = (await listDashboardsOf(memberUser)).find((d) => d.id === director)!;
    expect(listed).toMatchObject({ own: false, isDefault: false, ownerName: 'Marie Lefebvre', sharedWith: [] });
    as('member');
    expect(await saveDashboardAction({ id: director, name: 'Pris' })).toEqual({ ok: false, error: 'Only its owner can change this dashboard' });
    expect(await shareDashboardAction({ id: director, userIds: [] })).toEqual({ ok: false, error: 'Only its owner can change this dashboard' });
    expect(await setDefaultDashboardAction({ id: director })).toEqual({ ok: false, error: 'Only its owner can change this dashboard' });

    const member = await resolveWidgets(PERSONA_BY_ROLE.member, listed.layout.widgets, 'en');
    const director2 = await resolveWidgets(PERSONA_BY_ROLE.director, listed.layout.widgets, 'en');
    for (const [i, x] of member.entries()) {
      if (canSeeWidget('member', x.widget)) continue;
      expect(x.data, `${x.widget.kind}`).toEqual({ state: 'denied' });
      // Nothing of the director's figures reaches the member's page data.
      const theirs = director2[i].data;
      if (theirs.state === 'ok' && theirs.view.type === 'kpi') expect(JSON.stringify(member)).not.toContain(`"value":"${theirs.view.kpi.value}","sub":"${theirs.view.kpi.sub}"`);
    }
    expect(member.filter((x) => x.data.state === 'denied').map((x) => x.widget.kind)).toEqual(expect.arrayContaining(['portfolio-kpi', 'portfolio-alerts', 'project-risks', 'project-punch', 'project-evm', 'project-milestones']));
    // My counters are the member's own, not the director's.
    const counter = member.find((x) => x.widget.kind === 'my-kpi' && 'metric' in x.widget && x.widget.metric === 'openTasks')!.data;
    expect(counter.state).toBe('ok');
  });

  it('copy: the recipient copies the shared dashboard; the widgets outside their workspace are left out', async () => {
    as('member');
    const r = await copyDashboardAction({ id: director });
    expect(r).toMatchObject({ ok: true, toast: 'Dashboard copied — the widgets outside your workspace were left out' });
    const copy = (await getDashboardFor((r as { id: string }).id, memberUser))!;
    expect(copy).toMatchObject({ name: 'Pilotage portefeuille (copy)', own: true });
    expect(copy.layout.widgets.every((w) => canSeeWidget('member', w))).toBe(true);
    expect(copy.layout.widgets.length).toBeGreaterThan(0);
  });

  it.each(PERSONAS.map((p) => p.role).filter((r) => r !== 'client'))('%s: every widget of a shared dashboard is filled exactly when the role may see it', async (role) => {
    const r = await resolveWidgets(PERSONA_BY_ROLE[role], everyWidget().widgets, 'fr');
    for (const x of r) expect(x.data.state === 'denied', `${role} · ${x.widget.kind}`).toBe(!canSeeWidget(role, x.widget));
  });

  it('a project widget on an unknown project is unavailable, never an error', async () => {
    const [x] = await resolveWidgets(PERSONA_BY_ROLE.director, [{ id: 'a', kind: 'project-risks', size: 'm', project: 'NOPE-000', limit: 5 }], 'en');
    expect(x.data).toEqual({ state: 'unavailable' });
  });

  it('default, starter, delete: the default moves to the oldest remaining dashboard; shares go with the dashboard', async () => {
    as('director');
    const second = okId(await createDashboardAction({ name: 'Démarrage', starter: true }));
    const s = (await getDashboardFor(second, directorUser))!;
    expect(s.isDefault).toBe(false);
    expect(s.layout.widgets.map((w) => w.kind)).toEqual(expect.arrayContaining(['my-kpi', 'portfolio-kpi', 'portfolio-alerts', 'my-tasks']));
    expect(await setDefaultDashboardAction({ id: second })).toMatchObject({ ok: true });
    expect((await listDashboardsOf(directorUser)).filter((d) => d.isDefault).map((d) => d.id)).toEqual([second]);
    expect(await deleteDashboardAction({ id: second })).toMatchObject({ ok: true });
    expect((await listDashboardsOf(directorUser)).filter((d) => d.isDefault).map((d) => d.id)).toEqual([director]);
    expect(await deleteDashboardAction({ id: director })).toMatchObject({ ok: true });
    expect((await listDashboardsOf(memberUser)).some((d) => d.id === director)).toBe(false);
    expect(await (await getDb()).select().from(dashboards).where(eq(dashboards.id, director))).toEqual([]);
    const audit = await (await getDb()).select({ change: auditEntries.change }).from(auditEntries).where(eq(auditEntries.entityId, director));
    expect(audit.map((a) => a.change)).toEqual(expect.arrayContaining(['shared with 1 person', 'dashboard deleted']));
  });
});
