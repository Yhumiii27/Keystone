// Documents — Codex index screen body (docs/spec/10 §4.3–§4.4, template 2310–2345): Codex banner, KPI tiles, scope
// segment · saved views · search, family | status chips, then the selection bar and the Vault card (client island).
// Server Component; every filter is a link (URL state, see ./links.ts), the search is debounced into `?q=`.
import { ArrowsClockwise, BookmarkSimple, Folders, Funnel, Tag as TagIcon } from '@phosphor-icons/react/dist/ssr';
import { FilterBar, FilterChips, FilterGroup, FilterLabel } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SearchField } from '@/components/app/SearchField';
import { Stack } from '@/components/app/SectionCard';
import { Segmented } from '@/components/ds/Segmented';
import type { T } from '@/i18n/translate';
import { codexPublicUrl } from '@/server/integrations/codex/config';
import { CodexBanner } from './codex-banner';
import { OpenCodexButton, SyncNowButton } from './codex-buttons';
import type { VaultView } from './model';
import { VaultTable } from './vault-table';
import s from './docs.module.css';

export interface DocsVaultProps {
  project: string;
  view: VaultView;
  /** "Sync now" records a sync of the Codex index (NEW-D3-1, R-047: the portfolio director). */
  canEdit: boolean;
  /** Toast of "Open Codex" ("Opening Codex · project HLT-026", translated). */
  openToast: string;
  t: T;
}

export function DocsVault({ project, view, canEdit, openToast, t }: DocsVaultProps) {
  return (
    <Stack>
      <CodexBanner
        title={t('Project documents live in Codex')}
        text={t('Keystone shows a synced index of the document records — numbers, revisions, statuses and links. Files, approval circuits and retention rules are handled in Codex.')}
      >
        {view.sync && (
          <span className={s.sync}>
            <ArrowsClockwise aria-hidden />
            {view.sync}
          </span>
        )}
        {canEdit && <SyncNowButton project={project} label={t('Sync now')} />}
        <OpenCodexButton label={t('Open Codex')} toast={openToast} />
      </CodexBanner>

      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <div className={s.filters1}>
        <FilterGroup>
          <FilterLabel icon={Folders}>{t('Scope')}</FilterLabel>
          <Segmented wrap label={t('Scope')} options={view.scope.options} value={view.scope.value} />
        </FilterGroup>
        <span className={s.viewsLabel}>
          <FilterLabel icon={BookmarkSimple}>{t('Saved views')}</FilterLabel>
        </span>
        <FilterChips label={t('Saved views')} options={view.views.chips} value={view.views.value} />
        <SearchField param="q" placeholder={t('Search number, title, tag, author…')} minWidth={260} push />
      </div>

      <FilterBar gap={14}>
        <FilterGroup>
          <FilterLabel icon={TagIcon}>{t('Family')}</FilterLabel>
          <FilterChips label={t('Family')} options={view.families.chips} value={view.families.value} />
        </FilterGroup>
        <span className={s.divider} aria-hidden />
        <FilterGroup>
          <FilterLabel icon={Funnel}>{t('Status')}</FilterLabel>
          <FilterChips label={t('Status')} options={view.statuses.chips} value={view.statuses.value} />
        </FilterGroup>
      </FilterBar>

      <VaultTable project={project} title={view.title} rows={view.rows} empty={view.empty} codexUrl={codexPublicUrl()} />
    </Stack>
  );
}
