// The extra dictionaries are merged into one object (index.ts): a key translated differently in two files silently takes
// the last file's translation everywhere. Delivery 7's lots were written in parallel ("Release" was "Libérer" for a
// guarantee and "Libération" for a stock movement): each d7 key must agree with every other dictionary.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.join(process.cwd(), 'src/i18n/extra');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;

describe('extra dictionaries', () => {
  it('a delivery 7 key has one French translation across every dictionary', () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
    const all = [...files.map((f) => ({ file: f, dict: read(path.join(DIR, f)) })), { file: 'fr-dict.json', dict: read(path.join(DIR, '..', 'fr-dict.json')) }];
    const clashes: string[] = [];
    for (const d7 of all.filter((d) => d.file.startsWith('d7-')))
      for (const [key, fr] of Object.entries(d7.dict))
        for (const other of all)
          if (other !== d7 && key in other.dict && other.dict[key] !== fr) clashes.push(`${key}: ${d7.file} "${fr}" ≠ ${other.file} "${other.dict[key]}"`);
    expect(clashes).toEqual([]);
  });
});
