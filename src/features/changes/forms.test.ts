// AF `changes` / AF `trends` definitions and validation of the submitted values (docs/spec/07 §3, 04 §2.5),
// plus the screens' FR helper.
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import { initialFormValues, isFormValid } from '@/components/app/form-def';
import { makeT } from '@/i18n/translate';
import { STATUS_REPORT_FORM, newChangeRequestForm, parseNewChangeRequest, parseStatusReport } from './forms';
import { changesT } from './i18n';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AF = (PROTO as any).AF;

describe('New change request (AF.changes)', () => {
  it('mirrors the prototype form: labels, defaults, required fields', () => {
    const def = newChangeRequestForm();
    expect([def.title, def.submit, def.kind]).toEqual([AF.changes.title, AF.changes.submit, 'create']);
    expect(def.fields.map((f) => [f.id, f.label, f.type, !!f.required])).toEqual(
      AF.changes.fields.map(([id, label, type, , req]: [string, string, string, unknown, number?]) => [id, label, type, !!req]),
    );
    expect(def.fields.find((f) => f.id === 'type')?.options).toEqual([
      { value: 'scope', label: 'Scope' },
      { value: 'budget', label: 'Budget' },
      { value: 'schedule', label: 'Schedule' },
      { value: 'scope_budget', label: 'Scope + budget' },
    ]);
    const init = initialFormValues(def.fields);
    expect(init).toEqual({ title: '', type: 'scope', amt: '0', days: '0', wbs: '1.3', why: '' });
    expect(isFormValid(def.fields, init)).toBe(false);
    expect(isFormValid(def.fields, { ...init, title: 'x', why: 'y' })).toBe(true);
    expect(initialFormValues(newChangeRequestForm('1').fields).wbs).toBe('1');
  });

  it('parses types, amounts, delay and WBS codes', () => {
    const ok = parseNewChangeRequest({ title: ' Extra lighting ', type: 'scope_budget', amt: '12.4', days: '-3', wbs: '1.6, 1.7 1.6', why: ' Client ask ' });
    expect(ok).toEqual({
      ok: true,
      value: { title: 'Extra lighting', types: ['scope', 'budget'], amountKeur: 12, scheduleDays: -3, wbsCodes: ['1.6', '1.7'], justification: 'Client ask' },
    });
    const blank = parseNewChangeRequest({ title: 'T', type: '', amt: '', days: '', wbs: '', why: 'W' });
    expect(blank).toMatchObject({ ok: true, value: { types: ['scope'], amountKeur: 0, scheduleDays: 0, wbsCodes: ['1'] } });
    expect(parseNewChangeRequest({ title: 'T', amt: '−40', why: 'W' })).toMatchObject({ ok: true, value: { amountKeur: -40 } });
  });

  it('rejects invalid input with EN source messages', () => {
    const base = { title: 'T', type: 'budget', amt: '0', days: '0', wbs: '1.3', why: 'W' };
    expect(parseNewChangeRequest({ ...base, title: '  ' })).toEqual({ ok: false, error: 'Title is required' });
    expect(parseNewChangeRequest({ ...base, why: '' })).toEqual({ ok: false, error: 'Justification is required' });
    expect(parseNewChangeRequest({ ...base, type: 'cost' })).toEqual({ ok: false, error: 'Unknown change type' });
    expect(parseNewChangeRequest({ ...base, amt: 'abc' })).toEqual({ ok: false, error: 'Enter an amount in k€' });
    expect(parseNewChangeRequest({ ...base, amt: '1e9' })).toEqual({ ok: false, error: 'Enter an amount in k€' });
    expect(parseNewChangeRequest({ ...base, days: 'soon' })).toEqual({ ok: false, error: 'Enter a delay in days' });
    expect(parseNewChangeRequest({ ...base, wbs: '1.x' })).toEqual({ ok: false, error: 'Enter WBS codes such as 1.3 or 1.3, 1.4' });
    expect(parseNewChangeRequest({ ...base, title: 'x'.repeat(201) })).toEqual({ ok: false, error: 'Title is too long' });
    expect(parseNewChangeRequest(null)).toEqual({ ok: false, error: 'Title is required' });
  });
});

describe('Generate status report (AF.trends)', () => {
  it('mirrors the prototype run form', () => {
    expect([STATUS_REPORT_FORM.title, STATUS_REPORT_FORM.submit, STATUS_REPORT_FORM.kind]).toEqual([AF.trends.title, AF.trends.submit, 'run']);
    expect(STATUS_REPORT_FORM.fields.map((f) => [f.id, f.label, f.type])).toEqual(AF.trends.fields.map(([id, label, type]: string[]) => [id, label, type]));
    for (const f of STATUS_REPORT_FORM.fields.filter((x) => x.type === 'select')) {
      const proto = AF.trends.fields.find(([id]: string[]) => id === f.id)[3];
      expect(f.options?.map((o) => (typeof o === 'string' ? o : o.label))).toEqual(proto);
    }
  });

  it('validates codes; blank selects take the first option', () => {
    expect(parseStatusReport({ period: '', audience: '', sections: '', note: '' })).toEqual({
      ok: true,
      value: { period: 'month', audience: 'steering', sections: 'full', note: '' },
    });
    expect(parseStatusReport({ period: 'quarter', audience: 'client', sections: 'kpis', note: ' ok ' })).toMatchObject({ ok: true, value: { note: 'ok' } });
    expect(parseStatusReport({ period: 'year' })).toEqual({ ok: false, error: 'Unknown period' });
    expect(parseStatusReport({ audience: 'press' })).toEqual({ ok: false, error: 'Unknown audience' });
    expect(parseStatusReport({ note: 'x'.repeat(2001) })).toEqual({ ok: false, error: 'Manager note is too long' });
  });
});

describe('changesT (FR fixes local to these screens)', () => {
  const fr = changesT(makeT('fr'), 'fr');
  it('register header, hyphen day counts, baseline and contingency forms', () => {
    expect(fr('Request')).toBe('Demande');
    expect(fr('-12 d')).toBe('-12 j');
    expect(fr('+12 d')).toBe('+12 j');
    expect(fr('-31 d')).toBe('-31 j');
    expect(fr('−9 d · 4 wk')).toBe('−9 j · 4 sem.');
    // NEW-D5-3 'a' (R-156): the 'Handover' step is « Transfert » in French.
    expect(fr('Net 27 d on handover')).toBe('Net 27 j sur le transfert');
    expect(fr('BL2 proposed · CR-009 draft')).toBe('BL2 proposée · CR-009 brouillon');
    expect(fr('BL2 proposed · CR-009 in review')).toBe('BL2 proposée · CR-009 en revue');
    expect(fr('Contingency 150 k€')).toBe('Provision 150 k€');
    expect(fr('13 weekly snapshots')).toBe('13 instantanés hebdomadaires');
    expect(fr('Weekly · Fridays · since 3 Jul')).toBe('Hebdomadaire · vendredi · depuis le 3 juil.');
    expect(fr('Weekly · Fridays · since 10 Jul')).toBe('Hebdomadaire · vendredi · depuis le 10 juil.');
    expect(fr('A re-baseline is itself a change request — BL2 becomes current when CR-009 is approved')).toBe(
      'Une nouvelle référence est elle-même une demande de modification — BL2 devient courante à l’approbation de CR-009',
    );
    expect(fr('A re-baseline is itself a change request — BL3 becomes current when CR-014 is approved')).toBe(
      'Une nouvelle référence est elle-même une demande de modification — BL3 devient courante à l’approbation de CR-014',
    );
    expect(fr('CR-009 draft')).not.toContain(' j');
    expect(fr('18 Dec 2026')).toBe('18 déc. 2026');
    expect(fr('Fixée le 3 d')).toBe('Fixée le 3 j');
    expect(changesT(makeT('en'), 'en')('Request')).toBe('Request');
  });
});
