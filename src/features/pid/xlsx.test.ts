// Minimal .xlsx reader (src/features/pid/xlsx.ts) on workbooks built here: shared and inline strings, numbers,
// booleans, sparse cells, stored and deflated entries, the first sheet found through the workbook relationships, and
// the errors on files that are not workbooks.
import { describe, expect, it } from 'vitest';
import { zip } from './test-xlsx';
import { isZip, readXlsxFirstSheet } from './xlsx';

const WORKBOOK = {
  'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Tags" sheetId="1" r:id="rId3"/><sheet name="Other" sheetId="2" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId3" Target="worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml':
    '<sst><si><t>Tag</t></si><si><t>Description</t></si><si><r><t>Level transmitter </t></r><r><t xml:space="preserve">— RM &amp; tank</t></r></si><si><t>Instrument</t></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Wrong sheet</t></is></c></row></sheetData></worksheet>',
  'xl/worksheets/sheet2.xml':
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Sheet</t></is></c></row>' +
    '<row r="2"/>' +
    '<row r="3"><c r="A3" t="inlineStr"><is><t>LT-101</t></is></c><c r="B3" t="s"><v>2</v></c><c r="C3" t="s"><v>3</v></c><c r="D3"><v>2</v></c><c r="E3" t="b"><v>1</v></c></row>' +
    '<row r="4"><c r="A4" t="str"><f>CONCAT("XV","-111")</f><v>XV-111</v></c><c r="B4" t="inlineStr"><is><t>Valve &#8212; line</t></is></c></row>' +
    '</sheetData></worksheet>',
};

describe('readXlsxFirstSheet', () => {
  it('reads the first sheet in workbook order: shared / rich / inline strings, numbers, booleans, formulas, sparse cells', () => {
    const expected = [
      ['Tag', 'Description', '', 'Sheet'],
      ['LT-101', 'Level transmitter — RM & tank', 'Instrument', '2', 'TRUE'],
      ['XV-111', 'Valve — line'],
    ];
    expect(readXlsxFirstSheet(zip(WORKBOOK))).toEqual(expected);
    expect(readXlsxFirstSheet(zip(WORKBOOK, true))).toEqual(expected);
    expect(isZip(zip(WORKBOOK))).toBe(true);
  });

  it('without workbook relationships: the first worksheets/*.xml', () => {
    expect(readXlsxFirstSheet(zip({ 'xl/worksheets/sheet1.xml': WORKBOOK['xl/worksheets/sheet1.xml'] }))).toEqual([['Wrong sheet']]);
  });

  it('bounded: cells past the 256th column and blank cells never grow a row (crafted references)', () => {
    const sheet =
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Tag</t></is></c><c r="AAAAAAAAAAAA1" t="inlineStr"><is><t>far</t></is></c><c t="inlineStr"><is><t>after</t></is></c></row>' +
      '<row r="2"><c r="IV2" t="inlineStr"><is><t>col 256</t></is></c><c r="IW2" t="inlineStr"><is><t>col 257</t></is></c><c r="ZZ2"/></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>LT-101</t></is></c><c r="XFD3" t="inlineStr"><is><t> </t></is></c></row>' +
      '</sheetData></worksheet>';
    const rows = readXlsxFirstSheet(zip({ 'xl/worksheets/sheet1.xml': sheet }));
    expect(rows.map((r) => r.length)).toEqual([1, 256, 1]);
    expect([rows[0], rows[1][255], rows[2]]).toEqual([['Tag'], 'col 256', ['LT-101']]);
  });

  it('errors', () => {
    expect(() => readXlsxFirstSheet(Buffer.from('Tag,Description\nLT-101,x'))).toThrow('The file is not an Excel workbook (.xlsx)');
    expect(() => readXlsxFirstSheet(zip({ 'word/document.xml': '<w/>' }))).toThrow('The workbook has no worksheet');
    expect(isZip(Buffer.from('Tag'))).toBe(false);
  });
});
