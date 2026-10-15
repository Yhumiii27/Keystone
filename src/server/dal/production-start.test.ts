// R-011: a new production database (reference data only) — the current project resolves to none, the Homes built around a
// project show the empty Home, the shared reads do not fail, the New project wizard works without a default PM, and the
// registers are numbered from 1 (no prototype floor). The demo database keeps HLT-026 as default project.
import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONAS, PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { NO_PROJECT_SUB, NO_PROJECT_TITLE } from '@/domain/home-empty';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import type { DB } from '@/server/db/types';
import { addActivityTodo } from './activity-todos';
import { createChangeRequest } from './changes';
import { chooseCurrentProject, resolveCurrentProject } from './current-project';
import { getPutAwayOptions } from './deliveries';
import { getHomeView } from './home';
import { getPortfolioOverview } from './portfolio';
import { getProject, listProjects } from './projects';
import { createWizardProject, getNewProjectSetup } from './projects-register';
import { createRisk } from './risks';
import { getShellNav, notificationsFor } from './shell';

const home = (role: RoleKey, projectCode: string | null = null) =>
  getHomeView({ role, persona: { name: PERSONA_BY_ROLE[role].name, title: PERSONA_BY_ROLE[role].title }, projectCode, zone: null, lang: 'en' });

describe('chooseCurrentProject', () => {
  it('remembered project when it exists, else the prototype default when present, else the first of the register, else none', () => {
    expect(chooseCurrentProject('NDC-031', ['HLT-026', 'NDC-031'])).toBe('NDC-031');
    expect(chooseCurrentProject('GONE-001', ['NDC-031', 'HLT-026'])).toBe('HLT-026');
    expect(chooseCurrentProject(null, ['LOG-001', 'ACM-002'])).toBe('LOG-001');
    expect(chooseCurrentProject('HLT-026', [])).toBeNull();
  });
});

describe('a new production database', () => {
  let db: DB;
  beforeAll(async () => {
    db = await openDatabase(undefined, undefined, { seed: 'production' });
    setDb(db);
  }, 60_000);

  it('has no current project; the project Homes show the empty Home, the others work', async () => {
    expect(await resolveCurrentProject('HLT-026')).toBeNull();
    for (const role of ['director', 'pm', 'quality', 'procurement', 'client'] as RoleKey[]) {
      const v = await home(role, 'HLT-026');
      expect(v.kpis).toEqual([]);
      expect(v.left.rows).toEqual([{ title: NO_PROJECT_TITLE, sub: NO_PROJECT_SUB, tag: '', tagClass: '', href: '' }]);
      expect(v.right).toEqual({ title: 'Waiting for me', rows: [] });
      expect(v.greeting).toBe(`Good morning, ${PERSONA_BY_ROLE[role].name.split(' ')[0]}`);
    }
    for (const role of ['depthead', 'member', 'englead'] as RoleKey[]) await expect(home(role)).resolves.toMatchObject({ greeting: expect.any(String) });
  });

  it('the shared reads work on empty registers (shell, notifications, portfolio overview)', async () => {
    expect(await listProjects()).toEqual([]);
    for (const { role } of PERSONAS) {
      const nav = await getShellNav(role);
      expect(nav.projects).toEqual([]);
      expect(await notificationsFor(role)).toEqual([]);
    }
    const overview = await getPortfolioOverview(null, 'en');
    expect(overview.kpis.length).toBeGreaterThan(0);
  });

  it('the wizard has templates but no prototype default PM; the first project is #001 and becomes the current project', async () => {
    const setup = await getNewProjectSetup();
    expect(setup.templates.length).toBeGreaterThan(1);
    expect(setup.machineTypes.length).toBeGreaterThan(3);
    expect(setup.managers).toEqual([]);
    expect(setup.defaultManagerId).toBeNull();
    expect(setup.nextId).toBe('#001');
    const created = await createWizardProject({
      name: 'Dakar rail spur', client: 'Transit BU', das: '3', machineType: 'SPUR', currency: 'EUR', templateCode: 'SPUR',
      categories: [{ name: 'Civil works', type: 'subcontract', budget: 270 }], contingencyPct: 10, calendar: 'standard_5x8',
    });
    expect(created).toMatchObject({ number: '#001', workPackages: 6 });
    expect((await getProject(created.code))!.pm).toBe('—');
    expect(await resolveCurrentProject(null)).toBe(created.code);
    expect(await resolveCurrentProject('HLT-026')).toBe(created.code);
    // No storage location yet (entered in Settings): the Deliveries page reads no default put-away instead of failing.
    expect(await getPutAwayOptions(created.code)).toEqual({ locations: [], defaultLocation: '' });
    // Another organisation's project is never a client's fallback: the client Home stays empty.
    expect(await resolveCurrentProject(null, { role: 'client' })).toBeNull();
    expect((await home('client')).left.rows[0]?.title).toBe(NO_PROJECT_TITLE);
    expect((await home('pm', null)).left.rows[0]?.title).not.toBe(NO_PROJECT_TITLE);
  });

  it('registers are numbered from 1 (no prototype floor): R-01, CR-001, T-0001', async () => {
    const [p] = await listProjects();
    expect(await createRisk(p.code, { title: 'Late steel', category: 'technical', response: 'mitigate' }, 'System')).toBe('R-01');
    expect(await createRisk(p.code, { title: 'Crane slot', category: 'technical', response: 'mitigate' }, 'System')).toBe('R-02');
    expect(await createChangeRequest(p.code, { title: 'Extra piles', types: ['scope'], amountKeur: 10, scheduleDays: 0 }, 'System')).toBe('CR-001');
    expect(await addActivityTodo(p.code, 'A1010', { title: 'Check survey' }, 'System')).toBe('T-0001');
  });
});

describe('the demo database', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('the fallback of a client is a project of their organisation', async () => {
    const theirs = (await listProjects()).filter((p) => p.client === 'Port authority').map((p) => p.code);
    expect(theirs).toContain('HLT-026');
    const client = { role: 'client', organisation: 'Port authority' };
    expect(await resolveCurrentProject(null, client)).toBe('HLT-026');
    expect(await resolveCurrentProject('GONE-001', client)).toBe('HLT-026');
    // Another organisation's project is never current for a client (P-10a, R-042), nor any project without an organisation.
    expect(await resolveCurrentProject('NDC-031', client)).toBe('HLT-026');
    expect(await resolveCurrentProject(null, { role: 'client', organisation: null })).toBeNull();
  });

  it('keeps HLT-026 as the default project and the prototype numbering floors', async () => {
    expect(await resolveCurrentProject(null)).toBe('HLT-026');
    expect(await resolveCurrentProject('NDC-031')).toBe('NDC-031');
    expect(await createRisk('NDC-031', { title: 'Late steel', category: 'technical', response: 'mitigate' }, 'System')).toBe('R-21');
    expect((await getNewProjectSetup()).defaultManagerId).not.toBeNull();
  });
});
