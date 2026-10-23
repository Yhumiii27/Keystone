// ITP · punch list and Commissioning view models and static render, from the seeded in-memory database, in EN and FR.
// Expected values are the prototype's own render values (design lines 3096–5239 run in node:vm, renderVals() for the
// director, EN and FR — deepTr applied; src/domain/itpcom.golden.json), except the deliberate deviations noted inline:
// French singular forms ("1 échouée"), the punch step "Clôturer" (the prototype left "Close" in English), the Codex
// record buttons as links, and the punch list's empty panel ("No punch item yet") on a project without punch items. A-6 'a'
// (R-117): the screens read the project's single punch list — HLT-026's 3 items raised on site (P-06…P-08) join the
// prototype's 5 ITP items (the "Open punch items" tile and the list follow; Blocking A is unchanged: they are B).
import { createElement as h, type ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('./actions', () => ({ addInspectionAction: vi.fn(), addPunchItemAction: vi.fn(), advancePunchItemAction: vi.fn(), planSatAction: vi.fn() }));

import { renderToStaticMarkup } from 'react-dom/server';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import GOLDEN from '@/domain/itpcom.golden.json';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getCommissioning } from '@/server/dal/commissioning';
import { getItpPlan, listItpSystems, listPunchItems, projectMachineTypeLabel } from '@/server/dal/itp';
import { teamOwnerOptions } from '@/server/dal/team';
import { CommissioningBody } from './commissioning-view';
import { inspectionFormDef, localizeForm, planSatFormDef, punchFormDef } from './forms';
import { ItpBody } from './itp-view';
import { commissioningScreenView, itpHref, itpScreenView, itpViewOf, type ItpViewKey } from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = GOLDEN as any;
const PROJECTS = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012', 'EWA-051'];
const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

async function itp(lang: Lang, code = 'HLT-026', view: ItpViewKey = 'plan') {
  const [plan, punch, machineType] = await Promise.all([getItpPlan(code), listPunchItems(code), projectMachineTypeLabel(code)]);
  const t = makeT(lang);
  return { t, view: itpScreenView({ code, view, plan, punch, machineType, today: DEMO_TODAY_ISO }, t, lang) };
}
async function cm(lang: Lang, code = 'HLT-026') {
  const [c, punch] = await Promise.all([getCommissioning(code), listPunchItems(code)]);
  const t = makeT(lang);
  return { t, c, view: commissioningScreenView(code, c, punch, DEMO_TODAY_ISO, t, lang) };
}

/** Golden KPI tiles as the view shows them (values as strings). */
const kpis = (ks: any[]) => ks.map((k) => ({ label: k.label, value: String(k.value), sub: k.sub, color: k.color }));
/** French singular forms of the rebuild (deviation: the prototype wrote "1 échouées"). */
const frSingular = (s: string) => s.replace(/^1 échouées/, '1 échouée');
/**
 * A-6 'a' (R-117): HLT-026's "Open punch items" counts the 2 open items raised on site too (both B): 4 → 6, B 2 → 4. R-185 part 2:
 * and the open C item of its EQ-02 demo line (P-09): 6 → 7, C 2 → 3.
 */
const unifiedPunch = (code: string) => (k: { label: string; value: string; sub: string; color: string }, i: number) =>
  code === 'HLT-026' && i === 2 ? { ...k, value: '7', sub: 'A 0 · B 4 · C 3' } : k;

describe('ITP · plan view', () => {
  it.each(PROJECTS)('%s EN / FR: KPI tiles, groups and rows equal the prototype', async (code) => {
    for (const lang of ['en', 'fr'] as const) {
      const g = G.itp[lang][code].plan;
      const { view } = await itp(lang, code);
      expect(view.kpis).toEqual(kpis(g.kpis).map((k) => ({ ...k, sub: frSingular(k.sub) })).map(unifiedPunch(code)));
      expect(view.views.map((o) => o.label)).toEqual(g.seg.map((o: any) => o.label));
      expect(view.plan!.groups.map((x) => ({ sys: x.system, passed: x.passedText, rows: x.rows.map((r) => [r.number, r.name, r.type, r.typeClass, r.stage, r.reference, r.date, r.status, r.statusClass, r.statusColor, r.doc?.ref ?? '']) }))).toEqual(
        g.groups.map((x: any) => ({ sys: x.sys, passed: `${x.passed} / ${x.count}`, rows: x.rows.map((r: any) => [r.id, r.name, r.type, r.typeClass, r.stage, r.ref, r.date, r.status, r.stClass, r.stColor, r.doc]) })),
      );
      expect(!!view.plan!.empty).toBe(g.noItp);
      expect(view.punch).toBeNull();
    }
  });

  it('empty plan text, the Codex record buttons (record drawer of the vault), view links', async () => {
    expect((await itp('fr', 'NDC-031')).view.plan!.empty).toBe('Pas encore de plan d’inspection · choisissez un gabarit à la création du projet');
    const { view } = await itp('en');
    const docs = view.plan!.groups.flatMap((g) => g.rows).filter((r) => r.doc).map((r) => [r.number, r.doc!.href, r.doc!.label]);
    expect(docs).toEqual([
      ['I-01', '/projects/HLT-026/documents?doc=REC-HLT-007', 'Open document REC-HLT-007'],
      ['I-03', '/projects/HLT-026/documents?doc=NCR-HLT-031', 'Open document NCR-HLT-031'],
      ['I-08', '/projects/HLT-026/documents?doc=COC-HLT-012', 'Open document COC-HLT-012'],
      ['I-10', '/projects/HLT-026/documents?doc=RPT-HLT-016', 'Open document RPT-HLT-016'],
    ]);
    expect(view.views.map((o) => o.href)).toEqual(['/projects/HLT-026/itp', '/projects/HLT-026/itp?view=punch']);
    expect([itpViewOf('punch'), itpViewOf('PUNCH'), itpViewOf(undefined), itpViewOf(['punch'] as never), itpHref('NDC-031', 'punch')]).toEqual(['punch', 'plan', 'plan', 'plan', '/projects/NDC-031/itp?view=punch']);
  });

  it('static render (FR): Display switch, group headers, tags 10.5px, record buttons', async () => {
    const { t, view } = await itp('fr');
    const out = html(ItpBody({ code: 'HLT-026', view, canEdit: true, t }), 'fr');
    for (const s of [
      'Vue', 'Plan d’inspection et d’essais', 'Liste de réserves', 'aria-current="true"', 'href="/projects/HLT-026/itp?view=punch"', 'Mécanismes de levage', '2 / 4',
      'Contrôle soudures — poutres principales G1–G4', 'Point d’arrêt', 'ISO 5817 · level B', '9 sept.', 'Conforme', 'color:var(--color-accent-300)',
      'href="/projects/HLT-026/documents?doc=REC-HLT-007"', 'aria-label="Ouvrir le document REC-HLT-007"', 'Inspections réussies', '1 échouée · NCR émise',
    ])
      expect(out).toContain(s);
    expect(out).not.toContain('Pas encore de plan');
    expect(out).not.toContain('Émise par');
  });
});

describe('ITP · punch view', () => {
  it('EN / FR: rows equal the prototype; the step "Clôturer" in French (deviation)', async () => {
    for (const lang of ['en', 'fr'] as const) {
      const g = G.itp[lang]['HLT-026'].punch;
      const { view } = await itp(lang, 'HLT-026', 'punch');
      expect(view.plan).toBeNull();
      expect([view.punch!.title, view.punch!.subtitle]).toEqual(lang === 'en' ? ['Punch list', 'A blocking · B before SAT · C cosmetic'] : ['Liste de réserves', 'A bloquante · B avant SAT · C esthétique']);
      // A-6 'a' (R-117): the prototype's 5 ITP items first (origin Inspection), then the 3 items raised on site.
      expect(view.punch!.rows.slice(0, 5).map((r) => [r.number, r.item, r.location, r.category, r.categoryClass, r.source, r.owner, r.due, r.status, r.statusClass, r.color, r.step?.label ?? null])).toEqual(
        g.punch.map((r: any) => [r.id, r.item, r.loc, r.cat, r.catClass, r.src, r.owner, r.due, r.status, r.stClass, r.color, r.canAdvance ? (lang === 'fr' && r.next === 'Close' ? 'Clôturer' : r.next) : null]),
      );
      // "Inspection" and "Site" read the same in French.
      // R-185 part 2: + Harbor Line's EQ-02 demo item (P-09), raised by inspection.
      expect(view.punch!.rows.map((r) => r.origin)).toEqual([...Array(5).fill('Inspection'), ...Array(3).fill('Site'), 'Inspection']);
      expect(view.punch!.rows.slice(5, 8).map((r) => [r.number, r.category, r.ncr, r.owner, r.status, r.step?.label ?? null])).toEqual([
        ['P-06', 'B', 'NCR-029', 'Client', lang === 'en' ? 'Open' : 'Ouverte', lang === 'en' ? 'Start' : 'Démarrer'],
        ['P-07', 'B', '—', 'Keystone', lang === 'en' ? 'Open' : 'Ouverte', lang === 'en' ? 'Start' : 'Démarrer'],
        ['P-08', 'B', '—', 'Client', lang === 'en' ? 'Closed' : 'Clôturée', null],
      ]);
    }
    expect((await itp('fr', 'HLT-026', 'punch')).view.punch!.rows[3].step).toEqual({ label: 'Clôturer', ariaLabel: 'Clôturer · P-04', from: 'in_progress' });
  });

  it('static render: headers, steps for editors only', async () => {
    const { t, view } = await itp('fr', 'HLT-026', 'punch');
    const edit = html(ItpBody({ code: 'HLT-026', view, canEdit: true, t }), 'fr');
    for (const s of ['aria-label="Référence"', 'Élément', 'Système', 'Cat.', 'Émise par', 'Responsable', 'Échéance', 'Statut', 'aria-label="Démarrer · P-02"', 'aria-label="Clôturer · P-04"', 'data-punch-step', 'Inspection client'])
      expect(edit).toContain(s);
    // A-6 'a' (R-117): Start / Close on every open item, the 2 open items raised on site included (4 → 6).
    // R-185 part 2: + the open item of Harbor Line's EQ-02 demo line (P-09): 7.
    expect(edit.match(/data-punch-step/g)?.length).toBe(7);
    const ro = html(ItpBody({ code: 'HLT-026', view, canEdit: false, t }), 'fr');
    expect(ro).not.toContain('data-punch-step');
    expect(ro).toContain('Clôturée');
  });

  it('an item added without due date shows an empty Due cell (as the prototype), the step carries the status it starts from', async () => {
    const [plan, punch] = await Promise.all([getItpPlan('HLT-026'), listPunchItems('HLT-026', 'itp')]);
    const added = { ...punch[1], number: 'P-10', dueOn: null, location: '' };
    const { punch: p } = itpScreenView({ code: 'HLT-026', view: 'punch', plan, punch: [...punch, added], machineType: null, today: DEMO_TODAY_ISO }, makeT('en'), 'en');
    expect(p!.rows.at(-1)).toMatchObject({ number: 'P-10', location: '', due: '', step: { label: 'Start', ariaLabel: 'Start · P-10', from: 'open' } });
    // R-185 part 2: P-09 (Harbor Line's EQ-02 demo item, open) before the added one.
    expect(p!.rows.map((r) => r.step?.from ?? null)).toEqual([null, 'open', 'open', 'in_progress', 'open', 'open', 'open']);
  });

  it('project without punch items: zero KPIs, the empty panel instead of a bare header row (deviation)', async () => {
    const { view } = await itp('en', 'EWA-051', 'punch');
    expect([view.punch!.rows, view.punch!.empty, view.kpis.map((k) => [k.value, k.sub])]).toEqual([
      [], 'No punch item yet', [['0 / 0', '0 failed · NCR raised'], ['0', 'client presence required'], ['0', 'A 0 · B 0 · C 0'], ['—', 'standard template for this machine type']],
    ]);
    expect((await itp('en', 'HLT-026', 'punch')).view.punch!.empty).toBeNull();
    const fr = await itp('fr', 'EWA-051', 'punch');
    const out = html(ItpBody({ code: 'EWA-051', view: fr.view, canEdit: true, t: fr.t }), 'fr');
    expect(out).toContain('Aucune réserve pour l’instant');
    expect(out).not.toContain('<table');
  });
});

describe('Commissioning', () => {
  it('EN / FR: KPI tiles, columns, grid cells, Blocking A, dossier equal the prototype', async () => {
    for (const lang of ['en', 'fr'] as const) {
      const g = G.commissioning[lang]['HLT-026'];
      const { view } = await cm(lang);
      // R-185 part 2: + the system of Harbor Line's EQ-02 demo line (5 planned steps): 0 / 6 → 0 / 7 systems, 1 / 30 → 1 / 35 steps.
      const plusEq02 = (k: { label: string; value: string }, i: number) => (i === 0 ? { ...k, value: '0 / 7' } : i === 1 ? { ...k, value: '1 / 35' } : k);
      expect(view!.kpis).toEqual(kpis(g.kpis).map(plusEq02));
      // NEW-D5-3 'a' (R-156): the prototype's French 'Handover' column « Livraison » is « Transfert ».
      expect(view!.columns).toEqual(lang === 'fr' ? g.cols.map((c: string) => (c === 'Livraison' ? 'Transfert' : c)) : g.cols);
      // R-185 part 2: the prototype's rows are EQ-01's group; EQ-02's system follows.
      expect(view!.groups.map((x) => x.rows.length)).toEqual([6, 1]);
      expect(view!.rows.slice(0, 6).map((r) => ({ sys: r.system, punchA: r.blockingA, cells: r.cells.map((c) => [c.status, c.date, c.bg, c.border, c.color]) }))).toEqual(
        g.rows.map((r: any) => ({ sys: r.sys, punchA: r.punchA, cells: r.cells.map((c: any) => [c.st, c.date, c.bg, c.border, c.color]) })),
      );
      expect(view!.dossier.map((d) => [d.item, d.type, d.status, d.statusClass, d.doc?.ref ?? ''])).toEqual(g.dossier.map((d: any) => [d.item, d.type, d.status, d.stClass, d.doc]));
    }
  });

  it('projects without a commissioning plan: no view (the empty panel)', async () => {
    for (const code of PROJECTS.slice(1)) expect((await cm('en', code)).view).toBeNull();
    const t = makeT('fr');
    const out = html(CommissioningBody({ view: null, t }), 'fr');
    expect(out).toContain('Pas encore de plan de mise en service · les systèmes viennent du gabarit d’inspection');
  });

  it('static render (FR): grid geometry, cell icons, dossier buttons', async () => {
    const { t, view } = await cm('fr');
    const out = html(CommissioningBody({ view, t }), 'fr');
    for (const s of [
      'Mise en service par système', 'Fin de montage', 'Réserves A', 'role="table"', 'role="rowheader"', 'Électrique HT/BT', 'Bloquée', 'IF-02',
      'border:1px dashed var(--color-accent)', 'Dossier de transfert', 'Type de document', 'Plans tels que construits', 'href="/projects/HLT-026/documents?doc=MAN-HLT-015"',
      'Systèmes transférés', 'SAT prévue 10 déc. · transfert 14 janv.', '19 %', '4 éléments manquants',
    ])
      expect(out).toContain(s);
    // R-185 part 2: two equipment lines — a header row per line (EQ-01 · EMP, EQ-02 · 3 × MEMU) and EQ-02's system (6 cells).
    expect(out.match(/role="row"/g)?.length).toBe(10);
    expect(out.match(/role="cell"/g)?.length).toBe(42);
    expect(out).toContain('EQ-02 · 3 × MEMU');
    expect(out).toContain('Modules MEMU M1–M3');
  });
});

describe('action forms', () => {
  it('"Add inspection" EN / FR: the prototype fields; codes as values; systems of the template', async () => {
    for (const lang of ['en', 'fr'] as const) {
      const g = G.forms[lang].itp;
      const f = localizeForm(inspectionFormDef(await listItpSystems('HLT-026')), makeT(lang), lang);
      expect([f.title, f.submit, f.kind]).toEqual([g.title, g.submit, 'create']);
      // Deviation: "Standard / reference" has its French ("Norme / référence"; the prototype left it in English).
      expect(f.fields.map((x) => [x.id, x.label, !!x.required])).toEqual(g.fields.map((x: any) => [x.id, x.id === 'ref' && lang === 'fr' ? 'Norme / référence' : x.label, x.req]));
      expect(f.fields.map((x) => (x.options ?? []).map((o) => (typeof o === 'string' ? o : o.label)))).toEqual(g.fields.map((x: any) => x.options));
    }
    const f = inspectionFormDef(await listItpSystems('NDC-031'));
    expect(f.fields[1].options).toEqual(G.forms.en.itpNdc.fields[1].options);
    expect(f.fields[2].options).toEqual([{ value: 'hold', label: 'Hold' }, { value: 'witness', label: 'Witness' }, { value: 'review', label: 'Review' }, { value: 'surveillance', label: 'Surveillance' }]);
  });

  it('"Add punch item" EN / FR: the prototype fields; TEAM owners (full names)', async () => {
    const team = await teamOwnerOptions('HLT-026');
    for (const lang of ['en', 'fr'] as const) {
      const g = G.forms[lang].punch;
      const all = localizeForm(punchFormDef(team), makeT(lang), lang);
      // A-6 'a' (R-117): origin, owner party and the NCR (internal viewers) follow the prototype's six fields.
      expect(all.fields.slice(6).map((x) => x.id)).toEqual(['origin', 'party', 'ncr']);
      const f = { ...all, fields: all.fields.slice(0, 6) };
      expect([f.title, f.submit]).toEqual([g.title, g.submit]);
      expect(f.fields.map((x) => [x.id, x.label, !!x.required])).toEqual(g.fields.map((x: any) => [x.id, x.label, x.req]));
      // R-041 (P-2): Harbor Line's named team adds the seeded referents to the prototype's TEAM owners. A-6 'a' (R-117): "—"
      // first (no person, the party owns the item), the first TEAM name stays the default.
      expect(f.fields.map((x) => (x.options ?? []).map((o) => (typeof o === 'string' ? o : o.label)))).toEqual(
        g.fields.map((x: any) => (x.id === 'owner' ? ['—', ...x.options, 'Antoine Girard', 'Gabriel Comte'] : x.options)),
      );
      expect(f.fields[4].defaultValue).toBe(g.fields[4].value);
      expect(f.fields[2].options).toEqual([
        { value: 'A', label: g.fields[2].options[0] }, { value: 'B', label: g.fields[2].options[1] }, { value: 'C', label: g.fields[2].options[2] },
      ]);
    }
  });

  it('"Plan SAT" EN / FR: run form, defaults (date of the first SAT, client contacts, prerequisites)', async () => {
    const { c } = await cm('en');
    for (const lang of ['en', 'fr'] as const) {
      const g = G.forms[lang].commissioning;
      const f = localizeForm(planSatFormDef(c!.systems.map((x) => x.name), { date: '10 Dec 2026', witnesses: 'N. Bensaïd, K. Doucouré' }), makeT(lang), lang);
      expect([f.title, f.submit, f.kind]).toEqual([g.title, g.submit, 'run']);
      expect(f.fields.map((x) => [x.id, x.label, !!x.required])).toEqual(g.fields.map((x: any) => [x.id, x.label, x.req]));
      // Deviation: the prerequisites default has its French (the prototype left it in English).
      expect(f.fields.map((x) => x.defaultValue ?? (x.options ? (x.options[0] as { label?: string }).label ?? x.options[0] : ''))).toEqual(
        g.fields.map((x: any) => (x.id === 'note' && lang === 'fr' ? 'Réserves A levées · rapports de pré-mise en service émis' : x.value)),
      );
      // R-185 part 2: + the system of Harbor Line's EQ-02 demo line.
      expect(f.fields[0].options!.map((o) => (typeof o === 'string' ? o : o.value))).toEqual([...G.forms.en.commissioning.fields[0].options, 'MEMU modules M1–M3']);
    }
  });
});
