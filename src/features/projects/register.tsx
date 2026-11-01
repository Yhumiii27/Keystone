'use client';
// Projects register — list and lifecycle (docs/spec/03 §5; template 638–752). Client island: view switch
// (?view=), stage slider (?status=), search (?q=), the three tables, the "Move to" menus, the deliverable
// checklists and the Force stage change dialog. Rows arrive translated from the page (register-model.ts);
// filtering is instant on the client and the URL is kept in sync with history.replaceState.
import { ChartLineUp, CurrencyEur, Eye, GlobeHemisphereEast, Heartbeat } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react';
import { FilterBar, FilterLabel } from '@/components/app/Filter';
import { ProgressBar } from '@/components/app/Progress';
import { SearchField } from '@/components/app/SearchField';
import { StatusTag } from '@/components/app/StatusTag';
import { Card, CardTitle } from '@/components/ds/Card';
import { Segmented } from '@/components/ds/Segmented';
import { Table, Th } from '@/components/ds/Table';
import { useToast } from '@/components/ds/Toast';
import {
  VIEW_HINT, matchesQuery, missingOf, moveModeFor, sliderStopOf, stageAtStop, stageCounts, stageSelection,
  type RegisterView, type StageCode,
} from '@/domain/lifecycle';
import { PROJECT_CATEGORIES, PROJECT_CATEGORY_FILTER_LABEL, isProjectCategory, type ProjectCategory } from '@/domain/project-category';
import { useI18n } from '@/i18n/client';
import { moveStageAction } from './actions';
import { forcedMoveToastText } from './toasts';
import { PROJECTS_RESET_EVENT } from './events';
import { ForceDialog, MoveDialog, type ForceRequest, type MoveRequest } from './force-dialog';
import { registerTitleText } from './i18n';
import { DeliverablesCell, ProjectCell, StatusCell } from './register-cells';
import type { RegisterRow, StageView } from './register-model';
import { StageSlider } from './stage-slider';
import s from './register.module.css';

export interface ProjectsRegisterProps {
  rows: RegisterRow[];
  stages: StageView[];
  zoneEmpty: boolean;
  /** Edit controls (status menu, deliverable ticks): false outside the viewer's workspace. */
  canEdit: boolean;
  /** Projects whose lifecycle the viewer manages (the director: all; a PM: their own); absent = every row. */
  editableCodes?: string[];
  initialView: RegisterView;
  initialStatus: StageCode | null;
  initialQuery: string;
  /** R-196: category filter (?cat=client|rd); null = every project. */
  initialCategory?: ProjectCategory | null;
}

/** Writes one search param without a navigation (Next syncs useSearchParams with the History API). */
function replaceParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

export function ProjectsRegister({ rows, stages, zoneEmpty, canEdit, editableCodes, initialView, initialStatus, initialQuery, initialCategory = null }: ProjectsRegisterProps) {
  const editable = editableCodes ? new Set(editableCodes) : null;
  const canEditRow = (code: string) => canEdit && (!editable || editable.has(code));
  const { t, lang } = useI18n();
  const toast = useToast();
  const [view, setViewState] = useState<RegisterView>(initialView);
  const [status, setStatusState] = useState<StageCode | null>(initialStatus);
  const [q, setQState] = useState(initialQuery);
  const [force, setForce] = useState<ForceRequest | null>(null);
  const [moveReq, setMoveReq] = useState<MoveRequest | null>(null);
  // Status button to focus again once the "Move to" menu (and the Force dialog, when opened) has closed.
  const returnFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = () => {
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el) requestAnimationFrame(() => el.isConnected && el.focus({ preventScroll: true }));
  };
  const [, startTransition] = useTransition();
  const [optStage, setOptStage] = useOptimistic<Record<string, StageCode>, { code: string; to: StageCode }>({}, (cur, a) => ({ ...cur, [a.code]: a.to }));

  const stageMap = useMemo(() => new Map(stages.map((x) => [x.code, x])), [stages]);
  const labelOf = (c: StageCode) => stageMap.get(c)?.label ?? c;

  const setView = (v: RegisterView) => {
    setViewState(v);
    replaceParam('view', v === 'health' ? null : v);
  };
  const setStatus = (v: StageCode | null) => {
    setStatusState(v);
    replaceParam('status', v);
  };
  // R-196: client projects / R&D projects (shown only when the zone has an R&D project or the filter is set).
  const [category, setCategoryState] = useState<ProjectCategory | null>(initialCategory);
  const setCategory = (v: string) => {
    const next = isProjectCategory(v) ? v : null;
    setCategoryState(next);
    replaceParam('cat', next);
  };
  const setQ = (v: string) => {
    setQState(v);
    replaceParam('q', v.trim() ? v : null);
  };

  // npCreate: the wizard lands here with the status filter cleared.
  useEffect(() => {
    const reset = () => {
      setStatusState(null);
      replaceParam('status', null);
    };
    window.addEventListener(PROJECTS_RESET_EVENT, reset);
    return () => window.removeEventListener(PROJECTS_RESET_EVENT, reset);
  }, []);

  const stageOf = (r: RegisterRow) => optStage[r.code] ?? r.stage;
  const inCategory = (r: RegisterRow) => !category || (category === 'rd') === !!r.rd;
  const showCategory = category !== null || rows.some((r) => r.rd);
  const counts = stageCounts(rows.filter(inCategory).map(stageOf));
  const shown = rows.filter((r) => inCategory(r) && (!status || stageOf(r) === status) && matchesQuery(r.search, q));
  const stop = sliderStopOf(status);
  // Stage labels and LIFE descriptions arrive translated; the count and hint are EN source strings.
  const sel = stageSelection(status ? labelOf(status) : null, status ? (counts[status] ?? 0) : rows.length, status ? (stageMap.get(status)?.description ?? '') : null);
  const selLabel = status ? sel.label : t(sel.label);
  const tickLabels = [t('All'), ...stages.map((x) => x.short)];

  const move = (row: RegisterRow, to: StageCode, effectiveOn: string, reason?: string) => {
    const mode = reason === undefined ? 'auto' : 'forced';
    startTransition(async () => {
      setOptStage({ code: row.code, to });
      const r = await moveStageAction({ code: row.code, to, mode, reason, effectiveOn });
      if (!r.ok) toast.showEn(r.error);
      // X-9 / L-1 (R-152): a forced move (Annulé included) is confirmed once the server accepted it; auto moves stay silent.
      else if (mode === 'forced') toast.show(forcedMoveToastText(row.code, t));
    });
  };

  // Line 3938: Annulé or missing deliverables → Force dialog; otherwise the Change stage dialog, which asks for the
  // effective date of the move (L-4c = a, today by default).
  const requestMove = (row: RegisterRow, to: StageCode, trigger: HTMLElement | null) => {
    const from = stageOf(row);
    const missing = to === 'annule' || from !== row.stage ? [] : missingOf(row.delivs.map((d) => d.label), row.delivs.map((d) => d.done));
    returnFocus.current = trigger;
    const req = { code: row.code, name: row.name, from: labelOf(from), to: labelOf(to), toCode: to, dateBounds: row.dateBounds };
    if (moveModeFor(to, missing) === 'forced') setForce({ ...req, isCancel: to === 'annule', missing });
    else setMoveReq(req);
  };

  const cancelForce = () => {
    setForce(null);
    setMoveReq(null);
    restoreFocus();
  };

  const confirmForce = (reason: string, effectiveOn: string) => {
    const req = force;
    setForce(null);
    restoreFocus();
    const row = req && rows.find((r) => r.code === req.code);
    if (row) move(row, req.toCode, effectiveOn, reason);
  };

  const confirmMove = (effectiveOn: string) => {
    const req = moveReq;
    setMoveReq(null);
    restoreFocus();
    const row = req && rows.find((r) => r.code === req.code);
    if (row) move(row, req.toCode, effectiveOn);
  };

  const viewOptions = [
    { value: 'health' as const, label: t('Health view'), icon: Heartbeat },
    { value: 'progress' as const, label: t('Progress view'), icon: ChartLineUp },
    { value: 'budget' as const, label: t('Budget view'), icon: CurrencyEur },
  ];

  const statusCell = (r: RegisterRow) => (
    <StatusCell stage={stageOf(r)} stages={stageMap} canEdit={canEditRow(r.code)} onMove={(to, trigger) => requestMove(r, to, trigger)} />
  );

  return (
    <div className={s.root}>
      <FilterBar>
        <FilterLabel icon={Eye}>{t('Display')}</FilterLabel>
        <Segmented options={viewOptions} value={view} onChange={setView} wrap label={t('Display')} />
        {showCategory && (
          <Segmented
            options={[
              { value: 'all', label: t('All projects') },
              ...PROJECT_CATEGORIES.map((c) => ({ value: c, label: t(PROJECT_CATEGORY_FILTER_LABEL[c]) })),
            ]}
            value={category ?? 'all'}
            onChange={setCategory}
            wrap
            label={t('Project category')}
          />
        )}
      </FilterBar>

      <div className={s.filterRow}>
        <StageSlider
          value={stop}
          onChange={(i) => setStatus(stageAtStop(i))}
          counts={counts}
          total={rows.length}
          labels={tickLabels}
          valueText={selLabel}
          label={t('Stage')}
        />
        <div className={s.selection}>
          <span className={s.selLabel}>{selLabel}</span>
          <span className={s.selSub}>{t(sel.sub)}</span>
          <span className={s.selHint}>{t(sel.hint)}</span>
        </div>
        <SearchField placeholder={t('Search projects')} value={q} onChange={setQ} push />
      </div>

      {zoneEmpty && (
        <div className={s.zoneEmpty}>
          <GlobeHemisphereEast className={s.accentIcon} aria-hidden />
          {t('No project in this zone for this view')}
        </div>
      )}

      <div className={s.cardRow}>
        <Card className={s.card}>
          <div className={s.cardHead}>
            <CardTitle push>{registerTitleText(t, lang, status ? labelOf(status) : null, shown.length)}</CardTitle>
            <span className={s.cardHint}>{t(VIEW_HINT[view])}</span>
          </div>

          {view === 'health' && (
            <Table>
              <thead>
                <tr>
                  <Th>{t('Project')}</Th>
                  <Th>{t('Status')}</Th>
                  <Th>{t('Health')}</Th>
                  <Th>{t('SPI')}</Th>
                  <Th>{t('CPI')}</Th>
                  <Th>{t('Next milestone')}</Th>
                  <Th>{t('Attention')}</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.code}>
                    <td>
                      <ProjectCell row={r} />
                    </td>
                    {statusCell(r)}
                    <td>
                      <StatusTag tone={r.health.tone}>{r.health.label}</StatusTag>
                    </td>
                    <td className={s.num} style={{ color: r.spiColor }}>
                      {r.spiText}
                    </td>
                    <td className={s.num} style={{ color: r.cpiColor }}>
                      {r.cpiText}
                    </td>
                    <td className={s.ms}>
                      <div className={s.msStack}>
                        <span className={s.msName}>{r.msName}</span>
                        {r.msLine && (
                          <span className={s.msLine} style={{ color: r.msColor }}>
                            {r.msLine}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={s.attention}>
                      <span className={s.attentionText}>{r.attention}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {view === 'progress' && (
            <Table>
              <thead>
                <tr>
                  <Th>{t('Project')}</Th>
                  <Th>{t('Status')}</Th>
                  <Th>{t('Stage deliverables')}</Th>
                  <Th>{t('Progress')}</Th>
                  <Th>{t('SPI')}</Th>
                  <Th>{t('Baseline finish')}</Th>
                  <Th>{t('Forecast finish')}</Th>
                  <Th>{t('Float')}</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.code}>
                    <td>
                      <ProjectCell row={r} />
                    </td>
                    {statusCell(r)}
                    <DeliverablesCell row={r} stageLabel={labelOf(r.stage)} canEdit={canEditRow(r.code)} />
                    <td>
                      <ProgressBar variant="inline" value={r.progress} label={r.progressPct} labelSize="sm" />
                    </td>
                    <td className={s.num} style={{ color: r.spiColor }}>
                      {r.spiText}
                    </td>
                    <td className={s.numNowrap}>{r.finishPlanned}</td>
                    <td className={s.numNowrap} style={{ color: r.finishColor }}>
                      {r.finishForecast}
                    </td>
                    <td className={s.num} style={{ color: r.finishColor }}>
                      {r.floatText}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {view === 'budget' && (
            <Table>
              <thead>
                <tr>
                  <Th>{t('Project')}</Th>
                  <Th>{t('Status')}</Th>
                  <Th align="right">{t('Budget')}</Th>
                  <Th align="right">{t('Spent')}</Th>
                  <Th align="right">{t('Earned')}</Th>
                  <Th>{t('CPI')}</Th>
                  <Th align="right">{t('EAC')}</Th>
                  <Th align="right">{t('Variance at completion')}</Th>
                  <Th>{t('Spent vs budget')}</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.code}>
                    <td>
                      <ProjectCell row={r} />
                    </td>
                    {statusCell(r)}
                    <td className={s.numRight}>{r.budgetText}</td>
                    <td className={s.numRight}>{r.spentText}</td>
                    <td className={s.numRight}>{r.earnedText}</td>
                    <td className={s.num} style={{ color: r.cpiColor }}>
                      {r.cpiText}
                    </td>
                    <td className={s.numRight}>{r.eacText}</td>
                    <td className={s.numRight} style={{ color: r.vacColor }}>
                      {r.vacText}
                    </td>
                    <td>
                      <ProgressBar variant="inline" value={r.spent} color={r.spentColor} label={r.spentPct} labelSize="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <ForceDialog request={force} onCancel={cancelForce} onConfirm={confirmForce} />
      <MoveDialog request={moveReq} onCancel={cancelForce} onConfirm={confirmMove} />
    </div>
  );
}
