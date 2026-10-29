// R-198 — static render of the Schedule screen's activity Gantt card (FR): zoom switch, rows grouped by work package, bars as
// buttons with their dates, baseline bars, relationship arrows; the edit handles only for an editor.
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/schedule', useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'fr', t: makeT('fr') }) };
});
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BUILTIN_CALENDARS } from '@/domain/calendar';
import type { GanttActivity, GanttNetwork } from '@/domain/gantt-edit';
import { ClockProvider } from '@/components/app/clock';
import { I18nProvider } from '@/i18n/client';
import { ActivityGanttCard } from './activity-gantt-card';

const act = (id: string, over: Partial<GanttActivity>): GanttActivity => ({
  id, name: `Activité ${id}`, wbs: '1.1', duration: 5, calendar: null, pct: 0, remaining: null, startDate: null, finishDate: null, startActual: false,
  finishActual: false, constraint: null, critical: false, totalFloat: 3, baselineStart: null, baselineFinish: null, ...over,
});
const network: GanttNetwork = {
  dataDate: '2026-09-25', projectStart: null, projectCalendar: 'standard_5x8', calendars: BUILTIN_CALENDARS.map((def) => ({ def, settingsHolidays: [], exceptions: [] })),
  packages: [{ code: '1.1', name: 'Études' }],
  activities: [
    act('A1010', { startDate: '2026-09-28', finishDate: '2026-10-02', critical: true, baselineStart: '2026-09-21', baselineFinish: '2026-09-25' }),
    act('A1020', { startDate: '2026-10-05', finishDate: '2026-10-07', duration: 3 }),
  ],
  links: [{ pred: 'A1010', succ: 'A1020', type: 'FS', lag: 0 }],
};

const render = async (editable: boolean) => {
  const card = await ActivityGanttCard({
    code: 'HLT-026', network, zoom: 'week', zoomHref: (z) => `/projects/HLT-026/schedule?gantt=activities&zoom=${z}`, levelSwitch: null, editable, showBaseline: true,
  });
  return renderToStaticMarkup(createElement(I18nProvider, { lang: 'fr' } as ComponentProps<typeof I18nProvider>, createElement(ClockProvider, { today: '2026-09-25' } as ComponentProps<typeof ClockProvider>, card)));
};

describe('Activity Gantt card render (FR)', () => {
  it('title, zoom links, work package and activity rows, bars with their dates, arrows', async () => {
    const html = await render(true);
    for (const s of ['Planning — activités', 'Échelle', 'Jour', 'Semaine', 'Mois', '1.1 · Études', 'Activité A1010', 'S40', 'S41'])
      expect(html).toContain(s);
    expect(html).toContain('href="/projects/HLT-026/schedule?gantt=activities&amp;zoom=day"');
    expect(html).toContain('aria-label="A1010 · Activité A1010 · 28 sept. 2026 → 2 oct. 2026"');
    expect(html.match(/role="button"/g)?.length).toBe(2);
    // The relationship (visible path + hit path); the arrow marker is not one.
    expect(html.match(/d="M[-\d.]+,[-\d.]+ H/g)?.length).toBe(2);
    expect(html).toContain('Glissez une barre pour la déplacer');
    expect(html).toContain('title="Glissez sur une autre activité pour les lier (fin à début)"');
  });

  it('read-only: the same bars (a click opens the activity), no drag handle', async () => {
    const html = await render(false);
    expect(html.match(/role="button"/g)?.length).toBe(2);
    expect(html).toContain('Lecture seule · un clic ou Entrée ouvre l’activité');
    expect(html).not.toContain('Glissez sur une autre activité');
  });
});
