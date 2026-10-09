// Test helper: the text drawn in an uncompressed pdfkit PDF (hex strings of the TJ operators, WinAnsi → Unicode).
const CP1252: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

/** Lines of text of an uncompressed PDF (one per TJ / Tj operator). */
export function pdfTextLines(pdf: Uint8Array): string[] {
  const src = Buffer.from(pdf).toString('latin1');
  const out: string[] = [];
  for (const m of src.matchAll(/\[((?:<[0-9a-fA-F]*>\s*-?\d*\.?\d*\s*)+)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
    const hexes = m[1] ? [...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]) : [m[2]];
    let s = '';
    for (const h of hexes) for (let i = 0; i + 1 < h.length; i += 2) {
      const c = parseInt(h.slice(i, i + 2), 16);
      s += CP1252[c] ?? String.fromCharCode(c);
    }
    out.push(s);
  }
  return out;
}
