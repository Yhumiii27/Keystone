// Static render of the two screen bodies and the header buttons from the seeded in-memory database, EN and FR: the
// prototype's table headers (template 948–971, «…» labels) with the Interventions "Type" header (the prototype's
// "Project" header showed the type, 07 OQ7), the configuration links (Change orders screen + Vigie in a new window),
// the claim ECO tag, the Display switch links, the zone notice and the cost bars.
import { createElement as h, type ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('./actions', () => ({ addMachineAction: vi.fn(), openClaimAction: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/after-sales/fleet',
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { DEMO_TODAY_ISO } from '@/domain/clock';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { claimFormOptions, getFleetScreen, getSavScreen, machineTypeOptions } from '@/server/dal/aftersales';
import GOLDEN from '@/domain/aftersales.golden.json';
import { AddMachineButton, NewClaimButton } from './add-buttons';
import { FleetBody } from './fleet-view';
import { claimFormDef, localizeForm, machineFormDef } from './forms';
import { fleetView, savView } from './model';
import { SavBody } from './sav-view';

/* eslint-disable @typescript-eslint/no-explicit-any */
const L = (GOLDEN as any).labels as Record<string, string>;
const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const headers = (markup: string) => [...markup.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
const tr = (lang: Lang, en: string) => (lang === 'fr' ? L[en] : en);

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('Installed base body', () => {
  it.each(['en', 'fr'] as const)('%s: card title, headers, rows, configuration links', async (lang) => {
    const t = makeT(lang);
    const out = html(h(FleetBody, { view: fleetView(await getFleetScreen(null), null, t, lang), t }), lang);
    expect(out).toContain(`>${tr(lang, 'Installed base')}<`);
    expect(headers(out)).toEqual(['', ...['Machine', 'Status', 'Project', 'Site', 'Delivered', 'Warranty end', 'Open claims', 'Configuration', 'Warranty cost'].map((x) => tr(lang, x))]);
    expect(out.match(/<tr>/g)!.length).toBe(9);
    expect(out).toContain('href="/reference/eco?eco=ECO-2026-0');
    expect(out).toMatch(/href="http:\/\/localhost:3200\/modifications-techniques\/ECO-2026-0\d\d" target="_blank" rel="noopener noreferrer"/);
    // R-013: MCH-035 (1 Nov 2026) counted from the business date, 25 Sep 2026 on the demo data set (31 d from the prototype's 30 Sep).
    expect(out).toContain(lang === 'fr' ? 'finit dans 36 j' : 'ends in 36 d');
    expect(out).toContain('20 k€');
    // R-155 (X-16): the machine list's notice (never shown without a zone).
    expect(out).not.toContain(lang === 'fr' ? 'Aucune machine dans cette zone' : 'No machine in this zone');
  });

  it('a zone without machine shows the notice', () => {
    const t = makeT('fr');
    const out = html(h(FleetBody, { view: fleetView({ machines: [], today: DEMO_TODAY_ISO }, 'apac', t, 'fr'), t }), 'fr');
    // R-155 (X-16): « Aucune machine dans cette zone » (the prototype reused the project screens' text).
    expect(out).toContain('Aucune machine dans cette zone');
    expect(out).not.toContain('Aucun projet dans cette zone');
    expect(out).toContain('role="status"');
  });
});

describe('Warranty claims & interventions body', () => {
  it.each(['en', 'fr'] as const)('%s: Display switch and the three registers', async (lang) => {
    const t = makeT(lang);
    const data = await getSavScreen(null);
    const claims = html(h(SavBody, { view: savView(data, 'claims', null, t, lang), t }), lang);
    expect(headers(claims)).toEqual(['', ...['Machine', 'Reported issue', 'Severity', 'Date', 'Status', 'Coverage', 'Cost', 'Owner', 'Next step'].map((x) => tr(lang, x))]);
    expect(claims).toContain('href="/after-sales/claims?view=interventions"');
    expect(claims).toContain('href="/after-sales/claims?view=costs"');
    expect(claims).toMatch(/aria-current="true" href="\/after-sales\/claims"/);
    // WC-013's design ECO is not reported by Vigie to Keystone: the tag opens Vigie.
    expect(claims).toMatch(/href="http:\/\/localhost:3200\/modifications-techniques\/ECO-031" target="_blank" rel="noopener noreferrer"/);
    expect(claims).toContain(lang === 'fr' ? '>Vue<' : '>Display<');

    const ivs = html(h(SavBody, { view: savView(data, 'interventions', null, t, lang), t }), lang);
    // R-143: a last, unlabelled column holds "Mark done" (editors).
    expect(headers(ivs)).toEqual(['', ...['Machine', 'Date', 'Technician', 'Type', 'Duration', 'Status'].map((x) => tr(lang, x)), '']);
    expect(ivs).toContain('Corrective · WC-015');
    expect(ivs).toContain(lang === 'fr' ? '>Planifiée<' : '>Planned<');

    const costs = html(h(SavBody, { view: savView(data, 'costs', null, t, lang), t }), lang);
    expect(headers(costs)).toEqual(['', ...['Machine', 'Claims', 'Warranty cost', 'Chargeable'].map((x) => tr(lang, x)), '']);
    expect(costs).toContain('style="width:80%"');
    expect(costs).toMatch(/aria-current="true" href="\/after-sales\/claims\?view=costs"/);
  });

  it('Asia Pacific › Interventions: no intervention in the zone → the notice (the prototype showed an empty table)', async () => {
    const t = makeT('en');
    const out = html(h(SavBody, { view: savView(await getSavScreen('apac'), 'interventions', 'apac', t, 'en'), t }), 'en');
    // R-155 (X-16 + 07 A.1): the zone has a machine (MCH-040): the notice names the interventions.
    expect(out).toContain('No intervention in this zone');
    expect(out.match(/<tr>/g)!.length).toBe(1);
  });
});

describe('header buttons', () => {
  it.each(['en', 'fr'] as const)('%s: "Add machine" and "New claim" render primary buttons (dialogs closed)', async (lang) => {
    const t = makeT(lang);
    const opts = await claimFormOptions();
    const a = html(h(AddMachineButton, { label: t('Add machine'), form: localizeForm(machineFormDef(await machineTypeOptions()), t, lang) }), lang);
    const b = html(h(NewClaimButton, { label: t('New claim'), form: localizeForm(claimFormDef(opts.machines, opts.owners), t, lang) }), lang);
    expect(a).toContain('btn-primary');
    expect(a).toContain(`>${tr(lang, 'Add machine')}<`);
    expect(b).toContain(`>${tr(lang, 'New claim')}<`);
    expect(a + b).not.toContain('dialog');
  });
});
