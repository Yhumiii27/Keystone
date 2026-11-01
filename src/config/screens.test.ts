// Screen registry ↔ App Router (Delivery 5: all 59 screens built; 60 with the Machine catalogue, owner 25 Oct 2026; 61 with
// the project's Shipments, R-158). Every registry screen has its own route file, so
// the catch-all "This module is being built" pages are unreachable from the navigation (they only 404 unknown paths).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchScreen } from '@/components/app/shell/nav-model';
import { SCREENS, screenHref } from './screens';

const APP = path.resolve(__dirname, '../app/(app)');

/** Route directory of a screen: its slug under the scope prefix, a dynamic segment where the App Router has one. */
function pageFileOf(slug: string, scope: string): string | null {
  const segs = (scope === 'project' ? ['projects', '[code]'] : []).concat(slug ? slug.split('/') : []);
  let dir = APP;
  for (const seg of segs) {
    if (existsSync(path.join(dir, seg))) dir = path.join(dir, seg);
    else {
      // One dynamic segment ([discipline], [taskId]) serves the static slugs of the registry.
      const dyn = ['[discipline]', '[taskId]'].find((d) => existsSync(path.join(dir, d)));
      if (!dyn) return null;
      dir = path.join(dir, dyn);
    }
  }
  const page = path.join(dir, 'page.tsx');
  return existsSync(page) ? page : null;
}

describe('screen registry', () => {
  it('has 61 screens, all built', () => {
    expect(SCREENS).toHaveLength(61);
    expect(SCREENS.filter((s) => !s.built).map((s) => s.id)).toEqual([]);
  });

  it('every screen has its own page (not the catch-all)', () => {
    const missing = SCREENS.filter((s) => !pageFileOf(s.slug, s.scope)).map((s) => s.id);
    expect(missing).toEqual([]);
  });

  it('screenHref round-trips through matchScreen', () => {
    for (const s of SCREENS) {
      const href = screenHref(s.id, { code: 'HLT-026', taskId: 'T-2314' });
      expect(matchScreen(href, 'exact')?.id, href).toBe(s.id);
    }
  });
});
