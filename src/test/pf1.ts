// PF-1 (owner, 3 Nov 2026): the portfolio schedule has three categories — in progress, pipeline, in warranty. The prototype's
// golden values (src/domain/pfplan.golden.json) have two: projects in warranty (stage Garantie) sit with the projects in
// progress. `pf1Zone` turns a golden zone into the PF-1 shape: the warranty codes leave the "In progress" group for an
// "In warranty" group after "Pipeline", the "Projects in progress" tile loses them, a "Projects in warranty" tile follows the
// pipeline tile (always shown, 0 when the zone has none), and the stage segment gets "In warranty". The budget of the two
// tiles adds up to the prototype's "in progress" budget (checked), so nothing else of the golden values changes.
/* eslint-disable @typescript-eslint/no-explicit-any -- the golden JSON is untyped, as in the tests that read it */
import { expect } from 'vitest';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';

export interface Pf1Row {
  code: string;
  stage: string;
  budget: number;
  pipeline: boolean;
}

/** Stage segment labels with "In warranty" added (PF-1). */
export const pf1SegCtl = (segCtl: string[], t: T) => [...segCtl, t('In warranty')];

/** The golden zone (`kpis`, `groups`, `filters`) in the PF-1 shape, from the rows the model reads (code, stage, budget). */
export function pf1Zone(gz: any, rows: Pf1Row[], lang: Lang, t: T) {
  const execGroup = gz.groups.find((g: any) => g.key === 'exec') ?? { codes: [] };
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const warr: string[] = (execGroup?.codes ?? []).filter((c: string) => byCode.get(c)?.stage === 'garantie');
  const exec: string[] = execGroup.codes.filter((c: string) => !warr.includes(c));
  const sum = (codes: string[]) => codes.reduce((a, c) => a + (byCode.get(c)?.budget ?? 0), 0);
  // The two tiles split the prototype's "in progress" budget.
  expect(money(sum(exec) + sum(warr), lang)).toBe(gz.kpis[0].sub);
  const kpis = [
    { ...gz.kpis[0], value: exec.length, sub: money(sum(exec), lang) },
    gz.kpis[1],
    { label: t('Projects in warranty'), value: warr.length, sub: money(sum(warr), lang), color: gz.kpis[1].color },
    ...gz.kpis.slice(2),
  ];
  const groups = [
    ...(exec.length ? [{ ...execGroup, count: exec.length, codes: exec }] : []),
    ...gz.groups.filter((g: any) => g.key !== 'exec'),
    ...(warr.length ? [{ key: 'warr', label: t('In warranty'), count: warr.length, codes: warr }] : []),
  ];
  const keys = groups.map((g) => g.key);
  return {
    ...gz,
    kpis,
    groups,
    filters: { all: keys, exec: exec.length ? ['exec'] : [], pipe: gz.groups.some((g: any) => g.key === 'pipe') ? ['pipe'] : [], warr: warr.length ? ['warr'] : [] },
  };
}
