import type { Metadata } from 'next';
import '@norma/charte/nocturne.css';
import './globals.css';
import '@norma/charte/touch.css';
import { interClassName } from '@norma/charte/fonts/inter';
import { I18nProvider } from '@/i18n/client';
import { getLang, getTheme } from '@/server/session';

export const metadata: Metadata = {
  title: 'Keystone PM',
  description: 'Keystone — project & portfolio management',
};

// Charter, touch targets and Inter come from the suite's common base (norma/charte, Norma 1.0): Inter is served from the
// repository, so `next build` needs no network. data-theme: the viewer's dark / light display (epc2i-theme cookie).
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const [lang, theme] = await Promise.all([getLang(), getTheme()]);
  return (
    <html lang={lang} className={interClassName} data-theme={theme}>
      <body>
        <I18nProvider lang={lang}>{children}</I18nProvider>
      </body>
    </html>
  );
}
