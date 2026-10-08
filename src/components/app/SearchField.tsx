'use client';
// Search field (docs/spec/02 C-10). Controlled (`value` + `onChange`), uncontrolled (`defaultValue`, `name`
// inside a <form>), or URL-synced with `param` (debounced router.replace of `?{param}=`).
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, type CSSProperties } from 'react';
import { cx } from '@/components/ds/cx';
import s from './SearchField.module.css';

export interface SearchFieldProps {
  /** Placeholder (translated), e.g. t('Search projects'). Also the accessible label unless `label` is given. */
  placeholder?: string;
  label?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Sync with this search param (e.g. 'q'): reads the initial value and replaces the URL as the user types. */
  param?: string;
  /** Debounce for `param` mode in ms. Default 200. */
  debounce?: number;
  name?: string;
  /** `md` page search (34px, 14px) · `sm` compact (32px, 12.5px; BOM/PLM) · `xs` header/popover (32px, 12.5px, 13px icon at left 9px). */
  size?: 'md' | 'sm' | 'xs';
  /** min-width in px (220 default, 260). */
  minWidth?: number;
  /** `margin-left:auto` (right end of a filter bar). */
  push?: boolean;
  /** Flex shorthand, e.g. "1 1 240px", with optional max width in px. */
  flex?: string;
  maxWidth?: number;
  autoFocus?: boolean;
  className?: string;
}

export function SearchField({
  placeholder,
  label,
  value,
  defaultValue,
  onChange,
  param,
  debounce = 200,
  name,
  size = 'md',
  minWidth,
  push,
  flex,
  maxWidth,
  autoFocus,
  className,
}: SearchFieldProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [local, setLocal] = useState(() => (param ? (params.get(param) ?? '') : ''));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handle = (v: string) => {
    onChange?.(v);
    if (!param) return;
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (v.trim()) next.set(param, v);
      else next.delete(param);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, debounce);
  };

  const vars = {
    ...(minWidth != null ? { '--sf-min': `${minWidth}px` } : null),
    ...(flex ? { '--sf-flex': flex } : null),
    ...(maxWidth != null ? { '--sf-max': `${maxWidth}px` } : null),
  } as CSSProperties;

  const controlled = param ? { value: local } : value !== undefined ? { value } : { defaultValue };

  return (
    <div className={cx(s.wrap, size !== 'md' && s[size], push && s.push, flex && s.flex, className)} style={vars}>
      <MagnifyingGlass className={s.icon} aria-hidden />
      <input
        type="text"
        inputMode="search"
        enterKeyHint="search"
        className={cx('input', s.input)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        name={name}
        autoFocus={autoFocus}
        onChange={(e) => handle(e.target.value)}
        {...controlled}
      />
    </div>
  );
}
