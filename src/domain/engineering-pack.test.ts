// R-191: pure rules of the engineering pack — validation of a standard list, the multi-equipment union (R-185) and the weighted
// completeness (same formula as pub_pack_ingenierie.pct_pondere).
import { describe, expect, it } from 'vitest';
import {
  PACK_DOCUMENT_TYPES, PACK_FAMILIES, PACK_INVALID_ERROR, PACK_WEIGHTS_ERROR, PROVISIONAL_PACK, normalisePackRows, packCompleteness, packStandardError,
  projectPackStandard, type PackStandardRow,
} from './engineering-pack';

const list = (weights: number[], mins: number[] = [1, 1, 1, 1, 1]): PackStandardRow[] =>
  PACK_FAMILIES.map((family, i) => ({ family, weight: weights[i], minExpected: mins[i] }));

describe('standard list', () => {
  it('provisional list: the five K-08 families at 20 %, one document expected each; five Codex types mapped', () => {
    expect(PROVISIONAL_PACK).toEqual(list([20, 20, 20, 20, 20]));
    expect(packStandardError(PROVISIONAL_PACK)).toBeNull();
    expect(PACK_DOCUMENT_TYPES).toEqual({ PID: 'pid', BOM: 'bom', GA: 'layout', SCH: 'electrique', FDS: 'analyse_fonctionnelle' });
  });

  it('weights must total 100 %, whole, 0–100; minimums whole 0–99; every family once', () => {
    expect(packStandardError(list([30, 30, 20, 20, 0]))).toBeNull();
    expect(packStandardError(list([30, 30, 20, 20, 10]))).toBe(PACK_WEIGHTS_ERROR);
    expect(packStandardError(list([20.5, 19.5, 20, 20, 20]))).toBe(PACK_INVALID_ERROR);
    expect(packStandardError(list([120, -20, 0, 0, 0]))).toBe(PACK_INVALID_ERROR);
    expect(packStandardError(list([20, 20, 20, 20, 20], [1, 1, 1, 1, 100]))).toBe(PACK_INVALID_ERROR);
    expect(packStandardError(PROVISIONAL_PACK.slice(0, 4))).toBe(PACK_INVALID_ERROR);
    expect(packStandardError([...PROVISIONAL_PACK.slice(0, 4), { family: 'pid', weight: 20, minExpected: 1 }])).toBe(PACK_INVALID_ERROR);
    expect(packStandardError([...PROVISIONAL_PACK.slice(0, 4), { family: 'hmi', weight: 20, minExpected: 1 }])).toBe(PACK_INVALID_ERROR);
  });

  it('normalisePackRows: contract order, a missing family at weight 0', () => {
    expect(normalisePackRows([{ family: 'layout', weight: 100, minExpected: 2 }]).map((r) => [r.family, r.weight])).toEqual([
      ['pid', 0], ['bom', 0], ['layout', 100], ['electrique', 0], ['analyse_fonctionnelle', 0],
    ]);
  });

  it('multi-equipment (R-185): union of the weighed families, weight of the main type first, highest minimum', () => {
    const main = list([50, 50, 0, 0, 0], [1, 2, 1, 1, 1]);
    const second = list([10, 10, 40, 40, 0], [3, 1, 2, 1, 1]);
    expect(projectPackStandard([main, second])).toEqual([
      { family: 'pid', weight: 50, minExpected: 3 },
      { family: 'bom', weight: 50, minExpected: 2 },
      { family: 'layout', weight: 40, minExpected: 2 },
      { family: 'electrique', weight: 40, minExpected: 1 },
    ]);
    expect(projectPackStandard([PROVISIONAL_PACK, PROVISIONAL_PACK])).toEqual(PROVISIONAL_PACK);
    expect(projectPackStandard([])).toEqual([]);
  });
});

describe('packCompleteness', () => {
  it('HLT-026 demo: P&ID and GA released, two BOMs, the schematics and the FDS not yet → 40 %', () => {
    const r = packCompleteness(PROVISIONAL_PACK, [
      { family: 'pid', status: 'released' }, { family: 'layout', status: 'released' }, { family: 'bom', status: 'frozen' }, { family: 'bom', status: 'draft' },
      { family: 'electrique', status: 'draft' }, { family: 'analyse_fonctionnelle', status: 'frozen' },
    ]);
    expect(r.families.map((f) => [f.family, f.validated, f.expected])).toEqual([
      ['pid', 1, 1], ['bom', 0, 2], ['layout', 1, 1], ['electrique', 0, 1], ['analyse_fonctionnelle', 0, 1],
    ]);
    expect([r.pct, r.measured, r.meetsTarget]).toEqual([40, true, false]);
  });

  it('a family without any document counts 0 % against the minimum; obsolete records are not expected', () => {
    const r = packCompleteness(PROVISIONAL_PACK, [{ family: 'pid', status: 'released' }, { family: 'pid', status: 'obsolete' }]);
    expect(r.families.map((f) => f.expected)).toEqual([1, 1, 1, 1, 1]);
    expect(r.pct).toBe(20);
  });

  it('re-normalised over the families expected (minimum 0 and nothing indexed: left out); 0 when nothing is expected', () => {
    const std = list([20, 20, 20, 20, 20], [1, 0, 0, 0, 0]);
    expect(packCompleteness(std, [{ family: 'pid', status: 'released' }]).pct).toBe(100);
    const none = packCompleteness(list([20, 20, 20, 20, 20], [0, 0, 0, 0, 0]), []);
    expect([none.pct, none.measured, none.meetsTarget]).toEqual([0, false, false]);
  });

  it('partial families and rounding to 0.1; the G2 target is strictly above 80 %', () => {
    const r = packCompleteness(PROVISIONAL_PACK, [
      { family: 'pid', status: 'released' }, { family: 'bom', status: 'released' }, { family: 'bom', status: 'released' }, { family: 'bom', status: 'draft' },
      { family: 'layout', status: 'released' }, { family: 'electrique', status: 'released' }, { family: 'analyse_fonctionnelle', status: 'released' },
    ]);
    expect(r.pct).toBe(93.3);
    expect(r.meetsTarget).toBe(true);
    const exactly80 = packCompleteness(PROVISIONAL_PACK, [
      { family: 'pid', status: 'released' }, { family: 'bom', status: 'released' }, { family: 'layout', status: 'released' }, { family: 'electrique', status: 'released' },
    ]);
    expect([exactly80.pct, exactly80.meetsTarget]).toEqual([80, false]);
  });
});
