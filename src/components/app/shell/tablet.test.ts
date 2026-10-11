// Tablet layout (R-146, decision X-4): drawer state rule, and the CSS contract of the shell, the DS components and the
// touch stylesheet — the media queries of ./tablet.ts, the sidebar drawer, the 40 px touch targets, the table scroll box.
// (No browser in the tests: the rules are read from the CSS sources.)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Table } from '@/components/ds/Table';
import { NAV_TOGGLE_ID, SIDEBAR_ID, TABLET_MAX_PX, TABLET_MEDIA, TOUCH_MEDIA, TOUCH_TARGET_PX, navDrawerAfter } from './tablet';

const ROOT = join(__dirname, '../../../..');
const css = (file: string) => readFileSync(join(ROOT, file), 'utf8');

/** Bodies of the `@media <query> { … }` blocks of a stylesheet (brace matching). */
function mediaBlocks(source: string, query: string): string[] {
  const out: string[] = [];
  const head = `@media ${query} {`;
  let at = source.indexOf(head);
  while (at >= 0) {
    let depth = 0;
    let i = at + head.length - 1;
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) break;
    }
    out.push(source.slice(at + head.length, i));
    at = source.indexOf(head, i);
  }
  return out;
}
/** The declarations of `selector { … }` inside the given CSS text ('' when absent). */
function rule(block: string, selector: string): string {
  const re = new RegExp(`(?:^|[},\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'm');
  return re.exec(block)?.[1] ?? '';
}
const inMedia = (file: string, query: string, selector: string) => mediaBlocks(css(file), query).map((b) => rule(b, selector)).join(' ');

describe('tablet layout constants', () => {
  it('tablet up to 1024 px; touch targets on tablets and coarse pointers, 40 px', () => {
    expect([TABLET_MAX_PX, TABLET_MEDIA, TOUCH_MEDIA, TOUCH_TARGET_PX]).toEqual([1024, '(max-width: 1024px)', '(max-width: 1024px), (pointer: coarse)', 40]);
    expect([SIDEBAR_ID, NAV_TOGGLE_ID]).toEqual(['ks-sidebar', 'ks-nav-toggle']);
  });

  it('the drawer closes on a navigation to another path, not on the same path', () => {
    const open = { open: true, path: '/projects/HLT-026/site' };
    expect(navDrawerAfter(open, '/projects/HLT-026/site')).toBe(open);
    expect(navDrawerAfter(open, '/projects/HLT-026/itp')).toEqual({ open: false, path: '/projects/HLT-026/itp' });
    const closed = { open: false, path: '/home' };
    expect(navDrawerAfter(closed, '/home')).toBe(closed);
  });
});

describe('shell CSS (tablet)', () => {
  const SHELL = 'src/components/app/shell/shell.module.css';
  const SIDEBAR = 'src/components/app/shell/sidebar.module.css';
  const HEADER = 'src/components/app/shell/header.module.css';

  it('one column, the top bar shown, the sidebar a hidden drawer until opened', () => {
    expect(inMedia(SHELL, TABLET_MEDIA, '.root')).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(rule(css(SHELL), '.topbar')).toContain('display: none');
    expect(inMedia(SHELL, TABLET_MEDIA, '.topbar')).toMatch(/display: flex;[\s\S]*position: sticky/);
    const aside = inMedia(SIDEBAR, TABLET_MEDIA, '.aside');
    expect(aside).toMatch(/position: fixed/);
    expect(aside).toMatch(/transform: translateX\(-100%\)/);
    expect(aside).toMatch(/visibility: hidden/);
    expect(inMedia(SIDEBAR, TABLET_MEDIA, '.open')).toMatch(/transform: none;[\s\S]*visibility: visible/);
    expect(inMedia(SIDEBAR, TABLET_MEDIA, '.backdropOn')).toContain('pointer-events: auto');
    // Below the centered modals (z 70/71), above the drawers (60/61).
    const z = Number(/z-index: (\d+)/.exec(aside)![1]);
    expect(z > 61 && z < 70).toBe(true);
  });

  it('touch targets of the sidebar and the header: 40 px', () => {
    for (const sel of ['.entry', '.secHead', '.group', '.persona', '.trigger']) expect(inMedia(SIDEBAR, TOUCH_MEDIA, sel), sel).toContain(`min-height: ${TOUCH_TARGET_PX}px`);
    for (const sel of ['.pickBtn', '.pickOpt', '.hit', '.notif']) expect(inMedia(HEADER, TOUCH_MEDIA, sel), sel).toContain(`min-height: ${TOUCH_TARGET_PX}px`);
  });
});

describe('touch targets and tables (tablet)', () => {
  it('Nocturne buttons, inputs and segmented options: 40 px above every compact variant (touch.css, loaded by the root layout)', () => {
    const touch = css('src/styles/touch.css');
    const block = mediaBlocks(touch, TOUCH_MEDIA).join(' ');
    expect(rule(block, '.btn')).toContain('min-height: 40px !important');
    expect(block).toMatch(/\.input:not\(textarea\)\s*\{\s*min-height: 40px !important/);
    expect(block).toMatch(/\.btn \{\s*min-width: 40px !important/);
    expect(rule(block, '.btn-icon')).toMatch(/width: 40px;\s*height: 40px/);
    expect(rule(block, '.table tbody td')).toContain('height: 40px');
    expect(css('src/app/layout.tsx')).toContain("import '@/styles/touch.css';");
  });

  it('DS and app controls: segmented options, filter chips, list rows, check rows — 40 px', () => {
    expect(inMedia('src/components/ds/Segmented.module.css', TOUCH_MEDIA, '.opt')).toContain('min-height: 40px');
    expect(inMedia('src/components/app/Filter.module.css', TOUCH_MEDIA, '.chip')).toContain('min-height: 40px');
    expect(inMedia('src/components/app/ListRow.module.css', TOUCH_MEDIA, 'button.row')).toContain('min-height: 40px');
    expect(inMedia('src/components/app/Check.module.css', TOUCH_MEDIA, '.row')).toContain('min-height: 40px');
    expect(mediaBlocks(css('src/components/app/Check.module.css'), TOUCH_MEDIA).join(' ')).toMatch(/::after \{[^}]*width: 40px; height: 40px/);
  });

  it('a table scrolls horizontally in its own box on tablets; no box on desktop; opt-out inside a scrolling box', () => {
    const tableCss = css('src/components/ds/Table.module.css');
    expect(rule(tableCss, '.scrollX')).toContain('display: contents');
    expect(inMedia('src/components/ds/Table.module.css', TABLET_MEDIA, '.scrollX')).toMatch(/display: block;[\s\S]*overflow-x: auto/);
    const wrapped = renderToStaticMarkup(h(Table, null, h('tbody', null)));
    expect(wrapped).toMatch(/^<div[^>]*><table class="table[^"]*"><tbody><\/tbody><\/table><\/div>$/);
    expect(renderToStaticMarkup(h(Table, { scroll: false }, h('tbody', null)))).toMatch(/^<table class="table[^"]*"><tbody><\/tbody><\/table>$/);
  });
});
