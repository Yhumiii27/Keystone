// Hours — Lucca reconciliation body (docs/spec/06 §5, template 933–946): group-by switch (`?view=`), KPIs,
// "Lucca declared vs planned" by resource or work package, and "Hours without a planned task" with the Assign
// control (client island). Server Component.
import { Question, Rows, TreeStructure, User } from '@phosphor-icons/react/dist/ssr';
import { FilterBar, FilterLabel } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard } from '@/components/app/SectionCard';
import { LO, OK } from '@/components/app/tones';
import { cx } from '@/components/ds/cx';
import { Segmented } from '@/components/ds/Segmented';
import { hoursKpis, hoursVariance, type HoursView as View } from '@/domain/hr';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import type { HoursGroup, HoursReconciliation } from '@/server/dal/hr';
import { AssignControl } from './assign-control';
import s from './hr.module.css';
import { dataText } from '@/i18n/data-text';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const hoursViewHref = (base: string, v: View) => (v === 'resource' ? base : `${base}?view=${v}`);

function Variance({ p, d, line }: { p: number; d: number; line?: boolean }) {
  const v = hoursVariance(p, d);
  return <span className={cx(line ? s.hrLineNum : s.hrNum, v.tone === 'ok' ? s.varOk : s.varLo)}>{v.varText}</span>;
}

function Group({ g, byWp, t }: { g: HoursGroup; byWp: boolean; t: T }) {
  const v = hoursVariance(g.plannedH, g.declaredH);
  return (
    <div className={s.group}>
      <div className={s.hrGrid}>
        <span className={s.hrAvatar}>{g.avatar}</span>
        <span className={s.hrLabel}>
          <span className={s.hrName}>{byWp ? t(g.label) : g.label}</span>
          <span className={s.hrSub}>{t(g.sub)}</span>
        </span>
        <span className={s.hrPlanned}>{`${g.plannedH} h`}</span>
        <span className={s.hrNum}>{`${g.declaredH} h`}</span>
        <Variance p={g.plannedH} d={g.declaredH} />
        <div className={s.track}>
          <div className={cx(s.fill, v.barOver && s.fillOver)} style={{ width: `${v.barPct}%` }} />
        </div>
      </div>
      {g.lines.map((l) => (
        <div key={`${l.wbsLabel}|${l.person}`} className={cx(s.hrGrid, s.hrLine)}>
          <span />
          <span className={s.hrLineLabel}>{`${t(l.wbsLabel)} · ${l.person}`}</span>
          <span className={s.hrLineNum}>{`${l.plannedH} h`}</span>
          <span className={s.hrLineNum}>{`${l.declaredH} h`}</span>
          <Variance p={l.plannedH} d={l.declaredH} line />
          <span />
        </div>
      ))}
    </div>
  );
}

export interface HoursViewProps {
  data: HoursReconciliation;
  view: View;
  base: string;
  code: string;
  canEdit: boolean;
  lang: Lang;
  t: T;
}

export function HoursBody({ data, view, base, code, canEdit, lang, t }: HoursViewProps) {
  const pending = data.unassigned.filter((u) => !u.assignedWbs);
  const k = hoursKpis({ lines: data.lines, unassigned: pending, unassignedTotalH: data.unassigned.reduce((a, u) => a + u.hours, 0) });
  const month = MONTHS[+data.periodStart.slice(5, 7) - 1];
  const varText = (k.varianceH > 0 ? '+' : '') + k.varianceH + ' h';
  const options = data.workPackages.map((w) => ({ value: w.code, label: `${w.code} · ${dataText(w.name, lang)}` }));

  return (
    <>
      <FilterBar>
        <FilterLabel icon={Rows}>{t('Group by')}</FilterLabel>
        <Segmented
          wrap
          label={t('Group by')}
          value={view}
          options={[
            { value: 'resource', label: t('By resource'), icon: User, href: hoursViewHref(base, 'resource') },
            { value: 'wp', label: t('By work package'), icon: TreeStructure, href: hoursViewHref(base, 'wp') },
            { value: 'unassigned', label: t('To assign'), icon: Question, href: hoursViewHref(base, 'unassigned') },
          ]}
        />
      </FilterBar>
      <KpiGrid min={150}>
        <KpiTile
          label={t(`Declared in Lucca · ${month}`)}
          value={`${k.declaredTotalH} h`}
          sub={t(`analytic code ${data.analyticCode} · imported ${data.importedText}`)}
          color={OK}
        />
        <KpiTile
          label={t('Planned (schedule)')}
          value={`${k.plannedH} h`}
          sub={t(k.lineCount === 1 ? '1 resource × work package line' : `${k.lineCount} resource × work package lines`)}
          color="var(--color-neutral-200)"
        />
        <KpiTile
          label={t('Variance')}
          value={varText}
          sub={t(`${k.variancePct} % · ≈ ${money(k.varianceCostK, lang)} labour cost`)}
          color={k.varianceLo ? LO : OK}
        />
        <KpiTile
          label={t('To assign')}
          value={`${k.toAssignH} h`}
          sub={t(k.toAssignCount === 1 ? '1 line without a planned task' : `${k.toAssignCount} lines without a planned task`)}
          color={k.toAssignH ? LO : OK}
        />
      </KpiGrid>
      {view !== 'unassigned' ? (
        <SectionCard
          scroll
          title={t('Lucca declared vs planned')}
          subtitle={t('Hours are imported from Lucca on the project analytic code and matched to resource × work package from the schedule')}
        >
          {(view === 'wp' ? data.byWorkPackage : data.byResource).map((g) => (
            <Group key={g.label} g={g} byWp={view === 'wp'} t={t} />
          ))}
        </SectionCard>
      ) : (
        <SectionCard scroll title={t('Hours without a planned task')}>
          {data.unassigned.map((u, i) => (
            <div key={`${u.person}|${i}`} className={s.unRow}>
              <span className={s.hrAvatar}>{u.initials}</span>
              <span className={s.unText}>
                <span className={s.hrName}>{u.person}</span>
                <span className={s.unWhy}>{t(u.reason)}</span>
              </span>
              <span className={s.unHours}>{`${u.hours} h`}</span>
              {u.assignedWbs ? (
                <>
                  <span className={s.assigned}>{t(data.workPackages.find((w) => w.code === u.assignedWbs)?.label ?? u.assignedWbs)}</span>
                  <span className="tag tag-neutral">{t('Assigned')}</span>
                </>
              ) : canEdit ? (
                <AssignControl code={code} index={i} options={options} />
              ) : (
                <>
                  <span />
                  <span />
                </>
              )}
            </div>
          ))}
        </SectionCard>
      )}
    </>
  );
}
