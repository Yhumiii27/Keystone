// Approvals — {department} (docs/spec/08 §6.3–§6.6; template 2731–2812, logic 4130–4145): department-head chip,
// department chips (path `/resources/approvals/[dept]`, pending badges), KPI tiles, the "Awaiting your decision" queue
// (client island), the "Decided" list and the department's team load for the next two weeks. Server Component.
import { UsersThree } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { screenHref } from '@/config/screens';
import { FilterChips, FilterGroup, FilterLabel } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { cx } from '@/components/ds/cx';
import type { T } from '@/i18n/translate';
import { ApprovalQueue } from './approval-queue';
import { approvalsHref } from './routes';
import type { ApprovalsModel } from './model';
import s from './requests.module.css';

export interface ApprovalsScreenProps {
  model: ApprovalsModel;
  department: string;
  /** Department chips in DEPTS order with their pending count. */
  departments: { name: string; pending: number }[];
  canDecide: boolean;
  /** R-049: whose My work the viewer may open from the team list (names); default: everyone's. */
  workable?: readonly string[];
  /** Translator of the feature (reqT). */
  t: T;
}

const workHref = (person: string) => `${screenHref('mywork')}?person=${encodeURIComponent(person)}`;

export function ApprovalsScreen({ model, department, departments, canDecide, workable, t }: ApprovalsScreenProps) {
  return (
    <div className={s.screen}>
      <div className={s.headRow}>
        {model.head && (
          <div className={s.headChip}>
            <span className={s.headAvatar} aria-hidden>
              {model.head.initials}
            </span>
            <div className={s.headText}>
              <span className={s.headName}>{model.head.name}</span>
              <span className={s.headRole}>{model.head.role}</span>
            </div>
          </div>
        )}
        <div className={s.deptChips}>
          <FilterGroup>
            <FilterLabel icon={UsersThree}>{t('Department')}</FilterLabel>
            <FilterChips
              label={t('Department')}
              value={department}
              options={departments.map((d) => ({
                value: d.name,
                href: approvalsHref(d.name),
                label: (
                  <>
                    {t(d.name)}
                    {d.pending > 0 && <span className={s.badge}>{d.pending}</span>}
                  </>
                ),
              }))}
            />
          </FilterGroup>
        </div>
      </div>
      <KpiGrid>
        {model.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>
      <div className={s.columns}>
        <div className={s.column}>
          <ApprovalQueue
            key={department}
            items={model.queue}
            canDecide={canDecide}
            labels={{ title: t('Awaiting your decision'), hint: t('Approve sends the task to the person · reschedule counter-proposes dates'), empty: model.queueEmpty }}
          />
          <div className={cx('card', 'elev-sm', s.decidedCard)}>
            <div className={cx('card-title', s.decidedTitle)}>{t('Decided')}</div>
            {model.decided.map((r) => (
              <div key={r.id} className={s.decidedRow}>
                <span className={s.decidedId}>{r.id}</span>
                <div className={s.stackMin}>
                  <span className={s.ellipsis} title={r.title}>
                    {r.title}
                  </span>
                  <span className={s.sub115}>{`${r.person} · ${r.dates} · ${r.hours}`}</span>
                </div>
                <span className={s.decidedResponse}>{r.response}</span>
                <span className={cx(r.tagClass, s.nowrap)}>{r.statusLabel}</span>
              </div>
            ))}
            {!model.decided.length && <span className={s.noDecisions}>{t('No decisions yet')}</span>}
          </div>
        </div>
        <div className={cx('card', 'elev-sm', s.teamCard)}>
          <div className={s.teamHead}>
            <div className="card-title">{t('Team load')}</div>
            <span className={s.cardHint}>{t('Next two weeks · pending hours are not yet committed')}</span>
          </div>
          <div className={s.teamGrid}>
            <span className={s.th}>{t('Person')}</span>
            <span className={cx(s.th, s.center)}>{model.weekHeads[0]}</span>
            <span className={cx(s.th, s.center)}>{model.weekHeads[1]}</span>
            <span className={cx(s.th, s.right)}>{t('Pending')}</span>
            {model.team.map((p) => (
              <div key={p.name} className={s.contents}>
                {!workable || workable.includes(p.name) ? (
                  <Link href={workHref(p.name)} className={s.member} title={t('Open their work')}>
                    <span className={s.avatar26} aria-hidden>
                      {p.initials}
                    </span>
                    <div className={s.memberText}>
                      <span className={s.ellipsis}>{p.name}</span>
                      <span className={s.sub11}>{p.role}</span>
                    </div>
                  </Link>
                ) : (
                  <span className={s.member}>
                    <span className={s.avatar26} aria-hidden>
                      {p.initials}
                    </span>
                    <div className={s.memberText}>
                      <span className={s.ellipsis}>{p.name}</span>
                      <span className={s.sub11}>{p.role}</span>
                    </div>
                  </span>
                )}
                <div className={s.heat} style={{ '--heat-bg': p.w1.bg, '--heat-fg': p.w1.fg } as CSSProperties}>
                  {p.w1.v}
                </div>
                <div className={s.heat} style={{ '--heat-bg': p.w2.bg, '--heat-fg': p.w2.fg } as CSSProperties}>
                  {p.w2.v}
                </div>
                <span className={s.pend} style={{ '--pend-color': p.pendColor } as CSSProperties}>
                  {p.pend}
                </span>
              </div>
            ))}
          </div>
          {!model.team.length && <span className={s.teamEmpty}>{t('No named team members in this department yet')}</span>}
          <div className={s.teamFoot}>{t('Click a person to open exactly what they see.')}</div>
        </div>
      </div>
    </div>
  );
}
