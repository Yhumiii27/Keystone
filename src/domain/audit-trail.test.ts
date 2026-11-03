import { describe, expect, it } from 'vitest';
import { changedValues, isSystemActor } from './audit-trail';

describe('changedValues (R-168: compact before / after)', () => {
  it('keeps only the fields whose value changed, with the same keys on both sides', () => {
    expect(changedValues({ status: 'draft', amount: 10, title: 'A' }, { status: 'sent', amount: 10, title: 'A' })).toEqual({
      before: { status: 'draft' }, after: { status: 'sent' },
    });
  });

  it('ignores the fields absent from the change (undefined) and reads a field missing before as null', () => {
    expect(changedValues({ a: 1 }, { a: undefined, b: 'x' })).toEqual({ before: { b: null }, after: { b: 'x' } });
  });

  it('compares arrays, objects and dates by value', () => {
    expect(changedValues({ days: [1, 2], at: new Date('2026-09-25T00:00:00Z'), fx: { r: 1 } }, { days: [1, 2], at: new Date('2026-09-25T00:00:00Z'), fx: { r: 1 } })).toBeNull();
    expect(changedValues({ days: [1, 2] }, { days: [1, 2, 3] })).toEqual({ before: { days: [1, 2] }, after: { days: [1, 2, 3] } });
  });

  it('treats null and a missing value alike, and returns null when nothing changed', () => {
    expect(changedValues({ note: null }, { note: null })).toBeNull();
    expect(changedValues({}, { note: null })).toBeNull();
    expect(changedValues({ note: 'x' }, { note: null })).toEqual({ before: { note: 'x' }, after: { note: null } });
  });
});

describe('isSystemActor', () => {
  it('knows the systems, any case, and an empty actor', () => {
    expect(isSystemActor('codex')).toBe(true);
    expect(isSystemActor('')).toBe(true);
    expect(isSystemActor('Claire Martin')).toBe(false);
  });
});
