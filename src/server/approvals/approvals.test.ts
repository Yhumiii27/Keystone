// My approvals registry on an in-memory seeded database: each persona's queue on Harbor Line (golden values of
// docs/spec/08 §7.5 "Seed queues", with the per-person routing of 00 §7.8), the "Decided this week" totals, the
// per-project badge counts, and the DB-backed kinds reacting to writes (new request, forced stage change, CR step).
import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { codexDocItems, codexVaultItems, inboxView, type ProtoDoc } from '@/domain/approvals';
import { setDb } from '@/server/db/client';
import { stage } from '@/server/db/codes';
import { openDatabase } from '@/server/db/open';
import { decideChangeStep } from '@/server/dal/changes';
import { approveDocumentStep, listVaultDocuments } from '@/server/dal/documents';
import { recordStageChange } from '@/server/dal/lifecycle';
import { getApproverIdentity } from '@/server/dal/myapprovals-identity';
import { createResourceRequest } from '@/server/dal/requests';
import { PROTO } from '@/server/prototype';
import { APPROVAL_PROVIDERS, approvalCount, approvalCountsByProject, getApprovalInbox } from './index';

const inbox = (role: RoleKey, projectCode = 'HLT-026', lang: 'en' | 'fr' = 'en') => getApprovalInbox(PERSONA_BY_ROLE[role], { projectCode, lang });
const queue = async (role: RoleKey, projectCode = 'HLT-026') => (await inbox(role, projectCode)).items.map((i) => `${i.kind}:${i.id}`);

describe('My approvals registry', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('registers one provider per kind, in inbox order', () => {
    expect(APPROVAL_PROVIDERS.map((p) => `${p.kind}/${p.scope}/${p.source}`)).toEqual([
      'request/global/db', 'po/project/db', 'eco/global/db', 'delivery/project/db', 'stage/global/db', 'cr/project/db',
      // Delivery 7 (R-071, C-4): contingency draw-downs of every project wait for the portfolio director.
      'contingency/global/db',
      'deliverable/project/db', 'rfq/global/db', 'invoice/global/db', 'ncr/project/db', 'doc/global/db',
    ]);
  });

  it('approver identities come from the database', async () => {
    expect(await getApproverIdentity(PERSONA_BY_ROLE.depthead)).toMatchObject({ departments: ['Engineering'], managedProjects: [], clientProjects: [] });
    expect((await getApproverIdentity(PERSONA_BY_ROLE.quality)).departments).toEqual(['Quality']);
    expect((await getApproverIdentity(PERSONA_BY_ROLE.pm)).managedProjects).toEqual(expect.arrayContaining(['HLT-026', 'PRS-038', 'QFR-015']));
    expect((await getApproverIdentity(PERSONA_BY_ROLE.client)).clientProjects).toEqual(expect.arrayContaining(['HLT-026', 'PRS-038', 'QFR-015']));
    expect(await getApproverIdentity(PERSONA_BY_ROLE.director)).toMatchObject({ departments: [], managedProjects: [], clientProjects: [] });
  });

  it('seed queues on Harbor Line, per viewer', async () => {
    expect(await queue('director')).toEqual(['po:PO-1082', 'cr:CR-008', 'invoice:INV-HC-7781', 'invoice:INV-BX-55120', 'invoice:INV-LE-2210']);
    expect(await queue('pm')).toEqual(['po:PO-1082', 'eco:ECO-2026-015', 'rfq:RFQ-2026-031']);
    expect(await queue('depthead')).toEqual(['request:RQ-043', 'request:RQ-041']);
    expect(await queue('englead')).toEqual([]);
    // The quality manager heads the Quality department (RQ-042) and is the next Codex approver of RPT-HLT-014.
    expect(await queue('quality')).toEqual(['request:RQ-042', 'delivery:BL-2026-0521', 'doc:RPT-HLT-014']);
    expect(await queue('procurement')).toEqual(['delivery:BL-2026-0521', 'rfq:RFQ-2026-031', 'invoice:INV-HC-7781', 'invoice:INV-BX-55120', 'invoice:INV-LE-2210']);
    expect(await queue('client')).toEqual(['cr:CR-008', 'deliverable:D-014', 'deliverable:D-016']);
    expect(await queue('member')).toEqual([]);
  });

  it('"Decided this week" per viewer', async () => {
    const decided = await Promise.all((['director', 'pm', 'depthead', 'englead', 'quality', 'procurement', 'client', 'member'] as const).map(async (r) => (await inbox(r)).decided));
    // director: PO-1078 ordered · pm: 2 ECOs on the pm key + PO-1078 · englead: 4 ECOs · quality: 3 ECOs + RQ-036 (Quality)
    expect(decided).toEqual([1, 3, 0, 4, 4, 0, 0, 0]);
  });

  it('KPI tiles per persona (myApprKpis 4737 re-run on the prototype; deviations noted)', async () => {
    const kpis = async (role: RoleKey) => {
      const { items, decided } = await inbox(role);
      return inboxView(items, { decided, roleTitle: PERSONA_BY_ROLE[role].title }).kpis.map((k) => k.value);
    };
    // Prototype [waiting, types, oldest, decided] on HLT-026: director 5·3·"25 Sep"·1, pm 3·3·"30 Sep"·3, depthead
    // 2·1·"—"·0, member 0·0·"—"·1, englead 0·0·"—"·5, quality 1·1·"18 Sep"·4, procurement 5·3·"25 Sep"·1, client 3·2·"30 Sep"·1.
    // Here "Oldest" is the earliest date (00 §7.16), requests carry their sent date, "Decided this week" counts the
    // viewer's own kinds only, and the quality manager also heads Quality (RQ-042) and approves RPT-HLT-014 in Codex.
    expect(await Promise.all((['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'] as const).map(kpis))).toEqual([
      ['5', '3', '10 Sep', '1'],
      ['3', '3', '19 Sep', '3'],
      ['2', '1', '24 Sep', '0'],
      ['0', '0', '—', '0'],
      ['0', '0', '—', '4'],
      ['3', '3', '18 Sep', '4'],
      ['5', '3', '10 Sep', '0'],
      ['3', '2', '24 Sep', '0'],
    ]);
  });

  it('resource-request items carry the sender and the sent date (no hard-coded R. Aubert / empty date)', async () => {
    const { items } = await inbox('depthead');
    expect(items[0]).toEqual({
      kind: 'request', id: 'RQ-043', title: 'Steel connection checks — second crew', sub: 'Contract structural engineer · Harbor Line · 40 h', when: '25 Sep', whenIso: '2026-09-25',
      // Chapter 4: decided inline with the Approvals screen's rules (was `decision: null`, decided on Approvals only).
      who: 'R. Aubert', href: '/resources/approvals/engineering', decision: { mode: 'resource-request', number: 'RQ-043' },
    });
    const v = inboxView(items, { decided: 0, roleTitle: 'Head of engineering' });
    expect(v.kpis[2].value).toBe('24 Sep'); // RQ-041, sent Thu 24 Sep
  });

  it('change request item of the director, decided inline', async () => {
    const [cr] = (await inbox('director')).items.filter((i) => i.kind === 'cr');
    expect(cr).toEqual({
      kind: 'cr', id: 'CR-008', title: 'Second steel crew — schedule recovery', sub: 'Budget · Schedule · +€85k · -12 d', when: '24 Sep', whenIso: '2026-09-24', who: 'R. Aubert',
      href: '/projects/HLT-026/changes?cr=CR-008', decision: { mode: 'change-request', projectCode: 'HLT-026', number: 'CR-008', step: 'director' },
    });
    expect((await inbox('client', 'HLT-026', 'fr')).items[0].sub).toBe('Budget · Schedule · +85 k€ · -12 d');
  });

  it('project-bound kinds follow the current project', async () => {
    // NDC-031: two generated receipts waiting for QC; R. Aubert does not manage it (no PO), the client is not its client.
    expect(await queue('quality', 'NDC-031')).toEqual(['request:RQ-042', 'delivery:BL-2026-0331', 'delivery:BL-2026-0332', 'doc:RPT-HLT-014']);
    expect(await queue('pm', 'NDC-031')).toEqual(['eco:ECO-2026-015', 'rfq:RFQ-2026-031']);
    expect(await queue('client', 'NDC-031')).toEqual([]);
    expect(await queue('director', 'WSA-044')).toEqual(['po:PO-5141', 'invoice:INV-HC-7781', 'invoice:INV-BX-55120', 'invoice:INV-LE-2210']);
    // Projects without data: no project-bound item (never Harbor Line's).
    expect(await queue('director', 'EWA-051')).toEqual(['invoice:INV-HC-7781', 'invoice:INV-BX-55120', 'invoice:INV-LE-2210']);
    expect(await queue('director', 'NOPE-999')).toEqual(['invoice:INV-HC-7781', 'invoice:INV-BX-55120', 'invoice:INV-LE-2210']);
  });

  it('badge counts: current project and per project', async () => {
    expect(await approvalCount(PERSONA_BY_ROLE.director, 'HLT-026')).toBe(5);
    expect(await approvalCount(PERSONA_BY_ROLE.quality, 'HLT-026')).toBe(3);
    expect(await approvalCountsByProject(PERSONA_BY_ROLE.director, ['HLT-026', 'WSA-044', 'EWA-051'])).toEqual({ 'HLT-026': 5, 'WSA-044': 4, 'EWA-051': 3 });
    expect(await approvalCountsByProject(PERSONA_BY_ROLE.procurement, ['HLT-026', 'NDC-031', 'RCF-019'])).toEqual({ 'HLT-026': 5, 'NDC-031': 6, 'RCF-019': 4 });
  });

  it('a new request to Engineering reaches the department head first; a forced stage change reaches the director', async () => {
    const n = await createResourceRequest(
      { projectCode: 'HLT-026', title: 'Fatigue check — crane rail clips', activityCode: 'A1250', person: 'Julien Wagner', hours: 16, startDay: 5, dueDay: 9, priority: 'high' },
      'Romain Aubert',
    );
    const [first] = (await inbox('depthead')).items;
    expect([first.id, first.title, first.sub, first.who, first.when]).toEqual([n, 'Fatigue check — crane rail clips', 'Julien Wagner · Harbor Line · 16 h', 'R. Aubert', '25 Sep']);
    expect(await approvalCount(PERSONA_BY_ROLE.depthead, 'HLT-026')).toBe(3);

    await recordStageChange('NDC-031', stage.code('Fabrication & Assemblage'), 'forced', { reason: 'Long-lead switchgear released early', missing: ['x'], requestedByShortName: 'S. Perrin' });
    const forced = (await inbox('director')).items.filter((i) => i.kind === 'stage');
    // Chapter 4 (L-1): decided inline by the portfolio director (was `decision: null`, informational); the decision names
    // the forced history row and the stage Reject reverts to.
    const transitionId = forced[0]?.decision?.mode === 'stage' ? forced[0].decision.transitionId : '';
    expect(transitionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(forced).toEqual([
      {
        kind: 'stage', id: 'NDC-031', title: '#031 · Northgate Data Center Retrofit → Fabrication & Assemblage', sub: 'Long-lead switchgear released early', when: '25 Sep 2026',
        whenIso: '2026-09-25', who: 'S. Perrin', href: '/portfolio/projects?q=NDC-031',
        decision: { mode: 'stage', projectCode: 'NDC-031', transitionId, fromLabel: 'Approvisionnements' },
      },
    ]);
    expect(await queue('pm')).not.toContain('stage:NDC-031');
  });

  it('a decided CR step leaves the decider’s queue and counts as decided; the director then records the CCB', async () => {
    await decideChangeStep('HLT-026', 'CR-008', 'director', 'ok', 'Marie Lefebvre');
    const d = await inbox('director');
    // Same request, next step the director holds: the change control board (recorded by the director, 07 OQ2).
    expect(d.items.filter((i) => i.kind === 'cr').map((i) => [i.id, i.sub, i.decision])).toEqual([
      ['CR-008', 'Budget · Schedule · +€85k · -12 d · Change control board', { mode: 'change-request', projectCode: 'HLT-026', number: 'CR-008', step: 'ccb' }],
    ]);
    expect(d.decided).toBe(2);
    expect(await queue('client')).toContain('cr:CR-008');
    await decideChangeStep('HLT-026', 'CR-008', 'client', 'rejected', 'Nadia Bensaïd');
    expect(await queue('client')).toEqual(['deliverable:D-014', 'deliverable:D-016']);
    // Rejected: nothing left to decide on it for anyone.
    expect(await queue('director')).not.toContain('cr:CR-008');
  });

  it('Codex documents come from the database index: same items as the prototype on the seed, then follow the circuit', async () => {
    const vault = await listVaultDocuments();
    for (const p of Object.values(PERSONA_BY_ROLE)) {
      expect([p.short, codexVaultItems(vault, p.short, 'HLT-026')]).toEqual([p.short, codexDocItems(PROTO.DOCS as ProtoDoc[], PROTO.DOC_TYPE, PROTO.DOC_WHO, p.short, 'HLT-026')]);
    }
    await approveDocumentStep('RPT-HLT-014', 'Gabriel Comte');
    expect(await queue('quality')).not.toContain('doc:RPT-HLT-014');
    expect((await inbox('pm')).items.filter((i) => i.kind === 'doc').map((i) => [i.id, i.sub])).toEqual([['RPT-HLT-014', 'Test & inspection report · rev A · Project manager']]);
    await approveDocumentStep('RPT-HLT-014', 'Romain Aubert');
    expect(await queue('pm')).not.toContain('doc:RPT-HLT-014');
  });
});
