// Stepper family (docs/spec/02 C-26): FlowStepper (object workflows), NumberedStepper (import/deposit
// modals), WizardSteps (New project bars). Server-compatible.
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import { STEP_GLOW } from './tones';
import s from './Stepper.module.css';

export interface FlowStep {
  /** Translated label. */
  label: ReactNode;
  /** Reached: accent dot + text label; otherwise neutral-700 dot + neutral-500 label. */
  reached: boolean;
  /** Current step glow `0 0 8px accent 60%`. */
  current?: boolean;
  /** Explicit colours (override the reached/future look). */
  dot?: string;
  color?: string;
}

export interface FlowStepperProps {
  steps: FlowStep[];
  /** Rejected/cancelled flow: every dot neutral-700, labels neutral-500. */
  rejected?: boolean;
  /** Right-aligned meta, e.g. "Raised by M. Lefebvre". */
  meta?: ReactNode;
  className?: string;
}

/** Row `flex; wrap; 11.5px neutral-400`: 10px dot · label · 36×1 neutral-800 connector (margin 0 8px). */
export function FlowStepper({ steps, rejected, meta, className }: FlowStepperProps) {
  return (
    <div className={cx(s.flow, className)}>
      {steps.map((st, i) => {
        const reached = st.reached && !rejected;
        const vars = {
          '--st-dot': st.dot ?? (reached ? 'var(--color-accent)' : 'var(--color-neutral-700)'),
          '--st-color': st.color ?? (reached ? 'var(--color-text)' : 'var(--color-neutral-500)'),
          '--st-ring': reached && st.current ? STEP_GLOW : 'none',
        } as CSSProperties;
        return (
          <div key={i} className={s.flowItem} style={vars} aria-current={st.current ? 'step' : undefined}>
            <span className={s.flowDot} />
            <span className={s.flowLabel}>{st.label}</span>
            {i < steps.length - 1 && <span className={s.flowLine} />}
          </div>
        );
      })}
      {meta != null && <span className={s.flowMeta}>{meta}</span>}
    </div>
  );
}

export interface NumberedStepperProps {
  /** Translated step labels. */
  steps: ReactNode[];
  /** Current step, 1-based. */
  current: number;
  className?: string;
}

/** 18px number bubbles (accent-600 when reached, else neutral-700) + label (accent-200 current, text done, neutral-500 future). */
export function NumberedStepper({ steps, current, className }: NumberedStepperProps) {
  return (
    <div className={cx(s.numbered, className)}>
      {steps.map((label, i) => {
        const n = i + 1;
        const vars = {
          '--st-color': current === n ? 'var(--color-accent-200)' : current > n ? 'var(--color-text)' : 'var(--color-neutral-500)',
          '--st-dot': current >= n ? 'var(--color-accent-600)' : 'var(--color-neutral-700)',
        } as CSSProperties;
        return (
          <span key={i} className={s.numItem} style={vars} aria-current={current === n ? 'step' : undefined}>
            <span className={s.bubble}>{n}</span>
            {label}
          </span>
        );
      })}
    </div>
  );
}

export interface WizardStepsProps {
  /** Translated step labels (Basics, Structure, Budget, Schedule). */
  steps: ReactNode[];
  /** Current step, 1-based. Bars up to and including the current step are accent. */
  current: number;
  className?: string;
}

/** `grid repeat(n,1fr) gap 6`: 2px bar (accent if index < step, else neutral-800) + 11.5px label (text on current). */
export function WizardSteps({ steps, current, className }: WizardStepsProps) {
  return (
    <div className={cx(s.bars, className)} style={{ '--st-n': steps.length } as CSSProperties}>
      {steps.map((label, i) => (
        <div key={i} className={s.barItem} aria-current={i + 1 === current ? 'step' : undefined}>
          <div className={cx(s.bar, i < current && s.barOn)} />
          <span className={cx(s.barLabel, i + 1 === current && s.barLabelOn)}>{label}</span>
        </div>
      ))}
    </div>
  );
}
