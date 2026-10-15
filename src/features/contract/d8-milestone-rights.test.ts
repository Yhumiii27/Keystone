// Delivery 8 integration review (contract-rates) — R-077 "Edit" / "Remove" of a planned payment milestone follow P-4 (R-044) in
// the DAL re-check too, as `canEditContract` does for the Server Function: the director and Finance on every project (Finance
// off the named team included), otherwise a lead of the project (PM of record, co-PM, deputy) whose workspace has the Contract
// screen. Before the fix the writers re-checked the P-2 team rule (`editsProjectScreen` → `onProjectTeam`): Finance off the team
// saw Edit / Remove but got "This contract is read-only for you", and a 'pm'-role plain team member passed the DAL.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const session = { role: 'director' as RoleKey };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }), getViewer: async () => PERSONA_BY_ROLE[session.role] };
});

import { and, eq } from 'drizzle-orm';
import { PERSONAS } from '@/config/personas';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { persons, projectMembers, projects } from '@/server/db/schema';
import { MilestoneEditError, addPaymentMilestone, getContract, removePaymentMilestone, updatePaymentMilestone } from '@/server/dal/contract';
import { getProjectContext } from '@/server/project-context';
import { removePaymentMilestoneAction, updatePaymentMilestoneAction } from './actions';

const VALUES = { label: 'Crane load test passed', pct: '5', due: '15 Mar 2027', cond: 'Load test report accepted' };
const PATCH = { label: 'Changed by the DAL', sharePct: 2, contractualDue: '2027-03-01', condition: null };
/** P-4 on HLT-026 once Finance is off its team: the director, Finance, and its PM of record (Romain Aubert). */
const EDITORS: RoleKey[] = ['director', 'pm', 'finance'];
const spare = (label: string) => addPaymentMilestone('HLT-026', { label, sharePct: 1, contractualDue: '2027-02-01' }, 'Marie Lefebvre');
const labelOf = async (n: string) => (await getContract('HLT-026'))!.milestones.find((m) => m.number === n)?.label;

async function memberWhere(fullName: string) {
  const db = await getDb();
  const [person] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, fullName));
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
  return { db, personId: person.id, projectId: p.id, where: and(eq(projectMembers.projectId, p.id), eq(projectMembers.personId, person.id)) };
}

beforeAll(async () => {
  setDb(await openDatabase());
  // Léa Marchand (the Finance persona) leaves HLT-026's named team: Finance still edits its contract (P-4, every project).
  const { db, where } = await memberWhere('Léa Marchand');
  await db.delete(projectMembers).where(where);
}, 60_000);

describe('P-4 — Edit / Remove milestone with Finance off the team, for the 9 personas', () => {
  for (const persona of PERSONAS)
    it(persona.role, async () => {
      const n = await spare(`Spare ${persona.role}`);
      session.role = persona.role;
      if (persona.role === 'client') {
        await expect(updatePaymentMilestoneAction('HLT-026', n, VALUES)).rejects.toThrow('REDIRECT /');
        await expect(removePaymentMilestoneAction('HLT-026', n)).rejects.toThrow('REDIRECT /');
        return;
      }
      const ctx = await getProjectContext('HLT-026', 'contract');
      expect([persona.role, ctx.canEdit('contract')]).toEqual([persona.role, EDITORS.includes(persona.role)]);
      if (persona.role === 'finance') expect(ctx.access.teamRole).toBeNull();
      if (!EDITORS.includes(persona.role)) {
        const ro = { error: 'This contract is read-only for you' };
        expect(await updatePaymentMilestoneAction('HLT-026', n, VALUES)).toEqual(ro);
        expect(await removePaymentMilestoneAction('HLT-026', n)).toEqual(ro);
        expect(await labelOf(n)).toBe(`Spare ${persona.role}`);
        return;
      }
      expect(await updatePaymentMilestoneAction('HLT-026', n, VALUES)).toEqual({ toast: `${n} · Payment milestone updated` });
      expect(await labelOf(n)).toBe('Crane load test passed');
      expect(await removePaymentMilestoneAction('HLT-026', n)).toEqual({ toast: `${n} · Payment milestone removed` });
      expect(await labelOf(n)).toBeUndefined();
    });
});

describe('P-4 — the DAL writers re-check canEditContract, not the team rule', () => {
  const refused = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ name: 'MilestoneEditError', code: 'not_allowed' } satisfies Partial<MilestoneEditError>);

  it('a "pm"-role plain team member is refused; as deputy accepted; a "member"-role deputy refused (no Contract screen)', async () => {
    const { db, where } = await memberWhere('Julien Wagner');
    const [before] = await db.select({ role: projectMembers.projectRole }).from(projectMembers).where(where);
    const n = await spare('Spare DAL');
    try {
      await db.update(projectMembers).set({ projectRole: 'team' }).where(where);
      await refused(updatePaymentMilestone('HLT-026', n, PATCH, { name: 'Julien Wagner', role: 'pm' }));
      await refused(removePaymentMilestone('HLT-026', n, { name: 'Julien Wagner', role: 'pm' }));
      await db.update(projectMembers).set({ projectRole: 'referent' }).where(where);
      await refused(updatePaymentMilestone('HLT-026', n, PATCH, { name: 'Julien Wagner', role: 'pm' }));
      await db.update(projectMembers).set({ projectRole: 'deputy' }).where(where);
      await refused(updatePaymentMilestone('HLT-026', n, PATCH, { name: 'Julien Wagner', role: 'member' }));
      expect(await labelOf(n)).toBe('Spare DAL');
      expect(await updatePaymentMilestone('HLT-026', n, PATCH, { name: 'Julien Wagner', role: 'pm' })).toBe(n);
      expect(await labelOf(n)).toBe('Changed by the DAL');
    } finally {
      await db.update(projectMembers).set({ projectRole: before.role }).where(where);
    }
    // A client, a role without the Contract screen, an unknown role: refused whatever the team says.
    for (const role of ['client', 'procurement', 'quality', 'boss']) await refused(removePaymentMilestone('HLT-026', n, { name: 'Marie Lefebvre', role }));
    // Finance off the team and the director (any name): accepted.
    expect(await updatePaymentMilestone('HLT-026', n, { ...PATCH, label: 'By Finance' }, { name: 'Léa Marchand', role: 'finance' })).toBe(n);
    await removePaymentMilestone('HLT-026', n, { name: 'Somebody Else', role: 'director' });
    expect(await labelOf(n)).toBeUndefined();
  });
});
