// R-187 (Arche K-02, K-03, K-10): the pure rules of the subsidiaries' machine needs — Arche's rows checked, the answer validated
// (nature, qualification, reason, estimate class and computed range, firm offer = E10), the status moves, the numbering, the most
// recent answer, the default amount from the catalogue and the equipment line a need gives.
import { describe, expect, it } from 'vitest';
import {
  answerNeedBlocker, answerTransitionBlocker, canAnswerCapexNeeds, canReadCapexNeeds, defaultNeedAmount, latestAnswerOf, needEquipmentLine, needProjectName,
  nextAnswerNumber, orderActionBlocker, parseCapexRow, parseNeedAnswer, parseNeedRow, sendBlocker, type NeedCatalogueEntry,
} from './capex-needs';
import { PERSONAS } from '@/config/personas';

const TODAY = '2026-09-25';

const NEED_ROW = {
  besoin_ref: 'CPX-SAI-2026-01/B03', capex_code: 'CPX-SAI-2026-01', ligne: 'B03', catalogue_code: 'EMP-40T', catalogue_version: 1, libelle_libre: null,
  quantite: 2, options: ['TELE'], capacite_visee: '40', unite_capacite: 't', date_besoin: '2027-06-01', site: 'Thiès site', statut: 'ordered', commentaire: null,
  soumis_le: '2026-06-01T08:00:00Z', commande_le: '2026-07-08', maj_le: '2026-07-08T15:00:00Z', colonne_future: 'ignored',
};

const EMP: NeedCatalogueEntry = {
  code: 'EMP-40T', version: 1, machineTypeCode: 'EMP', label: 'Portique de manutention 40 t', nominalCapacity: 40, capacityUnit: 't', indicativePriceKeur: 4200,
  options: [{ code: 'TELE', libelle: 'Télécommande radio', prix_indicatif_keur: 18 }, { code: 'ANTI-COL', libelle: 'Anticollision laser', prix_indicatif_keur: 45 }],
};

describe("Arche's rows (pub_capex, pub_besoins_machines)", () => {
  it('a need row is checked and typed; a new column at the end of the view is ignored', () => {
    expect(parseNeedRow(NEED_ROW)).toEqual({
      needRef: 'CPX-SAI-2026-01/B03', capexCode: 'CPX-SAI-2026-01', line: 'B03', catalogueCode: 'EMP-40T', catalogueVersion: 1, freeLabel: null, quantity: 2,
      options: ['TELE'], targetCapacity: 40, capacityUnit: 't', neededOn: '2027-06-01', site: 'Thiès site', status: 'ordered', comment: null,
      submittedAt: '2026-06-01T08:00:00.000Z', orderedOn: '2026-07-08', sourceUpdatedAt: '2026-07-08T15:00:00.000Z',
    });
  });

  it('a malformed need is skipped: key, CAPEX of another need, quantity, status (drafts are never published)', () => {
    expect(parseNeedRow({ ...NEED_ROW, besoin_ref: 'B03' })).toBeNull();
    expect(parseNeedRow({ ...NEED_ROW, capex_code: 'CPX-APM-2026-01' })).toBeNull();
    expect(parseNeedRow({ ...NEED_ROW, quantite: 0 })).toBeNull();
    expect(parseNeedRow({ ...NEED_ROW, quantite: 2.5 })).toBeNull();
    expect(parseNeedRow({ ...NEED_ROW, statut: 'draft' })).toBeNull();
  });

  it('a catalogue code without version is a free need; options accept codes or {code} objects', () => {
    const n = parseNeedRow({ ...NEED_ROW, catalogue_version: null, options: [{ code: 'GEN' }, 'GEN', ''] });
    expect([n?.catalogueCode, n?.catalogueVersion, n?.options]).toEqual([null, null, ['GEN']]);
  });

  it('a CAPEX row keeps its sheet, not the e-mails; a malformed code is skipped', () => {
    const c = parseCapexRow({ code: 'CPX-APM-2026-01', filiale: 'Atlas Process Maroc', intitule: 'Second extrusion line', g1_le: '2026-05-12', sponsor_email: 'k@x.example', maj_le: '2026-09-18T08:30:00Z' });
    expect(c).toMatchObject({ code: 'CPX-APM-2026-01', subsidiaryName: 'Atlas Process Maroc', title: 'Second extrusion line', g1On: '2026-05-12', g2On: null });
    expect(JSON.stringify(c)).not.toContain('k@x.example');
    expect(parseCapexRow({ code: 'APM-1' })).toBeNull();
  });
});

describe('answers (K-02, K-03)', () => {
  it('a priced answer: the range comes from the class (E50 ±50 %, E30 ±30 %, E10 −5 / +10 %), never typed', () => {
    expect(parseNeedAnswer({ nature: 'indicatif', estimateClass: 'E50', centralKeur: '4 218', lowKeur: '1', highKeur: '2' }, TODAY)).toEqual({
      ok: true,
      value: {
        nature: 'indicatif', qualification: 'faisable', reason: null, estimateClass: 'E50', centralKeur: 4218, lowKeur: 2109, highKeur: 6327, leadTimeWeeks: null,
        validUntil: null, documentRef: null,
      },
    });
    const devis = parseNeedAnswer({ nature: 'devis', qualification: 'faisable', estimateClass: 'E30', centralKeur: '4150', leadTimeWeeks: '50', validUntil: '2027-01-31', documentRef: 'DEV-CPX-APM-2026-01-001' }, TODAY);
    expect(devis.ok && [devis.value.lowKeur, devis.value.highKeur]).toEqual([2905, 5395]);
    const firm = parseNeedAnswer({ nature: 'offre_ferme', estimateClass: 'E10', centralKeur: '1945' }, TODAY);
    expect(firm.ok && [firm.value.lowKeur, firm.value.highKeur]).toEqual([1847.8, 2139.5]);
  });

  it('K-03: a firm offer is E10; a priced answer needs a class and a central amount', () => {
    expect(parseNeedAnswer({ nature: 'offre_ferme', estimateClass: 'E30', centralKeur: '100' }, TODAY)).toEqual({ ok: false, error: 'A firm offer requires estimate class E10 (+10 % / −5 %)' });
    expect(parseNeedAnswer({ nature: 'devis', estimateClass: '', centralKeur: '100' }, TODAY)).toEqual({ ok: false, error: 'A priced answer needs an estimate class' });
    expect(parseNeedAnswer({ nature: 'devis', estimateClass: 'E30', centralKeur: '' }, TODAY)).toEqual({ ok: false, error: 'Enter the central amount in k€' });
    expect(parseNeedAnswer({ nature: 'devis', estimateClass: 'E30', centralKeur: '-3' }, TODAY)).toEqual({ ok: false, error: 'Enter the central amount in k€' });
    expect(parseNeedAnswer({ nature: 'devis', estimateClass: 'E99', centralKeur: '3' }, TODAY)).toEqual({ ok: false, error: 'Unknown estimate class' });
  });

  it('a qualification carries neither amount nor class; "to be studied" and "declined" need their reason', () => {
    expect(parseNeedAnswer({ nature: 'qualification', qualification: 'faisable' }, TODAY)).toMatchObject({ ok: true, value: { estimateClass: null, centralKeur: null } });
    expect(parseNeedAnswer({ nature: 'qualification', qualification: 'faisable', centralKeur: '10' }, TODAY)).toEqual({ ok: false, error: 'A qualification carries no amount nor estimate class' });
    expect(parseNeedAnswer({ nature: 'qualification', qualification: 'refuse' }, TODAY)).toEqual({ ok: false, error: 'Give the reason of the qualification' });
    expect(parseNeedAnswer({ nature: 'qualification', qualification: 'a_etudier', reason: ' Variante à étudier ' }, TODAY)).toMatchObject({ ok: true, value: { reason: 'Variante à étudier' } });
    expect(parseNeedAnswer({ nature: 'qualification' }, TODAY)).toEqual({ ok: false, error: 'Choose the qualification of the need' });
    expect(parseNeedAnswer({ nature: 'devis', qualification: 'refuse', reason: 'x', estimateClass: 'E30', centralKeur: '1' }, TODAY)).toEqual({ ok: false, error: 'A declined need is answered with a qualification, without price' });
    expect(parseNeedAnswer({ nature: 'offre_ferme', qualification: 'a_etudier', reason: 'x', estimateClass: 'E10', centralKeur: '1' }, TODAY)).toEqual({ ok: false, error: 'A firm offer answers a feasible need' });
  });

  it('nature, lead time, validity and Codex reference are checked', () => {
    expect(parseNeedAnswer({ nature: 'gift' }, TODAY)).toEqual({ ok: false, error: 'Choose the nature of the answer' });
    expect(parseNeedAnswer({ nature: 'devis', estimateClass: 'E30', centralKeur: '1', leadTimeWeeks: '2.5' }, TODAY)).toEqual({ ok: false, error: 'The lead time is a whole number of weeks from 1 to 520' });
    expect(parseNeedAnswer({ nature: 'devis', estimateClass: 'E30', centralKeur: '1', validUntil: '31/01/2027' }, TODAY)).toEqual({ ok: false, error: 'The validity date is a date YYYY-MM-DD' });
    expect(parseNeedAnswer({ nature: 'devis', estimateClass: 'E30', centralKeur: '1', validUntil: '2026-09-24' }, TODAY)).toEqual({ ok: false, error: 'The validity date is in the past' });
    expect(parseNeedAnswer({ nature: 'devis', estimateClass: 'E30', centralKeur: '1', documentRef: 'devis du 3 mai' }, TODAY)).toEqual({ ok: false, error: 'The Codex reference is a document number like OFF-CPX-SAI-2026-01-003' });
  });

  it('sending: a quote or a firm offer names its Codex document; a firm offer has its validity and lead time', () => {
    expect(sendBlocker({ nature: 'indicatif', documentRef: null, validUntil: null, leadTimeWeeks: null })).toBeNull();
    expect(sendBlocker({ nature: 'devis', documentRef: null, validUntil: null, leadTimeWeeks: null })).toBe('A quote or a firm offer is sent with its Codex document reference');
    expect(sendBlocker({ nature: 'offre_ferme', documentRef: 'OFF-1', validUntil: null, leadTimeWeeks: 40 })).toBe('A firm offer is sent with its validity date and lead time');
    expect(sendBlocker({ nature: 'offre_ferme', documentRef: 'OFF-1', validUntil: '2026-12-31', leadTimeWeeks: 40 })).toBeNull();
  });

  it('status moves: in preparation → sent / lapsed; sent → accepted (quote, firm offer) / lapsed; accepted and lapsed are final', () => {
    const a = { nature: 'devis' as const, documentRef: 'DEV-1', validUntil: null, leadTimeWeeks: null };
    expect(answerTransitionBlocker({ ...a, status: 'en_cours' }, 'remise')).toBeNull();
    expect(answerTransitionBlocker({ ...a, status: 'en_cours' }, 'caduque')).toBeNull();
    expect(answerTransitionBlocker({ ...a, status: 'en_cours' }, 'acceptee')).toBe('Send the answer first');
    expect(answerTransitionBlocker({ ...a, status: 'remise' }, 'acceptee')).toBeNull();
    expect(answerTransitionBlocker({ ...a, nature: 'indicatif', status: 'remise' }, 'acceptee')).toBe('Only a quote or a firm offer is accepted');
    expect(answerTransitionBlocker({ ...a, status: 'remise' }, 'en_cours')).toBe('Invalid status change');
    expect(answerTransitionBlocker({ ...a, status: 'acceptee' }, 'caduque')).toBe('This answer is closed: record a new answer');
    expect(answerTransitionBlocker({ ...a, status: 'remise' }, 'remise')).toBe('Invalid status change');
  });

  it('numbering "RB-001", never reused; the most recent answer of each need is authoritative', () => {
    expect([nextAnswerNumber([]), nextAnswerNumber(['RB-001', 'RB-009', 'X-4'])]).toEqual(['RB-001', 'RB-010']);
    const latest = latestAnswerOf([
      { needRef: 'A/B01', answeredAt: '2026-09-10T09:00:00.000Z', number: 'RB-004' },
      { needRef: 'A/B01', answeredAt: '2026-09-24T09:00:00.000Z', number: 'RB-005' },
      { needRef: 'A/B02', answeredAt: '2026-09-24T09:00:00.000Z', number: 'RB-002' },
      { needRef: 'A/B02', answeredAt: '2026-09-24T09:00:00.000Z', number: 'RB-003' },
    ]);
    expect([latest.get('A/B01')?.number, latest.get('A/B02')?.number]).toEqual(['RB-005', 'RB-003']);
  });
});

describe('catalogue and order (K-10)', () => {
  const need = parseNeedRow(NEED_ROW)!;

  it('default central amount: (catalogue price + chosen options) × quantity; none without catalogue price', () => {
    expect(defaultNeedAmount(need, EMP)).toBe(8436);
    expect(defaultNeedAmount({ quantity: 1, options: ['NOPE'] }, EMP)).toBe(4200);
    expect(defaultNeedAmount(need, null)).toBeNull();
    expect(defaultNeedAmount(need, { ...EMP, indicativePriceKeur: null })).toBeNull();
  });

  it('the equipment line of a need: type of the catalogue version, quantity, options with their label, capacity, need and catalogue references', () => {
    expect(needEquipmentLine(need, EMP)).toEqual({
      machineTypeCode: 'EMP', quantity: 2, label: null, capacityValue: 40, capacityUnit: 't', options: ['TELE · Télécommande radio'], besoinRef: 'CPX-SAI-2026-01/B03',
      catalogueCode: 'EMP-40T', catalogueVersion: 1,
    });
  });

  it('a free need takes the type the director chose and its label; a capacity without unit is dropped', () => {
    const free = { ...need, catalogueCode: null, catalogueVersion: null, freeLabel: 'Ligne de refroidissement', options: ['X'], capacityUnit: null };
    expect(needEquipmentLine(free, null)).toBeNull();
    expect(needEquipmentLine(free, null, 'AUTRE')).toMatchObject({ machineTypeCode: 'AUTRE', label: 'Ligne de refroidissement', capacityValue: null, capacityUnit: null, options: ['X'], catalogueCode: null });
  });

  it('a project is created (or a line added) only for an ordered need not yet delivered; an answer for a need not withdrawn', () => {
    expect(orderActionBlocker(need, null)).toBeNull();
    expect(orderActionBlocker({ status: 'submitted' }, null)).toBe('The need is not ordered yet: the project is created at the order (G2 of the CAPEX)');
    expect(orderActionBlocker(need, 'RCF-019')).toBe('This need is already delivered by a project · RCF-019');
    expect(orderActionBlocker(null, null)).toBe('Unknown machine need');
    expect([answerNeedBlocker(need), answerNeedBlocker({ status: 'withdrawn' }), answerNeedBlocker(null)]).toEqual([null, 'The subsidiary withdrew this need', 'Unknown machine need']);
    expect(needProjectName('New tomato processing plant', 'Portique de manutention 40 t')).toBe('New tomato processing plant — Portique de manutention 40 t');
  });

  it('rights: the director and the project managers read, the director answers; never the client', () => {
    expect(PERSONAS.filter((p) => canReadCapexNeeds(p.role)).map((p) => p.role)).toEqual(['director', 'pm']);
    expect(PERSONAS.filter((p) => canAnswerCapexNeeds(p.role)).map((p) => p.role)).toEqual(['director']);
  });
});
