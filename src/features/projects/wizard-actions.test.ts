// New project wizard Server Function (chapter 4, A-2 / L-3) against an in-memory database: required name and client, the
// planned window, the PM among the proposed people, the template instantiated with the viewer as the author.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const session = { role: 'pm' as RoleKey };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return { getViewer: async () => PERSONA_BY_ROLE[session.role] };
});

import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getProject } from '@/server/dal/projects';
import { getNewProjectSetup } from '@/server/dal/projects-register';
import { createProjectAction, type NewProjectDraft } from './actions';

const draft = (patch: Partial<NewProjectDraft> = {}): NewProjectDraft => ({
  name: 'Quay crane retrofit', client: 'Port authority', das: '2', mt: 'EMP', cur: 'EUR', template: 'EMP',
  cats: [{ name: 'Études', type: 'Labor', budget: '160' }], cont: 5, cal: 'standard_5x8_workshop', pm: null, start: '2027-01-11', finish: '2027-09-30',
  ...patch,
});

describe('createProjectAction (L-3)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    session.role = 'pm';
  });

  it('requires a name, a client, a valid window and an offered PM', async () => {
    expect(await createProjectAction(draft({ name: '  ' }))).toEqual({ ok: false, error: 'Project name is required' });
    expect(await createProjectAction(draft({ client: '' }))).toEqual({ ok: false, error: 'Client / sponsor is required' });
    expect(await createProjectAction(draft({ finish: '2027-01-01' }))).toEqual({ ok: false, error: 'The planned finish must be after the planned start' });
    expect(await createProjectAction(draft({ start: 'soon' }))).toEqual({ ok: false, error: 'Enter the planned start and finish dates' });
    expect(await createProjectAction(draft({ pm: 'someone' }))).toEqual({ ok: false, error: 'Choose the project manager among the proposed people' });
    expect(await createProjectAction(draft({ cal: 'Lunar' }))).toEqual({ ok: false, error: 'Invalid project setup' });
    expect(await createProjectAction(draft({ mt: 'NOPE', template: 'NOPE' }))).toEqual({ ok: false, error: 'Invalid project setup' });
    session.role = 'member';
    expect(await createProjectAction(draft())).toEqual({ ok: false, error: 'You are not allowed to create projects' });
  });

  it('creates the project with the viewer as PM by default, the template instantiated', async () => {
    const r = await createProjectAction(draft());
    expect(r).toMatchObject({ ok: true, name: 'Quay crane retrofit', number: '#045' });
    if (!r.ok) return;
    expect(await getProject(r.code)).toMatchObject({ pm: 'R. Aubert', client: 'Port authority', start: 'Jan 2027', finish: 'Sep 2027' });
    session.role = 'director';
    const setup = await getNewProjectSetup();
    const perrin = setup.managers.find((m) => m.short === 'S. Perrin')!;
    const r2 = await createProjectAction(draft({ name: 'Second', pm: perrin.id, cal: 'Site 6d · 10h', template: 'blank' }));
    expect(r2).toMatchObject({ ok: true });
    if (r2.ok) expect(await getProject(r2.code)).toMatchObject({ pm: 'S. Perrin' });
  });
});
