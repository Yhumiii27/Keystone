// View models and static render of Resource requests and Approvals on the seeded database (in-memory PGlite):
// the prototype's figures (08 §5.4, §6.4) in English and French, the viewer-based outbox and the read-only rendering.
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/resources/requests', useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return { getI18n: async () => ({ lang: 'fr', t: makeT('fr') }), getViewer: async () => PERSONA_BY_ROLE.pm, getLastProject: async () => 'HLT-026' };
});
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listResourceRequests } from '@/server/dal/requests';
import { getApprovalsScreenData } from '@/server/dal/requests-screens';
import { ApprovalsScreen } from './approvals-screen';
import { approvalsTitle, dataText, hoursRequestedText, hoursText, reqT, requestsCrumb, responseText, routingText } from './i18n';
import { approvalsModel, requestsScreenModel } from './model';
import { RequestsScreen } from './requests-screen';

const EN = makeT('en');
const FR = makeT('fr');
const PM = PERSONA_BY_ROLE.pm;
const HEAD = PERSONA_BY_ROLE.depthead;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('Resource requests model', () => {
  it('R. Aubert outbox (EN): KPIs, chips and RQ-038 row', async () => {
    const rows = await listResourceRequests({ requestedBy: PM.short });
    const m = requestsScreenModel(rows, null, EN, 'en', PM);
    expect(m.kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ['Requests sent', '9', 'Harbor Line · last 2 weeks'],
      ['Awaiting review', '4', '64 h requested'],
      ['Needs your answer', '1', 'Reschedule proposals'],
      ['Approved', '3', 'Now in team members’ lists'],
      // A-12 (chapter 4): working days from sending to the department's decision, mean of the 6 decided requests (prototype 1.4 d).
      ['Avg response', '1.0 d', 'Department heads'],
    ]);
    expect(m.kpis.map((k) => k.color)).toEqual(['var(--color-text)', 'var(--color-accent-300)', 'var(--color-accent-300)', 'var(--color-text)', 'var(--color-text)']);
    expect(m.chips.map((c) => `${c.label} ${c.count}`)).toEqual(['All 9', 'Pending 4', 'Reschedule proposed 1', 'Approved 3', 'Rejected / withdrawn 1']);
    expect(m.rows.map((r) => r.id)).toEqual(['RQ-044', 'RQ-043', 'RQ-042', 'RQ-041', 'RQ-040', 'RQ-039', 'RQ-038', 'RQ-037', 'RQ-035']);
    const r38 = m.rows.find((r) => r.id === 'RQ-038')!;
    expect(r38).toMatchObject({
      sent: 'Sent Tue 22 Sep', title: 'Re-route cable trays around crane rail', actLine: 'A1420 · Lighting & power distribution', initials: 'PN',
      person: 'Pauline Noguès', dept: 'MEP', dates: '30 Sep – 6 Oct', hours: '16 h', statusLabel: 'Reschedule proposed', tagClass: 'tag tag-outline',
      steps: [true, true, false], stepLabel: 'Not sent to the person yet', proposed: '12 Oct – 16 Oct', isReschedule: true, mine: true, critical: false, high: false,
    });
    const r41 = m.rows.find((r) => r.id === 'RQ-041')!;
    expect([r41.critical, r41.high, r41.response]).toEqual([true, true, 'Awaiting Marion Kerviel']);
    const r40 = m.rows.find((r) => r.id === 'RQ-040')!;
    expect([r40.stepLabel, r40.tagClass, r40.statusLabel, r40.steps]).toEqual(['In Damien’s list', 'tag tag-accent', 'Approved · assigned', [true, true, true]]);
    expect(m.rows.find((r) => r.id === 'RQ-043')!).toMatchObject({ person: 'Contract structural engineer', initials: 'Cse' }) // prototype initials() keeps the case;
    expect(requestsScreenModel(rows, 'rejected', EN, 'en', PM).rows.map((r) => r.id)).toEqual(['RQ-037']);
    expect(requestsCrumb(PM, false)).toBe('R. Aubert, project manager');
    expect(requestsCrumb(HEAD, false)).toBe('M. Kerviel, head of engineering');
  });

  it('French: KPI labels, statuses, dates and decision lines', async () => {
    const rows = await listResourceRequests({ requestedBy: PM.short });
    const m = requestsScreenModel(rows, null, FR, 'fr', PM);
    expect(m.kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ['Demandes envoyées', '9', 'Harbor Line · 2 dernières semaines'],
      ['En attente d’examen', '4', '64 h demandées'],
      ['Attend votre réponse', '1', 'Propositions de replanification'],
      ['Approuvées', '3', 'Dans les listes des membres de l’équipe'],
      ['Délai de réponse moyen', '1,0 j', 'Chefs de service'], // A-12
    ]);
    expect(m.chips.map((c) => c.label)).toEqual(['Tous', 'En attente', 'Replanification proposée', 'Approuvées', 'Refusées / retirées']);
    const r38 = m.rows.find((r) => r.id === 'RQ-038')!;
    expect([r38.sent, r38.dates, r38.proposed, r38.statusLabel, r38.dept]).toEqual(['Envoyée mar. 22 sept.', '30 sept. – 6 oct.', '12 oct. – 16 oct.', 'Replanification proposée', 'CVC-élec']);
    expect(r38.response).toBe('Replanification proposée · Sophie Renard · jeu. 24 sept. — Pauline is at 115% w/c 5 Oct on the HV connection; can start 12 Oct.');
    expect(m.rows.find((r) => r.id === 'RQ-040')!.response).toBe('Approuvée · Ines Duarte · jeu. 24 sept.');
    expect(m.rows.find((r) => r.id === 'RQ-040')!.statusLabel).toBe('Approuvée · affectée');
    expect(m.rows.find((r) => r.id === 'RQ-040')!.stepLabel).toBe('Dans la liste de Damien');
    expect(m.rows.find((r) => r.id === 'RQ-037')!.statusLabel).toBe('Refusée');
    expect(m.rows.find((r) => r.id === 'RQ-041')!.response).toBe('En attente de Marion Kerviel');
    const tt = reqT(FR, 'fr');
    expect(responseText('Withdrawn by PM · Fri 25 Sep', tt, 'fr')).toBe('Retirée par le chef de projet · ven. 25 sept.');
    expect(responseText('Rescheduled to 12 Oct – 16 Oct · accepted by PM · assigned', tt, 'fr')).toBe('Replanifiée du 12 oct. au 16 oct. · acceptée par le chef de projet · affectée');
    expect(responseText('Withdrawn by PM · Fri 25 Sep', EN, 'en')).toBe('Withdrawn by PM · Fri 25 Sep');
  });

  it('director sees every request, without PM actions on others’ requests', async () => {
    const rows = await listResourceRequests();
    const m = requestsScreenModel(rows, null, EN, 'en', PERSONA_BY_ROLE.director);
    expect(m.kpis[0].sub).toBe('2 projects · last 2 weeks');
    expect(m.rows.length).toBe(10);
    expect(m.rows.every((r) => !r.mine)).toBe(true);
  });

  it('renders the grid (FR) with PM actions only when allowed', async () => {
    const rows = await listResourceRequests({ requestedBy: PM.short });
    const tt = reqT(FR, 'fr');
    const html = renderToStaticMarkup(createElement(RequestsScreen, { model: requestsScreenModel(rows, null, FR, 'fr', PM), filter: null, canAct: true, t: tt }));
    for (const s of ['Demande', 'Tâche', 'Ressource', 'Quand', 'Réponse', 'Accepter 12 oct. – 16 oct.', 'Retirer', 'Redemander', 'href="/resources/requests?status=pending"', 'Une tâche n’atteint le membre'])
      expect(html).toContain(s);
    expect(html.match(/>Retirer</g)?.length).toBe(5); // 4 pending + 1 reschedule
    const ro = renderToStaticMarkup(createElement(RequestsScreen, { model: requestsScreenModel(rows, null, FR, 'fr', PM), filter: null, canAct: false, t: tt }));
    expect(ro).not.toContain('Retirer');
    expect(ro).not.toContain('Redemander');
  });
});

describe('Approvals model', () => {
  it('Engineering (EN): head, KPIs, queue, impact, team', async () => {
    const data = (await getApprovalsScreenData('Engineering'))!;
    const m = approvalsModel(data, EN, 'en', HEAD);
    expect(m.head).toEqual({ name: 'Marion Kerviel', initials: 'MK', role: 'Head of engineering' });
    expect(m.kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual([
      ['Pending approvals', '2', '52 h requested', 'var(--color-accent-300)'],
      // R-084 (owner answers 17 Oct 2026, third round): loads and committed hours from the schedules over the current window
      // (21 Sep – 15 Nov) — Julien Wagner 100 % on A1250; Engineering committed 327 h with the named demo assignments of 18 Oct
      // 2026 (90 % w/c 28 Sep and 1110 h on the seeded allocation rows and stored ROLES).
      ['Team load w/c 21 Sep', '100%', '1 person', 'var(--color-text)'],
      ['Capacity · 8 wks', '960 h', 'Committed 327 h', 'var(--color-text)'],
      ['Decided', '0', '0 approved · 0 rejected', 'var(--color-text)'],
      // A-12 (chapter 4): nothing decided yet in Engineering (prototype 0.9 d).
      ['Avg response', '—', 'Target ≤ 1 day', 'var(--color-text)'],
    ]);
    expect(m.queue.map((q) => q.id)).toEqual(['RQ-043', 'RQ-041']);
    const [q43, q41] = m.queue;
    expect(q41).toMatchObject({
      meta: 'Sent Thu 24 Sep by R. Aubert', project: 'Harbor Line', impact: 'Julien at 100% w/c 28 Sep → 130% with this request', // R-084 (90 → 120 %)
      impactColor: 'var(--color-accent-300)', target: 'Julien', approveLabel: 'Approve & send to Julien', proposedByShift: ['5 Oct – 7 Oct', '12 Oct – 14 Oct', '19 Oct – 21 Oct'], shiftLabels: ['+1 wk', '+2 wks', '+3 wks'],
    });
    expect(q43).toMatchObject({ impact: 'No named resource — contract hire, no current load', impactColor: 'var(--color-neutral-400)', target: 'procurement', approveLabel: 'Approve & send to procurement', dates: '28 Sep – 9 Oct', hours: '40 h' });
    expect(m.decided).toEqual([]);
    expect(m.team).toEqual([
      { name: 'Julien Wagner', role: 'Structural engineer', initials: 'JW', w1: { v: '100%', bg: 'var(--color-accent-800)', fg: 'var(--color-accent-200)' }, w2: { v: '100%', bg: 'var(--color-accent-800)', fg: 'var(--color-accent-200)' }, pend: '+12 h', pendColor: 'var(--color-accent-300)' },
    ]);
    // R-084: the pool reads the current window (it was the seeded allocation weeks, from 28 Sep).
    expect(m.weekHeads).toEqual(['21 Sep', '28 Sep']);
    expect(m.queueEmpty).toBe('Nothing waiting — every request for Engineering is decided');
  });

  it('Site operations and MEP (FR): decided list, empty queue, team heat', async () => {
    const site = approvalsModel((await getApprovalsScreenData('Site operations'))!, FR, 'fr', HEAD);
    expect(site.kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ['Approbations en attente', '0', '0 h demandées'],
      // R-084: the schedules' hours of Site operations' people (named demo assignments, 18 Oct 2026).
      ['Charge équipe sem. du 21 sept.', '81%', '2 personnes'],
      ['Capacité · 8 sem.', '640 h', 'Engagé 551 h'],
      ['Décidé', '2', '1 approuvée · 1 refusée'],
      ['Délai de réponse moyen', '1,0 j', 'Cible ≤ 1 jour'], // A-12: RQ-037 and RQ-039 answered the next working day
    ]);
    expect(site.decided.map((r) => [r.id, r.statusLabel])).toEqual([['RQ-039', 'Approuvée · affectée'], ['RQ-037', 'Refusée']]);
    expect(site.queueEmpty).toBe('Rien en attente — toutes les demandes pour Exploitation chantier sont traitées');
    // R-084 + named demo assignments (100 / 110 % and 60 / 100 % on the seeded rows).
    expect(site.team.map((p) => [p.name, p.w1.v, p.w2.v, p.pend])).toEqual([['Amélie Ollivier', '106%', '100%', '—'], ['Thomas Kerbrat', '56%', '56%', '—']]);
    expect(site.team[1].w2.bg).toBe('var(--color-neutral-900)');
    const mep = approvalsModel((await getApprovalsScreenData('MEP'))!, FR, 'fr', HEAD);
    expect(mep.decided.map((r) => r.id)).toEqual(['RQ-038']);
    expect(approvalsTitle('Engineering', reqT(FR, 'fr'))).toBe('Approbations — Ingénierie');
  });

  it('renders the Approvals screen (FR) with decisions only for deciders', async () => {
    const data = (await getApprovalsScreenData('Engineering'))!;
    const tt = reqT(FR, 'fr');
    const props = { model: approvalsModel(data, FR, 'fr', HEAD), department: 'Engineering', departments: data.departments.map((d) => ({ name: d.name, pending: d.pending })), t: tt };
    const html = renderToStaticMarkup(createElement(ApprovalsScreen, { ...props, canDecide: true }));
    for (const s of [
      'Marion Kerviel', 'Responsable ingénierie', 'En attente de votre décision', 'Approuver et envoyer à Julien', 'Approuver et envoyer aux achats',
      'Proposer une replanification', 'Julien à 100 % sem. du 28 sept. → 130 % avec cette demande', // R-084 'href="/resources/approvals/controls-planning"',
      'Charge de l’équipe', 'href="/my/tasks?person=Julien%20Wagner"', 'Aucune décision pour l’instant', 'Priorité haute', 'Chemin critique',
    ])
      expect(html).toContain(s);
    const ro = renderToStaticMarkup(createElement(ApprovalsScreen, { ...props, canDecide: false }));
    expect(ro).not.toContain('Approuver et envoyer');
    expect(ro).not.toContain('Proposer une replanification');
  });

  it('Controls & planning and Quality (EN): impact at the 110 % boundary, decided rows (prototype reqRow / apprKpis)', async () => {
    const cp = approvalsModel((await getApprovalsScreenData('Controls & planning'))!, EN, 'en', HEAD);
    // R-084: loads and committed hours from the schedules (87 % · 560 h on the seeded rows and stored ROLES); with the named
    // demo assignments (18 Oct 2026) the department is committed beyond its capacity — accent colour.
    expect(cp.kpis.map((k) => [k.value, k.sub])).toEqual([['1', '4 h requested'], ['86%', '3 people'], ['640 h', 'Committed 742 h'], ['2', '2 approved · 0 rejected'], ['0.5 d', 'Target ≤ 1 day']]); // A-12: RQ-035 same day, RQ-040 next day
    expect(cp.kpis[2].color).toBe('var(--color-accent-300)');
    // 99 % + round(4/40·100) = 109 % → not over, neutral colour (the seeded 100 % + 10 % = 110 % tested the boundary; the rule's
    // own tests keep it).
    expect(cp.queue.map((q) => [q.id, q.impact, q.impactColor, q.proposedByShift[0]])).toEqual([
      ['RQ-044', 'Fabien at 99% w/c 28 Sep → 109% with this request', 'var(--color-neutral-400)', '5 Oct – 6 Oct'],
    ]);
    expect(cp.decided.map((r) => [r.id, `${r.person} · ${r.dates} · ${r.hours}`, r.response])).toEqual([
      ['RQ-040', 'Damien Roux · 28 Sep – 1 Oct · 8 h', 'Approved · Ines Duarte · Thu 24 Sep'],
      ['RQ-035', 'Léa Marchand · 25 Sep – 29 Sep · 4 h', 'Approved · Ines Duarte · Mon 21 Sep'],
    ]);
    expect(cp.team.map((p) => [p.name, p.w1.v, p.w2.v, p.pend])).toEqual([
      ['Léa Marchand', '69%', '73%', '—'], ['Damien Roux', '88%', '99%', '—'], ['Fabien Bertrand', '100%', '99%', '+4 h'], // R-084 + named demo assignments
    ]);
    const q = approvalsModel((await getApprovalsScreenData('Quality'))!, EN, 'en', HEAD);
    expect(q.queue.map((x) => [x.id, x.impact, x.impactColor])).toEqual([['RQ-042', 'Hélène at 73% w/c 28 Sep → 93% with this request', 'var(--color-neutral-400)']]); // R-084 + named demo assignments (40 → 60 % on the seeded rows); R-084 (absences), demo leave shifted (owner 22 Oct 2026): her 2 sick days that week, 24 h capacity (44 → 64 % on 40 h)
    expect(q.decided.map((r) => [r.id, r.response])).toEqual([['RQ-036', 'Approved · Gabriel Comte · Mon 21 Sep']]);
  });

  it('French: people’s free text is never run through the segment/month rules; decimal hours use a comma', async () => {
    const rows = await listResourceRequests({ requestedBy: PM.short });
    const m = requestsScreenModel(rows, null, FR, 'fr', PM);
    // Seeded titles stay as stored (the prototype shows them in English; no "— seconde équipe" half-translation).
    expect(m.rows.find((r) => r.id === 'RQ-043')!.title).toBe('Steel connection checks — second crew');
    const q = approvalsModel((await getApprovalsScreenData('Engineering'))!, FR, 'fr', HEAD).queue.find((x) => x.id === 'RQ-041')!;
    expect(q.note).toBe('Needed before the CR-008 second crew mobilises on 5 Oct.');
    // A title typed in French is kept as typed ("Mon" is not a Monday).
    expect(dataText('Mon équipe — revue Sep', 'fr')).toBe('Mon équipe — revue Sep');
    expect(dataText('Untitled request', 'fr')).toBe('Demande sans titre');
    expect([hoursText(12.5, 'fr'), hoursText(12.5, 'en'), hoursRequestedText(64.5, 'fr')]).toEqual(['12,5 h', '12.5 h', '64,5 h demandées']);
  });

  it('routing sentence of the dialog (EN / FR)', () => {
    const r = { head: 'Marion Kerviel', department: 'Engineering', first: 'Julien', load: 90 };
    expect(routingText(r, EN, 'en')).toBe('Goes to Marion Kerviel (Engineering) for approval · Julien is at 90% that week. The task appears in the person’s list only once approved.');
    expect(routingText(r, FR, 'fr')).toBe('Envoyée à Marion Kerviel (Ingénierie) pour approbation · Julien est à 90 % cette semaine-là. La tâche n’apparaît dans la liste de la personne qu’une fois approuvée.');
    expect(routingText({ ...r, first: null, load: null }, EN, 'en')).toBe('Goes to Marion Kerviel (Engineering) for approval · contract hire — no current load. The task appears in the person’s list only once approved.');
  });
});
