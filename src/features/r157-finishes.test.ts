// R-157 finishes on pure rules: precise refusal texts of the Quality actions (instead of "not available any more"), and the
// French of the connector / import activity texts of Activity & integrations.
import { describe, expect, it } from 'vitest';
import { activityWhatT } from '@/features/admin/i18n';
import { makeT } from '@/i18n/translate';
import { deliverableRefusalText, ncrRefusalText } from '@/domain/quality';

describe('Quality refusals say why (R-157)', () => {
  it('NCR step and verification', () => {
    expect(ncrRefusalText({ number: 'NCR-027', status: 'closed', requestedStatus: null }, 'step')).toBe('NCR-027 · This NCR is closed in Vigie');
    expect(ncrRefusalText({ number: 'NCR-026', status: 'corrective_action', requestedStatus: 'verification' }, 'step')).toBe('NCR-026 · A request on this NCR already waits for Vigie');
    expect(ncrRefusalText({ number: 'NCR-028', status: 'verification', requestedStatus: null }, 'step')).toBe('NCR-028 · In verification, only the quality manager decides');
    expect(ncrRefusalText({ number: 'NCR-030', status: 'open', requestedStatus: null }, 'step')).toBe('NCR-030 · This NCR has moved to another step');
    expect(ncrRefusalText({ number: 'NCR-029', status: 'root_cause', requestedStatus: null }, 'verify')).toBe('NCR-029 · This NCR is not in verification');
  });

  it('deliverable step and client decision', () => {
    expect(deliverableRefusalText({ number: 'D-018', status: 'submitted' }, 'move')).toBe('D-018 · This deliverable is already with the client');
    expect(deliverableRefusalText({ number: 'D-018', status: 'planned' }, 'move')).toBe('D-018 · This deliverable has moved to another step');
    expect(deliverableRefusalText({ number: 'D-014', status: 'accepted' }, 'decide')).toBe('D-014 · The client has already accepted this deliverable');
    expect(deliverableRefusalText({ number: 'D-014', status: 'rejected' }, 'decide')).toBe('D-014 · The client has already rejected this deliverable');
    expect(deliverableRefusalText({ number: 'D-014', status: 'submitted' }, 'decide')).toBe('D-014 · Only a client contact of the project accepts or rejects this deliverable');
    expect(deliverableRefusalText({ number: 'D-016', status: 'in_progress' }, 'decide')).toBe('D-016 · This deliverable is not submitted to the client');
  });

  it('each reason has its French entry (the toast translates every "·" part)', () => {
    const t = makeT('fr');
    for (const s of [ncrRefusalText({ number: 'NCR-027', status: 'closed', requestedStatus: null }, 'step'), deliverableRefusalText({ number: 'D-018', status: 'submitted' }, 'move')])
      expect(s.split(' · ').map(t).join(' · ')).not.toBe(s);
  });
});

describe('connector activity texts in French (R-157)', () => {
  const t = makeT('fr');
  const fr = (what: string) => activityWhatT({ what }, t, 'fr');
  it('Cursus requests and staff directory, Sage X3 push, imports', () => {
    expect(fr('Travel request sent to Cursus · Thomas Kerbrat')).toBe('Demande de déplacement envoyée à Cursus · Thomas Kerbrat');
    expect(fr('Staff directory imported from Cursus · 3 matched · 1 created · 2 to check')).toBe('Annuaire du personnel importé de Cursus · 3 rapprochées · 1 créée · 2 à vérifier');
    expect(fr('Simulated push of PO-1082 to Sage X3 (not connected) · X3-PO-1082')).toBe('Envoi simulé de PO-1082 vers Sage X3 (non connecté) · X3-PO-1082');
    expect(fr('Imported P&ID tags · PID-HLT-001 rev B')).toBe('Repères P&ID importés · PID-HLT-001 rév. B');
    expect(fr('Imported data.xml')).toBe('Import de data.xml');
    expect(fr('MS Project XML · plan.xml imported into HLT-026 · 42 activities')).toBe('MS Project XML · plan.xml importé dans HLT-026 · 42 activités');
    // English stays as written.
    expect(activityWhatT({ what: 'Imported data.xml' }, makeT('en'), 'en')).toBe('Imported data.xml');
  });
});
