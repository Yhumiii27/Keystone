// R-184 (NEW-D1-2, X-12b): every English source string Keystone passes to t() as a literal has its French. The scan reads
// src for t('…') / t("…") literals and t(`…`) templates, outside comments, the prototype data, the tests, the goldens and the
// dev gallery. In a template each ${…} stands for a value: every quoted option of a choice (`${n > 1 ? 'systems' : 'system'}`
// gives two strings to check), nothing when it ends a word (`request${s}`), else "2".
// A string passes when, as the translator renders it (src/i18n/translate.ts):
// - it has an exact French entry that differs from the English (fr-dict.json or src/i18n/extra/*.json; an entry equal to the
//   English is a gap the prototype left), or
// - the first FR_RULES rule that matches it changes it and leaves only values or French around it (a rule that translates
//   "Approved · " but keeps "flux capacitor" is a partial translation), or
// - every " · ", " — ", " → ", " / " segment passes on its own (entry, rule, or a value Keystone formats: numbers, amounts,
//   units, dates) — one translated segment next to English ones fails, or
// - it (or the segment) is on the reviewed list of strings that read the same in French (src/i18n/same-in-french.json).
// t() calls on variables (label tables, codecs) are not seen by this scan.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import SAME from './same-in-french.json';
import { FR_RULES } from './fr-rules';
import { frExact } from './translate';

const SRC = path.join(process.cwd(), 'src');
const EXCLUDED_DIRS = new Set([path.join(SRC, 'server', 'prototype'), path.join(SRC, 'app', 'dev'), path.join(SRC, 'test')]);
const isSource = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/golden/i.test(path.basename(f)) && !f.endsWith('.d.ts');

function walk(dir: string, out: string[] = []): string[] {
  if (EXCLUDED_DIRS.has(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (isSource(p)) out.push(p);
  }
  return out;
}

/** Source without block comments and whole-line comments (doc comments quote t() calls as examples). */
const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const unescape = (s: string) => s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');

const PLACEHOLDER = /\$\{((?:[^{}]|\{[^{}]*\})*)\}/;
/** The strings a template renders (see the header), at most 16. */
function instantiate(raw: string): string[] {
  const m = PLACEHOLDER.exec(raw);
  if (!m) return [raw];
  const before = raw.slice(0, m.index);
  const after = raw.slice(m.index + m[0].length);
  const choice = /\?\s*(['"])/.test(m[1]) ? [...m[1].matchAll(/(['"])((?:\\.|(?!\1).)*)\1/g)].map((x) => x[2]) : null;
  const values = choice ?? [/[A-Za-z]$/.test(before) ? '' : '2'];
  return values.flatMap((v) => instantiate(after).map((rest) => before + v + rest)).slice(0, 16);
}

interface Literal { text: string; file: string }

/** t('…') / t("…") literals and the strings of t(`…`) templates, with the file they come from. */
function scanLiterals(files: readonly string[]): Literal[] {
  const found: Literal[] = [];
  const quoted = /(?<![\w$.])(?:ctx\.)?t\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1\s*[,)]/g;
  const template = /(?<![\w$.])(?:ctx\.)?t\(\s*`((?:\\.|\$\{(?:[^{}]|\{[^{}]*\})*\}|[^`\\$]|\$(?!\{))*)`\s*[,)]/g;
  for (const file of files) {
    const src = withoutComments(fs.readFileSync(file, 'utf8'));
    for (const m of src.matchAll(quoted)) found.push({ text: unescape(m[2]), file });
    for (const m of src.matchAll(template)) for (const text of instantiate(m[1])) found.push({ text: unescape(text), file });
  }
  return found;
}

/** A value Keystone formats itself: numbers, amounts, units, dates ("+85 k€", "12 Oct", "−27 d", "2"). */
const FORMATTED = /^[\d\s+\-−–→.,:;%€$/()×#~≈<>=≥≤]*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|k€|M€|d|h|wk|wks)(?![A-Za-z])[\d\s+\-−–→.,:;%€$/()×#~≈<>=≥≤]*)*$/;
const SAME_SET = new Set<string>(SAME.strings);
const SEPARATORS = / · | — | → | \/ /;

const hasFrench = (s: string) => {
  const fr = frExact(s);
  return fr !== undefined && fr !== s;
};

/** The first FR_RULES rule matching `s` (the translator applies it) changes it and leaves only values or French around it. */
function ruleTranslates(s: string): boolean {
  for (const [re, rep] of FR_RULES) {
    const once = new RegExp(re.source, re.flags.replace('g', ''));
    if (!once.test(s)) continue;
    if (s.replace(once, rep) === s) return false;
    // What the rule keeps: the text around the match and the captured groups.
    const kept = s.split(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')).filter((p) => p != null && p.trim() !== '');
    return kept.every((p) => p.trim() !== s && translatedInFrench(p.trim()));
  }
  return false;
}

/** A reviewed same-in-French word with a count before or after it ("2 sites", "FS 3"). */
const COUNTED = /^(?:[+−-]?\d[\d.,]*\s)?(.+?)(?:\s[+−-]?\d[\d.,]*)?$/;
const countedSame = (x: string) => {
  const m = COUNTED.exec(x);
  return !!m && m[1] !== x && SAME_SET.has(m[1]);
};

const segmentOk = (s: string) => {
  const x = s.trim();
  return !/[A-Za-z]/.test(x) || hasFrench(x) || SAME_SET.has(x) || countedSame(x) || FORMATTED.test(x) || (frExact(x) === undefined && ruleTranslates(x));
};

/** Whether the translator renders `s` fully in French (or it is reviewed as the same in French). */
function translatedInFrench(s: string): boolean {
  if (segmentOk(s)) return true;
  if (frExact(s) !== undefined) return false; // an entry equal to the English: not translated (unless reviewed)
  const parts = s.split(SEPARATORS);
  return parts.length > 1 && parts.every(segmentOk);
}

describe('French completeness (R-184, NEW-D1-2)', () => {
  const literals = scanLiterals(walk(SRC));

  it('the scan sees the literals of the app; partial translations fail (sanity)', () => {
    expect(literals.length).toBeGreaterThan(1500);
    expect(literals.some((l) => l.text === 'Activity, integrations & audit')).toBe(true);
    expect(instantiate("${n} change request${n === 1 ? '' : 's'}")).toEqual(['2 change request', '2 change requests']);
    expect(instantiate("× ${n} ${n > 1 ? 'systems' : 'system'}")).toEqual(['× 2 systems', '× 2 system']);
    expect(translatedInFrench('Approved · Rejected')).toBe(true);
    expect(translatedInFrench('Approved · flux capacitor overload')).toBe(false);
    expect(translatedInFrench('flux capacitor overload')).toBe(false);
    expect(translatedInFrench('3 of 5')).toBe(true);
  });

  it('every t() literal has its French', () => {
    const missing = [...new Set(literals.filter((l) => !translatedInFrench(l.text)).map((l) => `${path.relative(SRC, l.file)}: ${l.text}`))].sort();
    expect(missing).toEqual([]);
  });

  it('the same-in-French list is reviewed: sorted, no duplicate, nothing translated, every entry still used', () => {
    const list: string[] = SAME.strings;
    expect(list).toEqual([...new Set(list)].sort());
    expect(list.filter(hasFrench)).toEqual([]);
    const segments = literals.flatMap((l) => [l.text, ...l.text.split(SEPARATORS).map((x) => x.trim())]);
    const texts = new Set([...segments, ...segments.map((x) => COUNTED.exec(x)?.[1] ?? x)]);
    expect(list.filter((s) => !texts.has(s))).toEqual([]);
  });
});
