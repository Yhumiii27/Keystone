// Site (chantier) view model and static render, from the seeded in-memory database (Cursus and Vigie mock
// connectors), in EN and FR, against the prototype's own render values (src/domain/site.golden.json: renderVals() EN
// and FR, deepTr applied). Deliberate deviations asserted inline:
// - the rotation plan headers are "From" / "To" (the prototype's "Issued by" / "Recipients" over the dates, 10 OQ8);
// - KPI values are strings ("4", not 4); the Go tag follows stTag (NO GO accent, GO neutral);
// - a report saved with the form shows its weather, headcount and HSE under the text (typed text is not run through
//   the segment translator).
// Also: which actions each viewer gets, the links to Cursus and Vigie, the empty state, the report links.
import { createElement as h, type ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('./actions', () => ({
  advancePrerequisiteAction: vi.fn(), confirmEquipmentAction: vi.fn(), remindInCursusAction: vi.fn(), syncCursusAction: vi.fn(), saveDailyReportAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, prefetch() {}, refresh() {} }), usePathname: () => '/projects/HLT-026/site' }));

import { renderToStaticMarkup } from 'react-dom/server';
import GOLDEN from '@/domain/site.golden.json';
import { I18nProvider } from '@/i18n/client';
import { fieldsText } from '@/i18n/data-text';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getSite, saveDailyReport } from '@/server/dal/site';
import type { SiteTab } from '@/domain/site';
import { messageText, siteText } from './i18n';
import { dailyReportFormDef, siteView } from './model';
import { SiteBody } from './site-view';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = GOLDEN as any;
const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, '’').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const kpis = (ks: any[]) => ks.map((k) => ({ label: k.label, value: String(k.value), sub: k.sub, color: k.color }));
/**
 * A-12 (chapter 4): tile `i` computed from the data instead of the prototype's literal — "Man-days planned" = Σ rotation
 * crew × working days on the project calendar (179, not 168); "Client decisions logged" (A-12 / D-5) = decisions recorded
 * in the minutes of the meetings with the client — MTG-117 steering committee (external): phased handover and CR-006
 * approved, 2 (prototype 3; between A-12 and D-5 it counted the change requests with a decided client step, CR-004 and
 * CR-006: also 2).
 */
const computed = (i: number, value: string) => (k: any, j: number) => (j === i ? { ...k, value } : k);
/**
 * D-6b 'a' (R-119): the site-team conflicts are computed from the rotation plan, the pool, Cursus and the absences — 8 on the
 * seed (the prototype's 4 authored collisions): Amélie Ollivier and Julien Wagner over 110 % in the week of 19 Oct and absent
 * during the mission, Thomas Kerbrat's pending ISPS badge and absence, Pauline Noguès's expiring HT clearance, Hélène
 * Sauvage's missing badge.
 */
const CONFLICTS = {
  en: [
    ['Amélie Ollivier', 'Load', 'Load above 110 % · week of 19 Oct: 120 %', 'Level the load in What-if or move the work', '/resources/what-if'],
    ['Amélie Ollivier', 'Leave', 'Leave 12 Oct → 23 Oct · during the mission', 'Move the mission or plan a replacement during the absence', '/resources/leave'],
    ['Julien Wagner', 'Load', 'Load above 110 % · week of 19 Oct: 125 %', 'Level the load in What-if or move the work', '/resources/what-if'],
    ['Julien Wagner', 'Leave', 'Leave 9 Nov · during the mission', 'Move the mission or plan a replacement during the absence', '/resources/leave'],
    ['Thomas Kerbrat', 'Document', 'Clearance pending · Badge ISPS pending · arrival 26 Oct', 'Chase the missing clearance in Cursus before arrival', '/projects/HLT-026/site#cursus'],
    ['Thomas Kerbrat', 'Leave', 'Leave 26 Oct → 6 Nov · during the mission', 'Move the mission or plan a replacement during the absence', '/resources/leave'],
    ['Pauline Noguès', 'Certificate', 'Clearance expiring · HT B2V expires 30 Nov 2026 · mission until 18 Dec', 'Renew the clearance before the end of the mission', '/resources/skills'],
    ['Hélène Sauvage', 'Document', 'Clearance missing · Badge ISPS missing · arrival 30 Nov', 'Chase the missing clearance in Cursus before arrival', '/projects/HLT-026/site#cursus'],
  ],
  fr: [
    ['Amélie Ollivier', 'Charge', 'Charge au-delà de 110 % · semaine du 19 oct. : 120 %', 'Lisser la charge dans What-if ou déplacer le travail'],
    ['Amélie Ollivier', 'Congés', 'Congés 12 oct. → 23 oct. · pendant la mission', 'Décaler la mission ou prévoir un remplaçant pendant l’absence'],
    ['Julien Wagner', 'Charge', 'Charge au-delà de 110 % · semaine du 19 oct. : 125 %', 'Lisser la charge dans What-if ou déplacer le travail'],
    ['Julien Wagner', 'Congés', 'Congés 9 nov. · pendant la mission', 'Décaler la mission ou prévoir un remplaçant pendant l’absence'],
    ['Thomas Kerbrat', 'Document', 'Habilitation en attente · Badge ISPS en attente · arrivée 26 oct.', 'Relancer l’habilitation manquante dans Cursus avant l’arrivée'],
    ['Thomas Kerbrat', 'Congés', 'Congés 26 oct. → 6 nov. · pendant la mission', 'Décaler la mission ou prévoir un remplaçant pendant l’absence'],
    ['Pauline Noguès', 'Habilitation', 'Habilitation qui expire · HT B2V expire le 30 nov. 2026 · mission jusqu’au 18 déc.', 'Renouveler l’habilitation avant la fin de la mission'],
    ['Hélène Sauvage', 'Document', 'Habilitation manquante · Badge ISPS manquant · arrivée 30 nov.', 'Relancer l’habilitation manquante dans Cursus avant l’arrivée'],
  ],
};

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

async function view(lang: Lang, code = 'HLT-026', tab: SiteTab = 'ready') {
  const data = await getSite(code);
  const t = makeT(lang);
  return { data, t, v: siteView(code, data, { tab }, t, lang) };
}

/**
 * R-148 (NEW-D1-2): a prerequisite's evidence is typed text — its date fields ("12 Sep · N. Bensaïd") are Keystone's
 * format and translated (fieldsText), a sentence typed around a date ("Demande déposée 20 Sep") stays as typed (the
 * prototype translated the month inside it).
 */
const evidenceAsTyped = (en: string, protoFr: string, lang: string) => (lang === 'fr' ? fieldsText(en, makeT('fr'), 'fr') : protoFr);

describe('Site view model vs the prototype (EN and FR)', () => {
  for (const lang of ['en', 'fr'] as const) {
    it(`${lang} · Readiness & go: KPIs, Go card, site sheet, prerequisites, equipment, Cursus approvals`, async () => {
      const g = G.seed[lang];
      const { v } = await view(lang);
      expect(v.segs.map((s) => s.label)).toEqual(g.seg);
      const r = v.ready!;
      // D-6b 'a' (R-119): 8 computed conflicts (the prototype's 4 authored ones).
      expect(r.kpis).toEqual(kpis(g.kpis).map(computed(4, '8')));
      expect([r.go.tag, r.go.tagClass]).toEqual([g.goLabel, 'tag tag-accent']);
      expect(r.go.items.map((i) => ({ label: i.label, ok: i.ok, sub: i.sub, icon: i.ok ? 'ph ph-check-circle' : 'ph ph-warning-circle', color: i.color }))).toEqual(
        g.goItems.map((i: any) => (i.sub === '4 collisions' ? { ...i, sub: '8 collisions' } : i)),
      );
      // D-3 'a' / R-028 (R-118): the sheet also shows its Cursus site — not created yet (Cursus has no site-creation endpoint).
      expect(r.meta.map((m) => [m.k, m.v])).toEqual([...g.meta, lang === 'fr' ? ['Chantier Cursus', 'Pas encore créé'] : ['Cursus site', 'Not created yet']]);
      expect(r.prereqs.map((p) => ({
        title: p.title, act: p.act, due: p.due, status: p.status, tagClass: p.tagClass, note: p.note, late: p.late, dueColor: p.dueColor,
        canConfirm: p.step?.to === 'confirmed', canSign: p.step?.to === 'signed',
      }))).toEqual(g.prereqs.map((p: any, i: number) => ({ ...p, note: evidenceAsTyped(G.seed.en.prereqs[i].note, p.note, lang) })));
      expect(r.equip.map((e) => ({ name: e.name, src: e.src, srcClass: e.srcClass, status: e.status, tagClass: e.tagClass, note: e.note, canConfirm: e.canConfirm }))).toEqual(
        g.equip.map((e: any, i: number) => ({ ...e, note: evidenceAsTyped(G.seed.en.equip[i].note, e.note, lang) })),
      );
      expect(r.cursus.rows.map((d) => ({
        who: d.who, visa: d.visa, visaClass: d.visaClass, vacc: d.vacc, vaccClass: d.vaccClass, hab: d.hab, habClass: d.habClass, habNote: d.habNote, habColor: d.habColor,
        status: d.status, tagClass: d.tagClass, rec: d.rec, canReq: d.remindable, reminded: d.reminded,
      }))).toEqual(g.docs);
      expect(r.cursus.lastSync).toBe(lang === 'en' ? 'Last sync 26 Sep 07:00' : 'Dernière synchro 26 sept. 07:00');
      expect(r.cursus.openUrl).toBe('http://localhost:5173/chantiers');
    });

    it(`${lang} · Team & mobilisation: KPIs, rotation plan, collisions, mission costs`, async () => {
      const g = G.seed[lang];
      const t = (await view(lang)).v.team!;
      // R-169: the Site premium sub names the rate grid (×1.5 / ×2 read from it) instead of the prototype's "6d · 10h calendar".
      const premium = { en: 'Saturday / Sunday rates · rate grid', fr: 'Taux samedi / dimanche · grille de taux' }[lang];
      // D-6b 'a' (R-119): "Collisions open" counts the 8 computed conflicts; Amélie Ollivier gets the icon too.
      expect(t.kpis).toEqual(kpis(g.teamKpis).map(computed(1, '179')).map(computed(2, '8')).map((k: any, i: number) => (i === 4 ? { ...k, sub: premium } : k)));
      expect(t.rotation.map((r) => ({
        who: r.who, role: r.role, from: r.from, to: r.to, lodging: r.lodging, travel: r.travel, rot: r.rot, collideIcon: r.collision ? 'ph ph-warning' : 'ph ph-check',
        collideColor: 'var(--color-accent-300)',
      }))).toEqual(g.rotation.map((r: any) => (r.who === 'Amélie Ollivier' ? { ...r, collideIcon: 'ph ph-warning' } : r)));
      expect(t.collisions.map((c) => [c.who, c.kind, c.what, c.fix])).toEqual(CONFLICTS[lang].map((x) => x.slice(0, 4)));
      expect(t.collisions.map((c) => c.tagClass)).toEqual(['tag tag-accent', 'tag tag-outline', 'tag tag-accent', 'tag tag-outline', 'tag tag-outline', 'tag tag-outline', 'tag tag-outline', 'tag tag-outline']);
      expect(t.collisions.map((c) => c.href)).toEqual(CONFLICTS.en.map((x) => x[4]));
      // No arbiter given: nobody may arbitrate; nothing is arbitrated on the seed.
      expect([t.collisions.some((c) => c.canArbitrate), t.arbitrated, t.noCollision]).toEqual([false, [], null]);
      // R-118: the prototype's columns, plus the line's position, its entry (none: no viewer entry here) and "Waiting for Sage X3" on an
      // actual not received (C-2a / A-12 'a': actuals are never typed).
      expect(t.missionCosts.map(({ name, budget, actual, pct, left }) => ({ name, budget, actual, pct, left }))).toEqual(g.missionCosts);
      expect(t.missionCosts.map((m) => [m.position, m.entry, m.actualTitle])).toEqual(
        g.missionCosts.map((m: any, i: number) => [i, null, m.actual === '—' ? (lang === 'fr' ? 'En attente de Sage X3' : 'Waiting for Sage X3') : null]),
      );
      expect([t.noRotation, t.noCost]).toEqual([null, null]);
    });

    it(`${lang} · Daily execution: KPIs, daily reports and their NCR link, site punch list, HSE register (Vigie)`, async () => {
      const g = G.seed[lang];
      const x = (await view(lang)).v.exec!;
      // A-12 / D-5: "Client decisions logged" 3 → 2 (decisions of the meetings with the client). A-6 'a' (R-117): "Punch list
      // open" counts the project's single list — 4 open items raised by inspections + 2 raised on site = 6 (still 1 on the client).
      expect(x.kpis).toEqual(kpis(g.execKpis).map(computed(4, '2')).map(computed(2, '6')));
      expect(x.reports.map((r) => ({ date: r.date, act: r.act, pct: r.pct, txt: r.txt, link: r.link, by: r.by }))).toEqual(g.reports);
      expect(x.reports.map((r) => !!r.href)).toEqual(g.reportLinks);
      expect(G.reportLink).toEqual({ screen: 'quality', qTab: 'ncr', ncr: 'NCR-029' });
      expect(x.reports[1].href).toBe('/projects/HLT-026/quality?ncr=NCR-029');
      expect(x.note).toBe(lang === 'en' ? 'Site starts 19 Oct — reports so far cover preparation visits.' : 'Le chantier démarre le 19 oct. — les rapports actuels couvrent les visites de préparation.');
      // A-6 'a' (R-117): the Site shows the items raised on site by default, numbered after the ITP items (P-01…P-03 → P-06…P-08).
      const renumbered = (id: string) => `P-0${+id.slice(2) + 5}`;
      expect(x.punch.map((p) => ({ id: p.id, title: p.title, ncr: p.ncr, status: p.status, tagClass: p.tagClass, owner: p.owner, due: p.due })))
        .toEqual(g.punch.map((p: any) => ({ ...p, id: renumbered(p.id) })));
      expect(x.hse.rows.map((r) => ({ title: r.title, status: r.status, tagClass: r.tagClass, date: r.date }))).toEqual(g.hse);
      // R-025 (V-3b "a"): Vigie's lists receive the project (`projet`, the Keystone code until NEW-SYS-1 / R-022).
      expect(x.hse.rows.map((r) => r.vigieUrl)).toEqual([
        'http://localhost:3200/prevention?projet=HLT-026', 'http://localhost:3200/prevention?projet=HLT-026', 'http://localhost:3200/prevention?onglet=permis&projet=HLT-026',
        'http://localhost:3200/prevention?onglet=permis&projet=HLT-026', 'http://localhost:3200/evenements?etat=tous&type=PA&projet=HLT-026',
      ]);
      expect(x.hse.reportUrl).toBe('http://localhost:3200/signaler?projet=HLT-026&lieu=Terminal+Harbor+Line+%E2%80%94+Quai+4%2C+Le+Havre+%28FR%29&source=keystone');
      expect(x.hse.listUrl).toBe('http://localhost:3200/prevention?projet=HLT-026');
      expect(x.hse.lastSync).toBe(lang === 'en' ? 'Last sync 25 Sep 07:30' : 'Dernière synchro 25 sept. 07:30');
    });
  }

  it('projects without a site sheet: the empty state, no tab', async () => {
    for (const code of ['NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012', 'EWA-051']) {
      expect(G.seed.en.others[code]).toMatchObject({ siteNotProj: true, badge: '' });
      const { v } = await view('en', code);
      // D-3 'a' (R-118): the leads prepare the sheet from the Études stage (the prototype: "opens when the project reaches the
      // Expédition stage").
      expect([v.empty, v.ready, v.team, v.exec]).toEqual([
        'No site sheet yet for this project — the project’s leads prepare it from the Études stage.', null, null, null,
      ]);
    }
    expect((await view('fr', 'NDC-031')).v.empty).toBe('Pas encore de fiche chantier pour ce projet — les responsables du projet la préparent dès l’étape Études.');
  });

  it('Daily report form: the prototype fields without HSE (NEW-SITE-2 a), weather codes as values, the status date by default, FR weather "Dégagé"', () => {
    const en = dailyReportFormDef(makeT('en'), 'en');
    expect([en.title, en.submit, en.kind]).toEqual([G.form.title, G.form.submit, 'create']);
    // NEW-SITE-2 'a' (R-122): the prototype's fifth field (HSE incident, AF.site) is gone — incidents are declared in Vigie.
    expect(G.form.fields[4][0]).toBe('incident');
    expect(en.fields.map((f) => [f.id, f.label, f.type, !!f.required])).toEqual(G.form.fields.slice(0, 4).map((f: any[]) => [f[0], f[1], f[2], !!f[4]]));
    expect(en.fields.map((f) => f.defaultValue ?? null)).toEqual(['25 Sep 2026', null, '24', null]);
    expect(en.fields[1].options).toEqual(G.form.fields[1][3].map((l: string, i: number) => ({ value: ['clear', 'rain', 'wind', 'storm'][i], label: l })));
    expect(en.note).toBeUndefined();
    const fr = dailyReportFormDef(makeT('fr'), 'fr');
    expect([fr.title, fr.submit, fr.fields.map((f) => f.label)]).toEqual(['Rapport journalier', 'Enregistrer le rapport', ['Date', 'Météo', 'Effectif sur site', 'Avancement']]);
    expect(fr.fields[0].defaultValue).toBe('25 sept. 2026');
    expect(fr.fields[1].options!.map((o) => (typeof o === 'string' ? o : o.label))).toEqual(['Dégagé', 'Pluie', 'Vent > 50 km/h', 'Tempête']);
    // The link to Vigie's incident form (prefilled with the project and the site) under the fields.
    const url = 'http://localhost:3200/signaler?projet=HLT-026&source=keystone';
    expect(dailyReportFormDef(makeT('en'), 'en', undefined, url).note).toEqual({ text: 'HSE incident?', linkLabel: 'Declare it in Vigie', href: url });
    expect(dailyReportFormDef(makeT('fr'), 'fr', undefined, url).note).toEqual({ text: 'Incident HSE ?', linkLabel: 'Déclarez-le dans Vigie', href: url });
  });

  it('FR counts agree in number (the shared rules gave "1 non confirmés", "1 conditions sur 5", "1 expédiés", "1 approbations")', () => {
    const t = makeT('fr');
    expect([
      '1 unconfirmed', '2 unconfirmed', '1 of 5 conditions open · start 19 Oct 2026', '1 shipped · 1 local / client', '0 consumed · site starts 19 Oct 2026', 'Recorded',
    ].map((x) => siteText(x, t, 'fr'))).toEqual([
      '1 non confirmé', '2 non confirmés', '1 condition sur 5 ouverte · démarrage 19 oct. 2026', '1 expédié · 1 local / client', '0 consommé · démarrage chantier 19 oct. 2026', 'Enregistré',
    ]);
    expect(['Cursus sync · 1 approvals received', 'Cursus sync · 5 approvals received · 1 sent · 0 failed'].map((x) => messageText(x, t, 'fr'))).toEqual([
      'Synchro Cursus · 1 approbation reçue', 'Synchro Cursus · 5 approbations reçues · 1 envoyée · 0 en échec',
    ]);
  });

  it('"Remind in Cursus" keys on Cursus’s name of the person, not on the displayed text', async () => {
    const { v } = await view('fr');
    expect(v.ready!.cursus.rows.filter((r) => r.remindable).map((r) => r.person)).toEqual(['Thomas Kerbrat', 'Pauline Noguès', 'Hélène Sauvage']);
  });
});

describe('Site static render', () => {
  const render = async (lang: Lang, tab: SiteTab, canEdit: boolean, code = 'HLT-026') => {
    const { v, t } = await view(lang, code, tab);
    return html(h(SiteBody, { code, view: v, canEdit, t }), lang);
  };

  it('Readiness & go for an editor: steps, Confirm, Remind in Cursus, Sync Cursus, Open Cursus (new window), privacy notice', async () => {
    const out = await render('en', 'ready', true);
    const txt = text(out);
    expect(txt).toContain('Go chantier — five conditions');
    expect(txt).toContain('NO GO');
    expect(out.match(/>Client confirms</g)).toHaveLength(2);
    expect(out.match(/>Signed on site</g)).toHaveLength(2);
    expect(out.match(/>Confirm</g)).toHaveLength(2);
    expect(out.match(/>Remind in Cursus</g)).toHaveLength(3);
    expect(txt).toContain('Sync Cursus');
    expect(out).toMatch(/<a href="http:\/\/localhost:5173\/chantiers" target="_blank" rel="noopener noreferrer"[^>]*>.*Open Cursus/);
    expect(txt).toContain('no personal data is imported or stored');
    expect(txt).toContain('Mirrored from Cursus — verdicts are managed in Cursus · Last sync 26 Sep 07:00');
    expect(out).toContain('id="cursus"');
    // Table headers (template 2281–2284).
    for (const th of ['Prerequisite', 'Conditions activity', 'Needed by', 'Evidence', 'Equipment', 'Source', 'Person', 'Visa', 'Vaccinations', 'Clearances &amp; badges', 'Cursus verdict', 'Received'])
      expect(out).toContain(`>${th}</th>`);
  });

  it('read-only / outside viewers: no step, no Confirm, no reminder, no sync — the Cursus link stays', async () => {
    const out = await render('fr', 'ready', false);
    for (const b of ['Le client confirme', 'Signé sur site', '>Confirmer<', 'Relancer dans Cursus', 'Synchroniser Cursus']) expect(out).not.toContain(b);
    expect(out).toContain('Ouvrir Cursus');
    expect(text(out)).toContain('Go / No Go individuel — Cursus');
  });

  it('Team & mobilisation: From / To headers (not "Issued by" / "Recipients"), collision icons named, Resolve links, cost bars', async () => {
    const out = await render('en', 'team', true);
    expect(out).toContain('>From</th>');
    expect(out).toContain('>To</th>');
    expect(out).not.toMatch(/Issued by|Recipients/);
    // D-6b 'a' (R-119): 5 people with a computed conflict (Amélie Ollivier too), the contractor crew without; 8 conflicts.
    expect(out.match(/aria-label="Collision"/g)).toHaveLength(5);
    expect(out.match(/aria-label="No collision"/g)).toHaveLength(1);
    expect(out.match(/>Resolve</g)).toHaveLength(8);
    expect(out).not.toContain('Lucca');
    expect(out).toContain('Same person on two sites · overload · leave and absences · clearance expiring · badge missing');
    expect(out).toContain('href="/resources/what-if"');
    expect(out).toContain('--w:34%');
    const fr = await render('fr', 'team', true);
    expect(fr).toContain('>Du</th>');
    expect(fr).toContain('>Au</th>');
  });

  it('Daily execution: NCR link row, footnote, punch list, HSE register with Open in Vigie, Declare incident in Vigie, no HSE editing', async () => {
    const out = await render('en', 'exec', true);
    expect(out).toContain('href="/projects/HLT-026/quality?ncr=NCR-029"');
    expect(text(out)).toContain('Site starts 19 Oct — reports so far cover preparation visits.');
    expect(out.match(/aria-label="Open in Vigie — /g)).toHaveLength(5);
    expect(out).toMatch(/href="http:\/\/localhost:3200\/signaler\?[^"]*" target="_blank" rel="noopener noreferrer"[^>]*title="Report in Vigie"/);
    expect(text(out)).toContain('Declare incident');
    expect(text(out)).toContain('Manage in Vigie');
    expect(text(out)).toContain('Mirrored from Vigie — HSE is managed in Vigie · Last sync 25 Sep 07:30');
    expect(text(out)).toContain('Client communication log');
  });

  it('a project without a site sheet renders the empty state only', async () => {
    const out = await render('en', 'ready', true, 'NDC-031');
    // D-3 'a' (R-118): the empty state's sentence (this viewer gets no "Prepare the site": the view is built without entry).
    expect(text(out).trim()).toBe('No site sheet yet for this project — the project’s leads prepare it from the Études stage.');
  });
});

describe('a daily report saved with the form (last: writes to the database)', () => {
  it('listed first with its weather and headcount under the text (no HSE: NEW-SITE-2 a); typed text kept as typed in FR; man-days follow', async () => {
    await saveDailyReport('HLT-026', { date: '2026-09-25', weather: 'clear', headcount: 8, progress: 'Montage poteaux · Mon équipe' }, { name: 'Julien Wagner', role: 'member' });
    const en = (await view('en', 'HLT-026', 'exec')).v.exec!;
    expect(en.reports[0]).toMatchObject({ number: 'DR-003', date: '25 Sep', act: '—', pct: '—', txt: 'Montage poteaux · Mon équipe', detail: 'Clear · 8 on site', link: '—', href: null, by: 'J. Wagner' });
    expect(en.kpis[1]).toMatchObject({ value: '3' });
    // A-12 (chapter 4): the HSE tile counts the incidents Vigie (the HSE owner) reports, not the daily report's field.
    expect(en.kpis[3]).toMatchObject({ value: '0 incident', sub: '2 permits pending' });
    const fr = (await view('fr', 'HLT-026', 'exec')).v.exec!;
    expect(fr.reports[0]).toMatchObject({ date: '25 sept.', txt: 'Montage poteaux · Mon équipe', detail: 'Dégagé · 8 sur site' });
    // Before the site start the headcount is preparation, not man-days on site.
    expect((await view('en', 'HLT-026', 'team')).v.team!.kpis[1].sub).toBe('0 consumed · site starts 19 Oct 2026');
  });
});

describe('D-5 — "Client communication log" opens the client decisions of the project meetings', () => {
  it('is a link to Meetings › Decisions › With the client (no drawer); hidden when the page says so', async () => {
    const { v, t } = await view('en', 'HLT-026', 'exec');
    const shown = html(h(SiteBody, { code: 'HLT-026', view: v, canEdit: false, t }), 'en');
    expect(shown).toMatch(/<a [^>]*href="\/projects\/HLT-026\/meetings\?view=decisions&amp;decisions=client"[^>]*>.*Client communication log<\/a>/);
    expect(shown).not.toContain('aria-haspopup="dialog"');
    expect(html(h(SiteBody, { code: 'HLT-026', view: v, canEdit: false, showCommLog: false, t }), 'en')).not.toContain('Client communication log');
    const fr = await view('fr', 'HLT-026', 'exec');
    expect(text(html(h(SiteBody, { code: 'HLT-026', view: fr.v, canEdit: false, t: fr.t }), 'fr'))).toContain('Journal de communication client');
  });

  it('"Client decisions logged" counts the decisions of the meetings with the client', async () => {
    // HLT-026: MTG-117 (steering committee, external) holds 2 decisions; MTG-118 / MTG-116 are internal.
    expect((await getSite('HLT-026'))!.clientDecisions).toBe(2);
  });
});
