// My approvals body (docs/spec/08 §7.3–7.4; template 1715–1736): KPI row → kind chips (?filter=) → the
// "Waiting for my decision" card. Server Component; rows and inline decisions are small client islands.
import { ArrowRight, ArrowSquareOut, Funnel } from '@phosphor-icons/react/dist/ssr';
import { EmptyState, FilterBar, FilterChips, FilterGroup, FilterLabel, FilterNote, KpiGrid, KpiTile, LO, OK, SectionCard, Stack } from '@/components/app';
import { Tag } from '@/components/ds/Tag';
import { screenHref } from '@/config/screens';
import { APPROVAL_KIND_LABEL, kpiTexts, type InboxView } from '@/domain/approvals';
import type { Lang, T } from '@/i18n/translate';
import { ApprovalRow } from './approval-row';
import { DecisionButtons } from './decision-buttons';
import { inboxT } from './i18n';
import s from './myapprovals.module.css';

const filterHref = (kind: string | null) => screenHref('myapprovals') + (kind ? `?filter=${kind}` : '');

export interface MyApprovalsBodyProps {
  view: InboxView;
  t: T;
  lang: Lang;
  /** Inline decisions allowed (false when the screen is outside the viewer's workspace). */
  canDecide: boolean;
}

export function MyApprovalsBody({ view, t: tr, lang, canDecide }: MyApprovalsBodyProps) {
  const t = inboxT(tr, lang);
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => {
          const x = kpiTexts(k, t);
          return <KpiTile key={k.label} label={x.label} value={x.value} sub={x.sub} color={x.lo ? LO : OK} />;
        })}
      </KpiGrid>
      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel icon={Funnel}>{t('Kind')}</FilterLabel>
          <FilterChips
            label={t('Kind')}
            value={view.filter ?? 'all'}
            options={view.chips.map((c) => ({ value: c.value ?? 'all', label: t(c.label), count: c.count, href: filterHref(c.value) }))}
          />
        </FilterGroup>
        <FilterNote>{t('Resource requests, purchase orders, ECOs, deliveries, change requests and deliverables — decided here or on their own page')}</FilterNote>
      </FilterBar>
      <SectionCard title={t('Waiting for my decision')} gap={4} titleGap={4}>
        {/* Index in the key: a project can carry two pending forced stage changes (same id, like the prototype's rows). */}
        {view.rows.map((a, i) => (
          <ApprovalRow key={`${a.kind}:${a.id}:${i}`} href={a.href}>
            <div className={s.kindCol}>
              <Tag tone="outline" nowrap={false} className={s.kindTag}>
                {t(APPROVAL_KIND_LABEL[a.kind])}
              </Tag>
              <span className={s.id}>{a.id}</span>
            </div>
            <div className={s.textCol}>
              <span className={s.title}>{t(a.title)}</span>
              <span className={s.sub}>{t(a.sub)}</span>
              <span className={s.meta}>
                {t(a.who)} · {t(a.when)}
              </span>
              {a.external && (
                // The application that owns the item (ECOs: Vigie), opened outside Keystone.
                <a href={a.external.href} target="_blank" rel="noopener noreferrer" className={s.external} aria-label={`${t(a.external.label)} ${a.id}`}>
                  {t(a.external.label)}
                  <ArrowSquareOut aria-hidden />
                </a>
              )}
            </div>
            {a.decision && canDecide ? <DecisionButtons id={a.id} decision={a.decision} /> : <div className={s.actions} />}
            {a.href && <ArrowRight className={s.arrow} aria-hidden />}
          </ApprovalRow>
        ))}
        {view.total === 0 && <EmptyState pad={10}>{t('Nothing waiting for you — switch role (bottom-left) to see another queue')}</EmptyState>}
      </SectionCard>
    </Stack>
  );
}
