'use client';
// What-if levelling body (docs/spec/05 §4.3–§4.5, template 1504–1528; chapter 4, S-7): 4 KPI tiles, one card per scenario
// (priority segment, levers derived from the data, peak load by week, results computed by the CPM engine on a copy of the
// plan, "Select scenario → create requests") and the "Side by side" table with the current plan. Lever toggles, priority,
// auto-level and selection are saved through Server Functions and shown optimistically (results of a lever set one toggle
// away are precomputed by the server); rename and delete are confirmed in dialogs. Read-only viewers see the cards
// without the controls. Owner answers 17 Oct 2026: the horizon navigation (`nav`, the load plans' previous / current / next
// links) sits above the tiles; every action carries the horizon shown (`data.horizon`); a past horizon is read-only with
// its reason (`readOnlyReason`).
import { Check, CheckSquare, PencilSimple, Sparkle, Square, Trash } from '@phosphor-icons/react/dist/ssr';
import { useOptimistic, useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import { Callout } from '@/components/app/Callout';
import { EmptyState } from '@/components/app/EmptyState';
import { FormDialog } from '@/components/app/FormDialog';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { Button, IconButton } from '@/components/ds/Button';
import { CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Segmented } from '@/components/ds/Segmented';
import { Table, Td, Th } from '@/components/ds/Table';
import { useToast } from '@/components/ds/Toast';
import type { WhatIfPriority } from '@/domain/whatif';
import { useI18n } from '@/i18n/client';
import { autoLevelWhatIf, deleteWhatIfScenario, renameWhatIfScenario, selectWhatIfScenario, setWhatIfPriority, toggleWhatIfLever, type WhatIfActionResult } from './actions';
import { RENAME_SCENARIO_FORM } from './whatif-form';
import { PRIORITY_OPTIONS, reduceScenarios, whatIfView, type ScenarioCardView, type WhatIfAction, type WhatIfData } from './whatif-model';
import s from './whatif.module.css';

export function WhatIfBoard({ data, canEdit, nav, readOnlyReason }: {
  data: WhatIfData;
  canEdit: boolean;
  /** Horizon navigation (`LoadWindowNav`, rendered by the page). */
  nav?: ReactNode;
  /** Why the horizon shown is read-only (translated; a past horizon), or null. */
  readOnlyReason?: string | null;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [scenarios, apply] = useOptimistic(data.scenarios, (state, a: WhatIfAction) => reduceScenarios(state, a, data));
  // Pending while a Server Function runs: Select and Auto-level are disabled so a double-click cannot submit twice.
  const [busy, startTransition] = useTransition();
  const [renaming, setRenaming] = useState<ScenarioCardView | null>(null);
  const [deleting, setDeleting] = useState<ScenarioCardView | null>(null);
  const view = whatIfView({ ...data, scenarios }, t, lang, data.scenarios);

  const run = (a: WhatIfAction | null, call: () => Promise<WhatIfActionResult>) =>
    startTransition(async () => {
      if (a) apply(a);
      try {
        const r = await call();
        if ('error' in r) toast.show(r.error);
        else if (r.message) toast.show(r.message);
      } catch {
        toast.show(t('The change could not be saved'));
      }
    });
  const code = data.projectCode;
  const horizon = data.horizon;
  const handlers: Handlers = {
    priority: (name, priority) => run({ type: 'priority', name, priority }, () => setWhatIfPriority(code, name, priority, horizon)),
    toggle: (name, lever) => run({ type: 'toggle', name, lever }, () => toggleWhatIfLever(code, name, lever, horizon)),
    auto: (name) => run({ type: 'auto', name }, () => autoLevelWhatIf(code, name, horizon)),
    select: (name) => run({ type: 'select', name }, () => selectWhatIfScenario(code, name, horizon)),
    rename: setRenaming,
    remove: setDeleting,
  };

  return (
    <div className={s.body}>
      {nav}
      {readOnlyReason && <Callout tone="accent">{readOnlyReason}</Callout>}
      <KpiGrid min={150}>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>
      {data.error && <Callout tone="accent">{`${t('The plan cannot be scheduled')} · ${t(data.error)}`}</Callout>}
      {view.scenarios.length ? (
        <div className={s.scenarios}>
          {view.scenarios.map((sc) => (
            <ScenarioCard key={sc.name} sc={sc} canEdit={canEdit} busy={busy} hasLevers={data.levers.length > 0} handlers={handlers} />
          ))}
        </div>
      ) : (
        <EmptyState variant="boxed">{t(canEdit ? 'No scenario yet — create one with New scenario.' : 'No scenario yet.')}</EmptyState>
      )}
      <section className={cx('card', 'elev-sm', s.compare)}>
        <CardTitle>{t('Side by side')}</CardTitle>
        <Table size={13}>
          <thead>
            <tr>
              <Th>{t('Indicator')}</Th>
              {view.columns.map((c, i) => (
                <Th key={i}>{c}</Th>
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
        <span className={s.footnote}>{view.note}</span>
      </section>
      {canEdit && (
        <>
          <FormDialog
            {...RENAME_SCENARIO_FORM}
            translate
            open={!!renaming}
            onClose={() => setRenaming(null)}
            context={renaming?.title}
            initialValues={renaming ? { name: renaming.name, note: renaming.hypotheses ?? '' } : undefined}
            onSubmit={(values) => renameWhatIfScenario(code, renaming!.name, values, horizon)}
          />
          <ConfirmDelete code={code} horizon={horizon} target={deleting} onClose={() => setDeleting(null)} />
        </>
      )}
    </div>
  );
}

interface Handlers {
  priority: (name: string, p: WhatIfPriority) => void;
  toggle: (name: string, lever: string) => void;
  auto: (name: string) => void;
  select: (name: string) => void;
  rename: (sc: ScenarioCardView) => void;
  remove: (sc: ScenarioCardView) => void;
}

function ScenarioCard({ sc, canEdit, busy, hasLevers, handlers }: { sc: ScenarioCardView; canEdit: boolean; busy: boolean; hasLevers: boolean; handlers: Handlers }) {
  const { t } = useI18n();
  return (
    <section className={cx('card', 'elev-sm', s.scenario)} aria-label={sc.title}>
      <div className={s.head}>
        <CardTitle className={s.title}>{sc.title}</CardTitle>
        {sc.applied && (
          <span className="tag tag-outline" title={sc.appliedText}>
            {t('Applied')}
          </span>
        )}
        {sc.selected && <span className="tag tag-accent">{t('Selected')}</span>}
        {canEdit && (
          <span className={s.cardActions}>
            <IconButton icon={PencilSimple} size={26} muted label={`${t('Rename scenario')} — ${sc.title}`} onClick={() => handlers.rename(sc)} />
            <IconButton icon={Trash} size={26} muted label={`${t('Delete scenario')} — ${sc.title}`} onClick={() => handlers.remove(sc)} />
          </span>
        )}
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
            <Button
              variant="secondary"
              className={s.small}
              icon={Sparkle}
              disabled={!hasLevers || busy}
              aria-busy={busy || undefined}
              onClick={() => handlers.auto(sc.name)}
            >
              {t('Auto-level for this priority')}
            </Button>
          )}
        </div>
        {!sc.levers.length && (
          <span className={s.noLever}>{t('No lever derived from this plan — no critical activity with labour assignments, no overloaded person on a movable activity.')}</span>
        )}
        {sc.levers.map((l) => {
          const inner = (
            <>
              {l.on ? <CheckSquare className={cx(s.leverIcon, s.leverOn)} aria-hidden /> : <Square className={cx(s.leverIcon, s.leverOff)} aria-hidden />}
              <span title={l.title}>{l.label}</span>
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
      <div className={cx(s.block, sc.pending && s.pending)}>
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
      <div className={cx(s.blockTight, sc.pending && s.pending)} aria-busy={sc.pending || undefined}>
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
        <Button variant="primary" className={s.choose} icon={Check} disabled={busy} aria-busy={busy || undefined} onClick={() => handlers.select(sc.name)}>
          {t('Select scenario → create requests')}
        </Button>
      )}
    </section>
  );
}

function ConfirmDelete({ code, horizon, target, onClose }: { code: string; horizon: string; target: ScenarioCardView | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [pending, start] = useTransition();
  const confirm = () => {
    if (!target) return;
    start(async () => {
      try {
        const r = await deleteWhatIfScenario(code, target.name, horizon);
        toast.show('error' in r ? r.error : (r.message ?? ''));
      } catch {
        toast.show(t('The change could not be saved'));
      }
      onClose();
    });
  };
  return (
    <Dialog open={!!target} onClose={onClose} title={t('Delete scenario')} width={440}>
      {target && (
        <p className={s.confirmText}>
          {lang === 'fr'
            ? `Supprimer ${target.title} ? Ses leviers et ses résultats sont perdus ; les demandes déjà créées restent dans Demandes de ressources.`
            : `Delete ${target.title}? Its levers and results are lost; requests it already created stay in Resource requests.`}
        </p>
      )}
      <DialogActions>
        <Button variant="secondary" onClick={onClose}>
          {t('Cancel')}
        </Button>
        <Button variant="primary" icon={Trash} onClick={confirm} disabled={pending} aria-busy={pending || undefined}>
          {t('Delete scenario')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
