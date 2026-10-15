// Delivery 8, lot audit-i18n-shell — R-052 (X-5 = portfolio): the global search covers the portfolio, filtered by rights,
// and the R-149 deep-link fix for task notifications (built here, shell.ts belongs to this lot).
import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONAS, PERSONA_BY_ROLE } from '@/config/personas';
import { searchHitView } from '@/components/app/shell/search-view';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { createChangeRequest } from './changes';
import { createNotification } from './notifications';
import { deepLink, notificationsFor, searchShell, type SearchHit } from './shell';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

const of = (hits: SearchHit[], kind: string) => hits.filter((h) => h.kind === kind);
const internal = PERSONAS.filter((p) => p.role !== 'client');

describe('R-052 portfolio-wide search (X-5)', () => {
  it('PO-1082 is found from Northgate and opens Harbor Line, with the project code in the sub-line', async () => {
    const po = of(await searchShell('po-1082', 'NDC-031'), 'Purchase order');
    expect(po).toEqual([{ kind: 'Purchase order', title: 'PO-1082 · Cotswold Fire Systems', sub: 'HLT-026 · Awaiting approval', subData: ['HLT-026'], href: '/projects/HLT-026/orders?po=PO-1082' }]);
  });

  it('NCR-029 is found from a project without NCRs and opens Harbor Line\'s Quality', async () => {
    const ncr = of(await searchShell('ncr-029', 'EWA-051'), 'NCR');
    expect(ncr.map((h) => [h.title.split(' · ')[0], h.sub, h.href])).toEqual([['NCR-029', 'HLT-026 · Critical · Root cause', '/projects/HLT-026/quality?ncr=NCR-029']]);
  });

  it('risks: the current project\'s first, then register order, 3 per kind', async () => {
    const risks = of(await searchShell('r-03', 'NDC-031'), 'Risk');
    expect(risks.map((h) => h.href)).toEqual(['/projects/NDC-031/risks?risk=R-03', '/projects/HLT-026/risks?risk=R-03', '/projects/RCF-019/risks?risk=R-03']);
    expect(risks.map((h) => h.sub.split(' · ')[0])).toEqual(['NDC-031', 'HLT-026', 'RCF-019']);
  });

  it('a staff hit on another project opens that project, for every internal persona; projects without data are searched', async () => {
    const ndc = await createChangeRequest('NDC-031', { title: 'Northgate raised-floor cabling', types: ['budget'], amountKeur: 12, scheduleDays: 0 }, 'Marie Lefebvre');
    // PRS-038 (Port authority) has no project data (a wizard-like project): its change requests are still found.
    const prs = await createChangeRequest('PRS-038', { title: 'Quay 9 fender upgrade', types: ['budget'], amountKeur: 30, scheduleDays: 4 }, 'Marie Lefebvre');
    for (const p of internal) {
      const hits = of(await searchShell('northgate raised', 'HLT-026', p), 'Change request');
      expect([p.role, hits]).toEqual([p.role, [{ kind: 'Change request', title: `${ndc} · Northgate raised-floor cabling`, sub: 'NDC-031 · In review', subData: ['NDC-031'], href: `/projects/NDC-031/changes?cr=${ndc}` }]]);
      expect([p.role, of(await searchShell('fender', 'HLT-026', p), 'Change request').map((h) => h.href)]).toEqual([p.role, [`/projects/PRS-038/changes?cr=${prs}`]]);
    }
  });

  it('the client finds the change requests of every project of their organisation, never another organisation\'s', async () => {
    const client = PERSONA_BY_ROLE.client;
    const own = await createChangeRequest('QFR-015', { title: 'Quay crane rail realignment', types: ['schedule'], amountKeur: 0, scheduleDays: 6 }, 'Marie Lefebvre');
    const other = await createChangeRequest('RCF-019', { title: 'Quay-side clinic wing', types: ['budget'], amountKeur: 5, scheduleDays: 0 }, 'Marie Lefebvre');
    expect(of(await searchShell('realignment', 'HLT-026', client), 'Change request').map((h) => [h.title, h.href])).toEqual([[`${own} · Quay crane rail realignment`, `/projects/QFR-015/changes?cr=${own}`]]);
    // 'quay' matches Port authority's change requests (PRS-038, QFR-015) and RCF-019's (Health trust): only the first two.
    const hits = of(await searchShell('quay', 'HLT-026', client), 'Change request');
    expect(hits.map((h) => h.href.split('/')[2])).toEqual(['PRS-038', 'QFR-015']);
    expect(JSON.stringify(hits)).not.toContain(other);
    expect(JSON.stringify(await searchShell(other.toLowerCase(), 'RCF-019', client))).toBe('[]');
    // Current project first: from QFR-015, its own change request comes before Harbor Line's.
    const fromQfr = of(await searchShell('cr-0', 'QFR-015', client), 'Change request').map((h) => h.href);
    expect(fromQfr[0]).toBe(`/projects/QFR-015/changes?cr=${own}`);
    expect(fromQfr.slice(1).every((h) => h.startsWith('/projects/HLT-026/changes?cr='))).toBe(true);
    // Still nothing else of the internal workspace, on any of their projects.
    for (const q of ['po-1082', 'ncr-0', 'r-03', 'wagner', 'eco-2026', 'dwg', 'a1250'])
      expect([q, (await searchShell(q, 'QFR-015', client)).filter((h) => h.kind !== 'Project')]).toEqual([q, []]);
  });

  it('searchHitView shows the project code as typed and translates Keystone\'s labels (R-148)', async () => {
    const [po] = of(await searchShell('po-1082', 'NDC-031'), 'Purchase order');
    const fr = searchHitView(po, makeT('fr'), 'fr');
    expect(fr.sub.split(' · ')[0]).toBe('HLT-026');
    expect(fr.sub).toBe(`HLT-026 · ${makeT('fr')('Awaiting approval')}`);
    expect(fr.kind).toBe(makeT('fr')('Purchase order'));
    // The client's project hit: the PM's name is data (shown as typed).
    const [proj] = await searchShell('harbor', 'HLT-026', PERSONA_BY_ROLE.client);
    expect(proj.subData).toEqual([proj.sub.split(' · ')[2]]);
  });
});

describe('deepLink of a task notification (R-149 fix, shell.ts)', () => {
  it('the task id goes in the path, not in the query string', async () => {
    expect(deepLink('task', { taskId: 'T-2318' })).toBe('/my/tasks/T-2318');
    expect(deepLink('task', { taskId: 'T-2318', tab: 'comments' })).toBe('/my/tasks/T-2318?tab=comments');
    // Other screens keep a taskId parameter in the query string.
    expect(deepLink('mywork', { taskId: 'T-2318' })).toBe('/my/tasks?taskId=T-2318');
    await createNotification({ kind: 'task', title: 'Task assigned to you', sub: 'T-2318', screen: 'task', params: { taskId: 'T-2318' }, audience: ['pm'] });
    const n = (await notificationsFor('pm')).find((x) => x.kind === 'task' && x.sub === 'T-2318');
    expect(n?.href).toBe('/my/tasks/T-2318');
  });
});
