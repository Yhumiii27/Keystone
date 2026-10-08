'use client';
// Prioritisation tab of Portfolio — prioritisation & capacity (docs/spec/03 §6.2–§6.4, template 2084–2117): KPI tiles,
// margin notice, "Ranking — active and pipeline" and the Weights card. The ranking, the shares and the KPI tiles
// recompute as weights are typed; a weight is saved for the viewer on blur, Enter or after a pause. Clicking a row
// selects it (`?sel=`, no other effect). Viewers outside the workspace see the weights as text.
import { LockSimple } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Callout } from '@/components/app/Callout';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { FlexRow, SectionCard } from '@/components/app/SectionCard';
import { LifecycleTag } from '@/components/app/StatusTag';
import { DotRating } from '@/components/charts/primitives/DotRating';
import { Input } from '@/components/ds/Field';
import { Table, Td, Th, Tr } from '@/components/ds/Table';
import { useToast } from '@/components/ds/Toast';
import { parseWeight, validWeight } from '@/domain/portfolio-finance';
import { useI18n } from '@/i18n/client';
import { setScoreWeightAction } from './actions';
import { pfT } from './i18n';
import { prioritisationView, weightOnLeave, weightText, type PrioritisationData, type RankRowView } from './model';
import s from './pfinance.module.css';

const N400 = 'var(--color-neutral-400)';
/** Save a typed weight after this pause (ms). */
const SAVE_PAUSE_MS = 800;

export interface PrioritisationBoardProps {
  data: PrioritisationData;
  canEdit: boolean;
  initialSel: string | null;
  /** Zone shown (zone bar): selecting another one clears the selected row (`pfSel: null`, docs/spec/03 §0.5). */
  zone?: string | null;
}

export function PrioritisationBoard({ data, canEdit, initialSel, zone = null }: PrioritisationBoardProps) {
  const { t: t0, lang } = useI18n();
  const t = pfT(t0, lang);
  const toast = useToast();
  const [drafts, setDrafts] = useState<string[]>(() => data.weights.map(weightText));
  const saved = useRef<number[]>(data.weights);
  const timers = useRef<(ReturnType<typeof setTimeout> | undefined)[]>([]);
  const [sel, setSel] = useState<string | null>(initialSel);
  const [selZone, setSelZone] = useState(zone);
  if (selZone !== zone) {
    setSelZone(zone);
    setSel(null);
  }
  const view = prioritisationView(data, drafts.map(parseWeight), t, lang, sel);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((x) => x && clearTimeout(x));
  }, []);

  /** Saves a typed weight. `final` (blur, Enter): a cleared field is 0 (`setW`: NaN → 0), an invalid value is
   *  refused and the field reverts; after a pause, an invalid or incomplete value ("", "1.5") is left alone while the
   *  viewer is still typing. */
  const commit = async (i: number, typed: string, final: boolean) => {
    clearTimeout(timers.current[i]);
    const raw = final ? weightOnLeave(typed) : typed;
    if (raw !== typed) setDrafts((d) => d.map((x, j) => (j === i ? raw : x)));
    const axis = data.axes[i].code;
    const v = validWeight(raw);
    if (v != null && v === saved.current[i]) return;
    if (v == null && !final) return;
    try {
      const r = await setScoreWeightAction(axis, raw);
      if ('error' in r) {
        toast.show(r.error);
        setDrafts((d) => d.map((x, j) => (j === i ? weightText(saved.current[i]) : x)));
        return;
      }
      saved.current = saved.current.map((x, j) => (j === i ? r.value : x));
    } catch {
      toast.show(t('The weight could not be saved'));
    }
  };

  const type = (i: number, raw: string) => {
    setDrafts((d) => d.map((x, j) => (j === i ? raw : x)));
    clearTimeout(timers.current[i]);
    timers.current[i] = setTimeout(() => void commit(i, raw, false), SAVE_PAUSE_MS);
  };

  const select = (code: string) => {
    const next = sel === code ? null : code;
    setSel(next);
    const u = new URL(window.location.href);
    if (next) u.searchParams.set('sel', next);
    else u.searchParams.delete('sel');
    window.history.replaceState(null, '', u.pathname + u.search);
  };

  return (
    <>
      <KpiGrid min={150}>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>
      {view.masked && (
        <Callout icon={LockSimple} role="note">
          {t('Margins are visible to directors and project managers only.')}
        </Callout>
      )}
      <FlexRow gap={14}>
        <SectionCard
          title={t('Ranking — active and pipeline')}
          hint={t('Score = Σ axis (1–5) × weight · pipeline projects compete with active ones for capacity')}
          flex="2.6 1 1070px"
          scroll
        >
          <Table size={13}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>{t('Project')}</Th>
                <Th>{t('Status')}</Th>
                <Th width="18%">{t('Score')}</Th>
                {data.axes.map((a) => (
                  <Th key={a.code}>{t(a.label)}</Th>
                ))}
                <Th align="right">{t('Budget')}</Th>
                <Th align="right">{t('Margin')}</Th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <RankRow key={r.code} r={r} onSelect={() => select(r.code)} />
              ))}
            </tbody>
          </Table>
        </SectionCard>
        <SectionCard title={t('Weights')} subtitle={t('Editable · the ranking recomputes live')} flex="1 1 250px">
          {view.weightRows.map((w, i) => (
            <div key={w.code} className={s.weight}>
              <span className={s.weightLabel}>{w.label}</span>
              <span className={s.weightPct}>{w.pct}</span>
              {canEdit ? (
                <Input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  alignRight
                  className={s.weightInput}
                  aria-label={w.label}
                  value={drafts[i]}
                  onChange={(e) => type(i, e.target.value)}
                  onBlur={(e) => void commit(i, e.target.value, true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commit(i, e.currentTarget.value, true);
                  }}
                />
              ) : (
                <span className={s.weightValue}>{weightText(data.weights[i])}</span>
              )}
            </div>
          ))}
          <span className={s.footnote}>{t('Axes and scale are defined in Settings · scores are entered at the Proposed stage and reviewed at each gate')}</span>
        </SectionCard>
      </FlexRow>
    </>
  );
}

function RankRow({ r, onSelect }: { r: RankRowView; onSelect: () => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      onSelect();
    }
  };
  return (
    <Tr selected={r.selected} onClick={onSelect} onKeyDown={onKeyDown} tabIndex={0} className={s.rankRow}>
      <Td numeric color={N400}>
        {r.rank}
      </Td>
      <Td>
        <div className={s.project}>
          <span className={s.projectName} title={r.name}>
            {r.name}
          </span>
          <span className={s.projectCode}>{r.code}</span>
        </div>
      </Td>
      <Td>
        <LifecycleTag status={r.stage} label={r.status} />
      </Td>
      <Td>
        <div className={s.score}>
          <div className={s.scoreTrack}>
            <div className={s.scoreFill} style={{ '--score-w': `${r.score}%` } as CSSProperties} />
          </div>
          <span className={s.scoreValue}>{r.score}</span>
        </div>
      </Td>
      {r.axes.map((a) => (
        <Td key={a.label}>
          <div className={s.axis} title={a.label}>
            <DotRating value={a.value} color="var(--color-accent-500)" empty="var(--color-neutral-800)" label={`${a.label} · ${a.value} / 5`} />
          </div>
        </Td>
      ))}
      <Td align="right" numeric nowrap>
        {r.budget}
      </Td>
      <Td align="right" numeric color={r.marginColor}>
        {r.marginText}
      </Td>
    </Tr>
  );
}
