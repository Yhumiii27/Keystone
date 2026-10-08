// Filter bar, filter label and single-select chips (docs/spec/02 C-09). Server-compatible: chips with
// `href` are links (URL filter state); otherwise pass `onChange` from a Client Component.
import Link from 'next/link';
import { Funnel } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import type { CSSProperties, ReactNode } from 'react';
import { Select, type SelectOption } from '@/components/ds/Field';
import { cx } from '@/components/ds/cx';
import s from './Filter.module.css';

/** `display:flex;align-items:center;gap:12px;flex-wrap:wrap` (outer bars with a right-pushed note/search use gap 6). */
export function FilterBar({ gap = 12, className, style, children }: { gap?: 6 | 12 | 14; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className={cx(s.bar, className)} style={gap !== 12 ? ({ '--fb-gap': `${gap}px`, ...style } as CSSProperties) : style}>
      {children}
    </div>
  );
}

/** Label + control cluster inside a bar: `display:flex;align-items:center;gap:12px;flex-wrap:wrap`. */
export function FilterGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(s.group, className)}>{children}</div>;
}

/**
 * Filter label: 15px accent icon + 12px neutral-400 text. Icons: `Eye` (view), `Funnel` (filters, default),
 * `Tag` (type), `Factory` (supplier/make-buy), `Gear` (PU/PR), `Certificate` (skill).
 */
export function FilterLabel({ icon: I = Funnel, children }: { icon?: Icon; children: ReactNode }) {
  return (
    <span className={s.label}>
      <I className={s.labelIcon} aria-hidden />
      {children}
    </span>
  );
}

/** Right-pushed hint in a filter bar: `margin-left:auto;font-size:12px;color:neutral-400`. `inline` drops the push. */
export function FilterNote({ inline, children }: { inline?: boolean; children: ReactNode }) {
  return <span className={inline ? s.noteInline : s.note}>{children}</span>;
}

export interface FilterChipOption<V extends string = string> {
  /** Option value; the first option is usually "All" (value `'all'`). */
  value: V;
  label: ReactNode;
  count?: ReactNode;
  href?: string;
}

export interface FilterChipsProps<V extends string = string> {
  options: FilterChipOption<V>[];
  value: V | null | undefined;
  onChange?: (value: V) => void;
  /** Accessible group name (translated). */
  label?: string;
  className?: string;
}

/**
 * Single-select chips (chips() 4110): on = accent-900 / accent-700 border / accent-200 text; off =
 * transparent / neutral-800 / neutral-300; hover neutral-900. Re-clicking the active chip keeps it.
 */
export function FilterChips<V extends string = string>({ options, value, onChange, label, className }: FilterChipsProps<V>) {
  return (
    <div role="group" aria-label={label} className={cx(s.chips, className)}>
      {options.map((o) => {
        const on = o.value === value;
        const cls = cx(s.chip, on && s.chipOn);
        const inner = (
          <>
            {o.label}
            {o.count != null && o.count !== '' && <span className={s.chipCount}>{o.count}</span>}
          </>
        );
        return o.href ? (
          <Link key={o.value} href={o.href} className={cls} aria-current={on ? 'true' : undefined} scroll={false}>
            {inner}
          </Link>
        ) : (
          <button key={o.value} type="button" className={cls} aria-pressed={on} onClick={onChange ? () => onChange(o.value) : undefined}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}

export interface SelectFilterProps {
  icon?: Icon;
  label: ReactNode;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  name?: string;
  onChange?: (value: string) => void;
}

/** Select filter (BOM/PLM): `<label>` with FilterLabel + compact "pill" `select.input`. */
export function SelectFilter({ icon, label, options, value, defaultValue, name, onChange }: SelectFilterProps) {
  return (
    <label className={s.selectFilter}>
      <FilterLabel icon={icon}>{label}</FilterLabel>
      <Select size="pill" options={options} value={value} defaultValue={defaultValue} name={name} onChange={onChange ? (e) => onChange(e.target.value) : undefined} />
    </label>
  );
}
