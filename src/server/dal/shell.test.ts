import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { canSee, type RoleKey, type ScreenId } from '@/config/screens';
import { approvalCount } from '@/server/approvals';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { openClaim } from './claims';
import { addPaymentMilestone } from './contract';
import { recordDocumentDecision } from './documents';
import { addMachine } from './fleet';
import { markInterfaceReceived } from './interfaces';
import { addPunchItem, advancePunchItem } from './itp';
import { addMeetingLine, createMeeting, sendMinutes } from './meetings';
import { markAllNotificationsRead, markNotificationRead } from './notifications';
import { createPart } from './parts';
import { approvePurchaseOrder, rejectSupplierInvoice } from './purchasing';
import { applyStockMovement, listStock } from './stock';
import { crumbExtraOf, deepLink, defaultTitleOf, getShellNav, notificationsFor, projectBadges, searchShell, zoneBarOf } from './shell';
import { listProjects } from './projects';

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
      // R-021: the prototype's "!" came from Outlook's seeded "Warning" — no connector exists for Outlook (A-15).
      requests: '1', approvals: '2', plumbing: '',
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
    // R-044: Finance has no My approvals kind (no approvals inbox, no screen in its workspace).
    const want: Record<RoleKey, number> = { director: 5, pm: 3, depthead: 2, member: 0, englead: 0, quality: 3, procurement: 5, finance: 0, client: 3 };
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
    // R-044: no notification audience for Finance.
    const want: Record<RoleKey, number> = { director: 3, pm: 4, depthead: 1, member: 2, englead: 1, quality: 1, procurement: 1, finance: 0, client: 1 };
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
    // R-148: the job title is data (shown as typed in the hit's sub-line).
    expect(people).toEqual([{ kind: 'Person', title: 'Julien Wagner', sub: 'Structural engineer', subData: ['Structural engineer'], href: '/resources' }]);
    // Only the resource pool (PEOPLE) is searchable: personas outside it give no Person hit.
    expect((await searchShell('aubert', 'HLT-026')).filter((h) => h.kind === 'Person')).toEqual([]);
    const cr = (await searchShell('cr-008', 'HLT-026')).find((h) => h.kind === 'Change request');
    expect(cr?.href).toBe('/projects/HLT-026/changes?cr=CR-008');
    const hits = await searchShell('ne', 'HLT-026');
    expect(hits.filter((h) => h.kind === 'Project').length).toBeLessThanOrEqual(4);
    expect(hits.filter((h) => h.kind === 'Person').map((h) => h.title)).toEqual(['Julien Wagner', 'Pauline Noguès', 'Hélène Sauvage']);
  });
});

describe('Delivery 3 badges and crumbs follow the database (docs/spec/01 §4.4)', () => {
  const badges = async (code: string) => {
    const nav = await getShellNav('director');
    return { ...nav.globalBadges, ...nav.projectBadges[code] };
  };

  it('Documents, Meetings, Interfaces and Billing badges move with the writes', async () => {
    // Codex: RPT-HLT-014 is the only record in "Release proposed"; once both approvals are recorded (pending sync with
    // Codex, P-7b / R-124) no step is open in Keystone any more.
    expect((await badges('HLT-026')).docs).toBe('1');
    await recordDocumentDecision('RPT-HLT-014', { decision: 'approved' }, { name: 'Gabriel Comte', role: 'quality' });
    expect((await badges('HLT-026')).docs).toBe('1');
    await recordDocumentDecision('RPT-HLT-014', { decision: 'approved' }, { name: 'Romain Aubert', role: 'pm' });
    expect((await badges('HLT-026')).docs).toBe('');
    // Meetings: MTG-118 has its notes in progress; sending the minutes clears the badge.
    expect((await badges('HLT-026')).meetings).toBe('1');
    await sendMinutes('MTG-118', 'Romain Aubert');
    expect((await badges('HLT-026')).meetings).toBe('');
    // Interfaces: IF-07 is late until it is received.
    expect((await badges('HLT-026')).interfaces).toBe('1');
    await markInterfaceReceived('HLT-026', 'IF-07', 'Romain Aubert');
    expect((await badges('HLT-026')).interfaces).toBe('');
    // Billing: a planned milestone due before the prototype's now is late.
    expect((await badges('HLT-026')).billing).toBe('');
    await addPaymentMilestone('HLT-026', { label: 'Early works', sharePct: 1, contractualDue: '2026-09-01' }, 'Romain Aubert');
    expect((await badges('HLT-026')).billing).toBe('1');
    // Outside a request React's cache() memoises nothing: each badge read recomputes the portfolio (delivery 7: with the earned
    // value of every project, R-073), so these write-then-read tests get more than the default 5 s.
  }, 20_000);

  it('a project without data gets a database badge once it has the rows', async () => {
    const n = await createMeeting('EWA-051', {
      title: 'Kick-off', type: 'internal', series: 'one_off', date: '2026-10-06', time: '9:00', location: '', invitees: ['M. Lefebvre'], agenda: ['Scope'],
    }, 'Marie Lefebvre');
    expect(Object.keys(await projectBadges('director', 'EWA-051'))).toEqual(['myapprovals']);
    await addMeetingLine(n, 0, { type: 'info', text: 'Scope confirmed', owner: '', due: '' }, 'Marie Lefebvre');
    const b = await projectBadges('director', 'EWA-051');
    expect([Object.keys(b), b.meetings]).toEqual([['myapprovals', 'meetings'], '1']);
  });

  it('Contract and Billing crumbs come from the contract; none without a contract', async () => {
    const ctx = { role: 'director' as RoleKey, code: 'EWA-051', zone: null };
    expect([await crumbExtraOf('contract', ctx), await crumbExtraOf('billing', ctx)]).toEqual(['', '']);
    expect(await crumbExtraOf('worldmap', { ...ctx, zone: 'afr' })).toMatch(/^\d+ projects? located · Africa$/);
  });
});

describe('Delivery 4 badges and search follow the database (docs/spec/01 §4.4, §5.4)', () => {
  const badges = async (code: string) => {
    const nav = await getShellNav('director');
    return { ...nav.globalBadges, ...nav.projectBadges[code] };
  };

  it('Purchase orders, Sourcing & invoices and Stock badges move with the writes', async () => {
    // PO-1082 awaits approval on Harbor Line; approving it orders it.
    expect((await badges('HLT-026')).orders).toBe('1');
    await approvePurchaseOrder('PO-1082', 'Romain Aubert');
    expect((await badges('HLT-026')).orders).toBe('');
    // INV-HC-7781 and INV-BX-55120 are blocked by the 3-way match, INV-LE-2210 has no PO.
    expect((await badges('HLT-026')).procurement).toBe('3');
    await rejectSupplierInvoice('INV-LE-2210', 'Fabien Bertrand');
    expect((await badges('HLT-026')).procurement).toBe('2');
    // One stock line is below its minimum; a count at the minimum clears the badge.
    const low = (await listStock()).filter((r) => r.belowMin);
    expect([low.length, (await badges('HLT-026')).stock]).toEqual([1, '1']);
    await applyStockMovement(low[0].id, { op: 'adjust', qty: low[0].minQty }, { name: 'Fabien Bertrand', role: 'procurement' });
    expect((await badges('HLT-026')).stock).toBe('');
  }, 20_000);

  it('search reads parts and purchase orders from their modules', async () => {
    await createPart({ ref: 'ME-GBX-91', name: 'Gearbox 91 kW', family: 'mechanical', supplier: 'Flender', priceEur: 8400, unit: 'pc' }, 'Antoine Girard');
    const part = (await searchShell('gbx-91', 'HLT-026')).filter((h) => h.kind === 'Part');
    expect(part).toEqual([{ kind: 'Part', title: 'ME-GBX-91 · Gearbox 91 kW', sub: 'Flender · Not validated', subData: ['Flender'], href: '/reference/parts?part=ME-GBX-91' }]);
    const smoke = (await searchShell('smoke', 'HLT-026')).filter((h) => h.kind === 'Part').map((h) => [h.title, h.sub]);
    expect(smoke[0]).toEqual(['FD-DET-OPT · Optical smoke detector', 'Cotswold Fire Systems · Outdated']);
    const po = (await searchShell('po-1082', 'HLT-026')).filter((h) => h.kind === 'Purchase order');
    expect(po).toEqual([{ kind: 'Purchase order', title: 'PO-1082 · Cotswold Fire Systems', sub: 'Ordered', href: '/projects/HLT-026/orders?po=PO-1082' }]);
    expect((await searchShell('po-1082', 'NDC-031')).filter((h) => h.kind === 'Purchase order')).toEqual([]);
  });
});

describe('Delivery 5 badges, search and zone bar follow the database (docs/spec/01 §4.4, §5.4, §7.2)', () => {
  const badges = async (code: string) => {
    const nav = await getShellNav('director');
    return { ...nav.globalBadges, ...nav.projectBadges[code] };
  };
  const quality = { name: 'Gabriel Comte', role: 'quality' };

  it('Inspections & punch list: open category-A items of the ITP register', async () => {
    expect((await badges('HLT-026')).itp).toBe('');
    const n = await addPunchItem('HLT-026', { description: 'Missing guard on gantry 2 ladder', location: 'Gantry crane 2', category: 'A', source: 'site_walk', owner: 'S. Haddad' }, quality);
    expect((await badges('HLT-026')).itp).toBe('1');
    await advancePunchItem('HLT-026', n, quality);
    await advancePunchItem('HLT-026', n, quality);
    expect((await badges('HLT-026')).itp).toBe('');
  });

  it('Warranty claims and the zone bar of the installed base', async () => {
    expect((await badges('HLT-026')).sav).toBe('2');
    const before = await zoneBarOf('fleet', null);
    await openClaim({ machineNumber: 'MCH-041', issue: 'Hoist brake noise', severity: 'major', coverage: 'warranty', owner: 'T. Kerbrat' }, quality);
    expect((await badges('HLT-026')).sav).toBe('3');
    await addMachine({ name: 'Gantry crane 45 t — quay 4', machineType: 'EMP', client: 'Port authority', site: 'Le Havre · quay 4', deliveredOn: '2026-09-01', warrantyEndOn: '2028-08-31' }, { name: 'Marie Lefebvre', role: 'director' });
    const after = await zoneBarOf('fleet', null);
    expect(after.options[0].count).toBe(before.options[0].count + 1);
    expect(after.options.find((o) => o.key === 'euna')!.count).toBe(before.options.find((o) => o.key === 'euna')!.count + 1);
  });

  it('NCR search reads the Vigie mirror of the current project', async () => {
    const hits = (await searchShell('ncr-029', 'HLT-026')).filter((h) => h.kind === 'NCR');
    expect(hits).toEqual([{ kind: 'NCR', title: expect.stringMatching(/^NCR-029 · /), sub: 'Critical · Root cause', href: '/projects/HLT-026/quality?ncr=NCR-029' }]);
    expect((await searchShell('ncr-04', 'NDC-031')).filter((h) => h.kind === 'NCR').map((h) => h.title.split(' · ')[0])).toEqual(['NCR-040', 'NCR-041']);
    expect((await searchShell('ncr', 'EWA-051')).filter((h) => h.kind === 'NCR')).toEqual([]);
  });

  it('a project without data carries no Delivery 5 badge', async () => {
    const b = await projectBadges('director', 'EWA-051');
    for (const k of ['eng', 'eng-elec', 'pid', 'quality', 'itp', 'site'] as const) expect([k, b[k]]).toEqual([k, undefined]);
  });

  it('R-042 / R-043 (P-1, P-10a, P-10b): the client\'s sidebar and search stay on their organisation\'s projects and workspace', async () => {
    const nav = await getShellNav('client');
    const all = await listProjects();
    expect(nav.projects.map((p) => p.code)).toEqual(all.filter((p) => p.client === 'Port authority').map((p) => p.code));
    expect(nav.projects.map((p) => p.code)).toContain('HLT-026');
    expect(nav.projects.map((p) => p.code)).not.toContain('NDC-031');
    expect(Object.keys(nav.projectBadges)).toEqual(nav.projects.map((p) => p.code));
    // Their project opens their portal; another organisation's project is not found.
    expect(await searchShell('harbor', 'HLT-026', 'client')).toEqual([
      { kind: 'Project', title: 'Harbor Line Terminal Expansion', sub: expect.stringMatching(/^HLT-026 · /), href: '/projects/HLT-026/client' },
    ]);
    expect(await searchShell('northgate', 'HLT-026', 'client')).toEqual([]);
    // No NCR, purchase order, part, person, ECO, risk, drawing or activity; the change requests of their current project only.
    for (const q of ['ncr-029', 'po-1082', 'gbx-91', 'wagner', 'eco-2026', 'dwg'])
      expect(await searchShell(q, 'HLT-026', 'client'), q).toEqual([]);
    expect((await searchShell('cr-008', 'HLT-026', 'client')).map((h) => [h.kind, h.href])).toEqual([['Change request', '/projects/HLT-026/changes?cr=CR-008']]);
    expect(await searchShell('cr-0', 'NDC-031', 'client')).toEqual([]);
    // Staff search is unchanged.
    expect((await searchShell('northgate', 'HLT-026')).map((h) => h.kind)).toContain('Project');
  });
});

describe('R-043 (P-1, P-10b): the client\'s sidebar badges', () => {
  const meetingsBadge = async (role: RoleKey) => Number((await getShellNav(role)).projectBadges['HLT-026'].meetings || 0);

  it('only the entries of her workspace: no NCR count, no purchasing or other internal count, no global badge', async () => {
    const staff = await getShellNav('director');
    const nav = await getShellNav('client');
    // Staff keep their badges (the open critical NCR of HLT-026 on Quality, purchasing, site Go / No Go…).
    expect(staff.projectBadges['HLT-026'].quality).toMatch(/^\d+$/);
    expect(staff.projectBadges['HLT-026'].site).toBe('NO GO');
    expect(Object.values(staff.globalBadges).some(Boolean)).toBe(true);
    // The client: nothing of the internal counts reaches her browser (the sidebar props).
    expect(nav.globalBadges).toEqual({});
    for (const [code, b] of Object.entries(nav.projectBadges)) {
      for (const id of Object.keys(b)) expect([code, id, canSee('client', id as ScreenId)]).toEqual([code, id, true]);
      expect([code, b.quality]).toEqual([code, undefined]);
    }
    const b = nav.projectBadges['HLT-026'];
    for (const k of ['procurement', 'orders', 'deliveries', 'stock', 'eco', 'sav', 'risks', 'eng', 'pid', 'site', 'interfaces', 'billing', 'docs', 'mywork'] as const)
      expect([k, b[k]]).toEqual([k, undefined]);
    expect(JSON.stringify(nav)).not.toContain('NO GO');
    // Her own entries keep their badges: My approvals (her inbox) and the change requests in review.
    expect(b.myapprovals).toMatch(/^\d+$/);
    expect(b.myapprovals).toBe((await projectBadges('client', 'HLT-026')).myapprovals);
    expect(b.changes).toBe(staff.projectBadges['HLT-026'].changes);
    // projectBadges() follows the same rule.
    expect((await projectBadges('client', 'HLT-026')).quality).toBeUndefined();
  });

  it('her Meetings badge counts the external meetings with notes in progress only', async () => {
    const [staff0, client0] = [await meetingsBadge('director'), await meetingsBadge('client')];
    const write = async (type: 'internal' | 'external') => {
      const n = await createMeeting('HLT-026', {
        title: `${type} review`, type, series: 'one_off', date: '2026-10-07', time: '9:00', location: '', invitees: ['R. Aubert'], agenda: ['Progress'],
      }, 'Romain Aubert');
      await addMeetingLine(n, 0, { type: 'info', text: 'Noted', owner: '', due: '' }, 'Romain Aubert');
    };
    await write('internal');
    expect([await meetingsBadge('director'), await meetingsBadge('client')]).toEqual([staff0 + 1, client0]);
    await write('external');
    expect([await meetingsBadge('director'), await meetingsBadge('client')]).toEqual([staff0 + 2, client0 + 1]);
  }, 20_000);
});
