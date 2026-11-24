// PageHeader — the header every screen renders first (docs/spec/01 §5, §7; docs/spec/02 C-02, C-03), rendered with
// Norma 2.0's common header (norma/charte/COQUE.md § 3). Server Component with client islands. Renders, as siblings inside
// <main> (gap 18), in the charte's fixed order:
//   <header> breadcrumb (+ project switcher) · <h1> title (+ health, Read-only) · global search · actions (Export as a
//            secondary action, the primary rightmost; the "Actions" menu beyond three) · status date · bell ·
//            FR | EN stacked over dark | light (PrefsStack, always the last element)
//   outside banner (screen outside the viewer's workspace)
//   zone bar (zone-scoped screens)
// Usage: return <><PageHeader screen="plan" projectCode={code} primary={<…/>} />{…screen body…}</>
import { Eye, GlobeHemisphereEast, House, UserCircle } from '@phosphor-icons/react/dist/ssr';
import { PageHeader as CoqueHeader } from '@norma/charte/ds/PageHeader';
import { StatusDate } from '@norma/charte/ds/HeaderTools';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SCREEN_BY_ID, screenHref, type ScreenId } from '@/config/screens';
import { HEALTH_LABEL, HEALTH_TAG } from '@/domain/health';
import { exportFormatsOf } from '@/features/exports/catalog';
import { businessToday } from '@/server/clock';
import { displayOfIso } from '@/server/db/codes';
import { dataText, fieldsText, projectLabelText } from '@/i18n/data-text';
import { getProject, type ProjectRow } from '@/server/dal/projects';
import { crumbExtraOf, defaultTitleOf, zoneBarOf } from '@/server/dal/shell';
import { canEditContract, canEditShipments, roleReadOnly } from '@/domain/rights';
import { getProjectScope } from '@/server/project-context';
import { getI18n, getLastProject, getTheme, getViewer, getZone } from '@/server/session';
import { shellBell } from './bell';
import { ExportButton, GlobalSearch, ProjectSwitcher, ZoneSeg } from './header-islands';
import { KeystonePrefs } from './prefs';
import { PROJECT_EDITABLE, crumbBase, isOutside } from './nav-model';
import { projectOptionHaystack, projectOptionSub } from './project-options';
import type { ProjectOptionView } from './types';
import styles from './header.module.css';

export interface PageHeaderProps {
  screen: ScreenId;
  /** Project code of a project-scoped screen (defaults to the last project used). */
  projectCode?: string;
  /** Title override, already translated (e.g. task title, "Approvals — Engineering"). Default: registry title through t(). */
  title?: string;
  /** Breadcrumb extra override, EN source (translated inside). '' removes the default extra (CRUMB_EXTRA). */
  crumbExtra?: string;
  /** Primary action element. Hidden automatically when the screen is outside the workspace or the project is read-only. */
  primary?: ReactNode;
  /** Task screen (`/my/tasks/[taskId]`): the task shown — default crumb extra (its id) and title (its title). */
  taskId?: string;
  /**
   * Global screen showing one project chosen by `?project=` (What-if levelling): that project, with the project switcher
   * setting the query parameter instead of the path.
   */
  projectParam?: string;
}

/** Screens whose default crumb extra is typed text (contract reference, payment terms). */
const DATA_CRUMB_SCREENS: ReadonlySet<ScreenId> = new Set<ScreenId>(['contract', 'billing']);

const healthView = (p: Pick<ProjectRow, 'health'>) =>
  p.health ? { label: HEALTH_LABEL[p.health], cls: HEALTH_TAG[p.health] } : { label: '—', cls: 'tag tag-neutral' };

export async function PageHeader({ screen, projectCode, title, crumbExtra, primary, taskId, projectParam }: PageHeaderProps) {
  const [{ t, lang }, viewer, zone, lastProject, scope, today, theme] = await Promise.all([getI18n(), getViewer(), getZone(), getLastProject(), getProjectScope(), businessToday(), getTheme()]);
  const def = SCREEN_BY_ID[screen];
  const isProject = def.scope === 'project';
  const code = projectCode ?? lastProject;
  const project = isProject ? await getProject(code) : projectParam ? await getProject(projectParam) : null;

  const outside = isOutside(viewer.role, screen);
  const access = project ? scope.access(project) : null;
  // Same rule as getProjectContext().canEdit (src/server/project-context.ts): the Contract follows `canEditContract` (P-4 —
  // Finance edits it on every project), Finance reads Budget, Hours and Billing (R-044); elsewhere the team rule (R-041).
  // R-158: the Shipments follow `canEditShipments` (Logistics and the director on every project, the project's leads); Logistics
  // reads the BOM, Site, Schedule and Deliveries (`roleReadOnly`).
  const editable = !outside && (
    screen === 'contract' && access
      ? canEditContract(viewer.role, access)
      : screen === 'shipments' && access
        ? canEditShipments(viewer.role, access)
        : !roleReadOnly(viewer.role, screen) && !(!!access?.readOnly && PROJECT_EDITABLE.includes(screen))
  );
  // "Read-only" tag: the project's team rule, except where the screen's own rule decides (Contract, Shipments, read-only screens).
  const ownRule = !outside && (screen === 'contract' || screen === 'shipments' || roleReadOnly(viewer.role, screen));
  const readOnly = !!project && (ownRule ? !editable : scope.readOnly(project));
  const showPrimary = !!primary && editable;

  const extra = crumbExtra !== undefined ? crumbExtra : await crumbExtraOf(screen, { role: viewer, code, zone, taskId });
  // R-148: the contract's reference and payment terms are typed text (shown as typed); the other extras are Keystone's.
  // COQUE.md § 3: the tool's name is not in the breadcrumb (it is in the sidebar's brand) — Home and My projects keep only
  // their extra (the viewer's title), else no breadcrumb text.
  const base = crumbBase(screen);
  const crumbText = extra && crumbExtra === undefined && DATA_CRUMB_SCREENS.has(screen)
    ? `${t(base)} · ${fieldsText(extra, t, lang)}`
    : base === 'Keystone'
      ? (extra ? t(extra) : '')
      : t(base + (extra ? ' · ' + extra : ''));

  const [defTitle, bell] = await Promise.all([title === undefined ? defaultTitleOf(screen, { taskId, role: viewer }) : Promise.resolve(null), shellBell()]);

  let options: ProjectOptionView[] = [];
  if (project) {
    // R-170: number, analytic code, DAS and machine type come from the project record (the prototype constant PROJ_ID
    // left a wizard project's line empty); R-148: the name is shown as typed (or its demo-data dictionary entry).
    options = scope.pool.map((p) => {
      const h = healthView(p);
      return {
        code: p.code,
        name: projectLabelText(p, lang),
        sub: projectOptionSub(p),
        health: t(h.label),
        tagClass: h.cls,
        mine: scope.isMine(p),
        // R-041: read-only on every project the viewer is not on the team of.
        readOnly: scope.readOnly(p),
        haystack: projectOptionHaystack(p, dataText(p.name, lang)),
      };
    });
  }
  const health = project ? healthView(project) : null;
  const zoneBar = def.scope === 'zone' ? await zoneBarOf(screen, zone) : null;

  const crumbs: ReactNode[] = [
    ...(crumbText ? [crumbText] : []),
    ...(project
      ? [
          <ProjectSwitcher
            key="project"
            current={project.code}
            currentName={projectLabelText(project, lang)}
            options={options}
            scopeAvail={scope.scopeAvail}
            mineCount={scope.mineCount}
            param={isProject ? undefined : 'project'}
          />,
        ]
      : []),
  ];

  return (
    <CoqueHeader
      crumbs={crumbs}
      title={title ?? t(defTitle ?? def.title)}
      titleAside={
        <>
          {health && <span className={health.cls}>{t(health.label)}</span>}
          {readOnly && (
            <span className={`tag tag-outline ${styles.roTag}`}>
              <Eye aria-hidden />
              {t('Read-only')}
            </span>
          )}
        </>
      }
      search={<GlobalSearch />}
      actions={<ExportButton screen={screen} code={project?.code ?? code} formats={exportFormatsOf(screen)} task={taskId ?? null} />}
      primary={showPrimary ? primary : undefined}
      // R-013: the business date ("25 Sep 2026" on the demo data set), translated as the former STATUS_DATE ("25 sept. 2026").
      date={<StatusDate>{`${t('Status date ·')} ${t(displayOfIso(today))}`}</StatusDate>}
      bell={
        <span className={styles.headerBell}>
          {bell}
        </span>
      }
      prefs={<KeystonePrefs lang={lang} theme={theme} />}
      // The "outside my workspace" banner is rendered here rather than through the charte's `outside` (which also hides the
      // actions): an outside screen keeps its Export (reading), its primary is already hidden (`showPrimary`).
      toolbar={
        <>
          {outside && (
            <div className="coque-outside" role="note">
              <Eye size={16} className={styles.accentIcon} aria-hidden />
              <span className={styles.outsideText}>{t('Outside my workspace · Read-only · ' + viewer.title)}</span>
              <Link href={screenHref('home')} className={`btn btn-ghost ${styles.homeBtn}`}>
                <House aria-hidden />
                {t('Home')}
              </Link>
            </div>
          )}
          {zoneBar && (
          <div className={styles.zoneBar}>
            <span className={styles.zoneLabel}>
              <GlobeHemisphereEast size={15} className={styles.accentIcon} aria-hidden />
              {t('Zone')}
            </span>
            <ZoneSeg zone={zone} options={zoneBar.options.map((o) => ({ ...o, label: t(o.label) }))} />
            <span className={styles.zoneLabel}>
              <UserCircle size={15} className={styles.mutedIcon} aria-hidden />
              {t(zoneBar.ownerLabel)}
              <span className={styles.zoneName}>{zoneBar.ownerName}</span>
            </span>
          </div>
          )}
        </>
      }
    />
  );
}
