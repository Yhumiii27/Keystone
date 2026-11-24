'use client';
// Last-resort error page (R-176): the root layout failed, so this page renders its own <html> and <body> with the Nocturne
// styles, and reads the language from the ks-lang cookie itself (French by default, as everywhere). Same card, incident
// identifier and actions as the other error pages (src/features/errors/route-error.tsx).
import '@norma/charte/nocturne.css';
import './globals.css';
import { interClassName } from '@norma/charte/fonts/inter';
import { THEME_COOKIE, themeOf } from '@norma/charte/ds/theme';
import { useSyncExternalStore } from 'react';
import { I18nProvider } from '@/i18n/client';
import { DEFAULT_LANG, type Lang } from '@/i18n/translate';
import { RouteError } from '@/features/errors/route-error';


/** Language of the ks-lang cookie (the server's default on the first render, so hydration matches). */
function cookieLang(): Lang {
  const m = /(?:^|;\s*)ks-lang=(fr|en)(?:;|$)/.exec(document.cookie);
  return (m?.[1] as Lang | undefined) ?? DEFAULT_LANG;
}

/** Display of the epc2i-theme cookie (dark, the default, on the first render). */
function cookieTheme(): string {
  const m = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([a-z]+)(?:;|$)`).exec(document.cookie);
  return themeOf(m?.[1]);
}

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const lang = useSyncExternalStore(() => () => {}, cookieLang, () => DEFAULT_LANG);
  const theme = useSyncExternalStore(() => () => {}, cookieTheme, () => themeOf(null));
  return (
    <html lang={lang} className={interClassName} data-theme={theme}>
      <body>
        <title>Keystone PM</title>
        <I18nProvider lang={lang}>
          <RouteError error={error} retry={retry} layout="page" />
        </I18nProvider>
      </body>
    </html>
  );
}
