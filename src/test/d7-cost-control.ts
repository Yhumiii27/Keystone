// Test helper of delivery 7, lot cost-control (not shipped): the figures of the six seeded projects with activities once their
// progress, actual cost and SPI are computed from Keystone data at the data date (R-073; owner decisions C-2a "EV = avancement
// × budget", A-12 "formules sur les données", A-15) instead of the prototype's seeded values, and a patch for the golden
// fixtures generated from the prototype (*.golden.json) that show them. Values are those of src/server/dal/cost-control.test.ts.
import { HEALTH_LABEL, HEALTH_TAG, type Health } from '@/domain/health';

/** Health of the six projects (was: HLT-026 at risk, NDC-031 on track, RCF-019 off track, ERP-202 / WSA-044 on track, MSR-012 at risk). */
export const D7_HEALTH: Record<string, Health> = {
  'HLT-026': 'off_track', 'NDC-031': 'at_risk', 'RCF-019': 'at_risk', 'ERP-202': 'on_track', 'WSA-044': 'on_track', 'MSR-012': 'on_track',
};

/** Rounded % complete (was 64 · 51 · 82 · 45 · 27 · 91). */
export const D7_PROGRESS_PCT: Record<string, number> = { 'HLT-026': 63, 'NDC-031': 46, 'RCF-019': 77, 'ERP-202': 52, 'WSA-044': 8, 'MSR-012': 92 };

/** Actual cost, k€ (was 3360 · 1020 · 1210 · 410 · 880 · 550). */
export const D7_ACTUAL: Record<string, number> = { 'HLT-026': 3360, 'NDC-031': 884, 'RCF-019': 1076, 'ERP-202': 457, 'WSA-044': 247, 'MSR-012': 553 };

/** SPI rounded to 2 decimals (was 0.90 · 0.98 · 0.84 · 1.01 · 1.06 · 0.95). */
export const D7_SPI: Record<string, number> = { 'HLT-026': 0.82, 'NDC-031': 0.96, 'RCF-019': 0.91, 'ERP-202': 1, 'WSA-044': 1, 'MSR-012': 0.99 };

const FR: Record<string, string> = { 'On track': 'Conforme', 'At risk': 'À risque', 'Off track': 'Hors trajectoire' };
const LABELS = new Map<string, Health>(
  (Object.keys(HEALTH_LABEL) as Health[]).flatMap((h) => [[HEALTH_LABEL[h], h], [FR[HEALTH_LABEL[h]], h]] as [string, Health][]),
);
const TAGS = new Set(Object.values(HEALTH_TAG));

/**
 * Deep copy of a golden structure where every object carrying one of the six project codes (`code`, or `id`) and a health label
 * (`health`, EN or FR) shows the delivery 7 health instead — with its tag class (`healthClass`) or tone when present. Objects
 * without a health (pipeline projects: '') are left as they are.
 */
export function withD7Health<T>(golden: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) as Record<string, unknown>;
    const code = typeof o.code === 'string' ? o.code : typeof o.id === 'string' ? o.id : null;
    const now = code ? D7_HEALTH[code] : undefined;
    if (now && typeof o.health === 'string' && LABELS.has(o.health)) {
      const fr = FR[o.health] === undefined;
      o.health = fr ? FR[HEALTH_LABEL[now]] : HEALTH_LABEL[now];
      if (typeof o.healthClass === 'string' && TAGS.has(o.healthClass)) o.healthClass = HEALTH_TAG[now];
    }
    return o;
  };
  return walk(golden) as T;
}
