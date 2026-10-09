// Activity, integrations & audit body (docs/spec/10 §2.3–2.4, template 2237–2267): KPI tiles, the "Display" control
// (`?view=`), then the activity feed with its source chips (`?source=`), the connectors table (Codex, Vigie and Cursus
// with their connector-layer mode and state), the import / export cards, or the audit trail with its ISO 9001 CSV
// export. Server Component; client islands for "Sync now" / "Configure" and the drop zones.
import {
  ArrowsClockwise, Buildings, Camera, ChatCircle, DownloadSimple, Eye, FileArrowDown, FileArrowUp, FilePdf, FileXls, GitBranch, GitPullRequest,
  PaperPlaneTilt, PlugsConnected, Receipt, ShieldWarning, Truck, Warehouse,
} from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import { FilterBar, FilterChips, FilterGroup, FilterLabel } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { cx } from '@/components/ds/cx';
import { Segmented } from '@/components/ds/Segmented';
import type { ActivityIcon } from '@/domain/admin';
import type { T } from '@/i18n/translate';
import type { ImportKind } from '@/server/db/codes';
import { auditExportHref } from './links';
import type { ImportIcon, PlumbingView } from './model';
import { ConnectorActions, DropZone } from './plumbing-islands';
import s from './admin.module.css';

const ACT_ICONS: Record<ActivityIcon, Icon> = {
  'arrows-clockwise': ArrowsClockwise, warehouse: Warehouse, 'chat-circle': ChatCircle, 'git-pull-request': GitPullRequest, camera: Camera,
  'shield-warning': ShieldWarning, 'paper-plane-tilt': PaperPlaneTilt, truck: Truck, receipt: Receipt, 'git-branch': GitBranch, buildings: Buildings,
};
const IMPORT_ICONS: Record<ImportIcon, Icon> = { 'file-arrow-down': FileArrowDown, 'file-xls': FileXls, 'file-arrow-up': FileArrowUp, 'file-pdf': FilePdf };

/** `importKinds`: the import kinds the viewer may run (chapter 4 rights; default: all when `canEdit`). */
export function PlumbingBody({ view, canEdit, importKinds, t }: { view: PlumbingView; canEdit: boolean; importKinds?: readonly ImportKind[]; t: T }) {
  return (
    <div className={s.root}>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>
      <FilterBar>
        <FilterLabel icon={Eye}>{t('Display')}</FilterLabel>
        <Segmented wrap options={view.seg.map((o) => ({ value: o.value, label: o.label, href: o.href }))} value={view.view} label={t('Display')} />
      </FilterBar>
      {view.view === 'activity' && <ActivityFeed view={view} t={t} />}
      {view.view === 'connectors' && <Connectors view={view} canEdit={canEdit} t={t} />}
      {view.view === 'imports' && (
        <div className={s.importGrid}>
          {view.imports.map((f) => {
            const I = IMPORT_ICONS[f.icon];
            return (
              <div key={f.name} className={cx('card', 'elev-sm', s.importCard)}>
                <div className={s.importHead}>
                  <I className={s.importIcon} aria-hidden />
                  <span className={s.importName}>{f.name}</span>
                </div>
                <span className={cx(s.muted12, s.pretty)}>{f.description}</span>
                <DropZone format={f.name} direction={f.direction} canEdit={canEdit} kinds={importKinds} />
              </div>
            );
          })}
        </div>
      )}
      {view.view === 'audit' && <AuditTrail view={view} canEdit={canEdit} t={t} />}
    </div>
  );
}

function ActivityFeed({ view, t }: { view: PlumbingView; t: T }) {
  return (
    <>
      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel icon={PlugsConnected}>{t('Source')}</FilterLabel>
          <FilterChips options={view.chips.map((c) => ({ value: c.value, label: c.label, count: c.count, href: c.href }))} value={view.chipValue} label={t('Source')} />
        </FilterGroup>
      </FilterBar>
      <section className={cx('card', 'elev-sm', s.feedCard)}>
        <div className={cx(s.cardHead, s.feedHead)}>
          <div className={cx('card-title', s.cardTitle)}>{t('Activity feed')}</div>
          <span className={s.muted12}>{t('Every change across projects, people and connectors · newest first')}</span>
        </div>
        {view.activity.map((a) => {
          const I = ACT_ICONS[a.icon];
          return (
            <div key={a.key} className={s.actRow}>
              <span className={s.actIcon}>
                <I aria-hidden />
              </span>
              <span className={s.actText}>
                <span className={s.actLine}>
                  <span className={s.actWho}>{a.who}</span> · {a.what}
                </span>
              </span>
              <span className={s.actWhen}>{a.when}</span>
            </div>
          );
        })}
        {!view.activity.length && <div className={s.actEmpty}>{t('No activity yet')}</div>}
      </section>
    </>
  );
}

function Connectors({ view, canEdit, t }: { view: PlumbingView; canEdit: boolean; t: T }) {
  return (
    <section className={cx('card', 'elev-sm', s.tableCard)}>
      <div className={s.cardHead}>
        <div className={cx('card-title', s.cardTitle)}>{t('Connectors')}</div>
        <span className={s.muted12}>{t('Source systems stay the reference — Keystone reads, links and pushes back approved changes')}</span>
      </div>
      <table className={cx('table', s.table13)}>
        <thead>
          <tr>
            <th>{t('System')}</th>
            <th>{t('Data')}</th>
            <th>{t('Frequency')}</th>
            <th>{t('Status')}</th>
            <th>{t('Last sync')}</th>
            <th>{t('Last volume')}</th>
            <th>
              <span className={s.srOnly}>{t('Actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {view.connectors.map((c) => (
            <tr key={c.name}>
              <td className={s.connName}>
                {c.name}
                {c.mode && <span className={s.connMode}>{c.mode}</span>}
              </td>
              <td className={s.connData}>{c.data}</td>
              <td className={s.cell12}>{c.frequency}</td>
              <td>
                <span className={`tag tag-${c.tone}`}>{c.status}</span>
              </td>
              <td className={s.cell12Soft}>{c.last}</td>
              <td className={s.cell12Muted}>{c.volume}</td>
              <td>{canEdit && <ConnectorActions name={c.rawName} label={c.name} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AuditTrail({ view, canEdit, t }: { view: PlumbingView; canEdit: boolean; t: T }) {
  return (
    <section className={cx('card', 'elev-sm', s.tableCard)}>
      <div className={s.cardHead}>
        <div className={cx('card-title', s.cardTitle)}>{t('Audit trail')}</div>
        <span className={s.muted12}>{t('Who changed what, when — immutable, exportable for ISO 9001 audits')}</span>
        {canEdit && (
          <a href={auditExportHref()} download className={cx('btn btn-secondary', s.exportBtn)} title={t('Export the audit trail (CSV, ISO 9001)')}>
            <DownloadSimple aria-hidden />
            {t('Export CSV')}
          </a>
        )}
      </div>
      <table className={cx('table', s.table125)}>
        <thead>
          <tr>
            <th>{t('When')}</th>
            <th>{t('Who')}</th>
            <th>{t('Object')}</th>
            <th>{t('Change')}</th>
            <th>{t('Area')}</th>
          </tr>
        </thead>
        <tbody>
          {view.audit.map((a) => (
            <tr key={a.key}>
              <td className={s.when}>{a.when}</td>
              <td className={s.nowrap}>{a.who}</td>
              <td className={s.obj}>{a.object}</td>
              <td className={s.pretty}>{a.change}</td>
              <td className={s.areaCell}>{a.area}</td>
            </tr>
          ))}
          {!view.audit.length && (
            <tr>
              <td colSpan={5} className={s.tableEmpty}>
                {t('No audit entry yet')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
