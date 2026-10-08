// What-if Server Functions (docs/spec/05 §4.5): permission (outside / read-only), input validation, persisted
// effects through the resources DAL, audit of the selection by the viewer, and "New scenario".
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const jar = new Map<string, string>();
const revalidated: string[] = [];
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listAudit } from '@/server/dal/notifications';
import { getWhatIf } from '@/server/dal/resources';
import { COOKIE } from '@/server/session';
import { autoLevelWhatIf, createWhatIfScenario, selectWhatIfScenario, setWhatIfPriority, toggleWhatIfLever } from './actions';
import { parseNewScenario } from './whatif-form';

const as = (role: string, lang = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
const scenario = async (name: string) => (await getWhatIf('HLT-026'))!.scenarios.find((s) => s.name === name)!;
const on = (levers: Record<string, boolean>) => Object.keys(levers).filter((k) => levers[k]);

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  as('director');
  revalidated.length = 0;
});

describe('what-if Server Functions', () => {
  it('toggle a lever, persisted and revalidated', async () => {
    expect(await toggleWhatIfLever('HLT-026', 'A', 'split')).toEqual({ ok: true });
    expect(on((await scenario('A')).levers)).toEqual(['contractor', 'overtime', 'split']);
    expect(revalidated).toEqual(['/resources/what-if']);
    await toggleWhatIfLever('HLT-026', 'A', 'split');
    expect(on((await scenario('A')).levers)).toEqual(['contractor', 'overtime']);
  });

  it('priority keeps the levers; auto-level applies AUTO[priority]', async () => {
    as('pm');
    expect(await setWhatIfPriority('HLT-026', 'B', 'budget')).toEqual({ ok: true });
    const b = await scenario('B');
    expect([b.priority, on(b.levers)]).toEqual(['budget', ['delay', 'move']]);
    expect(await autoLevelWhatIf('HLT-026', 'B')).toEqual({ ok: true });
    expect(on((await scenario('B')).levers)).toEqual(['delay', 'split', 'move']);
    await setWhatIfPriority('HLT-026', 'B', 'people');
  });

  it('select scenario: only one selected, audit row by the viewer (not a fixed actor)', async () => {
    as('depthead');
    expect(await selectWhatIfScenario('HLT-026', 'B')).toEqual({ ok: true });
    as('director');
    expect(await selectWhatIfScenario('HLT-026', 'A')).toEqual({ ok: true });
    const w = (await getWhatIf('HLT-026'))!;
    expect(w.scenarios.map((s) => [s.name, s.selected])).toEqual([['A', true], ['B', false]]);
    const audit = (await listAudit()).filter((a) => a.object === 'Scenario B' || a.object === 'Scenario A');
    expect(audit.map((a) => [a.object, a.who])).toEqual(expect.arrayContaining([['Scenario B', 'Marion Kerviel'], ['Scenario A', 'Marie Lefebvre']]));
  });

  it('rejects viewers outside the workspace and invalid input', async () => {
    as('member');
    expect(await toggleWhatIfLever('HLT-026', 'A', 'split')).toEqual({ error: 'What-if levelling is read-only for you' });
    as('procurement', 'fr');
    expect(await selectWhatIfScenario('HLT-026', 'A')).toEqual({ error: 'Le lissage what-if est en consultation pour vous' });
    as('director');
    expect(await toggleWhatIfLever('HLT-026', 'A', 'teleport')).toEqual({ error: 'Invalid request' });
    expect(await toggleWhatIfLever('HLT-026', 'Z', 'split')).toEqual({ error: 'Invalid request' });
    expect(await setWhatIfPriority('HLT-026', 'A', 'speed')).toEqual({ error: 'Invalid request' });
    expect(await autoLevelWhatIf('XXX-000', 'A')).toEqual({ error: 'Invalid request' });
    expect(await autoLevelWhatIf('EWA-051', 'A')).toEqual({ error: 'No levelling scenario for this project' });
    // @ts-expect-error untrusted input
    expect(await toggleWhatIfLever(42, 'A', 'split')).toEqual({ error: 'Invalid request' });
    expect(revalidated).toEqual([]);
  });

  it('a PM on a project they do not own is read-only', async () => {
    // Romain Aubert owns HLT-026 only; a levelling context on another project would be read-only for him.
    as('pm');
    expect(await toggleWhatIfLever('NDC-031', 'A', 'split')).toEqual({ error: 'What-if levelling is read-only for you' });
  });

  it('New scenario: validated, third card with no lever, toast; duplicate names refused', async () => {
    expect(await createWhatIfScenario('HLT-026', { name: '  ', basis: 'current_plan', horizon: '3', note: '' })).toEqual({ error: 'Scenario name is required' });
    expect(await createWhatIfScenario('HLT-026', { name: 'Night shifts', basis: 'baseline', horizon: '6', note: 'Two crews' })).toEqual({ toast: 'Scenario created' });
    const w = (await getWhatIf('HLT-026'))!;
    const c = w.scenarios[2];
    expect([c.name, c.priority, on(c.levers), c.basis, c.horizonMonths, c.hypotheses]).toEqual(['Night shifts', 'date', [], 'baseline', 6, 'Two crews']);
    expect((await listAudit()).filter((a) => a.object === 'Scenario Night shifts').map((a) => [a.who, a.change])).toEqual([['Marie Lefebvre', 'created']]);
    expect(await createWhatIfScenario('HLT-026', { name: 'night SHIFTS' })).toEqual({ error: 'A scenario with this name already exists' });
    expect(await createWhatIfScenario('HLT-026', { name: 'C', basis: 'tomorrow' })).toEqual({ error: 'Unknown basis' });
    expect(await toggleWhatIfLever('HLT-026', 'Night shifts', 'delay')).toEqual({ ok: true });
    as('member');
    expect(await createWhatIfScenario('HLT-026', { name: 'D' })).toEqual({ error: 'What-if levelling is read-only for you' });
  });
});

describe('parseNewScenario', () => {
  it('defaults selects to their first option and trims', () => {
    expect(parseNewScenario({ name: '  Plan  B2 ' })).toEqual({ ok: true, value: { name: 'Plan B2', basis: 'current_plan', horizonMonths: 3, hypotheses: '' } });
    expect(parseNewScenario({ name: 'x'.repeat(61) })).toEqual({ ok: false, error: 'Scenario name is too long' });
    expect(parseNewScenario({ name: 'A', horizon: '24' })).toEqual({ ok: false, error: 'Unknown horizon' });
    expect(parseNewScenario({ name: 'A', note: 'y'.repeat(2001) })).toEqual({ ok: false, error: 'Hypotheses are too long' });
    expect(parseNewScenario(null)).toEqual({ ok: false, error: 'Scenario name is required' });
  });
});
