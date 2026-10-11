import { beforeAll, describe, it } from 'vitest';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getShellNav } from '@/server/dal/shell';
import { buildSidebar } from '@/components/app/shell/nav-model';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('P-10b client sidebar badges', () => {
  it('client nav data', async () => {
    const nav = await getShellNav(PERSONA_BY_ROLE.client);
    console.log('GLOBAL', JSON.stringify(nav.globalBadges));
    console.log('PROJECTS', JSON.stringify(nav.projects.map((p) => p.code)), JSON.stringify(nav.projectBadges));
    const d = await getShellNav(PERSONA_BY_ROLE.director);
    console.log('DIRECTOR HLT', JSON.stringify(d.projectBadges['HLT-026']));
    console.log(typeof buildSidebar);
  }, 60_000);
});
