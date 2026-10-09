// New project wizard Server Function (chapter 4, A-2 / L-3) against an in-memory database: required name and client, the
// planned window, the PM among the proposed people, the template instantiated with the viewer as the author; L-3b: the
// site (city + country) is required and stored (zone from the country), the planned finish is optional (from the plan).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const session = { role: 'pm' as RoleKey };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return { getViewer: async () => PERSONA_BY_ROLE[session.role] };
});

import { eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { projectSites, projects } from '@/server/db/schema';
import { openDatabase } from '@/server/db/open';
import { getProject } from '@/server/dal/projects';
import { getNewProjectSetup } from '@/server/dal/projects-register';
import { createProjectAction, type NewProjectDraft } from './actions';

const draft = (patch: Partial<NewProjectDraft> = {}): NewProjectDraft => ({
  name: 'Quay crane retrofit', client: 'Port authority', das: '2', mt: 'EMP', cur: 'EUR', template: 'EMP',
  cats: [{ name: 'Études', type: 'Labor', budget: '160' }], cont: 5, cal: 'standard_5x8_workshop', pm: null, start: '2027-01-11', finish: '2027-09-30',
  city: 'Le Havre', country: 'France',
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
    expect(await createProjectAction(draft({ start: '', finish: '' }))).toEqual({ ok: false, error: 'Enter the planned start date' });
    // L-3b: the location is required — a city and a country of the countries table.
    expect(await createProjectAction(draft({ city: ' ' }))).toEqual({ ok: false, error: 'Enter the site city' });
    expect(await createProjectAction(draft({ city: undefined }))).toEqual({ ok: false, error: 'Enter the site city' });
    expect(await createProjectAction(draft({ country: 'Atlantis' }))).toEqual({ ok: false, error: 'Choose the site country among the proposed countries' });
    expect(await createProjectAction(draft({ country: '' }))).toEqual({ ok: false, error: 'Choose the site country among the proposed countries' });
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

  it('L-3b: stores the site (zone from the country, coordinates of a known site) and takes the planned finish from the plan', async () => {
    session.role = 'director';
    const r = await createProjectAction(draft({ name: 'Abidjan spur', city: 'abidjan', country: 'Côte d’Ivoire', finish: '' }));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const db = await getDb();
    const [row] = await db.select().from(projects).where(eq(projects.code, r.code));
    const [site] = await db.select().from(projectSites).where(eq(projectSites.projectId, row.id));
    expect(site).toMatchObject({ city: 'abidjan', countryName: 'Côte d’Ivoire', zoneOverride: null });
    // Abidjan is a seeded site (prototype GEO, TTR-017): its coordinates are reused; zone = the country's zone (Africa).
    expect(site.lat).not.toBeNull();
    expect(await getProject(r.code)).toMatchObject({ country: 'Côte d’Ivoire', zone: 'afr' });
    // 6 phases × 30 working days on the Atelier calendar (Mon–Fri) from Mon 11 Jan 2027 = 36 weeks → Fri 17 Sep, plus the
    // 4 weekday French holidays of the span (Easter Monday 29 Mar, Ascension 6 May, Whit Monday 17 May, 14 Jul) → Thu 23 Sep.
    expect(row.plannedFinishDate).toBe('2027-09-23');
    expect(await getProject(r.code)).toMatchObject({ start: 'Jan 2027', finish: 'Sep 2027' });
    // A city without a known site: stored without coordinates (no geocoding source), still in its country's zone.
    const r2 = await createProjectAction(draft({ name: 'Dakar line', city: 'Dakar', country: 'Senegal', template: 'blank', finish: null }));
    expect(r2).toMatchObject({ ok: true });
    if (!r2.ok) return;
    expect(await getProject(r2.code)).toMatchObject({ city: 'Dakar', country: 'Senegal', zone: 'afr', lat: null, lng: null, finish: '—' });
  });
});

describe('lifecycle Server Functions (security review: another PM\'s project is read-only)', () => {
  beforeEach(() => {
    session.role = 'pm';
  });

  it('a PM moves and ticks only the projects they manage; the director any', async () => {
    const { moveStageAction, setDeliverableAction } = await import('./actions');
    // NDC-031 is managed by S. Perrin, not by the PM persona (R. Aubert).
    const ndc = (await getProject('NDC-031'))!;
    expect(await moveStageAction({ code: 'NDC-031', to: 'annule', mode: 'forced', reason: 'test' })).toMatchObject({ ok: false });
    expect(await setDeliverableAction({ code: 'NDC-031', stage: ndc.stage, index: 0, done: true })).toMatchObject({ ok: false });
    expect((await getProject('NDC-031'))!.stage).toBe(ndc.stage);
    // On their own project the PM passes the rights check and reaches the stage rules (unknown stage → refused by the rules).
    expect(await moveStageAction({ code: 'HLT-026', to: 'nope', mode: 'auto' })).toEqual({ ok: false, error: 'This stage change is not allowed' });
    session.role = 'director';
    expect(await moveStageAction({ code: 'NDC-031', to: 'nope', mode: 'auto' })).toEqual({ ok: false, error: 'This stage change is not allowed' });
  });
});
