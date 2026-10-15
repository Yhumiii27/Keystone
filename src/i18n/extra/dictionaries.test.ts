// The extra dictionaries are merged into one object (index.ts): a key translated differently in two files silently takes
// the last file's translation everywhere. Delivery 7's lots were written in parallel ("Release" was "Libérer" for a
// guarantee and "Libération" for a stock movement), and so are delivery 8's: every key has ONE French translation across
// every dictionary (fr-dict.json and src/i18n/extra/*.json), and no translation is empty (R-184).
// The only exceptions are the deliberate overrides of a prototype entry (fr-dict.json), each with its decision; the
// integrator adds the other lots' overrides at merge (e.g. R-145 'Warranty cost YTD').
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.join(process.cwd(), 'src/i18n/extra');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;

/** Deliberate overrides of a fr-dict.json entry: key → [file, decision]. */
const OVERRIDES: Record<string, [file: string, decision: string]> = {
  // NEW-D5-3 'a' (R-156): the 'Handover' step is « Transfert », not « Livraison » (goods delivery keeps « livraison »).
  Handover: ['d8-audit-i18n-shell.json', 'NEW-D5-3'],
  'Forecast handover': ['d8-audit-i18n-shell.json', 'NEW-D5-3'],
  'On the critical path — every day this activity finishes late moves the handover date.': ['d8-audit-i18n-shell.json', 'NEW-D5-3'],
  'Steel structure forecast 39 days late; handover moves to 14 Jan 2027.': ['d8-audit-i18n-shell.json', 'NEW-D5-3'],
  'Re-baseline BL2 — handover 14 Jan 2027': ['d8-audit-i18n-shell.json', 'NEW-D5-3'],
  'Change requests affect the contract value or the handover date · deliverables are accepted with a signed PV': ['d8-audit-i18n-shell.json', 'NEW-D5-3'],
  // R-184 (NEW-D1-2): the prototype's entry was the English itself.
  'Action due': ['d8-audit-i18n-shell.json', 'NEW-D1-2'],
  'Client / sponsor': ['d8-audit-i18n-shell.json', 'NEW-D1-2'],
  // NEW-D5-2 'a' (R-145): the tile counts the warranty cost of the calendar year.
  'Warranty cost YTD': ['d8-supply-engineering.json', 'NEW-D5-2'],
};

describe('extra dictionaries', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
  const all = [...files.map((f) => ({ file: f, dict: read(path.join(DIR, f)) })), { file: 'fr-dict.json', dict: read(path.join(DIR, '..', 'fr-dict.json')) }];

  it('a key has one French translation across every dictionary (deliberate overrides of the prototype excepted)', () => {
    const clashes: string[] = [];
    for (let i = 0; i < all.length; i++)
      for (const [key, fr] of Object.entries(all[i].dict))
        for (const other of all.slice(i + 1)) {
          if (!(key in other.dict) || other.dict[key] === fr) continue;
          const allowed = OVERRIDES[key];
          if (allowed && other.file === 'fr-dict.json' && allowed[0] === all[i].file) continue;
          clashes.push(`${key}: ${all[i].file} "${fr}" ≠ ${other.file} "${other.dict[key]}"`);
        }
    expect(clashes).toEqual([]);
  });

  it('every override is still one (the key is in fr-dict.json with another French) and comes from its file', () => {
    const proto = all.find((d) => d.file === 'fr-dict.json')!.dict;
    for (const [key, [file, decision]] of Object.entries(OVERRIDES)) {
      const dict = all.find((d) => d.file === file)?.dict ?? {};
      expect([key, decision, key in proto, key in dict && dict[key] !== proto[key]]).toEqual([key, decision, true, true]);
    }
  });

  it('no translation is empty and every value is a string', () => {
    const bad = all.flatMap((d) => Object.entries(d.dict).filter(([, v]) => typeof v !== 'string' || !v.trim()).map(([k]) => `${d.file}: ${k}`));
    expect(bad).toEqual([]);
  });
});
