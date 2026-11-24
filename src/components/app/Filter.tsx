// Filter bar, filter label and single-select chips (docs/spec/02 C-09). Server-compatible: chips with
// `href` are links (URL filter state); otherwise pass `onChange` from a Client Component. The bar keeps Keystone's gap
// variants (6 / 12 / 14) and the select filter; the rest is the charte's.
import type { Icon } from '@phosphor-icons/react';
import { FilterLabel, type FilterChipOption } from '@norma/charte/ds/FilterBar';
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

// Filter group, label, right-pushed note and single-select chips: the charte's (Norma 2.0, norma/charte/ds/FilterBar.tsx,
// classes of coque.css — same measures as Keystone's former ones, COQUE.md § 5).
export { FilterGroup, FilterLabel, FilterNote, FilterChips } from '@norma/charte/ds/FilterBar';
export type { FilterChipOption } from '@norma/charte/ds/FilterBar';

export interface FilterChipsProps<V extends string = string> {
  options: FilterChipOption<V>[];
  value: V | null | undefined;
  onChange?: (value: V) => void;
  /** Accessible group name (translated). */
  label?: string;
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
