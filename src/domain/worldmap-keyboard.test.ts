// Projects map — keyboard markers (Delivery 8, L-7 = a, R-135): which markers are tab stops, what Enter / Space do on a
// focused marker (the click rule: zoom on a spread cluster with focus on the map, else pin the tooltip with focus on its
// first link) and the accessible name of a marker. Pure rules; the component wires them (src/components/charts/projects-map.tsx).
import { describe, expect, it } from 'vitest';
import { IDENTITY, SCALE_EXTENT, clusterClick, markerAriaLabel, markerKeyAction, markerTabIndex, type Cluster } from './worldmap';

const W = 800;
const H = 500;
const at = (code: string, x: number, y: number) => ({ code, x, y });

describe('markerTabIndex', () => {
  it('a marker inside the frame is a tab stop; panned out of view it is skipped', () => {
    expect(markerTabIndex({ x: 400, y: 250 }, IDENTITY, W, H)).toBe(0);
    expect([markerTabIndex({ x: 0, y: 0 }, IDENTITY, W, H), markerTabIndex({ x: W, y: H }, IDENTITY, W, H)]).toEqual([0, 0]);
    expect([markerTabIndex({ x: -1, y: 10 }, IDENTITY, W, H), markerTabIndex({ x: 10, y: H + 1 }, IDENTITY, W, H)]).toEqual([-1, -1]);
    // Screen position = k × projected + translation.
    const zoomed = { k: 4, x: -1200, y: -600 };
    expect([markerTabIndex({ x: 400, y: 250 }, zoomed, W, H), markerTabIndex({ x: 100, y: 100 }, zoomed, W, H)]).toEqual([0, -1]);
  });
});

describe('markerKeyAction', () => {
  const spread: Cluster = { x: 400, y: 250, items: [at('A', 395, 248), at('B', 405, 252)] };
  const stacked: Cluster = { x: 400, y: 250, items: [at('A', 400, 250), at('B', 400.1, 250)] };
  const single: Cluster = { x: 400, y: 250, items: [at('A', 400, 250)] };

  it('Enter and Space apply the click rule: a spread cluster zooms (focus to the map)', () => {
    const click = clusterClick(spread, W, H);
    expect(click.kind).toBe('zoom');
    for (const key of ['Enter', ' ']) expect(markerKeyAction(key, spread, W, H)).toEqual({ ...click, focus: 'map' });
    const r = markerKeyAction('Enter', spread, W, H);
    expect(r?.kind === 'zoom' && r.transform.k).toBeLessThanOrEqual(SCALE_EXTENT[1]);
  });

  it('a single marker or a cluster that cannot separate pins the tooltip (focus to its first link)', () => {
    expect(clusterClick(stacked, W, H)).toEqual({ kind: 'pin' });
    expect(markerKeyAction(' ', stacked, W, H)).toEqual({ kind: 'pin', focus: 'tooltip' });
    expect(markerKeyAction('Enter', single, W, H)).toEqual({ kind: 'pin', focus: 'tooltip' });
  });

  it('other keys do nothing here (Esc is handled once by the tooltip listener; Tab moves on)', () => {
    for (const key of ['Escape', 'Tab', 'ArrowRight', 'a', 'Spacebar', 'enter']) expect(markerKeyAction(key, single, W, H), key).toBeNull();
  });
});

describe('markerAriaLabel', () => {
  const t = (s: string) => s;
  it('the tooltip title, plus the project name of a single marker', () => {
    expect(markerAriaLabel([{ city: 'Le Havre', country: 'France', name: '#026 · Harbor Line Terminal Expansion' }], t)).toBe(
      'Le Havre · France · 1 project · #026 · Harbor Line Terminal Expansion',
    );
    expect(markerAriaLabel([
      { city: 'Le Havre', country: 'France', name: 'a' }, { city: 'Le Havre', country: 'France', name: 'b' }, { city: 'Lyon', country: 'France', name: 'c' },
    ], t)).toBe('2 sites · 3 projects');
    expect(markerAriaLabel([{ city: 'Lyon', country: 'France', name: 'a' }, { city: 'Lyon', country: 'France', name: 'b' }], t)).toBe('Lyon · France · 2 projects');
  });
});
