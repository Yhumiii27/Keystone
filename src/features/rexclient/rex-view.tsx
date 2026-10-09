// Lessons learned & project closure body (docs/spec/07 §2.7, template 921–931): KPI tiles, the lessons register, the
// closure checklist (click to cycle) and the customer-satisfaction survey. Server Component; the row actions are
// client islands shown only when the viewer may edit the screen on this project (07 OQ14: hidden when outside the
// workspace or read-only). Projects without REX data get empty-state lines (07 OQ24).
import { CheckSquare, MinusSquare, Square } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties } from 'react';
import { EmptyState } from '@/components/app/EmptyState';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard } from '@/components/app/SectionCard';
import { CardTitle } from '@/components/ds/Card';
import { Table, Td, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import { ClosureToggle, LessonStepButton } from './buttons';
import type { ClosureView, RexScreenView } from './model';
import s from './rexclient.module.css';

const MARK = { done: CheckSquare, progress: MinusSquare, idle: Square };

function ClosureRowContent({ c }: { c: ClosureView }) {
  const Icon = MARK[c.mark];
  return (
    <>
      <Icon className={s.clIcon} aria-hidden />
      <span className={s.clItem}>{c.item}</span>
      <span className={s.clOwner}>{c.owner}</span>
      <span className={s.clStatus}>{c.status}</span>
    </>
  );
}

export function RexView({ code, view, canEdit, t }: { code: string; view: RexScreenView; canEdit: boolean; t: T }) {
  return (
    <div className={s.root}>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <SectionCard title={t('Lessons learned')} scroll>
        <Table size={12.5}>
          <thead>
            <tr>
              <Th />
              <Th>{t('Theme')}</Th>
              <Th>{t('What happened')}</Th>
              <Th>{t('Impact')}</Th>
              <Th>{t('Recommendation')}</Th>
              <Th>{t('Applies to')}</Th>
              <Th>{t('Status')}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {view.lessons.map((l) => (
              <tr key={l.id}>
                <Td className={s.llId}>{l.id}</Td>
                <Td>
                  <span className={`tag tag-neutral ${s.theme}`}>{l.theme}</span>
                </Td>
                <Td className={s.what}>{l.what}</Td>
                <Td className={s.impact}>{l.impact}</Td>
                <Td className={s.reco}>{l.reco}</Td>
                <Td className={s.apply}>{l.apply}</Td>
                <Td>
                  <span className={`${l.tagClass} ${s.nowrap}`}>{l.status}</span>
                </Td>
                <Td className={s.actionCell}>{canEdit && l.next && <LessonStepButton code={code} number={l.id} from={l.from} label={l.next.label} />}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {!view.lessons.length && <EmptyState>{t('No lesson recorded for this project yet')}</EmptyState>}
      </SectionCard>

      <div className={s.grid380}>
        <SectionCard title={t('Closure checklist')} subtitle={t('Click to cycle · not started → in progress → done')} scroll>
          {view.closure.map((c) => {
            const style = { '--cl-color': c.color, '--cl-text': c.textColor } as CSSProperties;
            return canEdit ? (
              <ClosureToggle key={c.position} code={code} position={c.position} from={c.from} label={`${c.item} · ${c.status}`} style={style}>
                <ClosureRowContent c={c} />
              </ClosureToggle>
            ) : (
              <div key={c.position} className={s.clRow} style={style}>
                <ClosureRowContent c={c} />
              </div>
            );
          })}
          {!view.closure.length && <EmptyState>{t('No closure checklist for this project yet')}</EmptyState>}
        </SectionCard>

        <SectionCard scroll>
          <div className={s.satHead}>
            <div className={s.titleCol}>
              <CardTitle>{t('Customer satisfaction')}</CardTitle>
              <span className={s.sub}>{t('Survey · 5 criteria')}</span>
            </div>
            <span className={s.satAvg}>
              {view.satAvg}
              <span className={s.satOf}> / 5</span>
            </span>
          </div>
          {view.satisfaction.map((r) => (
            <div key={r.criterion} className={s.satRow}>
              <span>{r.criterion}</span>
              <div className={s.satTrack} role="img" aria-label={`${r.criterion} ${r.score} / 5`}>
                <div className={s.satFill} style={{ width: r.width }} />
              </div>
              <span className={s.satScore}>{r.score}</span>
            </div>
          ))}
          {!view.satisfaction.length && <EmptyState>{t('Survey not received yet')}</EmptyState>}
        </SectionCard>
      </div>
    </div>
  );
}
