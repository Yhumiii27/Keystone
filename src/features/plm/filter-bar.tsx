'use client';
// Filter card of the parts catalogue (docs/spec/09 §3.5, template 2546–2556): search (debounced into `?q=`), the Type,
// Status, PU/PR and Make / buy selects (written to the URL, the other params kept), the "Export-restricted only"
// toggle chip and "Clear filters" (links computed on the server). The search box follows the URL when it changes from
// elsewhere ("Clear filters", back / forward).
import { Factory, Funnel, Gear, GlobeHemisphereWest, Tag as TagIcon, X } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { SelectFilter } from '@/components/app/Filter';
import { SearchField } from '@/components/app/SearchField';
import { ButtonLink } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import type { CatalogueView, SelectView } from './model';
import s from './plm.module.css';

const ICONS: Record<SelectView['param'], typeof TagIcon> = { type: TagIcon, status: Funnel, pu: Gear, mb: Factory };

export function PlmFilterBar({ view }: { view: Pick<CatalogueView, 'searchPlaceholder' | 'selects' | 'restricted' | 'clear'> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQ = params.get('q') ?? '';
  const [q, setQ] = useState(urlQ);
  const [seenQ, setSeenQ] = useState(urlQ);
  const [pushedQ, setPushedQ] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The URL changed: adopt it unless it is the value this box just pushed (typing continues meanwhile).
  if (urlQ !== seenQ) {
    setSeenQ(urlQ);
    if (urlQ !== pushedQ) setQ(urlQ);
  }

  const replace = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(window.location.search);
    mutate(next);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const onSearch = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setPushedQ(v);
      replace((p) => (v ? p.set('q', v) : p.delete('q')));
    }, 200);
  };
  const onSelect = (param: string, value: string) => replace((p) => (value ? p.set(param, value) : p.delete(param)));

  return (
    <div className={cx('card', 'elev-sm', s.filterCard)}>
      <div className={s.filterRow}>
        <SearchField value={q} onChange={onSearch} size="sm" flex="1 1 240px" maxWidth={340} minWidth={0} placeholder={view.searchPlaceholder} />
        {view.selects.map((sel) => (
          <SelectFilter key={sel.param} icon={ICONS[sel.param]} label={sel.label} options={sel.options} value={sel.value} onChange={(v) => onSelect(sel.param, v)} />
        ))}
        <Link href={view.restricted.href} scroll={false} replace className={cx(s.chip, view.restricted.on && s.chipOn)} aria-current={view.restricted.on ? 'true' : undefined}>
          <GlobeHemisphereWest aria-hidden />
          {view.restricted.label}
        </Link>
        {view.clear && (
          <ButtonLink variant="ghost" icon={X} href={view.clear.href} scroll={false} replace className={s.clear}>
            {view.clear.label}
          </ButtonLink>
        )}
      </div>
    </div>
  );
}
