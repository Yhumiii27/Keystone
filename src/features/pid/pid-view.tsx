// P&ID — tags, overlay & process validation — screen body (docs/spec/09 §6.4–6.9, template 2472–2517): KPI tiles, the
// P&ID drawing card (DocumentPreview stand-in for the prototype's image slot; the document number opens the Codex
// record) beside the process validation steps, the filter bar (status chips, scope segment, search), the tag register
// and the overlay table. Rows open the tag drawer (`?tag=`). Server Component; the search, the inert buttons and the
// row links are client islands.
import { Funnel, Stack as StackIcon, Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { ClickableRow } from '@/components/app/ClickableRow';
import { DocumentPreview } from '@/components/app/DocumentPreview';
import { EmptyState } from '@/components/app/EmptyState';
import { FilterBar, FilterChips, FilterGroup, FilterLabel } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SearchField } from '@/components/app/SearchField';
import { CardGrid, SectionCard, Stack } from '@/components/app/SectionCard';
import { CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import { Segmented } from '@/components/ds/Segmented';
import { Table, Th } from '@/components/ds/Table';
import { ExportFileButton } from '@/features/exports/export-file-button';
import type { T } from '@/i18n/translate';
import type { PidScreenView } from './model';
import { ComingSoonButton } from './pid-buttons';
import s from './pid.module.css';

export function PidBody({ view, t }: { view: PidScreenView; t: T }) {
  const d = view.drawing;
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <CardGrid min={380}>
        <SectionCard gap={10}>
          <div className={s.cardHead}>
            <div className={s.titleCol}>
              <CardTitle>
                {d.title} ·{' '}
                {d.docHref ? (
                  <Link href={d.docHref} className={s.docLink} title={d.docTitle ?? undefined}>
                    {d.documentNumber}
                  </Link>
                ) : (
                  d.documentNumber
                )}{' '}
                {d.rev}
              </CardTitle>
              <span className={s.sub}>{t('Drop the P&ID export · tags are extracted from the drawing and matched against the project BOM')}</span>
            </div>
            <ComingSoonButton icon="open" label={t('Open in PDM')} toast={t('Open in PDM — coming soon')} />
          </div>
          <DocumentPreview ratio="16/8" fit="contain" placeholder={d.placeholder} />
          <div className={s.legend}>
            <span className={s.legendItem}>
              <span className={cx('tag tag-neutral', s.tag10)}>Keystone</span>
              {t('our supply')}
            </span>
            <span className={s.legendItem}>
              <span className={cx('tag tag-accent', s.tag10)}>{t('Overlay')}</span>
              {t('our sensors on client equipment (surcouche)')}
            </span>
            <span className={s.legendItem}>
              <span className={cx('tag tag-outline', s.tag10)}>{t('Client')}</span>
              {t('client-supplied equipment — no BOM reference expected')}
            </span>
          </div>
        </SectionCard>

        <SectionCard gap={6}>
          <div className={s.titleStack}>
            <CardTitle>{t('Process validation')}</CardTitle>
            <span className={s.sub}>{t('Release for construction needs 100 % of our tags linked and the overlay agreed with the client')}</span>
          </div>
          {view.steps.map((st, i) => (
            <div key={i} className={s.step}>
              <span className={s.stepDot} style={{ '--step-dot': st.dot } as CSSProperties} aria-hidden />
              <span className={s.stepText}>
                <span className={s.stepLabel} style={{ '--step-color': st.color } as CSSProperties}>
                  {st.label}
                </span>
                <span className={s.stepWho}>{st.whoDate}</span>
              </span>
              <span className={cx(st.tagClass, s.nowrap)}>{st.state}</span>
            </div>
          ))}
        </SectionCard>
      </CardGrid>

      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel icon={Funnel}>{t('Status')}</FilterLabel>
          <FilterChips label={t('Status')} value={view.filter} options={view.chips} />
        </FilterGroup>
        <FilterGroup>
          <FilterLabel icon={StackIcon}>{t('Scope')}</FilterLabel>
          <Segmented label={t('Scope')} value={view.scope} options={view.scopes} wrap />
        </FilterGroup>
        <SearchField param="q" placeholder={t('Tag, description or reference')} minWidth={240} push />
      </FilterBar>

      <SectionCard title={t('Tag register — P&ID ↔ BOM')} hint={t('Click a tag to map it to a reference')} scroll>
        <Table>
          <thead>
            <tr>
              <Th>{t('Tag')}</Th>
              <Th>{t('Description')}</Th>
              <Th>{t('Kind')}</Th>
              <Th>{t('Scope')}</Th>
              <Th>{t('PLC')}</Th>
              <Th>{t('State feedback')}</Th>
              <Th>{t('BOM reference')}</Th>
              <Th>{t('Activity')}</Th>
              <Th>{t('Status')}</Th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <ClickableRow key={r.tag} href={r.href}>
                <td className={cx(s.tagCell, r.selected && s.tagOn)} aria-current={r.selected ? 'true' : undefined}>
                  {r.tag}
                </td>
                <td className={s.pretty}>{r.desc}</td>
                <td className={s.kind}>{r.kind}</td>
                <td>
                  <span className={r.scopeClass}>{r.scope}</span>
                </td>
                <td>{r.plc.asTag ? <span className={cx(r.plc.tagClass, s.nowrap)}>{r.plc.text}</span> : <span className={s.plain}>{r.plc.text}</span>}</td>
                <td className={s.fbCell}>
                  <span className={cx(s.fb, r.feedback.tone === 'warn' && s.fbWarn, r.feedback.tone === 'muted' && s.fbMuted)}>
                    {r.feedback.tone === 'warn' && <Warning className={s.fbIcon} aria-hidden />}
                    <span>{r.feedback.text}</span>
                  </span>
                </td>
                <td>
                  <div className={s.refCol}>
                    <span className={s.ref}>{r.refText}</span>
                    <span className={s.partName} title={r.partName || undefined}>
                      {r.partName}
                    </span>
                  </div>
                </td>
                <td className={s.actCell}>
                  <span className={s.ellipsis} title={r.actText}>
                    {r.actText}
                  </span>
                </td>
                <td>
                  <span className={cx(r.statusClass, s.nowrap)}>{r.status}</span>
                </td>
              </ClickableRow>
            ))}
          </tbody>
        </Table>
        {view.empty && <EmptyState>{view.empty}</EmptyState>}
      </SectionCard>

      <SectionCard scroll>
        <div className={s.cardHead}>
          <div className={s.titleCol}>
            <CardTitle>{t('Overlay (surcouche) — client equipment secured by Keystone')}</CardTitle>
            <span className={s.sub}>{t('The client supplies the equipment, Keystone supplies and wires the instruments · this list is agreed and signed with the client')}</span>
          </div>
          <ExportFileButton href={view.overlayExportHref} label={t('Export overlay list')} variant="secondary" className={s.btn125} />
        </div>
        <Table size={12.5}>
          <thead>
            <tr>
              <Th>{t('Tag')}</Th>
              <Th>{t('Description')}</Th>
              <Th>{t('Supplied by')}</Th>
              <Th>{t('BOM reference')}</Th>
              <Th>{t('Status')}</Th>
            </tr>
          </thead>
          <tbody>
            {view.overlay.map((r) => (
              <ClickableRow key={r.tag} href={r.href}>
                <td className={s.oTag}>{r.tag}</td>
                <td>{r.desc}</td>
                <td>
                  <span className={r.scopeClass}>{r.scope}</span>
                </td>
                <td className={s.oRef}>{r.refText}</td>
                <td>
                  <span className={cx(r.statusClass, s.nowrap)}>{r.status}</span>
                </td>
              </ClickableRow>
            ))}
          </tbody>
        </Table>
      </SectionCard>
    </Stack>
  );
}

