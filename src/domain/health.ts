// Project health (healthOf, design line 3916): min(CPI-like ratio, SPI) against fixed thresholds.
export type Health = 'on_track' | 'at_risk' | 'off_track';

/** EN source labels (render through t()). FR: Conforme / À risque / Hors trajectoire. */
export const HEALTH_LABEL: Record<Health, string> = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };

/** Tag class per health (mono-accent tones, docs/spec/00 §7.14). */
export const HEALTH_TAG: Record<Health, string> = { on_track: 'tag tag-neutral', at_risk: 'tag tag-outline', off_track: 'tag tag-accent' };

export function healthOf(p: { budget: number; actual: number; progress: number; spi?: number | null }): Health | null {
  if (!p.actual || !p.progress) return null;
  const m = Math.min((p.budget * p.progress) / p.actual, p.spi || 1);
  return m < 0.9 ? 'off_track' : m < 0.97 ? 'at_risk' : 'on_track';
}
