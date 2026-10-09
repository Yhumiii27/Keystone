// Static render of My work (/my/tasks) and Task detail (/my/tasks/[taskId]) on the seeded in-memory DB: person =
// viewer (never a fixed Hélène Sauvage), ?person= for managers only, KPI tiles, list groups, board, calendar, FR/EN
// labels, the task sheet (meta, checklist, files, comments, time, cost note, plan card, critical notice) and the
// read-only renderings. Session, screen access and the shell's PageHeader are mocked.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const state = { lang: 'fr' as 'fr' | 'en', role: 'director' as RoleKey };
vi.mock('next/navigation', () => ({
  usePathname: () => '/my/tasks',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('404');
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: state.lang, t: makeT(state.lang) }) };
});
vi.mock('@/server/project-context', async () => {
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  const { isOutside } = await import('@/components/app/shell/nav-model');
  return {
    getScreenAccess: async (screen: 'mywork' | 'task') => {
      const outside = isOutside(state.role, screen);
      return { viewer: PERSONA_BY_ROLE[state.role], outside, canEdit: !outside };
    },
  };
});
vi.mock('@/components/app/shell/page-header', async () => {
  const { createElement } = await import('react');
  return {
    PageHeader: ({ primary, title, crumbExtra }: { primary?: unknown; title?: string; crumbExtra?: string }) =>
      createElement('header', { 'data-title': title ?? '', 'data-crumb': crumbExtra ?? '' }, primary as never),
  };
});

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MyWorkPage from '@/app/(app)/my/tasks/page';
import TaskPage from '@/app/(app)/my/tasks/[taskId]/page';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';

const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const wrap = (el: unknown) => renderToStaticMarkup(h(I18nProvider, { lang: state.lang, children: el as never }));
const myWork = async (sp: Record<string, string> = {}) => wrap(await MyWorkPage({ searchParams: Promise.resolve(sp) }));
const task = async (id: string) => wrap(await TaskPage({ params: Promise.resolve({ taskId: id }) }));
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe('My work render', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('director, ?person=Hélène Sauvage (FR): manager view, KPIs, groups, rows, primary to the first open task', async () => {
    state.role = 'director';
    state.lang = 'fr';
    const html = await myWork({ person: 'Hélène Sauvage' });
    const tx = text(html);
    expect(html).toContain('data-crumb="Hélène Sauvage"');
    for (const s of [
      'Hélène Sauvage', 'QA / QC · Harbor Line · Clinique Pasteur Lyon', 'Vue manager · exactement ce que voit Hélène', 'Vue', 'Liste', 'Tableau', 'Calendrier',
      'Échéance aujourd’hui', 'ven. 25 sept.', 'En retard', 'Nouvelle date ou relance nécessaire', 'Semaine prochaine', '28 sept. – 2 oct.',
      // A-12 (chapter 4, 10 OQ18): this week's time entries (23 Sep 2.5 h + 24 Sep 3.5 h), not every hour of the tasks started.
      'Saisi cette semaine', '6.0 h', 'sur 40 h · 15 %', 'Charge 2 prochaines sem.', '45%', 'Dans la capacité',
      'Aujourd’hui', '2 tâches', '1 tâche', 'Plus tard', 'Terminées récemment', 'Survey verticality', '#QA', '#Site', '2/4', '6/8 h',
      'En retard · mer. 23 sept.', 'jeu. 1 oct.', 'Terminé', 'Saisir du temps',
    ])
      expect(tx).toContain(s);
    // Groups in prototype order, with their tasks byDue (after the header, whose primary links to T-2314).
    const body = html.slice(html.indexOf('</header>'));
    const order = ['T-2302', 'T-2314', 'T-2311', 'T-2318', 'T-2331', 'T-2335', 'T-2340', 'T-2290'].map((id) => body.indexOf(`href="/my/tasks/${id}"`));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]))).toBe(true);
    // Primary "Log time" → first open task in list order (T-2314); done toggles available (director).
    expect(html).toMatch(/<header[^>]*><a[^>]*href="\/my\/tasks\/T-2314"[^>]*>.*Saisir du temps/);
    expect(count(html, 'aria-label="Marquer terminé"')).toBe(8);
    expect(html).toContain('aria-haspopup'); // person switcher (menu content renders on open)
    // Labels are translated as in the prototype's FR rows ("Engineering" → "Ingénierie").
    const julien = text(await myWork({ person: 'Julien Wagner' }));
    expect(julien).toContain('#Ingénierie');
    expect(julien).not.toContain('#Engineering');
  });

  it('the viewer by default — never Hélène Sauvage: member Julien Wagner (EN), director alone has no tasks', async () => {
    state.role = 'member';
    state.lang = 'en';
    let html = await myWork({ person: 'Hélène Sauvage' }); // ignored: members only see their own work
    let tx = text(html);
    expect(html).toContain('data-crumb="Julien Wagner"');
    expect(tx).toContain('Structural engineer · Harbor Line');
    expect(tx).not.toContain('Manager view');
    expect(tx).not.toContain('Survey verticality');
    // A-12 (chapter 4): "Logged this week" = Julien's time entries of the week (22 Sep 3 h + 23 Sep 4 h; prototype 14.0 h).
    for (const s of ['Due today', 'Overdue', 'Next week', 'Logged this week', '7.0 h', 'of 40 h · 18%', 'Load next 2 wks', '95%', 'Within capacity', 'Torque check — Bay 3 bolt groups', 'Log time'])
      expect(tx).toContain(s);
    expect(html).not.toContain('aria-haspopup'); // no person switcher for the member

    state.role = 'director';
    html = await myWork();
    tx = text(html);
    expect(html).toContain('data-crumb="Marie Lefebvre"');
    for (const s of ['Portfolio director · No projects', 'No tasks yet', 'Not in the resource pool']) expect(tx).toContain(s);
    expect(html).not.toContain('Log time'); // nothing to log on
    expect(html).toContain('aria-haspopup'); // person switcher
  });

  it('outside the workspace (pm): read-only — no toggles, no primary', async () => {
    state.role = 'pm';
    state.lang = 'en';
    const html = await myWork({ person: 'Amélie Ollivier' });
    expect(html).toContain('data-crumb="Amélie Ollivier"');
    expect(text(html)).toContain('Coordinate crane delivery access route');
    expect(html).not.toContain('aria-label="Mark done"');
    expect(html).not.toContain('Log time');
  });

  it('board and calendar views', async () => {
    state.role = 'director';
    state.lang = 'en';
    let tx = text(await myWork({ person: 'Hélène Sauvage', view: 'board' }));
    for (const s of ['To do', 'In progress', 'In review', 'Done', 'Monthly QA dashboard', 'Today', 'Overdue · Wed 23 Sep']) expect(tx).toContain(s);
    const html = await myWork({ person: 'Hélène Sauvage', view: 'calendar' });
    tx = text(html);
    for (const s of ['21 Sep – 2 Oct', 'Mon 21', 'Fri 25', 'Planned hours', '6.5', 'Harbor Line · 6/8 h']) expect(tx).toContain(s);
    expect(html).toContain('href="/my/tasks?person=H%C3%A9l%C3%A8ne+Sauvage&amp;view=calendar&amp;week=1"');
    expect(html).toContain('--l:10%;--w:20%');
    tx = text(await myWork({ person: 'Hélène Sauvage', view: 'calendar', week: '1' }));
    expect(tx).toContain('28 Sep – 9 Oct');
    expect(tx).toContain('ITP sign-off — electrical rough-in');
  });
});

describe('Task detail render', () => {
  it('T-2314 for the director (FR): header, meta, checklist, files, comments, time, cost note, plan card, critical notice', async () => {
    state.role = 'director';
    state.lang = 'fr';
    const html = await task('T-2314');
    const tx = text(html);
    expect(html).toContain('data-title="Survey verticality — Bay 3 columns"');
    expect(html).toContain('data-crumb="T-2314"');
    expect(html).toContain('href="/my/tasks?person=H%C3%A9l%C3%A8ne+Sauvage"');
    expect(html).toContain('href="/projects/HLT-026/plan?act=A1250"');
    for (const s of [
      'Mon travail', 'T-2314', 'Harbor Line', 'A1250 · Steel erection — Bays 3–4', 'À faire', 'En cours', 'En revue', 'Terminé',
      'Assigné à', 'Hélène Sauvage', 'Échéance', 'ven. 25 sept.', 'Priorité', 'Élevé', 'Estimation', '8 h', 'Étiquettes', '#QA #Site',
      'Check plumb of the 12 erected columns', 'Liste de contrôle', '2 sur 4 faits', 'Set up total station at grid C3',
      'Fichiers', 'Joindre', 'verticality-survey-bay3.xlsx', '48 KB · H. Sauvage · aujourd’hui', '2.1 MB · H. Sauvage · hier',
      'Commentaires', 'Julien Wagner', 'Hier 16:40', 'Aujourd’hui 08:15', 'Romain Aubert', 'Publier',
      'Avancement', '75%', 'Temps', '6.0', '/ 8 h', 'mer. 23 sept.', 'Set-up & columns C1–C6', '2.5 h', 'Saisir',
      '6.0 h × 95 €/h = 570 € de coût réel → Main-d’œuvre · Lot 1.4 Steel structure',
      'Position dans le plan', 'Activité', 'Lot de travaux', '1.4 Steel structure', 'Fin de l’activité', '09 oct.', 'Flottement total', '-27 j',
      'Avancement de l’activité', '72%', 'Sur le chemin critique', 'Ouvrir l’activité dans le plan', 'Marquer terminé',
    ])
      expect(tx).toContain(s);
    // Placeholders (attributes, not text).
    for (const s of ['Ajouter un élément…', 'Écrire un commentaire… @mention pour notifier', 'Sur quoi avez-vous travaillé ?'])
      expect(html).toContain(`placeholder="${s}"`);
  });

  it('generated description, "0 of 3" without items, "— (complete)" float (EN)', async () => {
    state.lang = 'en';
    let tx = text(await task('T-2302'));
    expect(tx).toContain(
      'Part of A1310 Crane rail foundations — WBS 1.5 Crane installation. Complete the work, tick the checklist and log your hours; progress rolls up to the activity and the earned value of its work package.',
    );
    expect(tx).toContain('3 of 3 done');
    expect(tx).toContain('No checklist yet');
    expect(tx).toContain('— (complete)');
    expect(tx).toContain('28 Aug A');
    expect(tx).toContain('4.5 h × €95/h = €428 actual cost → Labor · WP 1.5 Crane installation');
    expect(tx).not.toContain('On the critical path');
    tx = text(await task('t-2318'));
    expect(tx).toContain('0 of 3 done');
    expect(tx).toContain('Collect UT results from NDT sub');
    state.lang = 'fr';
    tx = text(await task('T-2298'));
    expect(tx).toContain('1 sur 1 fait ');
    expect(tx).toContain('#Ingénierie');
    expect(text(await task('T-2314'))).toContain('2 sur 4 faits');
  });

  it('member on someone else’s task: read-only sheet, comments still open; outside roles read-only; unknown → 404', async () => {
    state.role = 'member';
    state.lang = 'en';
    let html = await task('T-2314');
    expect(html).not.toContain('Mark done');
    expect(html).not.toContain('Add an item…');
    expect(html).not.toContain('What did you work on?');
    expect(html).toContain('Write a comment… @mention to notify');
    expect(html).toContain('href="/my/tasks"'); // back to their own work
    html = await task('T-2305'); // their own
    expect(html).toContain('Mark done');
    expect(html).toContain('What did you work on?');
    state.role = 'quality';
    html = await task('T-2305');
    expect(html).not.toContain('Write a comment');
    expect(html).not.toContain('Mark done');
    expect(html).toContain('href="/my/tasks?person=Julien+Wagner"');
    await expect(task('T-9999')).rejects.toThrow('404');
    await expect(task('nope')).rejects.toThrow('404');
  });
});
