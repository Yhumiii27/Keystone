// Dark / light display and language (Norma 2.0, norma/charte/COQUE.md § 4): cookie → theme; the pair PrefsStack — FR | EN
// stacked over dark | light, same size —, its markup in French, its place as the last element of every page header and of
// the top bar; the root layout that sets data-theme on <html> from the cookie (no flash) and loads the shell's sheets.
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push() {}, refresh() {} }), redirect() {}, notFound() {} }));
vi.mock('@/server/actions/preferences', () => ({ setNavOpen: async () => {}, setViewAs: async () => {}, setLanguage: async () => {}, setZone: async () => {} }));
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { DEFAULT_THEME, LEGACY_THEME_COOKIE, THEME_COOKIE, themeCookie, themeFromCookieHeader, themeOf } from '@norma/charte/ds/theme';
import { KeystonePrefs } from './prefs';

const read = (file: string) => fs.readFileSync(file, 'utf8');

describe('dark / light display and language', () => {
  it('the atrium-theme cookie gives the theme, the former name read as a fallback, dark by default', () => {
    expect(THEME_COOKIE).toBe('atrium-theme');
    expect(themeFromCookieHeader(`${LEGACY_THEME_COOKIE}=light`)).toBe('light');
    expect(themeFromCookieHeader(`${LEGACY_THEME_COOKIE}=light; atrium-theme=dark`)).toBe('dark');
    expect(themeFromCookieHeader('')).toBe('dark');
    expect(DEFAULT_THEME).toBe('dark');
    expect(themeOf('light')).toBe('light');
    expect(themeOf('dark')).toBe('dark');
    for (const v of [undefined, null, '', 'LIGHT', 'blue']) expect(themeOf(v)).toBe('dark');
    expect(themeCookie('light')).toBe('atrium-theme=light; path=/; max-age=31536000; samesite=lax');
  });

  it('the pair: FR | EN above moon | sun, named in French, the current choices pressed', () => {
    const html = renderToStaticMarkup(h(I18nProvider, { lang: 'fr', children: h(KeystonePrefs, { lang: 'fr', theme: 'light' }) }));
    // Language first (on top), then the display, in one stacked block.
    expect(html).toMatch(/^<div class="coque-prefs" data-print-hide="true"><div role="group" aria-label="Langue" class="coque-pref">.*<\/div><div role="group" aria-label="Affichage" class="coque-pref">.*<\/div><\/div>$/);
    expect(html).toMatch(/aria-pressed="true" title="Français" lang="fr">FR</);
    expect(html).toMatch(/aria-pressed="false" title="English" lang="en">EN</);
    expect(html).toMatch(/aria-pressed="false" aria-label="Affichage sombre"/);
    expect(html).toMatch(/aria-pressed="true" aria-label="Affichage clair"/);
    const en = renderToStaticMarkup(h(I18nProvider, { lang: 'en', children: h(KeystonePrefs, { lang: 'en', theme: 'dark' }) }));
    expect(en).toMatch(/aria-pressed="true" aria-label="Dark display"/);
    expect(en).toContain('aria-label="Dark / light display"');
  });

  it('the page header and the top bar end with the pair; nowhere else; the root layout loads the shell and sets data-theme', () => {
    const header = read('src/components/app/shell/page-header.tsx');
    expect(header).toContain("import { PageHeader as CoqueHeader } from '@norma/charte/ds/PageHeader';");
    expect(header).toContain('prefs={<KeystonePrefs lang={lang} theme={theme} />}');
    expect(read('src/app/(app)/layout.tsx')).toMatch(/<KeystoneTopBar bell=\{bell\} prefs=\{<KeystonePrefs lang=\{lang\} theme=\{theme\} \/>\} \/>/);
    // The former inline toggles are gone from the header islands and the sidebar.
    for (const f of ['header-islands.tsx', 'sidebar.tsx']) expect(read(`src/components/app/shell/${f}`)).not.toMatch(/<(LangToggle|ThemeToggle|PrefsStack)\b|function (LangToggle|ThemeToggle)/);
    const layout = read('src/app/layout.tsx');
    expect(layout).toContain('data-theme={theme}');
    expect(layout).toMatch(/import '@norma\/charte\/nocturne\.css';[\s\S]*import '@norma\/charte\/touch\.css';\s*import '@norma\/charte\/coque\.css';/);
    expect(read('norma/charte/nocturne.css')).toContain(':root[data-theme="light"]');
    expect(read('src/server/session.ts')).toMatch(/getTheme = cache\(async \(\): Promise<Theme> => \{\s*const jar = await cookies\(\);\s*return themeFromCookies\(\(name\) => jar\.get\(name\)\?\.value\);/);
  });
});
