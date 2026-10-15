// R-089 (P-8b): the task sheet of a sourcing task — "Person to find and name" with the contract role and the request; the
// "Name the person" action for procurement and the director only (the dialog opens on demand); other tasks have no card.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const state = { role: 'procurement' as RoleKey, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/my/tasks',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('404');
  },
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: state.lang, t: makeT(state.lang) }) };
});
vi.mock('@/server/project-context', async () => {
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  const { isOutside } = await import('@/components/app/shell/nav-model');
  return {
    getScreenAccess: async (screen: 'mywork' | 'task') => {
      const outside = isOutside(state.role, screen);
      return { viewer: PERSONA_BY_ROLE[state.role], outside, canEdit: !outside };
    },
  };
});
vi.mock('@/components/app/shell/page-header', async () => {
  const { createElement } = await import('react');
  return { PageHeader: ({ primary }: { primary?: unknown }) => createElement('header', null, primary as never) };
});

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TaskPage from '@/app/(app)/my/tasks/[taskId]/page';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { approveResourceRequest } from '@/server/dal/requests';

let task = '';
const page = async (id: string) => renderToStaticMarkup(h(I18nProvider, { lang: state.lang, children: (await TaskPage({ params: Promise.resolve({ taskId: id }) })) as never }));

beforeAll(async () => {
  setDb(await openDatabase());
  task = await approveResourceRequest('RQ-043', 'Marion Kerviel');
}, 60_000);

describe('R-089 — sourcing card on the task sheet', () => {
  it('procurement: the card with the role and the request, and "Name the person"', async () => {
    state.role = 'procurement';
    const html = await page(task);
    expect(html).toContain('Person to find and name');
    expect(html).toContain('Contract structural engineer · RQ-043');
    expect(html).toContain('>Name the person<');
    expect(html).not.toContain('role="dialog"');
  });

  it('the director names too; a team member sees the card without the action', async () => {
    state.role = 'director';
    expect(await page(task)).toContain('>Name the person<');
    state.role = 'member';
    const html = await page(task);
    expect(html).toContain('Person to find and name');
    expect(html).not.toContain('Name the person');
  });

  it('French: the seeded contract role keeps its dictionary entry (dataText, R-148), the vocabulary is translated', async () => {
    state.role = 'procurement';
    state.lang = 'fr';
    const html = await page(task);
    state.lang = 'en';
    expect(html).toContain('Personne à trouver et nommer');
    expect(html).toContain('Ingénieur structure intérimaire · RQ-043');
    expect(html).toContain('>Nommer la personne<');
  });

  it('an ordinary task has no sourcing card', async () => {
    state.role = 'procurement';
    expect(await page('T-2314')).not.toContain('Person to find and name');
  });
});
