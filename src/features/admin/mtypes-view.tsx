// Standard machine types body (docs/spec/09 §9.3–9.10, template 1529–1572): KPI tiles, the machine-type list (links,
// `?type=` selects) and the editor of the selected type (client island). Server Component.
import Link from 'next/link';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { cx } from '@/components/ds/cx';
import type { T } from '@/i18n/translate';
import { MachineTypeEditor } from './mtype-editor';
import type { MachineTypesView } from './model';
import s from './admin.module.css';

export function MachineTypesBody({ view, canEdit, t }: { view: MachineTypesView; canEdit: boolean; t: T }) {
  return (
    <div className={s.root}>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>
      <div className={s.mtLayout}>
        <nav className={cx('card', 'elev-sm', s.mtListCard)} aria-label={t('Machine types')}>
          <div className={s.mtListHead}>
            <div className="card-title">{t('Machine types')}</div>
            <span className={cx(s.muted12, s.pretty)}>{t('Standard planning · costs · inspections · financial REX')}</span>
          </div>
          <div className={s.mtList}>
            {view.list.map((m) => (
              <Link key={m.code} href={m.href} scroll={false} replace className={cx(s.mtItem, m.selected && s.mtItemOn)} aria-current={m.selected ? 'true' : undefined}>
                <span className={s.mtItemHead}>
                  <span className={s.mtCode}>{m.displayCode}</span>
                  {m.custom && <span className={cx('tag tag-accent', s.tag105)}>{t('Custom')}</span>}
                  <span className={cx(m.active ? 'tag tag-neutral' : 'tag tag-outline', s.tag105, s.pushRight)}>{m.stateText}</span>
                </span>
                <span className={s.mtItemSub}>{m.sub}</span>
                <span className={s.mtItemUse}>{m.use}</span>
              </Link>
            ))}
          </div>
        </nav>
        {view.mt && <MachineTypeEditor mt={view.mt} canEdit={canEdit} />}
      </div>
    </div>
  );
}
