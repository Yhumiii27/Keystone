// Import dialog helpers and the staged-plan view: the revision read from a file name, the staged view in EN / FR
// (revision line, meta, counts, details, the cut of long lists, the notes that block the import).
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ stagePidImportAction: vi.fn(), applyPidImportAction: vi.fn() }));

import { parseDelimited, parsePidTagList, planPidImport, type ExistingPidTag } from '@/domain/pid-import';
import { makeT } from '@/i18n/translate';
import { revisionOfFileName } from './import-dialog';
import { STAGE_LINES_SHOWN, pidStageView } from './import-model';
import { importToastT, revisionLineT } from './i18n';

const EXISTING: ExistingPidTag[] = [
  { tag: 'LT-101', description: 'Level transmitter', kind: 'instrument', scope: 'overlay', partRef: 'EL-PLC-S7', note: '', activityCode: 'A1410', plcType: 'P', stateFeedback: '', role: 'sensor', sheet: 1 },
];
const plan = (text: string, mode: 'merge' | 'replace' = 'merge') =>
  planPidImport(parsePidTagList(parseDelimited(text)), EXISTING, mode, { catalogue: new Set(['EL-PLC-S7']), activities: new Set(['A1410']) });
const view = (text: string, lang: 'en' | 'fr', over: Partial<Parameters<typeof pidStageView>[0]> = {}) =>
  pidStageView({ plan: plan(text, over.mode), revision: 'E', currentRevision: 'C', documentNumber: 'PID-HLT-026', source: 'excel', mode: 'merge', fileName: '', projectCode: 'HLT-026', ...over }, makeT(lang), lang);

describe('revisionOfFileName', () => {
  it('reads "rev" followed by 1–3 letters or digits', () => {
    expect(['PID-HLT-026_revE_tags.xlsx', 'P&ID rev C.csv', 'PID-rev02.xlsx', 'tags-REV-d1.tsv', 'previous.csv', 'reverse_tags.csv', 'PID-HLT-026.xlsx'].map(revisionOfFileName))
      .toEqual(['E', 'C', '02', 'D1', null, null, null]);
  });
});

describe('pidStageView', () => {
  const CSV = 'Tag,Description,Kind,Reference\nLT-101,Level transmitter,Instrument,EL-SWG-11KV\nXV-9,Valve,Instrument,\nZZ-1,Thing,Pump,';

  it('EN and FR: revision line, meta, counts, details with warnings', () => {
    const en = view(CSV, 'en');
    expect([en.revisionLine, en.meta, en.counts.map((c) => c.count), en.canImport]).toEqual(['Revision C → E', 'Excel list · Add & update · Pasted cells', [1, 0, 1, 0, 1], true]);
    expect(en.lines.map((l) => [l.tag, l.change, l.changeClass, l.details])).toEqual([
      ['LT-101', 'Unchanged', 'tag tag-neutral', [{ text: 'Mapping kept in Keystone (EL-PLC-S7; the file gives EL-SWG-11KV)', warn: true }]],
      ['XV-9', 'New', 'tag tag-accent', []],
      ['ZZ-1', 'Rejected', 'tag tag-outline', [{ text: 'Invalid kind "Pump" (Instrument or Equipment)', warn: true }]],
    ]);
    const fr = view(CSV, 'fr');
    expect([fr.revisionLine, fr.meta, fr.columns, fr.lines[0].details[0].text, fr.lines[2].details[0].text]).toEqual([
      'Révision C → E', 'Liste Excel · Ajouter & mettre à jour · Cellules collées', 'Colonnes reconnues : Tag, Description, Nature, Référence',
      'Association conservée dans Keystone (EL-PLC-S7 ; le fichier indique EL-SWG-11KV)', 'Nature « Pump » invalide (Instrument ou Équipement)',
    ]);
  });

  it('notes that block the import; registering a first P&ID; long lists are cut', () => {
    expect(view('Tag,Description\nLT-101,Level transmitter', 'en', { revision: 'C' })).toMatchObject({ canImport: false, note: 'Nothing to import: every tag is unchanged', revisionLine: 'Revision C (unchanged)' });
    // Same tags, new revision: the import records the revision.
    expect(view('Tag,Description\nLT-101,Level transmitter', 'en')).toMatchObject({ canImport: true, note: null });
    expect(view('Tag,Kind\nLT-101,Instrument', 'fr')).toMatchObject({ canImport: false, note: 'Aucune colonne « Description » dans le fichier', lines: [] });
    expect(view('Tag,Description\nNEW-1,', 'en')).toMatchObject({ canImport: false, note: 'No valid tag in the file' });
    expect(view('Tag,Description,Kind\nNEW-1,x,Instrument', 'en', { currentRevision: null, documentNumber: null, revision: 'A', projectCode: 'NDC-031' }).revisionLine).toBe('Registers the project’s P&ID · PID-NDC-031 rev A');
    const many = ['Tag,Description,Kind', ...Array.from({ length: STAGE_LINES_SHOWN + 5 }, (_, i) => `T-${i},Tag ${i},Instrument`)].join('\n');
    const v = view(many, 'en', { mode: 'replace' });
    expect([v.lines.length, v.more, v.counts.find((c) => c.key === 'removed')!.count]).toEqual([STAGE_LINES_SHOWN, '… 6 more lines', 1]);
    expect(view(many, 'fr').more).toBe('… 5 lignes de plus');
  });

  it('toasts and revision lines', () => {
    const c = { imported: 27, new: 3, updated: 1, removed: 0, rejected: 0 };
    expect([importToastT(c, 'E', 'en'), importToastT(c, 'E', 'fr')]).toEqual(['27 tags · rev E imported · 3 new · 1 updated', '27 tags · rév. E importés · 3 nouveaux · 1 mis à jour']);
    const one = { imported: 1, new: 1, updated: 0, removed: 1, rejected: 1 };
    expect([importToastT(one, 'B', 'en'), importToastT(one, 'B', 'fr')]).toEqual([
      '1 tag · rev B imported · 1 new · 0 updated · 1 removed · 1 rejected', '1 tag · rév. B importé · 1 nouveau · 0 mis à jour · 1 supprimé · 1 refusé',
    ]);
    expect([revisionLineT(null, 'A', 'PID-X', 'fr'), revisionLineT('A', 'A', null, 'fr')]).toEqual(['Enregistre le PID du projet · PID-X rév. A', 'Révision A (inchangée)']);
  });
});
