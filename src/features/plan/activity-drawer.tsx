// Activity drawer of the Plan screen (docs/spec/05 §2.4.5, template 1105–1163). Server-rendered content inside
// the DS Drawer (client): opened by `?act=A1250`, closed (×, scrim, Esc) to `closeHref`, which keeps the row
// highlighted (`?sel=`). Four sections: General · Relationships · Resources & cost · To-dos.
import { CalendarDots, Check, Hourglass } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Avatar } from '@/components/app/Badges';
import { ButtonLink } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Drawer } from '@/components/ds/Drawer';
import type { T } from '@/i18n/translate';
import type { DrawerLine, DrawerView } from './drawer-model';
import { AddRelationshipButton, TodoComposer } from './plan-soon';
import s from './plan.module.css';

export interface ActivityDrawerProps {
  view: DrawerView;
  /** Plan URL without `?act=` (keeps the view and the selection). */
  closeHref: string;
  /** Schedule screen of the project ("Show in Gantt"). */
  scheduleHref: string;
  t: T;
}

const LINE_TONE: Record<DrawerLine['tone'], string | undefined> = { driving: s.relDriving, lo: s.lo, normal: undefined, none: s.relNone };

function Lines({ lines }: { lines: DrawerLine[] }) {
  return lines.map((p, i) => (
    <div key={`${p.id}-${i}`} className={s.rel}>
      <span className={s.relId}>{p.id}</span>
      <span className={s.ellipsis}>{p.name}</span>
      <span className={cx(s.relType, LINE_TONE[p.tone])}>{p.rel}</span>
    </div>
  ));
}

export function ActivityDrawer({ view, closeHref, scheduleHref, t }: ActivityDrawerProps) {
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
              <span className={cx(s.kvVal, g.lo && s.lo)}>{g.v}</span>
            </div>
          ))}
        </section>

        <section className={s.section} aria-label={t('Relationships')}>
          <span className={s.kicker}>{t('Relationships')}</span>
          <span className={s.subLabel}>{t('Predecessors')}</span>
          <Lines lines={view.preds} />
          <span className={cx(s.subLabel, s.subLabelGap)}>{t('Successors')}</span>
          <Lines lines={view.succs} />
          <AddRelationshipButton />
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

        <section className={s.section} aria-label={t('To-dos')}>
          <div className={s.todoHead}>
            <span className={s.kicker}>{t('To-dos')}</span>
            <span className={s.todoCount}>{view.todoCount}</span>
          </div>
          {view.todos.map((x) => (
            <Link key={x.id} href={x.href} className={s.todo}>
              <span className={cx(s.ring, x.done && s.ringDone)}>{x.done && <Check className={s.ringCheck} aria-hidden />}</span>
              <span className={s.todoText}>
                <span className={cx(s.todoTitle, x.done && s.todoTitleDone)}>{x.title}</span>
                <span className={s.todoMeta}>{x.meta}</span>
              </span>
              <Avatar initials={x.initials} size={22} />
            </Link>
          ))}
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
          <TodoComposer />
        </section>
      </div>
    </Drawer>
  );
}
