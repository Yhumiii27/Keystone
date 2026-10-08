// Meetings & minutes screen body (docs/spec/05 §5.3–5.4, template 753–813): "Display" segment (Meetings /
// Decisions / Actions), KPI row, then either the meeting list + detail card, the Decisions register or the Actions
// register. Server Component; ticks, the agenda/composer and the transcript buttons are client islands
// (minutes-client.tsx). The Decisions register's headers say what the columns hold — "Agenda point" and "Type" —
// where the prototype titled them "Project" and "Status" (00 §7.16, 05 OQ13).
import { ArrowBendDownRight, ArrowsLeftRight, CalendarCheck, ChatsCircle, Eye, FileText, Gavel } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import { EmptyState } from '@/components/app/EmptyState';
import { FilterChips, FilterGroup, FilterLabel } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { ButtonLink } from '@/components/ds/Button';
import { Segmented } from '@/components/ds/Segmented';
import { Table, Th } from '@/components/ds/Table';
import { cx } from '@/components/ds/cx';
import type { MeetingsView as ViewKey } from '@/domain/meetings';
import type { T } from '@/i18n/translate';
import { ActionRows, AnalyseButton, ApplyButton, CarriedRows, MinutesEditor, PrevActionRows } from './minutes-client';
import { LINE_COLOR, type DetailView, type MeetingsScreenView } from './model';
import s from './meetings.module.css';

const VIEW_ICON: Record<ViewKey, Icon> = { meetings: ChatsCircle, decisions: Gavel, actions: ArrowBendDownRight };

export interface MeetingsBodyProps {
  code: string;
  view: MeetingsScreenView;
  /** Edits allowed (not outside the workspace, project not read-only). */
  canEdit: boolean;
  /** The selected meeting came from `?meeting=` (else the page pins it after a write). */
  pinned: boolean;
  /** Organizer short name of the selected meeting (default owner of a new action). */
  organizer: string;
  t: T;
}

export function MeetingsBody({ code, view, canEdit, pinned, organizer, t }: MeetingsBodyProps) {
  return (
    <Stack>
      <FilterGroup>
        <FilterLabel icon={Eye}>{t('Display')}</FilterLabel>
        <Segmented wrap label={t('Display')} value={view.view} options={view.viewSeg.map((o) => ({ value: o.value, label: o.label, href: o.href, icon: VIEW_ICON[o.value] }))} />
      </FilterGroup>

      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      {view.view === 'meetings' && (
        <div className={s.split}>
          <div className={s.left}>
            <div className={s.chipsRow}>
              <FilterGroup>
                <FilterLabel>{t('Status')}</FilterLabel>
                <FilterChips label={t('Status')} value={view.filter} options={view.chips.map((c) => ({ value: c.value, label: c.label, count: String(c.count), href: c.href }))} />
              </FilterGroup>
            </div>
            <nav className={s.list} aria-label={t('Meetings register')}>
              {view.cards.map((m) => (
                <Link key={m.number} href={m.href} scroll={false} className={cx(s.card, m.selected && s.cardOn)} aria-current={m.selected ? 'true' : undefined}>
                  <span className={s.cardLine}>
                    <span className={s.cardTitle}>{m.title}</span>
                    <span className={cx(m.typeClass, s.flexNone, s.tag10)}>
                      {m.typeLabel}
                    </span>
                  </span>
                  <span className={s.cardLine}>
                    <span className={s.cardSub}>{m.sub}</span>
                    <span className={cx(m.statusClass, s.nowrap, s.tag10)}>
                      {m.statusLabel}
                    </span>
                  </span>
                </Link>
              ))}
              {!view.cards.length && <EmptyState variant="boxed">{t('No meeting in this view')}</EmptyState>}
            </nav>
          </div>
          {view.detail && <MeetingDetail code={code} d={view.detail} canEdit={canEdit} pinned={pinned} organizer={organizer} t={t} />}
        </div>
      )}

      {view.view === 'decisions' && (
        <SectionCard title={t('Decisions register')} scroll>
          <Table size={12.5}>
            <thead>
              <tr>
                <Th>{t('Decision')}</Th>
                <Th>{t('Meeting')}</Th>
                <Th>{t('Agenda point')}</Th>
                <Th>{t('Type')}</Th>
              </tr>
            </thead>
            <tbody>
              {view.decisions.map((d) => (
                <tr key={d.key}>
                  <td className={s.cellText}>
                    <span className={s.decisionCell}>
                      <Gavel className={s.gavel} aria-hidden />
                      {d.text}
                    </span>
                  </td>
                  <td className={s.meetingCell}>
                    <Link href={d.href} className={s.meetingLink} scroll={false}>
                      {d.meetingTitle}
                    </Link>
                    <span className={s.meetingRef}>{d.meetingRef}</span>
                  </td>
                  <td className={s.pointCell}>{d.pointTitle}</td>
                  <td>
                    <span className={cx(d.typeClass, s.tag105)}>
                      {d.typeLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </SectionCard>
      )}

      {view.view === 'actions' && (
        <SectionCard title={t('Actions from meetings')} subtitle={t('Tick to close · closed actions leave the carry-over list')} scroll>
          <Table size={12.5}>
            <thead>
              <tr>
                <Th />
                <Th>{t('Action')}</Th>
                <Th>{t('Owner')}</Th>
                <Th>{t('Due')}</Th>
                <Th>{t('Meeting')}</Th>
                <Th>{t('Status')}</Th>
              </tr>
            </thead>
            <tbody>
              <ActionRows code={code} rows={view.actions} canEdit={canEdit} />
            </tbody>
          </Table>
        </SectionCard>
      )}
    </Stack>
  );
}

/** Detail card of the selected meeting (mtgSel). */
function MeetingDetail({ code, d, canEdit, pinned, organizer, t }: { code: string; d: DetailView; canEdit: boolean; pinned: boolean; organizer: string; t: T }) {
  const prep = d.prep;
  const tr = prep?.transcript ?? null;
  return (
    <section className={cx('card', 'elev-sm', s.detail)} aria-label={d.title}>
      <div className={s.head}>
        <div className={s.headCol}>
          <div className={cx('card-title', s.headTitle)}>{d.title}</div>
          <span className={s.meta}>{d.meta}</span>
          <span className={s.synced}>
            <CalendarCheck aria-hidden />
            {d.synced}
          </span>
        </div>
        <span className={d.typeClass}>{d.typeLabel}</span>
        <span className={d.statusClass}>{d.statusLabel}</span>
      </div>

      <div className={s.block}>
        <span className={s.kicker}>{d.attendanceTitle}</span>
        <div className={s.tags}>
          {d.attendance.map((a) => (
            <span key={a.key} className={cx(a.cls, a.absent ? s.absent : s.attendee)}>
              {a.label}
            </span>
          ))}
        </div>
      </div>

      {d.carried && (
        <div className={cx(s.panel, s.panelTight)}>
          <span className={s.kickerMuted}>{d.carried.title}</span>
          <span className={s.panelHint}>{d.carried.hint}</span>
          <CarriedRows code={code} items={d.carried.items} canEdit={canEdit} />
        </div>
      )}

      {/* The grid renders whenever the prep pack exists, empty or not: the prototype's empty grid still takes a flex gap. */}
      {prep && (
        <div className={s.prepGrid}>
          {prep.prev && (
            <div className={s.panel}>
              <div className={s.panelHead}>
                <span className={cx(s.kicker, s.push)}>{t('Decisions from the previous meeting')}</span>
                <span className={s.ref}>{prep.prev.ref}</span>
              </div>
              {prep.prev.decisions.map((x, i) => (
                <div key={i} className={s.decision}>
                  <Gavel className={s.gavel} aria-hidden />
                  <span>{x}</span>
                </div>
              ))}
              <div className={s.actionsHead}>
                <span className={cx(s.kickerMuted, s.push)}>{t('Actions since the previous meeting')}</span>
                <span className={s.count}>{prep.prev.closedCount}</span>
              </div>
              <PrevActionRows code={code} items={prep.prev.actions} canEdit={canEdit} />
            </div>
          )}
          {prep.bridge && (
            <div className={s.panel}>
              <span className={s.kicker}>{prep.bridge.title}</span>
              {prep.bridge.items.map((q) => (
                <div key={q.key} className={s.bridgeItem}>
                  <div className={s.bridgeRow}>
                    <ArrowsLeftRight className={s.bridgeIcon} aria-hidden />
                    <span className={s.bridgeText}>{q.text}</span>
                    <span className={cx(q.cls, s.nowrap, s.tag10)}>
                      {q.label}
                    </span>
                  </div>
                  <span className={s.bridgeSub}>{q.sub}</span>
                  {q.answer && <span className={s.bridgeAnswer}>{q.answer}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tr && (
        <div className={s.transcript}>
          <div className={s.panelHead}>
            <span className={cx(s.kicker, s.push)}>{t('Transcript')}</span>
            {canEdit && !tr.analysed && <AnalyseButton code={code} meeting={d.number} selfHref={d.selfHref} pinned={pinned} />}
          </div>
          <p className={s.transcriptText} tabIndex={0}>
            {tr.text}
          </p>
          {tr.analysed && (
            <div className={s.analysis}>
              <span className={s.kickerMuted}>{t('Summary')}</span>
              <p className={s.summary}>{tr.summary}</p>
              {tr.draft.map((l) => {
                const I = l.type === 'decision' ? Gavel : ArrowBendDownRight;
                return (
                  <div key={l.key} className={cx(s.row3, s.draftLine)}>
                    <I className={s.draftIcon} style={{ color: l.type === 'decision' ? LINE_COLOR.decision : 'var(--color-neutral-300)' }} aria-hidden />
                    <span className={s.pretty}>{l.text}</span>
                    <span className={cx(s.small, s.nowrap)}>{l.meta}</span>
                  </div>
                );
              })}
              <div className={s.footer}>
                <span className={s.footerText}>{t('Review the proposed decisions and actions, then add them to the minutes to edit before sending.')}</span>
                {canEdit && !tr.applied && <ApplyButton code={code} meeting={d.number} selfHref={d.selfHref} pinned={pinned} />}
                {tr.applied && <span className="tag tag-neutral">{t('Added to the minutes')}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      <MinutesEditor
        key={d.number}
        code={code}
        meeting={d.number}
        organizer={organizer}
        agenda={d.agenda}
        editable={d.editable}
        canEdit={canEdit}
        selfHref={d.selfHref}
        pinned={pinned}
      />

      {d.sent && (
        <div className={s.block}>
          <div className={s.distHead}>
            <span className={cx(s.kicker, s.push)}>{t('Distribution & read receipts')}</span>
            {d.sent.text && <span className={s.sentText}>{d.sent.text}</span>}
            <ButtonLink variant="ghost" size="xs" icon={FileText} href={d.sent.openHref}>
              {t('Open minutes')}
            </ButtonLink>
          </div>
          <div className={s.tags}>
            {d.sent.dist.map((x) => (
              <span key={x.key} className={x.cls}>
                {x.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
