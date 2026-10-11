// Portfolio prioritisation & capacity and Cash flow & billing: static render of the bodies on a seeded in-memory
// database, in EN and FR, checked against the prototype's displayed values (docs/spec/03 §6, §7): labels, figures,
// masked margins never sent to viewers without margin rights, read-only weights outside the workspace.
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/portfolio/prioritisation', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getCapacityScreen, getCashScreen, getPrioritisationScreen } from '@/server/dal/pfinance';
import { CapacityView } from './capacity-view';
import { CashView } from './cash-view';
import { DisplaySeg } from './display-seg';
import { pfT } from './i18n';
import { capacityView, cashView } from './model';
import { PrioritisationBoard } from './prioritisation-board';

const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/\s+/g, ' ');
const tOf = (lang: Lang) => pfT(makeT(lang), lang);
const count = (s: string, sub: string) => s.split(sub).length - 1;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

const board = async (role: string, lang: Lang, canEdit: boolean, sel: string | null = null) => {
  const { candidates: _c, ...data } = await getPrioritisationScreen(role, null);
  void _c;
  return html(h(PrioritisationBoard, { data, canEdit, initialSel: sel }), lang);
};

describe('Prioritisation tab', () => {
  it('director (EN): KPI tiles, ranking, weights inputs, selected row', async () => {
    const m = await board('director', 'en', true, 'NDC-031');
    const x = text(m);
    expect(x).toContain('Active projects 6 €13.63M committed');
    expect(x).toContain('Pipeline 5 €13.08M proposed · approved · planning');
    expect(x).toContain('Top-ranked WSA-044 Westfield Solar Array');
    // A-12 (chapter 4): Σ (contract − EAC) / Σ contract of the active client projects — 8 %, not the constant 18 %.
    expect(x).toContain('Portfolio margin 8% Client projects · weighted by contract');
    expect(x).toContain('Weights sum 100% Edit weights on the right');
    expect(x).toContain('Ranking — active and pipeline Score = Σ axis (1–5) × weight · pipeline projects compete with active ones for capacity');
    expect(x).toContain('# Project Status Score Strategic fit Margin / NPV Risk level Resource fit Client priority Budget Margin');
    // C-10b (R-132): margins at completion (contract − EAC) — the prototype's 13 % / 13 % / 10 % — with R-073's EAC from the
    // computed progress and actual cost (on the prototype's figures: 16 % / 5 % / 2 %).
    expect(x).toContain('1 Westfield Solar Array WSA-044 APD 81 €3.40M 21%');
    expect(x).toContain('3 Harbor Line Terminal Expansion HLT-026 Fabrication &amp; Assemblage 72 €4.80M 3%'.replace('&amp;', '&'));
    expect(x).toContain('10 Clinique Pasteur Lyon Fit-out RCF-019 Chantier 54 €1.35M 7%');
    expect(count(m, '<tr')).toBe(11);
    expect(count(m, 'type="number"')).toBe(5);
    expect(m).toContain('step="0.05"');
    expect(m).toContain('value="0.25"');
    expect(x).toContain('Weights Editable · the ranking recomputes live Strategic fit 25%');
    expect(x).toContain('Axes and scale are defined in Settings · scores are entered at the Proposed stage and reviewed at each gate');
    expect(x).not.toContain('Margins are visible');
    expect(count(m, 'aria-selected="true"')).toBe(1);
    expect(m).toMatch(/aria-selected="true"[^>]*>(?:(?!<\/tr>).)*NDC-031/);
    expect(m).toContain('--score-w:81%');
    expect(m).toContain('title="Strategic fit"');
  });

  it('director (FR)', async () => {
    const x = text(await board('director', 'fr', true));
    expect(x).toContain('Projets actifs 6 13,63 M€ engagés');
    expect(x).toContain('Pipeline 5 13,08 M€ proposés · approuvés · en planification');
    expect(x).toContain('Mieux classé WSA-044 Centrale solaire de Westfield');
    expect(x).toContain('Marge du portefeuille 8% Projets clients · pondérée par contrat'); // A-12
    expect(x).toContain('Somme des poids 100% Modifier les poids à droite');
    expect(x).toContain('Classement — actifs et pipeline');
    expect(x).toContain('# Projet Statut Score Alignement stratégique Marge / VAN Niveau de risque Adéquation ressources Priorité client Budget Marge');
    expect(x).toContain('4 Automatisation de l’entrepôt Eastbank EWA-051 Initiative 70 2,20 M€ Interne');
    expect(x).toContain('5 Déploiement signalétique métro de Marseille MSR-012 Mise en service & SAT 69 620 k€ 17%'); // C-10b + R-073 (14 %; 16 % before R-073)
    expect(x).toContain('Poids Modifiables · le classement se recalcule en direct');
  });

  it('outside the workspace (depthead): masked margins (never sent), lock notice, weights as text', async () => {
    const m = await board('depthead', 'en', false);
    const x = text(m);
    expect(x).toContain('Portfolio margin ••• Directors and PMs only');
    expect(x).toContain('Margins are visible to directors and project managers only.');
    expect(count(x, '•••')).toBe(1 + 10);
    expect(x).not.toMatch(/\b1[0-4]%/);
    expect(x).not.toContain('Internal');
    expect(m).not.toContain('type="number"');
    expect(x).toContain('Strategic fit 25% 0.25');
    expect(m).not.toContain('var(--color-accent-300)'); // nothing in LO: masked margins carry no colour
  });
});

describe('Display switch', () => {
  it.each(['en', 'fr'] as const)('%s: two links, current tab marked', (lang) => {
    const m = html(h(DisplaySeg, { tab: 'capacity' }), lang);
    expect(text(m)).toContain(lang === 'en' ? 'Display Prioritisation Capacity what-if' : 'Vue Priorisation What-if capacité');
    expect(m).toContain('href="/portfolio/prioritisation"');
    expect(m).toContain('aria-current="true" href="/portfolio/prioritisation?tab=capacity"');
  });
});

describe('Capacity what-if tab', () => {
  it.each(['en', 'fr'] as const)('%s: WSA-044', async (lang) => {
    const t = tOf(lang);
    const v = capacityView((await getCapacityScreen('WSA-044'))!, t, lang);
    const m = html(h(CapacityView, { candidates: ['WSA-044', 'EWA-051', 'FTU-052', 'RBR-048', 'CER-047'], current: 'WSA-044', view: v, sel: 'HLT-026', t }), lang);
    const x = text(m);
    if (lang === 'en') {
      expect(x).toContain('Pipeline project to absorb WSA-044 EWA-051 FTU-052 RBR-048 CER-047');
      // A-12 (chapter 4): capacity from the pool's allocations, demand per €1M from the active portfolio (prototype: gap 1 560 h).
      expect(x).toContain('Westfield Solar Array €3.40M · start Aug 2026 APD Absorbable with 151 h of overtime or one contractor Capacity gap · 151 h over 8 weeks');
      expect(x).toContain('Demand vs capacity by department — next 8 weeks Current commitments + the candidate project · tick = available capacity');
      expect(x).toContain('Engineering +73 h 391 / 320 h');
      expect(x).toContain('Controls & planning +164 h 880 / 960 h');
      expect(x).toContain('Committed Candidate project Capacity');
      expect(x).toContain('Options Start Westfield 6 weeks later — gap closes as Harbor Line demobilises Contract 1 engineer(s) for the ramp-up phase Delay Metro Signage Line B (non-critical) by 2 weeks');
      expect(x).toContain('Demand is estimated from budget and past projects of the same type until the WBS is planned.');
    } else {
      expect(x).toContain('Projet du pipeline à absorber');
      expect(x).toContain('Centrale solaire de Westfield 3,40 M€ · début août 2026 APD Absorbable avec 151 h d’heures sup. ou un prestataire Écart de capacité · 151 h sur 8 semaines'); // A-12
      expect(x).toContain('Ingénierie +73 h 391 / 320 h');
      expect(x).toContain('Engagé Projet candidat Capacité');
      expect(x).toContain('Recruter 1 ingénieur(s) en prestation pour la montée en charge');
    }
    expect(m).toContain('href="/portfolio/prioritisation?tab=capacity&amp;project=EWA-051&amp;sel=HLT-026"');
    expect(m).toContain('width:74%'); // A-12: Engineering 318 h committed of max(320, 391) × 1.1
    expect(m).toContain('--cap-left:74%');
  });
});

describe('Cash flow & billing', () => {
  it('director (EN): KPIs, billing rows, legend, bars', async () => {
    const t = tOf('en');
    const m = html(h(CashView, { view: cashView(await getCashScreen('director', null), t, 'en'), t }), 'en');
    const x = text(m);
    expect(x).toContain('Contract value €10.09M 4 client projects · 1 internal');
    // NEW-D3-3 (R-079): HLT-026 invoiced at base-amount prices (prototype €5.26M / €1.94M, HLT-026 €3.04M · €1.38M, M4 €1.10M).
    expect(x).toContain('Invoiced to date €5.19M Milestones reached or monthly progress');
    expect(x).toContain('Outstanding receivables €1.91M Invoiced, not yet paid');
    // A-12 (chapter 4): billing plan in, cost forecast out, at the data date (the prototype's stored plan gave +€365k / −€490k in
    // November with a static sub-line). Delivery 7, C-10a / C-6 (R-133, R-076): the remaining spend follows the PV curve and
    // receipts land at the payment rule's dates (chapter 4: +€2.84M, low −€521k); R-073 (C-2a): that PV curve is computed from the
    // cost-loaded BL1 and the ETC from the computed EAC and actual cost (contract-portfolio alone: +€2.87M, −€1.08M; cost-control
    // alone, even spread: +€2.71M, −€570k).
    expect(x).toContain('Net cash · next 6 months +€2.75M Billing plan minus forecast spend');
    expect(x).toContain('Lowest cumulative point −€1.41M October — before M3 payment lands (HLT-026)');
    expect(x).toContain('Project Billing model Contract Invoiced · paid Outstanding Cost to date Margin Next milestone');
    // C-10b (R-132): margin at completion (prototype 13 % / 14 %) on R-073's EAC; R-073: cost to date from the activities
    // (ERP-202 €410k → €457k, MSR-012 €550k → €553k).
    expect(x).toContain('Harbor Line Terminal Expansion HLT-026 Client · milestones €5.52M €1.35M €3.36M 3% M4 Cranes operational · €1.08M');
    expect(x).toContain('ERP Migration — Phase 2 ERP-202 Internal · capex — — €457k — —');
    expect(x).toContain('Marseille Metro Signage Rollout MSR-012 Client · fixed price €720k €0k €553k 17% Line B · €288k');
    expect(x).toContain('Paid Invoiced');
    expect(x).toContain('Cash flow — next 6 months Billing plan in · forecast spend out −1412k Oct +801k Nov +428k Dec +1331k Jan ’27 +1196k Feb +402k Mar Cash in Cash out Net per month above bars');
    expect(m).toContain('height:55%');
    expect(m).toContain('title="Invoiced · €2.97M"');
    expect(m).toContain('--ov-w:54%');
    expect(m).toContain('--ov-w:29%');
    expect(x).not.toContain('No project in this zone');
  });

  it('FR', async () => {
    const t = tOf('fr');
    const x = text(html(h(CashView, { view: cashView(await getCashScreen('pm', null), t, 'fr'), t }), 'fr'));
    expect(x).toContain('Montant du contrat 10,09 M€ 4 projets clients · 1 interne');
    expect(x).toContain('Point bas cumulé −1,41 M€ Octobre — avant l’encaissement de M3 (HLT-026)'); // A-12, C-10a, C-6, NEW-D3-3, R-073
    expect(x).toContain('Projet Modèle de facturation Contrat Facturé · payé En attente de paiement Coût à date Marge Prochain jalon');
    // C-10b (10 %) on R-073's figures: cost to date 1,21 M€ → 1,08 M€, margin at completion 2 % → 7 %.
    expect(x).toContain('Aménagement de la Clinique Pasteur Lyon RCF-019 Client · jalons 1,50 M€ 300 k€ 1,08 M€ 7% Livraison · 600 k€');
    expect(x).toContain('Trésorerie — 6 prochains mois Plan de facturation en entrée · dépenses prévues en sortie −1412k oct. +801k nov. +428k déc. +1331k janv. ’27 +1196k févr. +402k mars Encaissements Décaissements Net mensuel au-dessus des barres');
  });

  it('zone without projects in execution (apac): notice, zero figures; masked margins for other roles', async () => {
    const t = tOf('en');
    const x = text(html(h(CashView, { view: cashView(await getCashScreen('director', 'apac'), t, 'en'), t }), 'en'));
    expect(x).toContain('No project in this zone for this view');
    expect(x).toContain('Contract value €0k 0 client projects · 0 internal');
    const masked = html(h(CashView, { view: cashView(await getCashScreen('procurement', null), t, 'en'), t }), 'en');
    expect(count(text(masked), '•••')).toBe(5);
    expect(text(masked)).not.toMatch(/\b(3|19|7|17)%/); // the director's margins at completion (C-10b + R-073)
  });
});
