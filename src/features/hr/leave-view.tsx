// Leave & working calendar body (docs/spec/06 §4, template 1478–1501): KPIs and the 8-week availability grid of the
// absences received from Cursus (R-031: NEW-CURSUS-4 / NEW-CURSUS-7, Lucca unplugged) — two simple types, Leave and
// Absence, never the reason (R-173) — public holidays and available hours on a 35 h week. Read-only by design. Server
// Component.
import { LockSimple } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties } from 'react';
import { Avatar } from '@/components/app/Badges';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard } from '@/components/app/SectionCard';
import { LO, OK } from '@/components/app/tones';
import { cx } from '@/components/ds/cx';
import { leaveKpis, leaveRow, type LeaveCellTone } from '@/domain/hr';
import type { T } from '@/i18n/translate';
import { stampText } from '@/server/db/codes';
import type { LeaveCalendar } from '@/server/dal/hr';
import s from './hr.module.css';

// An absence keeps the prototype's sick-leave look (cellSick); leave keeps the leave look.
const CELL: Record<LeaveCellTone, string | undefined> = { absence: s.cellSick, leave: s.cellLeave, holiday: s.cellHoliday, none: undefined };

/** "11 Nov" (date part of "11 Nov · Armistice"). */
const datePart = (label: string) => label.split(' · ')[0];

export function LeaveView({ data, t }: { data: LeaveCalendar; t: T }) {
  const n = data.weeks.length;
  const rows = data.people.map((p) => ({ p, r: leaveRow(p.weeks.map((w) => ({ type: w.typeLabel, days: w.days, holidays: w.holidays }))) }));
  const k = leaveKpis(rows.map((x) => x.r), n);
  const holByWeek = data.weeks.map((_, i) => data.holidays.filter((h) => h.weekIndex === i).map((h) => datePart(h.label)));
  const holDates = data.holidays.map((h) => datePart(h.label));

  return (
    <>
      <KpiGrid min={150}>
        {/* R-031: the last absence Cursus pushed to Keystone (events endpoint, R-029), not a sync time. */}
        <KpiTile
          label={t('Cursus')}
          value={data.lastAbsenceReceivedAt ? t(stampText(new Date(data.lastAbsenceReceivedAt))) : '—'}
          sub={t(data.lastAbsenceReceivedAt ? 'Last absence received' : 'None received yet')}
          color={OK}
        />
        <KpiTile label={t('Team availability')} value={`${k.teamAvailabilityPct}%`} sub={t('Next 8 weeks · 35 h basis')} color={OK} />
        <KpiTile label={t('Leave days')} value={k.leaveDays} sub={t('Approved in Cursus')} color={OK} />
        <KpiTile label={t('Public holidays')} value={data.holidays.length} sub={t(holDates.length ? `${holDates.join(', ')} · France` : 'France')} color={OK} />
        <KpiTile label={t('Weeks under 60% team capacity')} value={k.weeksUnder60} sub={t('Capacity feeds the allocation heatmap')} color={OK} />
      </KpiGrid>
      <SectionCard
        gap={10}
        scroll
        title={t('Availability — next 8 weeks')}
        subtitle={t('Received from Cursus · 35 h week · 7 h per leave day · public holidays removed')}
        hint={
          <>
            <LockSimple aria-hidden />
            {t('Leave is requested and approved in Cursus')}
          </>
        }
      >
        <div className={s.leaveGrid} style={{ '--weeks': n } as CSSProperties}>
          <div className={s.colHead}>{t('Person')}</div>
          {data.weeks.map((w) => (
            <div key={w.start} className={s.weekHead}>
              {t(w.label)}
            </div>
          ))}
          <div className={cx(s.colHead, s.right)}>{t('Leave')}</div>
          <div className={cx(s.colHead, s.right)}>{t('Avail.')}</div>

          <div className={s.holLabel}>{t('Public holidays')}</div>
          {holByWeek.map((dates, i) => (
            <div key={data.weeks[i].start} className={cx(s.holCell, dates.length > 0 && s.holOn)}>
              {dates.map((d) => t(d)).join(', ')}
            </div>
          ))}
          <div />
          <div />

          {rows.map(({ p, r }) => (
            <div key={p.name} className={s.row}>
              <div className={cx(s.person, s.leavePerson)}>
                <Avatar initials={p.initials} size={28} fontSize={11} />
                <div className={s.personText}>
                  <span className={s.personName}>{p.name}</span>
                  <span className={s.leaveRole}>{p.jobTitle ? t(p.jobTitle) : ''}</span>
                </div>
              </div>
              {r.cells.map((c, i) => (
                <div key={data.weeks[i].start} className={cx(s.leaveCell, CELL[c.tone])}>
                  <span className={s.leaveLabel}>{c.label ? t(c.label) : ''}</span>
                  <span className={s.leaveHours}>{`${c.hours} h`}</span>
                </div>
              ))}
              <div className={s.rightNum}>{t(`${r.days} d`)}</div>
              <div className={s.rightNum} style={r.lo ? { color: LO } : undefined}>{`${r.availPct}%`}</div>
            </div>
          ))}
        </div>
        {/* NEW-CURSUS-4 / R-173: two simple types; the reason of an absence is never kept nor shown. */}
        <div className={s.legend}>
          <span>{t('Leave · paid leave or RTT')}</span>
          <span>{t('Absence · any other absence')}</span>
          <span>{t('Hol. · public holiday')}</span>
        </div>
      </SectionCard>
    </>
  );
}
