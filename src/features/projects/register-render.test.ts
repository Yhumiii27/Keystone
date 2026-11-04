// Static render smoke test of the Projects register island (docs/spec/03 §5.1–§5.6): the three views render the
// prototype's columns and the seeded HLT-026 values, the slider exposes its ARIA contract, and the read-only
// variant drops the "Move to" menus.
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/portfolio/projects', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { withoutK14Demo } from '@/test/k14';
import { getRegisterData } from '@/server/dal/projects-register';
import { scheduleQualitySummaries, type ScheduleQualitySummary } from '@/server/dal/schedule-quality';
import type { RegisterView, StageCode } from '@/domain/lifecycle';
import { ProjectsRegister } from './register';
import { buildRegisterModel } from './register-model';

async function render(
  lang: Lang, view: RegisterView, opts: { status?: StageCode | null; q?: string; canEdit?: boolean; quality?: Record<string, ScheduleQualitySummary>; links?: boolean } = {},
) {
  const m = buildRegisterModel({ ...(await getRegisterData()), scheduleQuality: opts.quality, scheduleLinks: opts.links }, null, makeT(lang), lang);
  const el = h(ProjectsRegister, {
    rows: m.rows, stages: m.stages, zoneEmpty: m.zoneEmpty, canEdit: opts.canEdit ?? true, initialView: view,
    initialStatus: opts.status ?? null, initialQuery: opts.q ?? '',
  });
  return renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
}

const headers = (html: string) => [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);

describe('ProjectsRegister render', () => {
  beforeAll(async () => {
    setDb(await withoutK14Demo(await openDatabase())); // K-14: compared with the prototype without the APM-008 rows (src/test/k14.ts)
  }, 60_000);

  it('health view (EN)', async () => {
    const html = await render('en', 'health');
    // S-23: the "Schedule quality" column (DCMA checks that fail; "—" without the page's summaries).
    expect(headers(html)).toEqual(['Project', 'Status', 'Health', 'SPI', 'CPI', 'Next milestone', 'Schedule quality', 'Attention']);
    expect(html).toContain('All projects · 17');
    expect(html).toContain('Click a status to move it');
    expect(html).toContain('#026 · Harbor Line Terminal Expansion');
    expect(html).toContain('href="/projects/HLT-026/plan"');
    expect(html).toContain('title="Open project · Plan — WBS"');
    // R-185: Harbor Line supplies its EMP and three MEMU (demo equipment lines; the prototype: "EMP").
    expect(html).toContain('HAV004 · DAS 2 · 1 × EMP · 3 × MEMU');
    // Delivery 7 (R-073, C-2a): SPI / CPI computed from the activities and BL1 (were 0.90 / 0.91).
    expect(html).toContain('SPI 0.82 · CPI 0.89 · Structure topped out · Late · 27 d slip');
    expect(html).toMatch(/role="slider"[^>]*aria-valuemin="0"[^>]*aria-valuemax="13"[^>]*aria-valuenow="0"[^>]*aria-valuetext="All projects"/);
    expect(html).toContain('Drag the cursor to filter by stage');
    expect(html).toContain('placeholder="Search projects"');
  });

  it('S-23: the schedule quality of each live project (DCMA checks that fail), linked to its Schedule', async () => {
    const quality = await scheduleQualitySummaries(['HLT-026', 'NOPE-000']);
    expect(Object.keys(quality)).toEqual(['HLT-026']);
    const q = quality['HLT-026'];
    expect(q.failed).toBe(q.failedChecks.length);
    expect(q.failed).toBeGreaterThan(0);
    expect(q.applicable).toBeGreaterThanOrEqual(q.failed);
    const fr = await render('fr', 'health', { quality, links: true });
    expect(headers(fr)).toContain('Qualité du planning');
    expect(fr).toContain(`Non conforme · ${q.failed}`);
    expect(fr).toContain('href="/projects/HLT-026/schedule"');
    expect(fr).toContain(`Contrôles DCMA non conformes · ${q.failed} / ${q.applicable} applicables · ${q.failedChecks.map((n) => `#${n}`).join(', ')}`);
    // Without the Schedule screen: the counter without the link.
    const noLink = await render('en', 'health', { quality, links: false });
    expect(noLink).toContain(`Fail · ${q.failed}`);
    expect(noLink).not.toContain('href="/projects/HLT-026/schedule"');
  }, 60_000);

  it('progress view (FR) with the Fabrication filter', async () => {
    const html = await render('fr', 'progress', { status: 'fabrication_assemblage' });
    expect(headers(html)).toEqual(['Projet', 'Statut', 'Livrables de l’étape', 'Avancement', 'SPI', 'Fin de référence', 'Fin prévisionnelle', 'Marge']);
    expect(html).toContain('Projets Fabrication &amp; Assemblage · 1');
    expect(html).toContain('2 / 4');
    expect(html).toContain('18 déc. 2026');
    expect(html).toContain('14 janv. 2027');
    expect(html).toContain('−27 j');
    expect(html).toContain('Déplacez le curseur ou utilisez ← → pour changer d’état');
    expect(html).toContain('1 projet · Structure, montage mécanique, câblage');
  });

  it('budget view (EN) and search', async () => {
    const html = await render('en', 'budget', { q: 'harbor' });
    expect(headers(html)).toEqual(['Project', 'Status', 'Budget', 'Spent', 'Earned', 'CPI', 'EAC', 'Variance at completion', 'Spent vs budget']);
    expect(html).toContain('All projects · 1');
    // R-073: earned value = progress × BAC from the activities (€3.07M → €3.01M), EAC and VAC follow.
    for (const v of ['€4.80M', '€3.36M', '€3.01M', '€5.37M', '−€566k', '70%']) expect(html).toContain(v);
  });

  it('read-only (outside) drops the status menus', async () => {
    const edit = await render('en', 'health');
    const ro = await render('en', 'health', { canEdit: false });
    expect(edit).toContain('aria-haspopup');
    expect(ro).not.toContain('aria-haspopup');
  });
});
