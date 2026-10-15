// A 'use server' file may export async functions only (Next.js refuses the build otherwise; typecheck and the tests do not
// see it). Delivery 8 integration: a constant exported from src/features/docs/actions.ts broke `next build`.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(process.cwd(), 'src');
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });

describe("'use server' files", () => {
  it('export async functions and types only', () => {
    const bad: string[] = [];
    for (const f of files(ROOT)) {
      const src = fs.readFileSync(f, 'utf8');
      if (!/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use server['"]/.test(src)) continue;
      for (const [n, line] of src.split('\n').entries()) {
        if (!/^export\b/.test(line)) continue;
        if (/^export\s+(async\s+function|type\b|interface\b|declare\b)/.test(line)) continue;
        bad.push(`${path.relative(ROOT, f)}:${n + 1}: ${line.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
