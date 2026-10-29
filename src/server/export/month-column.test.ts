// R-157: project start / finish ("Dec 2026") exported as real month dates — an Excel date shown as month and year, the month
// in words in the PDF, ISO 'YYYY-MM' in the CSV; text that is not a month ("—") stays as shown.
import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';
import { displayCell, formatMonth } from './format';
import { monthOfText } from './providers/common';
import type { ExportSheet } from './types';
import { readXlsx, toXlsx } from './xlsx';

const SHEET: ExportSheet = {
  name: 'Projects',
  columns: [{ key: 'code', header: 'Code' }, { key: 'start', header: 'Start', type: 'month' }, { key: 'finish', header: 'Finish', type: 'month' }],
  rows: [
    { code: 'HLT-026', start: monthOfText('Jan 2026'), finish: monthOfText('Dec 2026') },
    { code: 'NDC-031', start: monthOfText('—'), finish: monthOfText('Mar 2027') },
  ],
};

describe('month columns (R-157)', () => {
  it('monthOfText: the screens\' month texts become ISO months; anything else stays as shown', () => {
    expect(monthOfText('Dec 2026')).toBe('2026-12');
    expect(monthOfText(' Jan 2027 ')).toBe('2027-01');
    expect(monthOfText('—')).toBe('—');
    expect(monthOfText('12 Dec 2026')).toBe('12 Dec 2026');
  });

  it('PDF / CSV display: month and year in the viewer\'s language, ISO in the CSV', () => {
    expect(formatMonth('2026-12', 'en')).toBe('Dec 2026');
    expect(formatMonth('2026-12', 'fr')).toBe('déc. 2026');
    expect(formatMonth('—', 'fr')).toBe('—');
    expect(displayCell('2027-03', { type: 'month' }, 'en')).toBe('Mar 2027');
    expect(toCsv(SHEET, 'en').split('\r\n')[1]).toBe('HLT-026,2026-01,2026-12');
  });

  it('XLSX: a real date on the first of the month (not a text cell)', async () => {
    const bytes = await toXlsx({ title: 'Projects', sheets: [SHEET] }, {
      lang: 'fr', labels: { sheet: 'Export', title: 'Titre', project: 'Projet', filters: 'Filtres', exportedBy: 'Exporté par', exportedOn: 'Exporté le' },
      exportedBy: 'Marie Lefebvre', exportedOn: new Date('2026-10-09T08:00:00Z'),
    });
    const [sheet] = await readXlsx(bytes);
    expect(sheet.rows[1]).toEqual(['HLT-026', '2026-01-01', '2026-12-01']);
    expect(sheet.rows[2]).toEqual(['NDC-031', '—', '2027-03-01']);
  });
});
