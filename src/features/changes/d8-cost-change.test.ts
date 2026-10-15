// Delivery 8, lot cost-change — the Change control Server Functions with the real project context (the persona comes from the
// mocked session): R-069 the contractual impact asked on "New change request" and the sequential chain ("Not yours to decide
// yet" for a later step, P-6b), R-081 the optional cost category (project team only, one of the project's, never below 0, posted
// at approval), R-015 the bell notices after each write (X-6a), for the 8 personas, with malformed input and stale clicks.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const session = { role: 'director' as RoleKey, lang: 'en' as 'en' | 'fr' };
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
  return {
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getViewer: async () => PERSONA_BY_ROLE[session.role],
    getLastProject: async () => 'HLT-026',
  };
});

import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getChangeControl } from '@/server/dal/changes';
import { getCostControl } from '@/server/dal/cost';
import { notificationsFor } from '@/server/dal/shell';
import { getProjectContext } from '@/server/project-context';
import { createChangeRequestAction, decideChangeStepAction } from './actions';
import { newChangeRequestForm, translatedChangeRequestForm } from './forms';

const ROLES: RoleKey[] = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];
const FORM = { title: 'Extra fenders', type: 'scope_budget', impact: 'price', amt: '20', days: '0', wbs: '1.7', why: 'Berth 3 fender upgrade asked by the port' };
const crOf = async (id: string) => (await getChangeControl('HLT-026'))!.changeRequests.find((c) => c.id === id)!;
const numberOf = (toast: string | undefined) => /^(CR-\d{3,})/.exec(toast ?? '')?.[1] ?? '';
const category = async (code: string) => (await getCostControl('HLT-026'))!.categories.find((c) => c.code === code)!;

beforeAll(async () => setDb(await openDatabase()), 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('R-069 / R-081 — "New change request" for the 8 personas', () => {
  for (const role of ROLES)
    it(role, async () => {
      session.role = role;
      let editor = false;
      try {
        editor = (await getProjectContext('HLT-026', 'changes')).canEdit('changes');
      } catch (e) {
        // R-042 (P-1): a viewer refused on the project is sent home by the context itself.
        expect(String(e)).toMatch(/REDIRECT/);
      }
      // Change control is edited by the director, the project's PM and its client contact (the others read it or are outside).
      expect([role, editor]).toEqual([role, ['director', 'pm', 'client'].includes(role)]);
      if (!editor) {
        const r = await createChangeRequestAction('HLT-026', { ...FORM, cat: 'C02' }).catch((e: unknown) => ({ error: String(e) }));
        expect([role, r.error]).toEqual([role, expect.stringMatching(/^(Change control is read-only for you|Error: REDIRECT .*)$/)]);
        return;
      }
      // The contractual impact is required (P-6c).
      expect(await createChangeRequestAction('HLT-026', { ...FORM, impact: '' })).toEqual({ error: 'Choose the contractual impact' });
      expect(await createChangeRequestAction('HLT-026', { ...FORM, impact: 'both' })).toEqual({ error: 'Choose the contractual impact' });
      if (role === 'client') {
        // R-081: the cost category is the team's internal data — the client raises a request without one.
        expect(await createChangeRequestAction('HLT-026', { ...FORM, cat: 'C02' })).toEqual({ error: 'Only the project team links a cost category to a change request' });
        const r = await createChangeRequestAction('HLT-026', FORM);
        expect((await crOf(numberOf(r.toast)))).toMatchObject({ contractImpact: 'price', costCategoryCode: null, status: 'in_review' });
        return;
      }
      expect(await createChangeRequestAction('HLT-026', { ...FORM, cat: 'C77' })).toEqual({ error: 'Unknown cost category' });
      expect(await createChangeRequestAction('HLT-026', { ...FORM, cat: "C02'; --" })).toEqual({ error: 'Unknown cost category' });
      const c2 = await category('C02');
      expect(await createChangeRequestAction('HLT-026', { ...FORM, cat: 'C02', amt: String(-(c2.budget + 1)) })).toEqual({ error: 'This change would take the cost category below 0' });
      const r = await createChangeRequestAction('HLT-026', { ...FORM, cat: 'C02' });
      expect(r.toast).toMatch(/^CR-\d{3} · Change request submitted for review$/);
      const cr = await crOf(numberOf(r.toast));
      expect(cr).toMatchObject({ contractImpact: 'price', costCategoryCode: 'C02', justification: FORM.why });
      expect(cr.chain.map((s) => s.decision)).toEqual(['pending', 'pending', 'pending', 'na']);
    });
});

describe('R-069 / R-015 — the chain decided in order, notices after each decision, the category posted at approval', () => {
  it('a later step is "Not yours to decide yet"; PM → director → client approves; C02 takes the amount', async () => {
    session.role = 'pm';
    const n = numberOf((await createChangeRequestAction('HLT-026', { ...FORM, title: 'Mooring bollards', amt: '30', cat: 'C02' })).toast);
    const before = (await category('C02')).budget;
    session.role = 'client';
    expect(await decideChangeStepAction('HLT-026', n, 'client', 'ok')).toEqual({ error: 'Not yours to decide yet' });
    session.lang = 'fr';
    expect(await decideChangeStepAction('HLT-026', n, 'client', 'ok')).toEqual({ error: makeT('fr')('Not yours to decide yet') });
    expect(makeT('fr')('Not yours to decide yet')).toBe('Pas encore à vous de décider');
    session.lang = 'en';
    session.role = 'director';
    expect(await decideChangeStepAction('HLT-026', n, 'director', 'ok')).toEqual({ error: 'Not yours to decide yet' });
    expect(await decideChangeStepAction('HLT-026', n, 'ccb', 'ok')).toEqual({ error: 'This approval step is no longer pending' });
    session.role = 'pm';
    expect(await decideChangeStepAction('HLT-026', n, 'pm', 'ok')).toEqual({ ok: true });
    expect(await decideChangeStepAction('HLT-026', n, 'pm', 'ok')).toEqual({ error: 'This approval step is no longer pending' });
    expect((await notificationsFor('director')).map((x) => x.title)).toContain(`Change request awaiting your decision · ${n}`);
    session.role = 'director';
    expect(await decideChangeStepAction('HLT-026', n, 'director', 'ok')).toEqual({ ok: true });
    expect((await notificationsFor('client')).map((x) => x.title)).toContain(`Change request awaiting your decision · ${n}`);
    // The persona not concerned is never told.
    expect((await notificationsFor('quality')).map((x) => x.title).filter((x) => x.endsWith(n))).toEqual([]);
    session.role = 'client';
    expect(await decideChangeStepAction('HLT-026', n, 'client', 'ok')).toEqual({ ok: true });
    const cr = await crOf(n);
    expect([cr.status, cr.chain.map((s) => s.decision)]).toEqual(['approved', ['ok', 'ok', 'ok', 'na']]);
    expect((await category('C02')).budget).toBe(before + 30);
    // The requester (the PM of record) hears of the final decision.
    expect((await notificationsFor('pm')).map((x) => x.title)).toContain(`Change request approved · ${n}`);
    // Stale click on a decided request.
    expect(await decideChangeStepAction('HLT-026', n, 'client', 'rejected')).toEqual({ error: 'This approval step is no longer pending' });
  });

  it('an internal change ("None (internal)") never waits for the client', async () => {
    session.role = 'pm';
    const n = numberOf((await createChangeRequestAction('HLT-026', { ...FORM, title: 'Crew rotation', impact: 'none', amt: '5' })).toast);
    expect((await crOf(n)).chain.map((s) => s.decision)).toEqual(['pending', 'pending', 'na', 'na']);
    expect(await decideChangeStepAction('HLT-026', n, 'pm', 'ok')).toEqual({ ok: true });
    session.role = 'director';
    expect(await decideChangeStepAction('HLT-026', n, 'director', 'ok')).toEqual({ ok: true });
    expect((await crOf(n)).status).toBe('approved');
    session.role = 'client';
    expect(await decideChangeStepAction('HLT-026', n, 'client', 'ok')).toEqual({ error: 'This approval step is no longer pending' });
  });
});

describe('the "New change request" form (R-069, R-081, R-140)', () => {
  it('FR: Keystone labels translated, the impact required, the cost categories as typed (R-148), the client reminder', () => {
    const t = makeT('fr');
    const def = translatedChangeRequestForm(newChangeRequestForm('1.3', { costCategories: [{ value: 'C09', label: 'C09 · Mon équipe' }, { value: 'C01', label: 'C01 · Labor' }] }), t);
    const impact = def.fields.find((f) => f.id === 'impact')!;
    expect([impact.label, impact.required, impact.options]).toEqual(['Impact contractuel', true, [
      { value: '', label: 'Choisir l’impact contractuel' }, { value: 'price', label: 'Prix du contrat' }, { value: 'dates', label: 'Délais contractuels' },
      { value: 'price_dates', label: 'Prix et délais du contrat' }, { value: 'none', label: 'Aucun (interne)' },
    ]]);
    expect(def.fields.find((f) => f.id === 'cat')!.options).toEqual([
      { value: '', label: 'Aucune catégorie — BAC et lots de travaux seulement' }, { value: 'C09', label: 'C09 · Mon équipe' }, { value: 'C01', label: 'C01 · Labor' },
    ]);
    expect(def.fields.find((f) => f.id === 'why')!.placeholder).toBe('Transmise au client avec la demande de modification');
    // Without categories (the client), no field.
    expect(newChangeRequestForm('1.3').fields.map((f) => f.id)).toEqual(['title', 'type', 'impact', 'amt', 'days', 'wbs', 'why']);
  });
});
