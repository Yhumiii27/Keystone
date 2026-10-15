// Static render of the administration bodies from the seeded in-memory database, in EN and FR: the template labels
// (templates 1529–1597, 2237–2267 and their prototype French), the links (machine-type list, display, source chips,
// audit export), the edit controls for the workspace and the read-only rendering outside it (no ×, no Add, no toggle,
// no Sync now, read-only fields).
import { createElement as h, type ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/admin/settings', useSearchParams: () => new URLSearchParams() }));

import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listAdminConnectors } from '@/server/dal/admin-connectors';
import { getPlumbingCounts, listImportFormats } from '@/server/dal/integrations';
import { listMachineTypes } from '@/server/dal/mtypes';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { listProjects } from '@/server/dal/projects';
import { getSettings } from '@/server/dal/settings';
import GOLDEN from './admin.golden.json';
import { machineTypesView, plumbingView, settingsView } from './model';
import { MachineTypesBody } from './mtypes-view';
import { PlumbingBody } from './plumbing-view';
import { SettingsBody } from './settings-view';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = GOLDEN as any;
const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const label = (en: string, lang: Lang) => (lang === 'en' ? en : G.fr.labels[en] ?? makeT('fr')(en));
const count = (markup: string, re: RegExp) => (markup.match(re) ?? []).length;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('Settings body', () => {
  it.each(['en', 'fr'] as const)('%s: template labels, KPI tiles, seven cards with their entries and controls', async (lang) => {
    const t = makeT(lang);
    const out = html(h(SettingsBody, { view: settingsView(await getSettings(), t, lang), canEdit: true }), lang);
    const plain = text(out);
    // R-044 (P-12 c): the rate grid is edited by the director and Finance — the prototype's "page (directors and PMs)." is replaced.
    // R-088 (R-6b): the hours-variance threshold on its own row.
    for (const l of ['Project health rules', 'At risk below', 'Off track below', 'Labor rates and multipliers are edited on the', 'Rate cards', 'page (director and Finance).', 'Add', 'Hours variance', 'Hours variance threshold (%)']) {
      expect(plain, l).toContain(label(l, lang));
    }
    expect(out).toContain(`placeholder="${label('Add an entry', lang)}"`);
    for (const c of G[lang].settings.cards) expect(plain).toContain(c.title);
    // 61 entries, one × each except the three lifecycle stages the workflow needs (A-14: Initiative, Clos, Annulé);
    // the location types (5) once.
    expect(count(out, /aria-label="(Remove|Retirer) · /g)).toBe(58);
    expect(count(out, /aria-pressed=/g)).toBe(5);
    expect(out).toContain('type="number" step="0.01" value="0.97"');
    expect(out).toContain('id="hours-variance" class="input');
    expect(out).toMatch(/id="hours-variance"[^>]*type="number" step="1" min="1" max="50" value="10"/);
    // The footnote's text, link and text are three flex items 8px apart, as the prototype's (template 1581).
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(out).toMatch(new RegExp(`</svg>${esc(label('Labor rates and multipliers are edited on the', lang))}<a [^>]*href="/resources/rates"[^>]*>${esc(label('Rate cards', lang))}</a>${esc(label('page (director and Finance).', lang))}</div>`));
    expect(plain).toContain(lang === 'en' ? 'Entrepôt central — Lyon Central warehouse' : 'Entrepôt central — Lyon Entrepôt central');
  });

  it('outside the workspace: entries listed, no remove / add / location type, thresholds read-only', async () => {
    const out = html(h(SettingsBody, { view: settingsView(await getSettings(), makeT('en'), 'en'), canEdit: false }), 'en');
    expect(out).not.toContain('aria-label="Remove');
    expect(out).not.toContain('placeholder="Add an entry"');
    expect(out).not.toContain('aria-pressed=');
    // The two health thresholds and the hours-variance threshold (R-088).
    expect(count(out, /readOnly=""|readonly=""/gi)).toBe(3);
    expect(text(out)).toContain('Software / IT');
  });
});

describe('Machine types body', () => {
  async function body(lang: Lang, canEdit: boolean, selected: string | null = null) {
    const t = makeT(lang);
    const [types, projects] = await Promise.all([listMachineTypes(), listProjects()]);
    return html(h(MachineTypesBody, { view: machineTypesView({ types, projects, selected }, t, lang), canEdit, t }), lang);
  }

  it.each(['en', 'fr'] as const)('%s: list links, identity card, payment pattern, lists, REX and projects', async (lang) => {
    const out = await body(lang, true);
    const plain = text(out);
    for (const l of ['Machine types', 'Standard planning · costs · inspections · financial REX', 'Code', 'Label', 'Default calendar', 'Description',
      'Payment pattern (deposit / delivery / acceptance)', 'Deposit %', 'Delivery %', 'Acceptance %', 'Standard phases', 'Add phase', 'ITP systems', 'Add system',
      'Cost categories (reference budget, k€)', 'Add category', 'Category', 'Type', 'Budget', 'Financial REX · reference projects', 'Projects using this type', 'Open project']) {
      expect(plain, l).toContain(label(l, lang));
    }
    expect(count(out, /href="\/admin\/machine-types\?type=/g)).toBe(5);
    expect(out).toContain('href="/admin/machine-types?type=rnd"');
    expect(out).toMatch(/aria-current="true"[^>]*>|href="\/admin\/machine-types\?type=EMP"[^>]*aria-current="true"/);
    expect(plain).toContain(`EMP · EMP ${label('Active', lang)} ${label('Deactivate', lang)}`);
    expect(plain).toContain(`${label('Total', lang)} 100 %`);
    expect(plain).toContain(lang === 'en' ? 'Total €1.94M' : 'Total 1,94 M€');
    expect(out).toContain('href="/projects/HLT-026/plan"');
    // 6 phases + 6 ITP systems + 7 categories + 2 REX references, one × each.
    expect(count(out, /aria-label="(Remove|Retirer) · /g)).toBe(21);
  });

  it('read-only outside the workspace; a type without project or reference shows the empty notes', async () => {
    const out = await body('en', false, 'AUTRE');
    const plain = text(out);
    expect(out).not.toContain('aria-label="Remove');
    expect(plain).not.toContain('Add phase');
    expect(plain).not.toContain('Deactivate');
    expect(out).toContain('disabled=""');
    const created = await body('en', true, 'nope');
    expect(text(created)).toContain('EMP · EMP');
  });
});

describe('Activity, integrations & audit body', () => {
  async function body(lang: Lang, view: 'activity' | 'connectors' | 'imports' | 'audit', canEdit = true) {
    const t = makeT(lang);
    const [activity, connectors, imports, audit, counts] = await Promise.all([listActivity(), listAdminConnectors(), listImportFormats(), listAudit(), getPlumbingCounts()]);
    const v = plumbingView({ view, source: null, activity, connectors, imports, audit, counts, unread: 3, personaTitle: 'Portfolio director' }, t, lang);
    return html(h(PlumbingBody, { view: v, canEdit, t }), lang);
  }

  it.each(['en', 'fr'] as const)('%s: display links, source chips and the activity feed', async (lang) => {
    const out = await body(lang, 'activity');
    const plain = text(out);
    for (const l of ['Activity feed', 'Every change across projects, people and connectors · newest first']) expect(plain).toContain(label(l, lang));
    expect(plain).toContain(G[lang].plumbing.view);
    expect(plain).toContain(G[lang].plumbing.source);
    expect(out).toContain('href="/admin/integrations?view=connectors"');
    expect(out).toContain('href="/admin/integrations?source=stock"');
    expect(count(out, /class="[^"]*actRow/g)).toBe(12);
    // R-184 (NEW-D1-2): the seeded feed reads in French from its exact entries (the prototype left it in English).
    expect(plain).toContain(lang === 'en' ? 'Lucca · Imported 312 h for W39' : 'Lucca · 312 h importées pour S39');
  });

  it.each(['en', 'fr'] as const)('%s: connectors table with modes, Sync now / Configure for the workspace only', async (lang) => {
    const out = await body(lang, 'connectors');
    const plain = text(out);
    for (const l of ['Connectors', 'System', 'Data', 'Frequency', 'Status', 'Last sync', 'Last volume', 'Sync now', 'Configure']) expect(plain, l).toContain(label(l, lang));
    // R-021: Lucca is no longer listed (header + 9 rows); Codex, Cursus and Vigie are mocks, MS Project a file exchange, the
    // other five "Not connected" — no seeded "Warning" (Outlook) any more, and "Sync now" only on the three mocks.
    expect(count(out, /<tr>/g)).toBe(10);
    expect(count(out, /class="[^"]*connMode/g)).toBe(4);
    expect(count(out, /class="tag tag-accent"/g)).toBe(0);
    expect(count(out, new RegExp(`>${lang === 'en' ? 'Not connected' : 'Non connecté'}<`, 'g'))).toBe(5);
    expect(count(out, new RegExp(`>${lang === 'en' ? 'Mock' : 'Simulé'}<`, 'g'))).toBe(3);
    expect(count(out, new RegExp(`aria-label="${label('Sync now', lang)} · `, 'g'))).toBe(3);
    expect(count(out, new RegExp(`aria-label="${label('Configure', lang)} · `, 'g'))).toBe(9);
    expect(plain).toContain(lang === 'en' ? 'Vigie Mock connector · local mirror' : 'Vigie Connecteur simulé · miroir local');
    expect(plain).toContain(lang === 'en' ? 'MS Project File exchange · no live connection' : 'MS Project Échange de fichiers · pas de connexion directe');
    const ro = await body(lang, 'connectors', false);
    expect(text(ro)).not.toContain(label('Sync now', lang));
  });

  it('import / export cards and the audit trail with its CSV export', async () => {
    const imp = await body('en', 'imports');
    // The three import cards keep the drop-zone text; the three export cards say what a click does (e2e review).
    expect(count(imp, />Drop a file or click to choose</g)).toBe(3);
    expect(count(imp, />Click to choose what to export</g)).toBe(3);
    expect(count(imp, /type="file"/g)).toBe(3);
    const fr = await body('fr', 'audit');
    const plain = text(fr);
    for (const l of ['Audit trail', 'Who changed what, when — immutable, exportable for ISO 9001 audits', 'When', 'Who', 'Object', 'Change', 'Area']) expect(plain).toContain(label(l, 'fr'));
    expect(fr).toContain('href="/admin/integrations/audit.csv"');
    expect(plain).toContain('Exporter en CSV');
    expect(count(fr, /<tr>/g)).toBe(9);
    expect(await body('en', 'audit', false)).not.toContain('audit.csv');
    // French connector volumes the prototype left in English (R-021: the not-connected PDM shows none); an empty audit trail
    // says so.
    expect(text(await body('fr', 'connectors'))).toContain('412 fiches · 38 liées à HLT-026');
    expect(text(await body('fr', 'connectors'))).not.toContain('1 248 plans');
    const t = makeT('fr');
    const empty = plumbingView({ view: 'audit', source: null, activity: [], connectors: [], imports: [], audit: [], counts: { eventsToday: 0, auditLast7Days: 0 }, unread: 0, personaTitle: 'Portfolio director' }, t, 'fr');
    expect(text(html(h(PlumbingBody, { view: empty, canEdit: true, t }), 'fr'))).toContain('Aucune entrée d’audit pour l’instant');
    // The area of connector runs is translated by the feature (not the shared dictionary: ERP-202 has a package "Integrations").
    const run = plumbingView({ ...{ view: 'audit' as const, source: null, activity: [], connectors: [], imports: [], counts: { eventsToday: 0, auditLast7Days: 1 }, unread: 0, personaTitle: 'Portfolio director' },
      audit: [{ occurredAt: '2026-09-25T07:00:00.000Z', when: '25 Sep 09:00', who: 'Marie Lefebvre', object: 'Connector Lucca', change: 'sync', area: 'Integrations', projectCode: null,
        userEmail: null, reason: null, before: null, after: null, messageKey: null, messageParams: null }] }, t, 'fr');
    expect(run.audit[0].area).toBe('Intégrations');
    expect(makeT('fr')('Integrations')).toBe('Integrations');
  });
});
