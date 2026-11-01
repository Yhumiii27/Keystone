'use client';
// R-198 — interactive activity Gantt of the Schedule screen. One row per activity, grouped by work package; zoom day / week /
// month (URL `?zoom=`, links built by the page); baseline bars; relationships drawn as elbow arrows.
// Edits (project's PMs and the director, src/features/schedule/gantt-rights.ts):
// - drag a bar → new start (a "Start no earlier than" constraint); drag its right edge → new duration (working days);
// - drag the dot at its end onto another bar → finish-to-start relationship; click a relationship → change its type / lag or
//   remove it;
// - keyboard: every bar is a button — Enter opens the activity dialog (start, duration, constraint, predecessors), which does
//   everything a drag does.
// While a drag runs, and until the server answers, the bars show the optimistic preview: the same CPM as "Reschedule"
// (src/domain/gantt-edit.ts `previewSchedule`). The Server Functions re-validate, write, reschedule and revalidate the page.
import { useEffect, useId, useMemo, useOptimistic, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from 'react';
import { showToast } from '@/components/ds/Toast';
import { cx } from '@/components/ds/cx';
import { useToday } from '@/components/app/clock';
import { useI18n } from '@/i18n/client';
import { dataText } from '@/i18n/data-text';
import { intlLocale } from '@/i18n/translate';
import { linkCycleText } from '@/features/plan/i18n';
import {
  GANTT_EDIT_ERRORS, applyGanttEdits, barBox, buildCalendars, calendarOf, dragEdit, ganttRange, ganttScale, isoWeekNumber, linkKey, linkLabel, linkPath, lockOf,
  offDays, previewSchedule, storedDates, xOf, type BarBox, type GanttActivity, type GanttDates, type GanttEdit, type GanttEditResult, type GanttLink, type GanttNetwork,
  type GanttZoom,
} from '@/domain/gantt-edit';
import { ganttAddLinkAction, ganttEditActivityAction, ganttEditLinkAction, ganttRemoveLinkAction, type GanttActionResult } from './gantt-actions';
import { useStaleRecordToast } from '@/components/app/StaleRecord';
import { GanttActivityDialog, GanttLinkDialog } from './gantt-dialogs';
import s from './gantt.module.css';

const NAME_W = 280;
const ROW_H = 32;
/** Pointer travel (px) under which a press on a bar is a click, not a drag. */
const CLICK_SLOP = 3;

export interface InteractiveGanttProps {
  code: string;
  network: GanttNetwork;
  zoom: GanttZoom;
  /** Moves, durations and relationships allowed (the page checked the rights; the Server Functions check again). */
  editable: boolean;
  showBaseline?: boolean;
}

type Drag = {
  mode: 'move' | 'resize' | 'link';
  id: string;
  pointerId: number;
  x0: number;
  dx: number;
  /** Link drag: pointer position in timeline coordinates, and the bar under it. */
  px?: number;
  py?: number;
  over?: string | null;
};

type Row = { kind: 'package'; key: string; code: string; name: string; ids: string[] } | { kind: 'activity'; key: string; a: GanttActivity };

type DialogState = { kind: 'activity'; id: string } | { kind: 'link'; pred: string; succ: string } | null;

export function InteractiveGantt({ code, network, zoom, editable, showBaseline = true }: InteractiveGanttProps) {
  const { t, lang } = useI18n();
  const today = useToday();
  const cals = useMemo(() => buildCalendars(network.calendars), [network.calendars]);
  const [pending, startTransition] = useTransition();
  const [optimistic, addOptimistic] = useOptimistic(network, (state: GanttNetwork, edits: GanttEdit[]) => {
    const r = applyGanttEdits(state, edits, cals);
    return r.ok ? r.net : state;
  });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const arrowId = `gantt-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // Escape abandons a running drag (the bars go back; the release then does nothing).
  const dragging = drag != null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      moved.current = true;
      setDrag(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dragging]);

  const byId = useMemo(() => new Map(optimistic.activities.map((a) => [a.id, a])), [optimistic.activities]);
  const stored = useMemo(() => storedDates(network), [network]);

  // The edit the running drag stands for (move / resize), applied on top of the optimistic network.
  const dragged = useMemo((): { edit: GanttEdit | null; result: GanttEditResult | null } => {
    if (!drag || drag.mode === 'link') return { edit: null, result: null };
    const a = byId.get(drag.id);
    const shown = a && stored[a.id];
    if (!a || !shown) return { edit: null, result: null };
    const edit = dragEdit(drag.mode, a, shown, drag.dx, zoom, calendarOf(optimistic, cals, a));
    return { edit, result: edit ? applyGanttEdits(optimistic, [edit], cals) : null };
  }, [drag, byId, stored, zoom, optimistic, cals]);

  const draft = dragged.result?.ok ? dragged.result.net : optimistic;
  const preview = useMemo(() => (draft === network ? null : previewSchedule(draft, cals)), [draft, network, cals]);
  const dates: Record<string, GanttDates> = preview?.ok ? preview.dates : stored;

  // Rows: work packages in WBS order with their activities, then activities of no known package.
  const rows = useMemo(() => {
    const out: Row[] = [];
    const seen = new Set<string>();
    for (const p of optimistic.packages) {
      const acts = optimistic.activities.filter((a) => a.wbs === p.code);
      if (!acts.length) continue;
      out.push({ kind: 'package', key: `wp:${p.code}`, code: p.code, name: p.name, ids: acts.map((a) => a.id) });
      for (const a of acts) {
        out.push({ kind: 'activity', key: a.id, a });
        seen.add(a.id);
      }
    }
    for (const a of optimistic.activities) if (!seen.has(a.id)) out.push({ kind: 'activity', key: a.id, a });
    return out;
  }, [optimistic]);
  const rowOf = useMemo(() => new Map(rows.flatMap((r, i) => (r.kind === 'activity' ? [[r.a.id, i] as const] : []))), [rows]);

  // Scale: the range covers the stored and previewed dates, the baseline, the data date and today.
  const scale = useMemo(() => {
    const all: string[] = [network.dataDate, today];
    for (const d of Object.values(stored)) all.push(d.start, d.finish);
    if (preview?.ok) for (const d of Object.values(preview.dates)) all.push(d.start, d.finish);
    if (showBaseline) for (const a of network.activities) for (const d of [a.baselineStart, a.baselineFinish]) if (d) all.push(d);
    const r = ganttRange(all, zoom);
    return ganttScale(zoom, r.from, r.to);
  }, [network, stored, preview, showBaseline, today, zoom]);
  const projectCal = cals[network.projectCalendar] ?? Object.values(cals)[0];
  const shading = useMemo(() => (projectCal ? offDays(scale, projectCal) : []), [scale, projectCal]);

  const fmtDay = useMemo(() => new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), [lang]);
  const fmtMonth = useMemo(() => new Intl.DateTimeFormat(intlLocale(lang), { month: zoom === 'month' ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' }), [lang, zoom]);
  const dayText = (iso: string) => fmtDay.format(new Date(`${iso}T00:00:00Z`));

  const boxes = useMemo(() => {
    const m = new Map<string, BarBox>();
    for (const a of optimistic.activities) {
      const d = dates[a.id];
      if (d) m.set(a.id, barBox(scale, d, a.duration === 0));
    }
    return m;
  }, [optimistic.activities, dates, scale]);

  /** R-010: the activity's version token as the page read it (sent back by its edits). */
  const versionOf = (id: string) => network.activities.find((a) => a.id === id)?.version ?? '';
  const stale = useStaleRecordToast();

  const errorText = (r: Extract<GanttEditResult, { ok: false }>) => (r.error === 'cycle' ? linkCycleText(r.cycle ?? [], lang) : t(GANTT_EDIT_ERRORS[r.error]));

  /** Checks the edits on the optimistic network, shows them at once, then lets the Server Function decide. */
  function commit(edits: GanttEdit[], call: () => Promise<GanttActionResult>, onDone?: (ok: boolean) => void) {
    const check = applyGanttEdits(optimistic, edits, cals);
    if (!check.ok) {
      showToast(errorText(check));
      onDone?.(false);
      return;
    }
    startTransition(async () => {
      addOptimistic(edits);
      try {
        const r = await call();
        if (!stale(r)) showToast('error' in r ? r.error : r.toast);
        onDone?.(!('error' in r));
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e));
        onDone?.(false);
      }
    });
  }

  const pointInTimeline = (e: { clientX: number; clientY: number }) => {
    const r = timelineRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  };

  function onPointerDown(e: ReactPointerEvent<HTMLElement>, a: GanttActivity, mode: Drag['mode']) {
    moved.current = false;
    if (!editable || pending || e.button !== 0) return;
    const lock = lockOf(a);
    if (mode === 'move' && lock) return; // a click still opens the dialog (onClick)
    if (mode === 'resize' && (lock === 'complete' || a.duration === 0)) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointInTimeline(e);
    setDrag({ mode, id: a.id, pointerId: e.pointerId, x0: e.clientX, dx: 0, px: p.x, py: p.y, over: null });
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x0;
    if (Math.abs(dx) > CLICK_SLOP) moved.current = true;
    if (drag.mode === 'link') {
      moved.current = true;
      const p = pointInTimeline(e);
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-gantt-act]');
      const over = el?.dataset.ganttAct ?? null;
      setDrag({ ...drag, dx, px: p.x, py: p.y, over: over && over !== drag.id ? over : null });
    } else setDrag({ ...drag, dx });
  }

  function onPointerUp(e: ReactPointerEvent<HTMLElement>) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    setDrag(null);
    // Pointer events of the edge and the dot bubble to the bar: the capture is released here, once.
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.mode === 'link') {
      if (d.over) commit([{ kind: 'addLink', link: { pred: d.id, succ: d.over, type: 'FS', lag: 0 } }], () => ganttAddLinkAction(code, { pred: d.id, succ: d.over!, type: 'FS', lag: '0' }));
      return;
    }
    if (!moved.current || !dragged.edit) return;
    const edit = dragged.edit;
    if (edit.kind === 'move') commit([edit], () => ganttEditActivityAction(code, edit.id, { start: edit.start, version: versionOf(edit.id) }));
    else if (edit.kind === 'duration') commit([edit], () => ganttEditActivityAction(code, edit.id, { duration: String(edit.days), version: versionOf(edit.id) }));
  }

  function onPointerCancel() {
    setDrag(null);
  }

  const onBarClick = (id: string) => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    setDialog({ kind: 'activity', id });
  };

  /** Outline under the pointer while a bar is dragged (the bar itself shows where the CPM puts it). */
  const ghostBox = (d: GanttDates | undefined, g: Drag): BarBox | null => {
    if (!d) return null;
    const b = barBox(scale, d);
    const shift = Math.round(g.dx / scale.pxPerDay) * scale.pxPerDay;
    return g.mode === 'move' ? { ...b, left: b.left + shift } : { ...b, width: Math.max(scale.pxPerDay, b.width + shift) };
  };

  const height = rows.length * ROW_H;
  const yOf = (id: string) => (rowOf.get(id) ?? 0) * ROW_H + ROW_H / 2;
  const todayX = today >= scale.origin && today <= scale.end ? xOf(scale, today) : null;
  const dlgActivity = dialog?.kind === 'activity' ? byId.get(dialog.id) : undefined;
  const dlgLink = dialog?.kind === 'link' ? optimistic.links.find((l) => l.pred === dialog.pred && l.succ === dialog.succ) : undefined;
  const nameOf = (id: string) => {
    const a = byId.get(id);
    return a ? `${a.id} · ${dataText(a.name, lang)}` : id;
  };

  return (
    <div className={s.wrap} aria-busy={pending || undefined}>
      {preview && !preview.ok && <div className={s.warn}>{preview.cycle ? linkCycleText(preview.cycle, lang) : t('The schedule data is invalid')}</div>}
      <div className={s.scroller}>
        <div className={s.inner} style={{ width: NAME_W + scale.width }}>
          <div className={s.head}>
            <div className={s.headName}>{t('Activity')}</div>
            <div className={s.headTimeline} style={{ width: scale.width }}>
              <div className={s.headMonths}>
                {scale.months.map((m) => (
                  <div key={m.date} className={s.headCell} style={{ left: m.x, width: m.width }}>
                    {fmtMonth.format(new Date(`${m.date}T00:00:00Z`))}
                  </div>
                ))}
              </div>
              {scale.units.length > 0 && (
                <div className={s.headUnits}>
                  {scale.units.map((u) => (
                    <div key={u.date} className={s.headCell} style={{ left: u.x, width: u.width }}>
                      {zoom === 'day' ? +u.date.slice(8, 10) : `${lang === 'fr' ? 'S' : 'W'}${isoWeekNumber(u.date)}`}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={s.body} style={{ height }}>
            <div className={s.bg} style={{ left: NAME_W, width: scale.width, height }} aria-hidden>
              {shading.map((d) => (
                <div key={d.date} className={s.off} style={{ left: d.x, width: d.width }} />
              ))}
              {(scale.units.length ? scale.units : scale.months).map((u) => (
                <div key={u.date} className={s.gridLine} style={{ left: u.x }} />
              ))}
              {todayX != null && <div className={s.today} style={{ left: todayX }} title={t('Today')} />}
            </div>

            <svg className={s.links} style={{ left: NAME_W }} width={scale.width} height={height} aria-hidden>
              <defs>
                <marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L8,4 L0,8 z" className={s.arrowHead} />
                </marker>
              </defs>
              {optimistic.links.map((l) => {
                const p = boxes.get(l.pred);
                const q = boxes.get(l.succ);
                if (!p || !q) return null;
                const d = linkPath(l.type, p, q, yOf(l.pred), yOf(l.succ));
                const on = dialog?.kind === 'link' && dialog.pred === l.pred && dialog.succ === l.succ;
                const crit = dates[l.pred]?.critical && dates[l.succ]?.critical;
                return (
                  <g key={linkKey(l.pred, l.succ)}>
                    <path d={d} className={cx(s.link, crit && s.linkCrit, on && s.linkOn)} markerEnd={`url(#${arrowId})`} />
                    <path
                      d={d}
                      className={s.linkHit}
                      onClick={() => setDialog({ kind: 'link', pred: l.pred, succ: l.succ })}
                    >
                      <title>{`${l.pred} ${linkLabel(l)} → ${l.succ}`}</title>
                    </path>
                  </g>
                );
              })}
              {drag?.mode === 'link' && boxes.get(drag.id) && (
                <line
                  x1={boxes.get(drag.id)!.left + boxes.get(drag.id)!.width}
                  y1={yOf(drag.id)}
                  x2={(drag.px ?? 0) - NAME_W}
                  y2={drag.py ?? 0}
                  className={s.linkDraft}
                />
              )}
            </svg>

            <div ref={timelineRef} className={s.rows}>
              {rows.map((r) =>
                r.kind === 'package' ? (
                  <PackageRow key={r.key} name={`${r.code} · ${dataText(r.name, lang)}`} boxes={r.ids.map((id) => boxes.get(id)).filter((b): b is BarBox => !!b)} width={scale.width} />
                ) : (
                  <div key={r.key} className={s.row}>
                    <div className={s.nameCell} title={nameOf(r.a.id)}>
                      <span className={s.actId}>{r.a.id}</span>
                      <span className={s.actName}>{dataText(r.a.name, lang)}</span>
                    </div>
                    <div className={s.track} style={{ width: scale.width }}>
                      {showBaseline && r.a.baselineStart && r.a.baselineFinish && (
                        <div className={s.baseline} style={barStyle(barBox(scale, { start: r.a.baselineStart, finish: r.a.baselineFinish }, r.a.duration === 0))} />
                      )}
                      {(() => {
                        const b = boxes.get(r.a.id);
                        const d = dates[r.a.id];
                        if (!b || !d) return null;
                        const lock = lockOf(r.a);
                        const label = `${r.a.id} · ${dataText(r.a.name, lang)} · ${dayText(d.start)} → ${dayText(d.finish)}`;
                        const canMove = editable && !lock;
                        const canResize = editable && lock !== 'complete' && r.a.duration > 0;
                        const ghost = drag && drag.id === r.a.id && drag.mode !== 'link' && Math.abs(drag.dx) > CLICK_SLOP ? ghostBox(stored[r.a.id], drag) : null;
                        return (
                          <>
                          {ghost && <div className={s.ghost} style={barStyle(ghost)} aria-hidden />}
                          <div
                            role="button"
                            tabIndex={0}
                            aria-label={label}
                            title={label}
                            data-gantt-act={r.a.id}
                            className={cx(
                              s.bar, b.milestone && s.milestone, d.critical && s.crit, lock === 'complete' && s.done, canMove && s.movable,
                              drag?.mode === 'link' && drag.over === r.a.id && s.dropTarget, drag && drag.id === r.a.id && s.dragging,
                            )}
                            style={barStyle(b)}
                            onPointerDown={(e) => onPointerDown(e, r.a, 'move')}
                            onPointerMove={onPointerMove}
                            onPointerUp={onPointerUp}
                            onPointerCancel={onPointerCancel}
                            onClick={() => onBarClick(r.a.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setDialog({ kind: 'activity', id: r.a.id });
                              }
                            }}
                          >
                            {!b.milestone && <div className={s.fill} style={{ width: `${Math.max(0, Math.min(100, r.a.pct))}%` }} />}
                            {canResize && (
                              <span
                                className={s.resize}
                                aria-hidden
                                onPointerDown={(e) => onPointerDown(e, r.a, 'resize')}
                              />
                            )}
                            {editable && (
                              <span
                                className={s.linkHandle}
                                aria-hidden
                                title={t('Drag onto another activity to link them (finish-to-start)')}
                                onPointerDown={(e) => onPointerDown(e, r.a, 'link')}
                                onClick={(e) => e.stopPropagation()}
                              />
                            )}
                          </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      </div>

      {dlgActivity && (
        <GanttActivityDialog
          activity={dlgActivity}
          network={optimistic}
          dates={dates[dlgActivity.id] ?? null}
          editable={editable}
          pending={pending}
          nameOf={nameOf}
          dayText={dayText}
          onClose={() => setDialog(null)}
          onApply={(edits, values) => commit(edits, () => ganttEditActivityAction(code, dlgActivity.id, { ...values, version: versionOf(dlgActivity.id) }), (ok) => ok && setDialog(null))}
          onAddLink={(link) => commit([{ kind: 'addLink', link }], () => ganttAddLinkAction(code, { ...link, lag: String(link.lag) }))}
          onEditLink={(link) => commit([{ kind: 'editLink', link }], () => ganttEditLinkAction(code, { ...link, lag: String(link.lag) }))}
          onRemoveLink={(l) => commit([{ kind: 'removeLink', pred: l.pred, succ: l.succ }], () => ganttRemoveLinkAction(code, l.pred, l.succ))}
        />
      )}
      {dlgLink && (
        <GanttLinkDialog
          link={dlgLink}
          editable={editable}
          pending={pending}
          nameOf={nameOf}
          onClose={() => setDialog(null)}
          onSave={(link: GanttLink) => commit([{ kind: 'editLink', link }], () => ganttEditLinkAction(code, { ...link, lag: String(link.lag) }), (ok) => ok && setDialog(null))}
          onRemove={() => commit([{ kind: 'removeLink', pred: dlgLink.pred, succ: dlgLink.succ }], () => ganttRemoveLinkAction(code, dlgLink.pred, dlgLink.succ), (ok) => ok && setDialog(null))}
        />
      )}
    </div>
  );
}

const barStyle = (b: BarBox) => (b.milestone ? { left: b.left } : { left: b.left, width: b.width });

/** Work package summary row: a thin bar from its first start to its last finish. */
function PackageRow({ name, boxes, width }: { name: string; boxes: BarBox[]; width: number }) {
  const left = boxes.length ? Math.min(...boxes.map((b) => b.left)) : 0;
  const right = boxes.length ? Math.max(...boxes.map((b) => b.left + b.width)) : 0;
  return (
    <div className={cx(s.row, s.pkgRow)}>
      <div className={cx(s.nameCell, s.pkgName)} title={name}>
        {name}
      </div>
      <div className={s.track} style={{ width }}>
        {boxes.length > 0 && <div className={s.summary} style={{ left, width: Math.max(2, right - left) }} />}
      </div>
    </div>
  );
}
