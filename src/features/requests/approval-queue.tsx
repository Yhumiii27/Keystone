'use client';
// "Awaiting your decision" card of the Approvals screen (docs/spec/08 §6.4–§6.5; template 2754–2780, logic 4117–4128):
// one block per pending request with its impact line and the decide forms — approve (task sent to the person),
// propose a reschedule (+1/+2/+3 weeks, reason) or reject (reason). The decide state (`decide`) is transient client
// state; decisions go through the Server Functions. Decision controls are hidden when the viewer may not decide.
// Keyboard: the reason field takes the focus when a form opens; Esc or Cancel closes it and returns the focus to the
// "Propose reschedule" / "Reject" button that opened it.
import {
  ArrowFatUp, CalendarBlank, CalendarDots, Check, Gauge, Lightning, PaperPlaneTilt, TreeStructure, User, X,
} from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { Segmented } from '@/components/ds/Segmented';
import { cx } from '@/components/ds/cx';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { approveRequestAction, proposeRescheduleAction, rejectRequestAction, type RequestActionResult } from './actions';
import type { QueueItemView } from './model';
import s from './requests.module.css';

export interface ApprovalQueueProps {
  items: QueueItemView[];
  /** Translated texts of the card. */
  labels: { title: string; hint: string; empty: string };
  canDecide: boolean;
}

interface Decide {
  id: string | null;
  mode: 'reschedule' | 'reject' | null;
  shift: 1 | 2 | 3;
  note: string;
}
const CLOSED: Decide = { id: null, mode: null, shift: 1, note: '' };

export function ApprovalQueue({ items, labels, canDecide }: ApprovalQueueProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [decide, setDecide] = useState<Decide>(CLOSED);
  const [busy, start] = useTransition();
  const cardRef = useRef<HTMLDivElement>(null);
  // Trigger to focus once a decide form closes without a decision ("RQ-041:reschedule"), after the re-render.
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    const key = refocus.current;
    if (!key) return;
    refocus.current = null;
    cardRef.current?.querySelector<HTMLElement>(`[data-decide="${key}"]`)?.focus();
  });
  const cancel = () => {
    if (decide.id && decide.mode) refocus.current = `${decide.id}:${decide.mode}`;
    setDecide(CLOSED);
  };
  const onFormKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancel();
    }
  };

  const run = (fn: () => Promise<RequestActionResult>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.showEn(r.error);
      else setDecide(CLOSED);
    });

  return (
    <div ref={cardRef} className={cx('card', 'elev-sm', s.queueCard)}>
      <div className={s.cardHead}>
        <div className={cx('card-title', s.titlePush)}>{labels.title}</div>
        <span className={s.cardHint}>{labels.hint}</span>
      </div>
      {items.map((r) => {
        const mine = canDecide && decide.id === r.id;
        return (
          <div key={r.id} className={cx(s.item, mine && s.itemOn)}>
            <div className={s.meta}>
              <span className={s.num}>{r.id}</span>
              <span>{r.meta}</span>
              <span className={cx('tag', 'tag-neutral', s.projTag)}>{r.project}</span>
              {r.high && (
                <span className={s.metaFlag}>
                  <ArrowFatUp aria-hidden />
                  {t('High priority')}
                </span>
              )}
              {r.critical && (
                <span className={s.metaFlag}>
                  <Lightning aria-hidden />
                  {t('Critical path')}
                </span>
              )}
            </div>
            <div className={s.itemTitle}>{r.title}</div>
            <div className={s.facts}>
              <span className={s.fact}>
                <TreeStructure className={s.factIcon} aria-hidden />
                {r.actLine}
              </span>
              <span className={s.fact}>
                <User className={s.factIcon} aria-hidden />
                {r.person}
              </span>
              <span className={s.fact}>
                <CalendarBlank className={s.factIcon} aria-hidden />
                {`${r.dates} · ${r.hours}`}
              </span>
            </div>
            {r.note && <div className={s.note}>{r.note}</div>}
            <div className={s.impact} style={{ '--impact-color': r.impactColor } as CSSProperties}>
              <Gauge aria-hidden />
              {r.impact}
            </div>
            {mine && decide.mode === 'reschedule' && (
              <div className={s.decideBox} onKeyDown={onFormKey}>
                <div className={s.decideRow}>
                  <span className={s.proposeLabel}>{t('Propose')}</span>
                  <Segmented
                    label={t('Propose')}
                    value={String(decide.shift)}
                    options={r.shiftLabels.map((l, i) => ({ value: String(i + 1), label: l }))}
                    onChange={(v) => setDecide((d) => ({ ...d, shift: Number(v) as 1 | 2 | 3 }))}
                  />
                  <span className={s.proposedText}>→ {r.proposedByShift[decide.shift - 1]}</span>
                </div>
                <div className={s.decideInputs}>
                  <input
                    className={cx('input', s.reasonInput)}
                    value={decide.note}
                    maxLength={1000}
                    autoFocus
                    aria-label={t('Reason for the PM (e.g. over capacity that week)')}
                    placeholder={t('Reason for the PM (e.g. over capacity that week)')}
                    onChange={(e) => setDecide((d) => ({ ...d, note: e.target.value }))}
                  />
                  <Button variant="primary" icon={PaperPlaneTilt} className={s.decideBtn} disabled={busy} onClick={() => run(() => proposeRescheduleAction(r.id, decide.shift, decide.note))}>
                    {t('Send proposal')}
                  </Button>
                  <Button variant="ghost" className={s.decideGhost} onClick={cancel}>
                    {t('Cancel')}
                  </Button>
                </div>
              </div>
            )}
            {mine && decide.mode === 'reject' && (
              <div className={s.rejectBox} onKeyDown={onFormKey}>
                <input
                  className={cx('input', s.reasonInput)}
                  value={decide.note}
                  maxLength={1000}
                  autoFocus
                  aria-label={t('Reason — the PM sees this')}
                  placeholder={t('Reason — the PM sees this')}
                  onChange={(e) => setDecide((d) => ({ ...d, note: e.target.value }))}
                />
                <Button variant="secondary" icon={X} className={s.decideBtn} disabled={busy} onClick={() => run(() => rejectRequestAction(r.id, decide.note))}>
                  {t('Confirm reject')}
                </Button>
                <Button variant="ghost" className={s.decideGhost} onClick={cancel}>
                  {t('Cancel')}
                </Button>
              </div>
            )}
            {canDecide && !mine && (
              <div className={s.actions}>
                <Button variant="primary" icon={Check} className={s.itemBtn} disabled={busy} onClick={() => run(() => approveRequestAction(r.id))}>
                  {r.approveLabel}
                </Button>
                <Button variant="secondary" icon={CalendarDots} className={s.itemBtn} data-decide={`${r.id}:reschedule`} onClick={() => setDecide({ id: r.id, mode: 'reschedule', shift: 1, note: '' })}>
                  {t('Propose reschedule')}
                </Button>
                <Button variant="ghost" className={s.rejectBtn} data-decide={`${r.id}:reject`} onClick={() => setDecide({ id: r.id, mode: 'reject', shift: 1, note: '' })}>
                  {t('Reject')}
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {!items.length && <div className={s.queueEmpty}>{labels.empty}</div>}
    </div>
  );
}
