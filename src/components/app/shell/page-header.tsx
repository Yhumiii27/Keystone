// PageHeader — the header every screen renders first (docs/spec/01 §5, §7; docs/spec/02 C-02, C-03).
// Server Component with client islands. Renders, as siblings inside <main> (gap 18):
//   <header> breadcrumb (+ project switcher) · title (+ health, Read-only) · search · bell · status date · FR/EN · Export · primary
//   outside banner (screen outside the viewer's workspace)
//   zone bar (zone-scoped screens)
// Usage: return <><PageHeader screen="plan" projectCode={code} primary={<…/>} />{…screen body…}</>
import { CalendarBlank, Eye, GlobeHemisphereEast, House, UserCircle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SCREEN_BY_ID, screenHref, type ScreenId } from '@/config/screens';
import { HEALTH_LABEL, HEALTH_TAG } from '@/domain/health';
import { exportFormatsOf } from '@/features/exports/catalog';
import { STATUS_DATE } from '@/lib/format';
import { dataText, fieldsText, projectLabelText } from '@/i18n/data-text';
import { getProject, type ProjectRow } from '@/server/dal/projects';
import { crumbExtraOf, defaultTitleOf, notificationsFor, zoneBarOf } from '@/server/dal/shell';
import { getProjectScope } from '@/server/project-context';
import { getI18n, getLastProject, getViewer, getZone } from '@/server/session';
import { ExportButton, GlobalSearch, LangToggle, Notifications, ProjectSwitcher, ZoneSeg } from './header-islands';
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
  const [{ t, lang }, viewer, zone, lastProject, scope] = await Promise.all([getI18n(), getViewer(), getZone(), getLastProject(), getProjectScope()]);
  const def = SCREEN_BY_ID[screen];
  const isProject = def.scope === 'project';
  const code = projectCode ?? lastProject;
  const project = isProject ? await getProject(code) : projectParam ? await getProject(projectParam) : null;

  const outside = isOutside(viewer.role, screen);
  const readOnly = !!project && scope.readOnly(project);
  const showPrimary = !!primary && !outside && !(readOnly && PROJECT_EDITABLE.includes(screen));

  const extra = crumbExtra !== undefined ? crumbExtra : await crumbExtraOf(screen, { role: viewer.role, code, zone, taskId });
  // R-148: the contract's reference and payment terms are typed text (shown as typed); the other extras are Keystone's.
  const crumbText = extra && crumbExtra === undefined && DATA_CRUMB_SCREENS.has(screen)
    ? `${t(crumbBase(screen))} · ${fieldsText(extra, t, lang)}`
    : t(crumbBase(screen) + (extra ? ' · ' + extra : ''));

  const [rawNotifs, defTitle] = await Promise.all([
    notificationsFor(viewer.role),
    title === undefined ? defaultTitleOf(screen, { taskId, role: viewer.role }) : Promise.resolve(null),
  ]);
  // R-148: a notification's sub-line joins typed fields (titles, people) with Keystone's amounts and dates.
  const notifs = rawNotifs.map((n) => ({ ...n, title: t(n.title), sub: fieldsText(n.sub, t, lang), when: t(n.when) }));

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
        readOnly: scope.scopeAvail && !scope.isMine(p),
        haystack: projectOptionHaystack(p, dataText(p.name, lang)),
      };
    });
  }
  const health = project ? healthView(project) : null;
  const zoneBar = def.scope === 'zone' ? await zoneBarOf(screen, zone) : null;

  return (
    <>
      <header className={styles.header}>
        <div className={styles.left}>
          <div className={styles.crumb}>
            {crumbText}
            {project && (
              <>
                <span className={styles.sep}>/</span>
                <ProjectSwitcher
                  current={project.code}
                  currentName={projectLabelText(project, lang)}
                  options={options}
                  scopeAvail={scope.scopeAvail}
                  mineCount={scope.mineCount}
                  param={isProject ? undefined : 'project'}
                />
              </>
            )}
          </div>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>{title ?? t(defTitle ?? def.title)}</h2>
            {health && <span className={health.cls}>{t(health.label)}</span>}
            {readOnly && (
              <span className={`tag tag-outline ${styles.roTag}`}>
                <Eye />
                {t('Read-only')}
              </span>
            )}
          </div>
        </div>
        <GlobalSearch />
        <Notifications items={notifs} role={viewer.role} />
        <div className={styles.statusDate}>
          <CalendarBlank />
          {`${t('Status date ·')} ${t(STATUS_DATE)}`}
        </div>
        <LangToggle lang={lang} />
        <div className={styles.actions}>
          {/* P-1: outside the workspace a client cannot export (the route answers 403). */}
          {!(outside && viewer.role === 'client') && <ExportButton screen={screen} code={project?.code ?? code} formats={exportFormatsOf(screen)} task={taskId ?? null} />}
          {showPrimary && primary}
        </div>
      </header>
      {outside && (
        <div className={styles.outside}>
          <Eye size={16} className={styles.accentIcon} />
          <span className={styles.outsideText}>{t('Outside my workspace · Read-only · ' + viewer.title)}</span>
          <Link href={screenHref('home')} className={`btn btn-ghost ${styles.homeBtn}`}>
            <House />
            {t('Home')}
          </Link>
        </div>
      )}
      {zoneBar && (
        <div className={styles.zoneBar}>
          <span className={styles.zoneLabel}>
            <GlobeHemisphereEast size={15} className={styles.accentIcon} />
            {t('Zone')}
          </span>
          <ZoneSeg zone={zone} options={zoneBar.options.map((o) => ({ ...o, label: t(o.label) }))} />
          <span className={styles.zoneLabel}>
            <UserCircle size={15} className={styles.mutedIcon} />
            {t(zoneBar.ownerLabel)}
            <span className={styles.zoneName}>{zoneBar.ownerName}</span>
          </span>
        </div>
      )}
    </>
  );
}
