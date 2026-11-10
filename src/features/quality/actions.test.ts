// Quality Server Functions against an in-memory database (seeded Vigie NCR mirror, mock connector; Keystone's
// deliverables): the workspace and read-only gates, input validation, the NCR step rules (next step only, never Closed,
// one request at a time), the quality manager's verification, the outbox "pending sync with Vigie" (the status stays
// Vigie's), the deliverable producer steps and the client's acceptance / rejection recorded by the project's lead (D9-06), the issued
// Codex document, the viewer as the actor, and the My approvals NCR verification / deliverable acceptance kinds before
// and after a decision. The session is mocked.
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
import { getApprovalInbox } from '@/server/approvals';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listAudit } from '@/server/dal/notifications';
import { getDeliverable, getNcr, listNcrs } from '@/server/dal/quality';
import { prototypeNcrSnapshot, type ProtoNcrRow } from '@/server/integrations/vigie/prototype-snapshot';
import { upsertNcrMirror } from '@/server/integrations/vigie/quality-mirror';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import {
  advanceNcrAction, linkDeliverableDocumentAction, moveDeliverableAction, recordClientDecisionAction, verifyNcrAction,
} from './actions';

const HLT = 'HLT-026';
const as = (role: string, lang: 'en' | 'fr' = 'en') => {
  session.role = role;
  session.lang = lang;
};
const inbox = async (role: keyof typeof PERSONA_BY_ROLE, kind: string) =>
  (await getApprovalInbox(PERSONA_BY_ROLE[role], { projectCode: HLT })).items.filter((i) => i.kind === kind);
const lastAudit = async () => (await listAudit({ limit: 1 }))[0];

describe('Quality Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    as('director');
    vi.mocked(revalidatePath).mockClear();
  });

  it('refuses outside viewers, read-only projects and malformed requests', async () => {
    const readOnly = { ok: false, error: 'Quality is read-only for you' };
    for (const role of ['depthead', 'member', 'procurement']) {
      as(role);
      expect(await advanceNcrAction({ projectCode: HLT, number: 'EV-2026-030', step: 'containment' })).toEqual(readOnly);
      expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-018', to: 'in_progress' })).toEqual(readOnly);
      expect(await recordClientDecisionAction(HLT, 'D-014', 'accepted', { on: '2026-09-25', reference: 'PV-1' })).toEqual({ error: readOnly.error });
    }
    // The PM on a project that is not theirs (read-only project, 01 §5.2).
    as('pm');
    expect(await advanceNcrAction({ projectCode: 'NDC-031', number: 'EV-2026-041', step: 'root_cause' })).toEqual(readOnly);
    expect(await recordClientDecisionAction('NDC-031', 'D-110', 'accepted', { on: '2026-09-25', reference: 'PV-1' })).toEqual({ error: readOnly.error });
    const invalid = { ok: false, error: 'Invalid request' };
    expect(await advanceNcrAction({ projectCode: HLT, number: 'EV-2026-030', step: 'nope' })).toEqual(invalid);
    expect(await advanceNcrAction({ projectCode: HLT, number: '<b>', step: 'containment' })).toEqual(invalid);
    expect(await advanceNcrAction(null as never)).toEqual(invalid);
    expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-018', to: 'accepted' })).toEqual(invalid);
    expect(await recordClientDecisionAction(HLT, 'D-014', 'maybe', { on: '2026-09-25', reference: 'PV-1' })).toEqual({ error: invalid.error });
    expect(await advanceNcrAction({ projectCode: 'XXX-999', number: 'EV-2026-030', step: 'containment' })).toEqual({ ok: false, error: 'Unknown project' });
    expect(await advanceNcrAction({ projectCode: HLT, number: 'EV-2026-099', step: 'containment' })).toEqual({ ok: false, error: 'Unknown NCR' });
    expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-099', to: 'in_progress' })).toEqual({ ok: false, error: 'Unknown deliverable' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('NCR step: the next step only, sent to Vigie ("pending sync"), one at a time; the status stays Vigie’s', async () => {
    as('pm');
    // R-157: each refusal says why.
    const gone = (error: string) => ({ ok: false, error });
    expect(await advanceNcrAction({ projectCode: HLT, number: 'EV-2026-029', step: 'verification' })).toEqual(gone('EV-2026-029 · This NCR has moved to another step'));
    // D13: Containment (the qualification) is decided in Vigie.
    expect(await advanceNcrAction({ projectCode: HLT, number: 'EV-2026-030', step: 'containment' })).toEqual(gone('EV-2026-030 · Containment is decided in Vigie'));
    expect(await advanceNcrAction({ projectCode: HLT, number: 'EV-2026-027', step: 'closed' })).toEqual(gone('EV-2026-027 · This NCR is closed in Vigie'));
    expect(await advanceNcrAction({ projectCode: HLT, number: 'EV-2026-026', step: 'verification' })).toEqual({
      ok: true, toast: 'EV-2026-026 · Verification requested · Pending sync with Vigie',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(await advanceNcrAction({ projectCode: HLT, number: 'ev-2026-026', step: 'verification' })).toEqual(gone('EV-2026-026 · A request on this NCR already waits for Vigie'));
    const n = (await getNcr(HLT, 'EV-2026-026'))!;
    expect([n.status, n.requestedStatus, n.pendingSyncLabel]).toEqual(['corrective_action', 'verification', 'Pending sync with Vigie']);
    expect(await lastAudit()).toMatchObject({ who: 'Romain Aubert', object: 'EV-2026-026', area: 'Quality' });
    as('englead', 'fr');
    expect(await advanceNcrAction({ projectCode: HLT, number: 'EV-2026-029', step: 'corrective_action' })).toMatchObject({ ok: true, toast: 'EV-2026-029 · Corrective action requested · Pending sync with Vigie' });
    // Closing is never a step: in Verification only the quality manager decides.
    expect((await listNcrs(HLT)).length).toBe(5);
  });

  it('verification: quality only, on an NCR Vigie reports in Verification; inbox item, decision, then gone', async () => {
    // Vigie moves EV-2026-028 to Verification (a refresh of the mirror).
    const db = await getDb();
    const recs = prototypeNcrSnapshot(PROTO.HLT_NCRS as ProtoNcrRow[], Object.keys(PROTO_GEN.projectData)).map((r) =>
      r.projectCode === HLT && r.number === 'EV-2026-028' ? { ...r, status: 'verification' as const } : r,
    );
    await db.transaction((tx) => upsertNcrMirror(tx, recs, new Date()));
    expect((await inbox('quality', 'ncr')).map((i) => [i.id, i.sub, i.who, i.when, i.href, i.decision, i.external?.label])).toEqual([
      ['EV-2026-028', 'Minor · Fabien Bertrand', 'Hélène Sauvage', '7 Oct', '/projects/HLT-026/quality?ncr=EV-2026-028', { mode: 'ncr-verification', projectCode: HLT, number: 'EV-2026-028' }, 'Open in Vigie'],
    ]);
    expect(await inbox('pm', 'ncr')).toEqual([]);
    as('pm');
    expect(await advanceNcrAction({ projectCode: HLT, number: 'EV-2026-028', step: 'closed' })).toEqual({ ok: false, error: 'EV-2026-028 · In verification, only the quality manager decides' });
    expect(await verifyNcrAction({ projectCode: HLT, number: 'EV-2026-028', decision: 'approved' })).toEqual({ ok: false, error: 'Only the quality manager verifies and closes NCRs' });
    as('quality');
    expect(await verifyNcrAction({ projectCode: HLT, number: 'EV-2026-030', decision: 'approved' })).toEqual({ ok: false, error: 'EV-2026-030 · This NCR is not in verification' });
    expect(await verifyNcrAction({ projectCode: HLT, number: 'EV-2026-028', decision: 'yes' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await verifyNcrAction({ projectCode: HLT, number: 'EV-2026-028', decision: 'rejected' })).toEqual({
      ok: true, toast: 'EV-2026-028 · Back to corrective action requested · Pending sync with Vigie',
    });
    expect(await inbox('quality', 'ncr')).toEqual([]);
    expect((await getApprovalInbox(PERSONA_BY_ROLE.quality, { projectCode: HLT })).decided).toBeGreaterThanOrEqual(1);
    expect(await verifyNcrAction({ projectCode: HLT, number: 'EV-2026-028', decision: 'approved' })).toEqual({ ok: false, error: 'EV-2026-028 · A request on this NCR already waits for Vigie' });
    expect((await getNcr(HLT, 'EV-2026-028'))!.requestedStatus).toBe('corrective_action');
  });

  it('deliverables: Start → To internal review → Submit to client by the team; wrong or repeated steps refused', async () => {
    as('pm');
    expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-018', to: 'submitted' })).toEqual({ ok: false, error: 'D-018 · This deliverable has moved to another step' });
    expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-018', to: 'in_progress' })).toEqual({ ok: true, toast: 'D-018 · In progress' });
    as('englead');
    expect(await moveDeliverableAction({ projectCode: HLT, number: 'd-018', to: 'internal_review' })).toEqual({ ok: true, toast: 'D-018 · Internal review' });
    as('quality');
    expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-018', to: 'submitted' })).toEqual({ ok: true, toast: 'D-018 · Submitted' });
    expect(await getDeliverable(HLT, 'D-018')).toMatchObject({ status: 'submitted', acceptanceText: 'Accept by 5 Oct' });
    expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-018', to: 'submitted' })).toEqual({ ok: false, error: 'D-018 · This deliverable is already with the client' });
    expect(await lastAudit()).toMatchObject({ who: 'Gabriel Comte', object: 'D-018', change: 'status: Internal review → Submitted', area: 'Deliverables' });
  });

  it('client acceptance (PV) / rejection: recorded by the project\'s lead from the signed document (D9-06), listed in My approvals', async () => {
    // D9-06 (owner, 10 Nov 2026): clients never see Keystone — the PM records "accepted by the client on … (signed document)";
    // the My approvals rows open the deliverable drawer (no inline decision).
    expect((await inbox('pm', 'deliverable')).map((i) => [i.id, i.sub, i.decision])).toEqual([
      ['D-014', 'Test & inspection reports · Accept by 2 Oct', null],
      ['D-016', 'Calculation notes · Accept by 9 Oct', null],
      ['D-018', 'Certificates (CE, lifting…) · Accept by 5 Oct', null],
    ]);
    // R-157: each refusal says why.
    as('quality');
    expect(await recordClientDecisionAction(HLT, 'D-014', 'accepted', { on: '2026-09-25', reference: 'PV-HLT-014' }))
      .toEqual({ error: 'D-014 · Only the project manager records the client’s decision on this deliverable' });
    as('pm');
    expect(await recordClientDecisionAction(HLT, 'D-017', 'accepted', { on: '2026-09-25', reference: 'PV-HLT-017' })).toEqual({ error: 'D-017 · This deliverable is not submitted to the client' });
    expect(await recordClientDecisionAction(HLT, 'D-014', 'accepted', { on: '2026-09-25', reference: '' })).toEqual({ error: 'Enter the reference of the signed acceptance (PV)' });
    expect(await recordClientDecisionAction(HLT, 'D-014', 'accepted', { on: '2026-12-01', reference: 'PV-HLT-014' })).toEqual({ error: 'The client’s decision cannot be after the status date' });
    expect(await recordClientDecisionAction(HLT, 'D-014', 'accepted', { on: '', reference: 'PV-HLT-014' })).toEqual({ error: 'Enter the date of the client’s decision' });
    expect(await recordClientDecisionAction(HLT, 'D-014', 'accepted', { on: '2026-09-24', reference: 'PV-HLT-014' })).toEqual({ toast: 'D-014 · Client acceptance recorded' });
    expect(await getDeliverable(HLT, 'D-014')).toMatchObject({ status: 'accepted', acceptanceText: '24 Sep · PV-HLT-014', acceptanceRef: 'PV-HLT-014' });
    expect(await lastAudit()).toMatchObject({ who: 'Romain Aubert', object: 'D-014', change: 'status: Submitted → Accepted (PV) · client decision of 2026-09-24 · PV-HLT-014' });
    expect(await recordClientDecisionAction(HLT, 'D-014', 'rejected', { on: '2026-09-25' })).toEqual({ error: 'D-014 · The client has already accepted this deliverable' });
    as('pm', 'fr');
    expect(await recordClientDecisionAction(HLT, 'D-016', 'rejected', { on: '2026-09-25', reference: '', comments: 'Load case 4 missing' })).toEqual({ toast: 'D-016 · Refus du client enregistré' });
    expect(await getDeliverable(HLT, 'D-016')).toMatchObject({ status: 'rejected', reviewComments: 'Load case 4 missing', acceptanceText: '25 Sep · comments issued' });
    expect((await inbox('pm', 'deliverable')).map((i) => i.id)).toEqual(['D-018']);
    expect((await getApprovalInbox(PERSONA_BY_ROLE.pm, { projectCode: HLT })).decided).toBeGreaterThanOrEqual(2);
  });

  it('issued document: a Codex record of the project, linked by the team', async () => {
    as('pm');
    const { listVaultDocuments } = await import('@/server/dal/documents');
    const doc = (await listVaultDocuments()).find((d) => d.project === HLT)!;
    expect(await linkDeliverableDocumentAction(HLT, 'D-019', { doc: doc.number })).toEqual({ toast: `D-019 · ${doc.number} · Issued document linked` });
    expect((await getDeliverable(HLT, 'D-019'))!.documentNumber).toBe(doc.number);
    expect(await linkDeliverableDocumentAction(HLT, 'D-019', { doc: 'NOPE-0000' })).toEqual({ error: 'The change could not be saved' });
    expect(await linkDeliverableDocumentAction(HLT, 'D-019', {} as never)).toEqual({ error: 'Invalid request' });
  });
});
