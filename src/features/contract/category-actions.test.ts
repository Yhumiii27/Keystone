// R-196 (Crucible K-3, K-196): the project's category — the "Project category" card's Server Function (the director and the
// project's leads, not Finance nor a team member, never on a read-only project), validation, the write with its audit row
// (before / after) and activity event, the category in pub_projets, the register row's "R&D" mark, and the card (EN / FR).
// Session and project context are mocked; the viewer is the actor.
import { sql } from 'drizzle-orm';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Romain Aubert', role: 'pm', lead: true, edit: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/contract', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name, role: viewer.role }, access: { lead: viewer.lead }, canEdit: () => viewer.edit }),
}));

import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listAudit, listActivity } from '@/server/dal/notifications';
import { getProjectCategory } from '@/server/dal/project-category';
import { listProjects } from '@/server/dal/projects';
import { auditEntries } from '@/server/db/schema';
import { ProjectCategoryCard } from './category-card';
import { setProjectCategoryAction } from './category-actions';
import type { ProjectCategory } from '@/domain/project-category';

const card = (lang: Lang, canEdit: boolean, category: ProjectCategory = 'client') =>
  renderToStaticMarkup(h(I18nProvider, { lang, children: h(ProjectCategoryCard, { category, code: 'HLT-026', canEdit, t: makeT(lang) }) }));

const REFUSED = { error: 'Only the project’s leads and the director set the project category' };

beforeAll(async () => setDb(await openDatabase()), 60_000);

describe('setProjectCategoryAction (R-196)', () => {
  it('refuses Finance, a team member who is not a lead, and a read-only project', async () => {
    Object.assign(viewer, { name: 'Claire Dumas', role: 'finance', lead: false, edit: true });
    expect(await setProjectCategoryAction('HLT-026', 'rd')).toEqual(REFUSED);
    Object.assign(viewer, { name: 'Romain Aubert', role: 'member', lead: false });
    expect(await setProjectCategoryAction('HLT-026', 'rd')).toEqual(REFUSED);
    Object.assign(viewer, { role: 'pm', lead: true, edit: false });
    expect(await setProjectCategoryAction('HLT-026', 'rd')).toEqual(REFUSED);
    Object.assign(viewer, { role: 'client', lead: true, edit: true });
    expect(await setProjectCategoryAction('HLT-026', 'rd')).toEqual(REFUSED);
    expect(await getProjectCategory('HLT-026')).toBe('client');
  });

  it('validates the input', async () => {
    Object.assign(viewer, { name: 'Romain Aubert', role: 'pm', lead: true, edit: true });
    expect(await setProjectCategoryAction('HLT-026', 'lab')).toEqual({ error: 'Choose the project category' });
    expect(await setProjectCategoryAction('NOPE-000', 'rd')).toEqual({ error: 'Unknown project' });
    expect(await setProjectCategoryAction('HLT-026', 1 as unknown as string)).toEqual({ error: 'Invalid request' });
  });

  it('the PM of record sets R&D: stored, audited (before / after), in the activity feed, pub_projets and the register; the director sets it back', async () => {
    expect(await setProjectCategoryAction('HLT-026', 'rd')).toEqual({ ok: true });
    expect(await getProjectCategory('HLT-026')).toBe('rd');
    expect((await listAudit())[0]).toMatchObject({ object: 'HLT-026', change: 'Project category: Client project → R&D project' });
    expect((await listActivity()).some((e) => e.what === 'Project category: Client project → R&D project')).toBe(true);
    const db = await getDb();
    const [row] = (await db.execute(sql`select categorie from pub_projets where code = 'HLT-026'`)).rows;
    expect(row).toEqual({ categorie: 'rd' });
    const [audit] = await db.select().from(auditEntries).where(sql`${auditEntries.objectRef} = 'HLT-026' and ${auditEntries.area} = 'Contract'`).orderBy(sql`${auditEntries.occurredAt} desc`).limit(1);
    expect(audit).toMatchObject({ before: { category: 'client' }, after: { category: 'rd' } });
    expect((await listProjects()).find((p) => p.code === 'HLT-026')).toMatchObject({ rd: true });
    // Unchanged → nothing written.
    const n = (await listAudit()).length;
    expect(await setProjectCategoryAction('HLT-026', 'rd')).toEqual({ ok: true });
    expect((await listAudit()).length).toBe(n);
    Object.assign(viewer, { name: 'Hélène Marchetti', role: 'director', lead: true });
    expect(await setProjectCategoryAction('HLT-026', 'client')).toEqual({ ok: true });
    expect(await getProjectCategory('HLT-026')).toBe('client');
  });

  it('the card: the category for everyone, the editor for the leads only (EN / FR)', () => {
    const fr = card('fr', true);
    expect(fr).toContain('Catégorie du projet');
    expect(fr).toContain('Projet client');
    expect(fr).toContain('Projet R&amp;D');
    const ro = card('en', false, 'rd');
    expect(ro).toContain('R&amp;D project');
    expect(ro).not.toContain('role="radiogroup"');
  });
});
