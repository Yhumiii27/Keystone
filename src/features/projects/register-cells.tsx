'use client';
// Cells shared by the three register views (docs/spec/03 §5.4, §5.6): Project, Status ("Move to" menu) and
// Stage deliverables (checklist + stage history popover).
import { ArrowRight, ArrowSquareOut, CaretDown, CheckSquare, Square } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useOptimistic, useRef, useTransition } from 'react';
import { statusTagButtonClass } from '@/components/app/StatusTag';
import { lifecycleTone } from '@/components/app/tones';
import { MenuHeader, MenuItem } from '@/components/ds/Menu';
import { Popover } from '@/components/ds/Popover';
import { Tag } from '@/components/ds/Tag';
import { useToast } from '@/components/ds/Toast';
import { cx } from '@/components/ds/cx';
import { deliverableProgress, transitionsOf, type StageCode } from '@/domain/lifecycle';
import { useI18n } from '@/i18n/client';
import { setDeliverableAction } from './actions';
import type { RegisterRow, StageView } from './register-model';
import s from './register.module.css';

/** Project cell: "#026 · name" (link to Plan — WBS when the project has data), "New" tag, ids line, meta line. */
export function ProjectCell({ row }: { row: RegisterRow }) {
  const { t } = useI18n();
  const name = (
    <>
      {row.name}
      {row.openHref && <ArrowSquareOut className={s.openIcon} aria-hidden />}
      {row.isNew && (
        <Tag tone="accent" size="xs">
          {t('New')}
        </Tag>
      )}
    </>
  );
  return (
    <div className={s.project}>
      {row.openHref ? (
        <Link href={row.openHref} title={t('Open project · Plan — WBS')} className={s.projectName}>
          {name}
        </Link>
      ) : (
        <span className={s.projectName}>{name}</span>
      )}
      <span className={s.projectIds}>{row.idLine}</span>
      <span className={s.projectMeta}>{row.metaLine}</span>
    </div>
  );
}

export interface StatusCellProps {
  stage: StageCode;
  stages: ReadonlyMap<StageCode, StageView>;
  /** Edit controls allowed (not outside the workspace). */
  canEdit: boolean;
  /**
   * A transition was picked. `trigger` is the status button: the menu item that had the focus is gone once the
   * menu closes, so the caller gives the focus back to it (after the move, or when the Force dialog closes).
   */
  onMove: (to: StageCode, trigger: HTMLElement | null) => void;
}

/** Stages deactivated in Settings › Project statuses (A-14): "Move to" skips them. */
const inactiveOf = (stages: ReadonlyMap<StageCode, StageView>) => new Set<string>([...stages.values()].filter((x) => x.inactive).map((x) => x.code));

/** Status tag as a menu button; the menu lists the allowed transitions with their entry gate (TRANS / GATES). */
export function StatusCell({ stage, stages, canEdit, onMove }: StatusCellProps) {
  const { t } = useI18n();
  const cellRef = useRef<HTMLTableCellElement>(null);
  const tone = lifecycleTone(stage);
  const label = stages.get(stage)?.label ?? stage;
  if (!canEdit || tone === 'muted')
    return (
      <td className={s.rel}>
        <span className={cx('tag', `tag-${tone === 'muted' ? 'neutral' : tone}`, s.statusStatic)}>{label}</span>
      </td>
    );
  return (
    <td ref={cellRef} className={s.rel}>
      <Popover
        trigger={
          <>
            {label}
            <CaretDown aria-hidden />
          </>
        }
        triggerClassName={statusTagButtonClass(tone)}
        anchorClassName={s.staticAnchor}
        offset={-4}
        inset={6}
        minWidth="240px"
        zIndex={20}
      >
        <MenuHeader>{t('Move to')}</MenuHeader>
        {transitionsOf(stage, inactiveOf(stages)).map((to) => (
          <MenuItem
            key={to}
            icon={ArrowRight}
            iconTone="accent"
            meta={stages.get(to)?.gate ?? ''}
            onClick={() => onMove(to, cellRef.current?.querySelector<HTMLElement>('button[aria-haspopup]') ?? null)}
          >
            {stages.get(to)?.label ?? to}
          </MenuItem>
        ))}
      </Popover>
    </td>
  );
}

export interface DeliverablesCellProps {
  row: RegisterRow;
  /** Translated label of the row's current stage. */
  stageLabel: string;
  canEdit: boolean;
}

/**
 * "{done} / {total}" bar + popover: deliverables of the current stage (ticking the last one auto-advances the
 * project; the popover stays open on the new stage) and the stage history, newest first.
 */
export function DeliverablesCell({ row, stageLabel, canEdit }: DeliverablesCellProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const base = row.delivs.map((d) => d.done);
  const [ticks, setTick] = useOptimistic(base, (cur: boolean[], a: { index: number; done: boolean }) =>
    cur.map((v, i) => (i === a.index ? a.done : v)),
  );
  const prog = deliverableProgress(ticks);

  const toggle = (index: number) => {
    const done = !ticks[index];
    startTransition(async () => {
      setTick({ index, done });
      const r = await setDeliverableAction({ code: row.code, stage: row.stage, index, done });
      if (!r.ok) toast.showEn(r.error);
    });
  };

  return (
    <td className={s.delivCell}>
      <Popover
        trigger={
          <>
            <span className={s.delivTrack}>
              <span className={s.delivFill} style={{ width: prog.pct }} />
            </span>
            <span className={s.delivCount}>{prog.text}</span>
            <CaretDown className={s.caretMuted} aria-hidden />
          </>
        }
        triggerClassName={s.delivButton}
        anchorClassName={s.staticAnchor}
        align="end"
        offset={2}
        width="min(380px,70vw)"
        padding={10}
        gap={6}
        closeOnSelect={false}
      >
        <div className={s.caption}>
          {t('Deliverables of the current stage')} · {stageLabel}
        </div>
        {row.delivs.map((d, i) => {
          const done = !!ticks[i];
          const I = done ? CheckSquare : Square;
          // R-054 (L-2 "a"): « Planning BL1 posé » follows BL1 — read-only here, with the reason (the server refuses a manual tick too).
          return (
            <button
              key={i}
              type="button"
              className={s.delivItem}
              disabled={!canEdit || !!d.lock}
              aria-pressed={done}
              aria-describedby={d.lock ? `${row.code}-deliv-${i}-lock` : undefined}
              onClick={(e) => {
                e.stopPropagation();
                toggle(i);
              }}
            >
              <I className={cx(s.delivIcon, done && s.delivIconDone)} aria-hidden />
              <span className={s.delivText}>
                {d.label}
                {d.lock && (
                  <span id={`${row.code}-deliv-${i}-lock`} className={s.delivLock}>
                    {d.lock}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        <span className={s.help}>{t('When every deliverable is ticked the project moves to the next stage automatically.')}</span>
        <div className={cx(s.caption, s.captionGap)}>
          {t('Stage history')} · {row.history.length}
        </div>
        {row.history.map((h, i) => (
          <div key={i} className={s.hist}>
            <span className={s.histStage}>
              <span>{h.stage}</span>
              {h.why && <span className={s.histWhy}>{h.why}</span>}
            </span>
            <span className={s.histDate}>{h.date}</span>
            <Tag tone={h.forced ? 'accent' : 'neutral'} size="micro">
              {h.forced ? 'Forcé' : 'Auto'}
            </Tag>
          </div>
        ))}
      </Popover>
    </td>
  );
}
