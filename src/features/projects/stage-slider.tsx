'use client';
// Stage slider (docs/spec/03 §5.2, template 642–660, logic stVals 3905–3915): accessible range control with
// 14 stops (All + the 13 stages). Pointer down/drag picks the nearest stop, arrows/Home/End step through them.
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from '@/components/ds/cx';
import { sliderLeft, sliderTicks, stopForKey, stopFromRatio, SLIDER_MAX, type SliderTick, type StageCode } from '@/domain/lifecycle';
import s from './register.module.css';

export interface StageSliderProps {
  /** Selected stop (0 = All). */
  value: number;
  onChange: (stop: number) => void;
  /** Projects per stage in the current zone, and all of them. */
  counts: Partial<Record<StageCode, number>>;
  total: number;
  /** Translated tick labels: 'All' then ST_SHORT per stage. */
  labels: string[];
  /** aria-valuetext (selected label, translated). */
  valueText: string;
  /** Accessible name of the slider (translated); the prototype had none. */
  label: string;
}

const DOT: Record<SliderTick['dot'], string | undefined> = { on: s.dotOn, past: s.dotPast, has: s.dotHas, empty: undefined };
const TEXT: Record<SliderTick['text'], string | undefined> = { on: s.tickLabelOn, has: s.tickLabelHas, empty: undefined };

export function StageSlider({ value, onChange, counts, total, labels, valueText, label }: StageSliderProps) {
  const dragging = useRef(false);
  const ticks = sliderTicks(counts, total, value);

  const stopAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return r.width ? stopFromRatio((e.clientX - r.left) / r.width) : null;
  };
  const set = (i: number | null) => {
    if (i !== null && i !== value) onChange(i);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus();
    dragging.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best effort */
    }
    set(stopAt(e));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) set(stopAt(e));
  };
  const onPointerUp = () => {
    dragging.current = false;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = stopForKey(e.key, value);
    if (i === null) return;
    e.preventDefault();
    set(i);
  };

  return (
    <div className={s.sliderScroll}>
      <div className={s.sliderPad}>
        <div
          tabIndex={0}
          role="slider"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={SLIDER_MAX}
          aria-valuenow={value}
          aria-valuetext={valueText}
          className={s.slider}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <div className={s.track} />
          <div className={s.trackFill} style={{ width: sliderLeft(value) }} />
          {ticks.map((t) => (
            <div key={t.index} className={s.tick} style={{ left: t.left }}>
              <span className={cx(s.dot, t.index === 0 && s.dotFirst, DOT[t.dot])} />
              <span className={cx(s.lift, t.odd && s.liftOdd)} />
              <span className={cx(s.tickLabel, t.odd && s.tickLabelOdd, TEXT[t.text])}>{labels[t.index] ?? t.label}</span>
              <span className={s.tickCount}>{t.count}</span>
            </div>
          ))}
          <div className={s.thumb} style={{ left: sliderLeft(value) }} />
        </div>
      </div>
    </div>
  );
}
