// Static render of the Schedule screen body (HLT-026, FR) with the prototype geometry: KPI tiles, Gantt bars,
// today line, milestone diamonds, progression columns, milestone tags; and `showBaseline=false`.
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/schedule', useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'fr', t: makeT('fr') }) };
});
import { renderToStaticMarkup } from 'react-dom/server';
import { scheduleView, type ScheduleInput } from '@/domain/schedule-gantt';
import type { MilestoneStatus } from '@/server/db/codes';
import { PROTO_GEN } from '@/server/prototype';
import { ScheduleView } from './schedule-view';

const ST: Record<string, MilestoneStatus> = { Done: 'done', Late: 'late', 'At risk': 'at_risk', 'On track': 'on_track' };
const pd = PROTO_GEN.projectData['HLT-026'];
const input: ScheduleInput = {
  header: {
    start: pd.start, tNow: pd.tNow, floatDays: pd.floatDays, finishText: pd.finishText, baselineText: pd.baselineText, floatText: pd.floatText,
    critText: pd.critText, milesText: pd.milesText, milesSub: pd.milesSub, chartMonths: pd.chartMonths, ganttMonths: pd.ganttMonths,
  },
  bars: (pd.TASKS as [string, string, number, number, number, number, number, boolean][]).map(([name, owner, bs, be, as, ae, p, crit]) => ({
    name, owner, baselineStart: bs, baselineEnd: be, forecastStart: as, forecastEnd: ae, pct: p, critical: crit,
  })),
  milestones: (pd.MILES as [string, number, number, string][]).map(([name, b, fc, st]) => ({ name, baselineMonth: b, forecastMonth: fc, status: ST[st], statusLabel: st })),
  pv: pd.PV, ev: pd.EV, bac: pd.BAC,
};

const render = async (showBaseline = true, data: ScheduleInput = input) => renderToStaticMarkup(await ScheduleView({ view: scheduleView(data), showBaseline }));

describe('ScheduleView render (FR)', () => {
  it('KPI tiles, card titles and legends in French', async () => {
    const html = await render();
    for (const s of [
      '0.90', '90 ¢ de travail prévu acquis par € dépensé', 'Prévu 71 % à ce jour', '14 janv. 2027', 'Référence 18 déc. 2026', '−27 jours',
      '4 lots critiques sur 8', '2 sur 6', 'Terminés · 0 à la date de référence', 'Planning — référence vs prévision', 'Chemin critique', 'Tâche',
      'Lot de travaux', 'Glissement', 'Aujourd’hui', 'Progression du planning', '% d’avancement cumulé · SPI par mois', 'Planifié', 'Réel',
      'Référence 15 mars · Prévision 1 avr.', 'janv. ’27', 'Permis approuvés',
    ])
      expect(html).toContain(s);
  });

  it('Gantt geometry: steel structure bars, today line, milestone diamonds', async () => {
    const html = await render();
    expect(html).toContain('left:42.3%;width:23.1%');
    expect(html).toContain('left:53.8%;width:21.5%');
    expect(html).toContain('width:72%');
    expect(html.match(/left:67.7%/g)?.length).toBe(10); // 8 rows + milestone row + "Today" chip
    expect(html).toContain('title="Livraison"');
    expect(html).toContain('style="left:95.8%"');
  });

  it('progression columns and milestone tags', async () => {
    const html = await render();
    expect(html).toContain('height:71.3%');
    expect(html).toContain('height:64.2%');
    expect(html.match(/class="tag tag-neutral[^"]*">Terminé</g)?.length).toBe(2);
    expect(html.match(/class="tag tag-accent[^"]*">En retard</g)?.length).toBe(2);
    expect(html.match(/class="tag tag-outline[^"]*">À risque</g)?.length).toBe(2);
  });

  it('slip in French days (docs/spec/05 OQ 23: "+15d" → "+15 j"), Gantt and milestone list', async () => {
    const html = await render();
    expect(html).toContain('>+39 j<');
    expect(html).toContain('>+25 j<');
    expect(html).not.toMatch(/>\+\d+d</);
  });

  it('empty states: no package and no milestone (no Harbor Line fallback)', async () => {
    const html = await render(true, { ...input, bars: [], milestones: [] });
    expect(html).toContain('Aucun lot de travaux planifié pour ce projet');
    expect(html).toContain('Aucun jalon enregistré pour ce projet');
    expect(html).not.toContain('Lot de travaux<');
    const onlyMiles = await render(true, { ...input, bars: [] });
    expect(onlyMiles).toContain('title="Livraison"');
    expect(onlyMiles).not.toContain('Aucun jalon');
  });

  it('showBaseline=false drops the baseline bars and outline diamonds', async () => {
    const withBl = await render(true);
    const noBl = await render(false);
    expect(withBl).toContain('left:42.3%;width:23.1%');
    expect(noBl).not.toContain('left:42.3%;width:23.1%');
    expect(noBl.length).toBeLessThan(withBl.length);
  });
});
