// What-if Server Functions (docs/spec/05 §4.5; chapter 4, S-7): permission (outside / read-only), input validation, levers
// derived from the data and persisted per scenario, audit by the viewer, "Select scenario → create requests" drafting
// resource requests through the requests DAL, New / rename / delete scenario, and "Apply" on a suggested rebalancing.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const jar = new Map<string, string>();
const revalidated: string[] = [];
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
import { asc, eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activities, activityAssignments, persons, projects } from '@/server/db/schema';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { getDepartmentApprovals, listResourceRequests } from '@/server/dal/requests';
import { getRebalancingSuggestions, getWhatIf } from '@/server/dal/resources';
import { COOKIE } from '@/server/session';
import {
  applySuggestion, autoLevelWhatIf, createWhatIfScenario, deleteWhatIfScenario, renameWhatIfScenario, selectWhatIfScenario, setWhatIfPriority, toggleWhatIfLever,
} from './actions';
import { resourcesView } from './model';
import { suggestionInputs } from './suggestions';
import { parseNewScenario, parseRenameScenario } from './whatif-form';

const as = (role: string, lang = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
const scenario = async (name: string) => (await getWhatIf('HLT-026'))!.scenarios.find((s) => s.name === name)!;
const on = (levers: Record<string, boolean>) => Object.keys(levers).filter((k) => levers[k]);
// HLT-026 levers derived from the seed: A1250 (Julien Wagner 8 h/d, crew 6 × 10 h/d) and, since the named demo assignments (owner
// answer 18 Oct 2026, src/server/db/seed/demo-assignments.ts), the HLT-026 activities their people work on — 23 levers. R-084: the
// loads come from the schedules — Julien Wagner is above 100 % in weeks 42–44 (relief lever).
const RELIEF = 'extra_resource:A1250:julien-wagner';
const OVERTIME = 'overtime:A1250:steel-erection-crew';
const CREW = 'extra_resource:A1250:steel-erection-crew';
/** Scenario A ('contractor', 'overtime'): every derived contractor and overtime lever of HLT-026. */
const A_LEVERS = 17;
/** Scenario B ('delay', 'move'): the derived shifts and internal colleagues. */
/** "Protect people" auto-level on HLT-026: the reliefs (contractor or colleague) and the shifts of the overloaded people. */
const PROTECT = [
  RELIEF, 'extra_resource:A1260:julien-wagner', 'extra_resource:A1320:amelie-ollivier', 'extra_resource:A1320:julien-wagner', 'extra_resource:A1320:thomas-kerbrat',
  'shift:A1320', 'extra_resource:A1330:julien-wagner', 'extra_resource:A1330:thomas-kerbrat', 'extra_resource:A1330:helene-sauvage', 'shift:A1330',
  'extra_resource:A1420:pauline-nogues', 'extra_resource:A1430:pauline-nogues', 'extra_resource:A1510:amelie-ollivier', 'extra_resource:A1510:thomas-kerbrat', 'shift:A1520',
];
const B_LEVERS = ['shift:A1320', 'extra_resource:A1330:helene-sauvage', 'shift:A1330', 'extra_resource:A1430:helene-sauvage', 'extra_resource:A1520:amelie-ollivier', 'shift:A1520'];

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  as('director');
  revalidated.length = 0;
});

describe('what-if Server Functions', () => {
  it('toggle a derived lever: saved with the scenario, effects recomputed, audited, revalidated', async () => {
    // Seed scenario A (contractor + overtime) reads as the derived contractor and overtime levers until it is edited — the three
    // A1250 levers first.
    const a0 = await scenario('A');
    expect([on(a0.levers).length, on(a0.levers).slice(0, 3), a0.saved]).toEqual([A_LEVERS, [RELIEF, OVERTIME, CREW], false]);
    expect(await toggleWhatIfLever('HLT-026', 'A', RELIEF)).toEqual({ ok: true });
    const a = await scenario('A');
    expect([on(a.levers), a.saved, a.result.finish, a.result.daysGained]).toEqual([on(a0.levers).filter((c) => c !== RELIEF), true, '2026-12-17', 20]);
    expect(revalidated).toEqual(['/resources/what-if', '/resources/requests', '/resources']);
    expect((await listAudit()).find((x) => x.object === 'Scenario A')).toMatchObject({ who: 'Marie Lefebvre', change: 'lever off: Contract structural engineer relieves Julien Wagner (A1250)', area: 'What-if levelling' });
    await toggleWhatIfLever('HLT-026', 'A', RELIEF);
    expect(on((await scenario('A')).levers)).toEqual(on(a0.levers));
  });

  it('priority keeps the levers; auto-level applies the derived set of the priority', async () => {
    as('pm');
    expect(await setWhatIfPriority('HLT-026', 'B', 'date')).toEqual({ ok: true });
    const b = await scenario('B');
    // Seed scenario B ('delay', 'move'): the derived shifts and internal colleagues (none before the named demo assignments).
    expect([b.priority, on(b.levers)]).toEqual(['date', B_LEVERS]);
    expect(await autoLevelWhatIf('HLT-026', 'B')).toEqual({ ok: true });
    expect(on((await scenario('B')).levers)).toEqual([
      OVERTIME, CREW, 'overtime:A1260:thomas-kerbrat', 'extra_resource:A1260:thomas-kerbrat', 'overtime:A1430:helene-sauvage', 'extra_resource:A1430:helene-sauvage',
    ]);
    await setWhatIfPriority('HLT-026', 'B', 'people');
    expect(await autoLevelWhatIf('HLT-026', 'B')).toEqual({ ok: true });
    // R-084 + the named demo assignments (18 Oct 2026): "Protect people" takes the levers that relieve an overloaded person
    // without overloading anyone else.
    expect(on((await scenario('B')).levers)).toEqual(PROTECT);
  });

  it('select scenario → create requests: DRAFT requests (not in the department queue), toast, idempotent; one selected; audit by the viewer', async () => {
    as('pm');
    const r = await selectWhatIfScenario('HLT-026', 'A');
    const ids = Array.from({ length: A_LEVERS }, (_, i) => `RQ-0${45 + i}`);
    expect(r).toEqual({
      ok: true,
      message: `Scenario A selected · ${A_LEVERS} draft requests created (${ids.join(', ')}) — send them from Resource requests`,
    });
    const drafts = (await listResourceRequests({ projectCode: 'HLT-026', status: 'draft' })).map((q) => [q.id, q.title, q.resource, q.hours, q.requestedByName, q.activity?.code]);
    expect(drafts).toHaveLength(A_LEVERS);
    // The three A1250 levers first (lever order).
    expect(drafts.filter((d) => d[5] === 'A1250')).toEqual([
      ['RQ-047', 'Extra resource 6 → 7 — Steel erection crew', 'Steel erection crew', 96, 'Romain Aubert', 'A1250'],
      ['RQ-046', 'Overtime 10 → 12 h/d — Steel erection crew', 'Steel erection crew', 96, 'Romain Aubert', 'A1250'],
      ['RQ-045', 'Contract structural engineer — relieve Julien Wagner', 'Contract structural engineer', 32, 'Romain Aubert', 'A1250'],
    ]);
    expect((await getDepartmentApprovals('Engineering'))!.pending.map((q) => q.id)).not.toContain('RQ-045');
    expect(await selectWhatIfScenario('HLT-026', 'A')).toEqual({ ok: true, message: 'Scenario A selected · its requests already exist' });
    const w = (await getWhatIf('HLT-026'))!;
    expect(w.scenarios.map((s) => [s.name, s.selected, s.requests])).toEqual([['A', true, { draft: A_LEVERS, sent: 0 }], ['B', false, { draft: 0, sent: 0 }]]);
    expect(w.scenarios[0].appliedByName).toBe('Romain Aubert');
    expect((await listActivity())[0]).toMatchObject({ who: 'Romain Aubert', what: `Drafted ${A_LEVERS} resource requests from what-if scenario A · ${ids.join(', ')}`, kind: 'request' });
    // R-041 (P-2): the head of engineering is not on Harbor Line's team — the project's what-if is read-only for her.
    as('depthead');
    expect(await selectWhatIfScenario('HLT-026', 'B')).toEqual({ error: 'What-if levelling is read-only for you' });
    as('director');
    // R-084: scenario B ("Protect people", see above): one draft per relief, none for the 3 shifts (entered in the plan).
    const b = PROTECT.length - 3;
    const bIds = Array.from({ length: b }, (_, i) => `RQ-0${45 + A_LEVERS + i}`);
    expect(await selectWhatIfScenario('HLT-026', 'B')).toEqual({
      ok: true, message: `Scenario B selected · ${b} draft requests created (${bIds.join(', ')}) — send them from Resource requests · 3 shifts to enter in the plan before the next Reschedule`,
    });
    const audit = (await listAudit()).filter((a) => a.object === 'Scenario B' && a.change === 'selected');
    expect(audit.map((a) => a.who)).toEqual(['Marie Lefebvre']);
  });

  it('rejects viewers outside the workspace and invalid input', async () => {
    as('member');
    expect(await toggleWhatIfLever('HLT-026', 'A', OVERTIME)).toEqual({ error: 'What-if levelling is read-only for you' });
    as('procurement', 'fr');
    expect(await selectWhatIfScenario('HLT-026', 'A')).toEqual({ error: 'Le lissage what-if est en consultation pour vous' });
    as('director');
    expect(await toggleWhatIfLever('HLT-026', 'A', 'teleport')).toEqual({ error: 'The change could not be saved' });
    expect(await toggleWhatIfLever('HLT-026', 'Z', OVERTIME)).toEqual({ error: 'Invalid request' });
    expect(await setWhatIfPriority('HLT-026', 'A', 'speed')).toEqual({ error: 'Invalid request' });
    expect(await autoLevelWhatIf('XXX-000', 'A')).toEqual({ error: 'Invalid request' });
    expect(await autoLevelWhatIf('EWA-051', 'A')).toEqual({ error: 'No levelling scenario for this project' });
    // @ts-expect-error untrusted input
    expect(await toggleWhatIfLever(42, 'A', OVERTIME)).toEqual({ error: 'Invalid request' });
    expect(revalidated).toEqual([]);
  });

  it('a PM on a project they do not own is read-only', async () => {
    // Romain Aubert owns HLT-026 only; NDC-031 has a plan (so a what-if) but is read-only for him.
    as('pm');
    expect(await createWhatIfScenario('NDC-031', { name: 'Mine' })).toEqual({ error: 'What-if levelling is read-only for you' });
  });

  it('New scenario, rename, delete: validated, audited; duplicate names refused', async () => {
    expect(await createWhatIfScenario('HLT-026', { name: '  ', basis: 'current_plan', note: '' })).toEqual({ error: 'Scenario name is required' });
    expect(await createWhatIfScenario('HLT-026', { name: 'Night shifts', basis: 'current_plan', note: 'Two crews' })).toEqual({ toast: 'Scenario created' });
    const c = (await getWhatIf('HLT-026'))!.scenarios[2];
    expect([c.name, c.priority, on(c.levers), c.saved, c.basis, c.horizonMonths, c.hypotheses, c.createdByName]).toEqual(['Night shifts', 'date', [], true, 'current_plan', null, 'Two crews', 'Marie Lefebvre']);
    // The prototype's "Baseline BL1" basis is gone (every scenario is evaluated on the current plan).
    expect(await createWhatIfScenario('HLT-026', { name: 'C', basis: 'baseline' })).toEqual({ error: 'Unknown basis' });
    expect(await createWhatIfScenario('HLT-026', { name: 'night SHIFTS' })).toEqual({ error: 'A scenario with this name already exists' });
    expect(await createWhatIfScenario('HLT-026', { name: 'C', basis: 'tomorrow' })).toEqual({ error: 'Unknown basis' });
    expect(await renameWhatIfScenario('HLT-026', 'Night shifts', { name: 'a' })).toEqual({ error: 'A scenario with this name already exists' });
    expect(await renameWhatIfScenario('HLT-026', 'Night shifts', { name: 'Week-ends', note: 'Saturday crews' })).toEqual({ toast: 'Scenario saved' });
    expect((await scenario('Week-ends')).hypotheses).toBe('Saturday crews');
    expect(await deleteWhatIfScenario('HLT-026', 'Week-ends')).toEqual({ ok: true, message: 'Scenario deleted' });
    expect((await getWhatIf('HLT-026'))!.scenarios.map((s) => s.name)).toEqual(['A', 'B']);
    expect((await listAudit()).filter((a) => /Night shifts|Week-ends/.test(a.object)).map((a) => [a.object, a.change])).toEqual([
      ['Scenario Week-ends', 'deleted'], ['Scenario Week-ends', 'renamed from Night shifts'], ['Scenario Night shifts', 'created'],
    ]);
    as('member');
    expect(await createWhatIfScenario('HLT-026', { name: 'D' })).toEqual({ error: 'What-if levelling is read-only for you' });
    expect(await deleteWhatIfScenario('HLT-026', 'A')).toEqual({ error: 'What-if levelling is read-only for you' });
  });

  it('Apply on a suggested rebalancing: one draft request; a second Apply finds it; read-only viewers refused', async () => {
    as('pm', 'fr');
    const r = await applySuggestion('HLT-026', CREW);
    // Scenario A already drafted this lever (RQ-047): the suggestion does not draft it twice.
    expect(r).toEqual({ ok: true, message: 'Ce levier est déjà demandé' });
    as('member');
    expect(await applySuggestion('HLT-026', CREW)).toEqual({ error: 'Resource requests are read-only for you' });
    as('pm');
    expect(await applySuggestion('NDC-031', CREW)).toEqual({ error: 'Resource requests are read-only for you' });
    as('director');
    expect(await applySuggestion('HLT-026', 'teleport')).toEqual({ error: 'The change could not be saved' });
    expect(await applySuggestion('HLT-026', 'shift:A1520')).toEqual({ error: 'The change could not be saved' });
  });
});

describe('form parsers', () => {
  it('New scenario: defaults selects to their first option and trims', () => {
    expect(parseNewScenario({ name: '  Plan  B2 ' })).toEqual({ ok: true, value: { name: 'Plan B2', basis: 'current_plan', hypotheses: '' } });
    expect(parseNewScenario({ name: 'x'.repeat(61) })).toEqual({ ok: false, error: 'Scenario name is too long' });
    // No horizon any more (the pool has 8 allocation weeks): a stray value is ignored.
    expect(parseNewScenario({ name: 'A', horizon: '24', basis: 'last_approved' })).toEqual({ ok: true, value: { name: 'A', basis: 'last_approved', hypotheses: '' } });
    expect(parseNewScenario({ name: 'A', note: 'y'.repeat(2001) })).toEqual({ ok: false, error: 'Hypotheses are too long' });
    expect(parseNewScenario(null)).toEqual({ ok: false, error: 'Scenario name is required' });
  });

  it('rename: the current name may stay; others must stay unique', () => {
    expect(parseRenameScenario({ name: ' A ', note: ' x ' }, 'A', ['A', 'B'])).toEqual({ ok: true, value: { name: 'A', hypotheses: 'x' } });
    expect(parseRenameScenario({ name: 'b' }, 'A', ['A', 'B'])).toEqual({ ok: false, error: 'A scenario with this name already exists' });
    expect(parseRenameScenario({ name: '' }, 'A')).toEqual({ ok: false, error: 'Scenario name is required' });
  });
});

// Fresh database: paths the scenario tests above do not reach (chapter 4, S-7 / R-3; DELIVERY-6-PLAN §3.3 gaps).
describe('what-if — fresh data', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  /** HLT-026 activities as stored (the plan must not change before the next Reschedule). */
  const planRows = async () => {
    const db = await getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
    return db.select().from(activities).where(eq(activities.projectId, p.id)).orderBy(asc(activities.code));
  };

  it('Apply on a suggestion drafts a fresh request; the next render tags it "Requested · RQ-045"; a second Apply finds it', async () => {
    as('pm');
    expect(await applySuggestion('HLT-026', CREW)).toEqual({ ok: true, message: 'Draft request RQ-045 created — send it from Resource requests' });
    const [rq] = await listResourceRequests({ projectCode: 'HLT-026', status: 'draft' });
    // The lever alone: one more crew unit at 10 h/d over A1250's remaining span (scenario A adds overtime: 96 h).
    expect([rq.id, rq.title, rq.hours, rq.activity?.code]).toEqual(['RQ-045', 'Extra resource 6 → 7 — Steel erection crew', 100, 'A1250']);
    // (Every suggestion: the crew unit is no longer among the top 3 with the named demo assignments.)
    const rows = await getRebalancingSuggestions({ projectCode: 'HLT-026', limit: 100 });
    const view = (lang: 'en' | 'fr') =>
      resourcesView(
        { scope: 'project', weeks: [], weekStarts: [], people: [], departments: [], labor: null, openRequests: 0, suggestions: suggestionInputs(rows, { portfolio: false, canEdit: true, readOnly: () => false }) },
        (x) => x,
        lang,
      ).suggestions!.find((x) => x.leverCode === CREW)!;
    expect([view('en').requested, view('fr').requested]).toEqual(['Requested · RQ-045', 'Demandée · RQ-045']);
    expect(await applySuggestion('HLT-026', CREW)).toEqual({ ok: true, message: 'This lever is already requested' });
    expect((await listResourceRequests({ projectCode: 'HLT-026', status: 'draft' })).map((q) => q.id)).toEqual(['RQ-045']);
  });

  it('a double-click on Select drafts the requests once (one transaction per apply)', async () => {
    as('pm');
    const before = await planRows();
    const [r1, r2] = await Promise.all([selectWhatIfScenario('HLT-026', 'A'), selectWhatIfScenario('HLT-026', 'A')]);
    const created = [r1, r2].map((r) => ('message' in r ? r.message : '')).filter((m) => m?.includes('created'));
    expect(created).toHaveLength(1);
    // Scenario A drafts its levers; the suggestion's RQ-045 has no scenario, so CREW is drafted again for A.
    expect((await getWhatIf('HLT-026'))!.scenarios[0].requests).toEqual({ draft: A_LEVERS, sent: 0 });
    // The plan is a copy: select / apply never write the activities (dates, durations, floats, constraints).
    expect(await planRows()).toEqual(before);
  });

  it('New scenario from the selected one copies its levers and priority; refused while none is retained', async () => {
    as('director');
    await setWhatIfPriority('HLT-026', 'B', 'people');
    expect(await createWhatIfScenario('HLT-026', { name: 'C', basis: 'last_approved', note: '' })).toEqual({ toast: 'Scenario created' });
    const c = (await getWhatIf('HLT-026'))!.scenarios.find((x) => x.name === 'C')!;
    const a = (await getWhatIf('HLT-026'))!.scenarios.find((x) => x.name === 'A')!;
    expect([c.basis, c.priority, c.saved, on(c.levers)]).toEqual(['last_approved', a.priority, true, on(a.levers)]);
    expect((await listAudit()).find((x) => x.object === 'Scenario C')?.change).toBe(`created from scenario A (${A_LEVERS} levers)`);
    as('director', 'fr');
    expect(await createWhatIfScenario('NDC-031', { name: 'Copy', basis: 'last_approved' })).toEqual({ error: 'Aucun scénario retenu ni appliqué pour l’instant — partez du plan actuel' });
  });

  it('an overloaded assignee on a movable activity yields a shift lever; selecting it drafts nothing and asks to enter the shift', async () => {
    // A1320 (not started, total float 1 d, SNET). R-084 (owner answer 17 Oct 2026, third round): an owner carries no load (it is
    // counted on their trade), so a shift frees an ASSIGNEE. With the named demo assignments (18 Oct 2026) it frees Amélie
    // Ollivier (131 % in the week of 12 Oct); without them, its owner alone frees nobody; Julien Wagner assigned at 8 h/d does.
    const db = await getDb();
    expect((await getWhatIf('HLT-026'))!.levers.find((l) => l.code === 'shift:A1320')).toMatchObject({ person: 'Amélie Ollivier', to: 1 });
    const [julien] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Julien Wagner'));
    const [a1320] = await db.select({ id: activities.id }).from(activities).where(eq(activities.code, 'A1320'));
    await db.delete(activityAssignments).where(eq(activityAssignments.activityId, a1320.id));
    await db.update(activities).set({ ownerPersonId: julien.id }).where(eq(activities.id, a1320.id));
    // The owner alone frees nobody (no shift lever on A1320)…
    expect((await getWhatIf('HLT-026'))!.levers.some((l) => l.code === 'shift:A1320')).toBe(false);
    // …an assignment does.
    await db.insert(activityAssignments).values({ activityId: a1320.id, position: 9, resource: 'Julien Wagner', personId: julien.id, detail: '', units: '1 × 8 h/d', progressText: '', resourceCount: 1, hoursPerDay: 8 });
    const w = (await getWhatIf('HLT-026'))!;
    const shift = w.levers.find((l) => l.code === 'shift:A1320')!;
    expect([shift.code, shift.person, shift.to]).toEqual(['shift:A1320', 'Julien Wagner', 1]);
    as('pm');
    expect(await createWhatIfScenario('HLT-026', { name: 'Shift only', basis: 'current_plan' })).toEqual({ toast: 'Scenario created' });
    expect(await toggleWhatIfLever('HLT-026', 'Shift only', 'shift:A1320')).toEqual({ ok: true });
    const before = await planRows();
    expect(await selectWhatIfScenario('HLT-026', 'Shift only')).toEqual({
      ok: true, message: 'Scenario Shift only selected · 1 shift to enter in the plan before the next Reschedule',
    });
    expect((await getWhatIf('HLT-026'))!.scenarios.find((x) => x.name === 'Shift only')!.requests).toEqual({ draft: 0, sent: 0 });
    expect(await planRows()).toEqual(before);
  });
});
