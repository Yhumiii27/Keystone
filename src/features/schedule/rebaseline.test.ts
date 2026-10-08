import { describe, expect, it } from 'vitest';
import { formDefFromPrototype, initialFormValues, isFormValid, optionLabel } from '@/components/app/form-def';
import { trFR } from '@/i18n/translate';
import { PROTO } from '@/server/prototype';
import { REBASELINE_FORM, REBASELINE_RESULT, parseRebaseline } from './rebaseline';

describe('Re-baseline form (AF schedule, docs/spec/05 §1.5)', () => {
  const proto = formDefFromPrototype(PROTO.AF.schedule);

  it('matches the prototype definition (labels, kinds, defaults, option labels)', () => {
    expect([REBASELINE_FORM.title, REBASELINE_FORM.submit, REBASELINE_FORM.kind]).toEqual([proto.title, proto.submit, proto.kind]);
    expect(REBASELINE_FORM.fields.map((f) => [f.id, f.label, f.type, !!f.required, f.defaultValue, f.options?.map(optionLabel)])).toEqual(
      proto.fields.map((f) => [f.id, f.label, f.type, !!f.required, f.defaultValue, f.options?.map(optionLabel)]),
    );
    expect(PROTO.AF_RESULT.schedule).toBe(REBASELINE_RESULT);
  });

  it('opens with "BL2 — after CR-006", first approver and scope; invalid until a reason is typed', () => {
    const v = initialFormValues(REBASELINE_FORM.fields);
    expect(v).toEqual({ name: 'BL2 — after CR-006', reason: '', approver: 'director', scope: 'dates_budget' });
    expect(isFormValid(REBASELINE_FORM.fields, v)).toBe(false);
    expect(isFormValid(REBASELINE_FORM.fields, { ...v, reason: 'CR-006 approved' })).toBe(true);
  });

  it('translates to the prototype French', () => {
    expect([REBASELINE_FORM.title, REBASELINE_FORM.submit, ...REBASELINE_FORM.fields.map((f) => f.label)].map(trFR)).toEqual([
      'Nouvelle référence', 'Geler la nouvelle référence', 'Nom de la référence', 'Motif', 'Approbateur', 'Périmètre',
    ]);
    expect(REBASELINE_FORM.fields[2].options?.map((o) => trFR(optionLabel(o)))).toEqual(['Marie Lefebvre · Directrice de portefeuille', 'Romain Aubert · Chef de projet']);
    expect(trFR(REBASELINE_RESULT)).toBe('Référence gelée');
  });

  it('validates untrusted input', () => {
    expect(parseRebaseline({ name: ' BL2 ', reason: ' why ', approver: 'pm', scope: 'dates' })).toEqual({
      ok: true,
      value: { name: 'BL2', reason: 'why', approver: 'pm', scope: 'dates' },
    });
    expect(parseRebaseline({ name: 'BL2', reason: 'x' })).toMatchObject({ ok: true, value: { approver: 'director', scope: 'dates_budget' } });
    expect(parseRebaseline({ name: '  ', reason: 'x' })).toEqual({ ok: false, error: 'Baseline name is required' });
    expect(parseRebaseline({ name: 'BL2', reason: '' })).toEqual({ ok: false, error: 'Reason is required' });
    expect(parseRebaseline({ name: 'BL2', reason: 'x', approver: 'client' })).toEqual({ ok: false, error: 'Unknown approver' });
    expect(parseRebaseline({ name: 'BL2', reason: 'x', scope: 'all' })).toEqual({ ok: false, error: 'Unknown scope' });
    expect(parseRebaseline({ name: 'x'.repeat(81), reason: 'x' })).toEqual({ ok: false, error: 'Baseline name is too long' });
    expect(parseRebaseline(null)).toEqual({ ok: false, error: 'Baseline name is required' });
  });
});

describe('Schedule FR strings', () => {
  it('KPI and card labels', () => {
    expect(
      ['Schedule — baseline vs forecast', 'Schedule progression', 'Cumulative % complete · SPI per month', 'Critical path float', 'Forecast finish', 'Today', 'Work package', 'Slip'].map(trFR),
    ).toEqual([
      'Planning — référence vs prévision', 'Progression du planning', '% d’avancement cumulé · SPI par mois', 'Marge du chemin critique', 'Fin prévisionnelle', 'Aujourd’hui', 'Lot de travaux', 'Glissement',
    ]);
    expect(trFR('Earning 90¢ of planned work per $1')).toBe('90 ¢ de travail prévu acquis par € dépensé');
    expect(trFR('Complete · 0 on baseline date')).toBe('Terminés · 0 à la date de référence');
    expect(`${trFR('Baseline')} ${trFR('15 Mar')} ${trFR('· Forecast')} ${trFR('1 Apr')}`).toBe('Référence 15 mars · Prévision 1 avr.');
  });
});
