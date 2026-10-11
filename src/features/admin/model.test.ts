// Administration view models from the seeded in-memory database, in EN and FR, compared with the prototype's own render
// values (admin.golden.json, scripts/proto-golden-admin.ts: renderVals() for the director, EN and FR — deepTr applied),
// then after edits written through the DAL (the prototype's in-screen edits replayed in node:vm).
// French: where the prototype left a string in English, the rebuild's dictionary (src/i18n/extra) may translate it —
// `fr()` accepts exactly that. Deliberate deviations asserted inline: singular forms ("1 ITP system"); the site calendar
// selected for SPUR; Vigie as the 10th connector; Codex, Vigie and Cursus with their connector-layer mode and state
// (Codex last sync = the Codex index sync, 29 Sep 08:02); the "Request" chip as a noun in French.
import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { parseActivitySource } from '@/domain/admin';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listAdminConnectors } from '@/server/dal/admin-connectors';
import { getPlumbingCounts, listImportFormats } from '@/server/dal/integrations';
import { createMachineType, listMachineTypes, setMachineTypeCostCategories, setMachineTypePhases, updateMachineType } from '@/server/dal/mtypes';
import { countUnreadNotifications, listActivity, listAudit } from '@/server/dal/notifications';
import { listProjects } from '@/server/dal/projects';
import { addLocation, addReferenceValue, getSettings, removeReferenceValue, resetSettings, setHealthThresholds } from '@/server/dal/settings';
import GOLDEN from './admin.golden.json';
import { integrationsHref, machineTypesHref } from './links';
import { machineTypesView, plumbingView, settingsView, visibleImportFormats } from './model';
import { dataText } from '@/i18n/data-text';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = GOLDEN as any;
const trFr = makeT('fr');
/**
 * Strings the prototype half-translated ("Financier / currency") and the rebuild's dictionary (src/i18n/extra/risks.json)
 * translates in full. Where the prototype left a string in English, the rebuild's French is its dictionary's.
 */
const DICT_FIXES = new Set(['Financial / currency', 'Resources / skills']);
/** FR value: the prototype's French, or — where the prototype left the English — the rebuild dictionary's French. */
const fr = (en: unknown, frG: unknown): any => {
  if (typeof en === 'string' && typeof frG === 'string') return frG === en || DICT_FIXES.has(en) ? trFr(en) : frG;
  if (Array.isArray(en)) return en.map((x, i) => fr(x, (frG as unknown[])[i]));
  if (en && typeof en === 'object') return Object.fromEntries(Object.entries(en).map(([k, v]) => [k, fr(v, (frG as any)[k])]));
  return frG;
};
const golden = (lang: Lang, path: (g: any) => any) => (lang === 'en' ? path(G.en) : fr(path(G.en), path(G.fr)));
const kpis = (ks: any[]) => ks.map((k) => ({ label: k.label, value: String(k.value), sub: k.sub, color: k.color }));
const DIRECTOR = { name: 'Marie Lefebvre', role: 'director' };
const QUALITY = { name: 'Gabriel Comte', role: 'quality' };

async function settings(lang: Lang) {
  return settingsView(await getSettings(), makeT(lang), lang);
}
async function mtypes(lang: Lang, selected: string | null = null) {
  const [types, projects] = await Promise.all([listMachineTypes(), listProjects()]);
  return machineTypesView({ types, projects, selected }, makeT(lang), lang);
}
async function plumbing(lang: Lang, q: { view?: string; source?: string; role?: 'director' | 'pm' } = {}) {
  const [activity, connectors, imports, audit, counts] = await Promise.all([listActivity(), listAdminConnectors(), listImportFormats(), listAudit(), getPlumbingCounts()]);
  const persona = PERSONA_BY_ROLE[q.role ?? 'director'];
  const unread = await countUnreadNotifications(persona.role);
  return plumbingView(
    { view: (q.view ?? 'activity') as any, source: parseActivitySource(q.source, activity.map((a) => a.kind)), activity, connectors, imports, audit, counts, unread, personaTitle: persona.title },
    makeT(lang), lang,
  );
}

describe('French of the administration screens', () => {
  it('equals the prototype wherever the prototype translated, but for the dictionary fixes (money is formatted, not translated)', () => {
    const diff = new Set<string>();
    const walk = (en: any, frG: any) => {
      if (typeof en === 'string') {
        if (typeof frG === 'string' && frG !== en && trFr(en) !== frG && !/^€/.test(en) && en !== 'base') diff.add(en);
        return;
      }
      if (Array.isArray(en)) en.forEach((x, i) => walk(x, frG?.[i]));
      else if (en && typeof en === 'object') for (const k of Object.keys(en)) walk(en[k], frG?.[k]);
    };
    walk(G.en, G.fr);
    expect([...diff].sort()).toEqual([...DICT_FIXES].sort());
    expect([...DICT_FIXES].map(trFr)).toEqual(['Financier / devise', 'Ressources / compétences']);
  });
});

describe('Settings view model', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it.each(['en', 'fr'] as const)('%s: KPI tiles, health rule, the seven cards and the location types equal the prototype', async (lang) => {
    const v = await settings(lang);
    expect(v.kpis).toEqual(kpis(golden(lang, (g) => g.settings.kpis)));
    expect([v.health.riskText, v.health.offText, v.health.text]).toEqual(golden(lang, (g) => [g.settings.health.risk, g.settings.health.off, g.settings.health.text]));
    expect(v.cards.map((c) => ({ key: c.key, title: c.title, sub: c.sub, icon: `ph ph-${c.icon}`, count: c.count, isLoc: c.isLoc, items: c.items.map((i) => ({ label: i.label, sub: i.sub ?? '', hasSub: i.sub != null })) })))
      .toEqual(golden(lang, (g) => g.settings.cards.map((c: any) => ({ key: c.key, title: c.title, sub: c.sub, icon: c.icon, count: String(c.count), isLoc: c.isLoc, items: c.items }))));
    expect(v.locTypes.map((o) => o.label)).toEqual(golden(lang, (g) => g.settings.locTypeSeg.map((o: any) => o.label)));
    expect(v.locTypes.map((o) => o.value)).toEqual(['central_warehouse', 'workshop', 'site_store', 'consignment', 'quarantine']);
    // Item ids: the location name, the reference value code (holidays: the 2026 date).
    expect(v.cards[0].items[0].id).toBe('Entrepôt central — Lyon');
    expect(v.cards[6].items[6].id).toBe('2026-07-14');
  });

  it('after edits (add, remove, location of a type, thresholds) the cards follow the prototype; Reset restores the defaults', async () => {
    await addReferenceValue('skills', 'Welding', DIRECTOR);
    await addLocation('Atelier électrique — Lyon', 'workshop', DIRECTOR); // A-14: the director edits Settings
    const risk = (await getSettings()).lists.riskCats[1];
    await removeReferenceValue('riskCats', risk.code, DIRECTOR);
    await setHealthThresholds({ risk: 0.95 }, DIRECTOR);
    await setHealthThresholds({ off: 0.85 }, DIRECTOR);
    const v = await settings('en');
    const card = (key: string) => v.cards.find((c) => c.key === key)!;
    const gCard = (edit: string, key: string) => G.settingsEdits[edit].cards.find((c: any) => c.key === key);
    expect(card('skills').items.map((i) => i.label)).toEqual(gCard('addSkill', 'skills').items.map((i: any) => i.label));
    expect(card('locations').items.map((i) => [i.label, i.sub])).toEqual(gCard('addLocationWorkshop', 'locations').items.map((i: any) => [i.label, i.sub]));
    expect(card('riskCats').items.map((i) => i.label)).toEqual(gCard('removeRisk', 'riskCats').items.map((i: any) => i.label));
    expect(v.health.text).toBe(G.settingsEdits.thresholds.health.text);
    expect(v.kpis.map((k) => [k.value, k.sub])).toEqual([['7', '5 types in use'], ['11', 'Rated 1–5'], ['6', 'Per-project overrides allowed'], ['0.95 / 0.85', 'At-risk / off-track thresholds'], ['11', '2026 · France']]);
    await resetSettings(DIRECTOR);
    const r = await settings('en');
    expect(r.cards.map((c) => [c.key, c.items.map((i) => i.label)])).toEqual(G.settingsEdits.reset.cards.map((c: any) => [c.key, c.items.map((i: any) => i.label)]));
    expect(r.kpis).toEqual(kpis(G.en.settings.kpis));
  });
});

describe('Machine types view model', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  /** The prototype's "1 ITP systems" → "1 ITP system" (FR "1 système ITP"). */
  const singular = (sub: string, lang: Lang) => (lang === 'en' ? sub.replace(/ 1 ITP systems$/, ' 1 ITP system') : sub.replace(/ 1 systèmes ITP$/, ' 1 système ITP'));

  it.each(['en', 'fr'] as const)('%s: KPI tiles, the list and every selected type equal the prototype', async (lang) => {
    const v = await mtypes(lang);
    expect(v.kpis).toEqual(kpis(golden(lang, (g) => g.mtypes.kpis)));
    expect(v.list.map((m) => ({ code: m.displayCode, sub: m.sub, use: m.use, active: m.active, stateText: m.stateText, custom: m.custom, selected: m.selected })))
      .toEqual(golden(lang, (g) => g.mtypes.list.map((m: any) => ({ code: m.code, sub: m.sub, use: m.use, active: m.active, stateText: m.stateText, custom: m.custom, selected: m.bg !== 'transparent' })))
        .map((m: any) => ({ ...m, sub: singular(m.sub, lang) })));
    expect(v.list.map((m) => m.href)).toEqual(['EMP', 'MEMU', 'SPUR', 'AUTRE', 'rnd'].map((c) => machineTypesHref(c)));
    for (const code of ['EMP', 'MEMU', 'SPUR', 'AUTRE', 'R&D']) {
      const mt = (await mtypes(lang, code)).mt!;
      const g = golden(lang, (x) => x.mtypes.types[code]);
      const calLabel = mt.calendarOptions.find((o) => o.value === mt.calendar)!.label;
      expect({
        code: mt.displayCode, label: mt.label, desc: mt.description, stateText: mt.stateText, toggleLabel: mt.toggleLabel, dep: String(mt.deposit), deliv: String(mt.delivery),
        acc: String(mt.acceptance), termsOk: mt.termsOk, termsSum: mt.termsText, catTotal: mt.costTotal, noRefs: !mt.refs.length, noProjects: !mt.projects.length,
        phases: mt.phases.map((p, i) => ({ n: i + 1, name: p.display })), cats: mt.costCategories.map((c) => ({ name: c.name.display, type: mt.costTypeOptions.find((o) => o.value === c.type)!.label, budget: c.budget })),
        typeOpts: mt.costTypeOptions.map((o) => o.label), itp: mt.itpSystems.map((s) => s.display), refs: mt.refs.map((r) => r.name),
        projects: mt.projects.map((p) => ({ name: p.name, sub: p.sub, open: !!p.openHref })),
      }, `${lang} ${code}`).toEqual({
        code: g.code, label: g.label, desc: g.desc, stateText: g.stateText, toggleLabel: g.toggleLabel, dep: g.dep, deliv: g.deliv, acc: g.acc, termsOk: g.termsOk, termsSum: g.termsSum,
        catTotal: g.catTotal, noRefs: g.noRefs, noProjects: g.noProjects, phases: g.phases, cats: g.cats.map((c: any) => ({ name: c.name, type: c.type, budget: c.budget })), typeOpts: g.cats[0].typeOpts,
        // R-148 (NEW-D1-2): reference and linked project names as typed, i.e. their exact French entry ("Quai 7 — Anvers",
        // "Bloc opératoire — Lille"), not the prototype's segment translation that left them English.
        itp: g.itp, refs: g.refs.map((r: string) => (lang === 'fr' ? r.split(' · ').map((x, i) => (i === 1 ? dataText(x, 'fr') : x)).join(' · ') : r)), projects: g.projects.map((p: any) => ({ name: lang === 'fr' ? p.name.split(' · ').map((x: string, i: number) => (i === 1 ? dataText(x, 'fr') : x)).join(' · ') : p.name, sub: `${p.code} · ${p.status}`, open: p.open })),
      });
      // Calendar: the prototype's selected option; SPUR's site calendar (no option selected in the prototype, E-9) is
      // offered as "Site 6d · 10h". FR "Standard 5j · 8h" through the plan dictionary.
      const sel = g.calOpts.find((o: any) => o.selected)?.v ?? (lang === 'en' ? 'Site 6d · 10h' : 'Chantier 6j · 10h');
      expect(calLabel, `${lang} ${code}`).toBe(sel);
      expect(mt.calendarOptions.map((o) => o.label)).toEqual(g.calOpts.map((o: any) => o.v));
    }
    // Stored values are kept next to what the inputs show (French ITP names are written back unchanged).
    const emp = (await mtypes(lang, 'emp')).mt!;
    expect(emp.itpSystems[1].value).toBe('Hoist mechanisms');
    expect(emp.projects[0].openHref).toBe('/projects/HLT-026/plan');
    expect((await mtypes(lang, 'nope')).mt!.code).toBe('EMP');
  });

  it('after edits the KPIs, the list and the selected type follow the prototype (Deactivate, phases, categories, New machine type)', async () => {
    await updateMachineType('EMP', { active: false }, DIRECTOR);
    let v = await mtypes('en');
    expect(v.kpis).toEqual(kpis(G.mtypeEdits.deactivate.kpis));
    expect([v.mt!.stateText, v.mt!.toggleLabel, v.list[0].stateText]).toEqual([G.mtypeEdits.deactivate.mt.stateText, G.mtypeEdits.deactivate.mt.toggleLabel, 'Inactive']);
    await updateMachineType('EMP', { active: true }, DIRECTOR);
    expect((await mtypes('en')).kpis).toEqual(kpis(G.mtypeEdits.reactivate.kpis));

    await setMachineTypePhases('AUTRE', ['Design', 'Réalisation', 'Essais', 'Livraison', 'New phase'], QUALITY);
    expect((await mtypes('en', 'AUTRE')).mt!.phases.map((p) => p.display)).toEqual(G.mtypeEdits.phases.mt.phases.map((p: any) => p.name));

    const cats = G.mtypeEdits.cats.mt.cats.map((c: any) => ({ name: c.name, type: c.type.toLowerCase(), budgetKeur: Number(c.budget) }));
    await setMachineTypeCostCategories('EMP', cats, DIRECTOR);
    v = await mtypes('en', 'EMP');
    expect([v.mt!.costCategories.map((c) => [c.name.value, c.budget]), v.mt!.costTotal]).toEqual([
      G.mtypeEdits.cats.mt.cats.map((c: any) => [c.name, c.budget]), G.mtypeEdits.cats.mt.catTotal,
    ]);

    const code = await createMachineType({ code: ' new type ', label: 'Mobile hoist', base: 'MEMU', calendar: 'site_6x10', description: 'Test' }, DIRECTOR);
    v = await mtypes('en', code);
    const g = G.mtypeEdits.createFromMemu;
    expect(code).toBe(g.mtSel);
    expect(v.kpis.slice(0, 1)).toEqual(kpis(g.kpis).slice(0, 1));
    expect(v.list.at(-1)).toMatchObject({ displayCode: 'NEW-TYPE', sub: g.list.at(-1).sub, use: g.list.at(-1).use, custom: true, selected: true });
    expect({ label: v.mt!.label, desc: v.mt!.description, terms: v.mt!.termsText, total: v.mt!.costTotal, refs: v.mt!.refs.length, projects: v.mt!.projects.length, phases: v.mt!.phases.map((p) => p.value) })
      .toEqual({ label: g.mt.label, desc: g.mt.desc, terms: g.mt.termsSum, total: g.mt.catTotal, refs: 0, projects: 0, phases: g.mt.phases.map((p: any) => p.name) });
    expect(v.mt!.calendarOptions.find((o) => o.value === v.mt!.calendar)!.label).toBe('Site 6d · 10h');
  });
});

describe('Activity, integrations & audit view model', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it.each(['en', 'fr'] as const)('%s: KPI tiles, display, chips, feed, import / export and audit trail equal the prototype', async (lang) => {
    const v = await plumbing(lang);
    const g = (path: (x: any) => any) => golden(lang, path);
    // Deliberate: 10 connectors (Vigie added), all healthy but Outlook.
    const k = kpis(g((x) => x.plumbing.kpis));
    k[1] = { ...k[1], value: '10', sub: lang === 'en' ? '8 healthy · 1 warning' : '8 sains · 1 en alerte' };
    // A-12 (chapter 4, 10 OQ4): "Events today" = events of the data date (Paris day) — 5 on 25 Sep (the prototype's 6
    // included an event of 26 Sep).
    expect(k[0].value).toBe('6');
    k[0] = { ...k[0], value: '5' };
    expect(v.kpis).toEqual(k);
    expect(v.seg.map((o) => o.label)).toEqual(g((x) => x.plumbing.seg.map((o: any) => o.label)));
    expect(v.seg.map((o) => o.href)).toEqual(['/admin/integrations', '/admin/integrations?view=connectors', '/admin/integrations?view=imports', '/admin/integrations?view=audit']);
    const chips = g((x) => x.plumbing.chips.map((c: any) => [c.label, c.count]));
    if (lang === 'fr') chips[7][0] = 'Demande'; // the prototype's verb "Demander"
    expect(v.chips.map((c) => [c.label, c.count])).toEqual(chips);
    expect(v.chipValue).toBe('');
    expect(v.activity.map((a) => ({ when: a.when, who: a.who, what: a.what, icon: `ph ph-${a.icon}` }))).toEqual(g((x) => x.plumbing.actRows.map((a: any) => ({ when: a.when, who: a.who, what: a.what, icon: a.icon }))));
    expect(v.imports.map((f) => ({ name: f.name, desc: f.description, icon: `ph ph-${f.icon}` }))).toEqual(g((x) => x.plumbing.importRows));
    expect(v.audit.map((a) => ({ when: a.when, who: a.who, obj: a.object, change: a.change, area: a.area }))).toEqual(g((x) => x.plumbing.auditRows));
  });

  it.each(['en', 'fr'] as const)('%s: connectors — the prototype rows, Codex / Cursus / Vigie from the connector layer', async (lang) => {
    const v = await plumbing(lang, { view: 'connectors' });
    const g = golden(lang, (x) => x.plumbing.connRows);
    const rows = v.connectors.map((c) => ({ name: c.name, what: c.data, freq: c.frequency, st: c.status, last: c.last, vol: c.volume, tagClass: `tag tag-${c.tone}` }));
    const expected = g.map((r: any) => ({ ...r }));
    // Codex: last sync and record count of the Codex index connector (as the Documents screen).
    expected[1].last = lang === 'en' ? '29 Sep 08:02' : '29 sept. 08:02';
    if (lang === 'fr') expected[1].vol = '412 fiches · 38 liées à HLT-026';
    expect(rows.slice(0, 9)).toEqual(expected);
    expect(v.connectors.map((c) => c.mode)).toEqual(
      ['Cursus', 'Codex', 'Lucca', 'Sage X3', 'SolidWorks PDM', 'MS Project', 'Outlook / Exchange', 'Microsoft Teams', 'E-mail (SMTP)', 'Vigie'].map((n) =>
        ['Cursus', 'Codex', 'Vigie'].includes(n) ? (lang === 'en' ? 'Mock connector · local mirror' : 'Connecteur simulé · miroir local') : null,
      ),
    );
    expect(rows[9]).toEqual({
      name: 'Vigie',
      what: lang === 'en'
        ? 'Engineering change orders, non-conformities (NCR, 8D) and site HSE (prevention plans, permits) — managed in Vigie, Keystone records progress'
        : 'Ordres de modification, non-conformités (NCR, 8D) et HSE chantier (plans de prévention, permis) — gérés dans Vigie, Keystone enregistre l’avancement',
      freq: lang === 'en' ? 'Every minute (on read)' : 'Toutes les minutes (à la lecture)',
      st: 'OK', last: lang === 'en' ? '25 Sep 07:30' : '25 sept. 07:30',
      vol: lang === 'en' ? '6 ECOs · 15 NCRs · 5 HSE items' : '6 ECO · 15 NCR · 5 éléments HSE', tagClass: 'tag tag-neutral',
    });
    expect(v.connectors.map((c) => c.rawName)[9]).toBe('Vigie');
  });

  it('source chips filter the feed (links keep the display); the PM sees their own unread count', async () => {
    for (const [kind, g] of Object.entries(G.en.plumbing.byKind) as [string, any][]) {
      const v = await plumbing('en', { source: kind });
      expect(v.activity.map((a) => a.what), kind).toEqual(g.rows);
      expect(v.chipValue).toBe(kind);
    }
    const v = await plumbing('en', { source: 'nope' });
    expect([v.chipValue, v.activity.length]).toEqual(['', 12]);
    expect(v.chips.map((c) => c.href).slice(0, 3)).toEqual([integrationsHref(), integrationsHref({ source: 'sync' }), integrationsHref({ source: 'stock' })]);
    expect((await plumbing('en', { role: 'pm' })).kpis[2]).toEqual({ ...kpis(G.en.plumbing.kpisByRole.pm)[2] });
  });

  it('D-7b: the import cards are hidden while imports are off; the export cards stay', async () => {
    const formats = await listImportFormats();
    expect(visibleImportFormats(formats).map((f) => f.name)).toEqual(['Export — MS Project XML', 'Export — Excel', 'Export — PDF']);
    expect(visibleImportFormats(formats, true)).toHaveLength(6);
  });

  it.each(['en', 'fr'] as const)('%s: D-7a — a connector disabled by IT is listed as Disabled (calm tone)', async (lang) => {
    const [activity, connectors, imports, audit, counts] = await Promise.all([listActivity(), listAdminConnectors(), listImportFormats(), listAudit(), getPlumbingCounts()]);
    const off = connectors.map((c) => (c.name === 'Sage X3' ? { ...c, enabled: false } : c));
    const v = plumbingView({ view: 'connectors', source: null, activity, connectors: off, imports, audit, counts, unread: 0, personaTitle: 'Portfolio director' }, makeT(lang), lang);
    expect(v.connectors.find((c) => c.rawName === 'Sage X3')).toMatchObject({ status: lang === 'en' ? 'Disabled' : 'Désactivé', tone: 'neutral' });
  });
});
