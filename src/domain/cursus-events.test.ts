// R-029 (NEW-CURSUS-7 "a"): the envelope of the events Cursus pushes — Cursus's { id, type, emis_le, donnees } (Cursus
// docs/API-KEYSTONE.md, authoritative) and Keystone's earlier { …, data } — and the known types: validation, replacement keys,
// the minimised absence (R-031 / R-173: Leave or Absence, never the reason) and its cancellation, the travel-request decision,
// unknown types accepted without their data, and the 13-month retention cutoff.
import { describe, expect, it } from 'vitest';
import { CURSUS_EVENT_RETENTION_MONTHS, MAX_CURSUS_EVENT_BYTES, cursusEventsCutoff, parseCursusEvent, sameObjectTypes } from './cursus-events';

const env = (type: string, data: unknown, extra: Record<string, unknown> = {}) => ({ id: 'evt-0001', type, emis_le: '2026-10-05T08:30:00Z', data, ...extra });

describe('envelope', () => {
  it('needs an id, a type and an ISO timestamp; refuses anything else with a reason', () => {
    expect(parseCursusEvent(null)).toMatchObject({ ok: false });
    expect(parseCursusEvent('x')).toMatchObject({ ok: false });
    expect(parseCursusEvent({ type: 'heures.validees', emis_le: '2026-10-05T08:30:00Z' })).toMatchObject({ ok: false, error: expect.stringMatching(/^Invalid event · id/) });
    expect(parseCursusEvent(env('heures.validees', {}, { emis_le: 'yesterday' }))).toMatchObject({ ok: false, error: expect.stringContaining('emis_le') });
    expect(parseCursusEvent(env('heures.validees', {}, { emis_le: '2026-10-05' }))).toMatchObject({ ok: false });
    expect(parseCursusEvent(env('heures.validees', {}, { id: 'a b' }))).toMatchObject({ ok: false });
    expect(parseCursusEvent(env('heures.validees', {}, { id: 'x'.repeat(201) }))).toMatchObject({ ok: false });
    expect(parseCursusEvent(env('../etc', {}))).toMatchObject({ ok: false });
    expect(parseCursusEvent(env('heures.validees', [1, 2]))).toMatchObject({ ok: false });
    expect(MAX_CURSUS_EVENT_BYTES).toBe(262_144);
  });

  it('unknown types are accepted (to be ignored) and their data is not kept', () => {
    const r = parseCursusEvent(env('formation.planifiee', { matricule: 'EMP-0018', medical: 'x' }));
    expect(r).toMatchObject({ ok: true, event: { kind: 'unknown', type: 'formation.planifiee', data: {}, replaceKey: null, matricule: null } });
  });
});

describe('heures.validees (stored only, R-030 awaits the owner)', () => {
  it('matricule, week, hours per project; replacement key matricule + week; optional lines (NEW-CURSUS-5 c)', () => {
    const r = parseCursusEvent(env('heures.validees', { matricule: 'EMP-0018', semaine: '2026-W40', projets: { 'HLT-026': 32, 'NDC-031': 3.5 } }));
    expect(r).toMatchObject({ ok: true, event: { kind: 'hours', matricule: 'EMP-0018', week: '2026-W40', projects: { 'HLT-026': 32, 'NDC-031': 3.5 }, replaceKey: 'EMP-0018|2026-W40' } });
    expect(parseCursusEvent(env('heures.validees', { matricule: 'EMP-0018', semaine: '2026-09-28', projets: {}, lignes: [{ projet: 'HLT-026', activite: 'A1250', heures: 8, date: '2026-09-28' }] })))
      .toMatchObject({ ok: true, event: { replaceKey: 'EMP-0018|2026-09-28' } });
  });

  it('refuses a bad week, negative or absurd hours, a malformed matricule', () => {
    for (const data of [
      { matricule: 'EMP-0018', semaine: '2026-W60', projets: {} },
      { matricule: 'EMP-0018', semaine: 'W40', projets: {} },
      { matricule: 'EMP-0018', semaine: '2026-W40', projets: { 'HLT-026': -1 } },
      { matricule: 'EMP-0018', semaine: '2026-W40', projets: { 'HLT-026': 200 } },
      { matricule: 'EMP 0018', semaine: '2026-W40', projets: {} },
      { semaine: '2026-W40', projets: {} },
    ])
      expect(parseCursusEvent(env('heures.validees', data)), JSON.stringify(data)).toMatchObject({ ok: false, error: expect.stringMatching(/^Invalid heures\.validees/) });
  });
});

describe('absence.validee (provisional, R-031) — minimised (R-173)', () => {
  it('reduces the nature to Leave or Absence and never keeps it; the key is the Cursus id, else matricule + dates', () => {
    const sick = parseCursusEvent(env('absence.validee', { matricule: 'EMP-0018', start: '2026-10-12', end: '2026-10-14', nature: 'MALADIE', id: 'ABS-77' }));
    expect(sick).toEqual({
      ok: true,
      event: {
        id: 'evt-0001', type: 'absence.validee', emittedAt: new Date('2026-10-05T08:30:00Z'), kind: 'absence', matricule: 'EMP-0018', replaceKey: 'cursus:ABS-77',
        absence: { matricule: 'EMP-0018', start: '2026-10-12', end: '2026-10-14', type: 'absence', id: 'ABS-77' },
        data: { matricule: 'EMP-0018', start: '2026-10-12', end: '2026-10-14', type: 'absence', id: 'ABS-77' },
      },
    });
    expect(JSON.stringify(sick)).not.toMatch(/MALADIE/i);
    for (const nature of ['CP', 'rtt', 'Congés payés', 'conge_paye', 'leave'])
      expect(parseCursusEvent(env('absence.validee', { matricule: 'EMP-1', start: '2026-10-12', end: '2026-10-12', nature })), nature).toMatchObject({ ok: true, event: { absence: { type: 'leave' } } });
    for (const nature of ['FORMATION', 'enfant malade', '', undefined])
      expect(parseCursusEvent(env('absence.validee', { matricule: 'EMP-1', start: '2026-10-12', end: '2026-10-12', nature })), String(nature)).toMatchObject({ ok: true, event: { absence: { type: 'absence' } } });
    // French date names accepted; no id → matricule + dates.
    expect(parseCursusEvent(env('absence.validee', { matricule: 'EMP-1', debut: '2026-10-12', fin: '2026-10-16', nature: 'CP' }))).toMatchObject({ ok: true, event: { replaceKey: 'EMP-1|2026-10-12|2026-10-16' } });
  });

  it('refuses missing or impossible dates and an end before the start', () => {
    expect(parseCursusEvent(env('absence.validee', { matricule: 'EMP-1', start: '2026-10-12' }))).toMatchObject({ ok: false, error: 'Invalid absence.validee · du and au are required' });
    expect(parseCursusEvent(env('absence.validee', { matricule: 'EMP-1', start: '2026-02-30', end: '2026-03-01' }))).toMatchObject({ ok: false });
    expect(parseCursusEvent(env('absence.validee', { matricule: 'EMP-1', start: '2026-10-14', end: '2026-10-12' }))).toMatchObject({ ok: false, error: 'Invalid absence.validee · the absence ends before it starts' });
    // Longer than 400 days: refused (400), never a storage failure Cursus would retry forever.
    expect(parseCursusEvent(env('absence.validee', { matricule: 'EMP-1', start: '2026-01-01', end: '2027-02-06' }))).toMatchObject({ ok: false, error: 'Invalid absence.validee · longer than 400 days' });
    expect(parseCursusEvent(env('absence.validee', { matricule: 'EMP-1', start: '2026-01-01', end: '2027-02-05' }))).toMatchObject({ ok: true });
  });
});

describe('Cursus\'s contract (docs/API-KEYSTONE.md): donnees, du / au, the absence id, absence.annulee', () => {
  // Cursus's own envelope: `donnees`, a UUID id, a millisecond timestamp.
  const cursus = (type: string, donnees: unknown) => ({ id: '0b9d7c1e-2f4a-4d3b-9a61-3c5e8f7a1b20', type, emis_le: '2026-10-10T08:41:07.512Z', donnees });

  it('reads `donnees` (and still `data`); `donnees` wins when both are sent', () => {
    expect(parseCursusEvent(cursus('heures.validees', { matricule: 'EMP-0012', semaine: '2026-10-05', projets: { 'K-2614': 15, 'K-2611': 0 } }))).toMatchObject({
      ok: true, event: { kind: 'hours', matricule: 'EMP-0012', week: '2026-10-05', projects: { 'K-2614': 15, 'K-2611': 0 }, replaceKey: 'EMP-0012|2026-10-05' },
    });
    expect(parseCursusEvent({ ...cursus('verdict.modifie', { chantier: 'K-1' }), data: { chantier: 'K-2' } })).toMatchObject({ ok: true, event: { chantier: 'K-1' } });
    expect(parseCursusEvent(cursus('heures.validees', [1]))).toMatchObject({ ok: false });
  });

  it('absence.validee { absence, matricule, du, au }: no nature → Absence; the key is the Cursus absence id (integer or string)', () => {
    const r = parseCursusEvent(cursus('absence.validee', { absence: 31, matricule: 'EMP-0018', du: '2026-12-14', au: '2026-12-18' }));
    expect(r).toMatchObject({
      ok: true,
      event: {
        kind: 'absence', matricule: 'EMP-0018', replaceKey: 'cursus:31',
        absence: { matricule: 'EMP-0018', start: '2026-12-14', end: '2026-12-18', type: 'absence', id: '31' },
        data: { matricule: 'EMP-0018', start: '2026-12-14', end: '2026-12-18', type: 'absence', id: '31' },
      },
    });
    // A correction (same absence, new dates) keeps the key: it replaces the weeks written before.
    expect(parseCursusEvent(cursus('absence.validee', { absence: 31, matricule: 'EMP-0018', du: '2026-12-21', au: '2026-12-23' }))).toMatchObject({ ok: true, event: { replaceKey: 'cursus:31' } });
    expect(parseCursusEvent(cursus('absence.validee', { absence: 'A-31', matricule: '004118', du: '2026-12-14', au: '2026-12-14' }))).toMatchObject({ ok: true, event: { replaceKey: 'cursus:A-31', matricule: '004118' } });
    // `du` / `au` win over the earlier names; `absence` over `id`.
    expect(parseCursusEvent(cursus('absence.validee', { absence: 5, id: 'X', matricule: 'EMP-1', du: '2026-12-14', au: '2026-12-15', start: '2026-01-01', end: '2026-01-02' })))
      .toMatchObject({ ok: true, event: { replaceKey: 'cursus:5', absence: { start: '2026-12-14', end: '2026-12-15' } } });
    for (const bad of [{ absence: -1, matricule: 'EMP-1', du: '2026-12-14', au: '2026-12-14' }, { absence: 1.5, matricule: 'EMP-1', du: '2026-12-14', au: '2026-12-14' }, { absence: 1, matricule: 'EMP-1', du: '2026-12-14' }, { absence: 1, matricule: 'EMP-1', du: '2026-12-15', au: '2026-12-14' }])
      expect(parseCursusEvent(cursus('absence.validee', bad)), JSON.stringify(bad)).toMatchObject({ ok: false });
  });

  it('absence.annulee: same data and the same key as its validation; validation and cancellation are one object', () => {
    expect(parseCursusEvent(cursus('absence.annulee', { absence: 31, matricule: 'EMP-0018', du: '2026-12-14', au: '2026-12-18' }))).toMatchObject({
      ok: true, event: { kind: 'absence-cancelled', type: 'absence.annulee', replaceKey: 'cursus:31', data: { matricule: 'EMP-0018', start: '2026-12-14', end: '2026-12-18', id: '31' } },
    });
    expect(parseCursusEvent(cursus('absence.annulee', { absence: 31, matricule: 'EMP-0018', du: '2026-12-14' }))).toMatchObject({ ok: false, error: 'Invalid absence.annulee · du and au are required' });
    expect(sameObjectTypes('absence.annulee')).toEqual(['absence.validee', 'absence.annulee']);
    expect(sameObjectTypes('heures.validees')).toEqual(['heures.validees']);
  });

  it('demande.decision: Cursus\'s `decision` is kept (as `statut`), nothing else; deplacement.* accepted and ignored', () => {
    const d = parseCursusEvent(cursus('demande.decision', { demande: 7, reference: 'DK-2026-0412', matricule: 'EMP-0018', chantier: 'K-2611', decision: 'acceptee', date: '2026-10-10' }));
    expect(d).toMatchObject({ ok: true, event: { kind: 'request' } });
    expect(d.ok && d.event.data).toEqual({ demande: 7, statut: 'acceptee' });
    for (const type of ['deplacement.modifie', 'deplacement.annule'])
      expect(parseCursusEvent(cursus(type, { deplacement: 12, demande: 7, matricule: 'EMP-0018', chantier: 'K-2611', destination: 'MA', depart: '2026-11-02', retour: '2026-11-20', date: '2026-10-14' })))
        .toMatchObject({ ok: true, event: { kind: 'unknown', data: {} } });
  });
});

describe('verdict.modifie and demande.decision', () => {
  it('the Cursus site of a verdict; a request decision stored as sent', () => {
    expect(parseCursusEvent(env('verdict.modifie', { chantier: 'K-2614', matricule: 'EMP-0018', statut: 'NO_GO' }))).toMatchObject({
      ok: true, event: { kind: 'verdict', chantier: 'K-2614', data: { chantier: 'K-2614' }, replaceKey: null },
    });
    expect(parseCursusEvent(env('verdict.modifie', {}))).toMatchObject({ ok: false });
    expect(parseCursusEvent(env('demande.decision', { demande: 42, statut: 'VALIDEE' }))).toMatchObject({ ok: true, event: { kind: 'request', data: { demande: 42, statut: 'VALIDEE' } } });
    expect(parseCursusEvent(env('demande.decision', { statut: 'VALIDEE' }))).toMatchObject({ ok: false });
    // R-173: nothing but the request and its decision is kept.
    const extra = parseCursusEvent(env('demande.decision', { demande: 'D-7', statut: 'REFUSEE', commentaire: 'Passeport expiré', matricule: 'EMP-0018' }));
    expect(extra.ok && extra.event.data).toEqual({ demande: 'D-7', statut: 'REFUSEE' });
  });
});

describe('retention', () => {
  it('13 calendar months', () => {
    expect(CURSUS_EVENT_RETENTION_MONTHS).toBe(13);
    expect(cursusEventsCutoff(new Date('2026-10-12T10:00:00Z')).toISOString()).toBe('2025-09-12T10:00:00.000Z');
  });
});
