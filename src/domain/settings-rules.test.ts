import { describe, expect, it } from 'vitest';
import { STAGE_ORDER, deliverableToggle, isTransitionAllowed, moveError, transitionsOf } from './lifecycle';
import { FORM_CATEGORIES, parseCategory, parseNewRisk, riskChips } from './risk';
import {
  REQUIRED_STAGES, SETTINGS_EDIT_ROLES, canEditSettings, costTypeOfSettingsCategory, labelFrom, nextActiveStage, orderedOptions, removalModeOf,
} from './settings-rules';

describe('Settings rules (A-14)', () => {
  it('only the portfolio director edits', () => {
    expect(SETTINGS_EDIT_ROLES).toEqual(['director']);
    expect(['director', 'pm', 'depthead', 'quality'].map(canEditSettings)).toEqual([true, false, false, false]);
  });

  it('a value in use or a default is deactivated, an unused custom value deleted', () => {
    expect(removalModeOf({ inUse: 3, isDefault: false })).toBe('deactivated');
    expect(removalModeOf({ inUse: 0, isDefault: true })).toBe('deactivated');
    expect(removalModeOf({ inUse: 0, isDefault: false })).toBe('deleted');
  });

  it('maps the Settings cost categories to cost types (custom → Labor)', () => {
    expect(['labor', 'materials', 'equipment', 'subcontractors', 'permits_fees', 'contingency', 'welding'].map(costTypeOfSettingsCategory))
      .toEqual(['labor', 'material', 'equipment', 'subcontract', 'fees', 'reserve', 'labor']);
  });

  it('orders form options: the form’s own order first, Settings additions after, inactive ones absent', () => {
    const active = [{ code: 'technical', label: 'Technical' }, { code: 'hse', label: 'HSE (safety)' }, { code: 'cyber', label: 'Cyber' }];
    expect(orderedOptions(active, FORM_CATEGORIES).map((o) => o.code)).toEqual(['technical', 'hse', 'cyber']); // FORM_CATEGORIES: technical before hse
    expect(labelFrom(active, 'cyber')).toBe('Cyber');
    expect(labelFrom(active, 'x', () => 'Fallback')).toBe('Fallback');
  });

  it('risks: Settings categories feed the form, the filter and the chips', () => {
    const ok = parseNewRisk({ title: 'Ransomware', cat: 'cyber' }, ['A'], ['supplier_delivery', 'cyber']);
    expect(ok).toMatchObject({ ok: true, value: { category: 'cyber' } });
    expect(parseNewRisk({ title: 'X', cat: 'technical' }, ['A'], ['supplier_delivery', 'cyber'])).toEqual({ ok: false, error: 'Unknown category' });
    expect(parseNewRisk({ title: 'X' }, ['A'], ['cyber'])).toMatchObject({ ok: true, value: { category: 'cyber' } });
    expect(parseNewRisk({ title: 'X' }, ['A'])).toMatchObject({ ok: true, value: { category: 'supplier_delivery' } });
    expect([parseCategory('cyber'), parseCategory('cyber', ['cyber']), parseCategory('Technical')]).toEqual([null, 'cyber', 'technical']);
    const chips = riskChips([{ category: 'technical' }, { category: 'cyber', categoryLabel: 'Cyber' }, { category: 'cyber', categoryLabel: 'Cyber' }]);
    expect(chips.map((c) => [c.value, c.label, c.count])).toEqual([[null, 'All', 3], ['technical', 'Technical', 1], ['cyber', 'Cyber', 2]]);
  });

  it('lifecycle: a stage deactivated in Settings is skipped; required stages never are', () => {
    expect(REQUIRED_STAGES).toEqual(['initiative', 'clos', 'annule']);
    const skip = new Set(['fat', 'expedition']);
    expect(nextActiveStage(STAGE_ORDER, 'fabrication_assemblage', skip)).toBe('chantier');
    expect(transitionsOf('fabrication_assemblage', skip)).toEqual(['chantier', 'annule']);
    expect(transitionsOf('fabrication_assemblage')).toEqual(['fat', 'annule']);
    expect([isTransitionAllowed('fabrication_assemblage', 'fat', skip), isTransitionAllowed('fabrication_assemblage', 'chantier', skip)]).toEqual([false, true]);
    expect(moveError('fabrication_assemblage', 'fat', 'auto', [], '', skip)).toBe('This stage change is not allowed');
    expect(deliverableToggle('fabrication_assemblage', 'fabrication_assemblage', [true, false], 1, true, skip).advanceTo).toBe('chantier');
    // Clos is required: deactivating it never skips it.
    expect(nextActiveStage(STAGE_ORDER, 'garantie', new Set(['clos']))).toBe('clos');
  });
});
