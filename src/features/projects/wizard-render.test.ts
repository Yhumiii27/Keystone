// New project wizard steps rendered (static markup) with the chapter-4 fields (A-2 / L-3): PM select, planned dates,
// required name / client / site (L-3b) gating "Next", the machine-type template copy items, typed cost categories, the real calendar
// working time and holidays. The dialog shell is replaced by its children (portals need a DOM).
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/portfolio/projects', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/app/Wizard', async () => {
  const { createElement } = await import('react');
  return { WizardDialog: ({ children, canAdvance }: { children: unknown; canAdvance?: boolean }) => createElement('div', { 'data-can-advance': String(canAdvance ?? true) }, children as never) };
});
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import type { Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getNewProjectSetup, type NewProjectSetup } from '@/server/dal/projects-register';
import { NewProjectWizard, basicsComplete, defaultDraft, draftCalendar, type WizardDraft } from './new-project-wizard';

/** The empty draft on the demo data set's business date (Fri 25 Sep 2026, R-013): planned start 11 Jan 2027. */
const DEFAULT_DRAFT = defaultDraft('2026-09-25');

const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

let setup: NewProjectSetup;
const render = (step: number, draft: WizardDraft, lang: Lang = 'en') =>
  renderToStaticMarkup(
    h(I18nProvider, {
      lang,
      children: h(NewProjectWizard, { open: true, onClose() {}, step, onStepChange() {}, setup, draft, onDraft() {}, onCreate() {}, pending: false }),
    }),
  );

describe('New project wizard (chapter 4)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
    setup = await getNewProjectSetup({ name: 'Romain Aubert', role: 'pm' });
  }, 60_000);

  it('step 1: required name and client gate "Next"; PM select with the viewer; planned dates', () => {
    expect(render(1, DEFAULT_DRAFT)).toContain('data-can-advance="false"');
    // L-3b: the site (city + a country of the list) is required too; the planned finish is optional.
    expect(basicsComplete({ ...DEFAULT_DRAFT, name: 'Lab line', client: 'Logistics BU' }, setup.countries)).toBe(false);
    const filled = { ...DEFAULT_DRAFT, name: 'Lab line', client: 'Logistics BU', city: 'Lyon', country: 'France', finish: '2027-09-30' };
    expect(basicsComplete(filled, setup.countries)).toBe(true);
    expect(basicsComplete({ ...filled, finish: '' }, setup.countries)).toBe(true);
    expect(basicsComplete({ ...filled, country: 'Atlantis' }, setup.countries)).toBe(false);
    const m = render(1, filled);
    expect(m).toContain('data-can-advance="true"');
    expect(m).toContain('type="date"');
    expect(m).toContain('value="2027-01-11"');
    expect(m).toMatch(/<option value="[^"]+" selected="">R\. Aubert<\/option>/);
    expect(setup.countries).toContain('France');
    expect(m).toMatch(/<option value="France" selected="">France<\/option>/);
    expect(text(render(1, filled, 'fr'))).toContain('Pays du site');
    expect(text(render(1, { ...filled, finish: '' }, 'fr'))).toContain('Facultative — tirée du planning si vide');
    expect(render(1, { ...filled, finish: '2026-12-01' })).toContain('data-can-advance="false"');
    expect(text(render(1, { ...filled, finish: '2026-12-01' }, 'fr'))).toContain('La fin prévue doit être postérieure au début prévu');
  });

  it('step 2: the copy items describe what will be instantiated', () => {
    const t2 = text(render(2, DEFAULT_DRAFT));
    expect(t2).toContain('6 phases · 6 work packages');
    expect(t2).toContain('6 activities · 5 links');
    expect(t2).toMatch(/\d+ ITP systems/);
    const fr = text(render(2, DEFAULT_DRAFT, 'fr'));
    expect(fr).toContain('6 phases · 6 lots');
    expect(fr).toContain('6 activités · 5 liens');
    expect(fr).toContain('Plan d’inspection');
  });

  it('step 3: the cost category type is a select', () => {
    const m = render(3, DEFAULT_DRAFT);
    expect(m).toMatch(/<select[^>]*aria-label="Type"/);
    expect(text(render(3, DEFAULT_DRAFT, 'fr'))).toContain('Main-d’œuvre');
  });

  it('step 4: the template calendar by default, with its real working time and holidays', () => {
    expect(draftCalendar(setup, DEFAULT_DRAFT)).toBe('standard_5x8_workshop');
    const t4 = text(render(4, DEFAULT_DRAFT));
    expect(t4).toContain('Mon–Fri · 8 h a day');
    expect(t4).toContain('French public holidays + Settings holidays');
    expect(t4).toContain('Standard 5d · 8h + Atelier calendar');
    const site = text(render(4, { ...DEFAULT_DRAFT, cal: 'site_6x10' }, 'fr'));
    expect(site).toContain('lun.–sam. · 10 h par jour');
    expect(site).toContain('Jours fériés France + fériés des paramètres');
    expect(text(render(4, { ...DEFAULT_DRAFT, cal: 'continuous_24h' }))).toContain('Holidays are worked');
  });
});
