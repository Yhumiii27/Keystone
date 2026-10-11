// Resources (portfolio pool) and Project resources body (docs/spec/06 §1.3–§1.4, template 573–637): project banner,
// 5 KPI tiles, allocation heatmap (next 8 weeks), capacity vs demand bars and the suggested rebalancing card.
// Server Component; "Apply" is a client island that drafts a resource request (chapter 4, R-3 / S-7). Strings arrive
// translated in `view` (model.ts).
import { Sparkle, UsersThree } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Avatar } from '@/components/app/Badges';
import { EmptyState } from '@/components/app/EmptyState';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { CapacityBar } from '@/components/app/Progress';
import { SHADE_SCALE } from '@/components/app/tones';
import { CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import type { T } from '@/i18n/translate';
import { ApplySuggestionButton } from './apply-button';
import type { ResourcesView as View } from './model';
import s from './resources.module.css';

export interface ResourcesViewProps {
  view: View;
  t: T;
  /** Project resources: translated project label for the banner ("#026 · Harbor Line Terminal Expansion"). */
  projectName?: string;
  /** Edit controls ("Apply") allowed: not outside the workspace, project not read-only. */
  canEdit: boolean;
}

export function ResourcesView({ view, t, projectName, canEdit }: ResourcesViewProps) {
  return (
    <div className={s.body}>
      {projectName != null && (
        <div className={s.banner}>
          <UsersThree className={s.bannerIcon} aria-hidden />
          <span>
            {t('Only people assigned to')} <span className={s.bannerName}>{projectName}</span> {t('— the whole pool is under Resource management.')}
          </span>
        </div>
      )}
      <KpiGrid min={160}>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>
      <div className={s.row}>
        <section className={cx('card', 'elev-sm', s.card, s.allocation)}>
          <div className={s.allocHead}>
            <div className={s.titleCol}>
              <CardTitle>{t('Allocation — next 8 weeks')}</CardTitle>
              <span className={s.cardSub}>{t('% of available hours per person')}</span>
            </div>
            <div className={s.legend}>
              {t('Under')}
              {SHADE_SCALE.map((c) => (
                <span key={c} className={s.swatch} style={{ background: c }} aria-hidden />
              ))}
              {t('Over')}
            </div>
          </div>
          {view.people.length ? (
            <div className={s.grid} role="table" aria-label={t('Allocation — next 8 weeks')} style={{ '--weeks': view.weeks.length } as CSSProperties}>
              <div className={s.contents} role="row">
                <div className={s.colHead} role="columnheader">
                  {t('Person')}
                </div>
                {view.weeks.map((w, i) => (
                  <div key={i} className={s.weekHead} role="columnheader">
                    {w}
                  </div>
                ))}
                <div className={cx(s.colHead, s.right)} role="columnheader">
                  {t('Avg')}
                </div>
              </div>
              {view.people.map((p) => (
                <div key={p.name} className={s.contents} role="row">
                  <div className={s.personCell} role="rowheader">
                    {p.href ? (
                      <Link href={p.href} className={s.person} title={t('Open their work')}>
                        <Avatar initials={p.initials} size={28} />
                        <span className={s.who}>
                          <span className={s.name}>{p.name}</span>
                          <span className={s.role}>{p.role}</span>
                        </span>
                      </Link>
                    ) : (
                      <span className={s.person}>
                        <Avatar initials={p.initials} size={28} />
                        <span className={s.who}>
                          <span className={s.name}>{p.name}</span>
                          <span className={s.role}>{p.role}</span>
                        </span>
                      </span>
                    )}
                  </div>
                  {p.cells.map((c, i) => (
                    <div key={i} className={s.cell} role="cell" style={{ '--cell-bg': c.bg, '--cell-fg': c.fg } as CSSProperties}>
                      {c.v}
                    </div>
                  ))}
                  <div className={s.avg} role="cell" style={{ '--avg-color': p.avgColor } as CSSProperties}>
                    {p.avgText}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState variant="boxed">{t('No one is assigned to this project yet')}</EmptyState>
          )}
        </section>
        <div className={s.side}>
          <section className={cx('card', 'elev-sm', s.card)} aria-label={t('Capacity vs demand')}>
            <div className={s.titleStack}>
              <CardTitle>{t('Capacity vs demand')}</CardTitle>
              <span className={s.cardSub}>{t('Hours by role, next 8 weeks')}</span>
            </div>
            {view.roles.map((r) => (
              <div key={r.name} className={s.roleRow}>
                <div className={s.roleHead}>
                  <span className={s.roleName}>{r.name}</span>
                  <span className={s.roleText} style={{ '--role-color': r.color } as CSSProperties}>
                    {r.text}
                  </span>
                </div>
                <CapacityBar demand={r.demandH} capacity={r.capacityH} />
              </div>
            ))}
            {view.roles.length ? (
              <div className={s.footnote}>{t('Tick marks available capacity')}</div>
            ) : (
              // Project without a team: no bar, so no tick legend (the prototype fell back to Harbor Line's team).
              <EmptyState pad={4}>{t('No department to compare yet')}</EmptyState>
            )}
          </section>
          {view.suggestions && (
            <section className={cx('card', 'elev-sm', s.card, s.suggestionsCard)} aria-label={t('Suggested rebalancing')}>
              <div className={s.sugHead}>
                <Sparkle className={s.sugIcon} aria-hidden />
                <CardTitle>{t('Suggested rebalancing')}</CardTitle>
              </div>
              {view.suggestions.map((g) => (
                <div key={`${g.projectCode}:${g.leverCode}`} className={s.sug}>
                  <span className={s.sugTitle} title={g.hint}>
                    {g.title}
                  </span>
                  <div className={s.sugFoot}>
                    <span className={s.sugImpact}>{g.impact}</span>
                    {g.requested ? (
                      <span className="tag tag-outline">{g.requested}</span>
                    ) : (
                      canEdit && g.canApply && <ApplySuggestionButton title={g.title} projectCode={g.projectCode} lever={g.leverCode} />
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
