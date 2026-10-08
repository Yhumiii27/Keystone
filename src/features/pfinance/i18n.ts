// Translator of the portfolio finance screens: t() plus the French sentences the shared engine misses.
// - "{money} proposed · approved · planning": FR_RULES has the sentence, but trFR splits it on " · " first and leaves
//   it in English (the prototype shows "13,08 M€ proposed · approved · planning").
// - "{n} client projects · {m} internal": French singular forms ("1 projet client · 1 interne"; the prototype prints
//   "1 internes").
import type { Lang, T } from '@/i18n/translate';

const PIPELINE_SUB = /^(.+) proposed · approved · planning$/;
const CLIENT_PROJECTS = /^(\d+) client projects? · (\d+) internal$/;

const fr = (n: number, one: string, many: string) => (n > 1 ? many : one);

export function pfT(t: T, lang: Lang): T {
  if (lang !== 'fr') return t;
  return (s: string) => {
    let m = PIPELINE_SUB.exec(s);
    if (m) return `${m[1]} proposés · approuvés · en planification`;
    m = CLIENT_PROJECTS.exec(s);
    if (m) {
      const [a, b] = [+m[1], +m[2]];
      return `${a} ${fr(a, 'projet client', 'projets clients')} · ${b} ${fr(b, 'interne', 'internes')}`;
    }
    return t(s);
  };
}
