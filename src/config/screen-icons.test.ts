// The screen registry stays free of the Phosphor components (tsx scripts such as db-check and the worker load it through the
// server rules, and the icons' CommonJS build needs the client React); the navigation icons live in ./screen-icons.ts.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_ICONS } from './screen-icons';
import { SCREENS } from './screens';

describe('screen icons', () => {
  it('the registry imports no icon package', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/config/screens.ts'), 'utf8');
    expect(src).not.toMatch(/@phosphor-icons/);
  });

  it('every navigation entry has its icon, and every icon belongs to a screen', () => {
    const ids = new Set(SCREENS.map((s) => s.id));
    expect(Object.keys(SCREEN_ICONS).filter((id) => !ids.has(id as never))).toEqual([]);
    expect(SCREENS.filter((s) => s.navLabel && !SCREEN_ICONS[s.id]).map((s) => s.id)).toEqual([]);
  });
});
