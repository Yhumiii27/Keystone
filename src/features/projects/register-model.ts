// Projects register view model (docs/spec/03 §5.4–§5.6): turns the register data (DAL) into serialisable,
// translated rows for the client island. Pure — runs in the page (Server Component) and in tests.
import { screenHref } from '@/config/screens';
import { BL1_STAGE_DELIVERABLE } from '@/domain/baseline-policy';
import { displayOfIso } from '@/server/db/codes';
import { HEALTH_LABEL, type HealthThresholds } from '@/domain/health';
import { isLiveRow, type SearchableProject, type StageCode } from '@/domain/lifecycle';
import { projectIndicators, type Tint } from '@/domain/portfolio';
import { healthTone, type Tone } from '@/components/app/tones';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import type { StageHistoryRow, StageInfo } from '@/server/dal/lifecycle';
import type { ProjectRow } from '@/server/dal/projects';
import type { ScheduleSummaries, StageChecklists } from '@/server/dal/projects-register';
import type { ZoneKey } from '@/server/session';
import { dataText } from '@/i18n/data-text';

/** A stage as the client needs it (labels already translated; LIFE and GATES are French domain text). */
export interface StageView {
  code: StageCode;
  label: string;
  /** ST_SHORT (slider). */
  short: string;
  /** LIFE (selected-stage sub-line). */
  description: string;
  /** GATES — entry gate shown in the "Move to" menu ('' for Initiative). */
  gate: string;
  /** Deactivated in Settings › Project statuses (A-14): "Move to" offers the next active stage instead. */
  inactive?: true;
}

export interface RegisterRow {
  code: string;
  stage: StageCode;
  search: SearchableProject;
  /** "#026 · Harbor Line Terminal Expansion" (translated). */
  name: string;
  /** Plan — WBS of the project; null when it has no planning data (canOpen). */
  openHref: string | null;
  isNew: boolean;
  /** "HAV004 · DAS 2 · EMP" ("—" when unknown). */
  idLine: string;
  /** "R. Aubert · Port authority · Jan 2026 → Dec 2026" (translated). */
  metaLine: string;
  health: { label: string; tone: Tone };
  spiText: string;
  spiColor: string;
  cpiText: string;
  cpiColor: string;
  msName: string;
  msLine: string;
  msColor: string;
  attention: string;
  /**
   * Deliverables of the current stage (STAGE_DELIVS) and their ticks. `lock` (delivery 8, R-054): « Planning BL1 posé » follows
   * BL1 — read-only, with the reason (translated).
   */
  delivs: { label: string; done: boolean; lock?: string }[];
  /** Stage history, newest first. */
  history: { stage: string; date: string; forced: boolean; why: string }[];
  /** Bounds of the effective date of the next stage change (L-4c, ISO): the latest change and today (the data date). */
  dateBounds: { previous: string | null; today: string };
  progress: number;
  progressPct: string;
  finishPlanned: string;
  finishForecast: string;
  finishColor: string;
  floatText: string;
  budgetText: string;
  spentText: string;
  earnedText: string;
  eacText: string;
  vacText: string;
  vacColor: string;
  /** Spent / budget (0..∞) and its label ("70%"). */
  spent: number;
  spentPct: string;
  spentColor: string;
}

export interface RegisterModel {
  rows: RegisterRow[];
  stages: StageView[];
  /** A zone is selected and has no project ("No project in this zone for this view"). */
  zoneEmpty: boolean;
}

export interface RegisterInput {
  projects: ProjectRow[];
  stages: StageInfo[];
  checklists: StageChecklists;
  history: Record<string, StageHistoryRow[]>;
  schedules: ScheduleSummaries;
  /** Stages deactivated in Settings › Project statuses (A-14). */
  inactiveStages?: readonly StageCode[];
  /** Projects with a WBS but no cost controls yet (wizard template, A-2): their plan opens too. */
  planned?: readonly string[];
  /** Settings health thresholds (A-13): CPI / SPI colours and attention items. Default 0.97 / 0.90. */
  thresholds?: HealthThresholds;
  /** Data date per project (ISO): "today" of the stage-change effective date (L-4c). Default: `today`. */
  dataDates?: Record<string, string>;
  /** Business date (ISO, R-013): the data date of a project without one. */
  today: string;
  /** Delivery 8 (R-054): BL1 per project (set, ISO date) — « Planning BL1 posé » follows it. */
  bl1?: Record<string, { set: boolean; setOn: string | null }>;
}

/** R-054 (L-2 "a"): the hint of the read-only « Planning BL1 posé » tick. */
function bl1Lock(b: { set: boolean; setOn: string | null } | undefined, t: T): string {
  if (!b?.set) return t('Ticked when BL1 is set (Plan › Set baseline, up to BL1)');
  return b.setOn ? `${t('Ticked by BL1')} · ${t(displayOfIso(b.setOn))}` : t('Ticked by BL1');
}

/** Indicator tints → CSS colours (LO = accent-300, OK = text). */
const TINT: Record<Tint, string> = {
  lo: 'var(--color-accent-300)',
  ok: 'var(--color-text)',
  accent: 'var(--color-accent)',
  n300: 'var(--color-neutral-300)',
  n400: 'var(--color-neutral-400)',
  n500: 'var(--color-neutral-500)',
  n600: 'var(--color-neutral-600)',
};

export function buildRegisterModel(data: RegisterInput, zone: ZoneKey | null, t: T, lang: Lang): RegisterModel {
  const stageByCode = new Map(data.stages.map((s) => [s.code, s]));
  const inZone = data.projects.filter((p) => !zone || p.zone === zone);
  const planned = new Set(data.planned ?? []);

  const rows = inZone.map((p): RegisterRow => {
    const live = isLiveRow(p.stage, p.health);
    const sched = data.schedules[p.code] ?? null;
    const ind = projectIndicators(
      p,
      sched && { start: sched.start, floatDays: sched.floatDays, finishText: sched.finishText, baselineText: sched.baselineText, milestones: sched.milestones },
      live,
      lang,
      data.thresholds,
    );
    const st = stageByCode.get(p.stage);
    const ticks = data.checklists[p.code]?.[p.stage] ?? [];
    const number = p.displayId !== p.code ? p.displayId : '';
    return {
      code: p.code,
      stage: p.stage,
      search: { names: [p.name, dataText(p.name, lang)], code: p.code, number, analytic: p.analytic ?? '', machineType: p.machineType ?? '' },
      name: `${p.displayId} · ${dataText(p.name, lang)}`,
      openHref: p.hasData || planned.has(p.code) ? screenHref('plan', { code: p.code }) : null,
      isNew: p.isNew,
      idLine: `${p.analytic ?? '—'} · ${p.das ? 'DAS ' + p.das : '—'} · ${p.machineType ?? '—'}`,
      metaLine: `${p.pm} · ${dataText(p.client, lang)} · ${t(`${p.start} → ${p.finish}`)}`,
      health: live && p.health ? { label: t(HEALTH_LABEL[p.health]), tone: healthTone(p.health) } : { label: '—', tone: 'muted' },
      spiText: ind.spiText,
      spiColor: TINT[ind.spiTint],
      cpiText: ind.cpiText,
      cpiColor: TINT[ind.cpiTint],
      msName: ind.msName === '—' ? '—' : dataText(ind.msName, lang),
      msLine: ind.msLine ? t(ind.msLine) : '',
      msColor: TINT[ind.msTint],
      attention: ind.attention.length ? ind.attention.map((a) => t(a)).join(' · ') : '—',
      delivs: (st?.deliverables ?? []).map((label, i) => ({
        label: t(label), done: !!ticks[i],
        ...(p.stage === BL1_STAGE_DELIVERABLE.stage && i === BL1_STAGE_DELIVERABLE.position ? { lock: bl1Lock(data.bl1?.[p.code], t) } : {}),
      })),
      history: (data.history[p.code] ?? [])
        .slice()
        .reverse()
        .map((h) => ({ stage: t(h.label), date: t(h.date), forced: h.mode === 'forced', why: h.reason })),
      dateBounds: { previous: data.history[p.code]?.at(-1)?.dateIso ?? null, today: data.dataDates?.[p.code] ?? data.today },
      progress: p.progress,
      progressPct: Math.round(p.progress * 100) + '%',
      finishPlanned: t(ind.finishPlanned),
      finishForecast: t(ind.finishForecast),
      finishColor: TINT[ind.finishTint],
      floatText: t(ind.floatText),
      budgetText: money(p.budget, lang),
      spentText: ind.spentText,
      earnedText: ind.earnedText,
      eacText: ind.eacText,
      vacText: ind.vacText,
      vacColor: TINT[ind.vacTint],
      spent: p.budget ? (p.actual || 0) / p.budget : 0,
      spentPct: ind.spentPct,
      spentColor: TINT[ind.spentTint],
    };
  });

  const inactive = new Set(data.inactiveStages ?? []);
  const stages = data.stages.map((s) => ({
    code: s.code,
    label: t(s.label),
    short: t(s.short),
    description: t(s.description),
    gate: s.gate ? t(s.gate) : '',
    ...(inactive.has(s.code) ? { inactive: true as const } : {}),
  }));

  return { rows, stages, zoneEmpty: !!zone && !inZone.length };
}
