// Skills matrix body (docs/spec/06 §3, template 1452–1474): KPIs, skill filter chips (`?filter=<skill index>`),
// people × skills dot matrix and the coverage list. Server Component.
import { Certificate } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties } from 'react';
import { Avatar } from '@/components/app/Badges';
import { FilterBar, FilterChips, FilterGroup, FilterLabel, FilterNote } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { FlexRow, SectionCard } from '@/components/app/SectionCard';
import { LO, OK } from '@/components/app/tones';
import { cx } from '@/components/ds/cx';
import { OPEN_REQUESTS_LEVEL4, filterBySkill, levelDots, levelTone, skillCoverage, skillKpis, type LevelTone } from '@/domain/hr';
import type { T } from '@/i18n/translate';
import type { SkillsMatrix } from '@/server/dal/hr';
import s from './hr.module.css';

const DOT: Record<LevelTone, string | undefined> = { 'accent-400': s.lv4, 'accent-600': s.lv3, 'accent-800': s.lv2, 'neutral-800': s.lv1, none: undefined };

/** `?filter=` link of a chip (null = "Everyone"). */
export const skillFilterHref = (base: string, skill: number | null) => (skill == null ? base : `${base}?filter=${skill}`);

export function SkillsView({ data, filter, base, t }: { data: SkillsMatrix; filter: number | null; base: string; t: T }) {
  const names = data.skills.map((x) => x.name);
  const coverage = skillCoverage(names, data.people);
  const k = skillKpis(coverage, data.people.filter((p) => p.certifications.length > 0).length);
  const rows = filterBySkill(data.people, filter);
  const chips = [
    { value: 'all', label: t('Everyone'), href: skillFilterHref(base, null) },
    ...names.map((n, i) => ({ value: String(i), label: t(n), href: skillFilterHref(base, i) })),
  ];

  return (
    <>
      <KpiGrid min={150}>
        <KpiTile label={t('Skill families')} value={k.families} sub={t('Levels 1–5 · certifications noted')} color={OK} />
        <KpiTile label={t('Single-expert skills')} value={k.singleExpert} sub={t('Fewer than 2 people at level ≥4')} color={k.singleExpert > 0 ? LO : OK} />
        <KpiTile label={t('Certifications')} value={k.certifications} sub={t('Tracked with expiry in Lucca')} color={OK} />
        {/* TODO(db): no source for "requests needing level ≥4" (06 OQ4, 00 A-12) — prototype constant. */}
        <KpiTile label={t('Open requests needing level ≥4')} value={OPEN_REQUESTS_LEVEL4.value} sub={t(OPEN_REQUESTS_LEVEL4.sub)} color={OK} />
      </KpiGrid>
      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel icon={Certificate}>{t('Skill')}</FilterLabel>
          <FilterChips options={chips} value={filter == null ? 'all' : String(filter)} label={t('Skill')} />
        </FilterGroup>
        <FilterNote>{t('Filter shows people at level ≥3')}</FilterNote>
      </FilterBar>
      <FlexRow>
        <SectionCard flex="2.4 1 680px" scroll title={t('People × skills · level 1–5')}>
          <div className={s.matrix} style={{ '--skill-cols': names.length } as CSSProperties} role="table" aria-label={t('People × skills · level 1–5')}>
            <div className={s.row} role="row">
              <div role="columnheader" />
              {names.map((n) => (
                <div key={n} className={s.skillHead} role="columnheader">
                  {t(n)}
                </div>
              ))}
            </div>
            {rows.map((p) => (
              <div key={p.name} className={s.row} role="row">
                <div className={cx(s.person, s.matrixPerson)} role="rowheader">
                  <Avatar initials={p.initials} size={28} fontSize={11} />
                  <div className={s.personText}>
                    <span className={s.personName}>{p.name}</span>
                    <span className={s.personSub}>{p.certText ?? '—'}</span>
                  </div>
                </div>
                {names.map((n, i) => {
                  const lv = p.levels[i] || 0;
                  const title = t(`${n} · level ${lv}`);
                  return (
                    <div key={n} className={s.skillCell} title={title} role="cell" aria-label={title}>
                      {levelDots(lv).map((on, d) => (
                        <span key={d} className={cx(s.dot, on && DOT[levelTone(lv)])} />
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard flex="1 1 260px" gap={6} title={t('Coverage')} subtitle={t('Experts = level 4–5 · flagged under 2')}>
          {coverage.map((c) => (
            <div key={c.name} className={s.coverageRow}>
              <span>{t(c.name)}</span>
              <span className={cx(s.coverageText, c.gap && s.lo)}>{t(c.text)}</span>
            </div>
          ))}
        </SectionCard>
      </FlexRow>
    </>
  );
}
