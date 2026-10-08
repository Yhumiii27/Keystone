import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { approvalCount } from '@/server/approvals';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { markAllNotificationsRead, markNotificationRead } from './notifications';
import { crumbExtraOf, deepLink, defaultTitleOf, getShellNav, notificationsFor, projectBadges, searchShell, zoneBarOf } from './shell';

// Golden values need the pristine seed: use a fresh in-memory database, never the local ./.data one
// (which the running app mutates, e.g. a project created by the wizard changes the counts).
beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('shell badges (golden values, docs/spec/01 §4.3–4.4)', () => {
  it('director on HLT-026 matches the prototype initial badges', async () => {
    const nav = await getShellNav('director');
    const b = { ...nav.globalBadges, ...nav.projectBadges['HLT-026'] };
    // My tasks counts the viewer's own tasks due today (the prototype showed Hélène Sauvage's 2 to every persona,
    // docs/spec/00 §7.16): Marie Lefebvre has none.
    const want = {
      mywork: '', myapprovals: '5', docs: '1',
      meetings: '1', interfaces: '1', eng: '4', 'eng-elec': '2', 'eng-auto': '2', pid: '9', risks: '1', changes: '1',
      quality: '1', site: 'NO GO', eco: '1', procurement: '3', orders: '1', deliveries: '1', stock: '1', sav: '2',
      requests: '1', approvals: '2', plumbing: '!',
    };
    for (const [k, v] of Object.entries(want)) expect([k, b[k as keyof typeof b]]).toEqual([k, v]);
    for (const k of ['billing', 'itp', 'eng-process', 'eng-meca', 'contract', 'bom'] as const) expect([k, b[k] ?? '']).toEqual([k, '']);
  });

  it('My tasks badge and My work crumb follow the viewer, not a fixed person', async () => {
    expect((await getShellNav('member')).globalBadges.mywork).toBe('1'); // Julien Wagner: T-2305 due today
    expect(await crumbExtraOf('mywork', { role: 'member', code: 'HLT-026', zone: null })).toBe('Julien Wagner');
    expect(await crumbExtraOf('task', { role: 'member', code: 'HLT-026', zone: null, taskId: 'T-2320' })).toBe('T-2320');
    expect(await defaultTitleOf('task', { taskId: 'T-2314' })).toBe('Survey verticality — Bay 3 columns');
    expect(await defaultTitleOf('task', { taskId: 'T-9999' })).toBeNull();
    expect(await defaultTitleOf('approvals')).toBe('Approvals — Engineering');
    expect(await defaultTitleOf('approvals', { role: 'quality' })).toBe('Approvals — Quality');
    expect(await defaultTitleOf('plan')).toBeNull();
  });

  it("My approvals badge = the viewer's inbox (myapprovals providers, HLT-026)", async () => {
    // The quality manager heads Quality (RQ-042) and is the next Codex approver of RPT-HLT-014, besides the
    // BL-2026-0521 delivery QC: 3 items where the prototype's fixed routing gave 1 (docs/spec/08 §7, myapprovals report).
    const want: Record<RoleKey, number> = { director: 5, pm: 3, depthead: 2, member: 0, englead: 0, quality: 3, procurement: 5, client: 3 };
    for (const [role, n] of Object.entries(want)) {
      expect([role, await approvalCount(PERSONA_BY_ROLE[role as RoleKey], 'HLT-026')]).toEqual([role, n]);
      expect([role, (await projectBadges(role as RoleKey, 'HLT-026')).myapprovals]).toEqual([role, n ? String(n) : '']);
    }
  });

  it('Resource requests and Approvals badges follow the viewer', async () => {
    const g = async (role: RoleKey) => (await getShellNav(role)).globalBadges;
    // Reschedules on the requests the viewer sees (RQ-038 was sent by R. Aubert); Approvals = the viewer's department.
    expect([(await g('pm')).requests, (await g('englead')).requests, (await g('quality')).requests]).toEqual(['1', '', '1']);
    expect([(await g('depthead')).approvals, (await g('quality')).approvals]).toEqual(['2', '1']);
    expect(await crumbExtraOf('requests', { role: 'pm', code: 'HLT-026', zone: null })).toBe('R. Aubert, project manager');
    expect(await crumbExtraOf('requests', { role: 'director', code: 'HLT-026', zone: null })).toBe('all project managers');
    expect(await crumbExtraOf('approvals', { role: 'quality', code: 'HLT-026', zone: null })).toBe('Gabriel Comte · Quality manager');
  });

  it('projects without data carry no project badges', async () => {
    expect(Object.keys(await projectBadges('director', 'EWA-051'))).toEqual(['myapprovals']);
  });
});

describe('notifications (docs/spec/01 §5.5)', () => {
  it('initial unread counts per role', async () => {
    const want: Record<RoleKey, number> = { director: 3, pm: 4, depthead: 1, member: 2, englead: 1, quality: 1, procurement: 1, client: 1 };
    for (const [role, n] of Object.entries(want)) expect([role, (await notificationsFor(role as RoleKey)).filter((x) => !x.read).length]).toEqual([role, n]);
  });

  it('targets are deep links', async () => {
    const byId = Object.fromEntries((await notificationsFor('pm')).map((n) => [n.id, n.href]));
    expect(byId.n3).toBe('/projects/HLT-026/quality?tab=ncr&ncr=NCR-029');
    expect(byId.n6).toBe('/projects/HLT-026/plan?act=A1250');
    expect(byId.n4).toBe('/projects/HLT-026/deliveries?receipt=BL-2026-0533');
    expect(deepLink('procurement', { pTab: 'inv', inv: 'INV-HC-7781' })).toBe('/purchasing/sourcing?tab=inv&inv=INV-HC-7781');
    expect(byId.n10).toBe('/resources/leave');
  });

  it('read state is per user and persisted', async () => {
    const unread = async (role: RoleKey) => (await notificationsFor(role)).filter((x) => !x.read).map((x) => x.id);
    // n2 is delivered to the director and the PM: the PM opening it leaves the director's copy unread.
    await markNotificationRead('pm', 'n2');
    expect(await unread('pm')).toEqual(['n3', 'n5', 'n6']);
    expect(await unread('director')).toEqual(['n1', 'n2', 'n8']);
    await markAllNotificationsRead('director');
    expect(await unread('director')).toEqual([]);
    expect(await unread('client')).toEqual(['n1']);
  });
});

describe('breadcrumb extras (CRUMB_EXTRA, docs/spec/01 §5.1)', () => {
  const ctx = { role: 'director' as RoleKey, code: 'HLT-026', zone: null };
  it('matches the prototype examples', async () => {
    expect(await crumbExtraOf('contract', ctx)).toBe('CTR-HLT-001');
    expect(await crumbExtraOf('billing', ctx)).toBe('Net 45 days');
    expect(await crumbExtraOf('worldmap', ctx)).toBe('17 projects located');
    expect(await crumbExtraOf('projects', ctx)).toBe('FY2026 · 17 projects');
    expect(await crumbExtraOf('overview', { ...ctx, zone: 'afr' })).toBe('FY2026 · Africa');
    expect(await crumbExtraOf('myprojects', ctx)).toBe('Portfolio director');
    expect(await crumbExtraOf('approvals', ctx)).toBe('Marion Kerviel · Head of engineering');
    expect(await crumbExtraOf('home', ctx)).toBe('');
  });
});

describe('zone bar (docs/spec/01 §7.2)', () => {
  it('counts projects and owners', async () => {
    const z = await zoneBarOf('overview', null);
    expect(z.options[0]).toEqual({ key: null, label: 'All zones', count: 17 });
    expect(z.options.slice(1).reduce((a, o) => a + o.count, 0)).toBe(17);
    expect(z.ownerLabel).toBe('Zone managers');
    expect(z.ownerName).toBe('O. Castel · A. Diallo · S. Nguyen');
    const f = await zoneBarOf('fleet', 'afr');
    expect(f.options[0].count).toBe(8);
    expect(f.ownerLabel).toBe('Zone manager');
    expect(f.ownerName).toBe('Aïcha Diallo');
  });
});

describe('global search (docs/spec/01 §5.4)', () => {
  it('kinds, limits and deep links', async () => {
    expect(await searchShell('w', 'HLT-026')).toEqual([]);
    const people = (await searchShell('wagner', 'HLT-026')).filter((h) => h.kind === 'Person');
    expect(people).toEqual([{ kind: 'Person', title: 'Julien Wagner', sub: 'Structural engineer', href: '/resources' }]);
    // Only the resource pool (PEOPLE) is searchable: personas outside it give no Person hit.
    expect((await searchShell('aubert', 'HLT-026')).filter((h) => h.kind === 'Person')).toEqual([]);
    const cr = (await searchShell('cr-008', 'HLT-026')).find((h) => h.kind === 'Change request');
    expect(cr?.href).toBe('/projects/HLT-026/changes?cr=CR-008');
    const hits = await searchShell('ne', 'HLT-026');
    expect(hits.filter((h) => h.kind === 'Project').length).toBeLessThanOrEqual(4);
    expect(hits.filter((h) => h.kind === 'Person').map((h) => h.title)).toEqual(['Julien Wagner', 'Pauline Noguès', 'Hélène Sauvage']);
  });
});
