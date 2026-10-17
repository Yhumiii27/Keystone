// Stakeholders & RACI and Interface register view models and static render, from the seeded in-memory database, in
// EN and FR. Expected values are the prototype's own render values (design lines 3096–5239 run in node:vm,
// renderVals() for director, EN and FR — deepTr applied), except the deliberate deviations noted inline:
// "> 30 j" (the prototype left "> 30 d" in French), the feminine interface statuses "Reçue" / "Gelée", and the
// "Blocking commissioning" sub listing only the blockers still open.
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { createElement as h, type ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('./actions', () => ({ addStakeholderAction: vi.fn(), createInterfaceAction: vi.fn(), markInterfaceReceivedAction: vi.fn(), freezeInterfaceAction: vi.fn() }));

import { renderToStaticMarkup } from 'react-dom/server';
import GOLDEN from '@/server/dal/delivery3.golden.json';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getInterfacesScreen, getStakeholdersScreen } from '@/server/dal/team';
import { interfaceFormDef, localizeForm, stakeholderFormDef } from './forms';
import { formT } from './i18n';
import { InterfacesBody } from './interfaces-view';
import { interfacesView, stakeholdersView } from './model';
import { StakeholdersBody } from './stakeholders-view';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const LO = 'var(--color-accent-300)';
const OK = 'var(--color-text)';

async function stk(lang: Lang, code = 'HLT-026') {
  const d = (await getStakeholdersScreen(code))!;
  const t = makeT(lang);
  return { t, d, view: stakeholdersView(d.register, t, lang) };
}
async function ifc(lang: Lang, code = 'HLT-026') {
  const d = (await getInterfacesScreen(code))!;
  const t = makeT(lang);
  return { t, d, view: interfacesView(d.interfaces, d.blockers, t, lang, DEMO_TODAY_ISO) };
}

describe('Stakeholders & RACI view model', () => {
  it('EN: KPI tiles and rows equal the prototype (renderValsEN golden)', async () => {
    const { view } = await stk('en');
    expect(view.kpis).toEqual(GOLDEN.stakeholders.kpis.map((k) => ({ ...k, value: String(k.value) })));
    expect(view.rows.map((r) => [r.name, r.sub, r.type, r.owner, r.lastText, r.contactText, r.notes, r.initials])).toEqual(
      GOLDEN.stakeholders.rows.map((r) => [r.name, `${r.org} · ${r.role}`, r.type, r.owner, r.lastText, r.contactText, r.notes, r.initials]),
    );
    expect(view.rows.map((r) => r.typeClass)).toEqual(['tag tag-accent', 'tag tag-accent', 'tag tag-outline', 'tag tag-neutral', 'tag tag-neutral', 'tag tag-outline', 'tag tag-outline', 'tag tag-outline']);
    expect(view.rows.map((r) => r.lastColor)).toEqual([...Array(6).fill('var(--color-neutral-400)'), LO, 'var(--color-neutral-400)']);
    expect(view.empty).toBeNull();
    expect(view.raci!.columns).toEqual(GOLDEN.stakeholders.cols);
    expect(view.raci!.rows.map((r) => [r.label, ...r.cells.map((c) => c.v)])).toEqual(GOLDEN.stakeholders.raci);
    expect([view.raci!.template, view.raci!.minWidth]).toEqual(['220px repeat(6, minmax(96px,1fr))', 820]);
    // Cell colours (raciRows 4935): A, R, C, empty, I of "Design release (BPE)".
    expect(view.raci!.rows[0].cells.slice(0, 5)).toEqual([
      { v: 'A', color: 'var(--color-accent-100)', bg: 'var(--color-accent-800)', border: '1px solid var(--color-neutral-800)' },
      { v: 'R', color: LO, bg: 'var(--color-accent-900)', border: '1px solid var(--color-neutral-800)' },
      { v: 'C', color: 'var(--color-neutral-300)', bg: 'transparent', border: '1px solid var(--color-neutral-800)' },
      { v: '', color: 'var(--color-neutral-500)', bg: 'transparent', border: '1px dashed var(--color-neutral-900)' },
      { v: 'I', color: 'var(--color-neutral-500)', bg: 'transparent', border: '1px solid var(--color-neutral-800)' },
    ]);
  });

  it('FR: the prototype French (deepTr), "> 30 j" instead of "> 30 d"', async () => {
    const { view } = await stk('fr');
    expect(view.kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual([
      ['Parties prenantes', '8', '2 client · 2 autorités · 2 fournisseurs & tiers', OK],
      ['Référents relation', '4', 'R. Aubert · L. Fabre · F. Bertrand · C. Morvan', OK],
      ['Responsabilités RACI', '7', '6 rôles', OK],
      ['Sans contact > 30 j', '1', 'référent relation à relancer', LO],
    ]);
    expect(view.rows.map((r) => [r.name, r.sub, r.type, r.owner, r.lastText, r.contactText, r.notes, r.initials])).toEqual([
      ['Nadia Bensaïd', 'Autorité portuaire · Chef de projet client', 'Client', 'R. Aubert', '25 sept.', 'n.bensaid@port-lehavre.fr', 'Weekly call · decides on hold points', 'NB'],
      ['Karim Doucouré', 'Autorité portuaire · Exploitation terminal', 'Client', 'R. Aubert', '12 sept.', 'k.doucoure@port-lehavre.fr', 'Owns quay 4 access windows', 'KD'],
      ['Port authority HSE', 'Autorité portuaire · Service HSE', 'Autorité', 'L. Fabre', '18 sept.', 'hse@port-lehavre.fr', 'Permits · prevention plan', 'Pa'],
      ['Marie Lefebvre', 'Keystone · Directrice de portefeuille · sponsor', 'Interne', 'R. Aubert', '25 sept.', '—', 'Approves forced gates and CR > 100 k€', 'ML'],
      ['Alain Girard', 'Keystone · Référent ingénierie', 'Interne', 'R. Aubert', '29 sept.', '—', '', 'AG'],
      ['Kjell Lindqvist', 'Nordvolt · Grand compte · variateurs', 'Fournisseur', 'F. Bertrand', '10 sept.', 'k.lindqvist@nordvolt.se', 'FAT lot 2 · status word mapping', 'KL'],
      ['DREAL Normandie', 'État · Autorité environnementale', 'Autorité', 'R. Aubert', '12 mars · > 30 j', '—', 'Permit conditions · noise at night', 'DN'],
      ['Terminal OS vendor', 'Navis · Équipe intégration', 'Tiers', 'C. Morvan', '22 sept.', '—', 'Interface spec rev B · slow to answer', 'TO'],
    ]);
    expect(view.raci!.columns).toEqual(['Chef de projet', 'Référent ingénierie', 'CP client', 'HSE port', 'Chef de chantier', 'Qualité']);
    expect(view.raci!.rows.map((r) => r.label)).toEqual([
      'Diffusion des plans (BPE)', 'Accès chantier & permis', 'Mise sous tension HT', 'Réception FAT', 'Demandes de modification', 'Jalons de paiement', 'SAT & transfert',
    ]);
  });

  it('project without a register: zero KPIs, "No stakeholder yet", no RACI card (never Harbor Line data)', async () => {
    const en = (await stk('en', 'EWA-051')).view;
    expect(en.kpis.map((k) => [k.value, k.sub, k.color])).toEqual([
      ['0', '0 client · 0 authorities · 0 suppliers & third parties', OK], ['0', '—', OK], ['0', '0 roles', OK], ['0', 'relationship owner to follow up', OK],
    ]);
    expect([en.rows.length, en.empty, en.raci]).toEqual([0, 'No stakeholder yet', null]);
    const fr = (await stk('fr', 'NDC-031')).view;
    expect([fr.kpis[0].sub, fr.kpis[2].sub, fr.empty, fr.raci]).toEqual(['0 client · 0 autorités · 0 fournisseurs & tiers', '0 rôles', 'Aucune partie prenante', null]);
  });

  it('static render (FR): headers, avatar, kind tag, stale contact, RACI grid with 6 role columns', async () => {
    const { t, view } = await stk('fr');
    const out = html(StakeholdersBody({ view, t }), 'fr');
    for (const s of [
      'Registre des parties prenantes', 'Partie prenante', 'Nature', 'Référent relation', 'Dernier contact', 'Contact', 'Matrice RACI',
      'R réalise · A approuve · C consulté · I informé', 'grid-template-columns:220px repeat(6, minmax(96px,1fr));min-width:820px', '>NB</span>',
      '12 mars · &gt; 30 j', 'color:var(--color-accent-300)', 'role="columnheader"', 'Mise sous tension HT', 'aria-label="Notes"',
    ])
      expect(out).toContain(s);
    expect(out.match(/class="tag tag-accent [^"]*">Client</g)?.length).toBe(2);
    expect(out.match(/class="tag tag-outline [^"]*">Autorité</g)?.length).toBe(2);
    expect(out).not.toContain('Aucune partie prenante');
    const empty = await stk('fr', 'EWA-051');
    const eout = html(StakeholdersBody({ view: empty.view, t: empty.t }), 'fr');
    expect(eout).toContain('Aucune partie prenante');
    expect(eout).not.toContain('Matrice RACI');
  });

  it('"Add stakeholder" form: prototype fields, Client first, TEAM owners (full names), translated with "Ajouter"', async () => {
    const { d, t } = await stk('fr');
    const f = localizeForm(stakeholderFormDef(d.team), formT(t, 'fr'));
    expect([f.title, f.submit]).toEqual(['Ajouter une partie prenante', 'Ajouter']);
    expect(f.fields.map((x) => [x.id, x.label, x.type, !!x.required])).toEqual([
      ['name', 'Nom', 'text', true], ['org', 'Organisation', 'text', true], ['role', 'Rôle', 'text', false], ['type', 'Type', 'select', false],
      ['contact', 'Contact (e-mail)', 'text', false], ['owner', 'Référent relation', 'select', false],
    ]);
    expect(f.fields[3].options).toEqual([
      { value: 'client', label: 'Client' }, { value: 'internal', label: 'Interne' }, { value: 'supplier', label: 'Fournisseur' }, { value: 'authority', label: 'Autorité' },
      { value: 'third_party', label: 'Tiers' },
    ]);
    expect(f.fields[5].options).toEqual(d.team);
    expect(d.team.length).toBeGreaterThan(0);
  });
});

describe('Interface register view model', () => {
  it('EN: KPI tiles and rows equal the prototype (renderValsEN golden)', async () => {
    const { view } = await ifc('en');
    // A-12 (chapter 4, 07 OQ6): "due within 30 days" counts the open interfaces needed within 30 days of the data date —
    // IF-02 (15 Oct), not IF-05 (15 Nov, 51 days away) that the prototype counted.
    expect(view.kpis).toEqual(GOLDEN.interfaces.kpis.map((k, i) => ({ ...k, value: String(k.value), sub: i === 1 ? '1 due within 30 days' : k.sub })));
    // R-013: days counted from the business date (25 Sep 2026 on the demo data set), 5 days before the prototype's now (≈ 30 Sep).
    const r013: Record<string, string> = { 'IF-02': 'in 20 d', 'IF-05': 'in 50 d', 'IF-07': '5 d late' };
    expect(view.rows.map((r) => ({ id: r.number, title: r.title, a: r.side, b: r.otherParty, data: r.data, needed: r.needed, provided: r.provided, status: r.status, owner: r.owner, neededSub: r.neededSub }))).toEqual(
      GOLDEN.interfaces.rows.map((r) => (r013[r.id] ? { ...r, neededSub: r013[r.id] } : r)),
    );
    expect(view.rows.map((r) => [r.statusClass, r.neededColor, r.canReceive, r.canFreeze])).toEqual([
      ['tag tag-neutral', OK, false, true], ['tag tag-outline', LO, true, false], ['tag tag-neutral', OK, false, false], ['tag tag-neutral', OK, false, true],
      ['tag tag-outline', OK, true, false], ['tag tag-neutral', OK, false, false], ['tag tag-accent', LO, true, false],
    ]);
    expect([view.empty, view.late]).toEqual([null, 1]);
  });

  it('FR: the prototype French; statuses agree with "interface" (Reçue / Gelée instead of Reçu / Gelé)', async () => {
    const { view } = await ifc('fr');
    expect(view.kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual([
      ['Interfaces', '7', '2 gelées · 2 reçues', OK],
      ['Ouverte', '2', '1 due sous 30 jours', OK], // A-12
      ['En retard', '1', 'IF-07', LO],
      ['Bloquent la mise en service', '2', 'Cellule HT · zones anti-collision', LO],
    ]);
    // R-013: "dans 20 j" / "dans 50 j" / "5 j de retard" from the business date (25 Sep 2026 on the demo data set; the prototype
    // counted from ≈ 30 Sep: 15, 45 and 10 days).
    expect(view.rows.map((r) => [r.number, r.title, r.side, r.otherParty, r.data, r.needed, r.neededSub, r.provided, r.status, r.owner])).toEqual([
      ['IF-01', 'Quay 4 civil works — anchor loads & tolerances', 'Mécanique', 'Client · civil works', 'Foundation as-built + tolerances', '1 juil.', '', '12 sept.', 'Reçue', 'J. Wagner'],
      ['IF-02', 'HV supply — port substation cell', 'Électricité', 'Client · port authority', 'Cell availability date + protection settings', '15 oct.', 'dans 20 j', '—', 'Ouverte', 'S. Haddad'],
      ['IF-03', 'Terminal operating system — data exchange', 'Automatisme', 'Navis · third party', 'Interface spec (OPC UA tags)', '22 sept.', '', '22 sept.', 'Gelée', 'C. Morvan'],
      ['IF-04', 'Quay access windows — crane erection', 'Site', 'Client · terminal operations', 'Restricted access calendar', '1 oct.', '', '29 sept.', 'Reçue', 'L. Fabre'],
      // R-148 (NEW-D1-2): the other party is shown as typed, not half translated ("Tiers · other supplier").
      ['IF-05', 'Neighbouring cranes — anti-collision zones', 'Automatisme', 'Third party · other supplier', 'Crane envelope & positioning protocol', '15 nov.', 'dans 50 j', '—', 'Ouverte', 'C. Morvan'],
      ['IF-06', 'Environmental permit — night works', 'Process', 'DREAL · authority', 'Noise limits & allowed hours', '12 mars', '', '12 mars', 'Gelée', 'R. Aubert'],
      ['IF-07', 'Fibre & network — port backbone', 'Automatisme', 'Client · IT', 'Fibre route & VLAN plan', '20 sept.', '5 j de retard', '—', 'En retard', 'S. Haddad'],
    ]);
  });

  it('"Blocking commissioning": blockers from the commissioning grid; the sub lists the ones still open', async () => {
    const { d } = await ifc('en');
    expect(d.blockers).toEqual([{ number: 'IF-02', label: 'HV cell' }, { number: 'IF-05', label: 'anti-collision zones' }]);
    const received = d.interfaces.map((r) => (r.number === 'IF-02' ? { ...r, status: 'received' as const, statusLabel: 'Received' } : r));
    const en = interfacesView(received, d.blockers, makeT('en'), 'en', DEMO_TODAY_ISO).kpis[3];
    const fr = interfacesView(received, d.blockers, makeT('fr'), 'fr', DEMO_TODAY_ISO).kpis[3];
    expect([en.value, en.sub, en.color, fr.sub]).toEqual(['1', 'anti-collision zones', LO, 'zones anti-collision']);
    const none = received.map((r) => (r.number === 'IF-05' ? { ...r, status: 'frozen' as const, statusLabel: 'Frozen' } : r));
    expect(interfacesView(none, d.blockers, makeT('en'), 'en', DEMO_TODAY_ISO).kpis[3]).toMatchObject({ value: '0', sub: '—', color: OK });
  });

  it('project without interfaces: zero KPIs, "—" subs, "No interface registered"', async () => {
    const { view } = await ifc('en', 'EWA-051');
    expect(view.kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual([
      ['Interfaces', '0', '0 frozen · 0 received', OK], ['Open', '0', '0 due within 30 days', OK], ['Late', '0', '—', OK], ['Blocking commissioning', '0', '—', OK],
    ]);
    expect([view.rows.length, view.empty, view.late]).toEqual([0, 'No interface registered', 0]);
    expect((await ifc('fr', 'EWA-051')).view.empty).toBe('Aucune interface enregistrée');
  });

  it('static render: row actions for editors only, with the item named for screen readers', async () => {
    const { t, view } = await ifc('fr');
    const edit = html(InterfacesBody({ code: 'HLT-026', view, canEdit: true, receivedDefault: '25 sept. 2026', t }), 'fr');
    for (const s of [
      'Registre des interfaces', 'Une donnée en retard du client ou d’un tiers coûte des jours de planning · gardez-en la trace ici', 'Côté Keystone', 'Autre partie',
      'Donnée attendue', 'Requis pour le', 'Fournie le', 'Statut', 'Responsable', 'aria-label="Marquer reçu · IF-07"', 'aria-label="Geler · IF-01"',
      'aria-label="Actions"',
    ])
      expect(edit).toContain(s);
    // Q-4 a (R-116): "Mark received" opens its "Received on" dialog — closed on render, so the row buttons are unchanged.
    expect(edit.match(/>Marquer reçu</g)?.length).toBe(3);
    expect(edit).not.toContain('Reçu le');
    expect(edit.match(/>Geler</g)?.length).toBe(2);
    expect(edit.match(/class="tag tag-accent [^"]*">En retard</g)?.length).toBe(1);
    const ro = html(InterfacesBody({ code: 'HLT-026', view, canEdit: false, receivedDefault: '25 sept. 2026', t }), 'fr');
    expect(ro).not.toContain('Marquer reçu');
    expect(ro).not.toContain('>Geler<');
    expect(ro).toContain('5 j de retard'); // R-013: from 25 Sep (the prototype's 10 days from ≈ 30 Sep)
  });

  it('"New interface" form: prototype fields, Process first, submit "Enregistrer" (verb, not the noun "Registre")', async () => {
    const { d, t } = await ifc('fr');
    const f = localizeForm(interfaceFormDef(d.team), formT(t, 'fr'));
    expect([f.title, f.submit]).toEqual(['Nouvelle interface', 'Enregistrer']);
    expect(f.fields.map((x) => [x.id, x.label, x.type, !!x.required])).toEqual([
      ['title', 'Interface', 'text', true], ['a', 'Côté Keystone', 'select', false], ['b', 'Autre partie', 'text', true], ['data', 'Donnée attendue', 'text', true],
      ['needed', 'Requis pour le', 'text', true], ['owner', 'Responsable', 'select', false],
    ]);
    expect(f.fields[1].options).toEqual([
      { value: 'process', label: 'Process' }, { value: 'mechanical', label: 'Mécanique' }, { value: 'electrical', label: 'Électricité' },
      { value: 'automation', label: 'Automatisme' }, { value: 'site', label: 'Site' },
    ]);
    const en = localizeForm(interfaceFormDef(d.team), formT(makeT('en'), 'en'));
    expect([en.title, en.submit]).toEqual(['New interface', 'Register']);
  });
});
