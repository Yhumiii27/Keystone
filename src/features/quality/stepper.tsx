// Step indicator of the NCR and deliverable drawers (template 1916 / 1959): 10px dots (accent when reached, neutral-700
// otherwise), labels (text / neutral-500) and 22×1 neutral-800 connectors with a 6px margin — narrower than the shared
// FlowStepper's 36px, as the prototype draws these two. Server-compatible.
import { cx } from '@/components/ds/cx';
import s from './quality.module.css';

export function QualityStepper({ steps, label }: { steps: { label: string; reached: boolean }[]; label: string }) {
  const current = steps.reduce((c, x, i) => (x.reached ? i : c), -1);
  return (
    <div className={s.steps} role="list" aria-label={label}>
      {steps.map((x, i) => (
        <div key={i} role="listitem" className={cx(s.step, x.reached && s.stepOn)} aria-current={i === current ? 'step' : undefined}>
          <span className={s.stepDot} />
          <span className={s.stepLabel}>{x.label}</span>
          {i < steps.length - 1 && <span className={s.stepLine} />}
        </div>
      ))}
    </div>
  );
}
