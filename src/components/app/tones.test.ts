import { describe, expect, it } from 'vitest';
import {
  TAG_CLASS,
  healthTone,
  lifecycleCode,
  lifecycleDot,
  lifecycleTone,
  levelColor,
  raciCell,
  riskCell,
  riskLevel,
  shade,
  statusTagClass,
  statusTone,
} from './tones';

// Golden values from the prototype helpers (docs/spec/02 DS-TONES; logic lines in comments).
describe('tones', () => {
  it('health tags (3916)', () => {
    expect(TAG_CLASS[healthTone('off_track')]).toBe('tag tag-accent');
    expect(TAG_CLASS[healthTone('at_risk')]).toBe('tag tag-outline');
    expect(TAG_CLASS[healthTone('on_track')]).toBe('tag tag-neutral');
    expect(TAG_CLASS[healthTone(null)]).toBe('text-muted');
  });

  it('lifecycle statusTag (3917) accepts codes and French labels', () => {
    expect(lifecycleTone('Initiative')).toBe('outline');
    expect(lifecycleTone('APD')).toBe('outline');
    expect(lifecycleTone('Garantie')).toBe('outline');
    expect(lifecycleTone('Fabrication & Assemblage')).toBe('accent');
    expect(lifecycleTone('Mise Service & SAT')).toBe('accent');
    expect(lifecycleTone('chantier')).toBe('accent');
    expect(lifecycleTone('Clos')).toBe('neutral');
    expect(lifecycleTone('annule')).toBe('neutral');
    expect(lifecycleCode('Études')).toBe('etudes');
    expect(lifecycleDot('Fabrication & Assemblage').ring).toContain('0 0 10px');
    expect(lifecycleDot('Clos').dot).toBe('var(--color-neutral-500)');
    expect(lifecycleDot('APS').dot).toBe('var(--color-accent-700)');
  });

  it('object mappings follow the prototype else-branches', () => {
    expect(statusTagClass('po', 'partially_received')).toBe('tag tag-accent');
    expect(statusTagClass('po', 'ordered')).toBe('tag tag-outline');
    expect(statusTagClass('po', 'cancelled')).toBe('tag tag-neutral');
    expect(statusTone('eco', 'impact_analysis')).toBe('outline');
    expect(statusTone('eco', 'in_approval')).toBe('accent');
    expect(statusTone('part', 'obsolete')).toBe('accent');
    expect(statusTone('drawing', 'under_review')).toBe('accent');
    expect(statusTone('receipt', 'qc_pending')).toBe('outline');
    expect(statusTone('ncr', 'root_cause')).toBe('outline');
    expect(statusTone('deliverable', 'submitted')).toBe('accent');
    expect(statusTone('rfq', 'open')).toBe('outline');
    expect(statusTone('supplierInvoice', 'awaiting_receipt')).toBe('outline');
    expect(statusTone('site', 'not_required')).toBe('neutral');
    expect(statusTone('site', 'go_with_reserve')).toBe('outline');
    expect(statusTone('punch', 'open')).toBe('accent');
    expect(statusTone('change', 'draft')).toBe('outline');
    expect(statusTone('budgetChange', 'approved')).toBe('accent');
    expect(statusTone('activity', 'not_started')).toBe('muted');
    expect(statusTone('milestone', 'at_risk')).toBe('outline');
    expect(statusTone('po', null)).toBe('muted');
  });

  it('risk level and matrix cells (4574–4576)', () => {
    expect(riskLevel(15)).toBe('critical');
    expect(riskLevel(8)).toBe('high');
    expect(riskLevel(4)).toBe('medium');
    expect(riskLevel(3)).toBe('low');
    expect(riskCell(3, 5)).toEqual({ bg: 'var(--color-accent-500)', fg: 'var(--color-accent-100)' });
    expect(riskCell(2, 2)).toEqual({ bg: 'var(--color-accent-900)', fg: 'var(--color-neutral-300)' });
    expect(riskCell(1, 3).bg).toBe('var(--color-neutral-900)');
  });

  it('allocation shade (3867), skill level (4392), RACI (4935)', () => {
    expect(shade(116)).toEqual({ bg: 'var(--color-accent-400)', fg: 'var(--color-bg)' });
    expect(shade(101).bg).toBe('var(--color-accent-600)');
    expect(shade(90).bg).toBe('var(--color-accent-800)');
    expect(shade(60).bg).toBe('var(--color-accent-900)');
    expect(shade(59).bg).toBe('var(--color-neutral-900)');
    expect(levelColor(4)).toBe('var(--color-accent-400)');
    expect(levelColor(0)).toBe('transparent');
    expect(raciCell('A')).toEqual({ color: 'var(--color-accent-100)', bg: 'var(--color-accent-800)', border: '1px solid var(--color-neutral-800)' });
    expect(raciCell('').border).toBe('1px dashed var(--color-neutral-900)');
  });
});
