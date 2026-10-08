import { describe, expect, it } from 'vitest';
import { formDefFromPrototype, initialFormValues, isFormValid, isFullSpan, resolveFormValues } from './form-def';

// AF.risks as stored in src/server/prototype/prototype-data.json (docs/spec/01 §8.4).
const AF_RISKS = {
  title: 'New risk',
  kind: 'create',
  submit: 'Register risk',
  fields: [
    ['title', 'Title', 'text', '', 1],
    ['cat', 'Category', 'select', 'RCAT'],
    ['p', 'Probability (1–5)', 'number', '3'],
    ['i', 'Impact (1–5)', 'number', '3'],
    ['owner', 'Owner', 'select', 'TEAM'],
    ['resp', 'Response', 'select', ['Mitigate', 'Accept', 'Transfer', 'Avoid']],
    ['emv', 'EMV (k€)', 'number', ''],
    ['plan', 'Response plan', 'textarea', ''],
  ],
};

describe('form-def (afOpenWith / afValid / afSubmit, logic 5111–5136)', () => {
  const def = formDefFromPrototype(AF_RISKS, { RCAT: ['Technical', 'Supplier / delivery'], TEAM: ['Romain Aubert'] });

  it('converts AF tuples', () => {
    expect(def.kind).toBe('create');
    expect(def.fields[0]).toMatchObject({ id: 'title', type: 'text', required: true });
    expect(def.fields[1].options).toEqual(['Technical', 'Supplier / delivery']);
    expect(def.fields[5].options).toEqual(['Mitigate', 'Accept', 'Transfer', 'Avoid']);
    expect(def.fields[2].defaultValue).toBe('3');
  });

  it('builds initial values: selects default to the first option, init overrides', () => {
    const v = initialFormValues(def.fields, { owner: 'Romain Aubert' });
    expect(v).toMatchObject({ title: '', cat: 'Technical', p: '3', resp: 'Mitigate', owner: 'Romain Aubert', plan: '' });
  });

  it('validates required non-select fields after trim', () => {
    const v = initialFormValues(def.fields);
    expect(isFormValid(def.fields, v)).toBe(false);
    expect(isFormValid(def.fields, { ...v, title: '   ' })).toBe(false);
    expect(isFormValid(def.fields, { ...v, title: 'Crane slot' })).toBe(true);
  });

  it('resolves empty selects to their first option', () => {
    expect(resolveFormValues(def.fields, { title: 'x', cat: '' }).cat).toBe('Technical');
  });

  it('spans textareas and title/name/progress/reason/why full width', () => {
    expect(isFullSpan(def.fields[0])).toBe(true);
    expect(isFullSpan(def.fields[7])).toBe(true);
    expect(isFullSpan(def.fields[2])).toBe(false);
  });
});
