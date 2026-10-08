// Static render of the Plan page (HLT-026, seeded in-memory DB) in both views and languages: toolbar, KPI tiles,
// card headers, table columns and rows, collapse defaults, selection highlight, read-only mode and the empty
// state of a project without planning data. Shell pieces (PageHeader) and the session are mocked.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const state = { lang: 'fr' as 'fr' | 'en', canEdit: true, role: 'director', cookie: undefined as string | undefined };
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/plan', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw new Error('404'); } }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: state.lang, t: makeT(state.lang) }) };
});
vi.mock('@/server/project-context', async () => {
  const { getProject } = await import('@/server/dal/projects');
  return {
    getProjectContext: async (code: string) => ({ project: await getProject(code), viewer: { role: state.role }, canEdit: () => state.canEdit }),
  };
});
vi.mock('@/components/app/shell/page-header', async () => {
  const { createElement } = await import('react');
  return { PageHeader: ({ primary }: { primary?: unknown }) => createElement('header', { 'data-testid': 'ph' }, primary as never) };
});

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PlanPage from '@/app/(app)/projects/[code]/plan/page';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
async function render(code: string, sp: Record<string, string> = {}) {
  const el = await PlanPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) });
  return renderToStaticMarkup(h(I18nProvider, { lang: state.lang, children: el }));
}

describe('Plan page render', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('Progress view (default, FR): toolbar, KPIs, columns, roll-ups, collapse, highlight, primary', async () => {
    state.lang = 'fr';
    const html = await render('HLT-026');
    const tx = text(html);
    for (const s of [
      'Vue', 'Structure', 'Avancement', 'Calendrier', 'Chantier 6j · 10h', 'Référence', 'BL1 · 12 mars 2026', 'Date de référence', '25 sept. 2026',
      'Replanifier', 'Fixer la référence',
      'Avancement global', '63 %', 'pondéré par le budget · date d’état 25 sept. 2026', 'Terminée', '10 / 21', 'En cours', '5 en retard',
      'Non démarré', 'Prochain démarrage · A1260 · 05 oct.', 'Flottement projet', '−27 j', 'Fin 14 janv. 2027 vs BL1 18 déc. 2026',
      'Mise à jour de l’avancement', 'Saisissez le % d’avancement par activité', 'Date de référence · 25 sept. 2026',
      'Début', 'Fin BL', 'Écart', 'Statut', 'Responsable', 'À faire', 'Mettre à jour l’avancement',
      'Harbor Line', '82%', '2/25', '-27 j', '-39 j', '17 août A', '09 oct.', '0/5',
    ])
      expect(tx).toContain(s);
    // 1.1–1.3 collapsed by default: their activities are not rendered; 1.4 is.
    expect(html).not.toContain('>A1010<');
    expect(html).toContain('>A1250<');
    expect(html).toContain('href="/projects/HLT-026/plan?act=A1250"');
    // A1250 highlighted by default (prototype `sel`).
    expect(html.match(/selected/g)?.length).toBeGreaterThan(0);
    expect(tx).not.toContain('Démarrer');
  });

  it('Structure view (EN): KPIs, columns, inputs, row actions, add work package', async () => {
    state.lang = 'en';
    const html = await render('HLT-026', { view: 'structure' });
    const tx = text(html);
    for (const s of [
      'Work packages', '21 activities · €4.65M', '5 on the critical path', 'Relationships', 'FS 25 · SS 3 · FF 2', 'Constraints', '1 violated',
      'Baseline', 'BL1', 'Set 12 Mar 2026 · 21 activities', 'Work breakdown structure', 'Add work package', 'Budget k€', 'Predecessors',
      'Constraint', 'Actions', 'Add activity', '4 act.', '€1.02M', '€4.65M',
    ])
      expect(tx).toContain(s);
    expect(html).toContain('value="A1240 FS, A1220 FS+10, A1230 FF+5"');
    expect(html).toContain('title="Move up"');
    expect(html).toContain('title="Remove"');
    expect(html).toContain('href="/projects/HLT-026/plan?view=structure&amp;act=A1250"');
    // ARIA table: 8 cells per row; work-package name inputs are labelled as such.
    expect(html).toContain('aria-label="Work package" value="Steel structure"');
    const firstRow = html.split('role="row"')[2];
    expect(firstRow.match(/role="cell"/g)?.length).toBe(8);
  });

  it('deep link ?act= expands the activity’s work package; ?sel= keeps the highlight', async () => {
    state.lang = 'en';
    const html = await render('HLT-026', { act: 'A1010' });
    expect(html).toContain('>A1010<');
    const sel = await render('HLT-026', { sel: 'A1410' });
    expect(sel).toContain('href="/projects/HLT-026/plan?view=structure&amp;sel=A1410"');
  });

  it('read-only: no inputs, no row actions, no primary, % shown as text', async () => {
    state.lang = 'en';
    state.canEdit = false;
    const html = await render('HLT-026', { view: 'structure' });
    expect(html).not.toContain('<input');
    expect(html).not.toContain('title="Remove"');
    // Read-only cells show the display strings (`preds` with "d", duration "40d").
    expect(text(html)).toContain('A1240 FS, A1220 FS+10d, A1230 FF+5d');
    expect(text(html)).toContain(' 40d ');
    expect(text(html)).not.toContain('Add work package');
    const p = await render('HLT-026');
    expect(p).not.toContain('Mark complete');
    expect(text(p)).not.toContain('Update progress');
    expect(text(p)).toContain('72%');
    state.canEdit = true;
  });

  it('cookie collapse map is honoured', async () => {
    state.lang = 'en';
    state.cookie = encodeURIComponent(JSON.stringify({ '1.4': true }));
    const html = await render('HLT-026');
    expect(html).toContain('>A1010<');
    expect(html).not.toContain('>A1250<');
    state.cookie = undefined;
  });

  it('project without planning data → empty state, no other project’s data', async () => {
    state.lang = 'fr';
    const html = text(await render('ALP-021'));
    expect(html).toContain('Aucune activité enregistrée pour ce projet');
    expect(html).not.toContain('A1250');
  });
});
