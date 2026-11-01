import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, pageOf, pageSlice, pageWindow } from './pagination';

describe('pagination (R-017)', () => {
  it('reads ?page= as a positive page number, 1 by default', () => {
    expect(pageOf(undefined)).toBe(1);
    expect(pageOf('3')).toBe(3);
    expect(pageOf(['2', '5'])).toBe(2);
    expect(pageOf('0')).toBe(1);
    expect(pageOf('-2')).toBe(1);
    expect(pageOf('2.5')).toBe(1);
    expect(pageOf('abc')).toBe(1);
  });

  it('clamps the page to the last one', () => {
    expect(pageWindow(250, 9)).toEqual({ page: 3, pages: 3, offset: 200, limit: PAGE_SIZE, total: 250 });
    expect(pageWindow(0, 4)).toEqual({ page: 1, pages: 1, offset: 0, limit: PAGE_SIZE, total: 0 });
  });

  it('keeps a list shorter than a page whole on page 1 (the demo lists show as before)', () => {
    const rows = Array.from({ length: 42 }, (_, i) => i);
    const { rows: shown, window } = pageSlice(rows, 1);
    expect(shown).toEqual(rows);
    expect(window.pages).toBe(1);
  });

  it('slices the requested page', () => {
    const rows = Array.from({ length: 205 }, (_, i) => i);
    expect(pageSlice(rows, 2).rows[0]).toBe(100);
    expect(pageSlice(rows, 3).rows).toEqual([200, 201, 202, 203, 204]);
  });
});
