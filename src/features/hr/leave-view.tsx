// Leave & working calendar body (docs/spec/06 §4, template 1478–1501): KPIs and the 8-week availability grid (R-085: from the
// current week, navigable) of the
// absences received from Cursus (R-031: NEW-CURSUS-4 / NEW-CURSUS-7, Lucca unplugged) — two simple types, Leave and
// Absence, never the reason (R-173) — public holidays and available hours on a 35 h week. Week view (owner answers 17 Oct
// 2026, `LeaveWeekView`): one week day by day, Monday to Friday. Read-only by design. Server Component.
import { LockSimple } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties, ReactNode } from 'react';
import { Avatar } from '@/components/app/Badges';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard } from '@/components/app/SectionCard';
import { LO, OK } from '@/components/app/tones';
import { cx } from '@/components/ds/cx';
import { leaveKpis, leaveRow, type LeaveCellTone } from '@/domain/hr';
import { dataText } from '@/i18n/data-text';
import type { Lang, T } from '@/i18n/translate';
import { dowOfIso, stampText } from '@/server/db/codes';
import type { LeaveCalendar, LeaveWeek } from '@/server/dal/hr';
import { WEEK_HOURS } from '@/domain/hr';
import type { LeaveDayKind } from '@/domain/load-week';
import s from './hr.module.css';

// An absence keeps the prototype's former sick-leave look; leave keeps the leave look.
const CELL: Record<LeaveCellTone, string | undefined> = { absence: s.cellAbsence, leave: s.cellLeave, holiday: s.cellHoliday, none: undefined };

/** "11 Nov" (date part of "11 Nov · Armistice"). */
const datePart = (label: string) => label.split(' · ')[0];

export interface LeaveViewProps {
  data: LeaveCalendar;
  t: T;
  /** R-085: the load-window navigation (`LoadWindowNav`) in the grid's header. */
  windowNav?: ReactNode;
  /** R-085: the grid shows the current window ("next 8 weeks"); false = another window ("8 weeks"). Default true. */
  windowIsCurrent?: boolean;
}

export function LeaveView({ data, t, windowNav, windowIsCurrent = true }: LeaveViewProps) {
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
        <KpiTile label={t('Team availability')} value={`${k.teamAvailabilityPct}%`} sub={t(windowIsCurrent ? 'Next 8 weeks · 35 h basis' : '8 weeks · 35 h basis')} color={OK} />
        <KpiTile label={t('Leave days')} value={k.leaveDays} sub={t('Approved in Cursus')} color={OK} />
        <KpiTile label={t('Public holidays')} value={data.holidays.length} sub={t(holDates.length ? `${holDates.join(', ')} · France` : 'France')} color={OK} />
        <KpiTile label={t('Weeks under 60% team capacity')} value={k.weeksUnder60} sub={t('Capacity feeds the allocation heatmap')} color={OK} />
      </KpiGrid>
      <SectionCard
        gap={10}
        scroll
        title={t(windowIsCurrent ? 'Availability — next 8 weeks' : 'Availability — 8 weeks')}
        subtitle={t('Received from Cursus · 35 h week · 7 h per leave day · public holidays removed')}
        actions={windowNav}
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

const DAY_CELL: Record<LeaveDayKind, string | undefined> = { absence: s.cellAbsence, leave: s.cellLeave, holiday: s.cellHoliday, worked: undefined };
const DAY_LABEL: Record<LeaveDayKind, string> = { absence: 'Absence', leave: 'Leave', holiday: 'Hol.', worked: '' };
const DOW = { en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], fr: ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.'] } as const;

/** "Mon 21" / "lun. 21". */
const dayHead = (iso: string, lang: Lang) => `${DOW[lang === 'fr' ? 'fr' : 'en'][(dowOfIso(iso) + 6) % 7]} ${Number(iso.slice(8, 10))}`;

export interface LeaveWeekViewProps {
  data: LeaveWeek;
  t: T;
  lang: Lang;
  /** The load-window navigation (`LoadWindowNav`, week view) in the grid's header. */
  windowNav?: ReactNode;
}

/**
 * Week view (owner answers 17 Oct 2026: "une vision à la semaine"): the absences day by day — the leave rows carry their own
 * dates — and the public holidays of that week by day. KPIs on that week (35 h basis).
 */
export function LeaveWeekView({ data, t, lang, windowNav }: LeaveWeekViewProps) {
  const n = data.people.length;
  const availPct = n ? Math.round(data.people.reduce((a, p) => a + p.availH / WEEK_HOURS, 0) / n * 100) : 0;
  const leaveDays = data.people.reduce((a, p) => a + p.daysOff, 0);
  const hols = data.days.filter((d) => d.holiday);
  return (
    <>
      <KpiGrid min={150}>
        <KpiTile
          label={t('Cursus')}
          value={data.lastAbsenceReceivedAt ? t(stampText(new Date(data.lastAbsenceReceivedAt))) : '—'}
          sub={t(data.lastAbsenceReceivedAt ? 'Last absence received' : 'None received yet')}
          color={OK}
        />
        <KpiTile label={t('Team availability')} value={`${availPct}%`} sub={t('Week shown · 35 h basis')} color={OK} />
        <KpiTile label={t('Leave days')} value={leaveDays} sub={t('Approved in Cursus')} color={OK} />
        <KpiTile
          label={t('Public holidays')}
          value={hols.length}
          sub={hols.length ? `${hols.map((d) => dataText(d.holiday!.name, lang)).join(', ')} · ${t('France')}` : t('France')}
          color={OK}
        />
      </KpiGrid>
      <SectionCard
        gap={10}
        scroll
        title={t('Availability — week')}
        subtitle={t('Received from Cursus · day by day · 7 h per working day · public holidays removed')}
        actions={windowNav}
        hint={
          <>
            <LockSimple aria-hidden />
            {t('Leave is requested and approved in Cursus')}
          </>
        }
      >
        <div className={s.leaveGrid} style={{ '--weeks': data.days.length } as CSSProperties}>
          <div className={s.colHead}>{t('Person')}</div>
          {data.days.map((d) => (
            <div key={d.date} className={s.weekHead}>
              {dayHead(d.date, lang)}
            </div>
          ))}
          <div className={cx(s.colHead, s.right)}>{t('Leave')}</div>
          <div className={cx(s.colHead, s.right)}>{t('Avail.')}</div>

          <div className={s.holLabel}>{t('Public holidays')}</div>
          {data.days.map((d) => (
            <div key={d.date} className={cx(s.holCell, d.holiday && s.holOn)} title={d.holiday ? dataText(d.holiday.name, lang) : undefined}>
              {d.holiday ? dataText(d.holiday.name, lang) : ''}
            </div>
          ))}
          <div />
          <div />

          {data.people.map((p) => (
            <div key={p.name} className={s.row}>
              <div className={cx(s.person, s.leavePerson)}>
                <Avatar initials={p.initials} size={28} fontSize={11} />
                <div className={s.personText}>
                  <span className={s.personName}>{p.name}</span>
                  <span className={s.leaveRole}>{p.jobTitle ? t(p.jobTitle) : ''}</span>
                </div>
              </div>
              {p.days.map((k, i) => (
                <div key={data.days[i].date} className={cx(s.leaveCell, DAY_CELL[k])}>
                  <span className={s.leaveLabel}>{DAY_LABEL[k] ? t(DAY_LABEL[k]) : ''}</span>
                  <span className={s.leaveHours}>{k === 'worked' ? '7 h' : '0 h'}</span>
                </div>
              ))}
              <div className={s.rightNum}>{t(`${p.daysOff} d`)}</div>
              <div className={s.rightNum} style={p.availH / WEEK_HOURS < 0.7 ? { color: LO } : undefined}>{`${p.availH} h`}</div>
            </div>
          ))}
        </div>
        <div className={s.legend}>
          <span>{t('Leave · paid leave or RTT')}</span>
          <span>{t('Absence · any other absence')}</span>
          <span>{t('Hol. · public holiday')}</span>
        </div>
      </SectionCard>
    </>
  );
}
