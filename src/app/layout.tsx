import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '@/styles/nocturne.css';
import './globals.css';
import '@/styles/touch.css';
import { I18nProvider } from '@/i18n/client';
import { getLang } from '@/server/session';

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Keystone PM',
  description: 'Keystone — project & portfolio management',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const lang = await getLang();
  return (
    <html lang={lang} className={inter.variable}>
      <body>
        <I18nProvider lang={lang}>{children}</I18nProvider>
      </body>
    </html>
  );
}
