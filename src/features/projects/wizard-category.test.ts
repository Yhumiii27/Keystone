// R-196 (K-196): the New project wizard's project category — client project by default, R&D project when chosen, refused when
// unknown; stored on the project (pub_projets.categorie) and in the creation's audit row.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const session = { role: 'director' as RoleKey };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return { getViewer: async () => PERSONA_BY_ROLE[session.role] };
});

import { eq, sql } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { auditEntries } from '@/server/db/schema';
import { openDatabase } from '@/server/db/open';
import { getProjectCategory } from '@/server/dal/project-category';
import { createProjectAction, type NewProjectDraft } from './actions';

const draft = (patch: Partial<NewProjectDraft> = {}): NewProjectDraft => ({
  name: 'Pilot test bench', client: 'Port authority', das: '2', mt: 'R&D', cur: 'EUR', template: 'R&D',
  cats: [{ name: 'Études', type: 'Labor', budget: '100' }], cont: 5, cal: 'standard_5x8', pm: null, start: '2027-01-11', finish: '2027-09-30',
  city: 'Le Havre', country: 'France',
  ...patch,
});

describe('New project wizard: project category (R-196)', () => {
  beforeAll(async () => setDb(await openDatabase()), 60_000);

  it('refuses an unknown category', async () => {
    expect(await createProjectAction(draft({ category: 'lab' }))).toEqual({ ok: false, error: 'Choose the project category' });
  });

  it('a client project by default; an R&D project when chosen (published, audited)', async () => {
    const a = await createProjectAction(draft({ name: 'Client one' }));
    expect(a).toMatchObject({ ok: true });
    if (a.ok) expect(await getProjectCategory(a.code)).toBe('client');
    const r = await createProjectAction(draft({ category: 'rd' }));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(await getProjectCategory(r.code)).toBe('rd');
    const db = await getDb();
    expect((await db.execute(sql`select categorie from pub_projets where code = ${r.code}`)).rows).toEqual([{ categorie: 'rd' }]);
    const [row] = await db.select().from(auditEntries).where(eq(auditEntries.objectRef, r.code));
    expect(row.change).toContain('· R&D project');
    expect(row.after).toEqual({ category: 'rd' });
  });
});
