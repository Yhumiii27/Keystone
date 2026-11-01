// R-206 (K-206) — "Schedule quality" and "Delay analysis" cards of the Schedule screen. Server Component; reads only (data from
// src/server/dal/schedule-quality.ts). Each check opens (native <details>, keyboard and screen-reader friendly) on the list of
// the offending activities or relationships, each activity linking to the Plan with its drawer open (`?act=`). The delay analysis
// picks its two schedules through the URL (`?from=BL1&to=current|BL2`), keeping the page's other parameters.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CaretRight } from '@phosphor-icons/react/dist/ssr';
import { Callout } from '@/components/app/Callout';
import { EmptyState } from '@/components/app/EmptyState';
import { CardTitle } from '@/components/ds/Card';
import { SectionCard } from '@/components/app/SectionCard';
import { StatusTag } from '@/components/app/StatusTag';
import { LO } from '@/components/app/tones';
import { Segmented } from '@/components/ds/Segmented';
import { Table, Td, Th } from '@/components/ds/Table';
import { cx } from '@/components/ds/cx';
import { screenHref } from '@/config/screens';
import { longDateText } from '@/domain/schedule-rollup';
import { DCMA_CHECK_TEXT, type DcmaCheck, type DcmaOffender } from '@/domain/schedule-quality';
import { dataText } from '@/i18n/data-text';
import type { Lang, T } from '@/i18n/translate';
import { CURRENT_SCHEDULE, type ScheduleQualityData } from '@/server/dal/schedule-quality';
import { getI18n } from '@/server/session';
import q from './schedule-quality.module.css';
import s from './schedule.module.css';

/** Most offenders listed under one check (the count says how many there are). */
const OFFENDERS_SHOWN = 100;

export interface ScheduleQualityCardsProps {
  code: string;
  data: ScheduleQualityData;
  /** URL of the Schedule page with the forensic pair (the page keeps its other parameters). */
  pairHref: (from: string, to: string) => string;
}

const numberFmt = (lang: Lang, digits = 1) => new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: digits });
/** Signed working days: "+5", "−3", "0". */
const signed = (n: number | null) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`);

export async function ScheduleQualityCards({ code, data, pairHref }: ScheduleQualityCardsProps) {
  const { t, lang } = await getI18n();
  const { report } = data;
  const wd = t('working days');
  const planHref = (id: string) => `${screenHref('plan', { code })}?act=${encodeURIComponent(id)}`;
  const actLink = (id: string) => (
    <Link href={planHref(id)} className={q.act}>
      <span className={q.actId}>{id}</span>
      {data.names[id] && <span className={q.actName}>{dataText(data.names[id].name, lang)}</span>}
    </Link>
  );
  const dateText = (iso: string | null) => (iso ? t(longDateText(iso)) : '—');

  return (
    <>
      <SectionCard gap={10}>
        <div className={s.head}>
          <div className={s.titleCol}>
            <CardTitle>{t('Schedule quality')}</CardTitle>
            <span className={s.sub}>
              {`${t('DCMA 14-point assessment')} · ${t('Baseline')} ${data.reference ? data.reference.code : t('none')} · ${t('As of')} ${dateText(data.dataDate)}`}
            </span>
          </div>
          <span className={q.summary}>
            <StatusTag tone="neutral">{`${t('Pass')} · ${report.passed}`}</StatusTag>
            <StatusTag tone={report.failed ? 'accent' : 'neutral'}>{`${t('Fail')} · ${report.failed}`}</StatusTag>
            {report.notApplicable > 0 && <StatusTag tone="outline">{`${t('Not applicable')} · ${report.notApplicable}`}</StatusTag>}
          </span>
        </div>
        {data.cycle && <Callout variant="emphasis" role="note">{`${t('The logic contains a loop')}: ${data.cycle.join(' → ')}`}</Callout>}
        {!!data.outdated && (
          <Callout variant="outlined" role="note">{`${t('Not rescheduled since the last changes: the checks read the published schedule')} · ${data.outdated} ${t(data.outdated > 1 ? 'activities would change with Reschedule' : 'activity would change with Reschedule')}`}</Callout>
        )}
        <div className={q.checks} role="list" aria-label={t('DCMA checks')}>
          {report.checks.map((c) => (
            <CheckRow key={c.id} check={c} t={t} lang={lang} wd={wd} actLink={actLink} />
          ))}
        </div>
      </SectionCard>

      <ForensicCard data={data} t={t} lang={lang} wd={wd} actLink={actLink} dateText={dateText} pairHref={pairHref} />
    </>
  );
}

function valueText(c: DcmaCheck, t: T, lang: Lang, wd: string): string {
  if (c.status === 'na' && c.value == null) return '—';
  const f = numberFmt(lang);
  switch (c.unit) {
    case 'pct':
      return `${f.format(c.value!)} % (${c.count}/${c.total})`;
    case 'count':
      return String(c.value);
    case 'index':
      return numberFmt(lang, 2).format(c.value!);
    case 'test':
      return c.value == null ? '—' : `${signed(c.value)} ${wd}`;
  }
}

function thresholdText(c: DcmaCheck, t: T, lang: Lang, wd: string): string {
  const f = numberFmt(lang, 2);
  if (c.unit === 'test') return t('The finish moves by the delay');
  const base = c.unit === 'pct' ? `${c.op} ${f.format(c.limit)} %` : `${c.op} ${f.format(c.limit)}`;
  return c.limitDays != null ? `${base} · > ${c.limitDays} ${wd}` : base;
}

function CheckRow({ check: c, t, lang, wd, actLink }: { check: DcmaCheck; t: T; lang: Lang; wd: string; actLink: (id: string) => ReactNode }) {
  const text = DCMA_CHECK_TEXT[c.id];
  const tag =
    c.status === 'pass' ? <StatusTag tone="neutral">{t('Pass')}</StatusTag> : c.status === 'fail' ? <StatusTag tone="accent">{t('Fail')}</StatusTag> : <StatusTag tone="outline">{t('Not applicable')}</StatusTag>;
  const row = (
    <>
      <span className={q.num}>{c.number}</span>
      <span className={q.name}>
        <span className={q.title}>{t(text.name)}</span>
        <span className={q.rule}>{c.naReason ? t(c.naReason) : t(text.rule)}</span>
      </span>
      <span className={q.value} style={c.status === 'fail' ? { color: LO } : undefined}>
        {valueText(c, t, lang, wd)}
      </span>
      <span className={q.limit}>{thresholdText(c, t, lang, wd)}</span>
      <span className={q.tag}>{tag}</span>
    </>
  );
  if (!c.offenders.length)
    return (
      <div className={cx(q.row, q.plain)} role="listitem">
        <span className={q.caretSpace} aria-hidden />
        {row}
      </div>
    );
  const shown = c.offenders.slice(0, OFFENDERS_SHOWN);
  return (
    <details className={q.details} role="listitem">
      <summary className={q.row}>
        <CaretRight className={q.caret} aria-hidden />
        {row}
      </summary>
      <ul className={q.offenders} aria-label={`${t(text.name)} · ${t('Activities concerned')}`}>
        {shown.map((o, i) => (
          <li key={i}>
            <OffenderLine o={o} check={c} t={t} wd={wd} actLink={actLink} />
          </li>
        ))}
        {c.offenders.length > shown.length && <li className={q.more}>{`+ ${c.offenders.length - shown.length} ${t('more')}`}</li>}
      </ul>
    </details>
  );
}

function OffenderLine({ o, check, t, wd, actLink }: { o: DcmaOffender; check: DcmaCheck; t: T; wd: string; actLink: (id: string) => ReactNode }) {
  if (o.kind === 'link')
    return (
      <span className={q.offender}>
        {actLink(o.pred)}
        <span aria-hidden>→</span>
        {actLink(o.succ)}
        <span className={q.detail}>{`${o.type} ${o.lag ? `${signed(o.lag)} ${wd}` : ''}`.trim()}</span>
      </span>
    );
  let detail: string | null = o.note ? t(o.note) : null;
  if (o.value != null) {
    if (check.id === 'highFloat' || check.id === 'negativeFloat') detail = `${t('Total float')} ${signed(o.value)} ${wd}`;
    else if (check.id === 'highDuration') detail = `${t('Duration')} ${o.value} ${wd}`;
    else if (check.id === 'criticalPathTest') detail = `${t('Delayed activity')} · ${t('finish moved')} ${signed(o.value)} ${wd}`;
  }
  return (
    <span className={q.offender}>
      {actLink(o.id)}
      {detail && <span className={q.detail}>{detail}</span>}
    </span>
  );
}

function ForensicCard({
  data, t, lang, wd, actLink, dateText, pairHref,
}: {
  data: ScheduleQualityData;
  t: T;
  lang: Lang;
  wd: string;
  actLink: (id: string) => ReactNode;
  dateText: (iso: string | null) => string;
  pairHref: (from: string, to: string) => string;
}) {
  const f = data.forensic;
  const cmp = f.comparison;
  const toLabel = f.to === CURRENT_SCHEDULE ? t('Current schedule') : f.to;
  const rows = cmp ? [...cmp.rows].filter((r) => r.presence === 'both').sort((a, b) => (b.finishVar ?? 0) - (a.finishVar ?? 0)) : [];
  const att = f.attribution;
  return (
    <SectionCard gap={10}>
      <div className={s.head}>
        <div className={s.titleCol}>
          <CardTitle>{t('Delay analysis')}</CardTitle>
          <span className={s.sub}>{t('Baseline against the current schedule, per activity and along the critical path')}</span>
        </div>
      </div>
      {!f.from || !cmp ? (
        <EmptyState variant="boxed">{t('No baseline with activities to compare with')}</EmptyState>
      ) : (
        <>
          <div className={q.pickers}>
            <Segmented
              label={t('Reference')}
              value={f.from}
              wrap
              options={f.baselines.map((b) => ({ value: b.code, label: b.code, title: dataText(b.name, lang), href: pairHref(b.code, f.to === b.code ? CURRENT_SCHEDULE : f.to) }))}
            />
            <span className={q.vs}>{t('compared with')}</span>
            <Segmented
              label={t('Compared with')}
              value={f.to}
              wrap
              options={[
                { value: CURRENT_SCHEDULE, label: t('Current schedule'), href: pairHref(f.from, CURRENT_SCHEDULE) },
                ...f.baselines.filter((b) => b.code !== f.from).map((b) => ({ value: b.code, label: b.code, title: dataText(b.name, lang), href: pairHref(f.from!, b.code) })),
              ]}
            />
          </div>
          <dl className={q.facts}>
            <div>
              <dt>{`${t('Finish')} · ${f.from}`}</dt>
              <dd>{dateText(cmp.refFinish)}</dd>
            </div>
            <div>
              <dt>{`${t('Finish')} · ${toLabel}`}</dt>
              <dd>{dateText(cmp.cmpFinish)}</dd>
            </div>
            <div>
              <dt>{t('Finish slip')}</dt>
              <dd style={(cmp.finishSlip ?? 0) > 0 ? { color: LO } : undefined}>{`${signed(cmp.finishSlip)} ${wd}`}</dd>
            </div>
            <div>
              <dt>{t('Activities later / earlier')}</dt>
              <dd>{`${cmp.later} / ${cmp.earlier}`}</dd>
            </div>
          </dl>

          <div className={q.section}>
            <span className={q.sectionTitle}>{t('Critical path slip')}</span>
            <span className={q.rule}>
              {f.to === CURRENT_SCHEDULE
                ? t('Driving path to the project finish: what each activity added to the slip (late start, longer duration)')
                : t('Driving path of the current logic, applied to the two baselines (the baselines keep no logic)')}
            </span>
            {att && att.steps.length ? (
              <Table size={12.5}>
                <thead>
                  <tr>
                    <Th>{t('Activity')}</Th>
                    <Th align="right">{t('Start variance')}</Th>
                    <Th align="right">{t('Finish variance')}</Th>
                    <Th align="right">{t('Late start')}</Th>
                    <Th align="right">{t('Longer duration')}</Th>
                    <Th align="right">{t('Added to the slip')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {att.steps.map((st) => (
                    <tr key={st.id}>
                      <Td>{actLink(st.id)}</Td>
                      <Td numeric align="right">{signed(st.startVar)}</Td>
                      <Td numeric align="right">{signed(st.finishVar)}</Td>
                      <Td numeric align="right">{signed(st.lateStart)}</Td>
                      <Td numeric align="right">{signed(st.longerDuration)}</Td>
                      <Td numeric align="right" color={(st.contribution ?? 0) > 0 ? LO : undefined}>
                        {st.contribution == null ? t('not in the reference') : signed(st.contribution)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState>{data.cycle ? t('The logic contains a loop') : t('No driving path: every activity is complete')}</EmptyState>
            )}
            {att && att.drivers.length > 0 && (
              <span className={q.rule}>{`${t('Main causes')}: ${att.drivers.slice(0, 3).map((d) => `${d.id} (${signed(d.contribution)} ${wd})`).join(', ')}`}</span>
            )}
          </div>

          <details className={q.all}>
            <summary className={q.allSummary}>
              <CaretRight className={q.caret} aria-hidden />
              {`${t('Every activity')} (${rows.length}) · ${t('in working days, positive = later')}`}
            </summary>
            <Table size={12.5}>
              <thead>
                <tr>
                  <Th>{t('Activity')}</Th>
                  <Th align="right">{`${t('Start date')} · ${f.from}`}</Th>
                  <Th align="right">{`${t('Start date')} · ${toLabel}`}</Th>
                  <Th align="right">{t('Start variance')}</Th>
                  <Th align="right">{`${t('Finish date')} · ${f.from}`}</Th>
                  <Th align="right">{`${t('Finish date')} · ${toLabel}`}</Th>
                  <Th align="right">{t('Finish variance')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td>{actLink(r.id)}</Td>
                    <Td numeric align="right" nowrap>{dateText(r.refStart)}</Td>
                    <Td numeric align="right" nowrap>{dateText(r.cmpStart)}</Td>
                    <Td numeric align="right">{signed(r.startVar)}</Td>
                    <Td numeric align="right" nowrap>{dateText(r.refFinish)}</Td>
                    <Td numeric align="right" nowrap>{dateText(r.cmpFinish)}</Td>
                    <Td numeric align="right" color={(r.finishVar ?? 0) > 0 ? LO : undefined}>{signed(r.finishVar)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {cmp.rows.some((r) => r.presence !== 'both') && (
              <span className={q.rule}>
                {`${t('Added since the reference')}: ${cmp.rows.filter((r) => r.presence === 'added').map((r) => r.id).join(', ') || '—'} · ${t('Removed since the reference')}: ${cmp.rows.filter((r) => r.presence === 'removed').map((r) => r.id).join(', ') || '—'}`}
              </span>
            )}
          </details>
        </>
      )}
    </SectionCard>
  );
}
