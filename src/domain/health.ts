// Project health — ONE rule everywhere (chapter 4, A-13; healthOf, design line 3916). Overview, Projects, My projects,
// the world map, the page header and the exports all call `healthOf` with the thresholds of Settings › Project health
// rules (app_settings "health.thresholds", read by src/server/dal/health-thresholds.ts):
//   m = min(CPI clamped to [0.70, 1.25], SPI || 1)        CPI = budget × progress / actual
//   no actuals or no progress yet → no health (null, shown "—")
//   m < off → Off track · m < risk → At risk · else On track        (defaults: risk 0.97, off 0.90)
// The prototype computed health twice (the Overview with an unclamped CPI, 03 §0.4); the rebuild keeps one rule. With
// thresholds inside [0.70, 1.25] the clamp never changes a verdict — it only bounds outliers when Settings pushes a
// threshold outside that range. Everything a questionnaire answer may change is a named constant below.
import { HEALTH_DEFAULTS } from '@/server/db/codes';

export type Health = 'on_track' | 'at_risk' | 'off_track';

/** EN source labels (render through t()). FR: Conforme / À risque / Hors trajectoire. */
export const HEALTH_LABEL: Record<Health, string> = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };

/** Tag class per health (mono-accent tones, docs/spec/00 §7.14). */
export const HEALTH_TAG: Record<Health, string> = { on_track: 'tag tag-neutral', at_risk: 'tag tag-outline', off_track: 'tag tag-accent' };

/** Thresholds of the rule: At risk below `risk`, Off track below `off` (off < risk). */
export interface HealthThresholds {
  risk: number;
  off: number;
}

/** Settings defaults (SETTINGS0.health): at risk below 0.97, off track below 0.90 (A-13). */
export const DEFAULT_HEALTH_THRESHOLDS: Readonly<HealthThresholds> = { risk: HEALTH_DEFAULTS.risk, off: HEALTH_DEFAULTS.off };

/** CPI bounds of the health rule (A-13: the Projects / My projects clamp, now used everywhere). */
export const HEALTH_CPI_CLAMP = { min: 0.7, max: 1.25 } as const;

/** Inputs of the rule (ProjectRow subset; amounts in k€, progress 0–1). */
export interface HealthInput {
  budget: number;
  actual: number;
  progress: number;
  spi?: number | null;
}

/** CPI clamped to [0.70, 1.25]. */
export const clampHealthCpi = (cpi: number) => Math.min(HEALTH_CPI_CLAMP.max, Math.max(HEALTH_CPI_CLAMP.min, cpi));

/** The project has a health (actuals and physical progress recorded). */
export const hasHealth = (p: HealthInput) => !!p.actual && !!p.progress;

/** m = min(clamped CPI, SPI || 1); null when the project has no health yet. */
export function healthIndex(p: HealthInput): number | null {
  if (!hasHealth(p)) return null;
  return Math.min(clampHealthCpi((p.budget * p.progress) / p.actual), p.spi || 1);
}

/** Thresholds that can be used: anything invalid (not numbers in ]0, 2], off ≥ risk) falls back to the defaults. */
export function usableThresholds(t: Partial<HealthThresholds> | null | undefined): HealthThresholds {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 2;
  if (!t || !ok(t.risk) || !ok(t.off) || t.off >= t.risk) return { ...DEFAULT_HEALTH_THRESHOLDS };
  return { risk: t.risk, off: t.off };
}

/** Verdict of an index against the thresholds. */
export function healthOfIndex(m: number, th: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS): Health {
  return m < th.off ? 'off_track' : m < th.risk ? 'at_risk' : 'on_track';
}

/** Project health (A-13): the one rule, thresholds from Settings (defaults 0.97 / 0.90); null = no health yet. */
export function healthOf(p: HealthInput, th: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS): Health | null {
  const m = healthIndex(p);
  return m == null ? null : healthOfIndex(m, th);
}
