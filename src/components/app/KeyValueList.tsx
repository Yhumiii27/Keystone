// Key–value list (docs/spec/02 C-13). Server-compatible.
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import { Eyebrow } from './Eyebrow';
import s from './KeyValueList.module.css';

export interface KeyValue {
  /** Key (translated). */
  k: ReactNode;
  v: ReactNode;
  /** Value colour (LO/OK or token). */
  color?: string;
  /** Stable React key when `k` is not a string. */
  id?: string;
}

export interface KeyValueListProps {
  items: KeyValue[];
  /** Optional section eyebrow (accent) above the rows. */
  title?: ReactNode;
  /** `rows` (default): key left / value right with a neutral-900 rule · `inline`: wrapping eyebrow-over-value items. */
  layout?: 'rows' | 'inline';
  className?: string;
  style?: CSSProperties;
}

export function KeyValueList({ items, title, layout = 'rows', className, style }: KeyValueListProps) {
  if (layout === 'inline')
    return (
      <div className={cx(s.inline, className)} style={style}>
        {items.map((it, i) => (
          <div key={it.id ?? (typeof it.k === 'string' ? it.k : i)} className={s.item}>
            <span className={s.ik}>{it.k}</span>
            <span className={s.iv} style={it.color ? ({ '--kv-color': it.color } as CSSProperties) : undefined}>
              {it.v}
            </span>
          </div>
        ))}
      </div>
    );
  return (
    <div className={cx(s.list, className)} style={style}>
      {title != null && <Eyebrow>{title}</Eyebrow>}
      {items.map((it, i) => (
        <div key={it.id ?? (typeof it.k === 'string' ? it.k : i)} className={s.row}>
          <span className={s.k}>{it.k}</span>
          <span className={s.v} style={it.color ? ({ '--kv-color': it.color } as CSSProperties) : undefined}>
            {it.v}
          </span>
        </div>
      ))}
    </div>
  );
}
