// R-108 (E-6 = a): a tag's candidates come from the whole catalogue — text search on the reference or the name, type filter
// (default: the tag kind's compatible types), the project BOM's articles first, at most 20 with a "refine" flag. R-109 (A-9 = a):
// the gap between the revision of Keystone's tag list and Codex's reference revision (E-5: a Draft points to the previous
// revision; an Obsolete record is excluded), in the order `nextRevision` follows; revisions that cannot be ordered are only
// "different", never "ahead".
import { describe, expect, it } from 'vitest';
import type { PartType } from '@/server/db/codes';
import { PID_SEARCH_LIMIT, compareRevisions, nextRevision, pidBomQuantity, pidRevisionGap, pidTypeFilterOf, searchPidCandidates } from './pid';

const part = (ref: string, name: string, type: PartType) => ({ ref, name, type });
const CATALOGUE = [
  part('EL-SWG-11KV', 'Switchgear 11 kV', 'electrical'),
  part('KS-STL-0450', 'Steel plate S355', 'structural'),
  part('EL-PT-100', 'Pressure transmitter', 'electronics'),
  part('FD-DET-OPT', 'Optical flame detector', 'fire_safety'),
  part('CR-BRG-SKF', 'Slewing bearing', 'mechanical'),
  part('EL-TT-200', 'Temperature transmitter', 'electronics'),
];

describe('R-108 catalogue search of a tag’s candidates', () => {
  const bom = new Set(['FD-DET-OPT', 'CR-BRG-SKF']);
  const refs = (r: { rows: { ref: string }[] }) => r.rows.map((x) => x.ref);

  it('default: the compatible types of the tag kind, the BOM’s articles first (marked), then catalogue order', () => {
    const r = searchPidCandidates(CATALOGUE, { kind: 'instrument', q: '', type: 'compatible', bomRefs: bom });
    expect(refs(r)).toEqual(['FD-DET-OPT', 'EL-SWG-11KV', 'EL-PT-100', 'EL-TT-200']);
    expect(r.rows.map((x) => x.inBom)).toEqual([true, false, false, false]);
    expect(refs(searchPidCandidates(CATALOGUE, { kind: 'equipment', q: '', type: 'compatible', bomRefs: bom }))).toEqual(['CR-BRG-SKF', 'EL-SWG-11KV']);
  });

  it('text on reference or name, case-insensitive, every word; the French name through `display`; any type with "all"', () => {
    expect(refs(searchPidCandidates(CATALOGUE, { kind: 'instrument', q: 'transmitter', type: 'compatible', bomRefs: bom }))).toEqual(['EL-PT-100', 'EL-TT-200']);
    expect(refs(searchPidCandidates(CATALOGUE, { kind: 'instrument', q: 'el- temp', type: 'compatible', bomRefs: bom }))).toEqual(['EL-TT-200']);
    expect(refs(searchPidCandidates(CATALOGUE, { kind: 'instrument', q: 'ks-stl', type: 'compatible', bomRefs: bom }))).toEqual([]);
    expect(refs(searchPidCandidates(CATALOGUE, { kind: 'instrument', q: 'ks-stl', type: 'all', bomRefs: bom }))).toEqual(['KS-STL-0450']);
    expect(refs(searchPidCandidates(CATALOGUE, { kind: 'instrument', q: '', type: 'mechanical', bomRefs: bom }))).toEqual(['CR-BRG-SKF']);
    const fr = (p: { ref: string }) => (p.ref === 'EL-PT-100' ? 'Transmetteur de pression' : '');
    expect(refs(searchPidCandidates(CATALOGUE, { kind: 'instrument', q: 'transmetteur', type: 'compatible', bomRefs: bom, display: fr }))).toEqual(['EL-PT-100']);
  });

  it('at most 20 results, with a "refine the search" flag beyond', () => {
    const many = Array.from({ length: 25 }, (_, i) => part(`EL-X-${String(i).padStart(2, '0')}`, 'Sensor', 'electronics'));
    const r = searchPidCandidates(many, { kind: 'instrument', q: 'sensor', type: 'compatible', bomRefs: new Set(['EL-X-24']) });
    expect([r.rows.length, r.more, r.rows[0].ref]).toEqual([PID_SEARCH_LIMIT, true, 'EL-X-24']);
    expect(searchPidCandidates(many.slice(0, 20), { kind: 'instrument', q: '', type: 'all', bomRefs: new Set() }).more).toBe(false);
  });

  it('URL type filter and the quantity of "Link and add to the BOM"', () => {
    expect([pidTypeFilterOf(undefined), pidTypeFilterOf('all'), pidTypeFilterOf('electronics'), pidTypeFilterOf('rockets')]).toEqual(['compatible', 'all', 'electronics', 'compatible']);
    expect([pidBomQuantity(undefined), pidBomQuantity(''), pidBomQuantity('2'), pidBomQuantity(' 2,5 '), pidBomQuantity(3)]).toEqual([1, 1, 2, 2.5, 3]);
    expect([pidBomQuantity('0'), pidBomQuantity('-1'), pidBomQuantity('abc'), pidBomQuantity('2000000'), pidBomQuantity({})]).toEqual([null, null, null, null, null]);
  });
});

describe('R-109 revision gap with Codex (A-9 = a)', () => {
  it('revision order follows nextRevision: A…Y, Z, Z1, Z2…; numbers numerically; anything else is not compared', () => {
    expect(['A', 'C', 'Y', 'Z', '02', '9'].map(nextRevision)).toEqual(['B', 'D', 'Z', 'Z1', '03', '10']);
    expect([compareRevisions('C', 'D'), compareRevisions('D', 'C'), compareRevisions('C', 'C'), compareRevisions('Y', 'Z'), compareRevisions('Z', 'Z1'), compareRevisions('Z1', 'Z2')]).toEqual([-1, 1, 0, -1, -1, -1]);
    expect([compareRevisions('9', '10'), compareRevisions('02', '10'), compareRevisions('C1', 'D'), compareRevisions('C', '3'), compareRevisions('B.2', 'C')]).toEqual([-1, -1, null, null, null]);
  });

  it('Codex Released / Frozen ahead of the tags → re-import suggested at Codex’s revision', () => {
    expect(pidRevisionGap('C', 'D', 'released')).toEqual({ ahead: true, different: false, referenceRevision: 'D' });
    expect(pidRevisionGap('C', 'E', 'frozen')).toEqual({ ahead: true, different: false, referenceRevision: 'E' });
    expect(pidRevisionGap('C', 'D', 'release_proposed')).toEqual({ ahead: true, different: false, referenceRevision: 'D' });
  });

  it('E-5: a Codex Draft makes the previous revision the reference', () => {
    expect(pidRevisionGap('C', 'E', 'draft')).toEqual({ ahead: true, different: false, referenceRevision: 'D' });
    expect(pidRevisionGap('C', 'D', 'draft')).toBeNull();
  });

  it('nothing to report: same revision, Codex behind, an Obsolete record (excluded on purpose), no Codex record', () => {
    expect(pidRevisionGap('D', 'D', 'released')).toBeNull();
    expect(pidRevisionGap('E', 'D', 'released')).toBeNull();
    expect(pidRevisionGap('C', 'D', 'obsolete')).toBeNull();
    expect(pidRevisionGap('C', null, null)).toBeNull();
    expect(pidRevisionGap('C', 'D', 'mystery')).toBeNull();
  });

  it('revisions that cannot be ordered ("C1" vs "D") are only "different", never "ahead"', () => {
    expect(pidRevisionGap('C1', 'D', 'released')).toEqual({ ahead: false, different: true, referenceRevision: 'D' });
    expect(pidRevisionGap('D', '3', 'released')).toEqual({ ahead: false, different: true, referenceRevision: '3' });
  });
});
