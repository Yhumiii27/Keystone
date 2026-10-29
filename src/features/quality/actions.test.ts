// Quality Server Functions against an in-memory database (seeded Vigie NCR mirror, mock connector; Keystone's
// deliverables): the workspace and read-only gates, input validation, the NCR step rules (next step only, never Closed,
// one request at a time, not the client), the quality manager's verification, the outbox "pending sync with Vigie" (the
// status stays Vigie's), the deliverable producer steps and the client contact's acceptance / rejection, the issued
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
  advanceNcrAction, decideDeliverableAction, linkDeliverableDocumentAction, moveDeliverableAction, rejectDeliverableWithCommentsAction, verifyNcrAction,
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

  it('refuses outside viewers, read-only projects, the client on NCRs and producer steps, and malformed requests', async () => {
    const readOnly = { ok: false, error: 'Quality is read-only for you' };
    for (const role of ['depthead', 'member', 'procurement']) {
      as(role);
      expect(await advanceNcrAction({ projectCode: HLT, number: 'NCR-030', step: 'containment' })).toEqual(readOnly);
      expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-018', to: 'in_progress' })).toEqual(readOnly);
      expect(await decideDeliverableAction({ projectCode: HLT, number: 'D-014', decision: 'accepted' })).toEqual(readOnly);
    }
    // The PM and the client on a project that is not theirs (read-only project, 01 §5.2).
    as('pm');
    expect(await advanceNcrAction({ projectCode: 'NDC-031', number: 'NCR-041', step: 'root_cause' })).toEqual(readOnly);
    // R-042 (P-10a): another organisation's project is refused to the client (sent home), nothing written.
    as('client');
    await expect(decideDeliverableAction({ projectCode: 'NDC-031', number: 'D-110', decision: 'accepted' })).rejects.toThrow('NEXT_REDIRECT');
    const team = { ok: false, error: 'Only the project team records this progress' };
    expect(await advanceNcrAction({ projectCode: HLT, number: 'NCR-030', step: 'containment' })).toEqual(team);
    expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-018', to: 'in_progress' })).toEqual(team);
    expect(await linkDeliverableDocumentAction(HLT, 'D-018', { doc: 'X' })).toEqual({ error: 'Only the project team records this progress' });
    as('pm');
    const invalid = { ok: false, error: 'Invalid request' };
    expect(await advanceNcrAction({ projectCode: HLT, number: 'NCR-030', step: 'nope' })).toEqual(invalid);
    expect(await advanceNcrAction({ projectCode: HLT, number: '<b>', step: 'containment' })).toEqual(invalid);
    expect(await advanceNcrAction(null as never)).toEqual(invalid);
    expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-018', to: 'accepted' })).toEqual(invalid);
    expect(await decideDeliverableAction({ projectCode: HLT, number: 'D-014', decision: 'maybe' })).toEqual(invalid);
    expect(await advanceNcrAction({ projectCode: 'XXX-999', number: 'NCR-030', step: 'containment' })).toEqual({ ok: false, error: 'Unknown project' });
    expect(await advanceNcrAction({ projectCode: HLT, number: 'NCR-099', step: 'containment' })).toEqual({ ok: false, error: 'Unknown NCR' });
    expect(await moveDeliverableAction({ projectCode: HLT, number: 'D-099', to: 'in_progress' })).toEqual({ ok: false, error: 'Unknown deliverable' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('NCR step: the next step only, sent to Vigie ("pending sync"), one at a time; the status stays Vigie’s', async () => {
    as('pm');
    // R-157: each refusal says why.
    const gone = (error: string) => ({ ok: false, error });
    expect(await advanceNcrAction({ projectCode: HLT, number: 'NCR-030', step: 'root_cause' })).toEqual(gone('NCR-030 · This NCR has moved to another step'));
    expect(await advanceNcrAction({ projectCode: HLT, number: 'NCR-027', step: 'closed' })).toEqual(gone('NCR-027 · This NCR is closed in Vigie'));
    expect(await advanceNcrAction({ projectCode: HLT, number: 'NCR-026', step: 'verification' })).toEqual({
      ok: true, toast: 'NCR-026 · Verification requested · Pending sync with Vigie',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(await advanceNcrAction({ projectCode: HLT, number: 'ncr-026', step: 'verification' })).toEqual(gone('NCR-026 · A request on this NCR already waits for Vigie'));
    const n = (await getNcr(HLT, 'NCR-026'))!;
    expect([n.status, n.requestedStatus, n.pendingSyncLabel]).toEqual(['corrective_action', 'verification', 'Pending sync with Vigie']);
    expect(await lastAudit()).toMatchObject({ who: 'Romain Aubert', object: 'NCR-026', area: 'Quality' });
    as('englead', 'fr');
    expect(await advanceNcrAction({ projectCode: HLT, number: 'NCR-030', step: 'containment' })).toMatchObject({ ok: true, toast: 'NCR-030 · Containment requested · Pending sync with Vigie' });
    // Closing is never a step: in Verification only the quality manager decides.
    expect((await listNcrs(HLT)).length).toBe(5);
  });

  it('verification: quality only, on an NCR Vigie reports in Verification; inbox item, decision, then gone', async () => {
    // Vigie moves NCR-028 to Verification (a refresh of the mirror).
    const db = await getDb();
    const recs = prototypeNcrSnapshot(PROTO.HLT_NCRS as ProtoNcrRow[], Object.keys(PROTO_GEN.projectData)).map((r) =>
      r.projectCode === HLT && r.number === 'NCR-028' ? { ...r, status: 'verification' as const } : r,
    );
    await db.transaction((tx) => upsertNcrMirror(tx, recs, new Date()));
    expect((await inbox('quality', 'ncr')).map((i) => [i.id, i.sub, i.who, i.when, i.href, i.decision, i.external?.label])).toEqual([
      ['NCR-028', 'Minor · Fabien Bertrand', 'Hélène Sauvage', '7 Oct', '/projects/HLT-026/quality?ncr=NCR-028', { mode: 'ncr-verification', projectCode: HLT, number: 'NCR-028' }, 'Open in Vigie'],
    ]);
    expect(await inbox('pm', 'ncr')).toEqual([]);
    as('pm');
    expect(await advanceNcrAction({ projectCode: HLT, number: 'NCR-028', step: 'closed' })).toEqual({ ok: false, error: 'NCR-028 · In verification, only the quality manager decides' });
    expect(await verifyNcrAction({ projectCode: HLT, number: 'NCR-028', decision: 'approved' })).toEqual({ ok: false, error: 'Only the quality manager verifies and closes NCRs' });
    as('quality');
    expect(await verifyNcrAction({ projectCode: HLT, number: 'NCR-029', decision: 'approved' })).toEqual({ ok: false, error: 'NCR-029 · This NCR is not in verification' });
    expect(await verifyNcrAction({ projectCode: HLT, number: 'NCR-028', decision: 'yes' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await verifyNcrAction({ projectCode: HLT, number: 'NCR-028', decision: 'rejected' })).toEqual({
      ok: true, toast: 'NCR-028 · Back to corrective action requested · Pending sync with Vigie',
    });
    expect(await inbox('quality', 'ncr')).toEqual([]);
    expect((await getApprovalInbox(PERSONA_BY_ROLE.quality, { projectCode: HLT })).decided).toBeGreaterThanOrEqual(1);
    expect(await verifyNcrAction({ projectCode: HLT, number: 'NCR-028', decision: 'approved' })).toEqual({ ok: false, error: 'NCR-028 · A request on this NCR already waits for Vigie' });
    expect((await getNcr(HLT, 'NCR-028'))!.requestedStatus).toBe('corrective_action');
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

  it('client acceptance (PV) / rejection: the client contact only, from the register, the drawer dialog and My approvals', async () => {
    expect((await inbox('client', 'deliverable')).map((i) => [i.id, i.sub, i.decision])).toEqual([
      ['D-014', 'Test & inspection reports · Accept by 2 Oct', { mode: 'deliverable', projectCode: HLT, number: 'D-014' }],
      ['D-016', 'Calculation notes · Accept by 9 Oct', { mode: 'deliverable', projectCode: HLT, number: 'D-016' }],
      ['D-018', 'Certificates (CE, lifting…) · Accept by 5 Oct', { mode: 'deliverable', projectCode: HLT, number: 'D-018' }],
    ]);
    // R-157: each refusal says why.
    const refused = (error: string) => ({ ok: false, error });
    as('pm');
    expect(await decideDeliverableAction({ projectCode: HLT, number: 'D-014', decision: 'accepted' })).toEqual(refused('D-014 · Only a client contact of the project accepts or rejects this deliverable'));
    as('client');
    expect(await decideDeliverableAction({ projectCode: HLT, number: 'D-017', decision: 'accepted' })).toEqual(refused('D-017 · This deliverable is not submitted to the client'));
    expect(await decideDeliverableAction({ projectCode: HLT, number: 'D-014', decision: 'accepted' })).toEqual({ ok: true, toast: 'D-014 · Accepted' });
    expect(await getDeliverable(HLT, 'D-014')).toMatchObject({ status: 'accepted', acceptanceText: '25 Sep · N. Bensaïd' });
    expect(await decideDeliverableAction({ projectCode: HLT, number: 'D-014', decision: 'rejected' })).toEqual(refused('D-014 · The client has already accepted this deliverable'));
    as('client', 'fr');
    expect(await rejectDeliverableWithCommentsAction(HLT, 'D-016', { comments: 'Load case 4 missing' })).toEqual({ toast: 'D-016 · Refusé' });
    expect(await getDeliverable(HLT, 'D-016')).toMatchObject({ status: 'rejected', reviewComments: 'Load case 4 missing', acceptanceText: '25 Sep · comments issued' });
    expect(await rejectDeliverableWithCommentsAction(HLT, 'D-016', { comments: '' })).toEqual({ error: 'D-016 · Le client a déjà refusé ce livrable' });
    expect((await inbox('client', 'deliverable')).map((i) => i.id)).toEqual(['D-018']);
    expect((await getApprovalInbox(PERSONA_BY_ROLE.client, { projectCode: HLT })).decided).toBeGreaterThanOrEqual(2);
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
