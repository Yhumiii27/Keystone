// R-029 (NEW-CURSUS-7 "a"): the envelope { id, type, emis_le, data } of the events Cursus pushes and the known types —
// validation, replacement keys, the minimised absence (R-031 / R-173: Leave or Absence, never the reason), unknown types
// accepted without their data, and the 13-month retention cutoff.
import { describe, expect, it } from 'vitest';
import { CURSUS_EVENT_RETENTION_MONTHS, MAX_CURSUS_EVENT_BYTES, cursusEventsCutoff, parseCursusEvent } from './cursus-events';

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
    expect(parseCursusEvent(env('absence.validee', { matricule: 'EMP-1', start: '2026-10-12' }))).toMatchObject({ ok: false, error: 'Invalid absence.validee · start and end are required' });
    expect(parseCursusEvent(env('absence.validee', { matricule: 'EMP-1', start: '2026-02-30', end: '2026-03-01' }))).toMatchObject({ ok: false });
    expect(parseCursusEvent(env('absence.validee', { matricule: 'EMP-1', start: '2026-10-14', end: '2026-10-12' }))).toMatchObject({ ok: false, error: 'Invalid absence.validee · the absence ends before it starts' });
    // Longer than 400 days: refused (400), never a storage failure Cursus would retry forever.
    expect(parseCursusEvent(env('absence.validee', { matricule: 'EMP-1', start: '2026-01-01', end: '2027-02-06' }))).toMatchObject({ ok: false, error: 'Invalid absence.validee · longer than 400 days' });
    expect(parseCursusEvent(env('absence.validee', { matricule: 'EMP-1', start: '2026-01-01', end: '2027-02-05' }))).toMatchObject({ ok: true });
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
