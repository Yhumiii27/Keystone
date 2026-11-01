// R-198 — Schedule screen, "Activities" level of the Gantt card: zoom switch (URL `?zoom=`), legend, edit hint and the
// interactive Gantt (Client Component). Server Component; the rights are decided by the page (gantt-rights.ts).
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/app/EmptyState';
import { SectionCard } from '@/components/app/SectionCard';
import { ProjectGanttLegend } from '@/components/charts/project-gantt';
import { CardTitle } from '@/components/ds/Card';
import { Segmented } from '@/components/ds/Segmented';
import { GANTT_ZOOMS, type GanttNetwork, type GanttZoom } from '@/domain/gantt-edit';
import { getI18n } from '@/server/session';
import { InteractiveGantt } from './interactive-gantt';
import s from './schedule.module.css';
import g from './gantt.module.css';

const ZOOM_LABELS: Record<GanttZoom, string> = { day: 'Day', week: 'Week', month: 'Month' };

export interface ActivityGanttCardProps {
  code: string;
  network: GanttNetwork | null;
  zoom: GanttZoom;
  zoomHref: (z: GanttZoom) => string;
  /** Work packages | Activities switch (links). */
  levelSwitch: ReactNode;
  editable: boolean;
  showBaseline: boolean;
}

export async function ActivityGanttCard({ code, network, zoom, zoomHref, levelSwitch, editable, showBaseline }: ActivityGanttCardProps) {
  const { t } = await getI18n();
  return (
    <SectionCard gap={10}>
      <div className={s.head}>
        <CardTitle push>{t('Schedule — activities')}</CardTitle>
        <ProjectGanttLegend labels={{ critical: t('Critical path'), task: t('Task'), baseline: t('Baseline'), milestone: t('Milestone') }} />
      </div>
      <div className={g.toolbar}>
        {levelSwitch}
        <Segmented label={t('Zoom')} value={zoom} options={GANTT_ZOOMS.map((z) => ({ value: z, label: t(ZOOM_LABELS[z]), href: zoomHref(z) }))} />
        <span className={g.hint}>
          {editable
            ? t('Drag a bar to move it, its right edge to change its duration, its dot onto another bar to link them · Enter or a click opens the activity')
            : t('Read-only · a click or Enter opens the activity')}
        </span>
      </div>
      {network ? (
        <InteractiveGantt code={code} network={network} zoom={zoom} editable={editable} showBaseline={showBaseline} />
      ) : (
        <EmptyState variant="boxed">{t('No activities recorded for this project yet')}</EmptyState>
      )}
    </SectionCard>
  );
}
