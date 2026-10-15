// Delivery 5 database layer — writers on an in-memory PGlite: NCR progress through the Vigie quality connector (outbox
// "pending sync with Vigie", mock and HTTP), deliverables (producer steps, client acceptance PV), ITP lines and punch
// items, Plan SAT, lessons learned and closure, installed base and warranty claims, site readiness and daily reports,
// Cursus reminders and travel requests (mock and HTTP per Cursus's contract), client issues, the engineering register
// (inputs, checks, outputs, releases, import), P&ID mapping, machine types, Settings, connectors, and the Delivery 5
// backfill of a database seeded before migration 0004. Each write appends an audit row with the viewer.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { seedIfEmpty } from '@/server/db/seed';
import { prototypeNcrSnapshot, type ProtoNcrRow } from '@/server/integrations/vigie/prototype-snapshot';
import { upsertNcrMirror } from '@/server/integrations/vigie/quality-mirror';
import { httpQualityConnector, mockQualityConnector, resetVigieQualityRefreshThrottle, getVigieQualityConnector } from '@/server/integrations/vigie/quality-connector';
import { vigieCoactivityUrl, vigieHseListUrl, vigieHseUrl, vigieNcrListUrl, vigieNcrUrl, vigieReportNcrUrl } from '@/server/integrations/vigie/links';
import { getCursusConnector, httpCursusConnector, recordsOfPayload, resetCursusRefreshThrottle } from '@/server/integrations/cursus/connector';
import { cursusChantierUrl } from '@/server/integrations/cursus/links';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { raiseClientIssue, getClientPortal } from './client';
import { listClaims, openClaim } from './claims';
import { getCommissioning, planSat } from './commissioning';
import { closeEngCheck, confirmEngInput, freezeEngDeliverable, generateEngOutput, getEngineeringRegister, importEngList, proposeEngRelease, validateEngRelease } from './engineering';
import { addMachine, getMachine, listMachines } from './fleet';
import { listConnectors, syncConnector } from './integrations';
import { addItpInspection, addPunchItem, advancePunchItem, getItpPlan, listPunchItems } from './itp';
import { createMachineType, getMachineType, removeRexReference, setMachineTypeCostCategories, setMachineTypeItpSystems, setMachineTypePhases, updateMachineType } from './mtypes';
import { listAudit } from './notifications';
import { getPidValidation, mapPidTag, pidCandidates } from './pid';
import {
  advanceNcr, decideDeliverable, deliverableAcceptanceQueue, deliverableDecidedCount, getDeliverable, getNcr, linkDeliverableDocument, moveDeliverable, ncrVerificationDecidedCount,
  ncrVerificationQueue, verifyNcr,
} from './quality';
import { addLesson, advanceLesson, cycleClosureItem, getRex } from './rex';
import { addLocation, addReferenceValue, getHealthThresholds, getSettings, removeLocation, removeReferenceValue, resetSettings, setHealthThresholds } from './settings';
import { advancePrerequisite, confirmEquipment, getSite, remindInCursus, saveDailyReport, syncCursus } from './site';

const A = {
  director: { role: 'director', name: 'Marie Lefebvre' },
  pm: { role: 'pm', name: 'Romain Aubert' },
  member: { role: 'member', name: 'Julien Wagner' },
  depthead: { role: 'depthead', name: 'Marion Kerviel' },
  englead: { role: 'englead', name: 'Antoine Girard' },
  quality: { role: 'quality', name: 'Gabriel Comte' },
  procurement: { role: 'procurement', name: 'Fabien Bertrand' },
  client: { role: 'client', name: 'Nadia Bensaïd' },
} as const;
const HLT = 'HLT-026';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const lastAudit = async () => (await listAudit({ limit: 1 }))[0];

describe('NCRs — progress sent to Vigie (Vigie owns the NCRs)', () => {
  it('one step at a time, "pending sync with Vigie"; the status stays Vigie’s until Vigie reports it', async () => {
    const r = await advanceNcr(HLT, 'NCR-028', A.pm);
    expect(r).toMatchObject({ ncrNumber: 'NCR-028', kind: 'step', targetStatus: 'root_cause', syncStatus: 'pending' });
    const n = (await getNcr(HLT, 'ncr-028'))!;
    expect([n.status, n.requestedStatus, n.requestedStatusLabel, n.pendingSyncLabel, n.canStep]).toEqual(['containment', 'root_cause', 'Root cause', 'Pending sync with Vigie', false]);
    await expect(advanceNcr(HLT, 'NCR-028', A.pm)).rejects.toThrow(/already waiting for Vigie/);
    expect(await lastAudit()).toMatchObject({ who: 'Romain Aubert', object: 'NCR-028', area: 'Quality' });
  });

  it('refusals: closed NCR, outside the Quality workspace, closing by a step', async () => {
    await expect(advanceNcr(HLT, 'NCR-027', A.quality)).rejects.toThrow(/closed/);
    await expect(advanceNcr(HLT, 'NCR-026', A.member)).rejects.toThrow(/outside your workspace/);
    await expect(advanceNcr(HLT, 'NCR-999', A.quality)).rejects.toThrow(/Unknown NCR/);
    await expect(getVigieQualityConnector().recordNcrProgress(HLT, 'NCR-029', { step: 'verification' }, A.quality)).rejects.toThrow(/cannot move/);
  });

  it('verification: quality only, on an NCR Vigie reports in Verification; approve → Closed, reject → Corrective action', async () => {
    // Vigie moves NCR-026 to Verification (a refresh of the mirror).
    const db = await getDb();
    const recs = prototypeNcrSnapshot(PROTO.HLT_NCRS as ProtoNcrRow[], Object.keys(PROTO_GEN.projectData)).map((r) => (r.projectCode === HLT && r.number === 'NCR-026' ? { ...r, status: 'verification' as const } : r));
    await db.transaction((tx) => upsertNcrMirror(tx, recs, new Date()));
    expect((await ncrVerificationQueue(HLT, A.quality)).map((n) => n.number)).toEqual(['NCR-026']);
    expect(await ncrVerificationQueue(HLT, A.pm)).toEqual([]);
    await expect(advanceNcr(HLT, 'NCR-026', A.pm)).rejects.toThrow(/Only the quality manager verifies and closes/);
    await expect(verifyNcr(HLT, 'NCR-026', 'approved', A.director)).rejects.toThrow(/Only the quality manager/);
    await expect(verifyNcr(HLT, 'NCR-029', 'approved', A.quality)).rejects.toThrow(/not in verification/);
    const r = await verifyNcr(HLT, 'NCR-026', 'approved', A.quality, 'Splice re-welded and UT tested');
    expect(r).toMatchObject({ kind: 'verification', targetStatus: 'closed', syncStatus: 'pending' });
    expect(await ncrVerificationQueue(HLT, A.quality)).toEqual([]);
    expect(await ncrVerificationDecidedCount(A.quality)).toBe(1);
    expect((await getNcr(HLT, 'NCR-026'))!.requestedStatus).toBe('closed');
  });

  it('links: Vigie events (NC), report form with the Keystone context, prevention plans and permits', () => {
    expect(vigieNcrUrl({ number: 'NCR-029' })).toBe('http://localhost:3200/evenements?etat=tous&type=NC&q=NCR-029');
    expect(vigieNcrUrl({ number: 'NCR-029', vigieRef: 'EV-2026-130' })).toBe('http://localhost:3200/evenements?etat=tous&sel=EV-2026-130');
    expect(vigieReportNcrUrl({ projectCode: HLT, partRef: 'KS-STL-0450' })).toBe('http://localhost:3200/signaler?type=NC&projet=HLT-026&article=KS-STL-0450&source=keystone');
    expect(vigieHseUrl({ kind: 'permit', vigieRef: 'PF-2026-030' })).toBe('http://localhost:3200/prevention?onglet=permis&permis=PF-2026-030');
    expect(vigieHseUrl({ kind: 'prevention_plan' })).toBe('http://localhost:3200/prevention');
    // R-025 (V-3b "a"): the lists and the fallback links name the project as `projet` (the Keystone code until NEW-SYS-1 / R-022).
    expect(vigieNcrListUrl()).toBe('http://localhost:3200/evenements?type=NC');
    expect(vigieNcrListUrl({ projectCode: HLT })).toBe('http://localhost:3200/evenements?type=NC&projet=HLT-026');
    expect(vigieHseListUrl({ projectCode: HLT })).toBe('http://localhost:3200/prevention?projet=HLT-026');
    expect(vigieCoactivityUrl({ projectCode: HLT })).toBe('http://localhost:3200/prevention/carte?projet=HLT-026');
    expect(vigieCoactivityUrl()).toBe('http://localhost:3200/prevention/carte');
    expect(vigieHseUrl({ kind: 'permit', projectCode: HLT })).toBe('http://localhost:3200/prevention?onglet=permis&projet=HLT-026');
    expect(vigieHseUrl({ kind: 'register', projectCode: HLT })).toBe('http://localhost:3200/evenements?etat=tous&type=PA&projet=HLT-026');
    expect(vigieHseUrl({ kind: 'prevention_plan', vigieRef: 'PP-2026-013', projectCode: HLT })).toBe('http://localhost:3200/prevention?plan=PP-2026-013');
  });

  it('HTTP connector (VIGIE_API_URL): delivers the NCR outbox, then Vigie’s refresh becomes the mirror (NCRs and HSE)', async () => {
    vi.stubEnv('VIGIE_API_URL', 'http://vigie.test/');
    resetVigieQualityRefreshThrottle();
    const posted: string[] = [];
    const ncrs = (await mockQualityConnector.listNcrs({ projectCodes: [HLT] })).map((n) => ({ ...n, updatedAt: null, status: n.number === 'NCR-028' ? 'root_cause' : n.status }));
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(url);
        return new Response(JSON.stringify({ id: 'VG-' + posted.length }), { status: 201 });
      }
      if (url.endsWith('/api/ncrs?source=keystone')) return new Response(JSON.stringify(ncrs), { status: 200 });
      if (url.endsWith('/api/hse?source=keystone')) return new Response(JSON.stringify([{ projectCode: HLT, vigieRef: 'PP-2026-013', kind: 'prevention_plan', title: 'Plan de prévention signé', status: 'signed', statusText: null, dateOn: '2026-09-15' }]), { status: 200 });
      return new Response('{}', { status: 404 });
    }));
    const r = await httpQualityConnector.sync();
    expect(r).toMatchObject({ delivered: 2, failed: 0, pending: 0 });
    expect(posted).toEqual(['http://vigie.test/api/ncrs/HLT-026/NCR-028/progress', 'http://vigie.test/api/ncrs/HLT-026/NCR-026/progress']);
    const n = (await getNcr(HLT, 'NCR-028'))!;
    expect([n.status, n.requestedStatus]).toEqual(['root_cause', null]);
    expect((await httpQualityConnector.listHse(HLT)).map((h) => [h.vigieRef, h.vigieUrl])).toEqual([['PP-2026-013', 'http://localhost:3200/prevention?plan=PP-2026-013']]);
    // Other projects' NCRs pruned by the full refresh (Vigie only sent HLT-026's).
    expect(await httpQualityConnector.listNcrs({ projectCodes: ['NDC-031'] })).toEqual([]);
  });
});

describe('deliverables — producer steps and client acceptance (PV)', () => {
  it('Start → To internal review → Submit to client (accept by status date + 10 days); wrong step refused', async () => {
    await moveDeliverable(HLT, 'D-018', 'in_progress', A.pm);
    await expect(moveDeliverable(HLT, 'D-018', 'submitted', A.pm)).rejects.toThrow(/cannot move/);
    await moveDeliverable(HLT, 'D-018', 'internal_review', A.englead);
    await expect(moveDeliverable(HLT, 'D-018', 'submitted', A.client)).rejects.toThrow(/client accepts or rejects/);
    await moveDeliverable(HLT, 'D-018', 'submitted', A.pm);
    expect(await getDeliverable(HLT, 'D-018')).toMatchObject({ status: 'submitted', submittedOn: '2026-09-25', acceptanceDueOn: '2026-10-05', acceptanceText: 'Accept by 5 Oct' });
    expect(await lastAudit()).toMatchObject({ who: 'Romain Aubert', object: 'D-018', change: 'status: Internal review → Submitted', area: 'Deliverables' });
  });

  it('only the client contact of the project decides; accept stamps the viewer, reject records the comments', async () => {
    await expect(decideDeliverable(HLT, 'D-014', 'accepted', A.pm)).rejects.toThrow(/Only the client/);
    await expect(decideDeliverable(HLT, 'D-014', 'accepted', A.director)).rejects.toThrow(/Only the client/);
    await expect(decideDeliverable('NDC-031', 'D-112', 'accepted', A.client)).rejects.toThrow(/Only the client/);
    expect((await deliverableAcceptanceQueue(HLT, A.client)).map((d) => d.number)).toEqual(['D-014', 'D-016', 'D-018']);
    await decideDeliverable(HLT, 'D-014', 'accepted', A.client);
    expect(await getDeliverable(HLT, 'D-014')).toMatchObject({ status: 'accepted', acceptedOn: '2026-09-25', acceptedBy: 'N. Bensaïd', acceptanceText: '25 Sep · N. Bensaïd' });
    await decideDeliverable(HLT, 'D-016', 'rejected', A.client, 'Load case 4 missing');
    expect(await getDeliverable(HLT, 'D-016')).toMatchObject({ status: 'rejected', reviewComments: 'Load case 4 missing', acceptanceText: '25 Sep · comments issued' });
    await expect(decideDeliverable(HLT, 'D-016', 'accepted', A.client)).rejects.toThrow(/not submitted/);
    expect(await deliverableDecidedCount(A.client)).toBe(2);
    const portal = await getClientPortal(HLT);
    // P-6b (delivery 8, R-069): CR-008 waits for the director before it reaches the client.
    expect(portal.decisions.map((d) => d.id)).toEqual(['D-018']);
    expect(portal.decided.map((d) => d.id)).toEqual(['CR-004', 'CR-006', 'D-011', 'D-012', 'D-014', 'D-015', 'D-016']);
  });

  it('links the issued Codex record', async () => {
    await linkDeliverableDocument(HLT, 'D-018', 'COC-HLT-012', A.quality);
    expect((await getDeliverable(HLT, 'D-018'))!.documentNumber).toBe('COC-HLT-012');
    await expect(linkDeliverableDocument(HLT, 'D-018', 'NOPE-1', A.quality)).rejects.toThrow(/Unknown document/);
  });
});

describe('ITP and punch list', () => {
  it('"Add inspection": I-20, Planned, custom line; unknown system refused; a project without plan gets one', async () => {
    expect(await addItpInspection(HLT, { name: 'Wind alarm re-test', system: 'Anti-collision', pointType: 'witness', stage: 'sat', plannedOn: '2026-12-14' }, A.quality)).toBe('I-20');
    expect(await addItpInspection(HLT, { name: 'Cable pulling', system: 'Electrical HV/LV', pointType: 'review', stage: 'site' }, A.quality)).toBe('I-21');
    await expect(addItpInspection(HLT, { name: 'X', system: 'Nope', pointType: 'hold', stage: 'site' }, A.quality)).rejects.toThrow(/Unknown system/);
    await expect(addItpInspection(HLT, { name: 'X', system: 'Structure', pointType: 'hold', stage: 'site' }, A.procurement)).rejects.toThrow(/outside your workspace/);
    const plan = (await getItpPlan(HLT))!;
    expect([plan.inspections.length, plan.customCount, plan.inspections.at(-2)!.result]).toEqual([15, 4, 'planned']);
    expect(await addItpInspection('NDC-031', { name: 'Raised floor load test', system: 'General', pointType: 'hold', stage: 'site' }, A.director)).toBe('I-20');
    expect((await getItpPlan('NDC-031'))!).toMatchObject({ template: 'AUTRE', systems: ['General'] });
  });

  it('"Add punch item": P-10 Open; Start → In progress → Close on every origin; outside the workspace refused', async () => {
    expect(await addPunchItem(HLT, { description: 'Missing anchor nut — bay 2', location: 'Structure · Bay 2', category: 'A', source: 'site_walk', owner: 'J. Wagner', dueOn: '2026-10-10' }, A.englead)).toBe('P-10');
    expect((await listPunchItems(HLT, 'itp')).at(-1)).toMatchObject({ number: 'P-10', status: 'open', category: 'A', owner: 'J. Wagner', sourceText: 'Site walk' });
    expect((await getCommissioning(HLT))!.systems[0].blockingA).toBe(1);
    expect(await advancePunchItem(HLT, 'P-10', A.englead)).toBe('in_progress');
    expect(await advancePunchItem(HLT, 'P-10', A.englead)).toBe('closed');
    await expect(advancePunchItem(HLT, 'P-10', A.englead)).rejects.toThrow(/closed/);
    await expect(advancePunchItem(HLT, 'P-02', A.member)).rejects.toThrow(/outside your workspace/);
    // A-6 'a' (R-117): one list — an item raised on site (P-07, was the read-only Site register's P-02) takes the same steps,
    // on Inspections & punch list; the Site screen stays read-only (no writer there), a team member is still refused.
    expect(await advancePunchItem(HLT, 'P-07', A.quality)).toBe('in_progress');
    await expect(advancePunchItem(HLT, 'P-07', A.member)).rejects.toThrow(/outside your workspace/);
  });
});

describe('commissioning — Plan SAT', () => {
  it('records the SAT plan and dates the system’s SAT step', async () => {
    await planSat(HLT, { system: 'Structure', date: '2026-12-08', clientWitnesses: 'N. Bensaïd, K. Doucouré', prerequisites: 'Punch A items closed' }, A.pm);
    const c = (await getCommissioning(HLT))!;
    expect(c.systems[0].cells[3]).toMatchObject({ step: 'sat', status: 'planned', dateOn: '2026-12-08' });
    expect(c.satPlans).toEqual([expect.objectContaining({ system: 'Structure', plannedOn: '2026-12-08', plannedBy: 'Romain Aubert' })]);
    await expect(planSat(HLT, { system: 'Nope', date: '2026-12-08' }, A.pm)).rejects.toThrow(/Unknown system/);
    await expect(planSat(HLT, { system: 'Structure', date: '8 Dec' }, A.pm)).rejects.toThrow(/Invalid date/);
  });
});

describe('lessons learned & closure', () => {
  it('LL-10 Proposed, Validate → Mark applied, closure cycles', async () => {
    expect(await addLesson(HLT, { theme: 'site', whatHappened: 'Crane hire booked late', recommendation: 'Book the 250 t crane at FAT', appliesTo: 'WBS template' }, A.quality)).toBe('LL-10');
    let rex = await getRex(HLT);
    expect(rex.lessons.at(-1)).toMatchObject({ number: 'LL-10', impact: '—', status: 'proposed', next: 'validated' });
    expect(await advanceLesson(HLT, 'LL-10', A.englead)).toBe('validated');
    expect(await advanceLesson(HLT, 'LL-10', A.englead)).toBe('applied');
    await expect(advanceLesson(HLT, 'LL-10', A.englead)).rejects.toThrow(/already applied/);
    expect(await cycleClosureItem(HLT, 0, A.pm)).toBe('in_progress');
    expect(await cycleClosureItem(HLT, 4, A.pm)).toBe('not_started');
    rex = await getRex(HLT);
    expect([rex.closure[0].status, rex.closure[4].status]).toEqual(['in_progress', 'not_started']);
    await expect(addLesson(HLT, { theme: 'site', whatHappened: '', recommendation: 'x', appliesTo: 'Other' }, A.quality)).rejects.toThrow(/required/);
    await expect(addLesson(HLT, { theme: 'site', whatHappened: 'x', recommendation: 'x', appliesTo: 'Other' }, A.procurement)).rejects.toThrow(/outside your workspace/);
  });
});

describe('installed base and warranty claims', () => {
  it('"Add machine": MCH-050, In warranty, zone from the site city', async () => {
    expect(await addMachine({ name: 'Overhead crane 10 t', machineType: 'MEMU', client: 'Logistics BU', site: 'Casablanca · hub', deliveredOn: '2026-09-01', warrantyEndOn: '2028-08-31' }, A.director)).toBe('MCH-050');
    expect(await getMachine('mch-050')).toMatchObject({ zone: 'afr', warrantyStatus: 'in_warranty', projectCode: null, machineTypeLabel: 'MEMU' });
    expect(await addMachine({ name: 'R&D rig', machineType: 'R&D', client: 'Finance' }, A.pm)).toBe('MCH-051');
    await expect(addMachine({ name: 'X', machineType: 'NOPE', client: 'X' }, A.pm)).rejects.toThrow(/Unknown machine type/);
    await expect(addMachine({ name: 'X', machineType: 'EMP', client: 'X' }, A.englead)).rejects.toThrow(/outside your workspace/);
    expect((await listMachines()).length).toBe(10);
  });

  it('"New warranty claim": WC-020 Open, reported 30 Sep 2026, cost 0, first in the list', async () => {
    expect(await openClaim({ machineNumber: 'MCH-050', issue: 'Hoist overheating', severity: 'major', coverage: 'warranty', owner: 'S. Haddad', description: 'Remote diagnosis' }, A.quality)).toBe('WC-020');
    // Added claims follow the seed claims, open ones first (`claimsAll` then the open-first sort, 4987).
    const all = await listClaims();
    expect(all.findIndex((x) => x.number === 'WC-020')).toBe(all.filter((x) => x.open).length - 1);
    const c = all.find((x) => x.number === 'WC-020')!;
    expect(c).toMatchObject({ number: 'WC-020', machineNumber: 'MCH-050', status: 'open', reportedOn: '2026-09-30', costKeur: 0, nextStep: 'Remote diagnosis', owner: 'S. Haddad' });
    expect((await listClaims({ zone: 'afr' })).map((x) => x.number)).toEqual(['WC-017', 'WC-020']);
    await expect(openClaim({ machineNumber: 'MCH-999', issue: 'x', severity: 'minor', coverage: 'warranty', owner: 'S. Haddad' }, A.quality)).rejects.toThrow(/Unknown machine/);
  });
});

describe('site — readiness, daily reports, Cursus', () => {
  it('prerequisites (Client confirms → Signed on site), equipment confirmation, Go conditions follow', async () => {
    await advancePrerequisite(HLT, 3, 'confirmed', A.member);
    await expect(advancePrerequisite(HLT, 3, 'confirmed', A.member)).rejects.toThrow(/Confirmed/);
    await advancePrerequisite(HLT, 3, 'signed', A.member);
    await confirmEquipment(HLT, 2, A.depthead);
    await expect(confirmEquipment(HLT, 2, A.depthead)).rejects.toThrow(/already confirmed/);
    await expect(confirmEquipment(HLT, 4, A.quality)).rejects.toThrow(/outside your workspace/);
    const s = (await getSite(HLT))!;
    // HSE: the HTTP refresh above left Vigie's single signed prevention plan in the mirror — no permit pending.
    // D-6b 'a' (R-119): 8 conflicts computed from the rotation plan (the prototype's 4 authored collisions).
    expect(s.go.conditions.map((c) => c.sub)).toEqual(['1 pending', '2 NO GO', '1 unconfirmed', '8 collisions', 'Ready']);
    await expect(advancePrerequisite('NDC-031', 0, 'confirmed', A.pm)).rejects.toThrow(/no site sheet/);
  });

  it('"Daily report": DR-003 by the viewer, listed first', async () => {
    // NEW-SITE-2 'a' (R-122): no HSE incident is recorded with the report any more (declared in Vigie).
    expect(await saveDailyReport(HLT, { date: '2026-09-30', weather: 'wind', headcount: 24, progress: 'Crane rail survey bays 1–3' }, A.pm)).toBe('DR-003');
    const s = (await getSite(HLT))!;
    expect(s.dailyReports[0]).toMatchObject({ number: 'DR-003', reportOn: '2026-09-30', author: 'R. Aubert', weatherLabel: 'Wind > 50 km/h', headcount: 24, hseIncident: null, hseIncidentLabel: null });
    await expect(saveDailyReport(HLT, { date: '2026-09-30', weather: 'clear', progress: ' ' }, A.pm)).rejects.toThrow(/required/);
  });

  it('Cursus (mock): remind once per person not GO; GO refused; sync reports the approvals', async () => {
    const r = await remindInCursus(HLT, 'Thomas Kerbrat', A.pm);
    expect(r).toMatchObject({ kind: 'reminder', syncStatus: 'pending' });
    await expect(remindInCursus(HLT, 'Thomas Kerbrat', A.pm)).rejects.toThrow(/already sent/);
    await expect(remindInCursus(HLT, 'Julien Wagner', A.pm)).rejects.toThrow(/GO: nothing to remind/);
    await expect(remindInCursus(HLT, 'Nobody', A.pm)).rejects.toThrow(/not mobilised/);
    await expect(remindInCursus(HLT, 'Hélène Sauvage', A.quality)).rejects.toThrow(/outside your workspace/);
    const s = (await getSite(HLT))!;
    expect(s.cursus.people.filter((p) => p.reminded).map((p) => [p.personName, p.reminderSyncStatus])).toEqual([['Thomas Kerbrat', 'pending']]);
    expect(await syncCursus(HLT, A.pm)).toMatchObject({ received: 5, delivered: 0 });
    expect((await lastAudit()).change).toBe('sync · 5 approvals received');
    expect(cursusChantierUrl('K-2614')).toBe('http://localhost:5173/chantiers?chantier=K-2614');
  });

  it('Cursus (HTTP, CURSUS_API_URL): go-no-go per Cursus’s contract (X-Api-Key, matricules), travel request to POST /demandes', async () => {
    const db = await getDb();
    await db.execute(sql`update site_sheets set cursus_chantier_id = 'K-2614'`);
    await db.execute(sql`update cursus_clearances set matricule = 'EMP-0018' where person_name = 'Thomas Kerbrat'`);
    vi.stubEnv('CURSUS_API_URL', 'http://cursus.test/');
    resetCursusRefreshThrottle();
    const calls: { url: string; key: string | null; body?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, key: new Headers(init?.headers).get('x-api-key'), body: init?.body as string | undefined });
      if (url.endsWith('/go-no-go')) {
        return new Response(JSON.stringify({
          chantier: 'K-2614', evalue_le: '2026-10-08T07:00:00+02:00', statut: 'NO_GO',
          ressources: [{ matricule: 'EMP-0018', statut: 'NO_GO', motifs: [{ code: 'HABILITATION', libelle: 'Habilitation requise en attente' }] }, { matricule: 'EMP-0006', statut: 'GO', motifs: [] }],
        }), { status: 200 });
      }
      if (url.endsWith('/demandes')) return new Response(JSON.stringify({ id: 42, statut: 'en_attente_rh' }), { status: 201 });
      return new Response('{}', { status: 404 });
    }));
    expect(getCursusConnector().mode).toBe('http');
    const g = await httpCursusConnector.getGoNoGo(HLT);
    expect(calls[0]).toMatchObject({ url: 'http://cursus.test/api/integrations/keystone/chantiers/K-2614/go-no-go', key: 'demo-keystone' });
    expect(g.people.map((p) => [p.personName, p.matricule, p.verdict, p.clearance, p.clearanceNote])).toEqual([
      ['Thomas Kerbrat', 'EMP-0018', 'no_go', 'missing', 'Habilitation requise en attente'], ['EMP-0006', 'EMP-0006', 'go', 'ok', ''],
    ]);
    expect(g.verdict).toBe('no_go');
    // A second read within the minute uses the refreshed mirror (no new call).
    await httpCursusConnector.getGoNoGo(HLT);
    expect(calls.filter((c) => c.url.endsWith('/go-no-go')).length).toBe(1);
    const r = await httpCursusConnector.requestTravel(HLT, { personName: 'Thomas Kerbrat', destination: 'fr', depart: '2026-10-26', retour: '2026-11-27' }, A.pm);
    expect(r).toMatchObject({ kind: 'travel_request', syncStatus: 'sent' });
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ matricule: 'EMP-0018', chantier: 'K-2614', destination: 'FR', depart: '2026-10-26', retour: '2026-11-27' });
    await expect(httpCursusConnector.requestTravel(HLT, { personName: 'Thomas Kerbrat', destination: 'FR', depart: '2026-11-27', retour: '2026-10-26' }, A.pm)).rejects.toThrow(/before departure/);
    // Payload mapping: a reserve on a certification → expiring; travel formalities → visa / vaccinations pending.
    expect(recordsOfPayload(HLT, { chantier: 'K', evalue_le: 'x', statut: 'GO_RESERVE', ressources: [{ matricule: 'M', statut: 'GO_RESERVE', motifs: ['CERTIFICATION', 'FORMALITES_VOYAGE'] }] }, new Map())[0])
      .toMatchObject({ clearance: 'expiring', visa: 'pending', vaccination: 'pending', verdict: 'go_with_reserve', clearanceNote: 'CERTIFICATION · FORMALITES_VOYAGE' });
  });
});

describe('client portal — issues', () => {
  it('CI-08, CI-09, CI-10 (never "CI-010"), newest first; only the project’s client or the director', async () => {
    expect(await raiseClientIssue(HLT, 'Dust on berth 4 during grinding', A.client)).toBe('CI-08');
    expect(await raiseClientIssue(HLT, 'Weekly photo report format', A.client)).toBe('CI-09');
    expect(await raiseClientIssue(HLT, 'Access badge renewals', A.director)).toBe('CI-10');
    await expect(raiseClientIssue(HLT, 'x', A.pm)).rejects.toThrow(/outside your workspace/);
    await expect(raiseClientIssue('NDC-031', 'x', A.client)).rejects.toThrow(/Only the project’s client/);
    const p = await getClientPortal(HLT);
    expect(p.issues.slice(0, 4).map((i) => [i.number, i.status, i.raisedBy, i.response])).toEqual([
      ['CI-10', 'open', 'Marie Lefebvre', 'Acknowledged — response within 2 working days'], ['CI-09', 'open', 'Nadia Bensaïd', 'Acknowledged — response within 2 working days'],
      ['CI-08', 'open', 'Nadia Bensaïd', 'Acknowledged — response within 2 working days'], ['CI-04', 'closed', 'Nadia Bensaïd', 'Noise barrier + shifted window 06:00–20:00'],
    ]);
  });
});

describe('engineering register', () => {
  it('confirm an input, resolve / send back checks, generate an output (Blocked refused)', async () => {
    await expect(confirmEngInput(HLT, 'meca', 'PID-HLT-026', A.englead)).resolves.toBeUndefined();
    await expect(confirmEngInput(HLT, 'meca', 'PID-HLT-026', A.englead)).rejects.toThrow(/already confirmed/);
    await expect(confirmEngInput(HLT, 'elec', 'PID-HLT-026', A.englead)).rejects.toThrow(/import the new revision/);
    await expect(generateEngOutput(HLT, 'O-03', A.englead)).rejects.toThrow(/blocked/);
    await closeEngCheck(HLT, 'C-01', 'resolved', A.englead);
    await closeEngCheck(HLT, 'C-03', 'sent_back', A.englead);
    await expect(closeEngCheck(HLT, 'C-03', 'resolved', A.englead)).rejects.toThrow(/Sent back/);
    const r = (await getEngineeringRegister(HLT))!;
    expect(r.checks.filter((c) => ['C-01', 'C-03'].includes(c.number)).map((c) => [c.number, c.statusLabel, c.note])).toEqual([
      ['C-01', 'Resolved', 'Resolved in Keystone'], ['C-03', 'Sent back', 'Sent back to tool · closes on next import'],
    ]);
    expect(r.outputs.find((o) => o.number === 'O-03')!.state).toBe('ready');
    await generateEngOutput(HLT, 'O-03', A.englead);
    expect((await getEngineeringRegister(HLT))!.outputs.find((o) => o.number === 'O-03')!.generatedFormat).toBe('xlsx');
    await expect(confirmEngInput(HLT, 'meca', 'LST-INS-026', A.member)).rejects.toThrow(/outside your workspace/);
  });

  it('Freeze → Propose release (blocked while a blocking check is open) → Validate release (the project’s PM only)', async () => {
    await freezeEngDeliverable(HLT, 'SCH-ELE-026', A.englead);
    await proposeEngRelease(HLT, 'SCH-ELE-026', A.englead);
    await freezeEngDeliverable(HLT, 'VAR-PLC-026', A.englead);
    await expect(proposeEngRelease(HLT, 'VAR-PLC-026', A.englead)).rejects.toThrow(/Release blocked · 2 blocking/);
    await expect(validateEngRelease(HLT, 'SCH-ELE-026', A.englead)).rejects.toThrow(/Only the project manager/);
    await expect(validateEngRelease(HLT, 'SCH-ELE-026', { role: 'pm', name: 'Sophie Renard' })).rejects.toThrow(/Only the project manager/);
    // P-7c = a (Delivery 7, R-106): the validation starts the Codex approval circuit; Codex releases the deliverable.
    await validateEngRelease(HLT, 'SCH-ELE-026', A.pm);
    const d = (await getEngineeringRegister(HLT))!.deliverables.find((x) => x.number === 'SCH-ELE-026')!;
    expect([d.status, d.revision, d.canValidate, d.codexNote]).toEqual(['release_proposed', 'B', false, 'Approval circuit started · Pending sync with Codex']);
    await expect(validateEngRelease(HLT, 'SCH-ELE-026', A.pm)).rejects.toThrow(/already started/);
    await expect(freezeEngDeliverable(HLT, 'PRO-QMS-021', A.englead)).rejects.toThrow(/not an engineering deliverable/);
  });

  it('import wizard: instrument list rev D for Electrical → inputs rev D to confirm, C-08 closed by the import', async () => {
    const res = await importEngList(HLT, { consumer: 'elec', documentNumber: 'LST-INS-026', toolPosition: 2 }, A.englead);
    expect(res).toEqual({ revision: 'D', closedChecks: ['C-08'] });
    const r = (await getEngineeringRegister(HLT))!;
    expect(r.inputs.filter((i) => i.consumer === 'elec' && ['LST-INS-026', 'PID-HLT-026'].includes(i.documentNumber)).map((i) => [i.documentNumber, i.revisionInUse, i.state]))
      .toEqual([['PID-HLT-026', 'D', 'to_confirm'], ['LST-INS-026', 'D', 'to_confirm']]);
    expect(r.checks.find((c) => c.number === 'C-08')).toMatchObject({ status: 'resolved', note: 'Closed by import of rev D' });
    expect(r.imports[0]).toMatchObject({ consumer: 'elec', documentNumber: 'LST-INS-026', revision: 'D', fileName: 'LST-INS-026_revD.xlsx', importedBy: 'Antoine Girard' });
    await expect(importEngList(HLT, { consumer: 'elec', documentNumber: 'NOPE', toolPosition: 2 }, A.englead)).rejects.toThrow(/Unknown document/);
  });
});

describe('P&ID mapping', () => {
  it('maps an unmapped tag to a candidate, unlinks it; client scope and non-candidates refused; outside refused', async () => {
    const [cand] = (await pidCandidates(HLT, 'TT-102')).rows.filter((c) => c.status === 'validated' && c.inBom);
    await mapPidTag(HLT, 'TT-102', cand.ref, A.englead);
    let v = (await getPidValidation(HLT))!;
    expect(v.tags.find((t) => t.tag === 'TT-102')).toMatchObject({ partRef: cand.ref, status: 'linked' });
    expect([v.coverage.linked, v.coverage.pct]).toEqual([14, 64]);
    await mapPidTag(HLT, 'TT-102', null, A.quality);
    v = (await getPidValidation(HLT))!;
    expect(v.tags.find((t) => t.tag === 'TT-102')!.status).toBe('unmapped');
    await expect(mapPidTag(HLT, 'T-101', 'EQ-CRN-250T', A.englead)).rejects.toThrow(/Client-supplied/);
    // E-6 (R-108): any catalogue article may be linked (KS-STL-0450 was refused as "not a BOM article of a compatible type");
    // an unknown reference is still refused.
    await expect(mapPidTag(HLT, 'TT-102', 'NOPE-999', A.englead)).rejects.toThrow(/not in the catalogue/);
    await mapPidTag(HLT, 'TT-102', 'KS-STL-0450', A.englead);
    expect((await getPidValidation(HLT))!.tags.find((t) => t.tag === 'TT-102')!.partRef).toBe('KS-STL-0450');
    await mapPidTag(HLT, 'TT-102', null, A.englead);
    await expect(mapPidTag(HLT, 'TT-102', cand.ref, A.pm)).rejects.toThrow(/outside your workspace/);
  });
});

describe('machine types', () => {
  it('creates a custom type from a template (code normalised, duplicate refused) and edits the aggregate', async () => {
    expect(await createMachineType({ code: ' emp xl ', label: 'Large gantry', base: 'EMP', calendar: 'site_6x10' }, A.englead)).toBe('EMP-XL');
    await expect(createMachineType({ code: 'emp-xl', label: 'x', base: 'blank', calendar: 'standard_5x8' }, A.englead)).rejects.toThrow(/Code already used/);
    await expect(createMachineType({ code: 'r&d', label: 'x', base: 'blank', calendar: 'standard_5x8' }, A.englead)).rejects.toThrow(/Code already used/);
    expect(await getMachineType('EMP-XL')).toMatchObject({ isStandard: false, phases: (await getMachineType('EMP'))!.phases, itpSystems: (await getMachineType('EMP'))!.itpSystems, depositPct: 30 });
    expect(await createMachineType({ code: 'blank1', label: 'Blank one', base: 'blank', calendar: 'standard_5x8' }, A.pm)).toBe('BLANK1');
    expect(await getMachineType('BLANK1')).toMatchObject({ phases: [], costCategories: [], itpSystems: ['General'], depositPct: 30, deliveryPct: 60, acceptancePct: 10 });
    await updateMachineType('EMP', { label: 'Gantry cranes', depositPct: 35, active: false }, A.quality);
    expect(await getMachineType('EMP')).toMatchObject({ label: 'Gantry cranes', depositPct: 35, termsOk: false, active: false });
    await setMachineTypePhases('SPUR', ['Études', 'Génie civil', 'New phase'], A.pm);
    await setMachineTypeItpSystems('SPUR', ['Track', 'Switches'], A.pm);
    await setMachineTypeCostCategories('SPUR', [{ name: 'Génie civil', type: 'subcontract', budgetKeur: 300 }, { name: 'New category', type: 'labor', budgetKeur: 0 }], A.pm);
    await removeRexReference('MEMU', 'RTM001', A.pm);
    expect(await getMachineType('SPUR')).toMatchObject({ phases: ['Études', 'Génie civil', 'New phase'], itpSystems: ['Track', 'Switches'], costTotalKeur: 300 });
    expect((await getMachineType('MEMU'))!.rexReferences.map((r) => r.analyticCode)).toEqual(['CPL001']);
    await expect(updateMachineType('EMP', { depositPct: 120 }, A.pm)).rejects.toThrow(/whole percentage/);
    await expect(updateMachineType('EMP', { label: 'x' }, A.procurement)).rejects.toThrow(/outside your workspace/);
    await expect(setMachineTypeItpSystems('SPUR', ['A', 'A'], A.pm)).rejects.toThrow(/distinct/);
  });
});

describe('settings', () => {
  it('lists: add (duplicate refused, removed entry reactivated), remove; locations; thresholds; reset to defaults', async () => {
    // A-14: only the portfolio director edits Settings; the other workspace roles are refused.
    for (const who of [A.quality, A.pm, A.procurement]) await expect(addReferenceValue('riskCats', 'Cyber security', who)).rejects.toThrow(/portfolio director/);
    expect(await addReferenceValue('riskCats', 'Cyber security', A.director)).toBe('cyber_security');
    await expect(addReferenceValue('riskCats', 'cyber security', A.director)).rejects.toThrow(/already in the list/);
    // A-14: "technical" is used by risks → deactivated (kept for them), not deleted.
    expect(await removeReferenceValue('riskCats', 'technical', A.director)).toMatchObject({ mode: 'deactivated' });
    expect((await getSettings()).lists.riskCats.map((r) => r.code)).toEqual(['supplier_delivery', 'hse', 'contractual_client', 'financial_currency', 'regulatory_permits', 'resources_skills', 'cyber_security']);
    expect(await addReferenceValue('holidays', '2 Nov · Pont de la Toussaint', A.director)).toBe('2026-11-02');
    await expect(addReferenceValue('holidays', 'Pont', A.director)).rejects.toThrow(/holiday reads/);
    await addLocation('Magasin chantier — Tanger', 'site_store', A.director);
    await removeLocation('Consignation — Nordvolt', A.director);
    expect((await getSettings()).locations.map((l) => l.name)).toEqual([
      'Entrepôt central — Lyon', 'Atelier mécanique — Lyon', 'Magasin chantier — Le Havre', 'Magasin chantier — Marseille', 'Zone quarantaine QC — Lyon', 'Magasin chantier — Tanger',
    ]);
    await expect(setHealthThresholds({ off: 0.98 }, A.director)).rejects.toThrow(/lower than/);
    expect(await setHealthThresholds({ risk: 0.95, off: 0.85 }, A.director)).toEqual({ risk: 0.95, off: 0.85 });
    await expect(addReferenceValue('skills', 'x', A.member)).rejects.toThrow(/outside your workspace/);
    await resetSettings(A.director);
    const s = await getSettings();
    expect([s.lists.riskCats.length, s.lists.holidays.length, s.locations.length, s.health]).toEqual([7, 11, 6, { risk: 0.97, off: 0.9 }]);
    expect(await getHealthThresholds()).toEqual({ risk: 0.97, off: 0.9 });
  });
});

describe('connectors', () => {
  it('Sync now (Vigie, Cursus, simulated), outside refused', async () => {
    // R-021: Vigie and Cursus without their API URL are mocks — their runs are simulated.
    expect(await syncConnector('Vigie', A.director)).toMatchObject({ ok: true, simulated: true });
    // Cursus (mock again): the people the HTTP refresh above left in the mirror.
    const people = (await getSite(HLT))!.cursus.people.length;
    expect(await syncConnector('Cursus', A.pm)).toMatchObject({ ok: true, volume: `${people} approvals received`, simulated: true });
    // R-021: Lucca is retired (NEW-CURSUS-4); a connector that does not exist is not "synced" any more (A-15).
    await expect(syncConnector('Lucca', A.pm)).rejects.toThrow(/Unknown connector Lucca/);
    await expect(syncConnector('Sage X3', A.pm)).rejects.toThrow(/Sage X3 is not connected/);
    await expect(syncConnector('Codex', A.quality)).rejects.toThrow(/outside your workspace/);
    const list = await listConnectors();
    // R-020: connectors are added by IT's connectors file (src/server/dal/d7-debt-ux.test.ts), no longer from the app.
    expect(list.map((c) => c.name)).not.toContain('SharePoint');
    expect(list.find((c) => c.name === 'Vigie')).toMatchObject({ pending: 0, failed: 0 });
    expect((await lastAudit()).area).toBe('Integrations');
  });
});

describe('Delivery 5 backfill (database seeded before migration 0004)', () => {
  it('an existing database whose Delivery 5 tables are empty gets them seeded once, against its own people and projects', async () => {
    const db = await openDatabase();
    const tables = [
      'deliverable_raci', 'deliverables', 'vigie_ncr_progress', 'vigie_ncrs', 'vigie_hse_items', 'punch_items', 'itp_inspections', 'itp_plans', 'commissioning_steps', 'commissioning_systems',
      'handover_items', 'sat_plans', 'lessons_learned', 'closure_items', 'satisfaction_scores', 'interventions', 'warranty_claims', 'machine_part_revisions', 'machines', 'daily_reports',
      'mission_cost_lines', 'site_conflict_arbitrations', 'site_collisions', 'site_rotations', 'site_prerequisites', 'site_equipment', 'site_sheets', 'cursus_requests', 'cursus_sync_runs', 'cursus_clearances',
      'client_issues', 'eng_imports', 'eng_changes', 'eng_outputs', 'eng_checks', 'eng_consistency_rules', 'eng_inputs', 'eng_disciplines', 'eng_import_tools',
      'eng_column_mappings', 'eng_import_deltas', 'pid_validation_steps', 'pid_tags', 'pid_sheets', 'machine_type_phases', 'machine_type_cost_categories', 'machine_type_itp_systems',
      'connector_sync_runs', 'connectors', 'import_formats', 'app_settings', 'reference_values',
    ];
    for (const t of tables) await db.execute(sql.raw(`delete from ${t}`));
    expect(await seedIfEmpty(db)).toBe(false);
    const count = async (t: string) => ((await db.execute(sql.raw(`select count(*)::int as n from ${t}`))).rows[0] as { n: number }).n;
    expect(await Promise.all(['deliverables', 'vigie_ncrs', 'machines', 'pid_tags', 'reference_values', 'connectors', 'cursus_clearances', 'machine_type_phases'].map(count)))
      .toEqual([30, 15, 8, 24, 60, 10, 5, 28]);
    expect(await seedIfEmpty(db)).toBe(false);
    expect(await count('reference_values')).toBe(60);
  }, 60_000);
});
