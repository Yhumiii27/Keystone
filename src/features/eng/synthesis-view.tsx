// Engineering synthesis body (docs/spec/09 §7, template 2384–2416): KPI row → "Who is waiting for what" matrix →
// Disciplines | Gate · Plans & BOM frozen → Recent changes & impact. Projects without an engineering register show
// the empty state. Server Component; the discipline cards and the gate items are links to the discipline screens.
import { Cpu, FlowArrow, Gear, Lightning, SquaresFour } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import { createElement } from 'react';
import { EmptyState } from '@/components/app/EmptyState';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { cx } from '@/components/ds/cx';
import type { T } from '@/i18n/translate';
import type { KpiView, SynthesisScreenView } from './model';
import s from './eng.module.css';

/** Discipline icons (ENG_DISC classes "ph ph-flow-arrow"…). */
const ICONS: Record<string, Icon> = { 'ph ph-flow-arrow': FlowArrow, 'ph ph-gear': Gear, 'ph ph-lightning': Lightning, 'ph ph-cpu': Cpu };

/** The Phosphor icon of a discipline (decorative). */
export function DisciplineIcon({ icon, className }: { icon: string; className?: string }) {
  return createElement(ICONS[icon] ?? SquaresFour, { className, 'aria-hidden': true });
}

export function EngKpis({ kpis }: { kpis: KpiView[] }) {
  return (
    <KpiGrid>
      {kpis.map((k) => (
        <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
      ))}
    </KpiGrid>
  );
}

/** "No engineering register for this project yet — import the first list to start." */
export function EngEmpty({ t }: { t: T }) {
  return (
    <div className={s.page}>
      <EmptyState variant="boxed">{t('No engineering register for this project yet — import the first list to start.')}</EmptyState>
    </div>
  );
}

function Legend({ t }: { t: T }) {
  const items: [string, string][] = [
    ['Up to date', s.dotUp],
    ['To confirm', s.dotConfirm],
    ['Outdated', s.dotOutdated],
    ['Awaited', s.dotAwaited],
  ];
  return (
    <div className={s.legend}>
      {items.map(([label, cls]) => (
        <span key={label} className={s.legendItem}>
          <span className={cx(s.legendDot, cls)} />
          {t(label)}
        </span>
      ))}
    </div>
  );
}

export function SynthesisBody({ view, t }: { view: SynthesisScreenView; t: T }) {
  return (
    <div className={s.page}>
      <EngKpis kpis={view.kpis} />

      <div className={cx('card', 'elev-sm', s.cardMatrix)}>
        <div className={s.headTop}>
          <div className={s.titleCol}>
            <div className="card-title">{t('Who is waiting for what')}</div>
            <span className={s.sub}>{t('Rows receive, columns provide · one pill per document: revision in use vs latest released')}</span>
          </div>
          <div className={s.push}>
            <Legend t={t} />
          </div>
        </div>
        <div className={s.matrix} role="table" aria-label={t('Who is waiting for what')}>
          <div role="row" className={s.contents}>
            <div role="columnheader" />
            {view.from.map((f) => (
              <div key={f} role="columnheader" className={s.from}>
                {f}
              </div>
            ))}
          </div>
          {view.matrix.map((row) => (
            <div key={row.label} role="row" className={s.contents}>
              <div role="rowheader" className={s.to}>
                {row.label}
              </div>
              {row.cells.map((c) => (
                <div key={c.key} role="cell" className={s.cell} style={{ background: c.bg }}>
                  {c.items.map((it) => (
                    <span key={it.key} className={s.pill} style={{ borderColor: it.border, color: it.color }}>
                      <span className={s.pillDot} style={{ background: it.dot, borderColor: it.dotBorder }} />
                      {it.label} · {it.sub}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className={s.twoCols}>
        <div className={cx('card', 'elev-sm', s.card)}>
          <div className={s.titleCol}>
            <div className="card-title">{t('Disciplines')}</div>
            <span className={s.sub}>{t('Referent proposes · project manager validates BPE releases')}</span>
          </div>
          {view.discCards.map((d) => (
            <Link key={d.disc} href={d.href} className={s.discBtn}>
              <DisciplineIcon icon={d.icon} className={s.discIcon} />
              <span className={s.discMid}>
                <span className={s.discLabel}>{d.label}</span>
                <span className={s.discLead}>
                  {d.lead} · {d.tools}
                </span>
                <span className={s.bar}>
                  <span className={s.barFill} style={{ width: d.pct }} />
                </span>
              </span>
              <span className={s.discRight}>
                <span>{d.relText}</span>
                <span style={{ color: d.openColor }}>{d.openText}</span>
              </span>
            </Link>
          ))}
        </div>

        <div className={cx('card', 'elev-sm', s.card)}>
          <div className={s.head}>
            <div className={s.titleCol}>
              <div className="card-title">{t('Gate · Plans & BOM frozen')}</div>
              <span className={s.sub}>{t('Blocking inconsistencies must be resolved before the gate')}</span>
            </div>
            <span className={cx(view.gate.cls, s.push, s.nowrap)}>{view.gate.text}</span>
          </div>
          {view.gate.items.map((c) => (
            <Link key={c.number} href={c.href} className={s.gateBtn}>
              <span className={s.sevDot} style={{ background: c.sevDot }} />
              <span className={s.gateMid}>
                <span className={s.gateTitle}>{c.title}</span>
                <span className={s.gateMeta}>
                  {c.id} · {c.ruleLabel} · {c.lead}
                </span>
              </span>
              <span className={cx(c.stClass, s.nowrap)}>{c.status}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className={cx('card', 'elev-sm', s.cardList)}>
        <div className={s.titleCol}>
          <div className="card-title">{t('Recent changes & impact')}</div>
          <span className={s.sub} />
        </div>
        {view.changes.map((c) => (
          <div key={c.key} className={s.change}>
            <span className={s.changeDate}>{c.date}</span>
            <span className={s.changeText}>{c.text}</span>
            <span className={s.changeImpact}>
              {t('Impacts')} {c.impact}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
