// R-102 (E-1a = a, E-1b = a): engineering validates the parts. Pure rules (what is missing — presence, not truth: a lead time
// of 0 weeks is filled in —, who validates, who completes the record, the form parsing), then the Server Functions on the
// seeded in-memory database with the real screen access: the 8 personas, malformed input, stale status, the writers' own
// re-check, the audit, the drawer's Qualification section and its "Complete the record" form. The 47 seeded Validated parts
// are untouched; of the 4 seeded Not validated parts, EL-BAT-LI-200 (restriction text) is complete, the 3 others need their
// export "None" confirmed (export_reviewed false on existing rows — default recorded in the lot notes).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
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

import type { ReactElement } from 'react';
import { PERSONAS } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { canCompletePartRecord, canValidatePart, exportChoiceOf, parsePartQualification, partValidationErrors } from '@/domain/parts';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listAudit } from '@/server/dal/notifications';
import { getPart, listParts, updatePartQualification, validatePart } from '@/server/dal/parts';
import { getPartDrawer } from '@/server/dal/plm';
import { completePartRecordAction, validatePartAction } from './actions';
import { partQualificationView } from './model';
import { PartDrawer, type PartDrawerPanelProps } from './part-drawer';

const as = (role: string, lang: 'en' | 'fr' = 'en') => {
  session.role = role;
  session.lang = lang;
};
const COMPLETE = { hsMode: 'code', hs: '8531.10', export: 'none', restriction: '', lead: '3', mfrRef: 'CD-210' };
const result = (r: { toast?: string; error?: string } | string | void) => (typeof r === 'object' && r ? (r.toast ?? r.error ?? '') : String(r));

describe('R-102 rules', () => {
  const blank = { hsCode: null, hsNotApplicable: false, exportRestriction: null, exportReviewed: false, leadWeeks: null, manufacturerRef: null };
  it('what is missing before validation (presence, not truth)', () => {
    expect(partValidationErrors(blank)).toEqual([
      'Customs (HS) code missing (or mark it not applicable)', 'Export restriction not confirmed', 'Lead time missing', 'Manufacturer reference missing',
    ]);
    expect(partValidationErrors({ ...blank, hsNotApplicable: true, exportReviewed: true, leadWeeks: 0, manufacturerRef: 'X' })).toEqual([]);
    // A restriction text counts as confirmed; "None" (null) must be confirmed explicitly.
    expect(partValidationErrors({ ...blank, hsCode: '8507.60', exportRestriction: 'Dangerous goods UN3480', leadWeeks: 20, manufacturerRef: 'NV' })).toEqual([]);
  });

  it('who validates (E-1a: engineering lead; director by default) and who completes the record', () => {
    expect(['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'].filter((r) => canValidatePart('not_validated', r))).toEqual(['director', 'englead']);
    for (const s of ['validated', 'outdated', 'obsolete'] as const) expect(canValidatePart(s, 'englead'), s).toBe(false);
    expect(canCompletePartRecord('not_validated', 'procurement', true)).toBe(true);
    expect(canCompletePartRecord('not_validated', 'procurement', false)).toBe(false);
    expect(canCompletePartRecord('validated', 'procurement', true)).toBe(false);
    expect(canCompletePartRecord('validated', 'englead', true)).toBe(true);
    expect(canCompletePartRecord('obsolete', 'director', true)).toBe(true);
  });

  it('parses "Complete the record"', () => {
    expect(parsePartQualification(COMPLETE)).toEqual({
      ok: true, value: { hsCode: '8531.10', hsNotApplicable: false, exportRestriction: null, exportControl: null, exportReviewed: true, leadWeeks: 3, manufacturerRef: 'CD-210' },
    });
    expect(parsePartQualification({ ...COMPLETE, hsMode: 'na', hs: '1234', lead: '0' })).toMatchObject({ ok: true, value: { hsCode: null, hsNotApplicable: true, leadWeeks: 0 } });
    expect(parsePartQualification({ ...COMPLETE, export: 'dangerous_goods', restriction: ' UN3480 ' })).toMatchObject({
      ok: true, value: { exportRestriction: 'UN3480', exportControl: 'dangerous_goods', exportReviewed: true },
    });
    expect(parsePartQualification({ hs: '8531.10' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(parsePartQualification({ ...COMPLETE, export: 'unconfirmed', restriction: 'ignored', hs: '', lead: '', mfrRef: ' ' })).toMatchObject({
      ok: true, value: { hsCode: null, exportRestriction: null, exportReviewed: false, leadWeeks: null, manufacturerRef: null },
    });
    const err = (v: Record<string, string>) => {
      const r = parsePartQualification({ ...COMPLETE, ...v });
      return r.ok ? null : r.error;
    };
    expect([err({ hs: 'abc' }), err({ hs: '85' }), err({ export: 'dual_use' }), err({ export: 'secret' }), err({ hsMode: 'x' }), err({ lead: '-1' }), err({ lead: '2.5' }), err({ lead: '521' }), err({ mfrRef: 'x'.repeat(81) }), err({ export: 'encryption', restriction: 'x'.repeat(301) })]).toEqual([
      'Enter the customs code as digits, e.g. 8504.40', 'Enter the customs code as digits, e.g. 8504.40', 'Describe the export restriction', 'Invalid request', 'Invalid request',
      'Enter the lead time in whole weeks (0–520)', 'Enter the lead time in whole weeks (0–520)', 'Enter the lead time in whole weeks (0–520)', 'Text is too long', 'Text is too long',
    ]);
    expect(exportChoiceOf({ exportRestriction: null, exportReviewed: false, exportControl: null })).toBe('unconfirmed');
    expect(exportChoiceOf({ exportRestriction: null, exportReviewed: true, exportControl: null })).toBe('none');
    expect(exportChoiceOf({ exportRestriction: 'UN3480', exportReviewed: false, exportControl: 'dangerous_goods' })).toBe('dangerous_goods');
  });
});

describe('R-102 Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => as('director'));

  it('the seed: 47 Validated parts untouched, 4 Not validated; only EL-BAT-LI-200 is complete', async () => {
    const parts = await listParts();
    expect(parts.filter((p) => p.status === 'validated').length).toBe(47);
    const pending = parts.filter((p) => p.status === 'not_validated');
    expect(Object.fromEntries(pending.map((p) => [p.ref, partValidationErrors(p)]))).toEqual({
      'EL-BAT-LI-200': [], 'FD-DET-OPT2': ['Export restriction not confirmed'], 'HST-BRK-DSC': ['Export restriction not confirmed'], 'CTL-WIND-SN': ['Export restriction not confirmed'],
    });
    expect(parts.every((p) => p.validatedAt == null && p.validatedBy == null)).toBe(true);
  });

  it('every persona: "Complete the record" on a Not validated part — the catalogue’s editors; "Validate part" — englead and director', async () => {
    const complete: Record<string, string> = {};
    const validate: Record<string, string> = {};
    for (const p of PERSONAS) {
      as(p.role);
      try {
        complete[p.role] = result(await completePartRecordAction('HST-BRK-DSC', { ...COMPLETE, hs: '8483.60', lead: '10', mfrRef: `SF 30` }));
      } catch (e) {
        complete[p.role] = (e as Error).message;
      }
      try {
        // FD-DET-OPT2 stays incomplete: the validators are told what is missing; the others are refused before that.
        validate[p.role] = result(await validatePartAction('FD-DET-OPT2'));
      } catch (e) {
        validate[p.role] = (e as Error).message;
      }
    }
    const CHANGED = 'HST-BRK-DSC · Record updated';
    const SAME = 'HST-BRK-DSC · Nothing to change';
    expect(complete).toEqual({
      director: CHANGED, pm: SAME, depthead: 'The parts catalogue is read-only for you', member: 'The parts catalogue is read-only for you', englead: SAME, quality: SAME,
      procurement: SAME, client: 'NEXT_REDIRECT',
    });
    expect(validate).toEqual({
      director: 'Export restriction not confirmed', pm: 'Only the engineering lead or the director validates a part', depthead: 'The parts catalogue is read-only for you',
      member: 'The parts catalogue is read-only for you', englead: 'Export restriction not confirmed', quality: 'Only the engineering lead or the director validates a part',
      procurement: 'Only the engineering lead or the director validates a part', client: 'NEXT_REDIRECT',
    });
    const [audit] = await listAudit({ limit: 1 });
    expect([audit.who, audit.object, audit.area, audit.change]).toEqual(['Marie Lefebvre', 'HST-BRK-DSC', 'PLM', 'record completed · export None']);
    expect((await getPart('HST-BRK-DSC'))!).toMatchObject({ status: 'not_validated', exportReviewed: true, hsCode: '8483.60', leadWeeks: 10 });
  });

  it('the engineering lead validates a complete part: stored who and when, audited, then locked for the other editors', async () => {
    as('englead');
    expect(await validatePartAction('HST-BRK-DSC')).toEqual({ toast: 'HST-BRK-DSC · Validated' });
    const p = (await getPart('HST-BRK-DSC'))!;
    expect([p.status, p.validatedBy, !!p.validatedAt]).toEqual(['validated', 'Antoine Girard', true]);
    const [audit] = await listAudit({ limit: 1 });
    expect([audit.who, audit.object, audit.change, audit.area]).toEqual(['Antoine Girard', 'HST-BRK-DSC', 'status: Not validated → Validated', 'PLM']);
    // Stale second click.
    expect(await validatePartAction('HST-BRK-DSC')).toEqual({ error: 'This part is no longer awaiting validation' });
    // Validated: the record is the validators' only.
    as('procurement');
    expect(await completePartRecordAction('HST-BRK-DSC', { ...COMPLETE, lead: '12' })).toEqual({ error: 'Only the engineering lead or the director changes a validated part' });
    await expect(updatePartQualification('HST-BRK-DSC', parseOk({ ...COMPLETE, lead: '12' }), { name: 'Romain Aubert', role: 'pm' })).rejects.toMatchObject({ code: 'not_allowed' });
    as('englead', 'fr');
    expect(await completePartRecordAction('HST-BRK-DSC', { ...COMPLETE, hs: '8483.60', lead: '12', mfrRef: 'SF 30' })).toEqual({ toast: 'HST-BRK-DSC · Fiche mise à jour' });
    expect((await listAudit({ limit: 1 }))[0].change).toBe('record completed · lead time 10 → 12 wk');
    expect((await getPart('HST-BRK-DSC'))!.status).toBe('validated');
  });

  it('a lead time of 0 weeks and an HS code "Not applicable" are filled in; the seed’s complete part validates at once', async () => {
    as('director');
    expect(result(await completePartRecordAction('CTL-WIND-SN', { hsMode: 'na', hs: '', export: 'none', restriction: '', lead: '0', mfrRef: '4.3519' }))).toBe('CTL-WIND-SN · Record updated');
    expect(partValidationErrors((await getPart('CTL-WIND-SN'))!)).toEqual([]);
    expect(await validatePartAction('CTL-WIND-SN')).toEqual({ toast: 'CTL-WIND-SN · Validated' });
    as('englead');
    expect(await validatePartAction('EL-BAT-LI-200')).toEqual({ toast: 'EL-BAT-LI-200 · Validated' });
  });

  it('refuses malformed input, unknown parts and parts no longer pending; the writers re-check', async () => {
    as('englead');
    for (const ref of ['', 'el-vfd-200', 'X'.repeat(41), 42 as never]) {
      expect(await validatePartAction(ref)).toEqual({ error: 'Invalid request' });
      expect(await completePartRecordAction(ref, COMPLETE)).toEqual({ error: 'Invalid request' });
    }
    expect(await validatePartAction('NOPE-1')).toEqual({ error: 'Unknown part' });
    expect(await completePartRecordAction('FD-DET-OPT2', { ...COMPLETE, lead: 'soon' })).toEqual({ error: 'Enter the lead time in whole weeks (0–520)' });
    // A payload that is not the form's (no selects) is refused; nothing is written.
    expect(await completePartRecordAction('FD-DET-OPT2', null as never)).toEqual({ error: 'Invalid request' });
    expect(await completePartRecordAction('FD-DET-OPT2', { lead: '3' })).toEqual({ error: 'Invalid request' });
    expect(partValidationErrors((await getPart('FD-DET-OPT2'))!)).toEqual(['Export restriction not confirmed']);
    // No manual path to Outdated / Obsolete or back to Not validated: an Obsolete part is never "validated".
    expect(await validatePartAction('EL-HMI-10')).toEqual({ error: 'This part is no longer awaiting validation' });
    await expect(validatePart('FD-DET-OPT2', { name: 'Antoine Girard', role: 'englead' })).rejects.toMatchObject({ code: 'incomplete' });
    await expect(validatePart('FD-DET-OPT2', { name: 'Gabriel Comte', role: 'quality' })).rejects.toMatchObject({ code: 'not_allowed' });
    await expect(validatePart('NOPE-1', { name: 'Antoine Girard', role: 'englead' })).rejects.toMatchObject({ code: 'unknown' });
    await expect(updatePartQualification('FD-DET-OPT2', parseOk(COMPLETE), { name: 'Julien Wagner', role: 'member' })).rejects.toMatchObject({ code: 'not_allowed' });
  });

  it('the drawer: Qualification section per persona; "Complete the record" prefilled for the editors', async () => {
    const data = (await getPartDrawer('FD-DET-OPT2'))!;
    const q = (role: RoleKey) => partQualificationView(data.record, role, makeT('en'));
    expect(q('englead')).toMatchObject({ label: 'Qualification', complete: { label: 'Complete the record' }, validate: { label: 'Validate part', enabled: false } });
    expect(q('englead')!.items[0]).toMatchObject({ k: 'Before validation', color: 'var(--color-accent-300)' });
    expect(q('procurement')).toMatchObject({ complete: { label: 'Complete the record' }, validate: null });
    expect(q('member')).toMatchObject({ complete: null, validate: null });
    expect(partQualificationView(data.record, 'englead', makeT('fr'))!.missing).toEqual(['Restriction à l’export non confirmée']);
    // A validated part: who and when; nothing for the viewers who cannot change it.
    const validated = (await getPartDrawer('CTL-WIND-SN'))!.record;
    expect(partQualificationView(validated, 'pm', makeT('en'))!.items[0]).toMatchObject({ k: 'Validated', v: expect.stringMatching(/ · Marie Lefebvre$/) });
    expect(partQualificationView((await getPartDrawer('EL-VFD-200'))!.record, 'pm', makeT('en'))).toBeNull();
    // The server component builds the prefilled form for the editors only.
    as('englead');
    const el = (await PartDrawer({ partRef: 'HST-BRK-DSC', closeHref: '/reference/parts' })) as ReactElement<PartDrawerPanelProps>;
    const form = el.props.complete!.form;
    expect(form.title).toBe('Complete the record');
    expect(Object.fromEntries(form.fields.map((f) => [f.id, f.defaultValue]))).toEqual({ hsMode: 'code', hs: '8483.60', export: 'none', restriction: '', lead: '12', mfrRef: 'SF 30' });
    as('member');
    expect(((await PartDrawer({ partRef: 'HST-BRK-DSC', closeHref: '/reference/parts' })) as ReactElement<PartDrawerPanelProps>).props.complete).toBeNull();
  });
});

function parseOk(v: Record<string, string>) {
  const r = parsePartQualification(v);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
