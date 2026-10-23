// R-185 part 2: which equipment line a record belongs to — choice in a form, URL filter, grouping by line, line removal rule.
import { describe, expect, it } from 'vitest';
import {
  COMMON_EQUIPMENT, equipmentChoiceOf, equipmentFilterOf, equipmentRemovalBlocker, filterByEquipment, groupByEquipment, lineOfRef, mainLineOf, sameEquipment,
  showsEquipment,
} from './equipment-scope';

const LINES = [
  { ref: 'EQ-02', position: 1 },
  { ref: 'EQ-01', position: 0 },
  { ref: 'EQ-03', position: 2 },
];
const REFS = LINES.map((l) => l.ref);

describe('equipment scope (R-185 part 2)', () => {
  it('shows the equipment only with more than one line', () => {
    expect(showsEquipment([])).toBe(false);
    expect(showsEquipment([LINES[0]])).toBe(false);
    expect(showsEquipment(LINES)).toBe(true);
  });

  it('the main line is the lowest position; a reference names its line, none the main one', () => {
    expect(mainLineOf(LINES)?.ref).toBe('EQ-01');
    expect(mainLineOf([])).toBeNull();
    expect(lineOfRef(LINES)?.ref).toBe('EQ-01');
    expect(lineOfRef(LINES, '')?.ref).toBe('EQ-01');
    expect(lineOfRef(LINES, 'EQ-03')?.ref).toBe('EQ-03');
    expect(lineOfRef(LINES, 'EQ-09')).toBeNull();
    expect(lineOfRef([], null)).toBeNull();
  });

  it('a form choice: common by default, a line of the project, anything else refused', () => {
    expect(equipmentChoiceOf(undefined, REFS)).toEqual({ ok: true, value: null });
    expect(equipmentChoiceOf('', REFS)).toEqual({ ok: true, value: null });
    expect(equipmentChoiceOf(COMMON_EQUIPMENT, REFS)).toEqual({ ok: true, value: null });
    expect(equipmentChoiceOf(' EQ-02 ', REFS)).toEqual({ ok: true, value: 'EQ-02' });
    expect(equipmentChoiceOf('EQ-09', REFS)).toEqual({ ok: false, error: 'Unknown equipment line' });
    expect(equipmentChoiceOf('EQ-01', [])).toEqual({ ok: false, error: 'Unknown equipment line' });
  });

  it('a list filter: all (default and unknown values), common, or a line', () => {
    expect(equipmentFilterOf(undefined, REFS)).toBe('all');
    expect(equipmentFilterOf('nope', REFS)).toBe('all');
    expect(equipmentFilterOf('common', REFS)).toBe('common');
    expect(equipmentFilterOf(['EQ-03', 'EQ-01'], REFS)).toBe('EQ-03');
    const rows = [{ n: 1, equipmentRef: 'EQ-01' }, { n: 2, equipmentRef: null }, { n: 3, equipmentRef: 'EQ-02' }];
    expect(filterByEquipment(rows, 'all').map((r) => r.n)).toEqual([1, 2, 3]);
    expect(filterByEquipment(rows, 'common').map((r) => r.n)).toEqual([2]);
    expect(filterByEquipment(rows, 'EQ-02').map((r) => r.n)).toEqual([3]);
  });

  it('groups rows by line in the lines’ order, common last, empty groups left out', () => {
    const rows = [
      { n: 'a', equipmentRef: 'EQ-02' }, { n: 'b', equipmentRef: null }, { n: 'c', equipmentRef: 'EQ-01' }, { n: 'd', equipmentRef: 'EQ-07' }, { n: 'e', equipmentRef: 'EQ-02' },
    ];
    expect(groupByEquipment(rows, LINES).map((g) => [g.ref, g.rows.map((r) => r.n)])).toEqual([
      ['EQ-01', ['c']], ['EQ-02', ['a', 'e']], [null, ['b', 'd']],
    ]);
    expect(groupByEquipment([], LINES)).toEqual([]);
  });

  it('two records concern each other when on the same line or one is common', () => {
    expect(sameEquipment('EQ-01', 'EQ-01')).toBe(true);
    expect(sameEquipment(null, 'EQ-02')).toBe(true);
    expect(sameEquipment('EQ-01', undefined)).toBe(true);
    expect(sameEquipment('EQ-01', 'EQ-02')).toBe(false);
  });

  it('a line whose plan has inspections is not removed', () => {
    expect(equipmentRemovalBlocker({ inspections: 0 })).toBeNull();
    expect(equipmentRemovalBlocker({ inspections: 2 })).toBe('This equipment line has inspections in its inspection plan');
  });
});
