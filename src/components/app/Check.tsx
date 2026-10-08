// Check controls (docs/spec/02 C-27) and wizard choice cards (C-21). Server-compatible: interactive
// variants render buttons and need `onToggle` / `onSelect` from a Client Component.
import { Check, CheckCircle as CheckCircleIcon, Circle } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import s from './Check.module.css';

export interface CheckCircleProps {
  done: boolean;
  /** 18 (task lists, glyph 10px) or 14 (WBS drawer to-dos, glyph 9px). */
  size?: 18 | 14;
  onToggle?: () => void;
  /** Accessible label / tooltip (translated), e.g. t('Mark done'). */
  label?: string;
  className?: string;
}

/** Round toggle: ring neutral-600 / transparent; done = accent ring + fill with a ground-coloured check. */
export function CheckCircle({ done, size = 18, onToggle, label, className }: CheckCircleProps) {
  const vars = { '--ck-size': `${size}px`, '--ck-glyph': size === 14 ? '9px' : '10px' } as CSSProperties;
  const glyph = done ? <Check className={s.glyph} aria-hidden /> : null;
  return onToggle ? (
    <button type="button" className={cx(s.circle, done && s.done, className)} style={vars} onClick={onToggle} title={label} aria-label={label} aria-pressed={done}>
      {glyph}
    </button>
  ) : (
    <span className={cx(s.circle, s.static, done && s.done, className)} style={vars} aria-hidden>
      {glyph}
    </span>
  );
}

/** 16px square check box (checklist): radius 4, 1.5px ring; done = accent fill + check. */
export function CheckSquare({ done, className }: { done: boolean; className?: string }) {
  return (
    <span className={cx(s.square, done && s.done, className)} aria-hidden>
      {done && <Check className={s.glyph} />}
    </span>
  );
}

export interface CheckRowProps {
  done: boolean;
  onToggle?: () => void;
  children: ReactNode;
}

/** Checklist row button: square check + text (line-through neutral-500 when done); gap 10 · padding 7px 0 · bottom rule. */
export function CheckRow({ done, onToggle, children }: CheckRowProps) {
  return (
    <button type="button" className={s.row} onClick={onToggle} aria-pressed={done}>
      <CheckSquare done={done} />
      <span className={cx(done && s.rowDone)}>{children}</span>
    </button>
  );
}

/** Icon check (meeting actions): filled CheckCircle accent-300 when done, Circle neutral-500 otherwise (16–17px). */
export function IconCheck({ done, size = 16, onToggle, label }: { done: boolean; size?: 16 | 17; onToggle?: () => void; label?: string }) {
  const I = done ? CheckCircleIcon : Circle;
  return (
    <button
      type="button"
      className={cx(s.iconCheck, done && s.iconCheckDone)}
      style={{ '--ic-size': `${size}px` } as CSSProperties}
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={done}
    >
      <I weight={done ? 'fill' : 'regular'} aria-hidden />
    </button>
  );
}

/** 14px radio dot: selected = accent border + fill with an inset 3px neutral-900 ring. */
export function RadioDot({ on, className }: { on: boolean; className?: string }) {
  return <span className={cx(s.radio, on && s.radioOn, className)} aria-hidden />;
}

export interface ChoiceCardProps {
  selected: boolean;
  /** Name (13.5px · 500). */
  title: ReactNode;
  /** Description (12px neutral-400). */
  description?: ReactNode;
  onSelect?: () => void;
  className?: string;
}

/** Wizard template card: neutral-900 ground, 1px border (accent when selected, neutral-600 on hover), radio dot + name + description. */
export function ChoiceCard({ selected, title, description, onSelect, className }: ChoiceCardProps) {
  return (
    <button type="button" className={cx(s.choice, selected && s.choiceOn, className)} onClick={onSelect} aria-pressed={selected}>
      <span className={s.choiceHead}>
        <RadioDot on={selected} />
        <span className={s.choiceName}>{title}</span>
      </span>
      {description != null && <span className={s.choiceDesc}>{description}</span>}
    </button>
  );
}
