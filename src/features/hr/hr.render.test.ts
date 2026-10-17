// HR screens: DAL integration (in-memory PGlite seeded from the prototype) + static render of the four bodies in
// EN and FR, checked against the prototype's displayed values (docs/spec/06 §2.4, §3.4, §4.4, §5.4).
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/resources/skills', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { requestsNeedingExperts } from '@/domain/resources';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getHoursReconciliation, getLeaveCalendar, getRateCard, getSkillsMatrix, type HoursReconciliation, type LeaveCalendar, type RateCard, type SkillsMatrix } from '@/server/dal/hr';
import { listResourceRequests } from '@/server/dal/requests';
import { HoursBody, hoursViewHref } from './hours-view';
import { hrT } from './i18n';
import { LeaveView } from './leave-view';
import { RatesView } from './rates-view';
import { SkillsView, skillFilterHref } from './skills-view';
import css from './hr.module.css';

const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/\s+/g, ' ');
const tOf = (lang: Lang) => hrT(makeT(lang), lang);
const count = (s: string, sub: string) => s.split(sub).length - 1;

let card: RateCard;
let skills: SkillsMatrix;
let leave: LeaveCalendar;
let hours: HoursReconciliation;
let expertRequests: { count: number; skills: string[] };

beforeAll(async () => {
  setDb(await openDatabase());
  // The prototype's weeks explicitly (R-084: without weeks, the current window — it was the seeded allocation weeks).
  const PROTO_WEEKS = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'];
  [card, skills, leave, hours] = await Promise.all([getRateCard(), getSkillsMatrix(), getLeaveCalendar('FR', PROTO_WEEKS), getHoursReconciliation('HLT-026').then((x) => x!)]);
  // As the Skills page computes it (A-12).
  expertRequests = requestsNeedingExperts(await listResourceRequests({ status: 'pending' }), skills.people, skills.skills.map((x) => x.name));
}, 60_000);

describe('Rate cards', () => {
  // R-083: the card on the business date (25 Sep 2026) — every seeded rate since 1 Jan 2026, no other version yet.
  const props = (canSee: boolean, canEdit = canSee) => ({
    on: card.on,
    base: '/resources/rates',
    roles: card.roles.map((r) => ({ role: r.role, baseRateEur: canSee ? r.baseRateEur : null, since: canSee ? '1 Jan 2026' : null, others: [] })),
    multipliers: card.multipliers.map((m) => ({ key: m.key, label: m.label, factor: m.factor, since: '1 Jan 2026', others: [] })),
    canSee,
    canEdit,
  });

  it('director / Finance (P-12 c): KPIs, editable base rates, multiplied rates, the date the edits take effect from (EN)', () => {
    const m = html(h(RatesView, props(true)), 'en');
    const x = text(m);
    expect(x).toContain('Average internal rate 72,33 €/h Cost rate · 9 roles');
    expect(x).toContain('Contractor premium +39% vs internal structural engineer');
    expect(x).toContain('Weekend multiplier ×2 Sunday / public holiday');
    // R-044 (P-12 c): the rates are visible to the director, the PMs and Finance.
    expect(x).toContain('Visibility Full Director, project managers and Finance');
    expect(x).toContain('Structural engineer');
    expect(x).toContain('106,25 € 127,5 € 170 € 110,5 € 29,75 €');
    expect(x).toContain('Contractor — structural (external) External');
    expect(count(m, 'type="number"')).toBe(15); // 10 base rates + 5 multipliers
    expect(m).toContain('value="85"');
    expect(m).toContain('step="0.05"');
    expect(x).not.toContain('Rates are visible to the director');
    expect(x).toContain('× base, per hour on call');
    // R-083: dated grid — the date shown and the "since" line of each rate.
    expect(m).toContain('type="date"');
    expect(m).toContain('value="2026-09-25"');
    expect(x).toContain('Rates in force on · edits take effect from');
    expect(count(x, 'since 1 Jan 2026')).toBe(10 + 5);
  });

  it('PM (P-12 c): reads the values, no input, the "edited by" note', () => {
    const m = html(h(RatesView, props(true, false)), 'en');
    const x = text(m);
    expect(m).not.toContain('type="number"');
    expect(x).toContain('85 €');
    expect(x).toContain('Rates are edited by the portfolio director and Finance');
    expect(x).toContain('Rates in force on');
    expect(x).not.toContain('edits take effect from');
  });

  it('other roles: masked values, lock banner, read-only multipliers; no rate sent', () => {
    const m = html(h(RatesView, props(false)), 'en');
    const x = text(m);
    expect(x).toContain('Average internal rate ••• ');
    expect(x).toContain('Contractor premium ••• ');
    expect(x).toContain('Weekend multiplier ×2');
    expect(x).toContain('Visibility Masked');
    expect(x).toContain('Rates are visible to the director, project managers and Finance only — switch role (bottom-left) to see them.');
    expect(count(x, '•••')).toBe(2 + 10 * 6);
    expect(m).not.toContain('type="number"');
    expect(m).not.toContain('106,25');
    expect(x).not.toContain('since 1 Jan 2026 ·'); // no rate history for a masked viewer (only the multipliers' dates)
    expect(m).toContain('var(--color-accent-300)'); // "Masked" in LO
  });

  it('a rate with other versions lists them; a role without a version on the date reads "No rate on this date"', () => {
    const p = props(true, false);
    p.roles[0] = { ...p.roles[0], baseRateEur: 95, since: '1 Nov 2026', others: [{ value: 92, from: '1 Jan 2026' }] as never[] };
    p.roles[1] = { ...p.roles[1], baseRateEur: null, since: null };
    const x = text(html(h(RatesView, p), 'en'));
    expect(x).toContain('since 1 Nov 2026 · 92 € from 1 Jan 2026');
    expect(x).toContain('No rate on this date');
    const fr = text(html(h(RatesView, p), 'fr'));
    expect(fr).toContain('depuis le 1 nov. 2026 · 92 € à partir du 1 janv. 2026');
    expect(fr).toContain('Aucun taux à cette date');
  });

  it('FR', () => {
    const x = text(html(h(RatesView, props(true)), 'fr'));
    expect(x).toContain('Taux interne moyen 72,33 €/h Taux de coût · 9 rôles');
    expect(x).toContain('Surcoût prestataire +39% vs ingénieur structure interne');
    expect(x).toContain('Taux horaires par rôle');
    expect(x).toContain('Prestataire — structure (externe) Externe');
    expect(x).toContain('Majorations');
    expect(x).toContain('Heures sup. > 8 h/jour');
    expect(x).toContain('× base, par heure d’astreinte');
    expect(x).toContain('Taux en vigueur le · les modifications s’appliquent à partir du');
    expect(x).toContain('Direction, chefs de projet et Finance');
    expect(x).toContain('depuis le 1 janv. 2026');
  });
});

describe('Skills matrix', () => {
  const base = '/resources/skills';

  it('KPIs, chips, matrix and coverage (EN)', () => {
    const m = html(h(SkillsView, { data: skills, filter: null, base, t: tOf('en'), lang: 'en', expertRequests }), 'en');
    const x = text(m);
    expect(x).toContain('Skill families 10 Levels 1–5 · certifications noted');
    // R-5b (R-087): two indicators instead of the prototype's "Single-expert skills 8" (fewer than 2 experts): no expert at all
    // (Automation & controls, Software / IT) and exactly one expert (6); a neutral certifications sub-line (not Lucca).
    expect(x).toContain('Skills without an expert 2 No one at level ≥4');
    expect(x).toContain('Single-expert skills 6 Exactly one person at level ≥4');
    expect(x).toContain('Certifications 5 People with a certification noted');
    expect(x).not.toContain('Lucca');
    // A-12 (chapter 4): computed from the pending requests naming an expert (RQ-041 Structural, RQ-044 Procurement, RQ-042
    // Quality) — the prototype's constant was "2 · Structural · Quality".
    expect(x).toContain('Open requests needing level ≥4 3 Structural · Procurement · Quality / QA-QC');
    expect(x).toContain('Filter shows people at level ≥3');
    expect(count(m, 'role="row"')).toBe(1 + 8);
    expect(count(m, 'role="cell"')).toBe(80);
    expect(m).toContain('title="Structural · level 5"');
    expect(x).toContain('Thomas Kerbrat Crane operator G1 · rigging CACES');
    expect(x).toContain('Léa Marchand —');
    expect(x).toContain('Crane &amp; lifting 2 experts · 3 at level ≥3'.replace('&amp;', '&'));
    expect(x).toContain('Structural 1 expert · 1 at level ≥3');
    // R-5b: the coverage list names the case.
    expect(x).toContain('Automation & controls No expert · 1 at level ≥3');
    expect(m).toContain(`href="${skillFilterHref(base, 4)}"`);
    expect(m).toContain('aria-current="true"');
    // dots: 5 per cell; level v fills v dots in lvColor(v) (≥4 accent-400 · 3 accent-600 · 2 accent-800 · 1 neutral-800)
    const levels = skills.people.flatMap((p) => p.levels);
    const filled = (pred: (v: number) => boolean) => levels.filter(pred).reduce((a, v) => a + v, 0);
    expect(count(m, `class="${css.dot}"`) + count(m, `class="${css.dot} `)).toBe(400);
    expect(count(m, `${css.dot} ${css.lv4}`)).toBe(filled((v) => v >= 4));
    expect(count(m, `${css.dot} ${css.lv3}`)).toBe(filled((v) => v === 3));
    expect(count(m, `${css.dot} ${css.lv1}`)).toBe(filled((v) => v === 1));
  });

  it('without the computed requests the 4th tile shows "—", never an invented figure (A-12)', () => {
    const x = text(html(h(SkillsView, { data: skills, filter: null, base, t: tOf('en'), lang: 'en' }), 'en'));
    expect(x).toContain('Open requests needing level ≥4 —');
    expect(x).not.toContain('Structural · Quality');
  });

  it('filter ?filter=4 (Crane & lifting): people at level ≥3', () => {
    const m = html(h(SkillsView, { data: skills, filter: 4, base, t: tOf('en'), lang: 'en' }), 'en');
    expect(count(m, 'role="row"')).toBe(1 + 3);
    const x = text(m);
    expect(x).toContain('Amélie Ollivier');
    expect(x).toContain('Julien Wagner');
    expect(x).toContain('Thomas Kerbrat');
    expect(x).not.toContain('Pauline Noguès');
  });

  it('FR', () => {
    const m = html(h(SkillsView, { data: skills, filter: null, base, t: tOf('fr'), lang: 'fr' }), 'fr');
    const x = text(m);
    expect(x).toContain('Familles de compétences 10');
    expect(x).toContain('Compétences sans expert 2 Personne au niveau ≥4');
    expect(x).toContain('Compétences à expert unique 6 Une seule personne au niveau ≥4');
    expect(x).toContain('Automatisme et contrôle-commande Aucun expert · 1 au niveau ≥3');
    expect(x).toContain('Tout le monde');
    expect(x).toContain('Grues et levage 2 expert(s) · 3 au niveau ≥3');
    expect(m).toContain('title="Structure · niveau 5"');
  });
});

describe('Leave & working calendar', () => {
  it('KPIs, holiday row, person rows (EN)', () => {
    const m = html(h(LeaveView, { data: leave, t: tOf('en') }), 'en');
    const x = text(m);
    // R-031 (NEW-CURSUS-4 / NEW-CURSUS-7): Lucca is unplugged — the tile says when Cursus last pushed an absence (none on
    // the seed); R-173: no reason in any text (Leave / Absence only).
    expect(x).toContain('Cursus — None received yet');
    expect(x).not.toMatch(/sick|Sick|Training|Lucca/);
    expect(x).toContain('Team availability 85% Next 8 weeks · 35 h basis');
    expect(x).toContain('Leave days 43 Approved in Cursus');
    expect(x).toContain('Public holidays 1 11 Nov · France');
    expect(x).toContain('Weeks under 60% team capacity 0 Capacity feeds the allocation heatmap');
    expect(x).toContain('Person Sep 28 Oct 5 Oct 12 Oct 19 Oct 26 Nov 2 Nov 9 Nov 16 Leave Avail.');
    expect(x).toContain('Public holidays 11 Nov');
    expect(x).toContain('Amélie Ollivier Site lead 35 h 35 h Leave 0 h Leave 0 h 35 h 35 h Hol. 28 h 35 h 10 d 73%');
    expect(x).toContain('Pauline Noguès');
    expect(x).toContain('Absence 14 h');
    expect(x).toContain('Absence 21 h');
    expect(x).toContain('Fabien Bertrand');
    expect(x).toContain('Leave 0 h Leave 0 h 10 d 75%');
    expect(x).toContain('Leave · paid leave or RTT Absence · any other absence Hol. · public holiday');
    expect(x).toContain('Received from Cursus · 35 h week · 7 h per leave day · public holidays removed');
    expect(x).toContain('Leave is requested and approved in Cursus');
  });

  it('FR: week labels "28 sept.", leave codes, day unit', () => {
    const x = text(html(h(LeaveView, { data: leave, t: tOf('fr') }), 'fr'));
    expect(x).toContain('Personne 28 sept. 5 oct. 12 oct. 19 oct. 26 oct. 2 nov. 9 nov. 16 nov. Congés Dispo.');
    expect(x).toContain('Disponibilité de l’équipe 85%');
    expect(x).toContain('Jours fériés 1 11 nov. · France');
    // NEW-CURSUS-4 / R-173: Congés / Absence, never « Maladie » or « Formation ».
    expect(x).toContain('Absence 21 h');
    expect(x).toContain('Absence 14 h');
    expect(x).toContain('Congés 0 h');
    expect(x).toContain('Férié 28 h');
    expect(x).toContain('10 j 73%');
    expect(x).toContain('Congés · congés payés ou RTT Absence · toute autre absence Férié · jour férié');
    expect(x).toContain('Cursus — Aucune reçue pour l’instant');
    expect(x).not.toMatch(/Maladie|maladie|Formation|Lucca/);
  });
});

describe('Hours — Lucca reconciliation', () => {
  const base = '/projects/HLT-026/hours';
  const render = (view: 'resource' | 'wp' | 'unassigned', lang: Lang, canEdit = true, thresholdPct = 10, ratesVisible = true) =>
    html(h(HoursBody, { data: hours, view, base, code: 'HLT-026', canEdit, thresholdPct, ratesVisible, lang, t: tOf(lang) }), lang);

  it('by resource (default): KPIs and groups (EN)', () => {
    const m = render('resource', 'en');
    const x = text(m);
    expect(x).toContain('Declared in Lucca · September 779 h analytic code HAV004 · imported 29 Sep 2026');
    expect(x).toContain('Planned (schedule) 740 h 10 resource × work package lines');
    // A-10 (R-083): Σ (declared − planned) × each person's grid rate on the month = €955 → still "€1k" (was 12 h × 62 €/h).
    expect(x).toContain('Variance +12 h 2 % · ≈ €1k labour cost');
    expect(x).toContain('To assign 27 h 2 lines without a planned task');
    expect(x).toContain('JW Julien Wagner 1.3 · Foundations · 1.4 · Steel structure 280 h 303 h +23 h');
    // R-6b (R-088): exactly +10 % is now over (inclusive threshold) — ▲ with words for screen readers.
    expect(x).toContain('1.3 · Foundations · Julien Wagner 120 h 132 h ▲ Over plan +12 h');
    // R-6b: over (and under) plan carry a glyph and words besides the colour.
    expect(x).toContain('Hélène Sauvage 1.3 · Foundations · 1.4 · Steel structure 100 h 115 h ▲ Over plan +15 h');
    expect(x).toContain('Léa Marchand 1.1 · Design & permits 24 h 31 h ▲ Over plan +7 h');
    expect(m).toContain('width:100%');
    expect(m).toContain('width:90%');
    expect(m).toContain(`href="${hoursViewHref(base, 'wp')}"`);
    expect(x).not.toContain('Hours without a planned task');
  });

  it('by work package', () => {
    const x = text(render('wp', 'en'));
    expect(x).toContain('1.3 1.3 · Foundations J. Wagner · H. Sauvage 160 h 184 h ▲ Over plan +24 h');
    expect(x).toContain('1.1 1.1 · Design & permits D. Roux · L. Marchand 54 h 59 h +5 h');
    // R-6b (R-088): an under-declaration within 10 % is neutral now (the prototype flagged every one).
    expect(x).toContain('1.2 · Site preparation · Amélie Ollivier 80 h 76 h -4 h');
    expect(x).toContain('1.7 · Paving & yard · Amélie Ollivier 20 h 14 h ▼ Under plan -6 h');
  });

  it('to assign: rows with the work-package select and Assign (editors only)', () => {
    const m = render('unassigned', 'en');
    const x = text(m);
    expect(x).toContain('Hours without a planned task');
    expect(x).toContain('FB Fabien Bertrand Declared on HAV004 · no planned task this month 18 h');
    expect(x).toContain('PN Pauline Noguès Declared on HAV004 · no planned task this month 9 h');
    expect(count(m, '<select')).toBe(2);
    expect(count(m, '<option')).toBe(16);
    expect(x).toContain('1.1 · Design & permits');
    expect(x).toContain('1.8 · Commissioning & handover');
    expect(count(x, 'Assign')).toBe(2);
    const ro = render('unassigned', 'en', false);
    expect(ro).not.toContain('<select');
    expect(text(ro)).not.toContain('Assign ');
    expect(text(ro)).toContain('Fabien Bertrand');
  });

  it('assigned lines leave "To assign" but stay in the Lucca total', () => {
    const data: HoursReconciliation = { ...hours, unassigned: hours.unassigned.map((u, i) => (i === 0 ? { ...u, assignedWbs: '1.3' } : u)) };
    const x = text(html(h(HoursBody, { data, view: 'unassigned', base, code: 'HLT-026', canEdit: true, thresholdPct: 10, ratesVisible: true, lang: 'en', t: tOf('en') }), 'en'));
    expect(x).toContain('Declared in Lucca · September 779 h');
    expect(x).toContain('To assign 9 h 1 line without a planned task');
    expect(x).toContain('18 h 1.3 · Foundations Assigned');
  });

  it('FR', () => {
    const x = text(render('resource', 'fr'));
    expect(x).toContain('Regrouper par Par ressource Par lot À affecter');
    expect(x).toContain('Déclaré dans Lucca · septembre 779 h code analytique HAV004 · importé le 29 sept. 2026');
    expect(x).toContain('Planifié (planning) 740 h 10 lignes ressource × lot');
    expect(x).toContain('Écart +12 h 2 % · ≈ 1 k€ de main-d’œuvre');
    expect(x).toContain('À affecter 27 h 2 lignes sans tâche planifiée');
    expect(x).toContain('Déclaré Lucca vs planifié');
    expect(x).toContain('120 h 132 h ▲ Au-dessus du prévu +12 h');
  });

  it('R-6b: another threshold (7 %) changes the tones; the cost is masked for the roles that do not see rates (R-046)', () => {
    const m = render('resource', 'en', true, 7, false);
    const x = text(m);
    // Julien Wagner +23 / 280 h = 8.2 % ≥ 7 % → over; Léa Marchand +7 / 24 h → over; Amélie Ollivier −10 / 100 h → under.
    expect(x).toContain('JW Julien Wagner 1.3 · Foundations · 1.4 · Steel structure 280 h 303 h ▲ Over plan +23 h');
    expect(x).toContain('Amélie Ollivier 1.2 · Site preparation · 1.7 · Paving & yard 100 h 90 h ▼ Under plan -10 h');
    expect(x).toContain('Variance +12 h 2 % · ≈ ••• labour cost');
    expect(m).toContain(css.varOver);
    expect(m).toContain(css.varUnder);
  });
});
