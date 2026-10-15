// Portfolio prioritisation Server Functions against an in-memory database: gating (director/pm inside the workspace;
// other roles are outside and read-only), validation of untrusted input, writes through the DAL (weights per viewer,
// proposal scores with the viewer as scorer, audit row) and revalidation. Session and access helpers are mocked; the
// gating uses the real role matrix.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { role: 'director' as string, name: 'Marie Lefebvre', lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', async () => {
  const { canSee } = await import('@/config/screens');
  return {
    getScreenAccess: async (screen: string) => ({
      viewer: { role: viewer.role, name: viewer.name },
      outside: !canSee(viewer.role as never, screen as never),
    }),
  };
});

import { revalidatePath } from 'next/cache';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listAudit } from '@/server/dal/notifications';
import { getPrioritisationScreen } from '@/server/dal/pfinance';
import { getScoreWeights, listPortfolioScores, saveProposalScore } from '@/server/dal/prioritisation';
import { scoreProposalAction, setScoreWeightAction } from './actions';
import { parseScoreProposal, scoreProposalForm } from './forms';
import { pfT } from './i18n';
import { prioritisationView } from './model';
import golden from './pfinance.golden.json';

const as = (role: string, name: string, lang: 'en' | 'fr' = 'en') => Object.assign(viewer, { role, name, lang });

describe('Portfolio prioritisation Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    as('director', 'Marie Lefebvre');
    vi.mocked(revalidatePath).mockClear();
  });

  it('weights: saved per viewer, validated 0–1, refused outside the workspace; the ranking follows', async () => {
    as('depthead', 'Marion Kerviel');
    expect(await setScoreWeightAction('fit', 0.5)).toEqual({ error: 'Outside my workspace · Read-only' });
    as('pm', 'Romain Aubert');
    expect(await setScoreWeightAction('nope', 0.5)).toEqual({ error: 'Invalid request' });
    expect(await setScoreWeightAction('fit', 1.5)).toEqual({ error: 'Weights are numbers from 0 to 1' });
    expect(await setScoreWeightAction('fit', -0.1)).toEqual({ error: 'Weights are numbers from 0 to 1' });
    expect(await setScoreWeightAction('fit', 'abc')).toEqual({ error: 'Weights are numbers from 0 to 1' });
    expect(await setScoreWeightAction('fit', { x: 1 } as never)).toEqual({ error: 'Weights are numbers from 0 to 1' });
    expect(await setScoreWeightAction('fit', '0,5')).toEqual({ ok: true, value: 0.5 });
    expect(revalidatePath).toHaveBeenCalledWith('/portfolio/prioritisation');
    expect((await getScoreWeights('pm')).fit).toBe(0.5);
    expect((await getScoreWeights('director')).fit).toBe(0.25);
    // The pm's ranking uses the saved weights: same as the prototype with pfWeights fit .5 (variant 2).
    const d = await getPrioritisationScreen('pm', null);
    const v = prioritisationView(d, d.weights, pfT(makeT('en'), 'en'), 'en');
    const g = (golden as { weights: { en: { weights: Record<string, number>; rows: { code: string; score: number }[]; kpis: { value: string }[] }[] } }).weights.en[1];
    expect(g.weights.fit).toBe(0.5);
    const scores = new Map(v.rows.map((r) => [r.code, r.score]));
    for (const r of g.rows) expect(scores.get(r.code), r.code).toBe(r.score);
    expect(v.kpis[4].value).toBe(g.kpis[4].value);
    expect(await setScoreWeightAction('fit', 0.25)).toEqual({ ok: true, value: 0.25 });
  });

  it('weights: FR error messages', async () => {
    as('pm', 'Romain Aubert', 'fr');
    expect(await setScoreWeightAction('fit', 3)).toEqual({ error: 'Les poids sont des nombres de 0 à 1' });
  });

  it('Score a proposal: pipeline projects only, whole scores 1–5, viewer as scorer, audit row; the ranking picks it up', async () => {
    as('client', 'Nadia Bensaïd');
    expect(await scoreProposalAction({ project: 'EWA-051', fit: '5', fin: '5', risk: '5', res: '5', client: '5' })).toEqual({ error: 'Outside my workspace · Read-only' });
    as('pm', 'Romain Aubert');
    expect(await scoreProposalAction({ project: 'HLT-026', fit: '5', fin: '5', risk: '5', res: '5', client: '5' })).toEqual({ error: 'Choose a project in the pipeline' });
    expect(await scoreProposalAction({ project: 'EWA-051', fit: '6', fin: '3', risk: '3', res: '3', client: '3' })).toEqual({ error: 'Scores are whole numbers from 1 to 5' });
    expect(await scoreProposalAction({ project: 'EWA-051', fit: '2.5', fin: '3', risk: '3', res: '3', client: '3' })).toEqual({ error: 'Scores are whole numbers from 1 to 5' });
    expect(await scoreProposalAction({ project: 'EWA-051', fit: '', fin: '3', risk: '3', res: '3', client: '3' })).toEqual({ error: 'Scores are whole numbers from 1 to 5' });
    // L-5a (R-134): resource fit and client priority are required and validated like the other axes.
    expect(await scoreProposalAction({ project: 'EWA-051', fit: '3', fin: '3', risk: '3' })).toEqual({ error: 'Scores are whole numbers from 1 to 5' });
    expect(await scoreProposalAction({ project: 'EWA-051', fit: '3', fin: '3', risk: '3', res: '0', client: '3' })).toEqual({ error: 'Scores are whole numbers from 1 to 5' });
    expect(await scoreProposalAction({ project: 'EWA-051', fit: '3', fin: '3', risk: '3', res: '3', client: '6' })).toEqual({ error: 'Scores are whole numbers from 1 to 5' });
    expect(await scoreProposalAction({ project: 'EWA-051', fit: '3', fin: '3', risk: '3', res: '3', client: '3', comment: 'x'.repeat(1001) })).toEqual({ error: 'The comment is too long' });
    expect(await scoreProposalAction(null as never)).toEqual({ error: 'Scores are whole numbers from 1 to 5' });
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();

    // L-5a (R-134): the 5 axes are scored ([4, 4, 3, 2, 4] → [5, 5, 5, 2, 4] when the seeded resource fit and client
    // priority are typed again).
    expect(await scoreProposalAction({ project: 'EWA-051', fit: '5', fin: '5', risk: '5', res: '2', client: '4', comment: '  Strong client  ' })).toEqual({ toast: 'Score saved' });
    expect(revalidatePath).toHaveBeenCalledWith('/portfolio/prioritisation');
    expect((await listPortfolioScores())['EWA-051']).toEqual([5, 5, 5, 2, 4]);
    const audit = await listAudit({ projectCode: 'EWA-051' });
    expect(audit[0]).toMatchObject({ who: expect.stringContaining('Aubert'), change: 'score: fit 5 · margin 5 · risk 5 · resources 2 · client 4', area: 'Prioritisation' });
    const d = await getPrioritisationScreen('director', null);
    const v = prioritisationView(d, d.weights, pfT(makeT('en'), 'en'), 'en');
    // 100 × (5·.25 + 5·.25 + 5·.2 + 2·.15 + 4·.15) / 5 = 88 → first.
    expect(v.rows[0]).toMatchObject({ code: 'EWA-051', score: 88, rank: 1 });
    expect(v.kpis[2].value).toBe('EWA-051');
    // Blank proposal = the select's first option (WSA-044).
    expect(await scoreProposalAction({ project: '', fit: '5', fin: '4', risk: '3', res: '4', client: '4' })).toEqual({ toast: 'Score saved' });
    expect((await listPortfolioScores())['WSA-044']).toEqual([5, 4, 3, 4, 4]);
    // restore the seed (EWA-051 [4, 4, 3, 2, 4]; L-5a: the restoring call types the seeded resource fit and client priority)
    await scoreProposalAction({ project: 'EWA-051', fit: '4', fin: '4', risk: '3', res: '2', client: '4' });
    expect((await listPortfolioScores())['EWA-051']).toEqual([4, 4, 3, 2, 4]);
  });

  it('Score a proposal: resource fit and client priority are stored and move the ranking (L-5a, R-134)', async () => {
    as('director', 'Marie Lefebvre');
    const rank = async () => {
      const d = await getPrioritisationScreen('director', null);
      return prioritisationView(d, d.weights, pfT(makeT('en'), 'en'), 'en').rows.find((r) => r.code === 'EWA-051')!;
    };
    const before = await rank();
    // Same fit, margin and risk; resource fit 2 → 5 and client priority 4 → 5: + 100 × (3·.15 + 1·.15) / 5 = + 12.
    expect(await scoreProposalAction({ project: 'EWA-051', fit: '4', fin: '4', risk: '3', res: '5', client: '5' })).toEqual({ toast: 'Score saved' });
    expect((await listPortfolioScores())['EWA-051']).toEqual([4, 4, 3, 5, 5]);
    const after = await rank();
    expect(after.score).toBe(before.score + 12);
    expect(after.rank).toBeLessThanOrEqual(before.rank);
    const audit = await listAudit({ projectCode: 'EWA-051' });
    expect(audit[0]).toMatchObject({ who: 'Marie Lefebvre', change: 'score: fit 4 · margin 4 · risk 3 · resources 5 · client 5' });
    // restore the seed
    await scoreProposalAction({ project: 'EWA-051', fit: '4', fin: '4', risk: '3', res: '2', client: '4' });
    expect((await listPortfolioScores())['EWA-051']).toEqual([4, 4, 3, 2, 4]);
  });

  it('Score a proposal: FR toast and errors', async () => {
    as('director', 'Marie Lefebvre', 'fr');
    expect(await scoreProposalAction({ project: 'CER-047', fit: '0', fin: '3', risk: '3', res: '3', client: '3' })).toEqual({ error: 'Les notes sont des nombres entiers de 1 à 5' });
    expect(await scoreProposalAction({ project: 'CER-047', fit: '4', fin: '3', risk: '4', res: '3', client: '3' })).toEqual({ toast: 'Score enregistré' });
  });

  it('closed and cancelled projects never enter the ranking, even with scores (03 A.1, coverage report E1)', async () => {
    await saveProposalScore('DRR-009', { fit: 5, margin: 5, risk: 5, res: 5, client: 5 }, 'Marie Lefebvre'); // Clos
    await saveProposalScore('SCP-033', { fit: 5, margin: 5, risk: 5, res: 5, client: 5 }, 'Marie Lefebvre'); // Annulé
    expect(Object.keys(await listPortfolioScores())).toEqual(expect.arrayContaining(['DRR-009', 'SCP-033']));
    const d = await getPrioritisationScreen('director', null);
    expect(d.projects.map((p) => p.code)).not.toContain('DRR-009');
    expect(d.projects.map((p) => p.code)).not.toContain('SCP-033');
    expect(d.projects).toHaveLength(10);
  });

  it('form definition = prototype AF.portfolio (title, kind, submit, fields, defaults, required) + the two L-5a axes', () => {
    const af = (golden as { af: { def: { title: string; kind: string; submit: string; fields: (string | number)[][] }; result: string } }).af;
    const def = scoreProposalForm([{ value: 'WSA-044', label: '#044 · Westfield Solar Array' }]);
    expect([def.title, def.kind, def.submit]).toEqual([af.def.title, af.def.kind, af.def.submit]);
    // L-5a (R-134): diverges from the prototype on purpose — its fields in order, with "Resource fit" and "Client
    // priority" (required, default 3) inserted before the comment. The golden is not regenerated.
    const expected = [...af.def.fields];
    expected.splice(expected.findIndex((f) => f[0] === 'comment'), 0, ['res', 'Resource fit (1–5)', 'number', '3', 1], ['client', 'Client priority (1–5)', 'number', '3', 1]);
    expect(def.fields.map((f) => [f.id, f.label, f.type, f.type === 'select' ? 'PIPE' : (f.defaultValue ?? ''), f.required ? 1 : undefined].filter((x) => x !== undefined)))
      .toEqual(expected);
    expect(parseScoreProposal({ project: 'WSA-044', fit: '1', fin: '5', risk: '2', res: '4', client: '3', comment: '' }, ['WSA-044'])).toEqual({
      ok: true, value: { projectCode: 'WSA-044', fit: 1, margin: 5, risk: 2, res: 4, client: 3, comment: null },
    });
    expect(parseScoreProposal({ project: 'WSA-044', fit: '1', fin: '5', risk: '2', comment: '' }, ['WSA-044'])).toEqual({ ok: false, error: 'Scores are whole numbers from 1 to 5' });
    // FR labels of the two new fields.
    const fr = makeT('fr');
    expect([fr('Resource fit (1–5)'), fr('Client priority (1–5)')]).toEqual(['Adéquation ressources (1–5)', 'Priorité client (1–5)']);
  });
});
