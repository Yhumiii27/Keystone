// D12 / D13: the rows of Vigie's publications checked and turned into mirror records (pure).
import { describe, expect, it } from 'vitest';
import { ecoRecordsOf, hseRecordsOf, ncrRecordsOf, parseNcrRow, parseRequestRow } from './vigie-views';

const NC = {
  project_code: 'HLT-026', number: 'EV-2026-130', vigie_ref: 'EV-2026-130', title: 'Weld porosity', severity: 'major', source: 'design', status: 'root_cause',
  activity_code: 'A1250', part_ref: null, deliverable_number: null, supplier_id: '0b6f3c8e-1a2b-4c3d-9e8f-0123456789ab', supplier_name: 'Acme', raised_by_name: 'Anonyme',
  raised_on: '2026-10-30', owner_name: 'Léa Moreau', owner_matricule: 'EMP-0018', root_cause: '', action: 'Lot bloqué', due_on: '2026-11-15', cost_keur: 2.5,
  iso_clause: '8.7', closed_on: null, vigie_updated_at: '2026-11-06T10:00:00+01:00',
};

describe('vigie.pub_non_conformites (D13)', () => {
  it('a row becomes an NCR record (EV-… number, share columns)', () => {
    expect(parseNcrRow(NC)).toEqual({
      projectCode: 'HLT-026', number: 'EV-2026-130', vigieRef: 'EV-2026-130', title: 'Weld porosity', severity: 'major', source: 'design', status: 'root_cause',
      activityCode: 'A1250', partRef: null, deliverableNumber: null, supplierName: 'Acme', inspectionNumber: null, raisedBy: 'Anonyme', raisedOn: '2026-10-30',
      owner: 'Léa Moreau', rootCause: '', action: 'Lot bloqué', dueOn: '2026-11-15', costKeur: 2.5, isoClause: '8.7', updatedAt: '2026-11-06T09:00:00.000Z',
      closedOn: null, supplierId: '0b6f3c8e-1a2b-4c3d-9e8f-0123456789ab', ownerMatricule: 'EMP-0018',
    });
  });

  it('malformed rows are skipped and counted; a duplicate number counts once', () => {
    const r = ncrRecordsOf([NC, { ...NC, number: 'NCR-029' }, { ...NC, status: 'reopened' }, { ...NC, severity: 'huge' }, { ...NC, project_code: null }, { ...NC, title: 'Last read wins' }]);
    expect(r.records.map((x) => x.title)).toEqual(['Last read wins']);
    expect(r.skipped).toBe(5);
    expect(parseNcrRow({ ...NC, supplier_id: 'not-a-uuid' })!.supplierId).toBeNull();
  });
});

describe('vigie.pub_hse_projet (D13)', () => {
  it('ordered by project then position; malformed rows skipped', () => {
    const rows = [
      { project_code: 'HLT-026', vigie_ref: null, kind: 'register', title: 'Registre', status: 'recorded', status_text: '2 déclarés', date_on: null, position: 2 },
      { project_code: 'HLT-026', vigie_ref: 'PP-1', kind: 'prevention_plan', title: 'Plan', status: 'signed', status_text: null, date_on: '2026-09-01', position: 0 },
      { project_code: 'HLT-026', vigie_ref: 'PF-1', kind: 'permit', title: 'Permis', status: 'unknown', status_text: null, date_on: null, position: 1 },
    ];
    const r = hseRecordsOf(rows);
    expect(r.records.map((x) => [x.kind, x.statusText])).toEqual([['prevention_plan', null], ['register', '2 déclarés']]);
    expect(r.skipped).toBe(1);
  });
});

describe('vigie.pub_ordres_modification + approvals + effectivity (D12)', () => {
  it('joined by ECO number, effectivity in Vigie’s order, release date kept', () => {
    const r = ecoRecordsOf({
      orders: [
        { number: 'ECO-2026-015', title: 'Bolt grade', eco_type: 'rev', status: 'in_approval', interchangeability: 'yes', from_revision: 'B', to_revision: 'C', cost_eur: '1250.50',
          schedule_days: 3, stock_impact: '', document_refs: ['DWG-1'], requested_by_name: 'Antoine Girard', raised_on: '2026-09-02', pending_dispositions: 1, locked: false,
          parts: ['PRT-1'], projects: ['HLT-026'], released_at: null, vigie_updated_at: null },
        { number: 'BAD', title: 'x', eco_type: 'rev', status: 'draft', raised_on: '2026-09-02' },
      ],
      approvals: [
        { eco_number: 'ECO-2026-015', approval_key: 'pm', decision: 'pending', approver_text: 'R. Aubert', decided_by_name: null, decided_at: null },
        { eco_number: 'ECO-2026-015', approval_key: 'englead', decision: 'ok', approver_text: 'Antoine Girard', decided_by_name: 'Antoine Girard', decided_at: '2026-09-03T08:00:00Z' },
      ],
      effectivity: [
        { eco_number: 'ECO-2026-015', target_type: 'machine', target_ref: 'MCH-029', label: 'Crane', disposition: null, is_automatic: true, note: null, fitted_part_ref: null, fitted_revision: null, position: 1 },
        { eco_number: 'ECO-2026-015', target_type: 'project', target_ref: 'HLT-026', label: 'Harbor Line', disposition: 'update', is_automatic: false, note: null, fitted_part_ref: null, fitted_revision: null, position: 0 },
      ],
    });
    expect(r.skipped).toBe(1);
    expect(r.records).toHaveLength(1);
    const [e] = r.records;
    expect([e.costEur, e.approvals.map((a) => a.key), e.effectivity.map((t) => t.targetRef), e.releasedAt]).toEqual([1250.5, ['englead', 'pm'], ['HLT-026', 'MCH-029'], null]);
  });
});

describe('vigie.pub_demandes_recues (D13 CV-08)', () => {
  it('the state of a request', () => {
    expect(parseRequestRow({ id: 12, id_externe: 'k-1', statut: 'rejected', code_resultat: 'stale', resultat: 'État changé', traite_le: '2026-11-06T10:00:00Z' }))
      .toEqual({ id: '12', externalId: 'k-1', outcome: 'rejected', resultCode: 'stale', result: 'État changé', processedAt: '2026-11-06T10:00:00.000Z' });
    expect(parseRequestRow({ id: 12, id_externe: 'k-1', statut: 'done' })).toBeNull();
  });
});
