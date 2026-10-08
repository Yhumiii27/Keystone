'use client';
// Flat-list filter bar (template 1180–1186): search over reference / article / manufacturer ref (`?q=`, debounced),
// "Type" and "Supplier" selects (each option carries its URL), "Clear filters" and the "N / M articles" count. The
// search box follows the URL when it changes from elsewhere (Clear filters, back / forward), never while typing.
import { Factory, Tag, X } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { SelectFilter } from '@/components/app/Filter';
import { SearchField } from '@/components/app/SearchField';
import { ButtonLink } from '@/components/ds/Button';
import type { FlatView, LinkOption } from './model';
import s from './bom.module.css';

type Props = Pick<FlatView, 'searchPlaceholder' | 'typeLabel' | 'typeOptions' | 'supplierLabel' | 'supplierOptions' | 'clearHref' | 'clearLabel' | 'count'>;

/** Search text synced with `?{param}=`: debounced writes, external URL changes reflected. */
function useUrlSearch(param: string, debounce = 200) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQ = params.get(param) ?? '';
  const [value, setValue] = useState(urlQ);
  const [sent, setSent] = useState(urlQ);
  const [seen, setSeen] = useState(urlQ);
  if (urlQ !== seen) {
    setSeen(urlQ);
    if (urlQ !== sent) {
      setValue(urlQ);
      setSent(urlQ);
    }
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onChange = (v: string) => {
    setValue(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const q = v.trim();
      setSent(q);
      const next = new URLSearchParams(params.toString());
      if (q) next.set(param, q);
      else next.delete(param);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, debounce);
  };
  return { value, onChange };
}

export function FlatFilters(p: Props) {
  const router = useRouter();
  const search = useUrlSearch('q');
  const go = (options: LinkOption[]) => (value: string) => {
    const o = options.find((x) => x.value === value);
    if (o) router.push(o.href, { scroll: false });
  };
  const current = (options: LinkOption[]) => options.find((o) => o.active)?.value ?? '';
  return (
    <div className={s.filters}>
      <SearchField size="sm" flex="1 1 240px" maxWidth={340} minWidth={0} placeholder={p.searchPlaceholder} value={search.value} onChange={search.onChange} />
      <SelectFilter
        icon={Tag}
        label={p.typeLabel}
        options={p.typeOptions.map((o) => ({ value: o.value, label: o.label }))}
        value={current(p.typeOptions)}
        onChange={go(p.typeOptions)}
      />
      <SelectFilter
        icon={Factory}
        label={p.supplierLabel}
        options={p.supplierOptions.map((o) => ({ value: o.value, label: o.label }))}
        value={current(p.supplierOptions)}
        onChange={go(p.supplierOptions)}
      />
      {p.clearHref && (
        <ButtonLink variant="ghost" size="xs" icon={X} href={p.clearHref} scroll={false}>
          {p.clearLabel}
        </ButtonLink>
      )}
      <span className={s.count} aria-live="polite">
        {p.count}
      </span>
    </div>
  );
}

/** Where-used search (`?used=`, template 1249): 34px search box, min-width 280. */
export function UsedSearch({ placeholder }: { placeholder: string }) {
  const search = useUrlSearch('used');
  return <SearchField minWidth={280} placeholder={placeholder} value={search.value} onChange={search.onChange} />;
}
