// R-143 (Q-8 "a": warranty claims followed end to end by after-sales) and R-144 (E-8 "a": machines and their as-built
// configuration created at the project's delivery, kept up to date by each intervention). Pure rules, then the Server
// Functions on the seeded in-memory database with the real screen access (8 personas, the PM's own projects), stale steps,
// validation, the audit trail, the configuration update by a done intervention, the claim drawer's view model and the
// "Delivered projects" card.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
  };
});

import {
  asBuiltConfiguration, claimSteps, closeBlocker, isDeliveredStage, machineNames, parseClaimUpdate, parseDiagnosis, parseInterventionDone, parsePlanIntervention,
  parseRegisterMachines, statusAfterPlanning, warrantyEndOf, warrantyMonthsOf,
} from '@/domain/claims';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getSavScreen } from '@/server/dal/aftersales';
import { CLAIM_OWNERS, getClaim, interventionPartOptions, listInterventions } from '@/server/dal/claims';
import { getMachine, listDeliveryCandidates, machineConfigurations, machinesFittedWith, registerDeliveredMachines } from '@/server/dal/fleet';
import { listAudit } from '@/server/dal/notifications';
import {
  closeClaimAction, completeInterventionAction, diagnoseClaimAction, planInterventionAction, registerMachinesAction, updateClaimAction,
} from './actions';
import { claimDrawerView } from './claim-drawer-model';
import { deliveredView } from './delivered';

/** The prototype's today for after-sales dates (NOW_ISO, 30 Sep 2026): the pure rules take it explicitly since R-013. */
const NOW = '2026-09-30';
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'] as const;
const EDIT = { cover: 'warranty', owner: 'T. Kerbrat', cost: '8', next: 'Replace brake disc', eco: '', diagnosis: 'Worn brake disc lining' };

describe('R-143 / R-144 rules', () => {
  it('claim steps, the close blocker and the status after planning', () => {
    const f = (status: 'open' | 'diagnosed' | 'intervention_planned' | 'closed', diagnosis: string | null, planned: number) => ({ status, diagnosis, plannedInterventions: planned });
    expect([claimSteps(f('open', null, 0)), claimSteps(f('open', 'x', 0)), claimSteps(f('diagnosed', 'x', 0)), claimSteps(f('diagnosed', 'x', 1)), claimSteps(f('intervention_planned', 'x', 0)), claimSteps(f('closed', 'x', 0))])
      .toEqual([['diagnose'], ['diagnose'], ['close'], [], ['close'], []]);
    expect([closeBlocker(f('open', null, 0)), closeBlocker(f('diagnosed', null, 0)), closeBlocker(f('diagnosed', 'x', 2)), closeBlocker(f('diagnosed', 'x', 0)), closeBlocker(f('closed', 'x', 0))])
      .toEqual(['Diagnose the claim before closing it', 'Diagnose the claim before closing it', 'An intervention is still planned', null, null]);
    expect((['open', 'diagnosed', 'intervention_planned'] as const).map(statusAfterPlanning)).toEqual(['open', 'intervention_planned', 'intervention_planned']);
  });

  it('parses "Edit claim"', () => {
    expect(parseClaimUpdate({ ...EDIT, cost: '8,456', eco: 'eco-2026-015', next: '' }, CLAIM_OWNERS)).toEqual({
      ok: true, value: { coverage: 'warranty', owner: 'T. Kerbrat', costKeur: 8.46, nextStep: '—', diagnosis: 'Worn brake disc lining', ecoNumber: 'ECO-2026-015' },
    });
    expect(parseClaimUpdate({ ...EDIT, cover: 'Chargeable', cost: '' }, CLAIM_OWNERS)).toMatchObject({ ok: true, value: { coverage: 'chargeable', costKeur: 0 } });
    const err = (v: Record<string, string>) => {
      const r = parseClaimUpdate({ ...EDIT, ...v }, CLAIM_OWNERS);
      return r.ok ? null : r.error;
    };
    expect([err({ cover: 'free' }), err({ owner: 'Nobody' }), err({ cost: '-1' }), err({ cost: 'lots' }), err({ cost: '12000' }), err({ eco: 'CR-004' }), err({ diagnosis: 'x'.repeat(2001) })]).toEqual([
      'Invalid coverage', 'Unknown owner', 'Enter the cost in k€, e.g. 8.5', 'Enter the cost in k€, e.g. 8.5', 'The cost is too high (k€)', 'Enter the ECO number as in Vigie, e.g. ECO-031', 'Text is too long',
    ]);
    expect([parseDiagnosis({ diagnosis: ' ' }), parseDiagnosis({ diagnosis: 'Lining worn' })]).toEqual([{ ok: false, error: 'Enter the diagnosis' }, { ok: true, value: 'Lining worn' }]);
  });

  it('parses "Plan intervention" and "Mark done"', () => {
    expect(parsePlanIntervention({ date: '8 Oct', tech: 'T. Kerbrat', duration: '0,5' }, { machines: [], claimMachine: 'MCH-041', year: 2026 })).toEqual({
      ok: true, value: { machineNumber: 'MCH-041', type: 'corrective', scheduledOn: '2026-10-08', technicians: 'T. Kerbrat', durationDays: 0.5, detail: null },
    });
    expect(parsePlanIntervention({ machine: 'MCH-038', ivtype: 'Preventive', date: '15 Oct', tech: 'S. Haddad' }, { machines: ['MCH-038'], year: 2026 })).toMatchObject({ ok: true, value: { machineNumber: 'MCH-038', type: 'preventive', durationDays: 1 } });
    const perr = (v: Record<string, string>, machines = ['MCH-038']) => {
      const r = parsePlanIntervention({ date: '8 Oct', tech: 'x', ...v }, { machines, year: 2026 });
      return r.ok ? null : r.error;
    };
    expect([perr({ machine: 'MCH-999' }), perr({ ivtype: 'repair' }), perr({ date: '' }), perr({ date: 'soon' }), perr({ tech: ' ' }), perr({ duration: '0.3' }), perr({ duration: '31' })]).toEqual([
      'Unknown machine', 'Unknown intervention type', 'Date is required', 'Enter the date as a date, e.g. 8 Oct', 'Technicians are required', 'Enter the duration in days (0.5 to 30)', 'Enter the duration in days (0.5 to 30)',
    ]);
    const parts = ['HST-BRK-DSC', 'EL-VFD-200'];
    expect(parseInterventionDone({ date: '29 Sep', report: 'Disc replaced', part: 'HST-BRK-DSC', rev: 'b' }, parts, NOW)).toEqual({
      ok: true, value: { doneOn: '2026-09-29', report: 'Disc replaced', partRef: 'HST-BRK-DSC', revision: 'B' },
    });
    expect(parseInterventionDone({ date: '29 Sep', part: '—', rev: 'B' }, parts, NOW)).toEqual({ ok: true, value: { doneOn: '2026-09-29', report: null, partRef: null, revision: null } });
    const derr = (v: Record<string, string>) => {
      const r = parseInterventionDone({ date: '29 Sep', ...v }, parts, NOW);
      return r.ok ? null : r.error;
    };
    expect([derr({ date: '' }), derr({ date: '2026-10-05' }), derr({ part: 'NOPE' }), derr({ part: 'EL-VFD-200' }), derr({ report: 'x'.repeat(2001) })]).toEqual([
      'Date is required', 'An intervention cannot be done in the future', 'Unknown part', 'Enter the revision fitted', 'Text is too long',
    ]);
  });

  it('delivery: delivered stages, warranty months and end, names, the as-built configuration, the register form', () => {
    expect((['fat', 'expedition', 'chantier', 'mise_en_service_sat', 'garantie', 'clos', 'annule', 'etudes'] as const).map(isDeliveredStage)).toEqual([false, true, true, true, true, true, false, false]);
    expect(['24 months from SAT', '18 mois', '2 ans après réception', '1 year', 'none', null].map(warrantyMonthsOf)).toEqual([24, 18, 24, 12, null, null]);
    expect([warrantyEndOf('2025-12-14', 24), warrantyEndOf('2026-01-31', 1), warrantyEndOf('2026-09-30', 24)]).toEqual(['2027-12-13', '2026-02-27', '2028-09-29']);
    expect([machineNames('Gantry', 1), machineNames('Gantry', 2)]).toEqual([['Gantry'], ['Gantry #1', 'Gantry #2']]);
    expect(asBuiltConfiguration([{ ref: 'A', revision: 'C' }, { ref: 'SW', revision: null }, { ref: 'A', revision: 'D' }, { ref: 'B', revision: ' 2 ' }])).toEqual([{ ref: 'A', revision: 'C' }, { ref: 'B', revision: '2' }]);
    const v = { project: 'RCF-019', count: '2', name: 'Overhead crane', site: 'Lyon', delivered: '30 Sep 2026', warranty: '29 Sep 2028' };
    // R-185 part 2: the equipment line delivered (none chosen: the project's main line).
    expect(parseRegisterMachines(v, ['RCF-019'], NOW)).toEqual({ ok: true, value: { projectCode: 'RCF-019', count: 2, name: 'Overhead crane', site: 'Lyon', deliveredOn: '2026-09-30', warrantyEndOn: '2028-09-29', equipment: null } });
    expect(parseRegisterMachines({ ...v, equipment: 'EQ-02' }, ['RCF-019'], NOW)).toMatchObject({ ok: true, value: { equipment: 'EQ-02' } });
    const err = (o: Record<string, string>) => {
      const r = parseRegisterMachines({ ...v, ...o }, ['RCF-019'], NOW);
      return r.ok ? null : r.error;
    };
    expect([err({ project: 'HLT-026' }), err({ count: '0' }), err({ count: '1.5' }), err({ count: '21' }), err({ name: '' }), err({ delivered: '' }), err({ delivered: '2026-10-02' }), err({ warranty: 'never' }), err({ warranty: '1 Sep 2026' })]).toEqual([
      'Unknown project', 'Enter a number of machines from 1 to 20', 'Enter a number of machines from 1 to 20', 'Enter a number of machines from 1 to 20', 'Machine is required', 'Enter the delivery date',
      'The delivery date cannot be in the future', 'Enter the warranty end as a date, e.g. 29 Sep 2028', 'Warranty end is before delivery',
    ]);
  });
});

describe('R-143 / R-144 Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    session.role = 'director';
    session.lang = 'en';
  });

  it('rights for the 8 personas (Warranty claims workspace: director, PM, quality, procurement); nothing written otherwise', async () => {
    const outcome: Record<string, string> = {};
    for (const role of ROLES) {
      session.role = role;
      // R-042: the client is sent home from a screen outside their workspace (redirect), not answered.
      const r: { toast?: string; error?: string } = await updateClaimAction('WC-016', { ...EDIT, cover: 'extended_warranty', next: `By ${role}`, diagnosis: '' })
        .then((x) => x as { toast?: string; error?: string }, (e: Error) => ({ error: e.message }));
      outcome[role] = r.toast ? 'ok' : r.error!;
    }
    const ro = 'Warranty claims are read-only for you';
    expect(outcome).toEqual({ director: 'ok', pm: 'ok', depthead: ro, member: ro, englead: ro, quality: 'ok', procurement: 'ok', client: 'NEXT_REDIRECT' });
    expect((await getClaim('WC-016'))!.nextStep).toBe('By procurement');
    session.role = 'member';
    expect(await closeClaimAction('WC-014', 'diagnosed')).toEqual({ ok: false, error: ro });
    expect(await planInterventionAction('WC-014', { date: '8 Oct', tech: 'x' })).toEqual({ error: ro });
    expect(await completeInterventionAction('IV-082', { date: '29 Sep' })).toEqual({ error: ro });
    expect(await registerMachinesAction({ project: 'RCF-019' })).toEqual({ error: 'The installed base is read-only for you' });
  });

  it('Open → Diagnosed → Intervention planned → done (configuration updated) → Closed; stale and blocked steps refused', async () => {
    session.role = 'quality';
    // WC-013 (Open, ECO-031) on MCH-041.
    expect(await diagnoseClaimAction('WC-013', 'open', { diagnosis: '' })).toEqual({ error: 'Enter the diagnosis' });
    expect(await diagnoseClaimAction('WC-013', 'diagnosed', { diagnosis: 'Lidar filter' })).toEqual({ error: 'This claim has changed since you opened it' });
    expect(await diagnoseClaimAction('WC-013', 'open', { diagnosis: 'Lidar returns scattered by fog droplets' })).toEqual({ toast: 'WC-013 · Diagnosed' });
    let c = (await getClaim('WC-013'))!;
    expect([c.status, c.diagnosis, c.steps]).toEqual(['diagnosed', 'Lidar returns scattered by fog droplets', ['close']]);
    // Planning moves it to Intervention planned; closing is then blocked until the intervention is done.
    expect(await planInterventionAction('WC-013', { ivtype: 'corrective', date: '12 Oct', tech: 'C. Morvan', duration: '1', detail: 'lidar filter update' })).toEqual({ toast: 'IV-085 · Intervention planned' });
    c = (await getClaim('WC-013'))!;
    expect([c.status, c.plannedInterventions, c.steps, c.interventions.map((i) => [i.number, i.status, i.typeText])]).toEqual([
      'intervention_planned', 1, [], [['IV-085', 'planned', 'Corrective · WC-013 lidar filter update']],
    ]);
    expect(await closeClaimAction('WC-013', 'intervention_planned')).toEqual({ ok: false, error: 'This claim cannot be closed yet' });
    // Mark done with the part fitted: MCH-041's configuration takes the new revision.
    expect((await interventionPartOptions('MCH-041')).slice(0, 3)).toEqual(['ASM-RMG-250', 'EL-VFD-200', 'EL-HMI-15']);
    // R-013: dated on the business date (25 Sep 2026 on the demo data set, not the prototype's 30 Sep).
    expect(await completeInterventionAction('IV-085', { date: '25 Sep', report: 'Lidar firmware 2.4', part: 'FD-DET-OPT2', rev: 'b' })).toEqual({ toast: 'IV-085 · Intervention done · Configuration updated' });
    expect((await machineConfigurations(['MCH-041'])).get('MCH-041')!.find((p) => p.ref === 'FD-DET-OPT2')).toEqual({ ref: 'FD-DET-OPT2', revision: 'B' });
    expect((await machinesFittedWith('FD-DET-OPT2')).find((m) => m.number === 'MCH-041')!.revision).toBe('B');
    expect(await completeInterventionAction('IV-085', { date: '25 Sep' })).toEqual({ error: 'This intervention is already done' });
    const iv = (await listInterventions()).find((i) => i.number === 'IV-085')!;
    expect([iv.status, iv.doneOn, iv.report, iv.partRef, iv.partRevision]).toEqual(['done', '2026-09-25', 'Lidar firmware 2.4', 'FD-DET-OPT2', 'B']);
    // Close: dated (R-013: on the business date, 25 Sep 2026 on the demo data set), no further step, read-only.
    expect(await closeClaimAction('WC-013', 'intervention_planned')).toEqual({ ok: true, toast: 'WC-013 · Closed' });
    c = (await getClaim('WC-013'))!;
    expect([c.status, c.closedOn, c.steps, c.open]).toEqual(['closed', '2026-09-25', [], false]);
    expect(await updateClaimAction('WC-013', EDIT)).toEqual({ error: 'This claim is closed' });
    expect(await planInterventionAction('WC-013', { date: '1 Oct', tech: 'x' })).toEqual({ error: 'This claim is closed' });
    const audit = await listAudit({ limit: 6 });
    expect(audit.map((a) => [a.who, a.object, a.area])).toContainEqual(['Gabriel Comte', 'MCH-041', 'Installed base']);
  });

  it('"Edit claim": coverage, owner, cost (FR decimal comma), next step, diagnosis, design ECO; the costs per machine follow', async () => {
    session.role = 'procurement';
    session.lang = 'fr';
    expect(await updateClaimAction('WC-017', { cover: 'chargeable', owner: 'S. Haddad', cost: '3,5', next: 'Sensor swap', eco: 'eco-040', diagnosis: '' })).toEqual({ toast: 'WC-017 · Réclamation mise à jour' });
    const c = (await getClaim('WC-017'))!;
    expect([c.coverage, c.costKeur, c.nextStep, c.ecoNumber, c.status]).toEqual(['chargeable', 3.5, 'Sensor swap', 'ECO-040', 'open']);
    expect(await updateClaimAction('WC-017', { ...EDIT, eco: 'CR-1' })).toEqual({ error: 'Saisissez le numéro d’ECO comme dans Vigie, par ex. ECO-031' });
    // A diagnosed claim keeps a diagnosis.
    session.lang = 'en';
    expect(await updateClaimAction('WC-014', { ...EDIT, diagnosis: '' })).toEqual({ error: 'Enter the diagnosis' });
    expect(await updateClaimAction('WC-014', EDIT)).toEqual({ toast: 'WC-014 · Claim updated' });
  });

  it('"Plan intervention" from the Interventions view: a preventive visit on a machine', async () => {
    session.role = 'pm';
    expect(await planInterventionAction(null, { machine: 'MCH-038', ivtype: 'preventive', date: '15 Oct', tech: 'T. Kerbrat', detail: 'annual check' })).toEqual({ toast: 'IV-086 · Intervention planned' });
    expect((await listInterventions()).find((i) => i.number === 'IV-086')).toMatchObject({ machineNumber: 'MCH-038', claimNumber: null, type: 'preventive', typeText: 'Preventive · annual check', status: 'planned' });
    expect(await planInterventionAction('X', {})).toEqual({ error: 'Invalid request' });
  });

  it('R-144: delivered projects; register their machines with the as-built configuration; the PM for their own projects only', async () => {
    const cands = await listDeliveryCandidates();
    expect(cands.map((c) => [c.projectCode, c.stage, c.trackedParts, c.defaultCount, c.warrantyMonths, c.registered])).toEqual([
      ['RCF-019', 'chantier', 5, 1, 24, 0], ['MSR-012', 'mise_en_service_sat', 3, 1, 24, 0],
    ]);
    // The PM (R. Aubert) manages neither: refused there; the data layer refuses an undelivered project.
    session.role = 'pm';
    const pmOwn = cands.filter((c) => c.pm === 'R. Aubert').map((c) => c.projectCode);
    expect(pmOwn).toEqual([]);
    expect(await registerMachinesAction({ project: 'RCF-019', count: '1', name: 'x', delivered: '25 Sep 2026', warranty: '24 Sep 2028' })).toEqual({
      error: 'Only the project manager of this project registers its machines',
    });
    await expect(registerDeliveredMachines('HLT-026', { count: 1, name: 'x', site: '', deliveredOn: '2026-09-30', warrantyEndOn: '2028-09-29' }, { name: 'Marie Lefebvre', role: 'director' }))
      .rejects.toThrow(/not delivered/);
    session.role = 'quality';
    // R-013: delivered on the business date (25 Sep 2026 on the demo data set, not the prototype's 30 Sep).
    expect(await registerMachinesAction({ project: 'RCF-019', count: '2', name: 'Overhead crane 10 t', site: 'Lyon · clinic', delivered: '25 Sep 2026', warranty: '24 Sep 2028' })).toEqual({
      toast: 'MCH-050, MCH-051 · Machines registered with their as-built configuration',
    });
    const m = (await getMachine('MCH-051'))!;
    expect([m.name, m.projectCode, m.deliveredOn, m.warrantyEndOn, m.warrantyStatus, m.site, m.parts.length]).toEqual(['Overhead crane 10 t #2', 'RCF-019', '2026-09-25', '2028-09-24', 'in_warranty', 'Lyon · clinic', 5]);
    expect((await listDeliveryCandidates()).find((c) => c.projectCode === 'RCF-019')!.registered).toBe(2);
    // The project row and the last machine row may share their millisecond (same transaction): look among the latest rows.
    const audit = (await listAudit({ limit: 3 })).find((a) => a.object === 'RCF-019')!;
    expect([audit.who, audit.object, audit.area]).toEqual(['Gabriel Comte', 'RCF-019', 'Installed base']);
    // A claim on a registered machine is followed like the others.
    const cfg = (await machineConfigurations(['MCH-050'])).get('MCH-050')!;
    expect(cfg.length).toBe(5);
  });

  it('claim drawer view model and the "Delivered projects" card', async () => {
    const data = await getSavScreen(null);
    const claim = (await getClaim('WC-015'))!;
    const view = (vigie: boolean, canEdit: boolean) => claimDrawerView({ claim, ecos: data.ecos, config: [], parts: ['EL-CBL-FEST'], owners: CLAIM_OWNERS, viewer: { vigie, canEdit }, today: data.today }, makeT('en'), 'en');
    const v = view(true, true);
    expect([v.number, v.status, v.steps.map((s) => s.reached), v.closeHref]).toEqual(['WC-015', 'Intervention planned', [true, true, true, false], '/after-sales/claims']);
    expect(v.raiseEco!.href).toBe('http://localhost:3200/modifications-techniques/nouvelle?project=DRR-009&title=WC-015+%C2%B7+Festoon+cable+wear+%E2%80%94+3+segments&source=keystone');
    expect([v.actions!.diagnose, v.actions!.close, v.actions!.closeHint, v.actions!.plan.label]).toEqual([null, null, 'Diagnose the claim before closing it', 'Plan intervention']);
    expect(v.interventions.map((i) => [i.number, i.done?.label ?? null])).toEqual([['IV-081', 'Mark done']]);
    const ro = view(false, false);
    expect([ro.raiseEco, ro.actions, ro.interventions[0].done]).toEqual([null, null, null]);
    const rows = deliveredView((await listDeliveryCandidates()), { canRegister: (c) => c === 'MSR-012', today: data.today }, makeT('fr'), 'fr');
    expect(rows.map((r) => [r.projectCode, r.sub, !!r.register])).toEqual([
      ['RCF-019', 'Chantier · 5 pièces telles que construites · 2 machines enregistrées', false],
      ['MSR-012', 'Mise Service & SAT · 3 pièces telles que construites · 0 machine enregistrée', true],
    ]);
    // R-013: the business date (25 Sep 2026 on the demo data set, not the prototype's 30 Sep) and its 24-month warranty end.
    expect(rows[1].register!.form.fields.map((f) => [f.id, f.defaultValue ?? ''])).toEqual([
      ['project', ''], ['count', '1'], ['name', 'MEMU — Marseille Metro Signage Rollout'], ['site', 'Marseille'], ['delivered', '25 sept. 2026'], ['warranty', '24 sept. 2028'],
    ]);
  });
});
