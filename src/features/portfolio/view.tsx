// Shared view helpers of the portfolio screens. Server-compatible.
import { Briefcase, ClockCountdown, Coins, Gauge, Lightning, Receipt, Timer, TrendUp, UsersThree, Warning } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import { Tag, type TagTone } from '@/components/ds/Tag';
import { KpiTile } from '@/components/app/Kpi';
import { LO, OK } from '@/components/app/tones';
import type { Health } from '@/domain/health';
import { healthLabel, type AlertIcon, type KpiIcon, type KpiView, type Tint } from '@/domain/portfolio';
import type { Lang, T } from '@/i18n/translate';
import { projectLabelText } from '@/i18n/data-text';

/** Indicator tints → tokens (LO = accent-300, OK = text). */
export const TINT: Record<Tint, string> = {
  lo: LO,
  ok: OK,
  accent: 'var(--color-accent)',
  n300: 'var(--color-neutral-300)',
  n400: 'var(--color-neutral-400)',
  n500: 'var(--color-neutral-500)',
  n600: 'var(--color-neutral-600)',
};

export const KPI_ICON: Record<KpiIcon, Icon> = { briefcase: Briefcase, receipt: Receipt, 'trend-up': TrendUp, gauge: Gauge, timer: Timer, warning: Warning };
export const ALERT_ICON: Record<AlertIcon, Icon> = { lightning: Lightning, coins: Coins, 'users-three': UsersThree, 'clock-countdown': ClockCountdown };

const HEALTH_TAG_TONE: Record<Health, TagTone> = { off_track: 'accent', at_risk: 'outline', on_track: 'neutral' };

/**
 * "#026 · Harbor Line Terminal Expansion" (pname) with the name translated on its own: translating the joined
 * label splits names containing " — " ("ERP Migration — Phase 2") and leaves them in English.
 */
/** "#026 · Harbor Line Terminal Expansion": the name as typed (R-148, or its seeded demo entry). */
export const projectName = (p: { displayId: string; name: string }, lang: Lang) => projectLabelText(p, lang);

/** Health tag as the prototype renders it on these screens: no health → "—" in a neutral tag. */
export function HealthBadge({ health, t, nowrap = true }: { health: Health | null; t: T; nowrap?: boolean }) {
  return (
    <Tag tone={health ? HEALTH_TAG_TONE[health] : 'neutral'} nowrap={nowrap}>
      {t(healthLabel(health))}
    </Tag>
  );
}

/** KPI tile from a domain KpiView (label/value/sub translated here; value in LO when `alert`). */
export function Kpi({ k, t, size }: { k: KpiView; t: T; size: 'md' | 'lg' }) {
  return (
    <KpiTile
      label={t(k.label)}
      value={t(k.value)}
      sub={t(k.sub)}
      color={k.alert ? LO : OK}
      icon={k.icon ? KPI_ICON[k.icon] : undefined}
      size={size}
    />
  );
}
