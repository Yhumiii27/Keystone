// Pager of a server-paginated list (R-017): "Previous page · Page 2 of 7 · Next page", each a link to the same URL with its
// `?page=` (src/domain/pagination.ts). Rendered only when the list has more than one page, so the short lists (every demo list)
// look as before. Strings come translated from the page.
import { CaretLeft, CaretRight } from '@phosphor-icons/react/dist/ssr';
import { ButtonLink } from '@/components/ds/Button';
import type { PagerView } from '@/domain/pagination';
import s from './Pager.module.css';

export function Pager({ view }: { view: PagerView | null }) {
  if (!view || view.pages <= 1) return null;
  return (
    <nav className={s.pager} aria-label={view.name}>
      {view.prev ? (
        <ButtonLink variant="ghost" size="sm" icon={CaretLeft} href={view.prev.href} scroll={false} rel="prev">
          {view.prev.label}
        </ButtonLink>
      ) : (
        <span className={s.spacer} aria-hidden />
      )}
      <span className={s.label} aria-current="page">
        {view.label}
      </span>
      {view.next ? (
        <ButtonLink variant="ghost" size="sm" iconRight={CaretRight} href={view.next.href} scroll={false} rel="next">
          {view.next.label}
        </ButtonLink>
      ) : (
        <span className={s.spacer} aria-hidden />
      )}
    </nav>
  );
}
