// Change orders and Drawings Server Functions against an in-memory database (seeded Vigie mirror, mock connector):
// the workspace gate, input validation, the approval-key rules (own key only, the director holds none, a PM of an
// impacted project, one pending decision per key), the step rules (Draft → Impact analysis, Impact analysis → In
// approval once Vigie reports the interchangeability), the outbox "pending sync with Vigie", the viewer as the actor,
// the My approvals ECO kind before / after a decision, and "Sync vault". The session is mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => 'HLT-026',
  };
});

import { revalidatePath } from 'next/cache';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { makeT } from '@/i18n/translate';
import { getApprovalInbox } from '@/server/approvals';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getVaultSyncState } from '@/server/dal/drawings';
import { ecoApprovalQueue, ecoDecidedCount, getEco } from '@/server/dal/eco';
import { getEcoDrawer, getEcoScreen, ecoNavBadge } from '@/server/dal/eco-screen';
import { listAudit } from '@/server/dal/notifications';
import { decideEcoApprovalAction, requestEcoStepAction, syncVaultAction } from './actions';
import { ecoDrawerView, ecoScreenView } from './model';

const as = (role: string, lang: 'en' | 'fr' = 'en') => {
  session.role = role;
  session.lang = lang;
};

describe('ECO and drawings Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    as('director');
    vi.mocked(revalidatePath).mockClear();
  });

  it('refuses viewers outside Change orders and malformed requests', async () => {
    for (const role of ['depthead', 'member', 'client']) {
      as(role);
      expect(await decideEcoApprovalAction({ number: 'ECO-2026-015', key: 'pm', decision: 'ok' })).toEqual({ ok: false, error: 'Change orders are outside your workspace' });
      expect(await requestEcoStepAction({ number: 'ECO-2026-017', step: 'impact_analysis' })).toEqual({ ok: false, error: 'Change orders are outside your workspace' });
    }
    as('pm');
    const invalid = { ok: false, error: 'Invalid request' };
    expect(await decideEcoApprovalAction({ number: 'ECO-2026-015', key: 'director', decision: 'ok' })).toEqual(invalid);
    expect(await decideEcoApprovalAction({ number: 'ECO-2026-015', key: 'pm', decision: 'maybe' })).toEqual(invalid);
    expect(await decideEcoApprovalAction({ number: '<script>', key: 'pm', decision: 'ok' })).toEqual(invalid);
    expect(await decideEcoApprovalAction(null as never)).toEqual(invalid);
    expect(await requestEcoStepAction({ number: 'ECO-2026-017', step: 'released' })).toEqual(invalid);
    expect(await requestEcoStepAction({ number: 'ECO-2026-999', step: 'impact_analysis' })).toEqual({ ok: false, error: 'Unknown ECO' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('approval keys: own key only, still pending in Vigie, the PM of an impacted project; the director holds none', async () => {
    const notYours = { ok: false, error: 'This decision is not waiting for you any more' };
    as('director');
    expect(await decideEcoApprovalAction({ number: 'ECO-2026-015', key: 'pm', decision: 'ok' })).toEqual(notYours);
    as('englead');
    expect(await decideEcoApprovalAction({ number: 'ECO-2026-015', key: 'englead', decision: 'ok' })).toEqual(notYours); // already approved in Vigie
    expect(await decideEcoApprovalAction({ number: 'ECO-2026-015', key: 'pm', decision: 'ok' })).toEqual(notYours); // not the viewer's key
    as('quality');
    expect(await decideEcoApprovalAction({ number: 'ECO-2026-016', key: 'quality', decision: 'ok' })).toEqual(notYours); // not in approval
    expect((await getEco('ECO-2026-015'))!.pendingProgress).toEqual([]);
  });

  it("the PM's approval from My approvals: recorded for Vigie, pending sync, leaves the inbox", async () => {
    as('pm');
    const pm = PERSONA_BY_ROLE.pm;
    const before = await getApprovalInbox(pm, { lang: 'en' });
    const item = before.items.find((i) => i.kind === 'eco')!;
    expect(item).toMatchObject({
      id: 'ECO-2026-015', sub: 'Obsolescence notice · Harbor Line, Clinique Pasteur Lyon', who: 'Gabriel Comte', when: '19 Sep', href: '/reference/eco?eco=ECO-2026-015',
      decision: { mode: 'eco', number: 'ECO-2026-015', key: 'pm' }, external: { href: 'http://localhost:3200/modifications-techniques/ECO-2026-015', label: 'Open in Vigie' },
    });
    const decidedBefore = await ecoDecidedCount({ name: pm.name, role: 'pm' });

    expect(await decideEcoApprovalAction({ number: 'ECO-2026-015', key: 'pm', decision: 'ok' })).toEqual({ ok: true, toast: 'ECO-2026-015 · Approved · Pending sync with Vigie' });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(await decideEcoApprovalAction({ number: 'ECO-2026-015', key: 'pm', decision: 'rejected' })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });

    const eco = (await getEco('ECO-2026-015'))!;
    expect(eco.status).toBe('in_approval'); // Vigie decides the status
    expect(eco.pendingProgress.map((p) => [p.kind, p.approvalKey, p.decision, p.actorName, p.actorRole, p.syncStatus])).toEqual([['approval', 'pm', 'ok', 'Romain Aubert', 'pm', 'pending']]);
    expect((await listAudit({ limit: 5 })).find((a) => a.object === 'ECO-2026-015')).toMatchObject({ who: 'Romain Aubert', area: 'ECO' });
    expect(await ecoApprovalQueue({ name: pm.name, role: 'pm' })).toEqual([]);
    expect((await getApprovalInbox(pm, { lang: 'en' })).items.some((i) => i.kind === 'eco')).toBe(false);
    expect(await ecoDecidedCount({ name: pm.name, role: 'pm' })).toBe(decidedBefore + 1);
    expect(await ecoNavBadge()).toBe('1'); // still in approval in Vigie

    // The screen shows the decision as pending sync with Vigie, in EN and FR.
    const data = await getEcoScreen(pm, null);
    const en = ecoScreenView({ ecos: data.ecos, awaitingMine: data.awaitingMine, state: { status: null, eco: null }, viewer: pm }, makeT('en'), 'en');
    expect(en.rows.find((r) => r.number === 'ECO-2026-015')!.sync).toBe('Pending sync with Vigie');
    expect(en.rows.find((r) => r.number === 'ECO-2026-015')!.approvals.map((a) => a.dot)).toEqual(['var(--color-accent)', 'var(--color-accent)', 'var(--color-accent)']);
    expect(en.kpis[1]).toMatchObject({ value: '0', sub: 'As Project manager' });
    const fr = ecoDrawerView({ data: (await getEcoDrawer('ECO-2026-015'))!, state: { status: null, eco: 'ECO-2026-015' }, viewer: { role: 'pm', managedProjects: ['HLT-026'] } }, makeT('fr'), 'fr');
    expect(fr.approvals[2]).toMatchObject({ state: 'Approuvé', sync: 'En attente de synchronisation avec Vigie', canAct: false });
    expect(fr.sync).toBe('En attente de synchronisation avec Vigie');
  });

  it('step requests: Draft → Impact analysis once; Submit needs the interchangeability decided in Vigie', async () => {
    const gone = { ok: false, error: 'This step is not available any more' };
    as('procurement');
    expect(await requestEcoStepAction({ number: 'ECO-2026-017', step: 'in_approval' })).toEqual(gone);
    expect(await requestEcoStepAction({ number: 'ECO-2026-017', step: 'impact_analysis' })).toEqual({ ok: true, toast: 'ECO-2026-017 · Impact analysis requested · Pending sync with Vigie' });
    expect(await requestEcoStepAction({ number: 'ECO-2026-017', step: 'impact_analysis' })).toEqual(gone);
    as('englead');
    expect(await requestEcoStepAction({ number: 'ECO-2026-016', step: 'in_approval' })).toEqual(gone); // interchangeability not assessed
    expect(await requestEcoStepAction({ number: 'ECO-2026-014', step: 'impact_analysis' })).toEqual(gone); // released
    const e = (await getEco('ECO-2026-017'))!;
    expect([e.status, e.requestedStatus, e.pendingProgress.map((p) => [p.kind, p.targetStatus, p.actorName])]).toEqual(['draft', 'impact_analysis', [['step', 'impact_analysis', 'Fabien Bertrand']]]);
    const data = await getEcoScreen(PERSONA_BY_ROLE.procurement, null);
    const row = ecoScreenView({ ecos: data.ecos, awaitingMine: 0, state: { status: null, eco: null }, viewer: PERSONA_BY_ROLE.procurement }, makeT('fr'), 'fr').rows.find((r) => r.number === 'ECO-2026-017')!;
    expect([row.status, row.action, row.sync]).toEqual(['Brouillon', null, 'Analyse d’impact demandée · En attente de synchronisation avec Vigie']);
  });

  it('Sync vault: drawings editors only, codes validated, the run recorded (0 drawings updated)', async () => {
    as('procurement');
    expect(await syncVaultAction({ source: 'both', scope: 'all_projects' })).toEqual({ error: 'The PDM vault is read-only for you' });
    as('englead');
    expect(await syncVaultAction({ source: 'Both', scope: 'all_projects' })).toEqual({ error: 'Invalid request' });
    expect(await syncVaultAction(null as never)).toEqual({ error: 'Invalid request' });
    const before = (await getVaultSyncState())!;
    // R-021 (A-15): the PDM is not connected — the toast says the run is simulated.
    expect(await syncVaultAction({ source: 'both', scope: 'current_project' })).toEqual({ toast: 'Simulated vault sync (SolidWorks PDM not connected) · 0 drawings updated' });
    as('englead', 'fr');
    expect(await syncVaultAction({ source: 'solidworks_3dx', scope: 'all_projects' })).toEqual({ toast: 'Synchro du coffre simulée (SolidWorks PDM non connecté) · 0 plan mis à jour' });
    const after = (await getVaultSyncState())!;
    expect([after.drawingsInVault, after.linkedDrawings, after.syncedAt > before.syncedAt]).toEqual([1248, 13, true]);
    expect((await listAudit({ limit: 3 })).find((a) => a.object === 'SolidWorks PDM')).toMatchObject({ who: 'Antoine Girard', area: 'Drawings' });
  });
});
