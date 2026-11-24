// Dark / light display (Norma 1.0): cookie → theme, the toggle's markup in French, its place right of the FR / EN toggle,
// and the root layout that sets data-theme on <html> from the cookie (no flash).
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push() {}, refresh() {} }), redirect() {}, notFound() {} }));
vi.mock('@/server/actions/preferences', () => ({ setNavOpen: async () => {}, setViewAs: async () => {}, setLanguage: async () => {}, setZone: async () => {} }));
vi.mock('./actions', () => ({ searchAction: async () => [], markNotificationReadAction: async () => {}, markAllNotificationsReadAction: async () => {} }));
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { DEFAULT_THEME, THEME_COOKIE, themeCookie, themeOf } from '@norma/charte/ds/theme';
import { LangToggle, ThemeToggle } from './header-islands';

const read = (file: string) => fs.readFileSync(file, 'utf8');

describe('dark / light display', () => {
  it('the epc2i-theme cookie gives the theme, dark by default', () => {
    expect(THEME_COOKIE).toBe('epc2i-theme');
    expect(DEFAULT_THEME).toBe('dark');
    expect(themeOf('light')).toBe('light');
    expect(themeOf('dark')).toBe('dark');
    for (const v of [undefined, null, '', 'LIGHT', 'blue']) expect(themeOf(v)).toBe('dark');
    expect(themeCookie('light')).toBe('epc2i-theme=light; path=/; max-age=31536000; samesite=lax');
  });

  it('the toggle renders moon and sun, named in French, the current theme pressed', () => {
    const html = renderToStaticMarkup(h(I18nProvider, { lang: 'fr', children: h(ThemeToggle, { theme: 'light' }) }));
    expect(html).toContain('aria-label="Affichage"');
    expect(html).toMatch(/aria-label="Affichage sombre" aria-pressed="false"/);
    expect(html).toMatch(/aria-label="Affichage clair" aria-pressed="true"/);
    const en = renderToStaticMarkup(h(I18nProvider, { lang: 'en', children: h(ThemeToggle, { theme: 'dark' }) }));
    expect(en).toMatch(/aria-label="Dark display" aria-pressed="true"/);
    // Rendered alongside the language toggle without clashing.
    expect(renderToStaticMarkup(h(I18nProvider, { lang: 'fr', children: [h(LangToggle, { key: 'l', lang: 'fr' }), h(ThemeToggle, { key: 't', theme: 'dark' })] }))).toMatch(/>EN<\/button><\/div><div role="group" aria-label="Affichage"/);
  });

  it('the page header puts it right after the FR / EN toggle; the root layout sets data-theme from the cookie', () => {
    expect(read('src/components/app/shell/page-header.tsx')).toMatch(/<LangToggle lang=\{lang\} \/>\s*<ThemeToggle theme=\{theme\} \/>/);
    const layout = read('src/app/layout.tsx');
    expect(layout).toContain('data-theme={theme}');
    expect(layout).toContain("import '@norma/charte/nocturne.css';");
    expect(read('norma/charte/nocturne.css')).toContain(':root[data-theme="light"]');
    expect(read('src/server/session.ts')).toMatch(/getTheme = cache\(async \(\): Promise<Theme> => themeOf\(\(await cookies\(\)\)\.get\(THEME_COOKIE\)\?\.value\)\)/);
  });
});
