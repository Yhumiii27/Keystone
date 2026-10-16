// Load-window navigation of the load plans (R-085, owner decision R-7 a): "Previous week" · "Current week" (the default
// window, no `?week=`) · "Following week", then the weeks shown. Links, not client state: the server reads and validates
// `?week=` (src/domain/load-window.ts). Server Component; used by Resources, Project resources and Leave & calendar.
import { CaretLeft, CaretRight } from '@phosphor-icons/react/dist/ssr';
import { Button, ButtonLink } from '@/components/ds/Button';
import { loadWindowHref, type LoadWindow } from '@/domain/load-window';
import type { Lang, T } from '@/i18n/translate';
import { weekLabelOfIso } from '@/server/db/codes';
import { weekLabel } from './model';
import s from './window-nav.module.css';

/** "Sep 21 – Nov 9, 2026" / "21 sept. – 9 nov. 2026": first and last Monday of the window, the year of the last one. */
export function windowRangeText(w: Pick<LoadWindow, 'weeks'>, t: T, lang: Lang): string {
  if (!w.weeks.length) return '';
  const first = weekLabel(weekLabelOfIso(w.weeks[0]), t, lang);
  const last = w.weeks[w.weeks.length - 1];
  const lastText = weekLabel(weekLabelOfIso(last), t, lang);
  return lang === 'fr' ? `${first} – ${lastText} ${last.slice(0, 4)}` : `${first} – ${lastText}, ${last.slice(0, 4)}`;
}

export interface LoadWindowNavProps {
  window: LoadWindow;
  /** Screen path the links point to ("/resources", "/projects/HLT-026/resources"). */
  path: string;
  /** Other search params of the screen, kept by the links. */
  keep?: Record<string, string | null | undefined>;
  t: T;
  lang: Lang;
}

export function LoadWindowNav({ window: w, path, keep, t, lang }: LoadWindowNavProps) {
  const step = (to: string | null, label: string, right: boolean) =>
    to == null ? (
      <Button variant="secondary" size="xs" disabled icon={right ? undefined : CaretLeft} iconRight={right ? CaretRight : undefined}>
        {label}
      </Button>
    ) : (
      <ButtonLink variant="secondary" size="xs" href={loadWindowHref(path, to, w.current, keep)} scroll={false} icon={right ? undefined : CaretLeft} iconRight={right ? CaretRight : undefined}>
        {label}
      </ButtonLink>
    );
  return (
    <nav className={s.nav} aria-label={t('Weeks shown')}>
      {step(w.prev, t('Previous week'), false)}
      <ButtonLink variant="ghost" size="xs" href={loadWindowHref(path, w.current, w.current, keep)} scroll={false} aria-current={w.isCurrent ? 'page' : undefined}>
        {t('Current week')}
      </ButtonLink>
      {step(w.next, t('Following week'), true)}
      <span className={s.range}>{windowRangeText(w, t, lang)}</span>
    </nav>
  );
}
