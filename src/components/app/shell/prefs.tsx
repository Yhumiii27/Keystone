// The language / display pair of Norma 2.0 (PrefsStack: FR | EN stacked over dark | light, same size, left edges aligned),
// the last element of every page header and of the top bar ≤ 1024 px, nowhere else (norma/charte/COQUE.md § 4). The language
// is kept by setLanguage (cookie ks-lang), the display by the suite's atrium-theme cookie, former name read as a fallback. Server-compatible.
import { PrefsStack } from '@norma/charte/ds/HeaderTools';
import type { Theme } from '@norma/charte/ds/theme';
import type { Lang } from '@/i18n/translate';
import { setLanguage } from '@/server/actions/preferences';

export function KeystonePrefs({ lang, theme }: { lang: Lang; theme: Theme }) {
  return <PrefsStack lang={lang} theme={theme} onSelect={setLanguage} />;
}
