import 'server-only';
// Minimal .xlsx reader for the P&ID tag import: the first worksheet of an Office Open XML workbook as rows of cell
// texts (shared strings, inline strings, numbers, booleans; formulas give their cached value). No dependency: the ZIP
// container is read from its central directory and entries are inflated with node:zlib. Merged cells, styles, dates
// and the other sheets are ignored. Throws an English message when the file is not a readable workbook.
import { inflateRawSync } from 'node:zlib';

const MAX_ENTRY = 20 * 1024 * 1024;
/**
 * Columns and rows read: a tag list has a dozen columns and at most 5 000 lines (PID_IMPORT_LIMITS, which still sees
 * "too many lines" past it). Cells beyond, and blank cells, never grow a row: a crafted reference such as
 * "AAAAAAAAAA1" cannot make the reader allocate billions of cells.
 */
const MAX_COLS = 256;
const MAX_ROWS = 10_000;

function entries(buf: Buffer): Map<string, () => Buffer> {
  // End of central directory: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('The file is not an Excel workbook (.xlsx)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, () => Buffer>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The workbook is damaged');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    out.set(name, () => {
      if (size > MAX_ENTRY) throw new Error('The workbook is too large');
      if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('The workbook is damaged');
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
      throw new Error('The workbook uses an unsupported compression');
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const decode = (s: string) =>
  s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (_m, e: string) =>
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)),
  );
/** Concatenated `<t>` texts of a string item (rich-text runs included; phonetic runs skipped). */
const textOf = (xml: string) => decode([...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

/** Column index of a cell reference ("B12" → 1); Infinity past the last column read (more than 2 letters ≥ 702). */
function colOf(ref: string): number {
  const letters = ref.replace(/\d+$/, '');
  if (letters.length > 2) return Infinity;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** First worksheet path: workbook order through the relationships, else the first worksheets/*.xml. */
function firstSheetPath(files: Map<string, () => Buffer>): string {
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb().toString('utf8'))?.[1];
    const target = rid ? new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*\\bTarget="([^"]+)"`).exec(rels().toString('utf8'))?.[1] ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${rid}"`).exec(rels().toString('utf8'))?.[1] : undefined;
    if (target) {
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      if (files.has(path)) return path;
    }
  }
  const sheets = [...files.keys()].filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort();
  if (!sheets.length) throw new Error('The workbook has no worksheet');
  return sheets[0];
}

/** Rows of the first worksheet (trimmed cell texts; empty rows dropped). */
export function readXlsxFirstSheet(buf: Buffer): string[][] {
  const files = entries(buf);
  const shared = files.get('xl/sharedStrings.xml');
  const strings = shared ? [...shared().toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const xml = files.get(firstSheetPath(files))!().toString('utf8');
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    let next = 0;
    for (const cm of (rm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? colOf(ref) : next;
      next = col + 1;
      if (col >= MAX_COLS) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 's') text = v != null ? (strings[Number(v)] ?? '') : '';
      else if (type === 'inlineStr') text = textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (type === 'b') text = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
      else text = v != null ? decode(v) : '';
      text = text.trim();
      if (!text) continue;
      while (row.length < col) row.push('');
      row[col] = text;
    }
    if (row.length) rows.push(row);
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}

/** Looks like a ZIP container ("PK\x03\x04"). */
export const isZip = (buf: Buffer) => buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
