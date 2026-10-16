// HR action forms vs the prototype AF catalogue (AF.rates / skills / hours, AF_RESULT) and input validation. AF.leave
// ("Sync Lucca") is retired: absences come from Cursus (NEW-CURSUS-7 "a", R-031; Lucca unplugged, NEW-CURSUS-4).
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import { formDefFromPrototype, optionLabel, type FormDef } from '@/components/app/form-def';
import {
  ADD_ROLE_FORM, ADD_ROLE_RESULT, ADD_SKILL_FORM, ADD_SKILL_RESULT, addRoleForm, importHoursForm, importHoursResult,
  parseAddRole, parseAddSkill, parseFactor, parseImportHours, parseRate, periodCovers,
} from './forms';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;

/** Labels only (select options compared by label: the rebuild stores codes). */
const shape = (f: FormDef) => ({
  title: f.title,
  submit: f.submit,
  kind: f.kind,
  fields: f.fields.map((x) => [x.id, x.label, x.type, !!x.required, (x.options ?? []).map(optionLabel), x.defaultValue ?? '']),
});

describe('HR forms = prototype AF catalogue', () => {
  // NEW-CURSUS-7 (R-031): the prototype's AF.leave "Sync Lucca" form is no longer offered.
  it('Add role, Add skill, Import Lucca hours', () => {
    expect(shape(ADD_ROLE_FORM)).toEqual(shape(formDefFromPrototype(P.AF.rates)));
    // R-083 (A-10, R-4a): the rate card's "Add role" adds an explicit "Effective from" date to the prototype's form.
    const proto = shape(formDefFromPrototype(P.AF.rates));
    expect(shape(addRoleForm('25 Sep 2026'))).toEqual({ ...proto, fields: [...proto.fields, ['from', 'Effective from', 'text', true, [], '25 Sep 2026']] });
    // R-5a (R-087): one 1–5 scale for every skill — the prototype's "Levels" select (1–4, 1–3, Yes / No; never stored) is removed.
    const skills = shape(formDefFromPrototype(P.AF.skills));
    expect(shape(ADD_SKILL_FORM)).toEqual({ ...skills, fields: skills.fields.filter((f) => f[0] !== 'levels') });
    expect(skills.fields.map((f) => f[0])).toContain('levels');
    // the analytic code defaults to the project's code (HAV004 for HLT-026 = the prototype's constant)
    expect(shape(importHoursForm('HAV004'))).toEqual(shape(formDefFromPrototype(P.AF.hours)));
    expect(importHoursForm(null).fields.find((f) => f.id === 'code')!.defaultValue).toBe('');
  });

  it('toasts = AF_RESULT (hours with the real counts)', () => {
    expect([ADD_ROLE_RESULT, ADD_SKILL_RESULT]).toEqual([P.AF_RESULT.rates, P.AF_RESULT.skills]);
    expect(importHoursResult(12, 2)).toBe(P.AF_RESULT.hours);
    expect(importHoursResult(1, 0)).toBe('Lucca hours imported · 1 line matched · 0 to assign');
  });
});

describe('validation', () => {
  it('rates and multipliers', () => {
    expect(parseRate('85.5')).toEqual({ ok: true, value: 85.5 });
    expect(parseRate(0)).toEqual({ ok: true, value: 0 });
    expect(parseRate('')).toEqual({ ok: false, error: 'Enter a valid hourly rate' });
    expect(parseRate(-1)).toEqual({ ok: false, error: 'Hourly rate out of range' });
    expect(parseRate(Infinity)).toEqual({ ok: false, error: 'Enter a valid hourly rate' });
    expect(parseFactor(1.25)).toEqual({ ok: true, value: 1.25 });
    expect(parseFactor('1.25')).toEqual({ ok: false, error: 'Enter a valid multiplier' });
    expect(parseFactor(11)).toEqual({ ok: false, error: 'Multiplier out of range' });
  });

  it('Add role: required, unique (case-insensitive), codes, selects default to the first option', () => {
    expect(parseAddRole({ role: '  Commissioning   engineer ', rate: '78', from: '1 Nov 2026' }, [], 2026)).toEqual({
      ok: true,
      value: { role: 'Commissioning engineer', rateEur: 78, costCenter: 'engineering', grade: 'junior', effectiveFrom: '2026-11-01' },
    });
    expect(parseAddRole({ role: 'X', rate: '70', cc: 'site', grade: 'expert', from: '2027-01-01' }, [], 2026)).toMatchObject({ ok: true, value: { costCenter: 'site', grade: 'expert', effectiveFrom: '2027-01-01' } });
    // R-083: the effective date is required, in the forms' date formats (FR included), and must be a real day.
    expect(parseAddRole({ role: 'X', rate: '70', from: '1 nov. 2026' }, [], 2026)).toMatchObject({ ok: true, value: { effectiveFrom: '2026-11-01' } });
    expect(parseAddRole({ role: 'X', rate: '70', from: '' }, [], 2026)).toEqual({ ok: false, error: 'Enter a valid effective date' });
    expect(parseAddRole({ role: 'X', rate: '70', from: '31 Feb 2026' }, [], 2026)).toEqual({ ok: false, error: 'Enter a valid effective date' });
    expect(parseAddRole({ role: '', rate: '70' }, [], 2026)).toEqual({ ok: false, error: 'Role is required' });
    expect(parseAddRole({ role: 'planner', rate: '70' }, ['Planner'], 2026)).toEqual({ ok: false, error: 'This role is already on the rate card' });
    expect(parseAddRole({ role: 'X', rate: 'abc' }, [], 2026)).toEqual({ ok: false, error: 'Enter a valid hourly rate' });
    expect(parseAddRole({ role: 'X', rate: '70', cc: 'Engineering' }, [], 2026)).toEqual({ ok: false, error: 'Unknown cost center' });
    expect(parseAddRole(null, [], 2026)).toEqual({ ok: false, error: 'Role is required' });
  });

  it('Add skill', () => {
    // R-5a: no level scale any more (a stray "levels" value is ignored).
    expect(parseAddSkill({ name: 'Welding', cat: 'site', levels: 'yes_no' })).toEqual({ ok: true, value: { name: 'Welding', category: 'site' } });
    expect(parseAddSkill({ name: 'mep' }, ['MEP'])).toEqual({ ok: false, error: 'This skill is already in the matrix' });
    expect(parseAddSkill({ name: ' ' })).toEqual({ ok: false, error: 'Skill is required' });
    expect(parseAddSkill({ name: 'X', cat: 'hr' })).toEqual({ ok: false, error: 'Unknown category' });
  });

  it('Import Lucca hours: project analytic code (blank → default), period coverage', () => {
    expect(parseImportHours({ period: '2026-09', code: 'hav004', mode: 'resource' }, 'HAV004')).toEqual({
      ok: true,
      value: { period: '2026-09', analyticCode: 'HAV004', matchingMode: 'resource' },
    });
    expect(parseImportHours({ code: '' }, 'HAV004')).toMatchObject({ ok: true, value: { analyticCode: 'HAV004', matchingMode: 'resource_wp' } });
    expect(parseImportHours({ code: 'NDC031' }, 'HAV004')).toEqual({ ok: false, error: 'This analytic code does not belong to the project' });
    expect(parseImportHours({ code: '' }, null)).toEqual({ ok: false, error: 'Analytic code is required' });
    expect(parseImportHours({ code: 'a b' }, null)).toEqual({ ok: false, error: 'Invalid analytic code' });
    expect(parseImportHours({ mode: 'x' }, 'HAV004')).toEqual({ ok: false, error: 'Unknown matching mode' });
    expect([periodCovers('2026-09', '2026-09-01'), periodCovers('2026-q3', '2026-09-01'), periodCovers('2026-08', '2026-09-01')]).toEqual([true, true, false]);
  });
});
