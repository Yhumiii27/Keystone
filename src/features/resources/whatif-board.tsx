'use client';
// What-if levelling body (docs/spec/05 §4.3–§4.5, template 1504–1528): 4 KPI tiles, one card per scenario
// (priority segment, levers, peak load by week, results, "Select scenario → create requests") and the "Side by
// side" table. Lever toggles, priority, auto-level and selection are saved through Server Functions and shown
// optimistically; read-only viewers see the same cards without the controls.
import { Check, CheckSquare, Sparkle, Square } from '@phosphor-icons/react/dist/ssr';
import { useOptimistic, useTransition, type CSSProperties } from 'react';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { Button } from '@/components/ds/Button';
import { CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import { Segmented } from '@/components/ds/Segmented';
import { Table, Td, Th } from '@/components/ds/Table';
import { useToast } from '@/components/ds/Toast';
import type { WhatIfPriority } from '@/domain/whatif';
import { useI18n } from '@/i18n/client';
import { autoLevelWhatIf, selectWhatIfScenario, setWhatIfPriority, toggleWhatIfLever, type WhatIfActionResult } from './actions';
import { PRIORITY_OPTIONS, reduceScenarios, whatIfView, type ScenarioCardView, type WhatIfAction, type WhatIfData } from './whatif-model';
import s from './whatif.module.css';

export function WhatIfBoard({ data, canEdit }: { data: WhatIfData; canEdit: boolean }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [scenarios, apply] = useOptimistic(data.scenarios, (state, a: WhatIfAction) => reduceScenarios(state, a, data));
  const [, startTransition] = useTransition();
  const view = whatIfView({ ...data, scenarios }, t, lang);

  const run = (a: WhatIfAction, call: () => Promise<WhatIfActionResult>) =>
    startTransition(async () => {
      apply(a);
      try {
        const r = await call();
        if ('error' in r) toast.show(r.error);
      } catch {
        toast.show(t('The change could not be saved'));
      }
    });
  const code = data.projectCode;
  const handlers = {
    priority: (name: string, priority: WhatIfPriority) => run({ type: 'priority', name, priority }, () => setWhatIfPriority(code, name, priority)),
    toggle: (name: string, lever: string) => run({ type: 'toggle', name, lever }, () => toggleWhatIfLever(code, name, lever)),
    auto: (name: string) => run({ type: 'auto', name }, () => autoLevelWhatIf(code, name)),
    select: (name: string) => run({ type: 'select', name }, () => selectWhatIfScenario(code, name)),
  };

  return (
    <div className={s.body}>
      <KpiGrid min={150}>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>
      <div className={s.scenarios}>
        {view.scenarios.map((sc) => (
          <ScenarioCard key={sc.name} sc={sc} canEdit={canEdit} handlers={handlers} />
        ))}
      </div>
      <section className={cx('card', 'elev-sm', s.compare)}>
        <CardTitle>{t('Side by side')}</CardTitle>
        <Table size={13}>
          <thead>
            <tr>
              <Th>{t('Indicator')}</Th>
              {view.scenarios.map((sc) => (
                <Th key={sc.name}>{sc.title}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.compare.map((r) => (
              <tr key={r.key}>
                <Td color="var(--color-neutral-400)">{r.key}</Td>
                {r.values.map((v, i) => (
                  <Td key={i} numeric color={v.color}>
                    {v.value}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
        <span className={s.footnote}>
          {t(
            'Selecting a scenario turns its levers into resource requests (contractor, overtime, transfers) that go through department approval before anything reaches a team member.',
          )}
        </span>
      </section>
    </div>
  );
}

interface Handlers {
  priority: (name: string, p: WhatIfPriority) => void;
  toggle: (name: string, lever: string) => void;
  auto: (name: string) => void;
  select: (name: string) => void;
}

function ScenarioCard({ sc, canEdit, handlers }: { sc: ScenarioCardView; canEdit: boolean; handlers: Handlers }) {
  const { t } = useI18n();
  return (
    <section className={cx('card', 'elev-sm', s.scenario)} aria-label={sc.title}>
      <div className={s.head}>
        <CardTitle className={s.title}>{sc.title}</CardTitle>
        {sc.selected && <span className="tag tag-accent">{t('Selected')}</span>}
      </div>
      <div className={s.block}>
        <span className={s.eyebrow}>{t('Priority (set by the PM)')}</span>
        <Segmented
          label={t('Priority (set by the PM)')}
          value={sc.priority}
          options={PRIORITY_OPTIONS.map((o) => ({ value: o.value, label: t(o.label), disabled: !canEdit && o.value !== sc.priority }))}
          onChange={canEdit ? (v) => v !== sc.priority && handlers.priority(sc.name, v) : undefined}
        />
      </div>
      <div className={s.blockTight}>
        <div className={s.leversHead}>
          <span className={s.eyebrow}>{t('Levers')}</span>
          {canEdit && (
            <Button variant="secondary" className={s.small} icon={Sparkle} onClick={() => handlers.auto(sc.name)}>
              {t('Auto-level for this priority')}
            </Button>
          )}
        </div>
        {sc.levers.map((l) => {
          const inner = (
            <>
              {l.on ? <CheckSquare className={cx(s.leverIcon, s.leverOn)} aria-hidden /> : <Square className={cx(s.leverIcon, s.leverOff)} aria-hidden />}
              <span>{l.label}</span>
              <span className={s.effect}>{l.effect}</span>
            </>
          );
          return canEdit ? (
            <button key={l.code} type="button" className={s.lever} aria-pressed={l.on} onClick={() => handlers.toggle(sc.name, l.code)}>
              {inner}
            </button>
          ) : (
            <div key={l.code} className={cx(s.lever, s.leverStatic)} role="checkbox" aria-checked={l.on} aria-readonly="true" aria-label={l.label}>
              {inner}
            </div>
          );
        })}
      </div>
      <div className={s.block}>
        <span className={s.eyebrow}>{t('Peak load by week')}</span>
        <div className={s.bars}>
          {sc.bars.map((b, i) => (
            <div key={i} className={s.barCol}>
              <div className={s.bar} style={{ '--bar-bg': b.bg, '--bar-h': b.height } as CSSProperties} />
              <span className={s.barLabel}>{b.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={s.blockTight}>
        {sc.results.map((r) => (
          <div key={r.key} className={s.result}>
            <span className={s.resultKey}>{r.key}</span>
            <span className={s.resultValue} style={{ '--res-color': r.color } as CSSProperties}>
              {r.value}
            </span>
          </div>
        ))}
      </div>
      {canEdit && (
        <Button variant="primary" className={s.choose} icon={Check} onClick={() => handlers.select(sc.name)}>
          {t('Select scenario → create requests')}
        </Button>
      )}
    </section>
  );
}
