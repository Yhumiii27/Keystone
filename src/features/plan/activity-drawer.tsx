// Activity drawer of the Plan screen (docs/spec/05 §2.4.5, template 1105–1163). Server-rendered content inside
// the DS Drawer (client): opened by `?act=A1250`, closed (×, scrim, Esc) to `closeHref`, which keeps the row
// highlighted (`?sel=`). Four sections: General · Relationships · Resources & cost · To-dos.
// Chapter 4: editors override the activity calendar, add / remove relationships and add, tick and remove to-dos
// (./plan-controls.tsx); read-only viewers see the prototype's static content.
// Delivery 7 (NEW-D2-2, R-062): a "Change requests" section lists the requests that name the activity (with the new
// duration each asks for), linked to Change control.
import { ArrowsLeftRight, CalendarDots, Check, Hourglass } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { Avatar } from '@/components/app/Badges';
import { ButtonLink } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Drawer } from '@/components/ds/Drawer';
import { Tag } from '@/components/ds/Tag';
import type { T } from '@/i18n/translate';
import type { DrawerLine, DrawerView } from './drawer-model';
import { ActivityCalendarSelect, AddRelationshipButton, RemoveLinkButton, RemoveTodoButton, TodoComposer, TodoRing } from './plan-controls';
import s from './plan.module.css';

export interface ActivityDrawerProps {
  view: DrawerView;
  /** Plan URL without `?act=` (keeps the view and the selection). */
  closeHref: string;
  /** Schedule screen of the project ("Show in Gantt"). */
  scheduleHref: string;
  t: T;
  /** Project code (Server Functions). */
  code: string;
  /** Activity edits allowed (calendar override, relationships, to-dos). */
  canEdit?: boolean;
  /** Other activities as "A1240 · Steel erection — Bays 1–2" (EN) for "Add relationship". */
  linkOptions?: string[];
  /** Translated "#026 · Harbor Line…" (dialog sub-line). */
  context?: string;
  /** R-204: the activity's codes and supplier ties (src/features/activity-codes/activity-codes-section.tsx), after General. */
  codes?: ReactNode;
}

const LINE_TONE: Record<DrawerLine['tone'], string | undefined> = { driving: s.relDriving, lo: s.lo, normal: undefined, none: s.relNone };

function Lines({ lines, remove }: { lines: DrawerLine[]; remove?: (line: DrawerLine) => ReactNode }) {
  return lines.map((p, i) => {
    const rm = remove && p.tone !== 'none' ? remove(p) : null;
    return (
      <div key={`${p.id}-${i}`} className={cx(s.rel, rm != null && s.relEdit)}>
        <span className={s.relId}>{p.id}</span>
        <span className={s.ellipsis}>{p.name}</span>
        <span className={cx(s.relType, LINE_TONE[p.tone])}>{p.rel}</span>
        {rm}
      </div>
    );
  });
}

export function ActivityDrawer({ view, closeHref, scheduleHref, t, code, canEdit = false, linkOptions = [], context = '', codes }: ActivityDrawerProps) {
  return (
    <Drawer
      open
      closeHref={closeHref}
      titlePlacement="inline"
      id={view.id}
      title={view.name}
      meta={<span className={view.status.className}>{view.status.label}</span>}
      actions={
        <ButtonLink variant="secondary" size="sm" icon={CalendarDots} href={scheduleHref}>
          {t('Show in Gantt')}
        </ButtonLink>
      }
    >
      <div className={s.drawerGrid}>
        <section className={s.section} aria-label={t('General')}>
          <span className={s.kicker}>{t('General')}</span>
          {view.general.map((g) => (
            <div key={g.k} className={s.kv}>
              <span className={s.kvKey}>{g.k}</span>
              {g.key === 'calendar' && canEdit ? (
                <ActivityCalendarSelect code={code} activity={view.id} value={view.calendar.value} options={view.calendar.options} label={g.k} />
              ) : (
                <span className={cx(s.kvVal, g.lo && s.lo)}>{g.v}</span>
              )}
            </div>
          ))}
        </section>

        {codes}

        <section className={s.section} aria-label={t('Relationships')}>
          <span className={s.kicker}>{t('Relationships')}</span>
          <span className={s.subLabel}>{t('Predecessors')}</span>
          <Lines lines={view.preds} remove={canEdit ? (l) => <RemoveLinkButton code={code} pred={l.id} succ={view.id} /> : undefined} />
          <span className={cx(s.subLabel, s.subLabelGap)}>{t('Successors')}</span>
          <Lines lines={view.succs} remove={canEdit ? (l) => <RemoveLinkButton code={code} pred={view.id} succ={l.id} /> : undefined} />
          {canEdit && <AddRelationshipButton code={code} activity={view.id} activities={linkOptions} context={context} />}
        </section>

        <section className={s.section} aria-label={t('Resources & cost')}>
          <span className={s.kicker}>{t('Resources & cost')}</span>
          {view.res.map((r, i) => (
            <div key={`${r.name}-${i}`} className={s.res}>
              <div className={s.resTop}>
                <span>{r.name}</span>
                <span className={s.resUnits}>{r.units}</span>
              </div>
              <span className={s.resSub}>{r.sub}</span>
            </div>
          ))}
          <div className={s.miniKpis}>
            <div className={s.miniKpi}>
              <span className={s.miniLabel}>{t('Budget')}</span>
              <span className={s.miniValue}>{view.budget}</span>
            </div>
            <div className={s.miniKpi}>
              <span className={s.miniLabel}>{t('Actual')}</span>
              <span className={s.miniValue}>{view.actual}</span>
            </div>
            <div className={s.miniKpi}>
              <span className={s.miniLabel}>{t('EAC')}</span>
              <span className={cx(s.miniValue, view.eacLo && s.lo)}>{view.eac}</span>
            </div>
          </div>
          <div className={s.costBar} role="img" aria-label={`${t('Actual')} ${view.actual} · ${t('Budget')} ${view.budget} · ${t('EAC')} ${view.eac}`}>
            <div className={s.costFill} style={{ '--w': view.bar.actualW } as CSSProperties} />
            <div className={s.costTick} style={{ '--l': view.bar.budgetW } as CSSProperties} />
            <div className={s.costEac} style={{ '--l': view.bar.eacW } as CSSProperties} />
          </div>
          <span className={s.costNote}>{view.costNote}</span>
        </section>

        {view.changes.length > 0 && (
          <section className={s.section} aria-label={t('Change requests')}>
            <span className={s.kicker}>{t('Change requests')}</span>
            {view.changes.map((c) => (
              <Link key={c.id} href={c.href} className={cx(s.todo, s.crRow)}>
                <ArrowsLeftRight className={s.crIcon} aria-hidden />
                <span className={s.todoText}>
                  <span className={s.todoTitle}>
                    {c.id} · {c.title}
                  </span>
                  <span className={s.todoMeta}>{c.duration}</span>
                </span>
                <Tag tone={c.status.tone}>{c.status.label}</Tag>
              </Link>
            ))}
          </section>
        )}

        <section className={s.section} aria-label={t('To-dos')}>
          <div className={s.todoHead}>
            <span className={s.kicker}>{t('To-dos')}</span>
            <span className={s.todoCount}>{view.todoCount}</span>
          </div>
          {view.todos.map((x) =>
            canEdit ? (
              <div key={x.id} className={cx(s.todo, s.todoRow, x.removable && s.todoRowRm)}>
                <TodoRing code={code} activity={view.id} number={x.id} done={x.done} />
                <Link href={x.href} className={cx(s.todoText, s.todoLink)}>
                  <span className={cx(s.todoTitle, x.done && s.todoTitleDone)}>{x.title}</span>
                  <span className={s.todoMeta}>{x.meta}</span>
                </Link>
                <Avatar initials={x.initials} size={22} />
                {x.removable && <RemoveTodoButton code={code} activity={view.id} number={x.id} />}
              </div>
            ) : (
              <Link key={x.id} href={x.href} className={s.todo}>
                <span className={cx(s.ring, x.done && s.ringDone)}>{x.done && <Check className={s.ringCheck} aria-hidden />}</span>
                <span className={s.todoText}>
                  <span className={cx(s.todoTitle, x.done && s.todoTitleDone)}>{x.title}</span>
                  <span className={s.todoMeta}>{x.meta}</span>
                </span>
                <Avatar initials={x.initials} size={22} />
              </Link>
            ),
          )}
          {view.pending.map((x) => (
            <div key={x.id} className={s.pending}>
              <Hourglass className={s.pendingIcon} aria-hidden />
              <span className={s.todoText}>
                <span className={s.todoTitle}>{x.title}</span>
                <span className={s.pendingMeta}>{x.meta}</span>
              </span>
            </div>
          ))}
          {view.noTodos && <span className={s.noTodos}>{t('No to-dos yet — break the activity down for the team')}</span>}
          {canEdit && <TodoComposer code={code} activity={view.id} />}
        </section>
      </div>
    </Drawer>
  );
}
