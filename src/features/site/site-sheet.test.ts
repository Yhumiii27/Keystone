// R-118 (D-3 'a') on the seeded in-memory database with the real session ("View as" cookie) and project context: "Prepare the
// site", "Edit site sheet" and the lines' Add / Edit / Remove — for the 9 personas (the project's leads and the director only),
// the stage window (Études … Mise en service & SAT; not at Initiative, Garantie, Clos, Annulé), the project's defaults, the empty
// plan (no prerequisite without a plan activity), stale positions and stamps, the lines kept (confirmed, signed, with a Sage
// actual), malformed input, the writers' own re-check with the actor, the audit trail, and what the page offers each viewer.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  usePathname: () => '/',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { sql } from 'drizzle-orm';
import { createElement as h, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { revalidatePath } from 'next/cache';
import SitePage from '@/app/(app)/projects/[code]/site/page';
import { PERSONAS } from '@/config/personas';
import { I18nProvider } from '@/i18n/client';
import { makeT } from '@/i18n/translate';
import type { RoleKey } from '@/config/screens';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { getSite } from '@/server/dal/site';
import { addSiteLine, createSiteSheet, removeSiteLine, siteSheetDefaults, updateSiteSheet } from '@/server/dal/site-sheet';
import { COOKIE } from '@/server/session';
import { addSiteLineAction, editSiteLineAction, editSiteSheetAction, prepareSiteAction, removeSiteLineAction } from './actions';
import type { SiteView } from './model';
import { SiteBody } from './site-view';

const ROLES = PERSONAS.map((p) => p.role);
const as = (role: RoleKey, lang: 'en' | 'fr' = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
const HLT = 'HLT-026';
const rows = async (q: string) => (await (await getDb()).execute(sql.raw(q))).rows as Record<string, unknown>[];
const site = async (code = HLT) => (await getSite(code))!;
const errorOf = (r: unknown) => (r && typeof r === 'object' && 'error' in r ? (r as { error: string }).error : 'ok');

const SHEET = {
  site: 'Port de Casablanca — Quai 2', country: 'Maroc', tz: 'Africa/Casablanca (UTC+1)', lang: 'Français', currency: 'EUR', contact: 'M. Alaoui · +212 5 22 00 00 00',
  hours: 'Lun–Sam 7h–18h', holidays: '18 nov.', access: 'Badge port', start: '2 Nov 2026', end: '27 Nov 2026',
};

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
async function pageView(code: string, sp: Record<string, string> = {}): Promise<SiteView> {
  const tree = (await SitePage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) })) as El;
  const kids = tree.props.children as unknown[];
  const body = kids.find((k) => isValidElement(k) && (k.type as { name?: string }).name === 'SiteBody') as El;
  return body.props.view as SiteView;
}

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('R-118 · who prepares and fills the site sheet (9 personas)', () => {
  it('HLT-026 "Add equipment": the PM and the director; the team member and the off-team head read; outside roles read; the client is sent home', async () => {
    const out: Record<string, string> = {};
    for (const role of ROLES) {
      as(role);
      if (role === 'client') {
        await expect(addSiteLineAction(HLT, 'equipment', { name: 'x' })).rejects.toThrow('REDIRECT /');
        out[role] = 'sent home';
        continue;
      }
      out[role] = errorOf(await addSiteLineAction(HLT, 'equipment', { name: `Échafaudage (${role})`, source: 'local_rental', note: 'Devis' }));
    }
    expect(out).toEqual({
      director: 'ok', pm: 'ok', depthead: 'The site is read-only for you', member: 'Only the project’s leads prepare and fill the site sheet',
      englead: 'The site is read-only for you', quality: 'The site is read-only for you', procurement: 'The site is read-only for you',
      finance: 'The site is read-only for you', logistics: 'The site is read-only for you', client: 'sent home',
    });
    const s = await site();
    expect(s.equipment.slice(8).map((e) => [e.position, e.name, e.source, e.status, e.note])).toEqual([
      [8, 'Échafaudage (director)', 'local_rental', 'pending', 'Devis'], [9, 'Échafaudage (pm)', 'local_rental', 'pending', 'Devis'],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    const [audit] = await listAudit({ projectCode: HLT, limit: 1 });
    expect([audit.who, audit.object, audit.change, audit.area]).toEqual(['Romain Aubert', 'Equipment · Échafaudage (pm)', 'added · Location locale', 'Site']);
  });

  it('what the page offers: the leads get the entry; the others none; "Prepare the site" only at the stage window', async () => {
    const offered: Record<string, unknown> = {};
    for (const role of ROLES.filter((r) => r !== 'client')) {
      as(role);
      const v = await pageView(HLT);
      offered[role] = !!v.entry && v.ready!.equip.every((e) => !!e.entry) && v.team!.rotation.every((r) => !!r.entry);
    }
    expect(offered).toEqual({ director: true, pm: true, depthead: false, member: false, englead: false, quality: false, procurement: false, finance: false, logistics: false });
    as('pm');
    const v = await pageView(HLT);
    expect(v.entry!.sheet.values).toMatchObject({ site: 'Terminal Harbor Line — Quai 4, Le Havre (FR)', currency: 'EUR', start: '19 Oct 2026', end: '18 Dec 2026' });
    expect(Object.entries(v.entry!.add).map(([k, f]) => [k, f?.title])).toEqual([
      ['prerequisite', 'Add client prerequisite'], ['equipment', 'Add equipment'], ['rotation', 'Add a rotation'], ['cost', 'Add mission cost line'],
    ]);
    // Signed and confirmed lines are kept; pending ones may be edited and removed; a mission line with a Sage actual is kept.
    expect(v.ready!.prereqs.map((p) => [p.status, p.entry!.editable, p.entry!.removable])).toEqual([
      ['Signed', false, false], ['Confirmed', false, false], ['Signed', false, false], ['Pending', true, true], ['Pending', true, true], ['Confirmed', false, false],
    ]);
    expect(v.team!.missionCosts.map((m) => [m.name, m.entry!.editable, m.entry!.removable])).toEqual([
      ['Voyages', true, false], ['Hébergement', true, true], ['Per diem', true, true], ['Majorations chantier (6j · 10h)', true, true],
      ['Location matériel local', true, false], ['Transport local & douane', true, false],
    ]);
    // The rotation's people: the project team (and the people already on the plan); a crew is typed.
    expect(v.entry!.add.rotation!.fields.find((f) => f.id === 'person')!.options!.map((o) => (typeof o === 'string' ? o : o.value))).toEqual([
      'Romain Aubert', 'Amélie Ollivier', 'Julien Wagner', 'Pauline Noguès', 'Thomas Kerbrat', 'Léa Marchand', 'Damien Roux', 'Hélène Sauvage', 'Fabien Bertrand',
      'Antoine Girard', 'Gabriel Comte', '__crew',
    ]);
    expect(v.team!.rotation.at(-1)!.entry!.values).toMatchObject({ person: '__crew', crew: 'Contractant — 2 monteurs' });
    // The sheet shows its Cursus site: not created yet (R-028: no request is queued).
    expect(v.ready!.meta.at(-1)).toEqual({ k: 'Cursus site', v: 'Not created yet' });
  });

  it('"Prepare the site" on the empty state: the leads between Études and Mise en service & SAT, with the project’s defaults', async () => {
    as('pm');
    const v = await pageView('PRS-038');
    expect(v.empty).toBe('No site sheet yet for this project — the project’s leads prepare it from the Études stage.');
    expect(v.prepare!.values).toEqual({ site: 'Le Havre', country: 'France', currency: 'EUR', contact: '' });
    expect(v.prepare!.form.fields.map((f) => [f.id, f.required ?? false])).toEqual([
      ['site', true], ['country', true], ['tz', false], ['lang', false], ['currency', false], ['contact', false], ['hours', false], ['holidays', false],
      ['access', false], ['start', true], ['end', true],
    ]);
    // QFR-015 (Clos): no "Prepare the site"; the member reads.
    expect((await pageView('QFR-015')).prepare).toBeNull();
    as('member');
    expect((await pageView('PRS-038')).prepare).toBeNull();
    as('director');
    const stages: Record<string, boolean> = {};
    for (const code of ['EWA-051', 'CER-047', 'ERP-202', 'NDC-031', 'RCF-019', 'MSR-012', 'ALP-021', 'QFR-015', 'SCP-033']) stages[code] = !!(await pageView(code)).prepare;
    expect(stages).toEqual({
      'EWA-051': false, 'CER-047': false, 'ERP-202': true, 'NDC-031': true, 'RCF-019': true, 'MSR-012': true, 'ALP-021': false, 'QFR-015': false, 'SCP-033': false,
    });
  });

  it('the stage gate and the rights refuse a forged call; the client is sent home', async () => {
    as('director');
    for (const code of ['EWA-051', 'ALP-021', 'QFR-015', 'SCP-033']) {
      expect(errorOf(await prepareSiteAction(code, SHEET))).toBe('The site sheet is prepared and filled from the Études stage until Mise en service & SAT');
    }
    as('pm');
    // NDC-031 is S. Perrin's project: Romain Aubert is not on its team (read-only).
    expect(errorOf(await prepareSiteAction('NDC-031', SHEET))).toBe('The site is read-only for you');
    as('member');
    expect(errorOf(await prepareSiteAction('PRS-038', SHEET))).toBe('The site is read-only for you');
    as('client');
    await expect(prepareSiteAction('PRS-038', SHEET)).rejects.toThrow('REDIRECT /');
    expect(await rows(`SELECT count(*)::int AS n FROM site_sheets`)).toEqual([{ n: 1 }]);
  });

  it('the PM prepares PRS-038: defaults for blank values, working days on the project calendar, no man-days, no Cursus site; once only', async () => {
    as('pm', 'fr');
    expect(await prepareSiteAction('PRS-038', { ...SHEET, site: ' ', country: '', contact: '', start: '19 oct. 2026', end: '18 déc. 2026' })).toEqual({ toast: 'Fiche chantier préparée' });
    const s = await site('PRS-038');
    expect(s.sheet).toMatchObject({
      site: 'Le Havre', country: 'France', timeZone: 'Africa/Casablanca (UTC+1)', currency: 'EUR', clientContact: '', startOn: '2026-10-19', endOn: '2026-12-18',
      planDays: 44, doneDays: 0, manDaysPlanned: 0, cursusChantierId: null,
    });
    expect([s.prerequisites, s.equipment, s.rotation, s.missionCosts, s.dailyReports]).toEqual([[], [], [], [], []]);
    // A new sheet: NO GO until Cursus verdicts exist (R-120).
    expect(s.go.ok).toBe(false);
    // R-028: no Cursus site-creation request is queued (Cursus has no creation endpoint).
    expect(await rows(`SELECT count(*)::int AS n FROM cursus_requests WHERE project_code = 'PRS-038'`)).toEqual([{ n: 0 }]);
    expect(await prepareSiteAction('PRS-038', SHEET)).toEqual({ error: 'Ce projet a déjà une fiche chantier' });
    const [audit] = await listAudit({ projectCode: 'PRS-038', limit: 1 });
    expect([audit.who, audit.object, audit.change]).toEqual(['Romain Aubert', 'Site sheet · PRS-038', 'prepared · 2026-10-19 → 2026-12-18 · 44 working days']);
    expect((await listActivity()).some((a) => a.what === 'Prepared the site sheet · Le Havre' && a.who === 'Romain Aubert')).toBe(true);
    // The writer refuses a second sheet too.
    await expect(createSiteSheet('PRS-038', { ...s.sheet, site: 'x', startOn: '2026-10-19', endOn: '2026-10-20', currency: 'EUR' } as never, { name: 'Romain Aubert', role: 'pm' }))
      .rejects.toThrow('This project already has a site sheet');
    // The new sheet's empty state per table, and the empty plan explained.
    as('pm');
    const v = await pageView('PRS-038');
    expect([v.ready!.noPrereq, v.ready!.noEquip, v.ready!.cursus.empty, v.team!.noRotation, v.team!.noCost, v.exec!.noReport]).toEqual([
      'No client prerequisite yet', 'No equipment yet', 'No approval received from Cursus yet', 'No one on the rotation plan yet', 'No mission cost line yet',
      'No daily report yet',
    ]);
    expect([v.entry!.add.prerequisite, v.entry!.noActivity]).toEqual([null, 'A prerequisite conditions an activity of the plan — this project’s plan has no activity yet']);
  });

  it('the empty plan: no prerequisite can be added (an activity of the plan is required)', async () => {
    as('pm');
    expect(errorOf(await addSiteLineAction('PRS-038', 'prerequisite', { title: 'Accès quai', activity: 'A1320', needed: '2 Nov 2026' })))
      .toBe('A prerequisite conditions an activity of the plan — this project’s plan has no activity yet');
    await expect(addSiteLine('PRS-038', { kind: 'prerequisite', value: { title: 'x', activityCode: 'A1320', neededBy: '2026-11-02', evidence: '' } }, { name: 'Romain Aubert', role: 'pm' }))
      .rejects.toThrow('A prerequisite conditions an activity of the plan');
  });

  it('defaults: the contract currency else the project currency else EUR; the first client stakeholder', async () => {
    expect(await siteSheetDefaults(HLT)).toEqual({ site: 'Le Havre', country: 'France', currency: 'EUR', clientContact: 'Nadia Bensaïd · n.bensaid@port-lehavre.fr' });
    await rows(`UPDATE projects SET currency = 'MAD' WHERE code = 'NDC-031'`);
    expect((await siteSheetDefaults('NDC-031')).currency).toBe('MAD');
    expect((await siteSheetDefaults('EWA-051')).currency).toBe('EUR');
  });
});

describe('R-118 · lines: next position, stale forms, kept lines', () => {
  it('a client prerequisite: an activity of the plan, Pending; edited while Pending; signed ones kept', async () => {
    as('pm');
    expect(await addSiteLineAction(HLT, 'prerequisite', { title: 'Plan de prévention signé', activity: 'A1320', needed: '26 Oct 2026', evidence: '' }))
      .toEqual({ toast: 'Prerequisite added · Plan de prévention signé' });
    expect(errorOf(await addSiteLineAction(HLT, 'prerequisite', { title: 'x', activity: 'A9999', needed: '26 Oct 2026' }))).toBe('Choose an activity of the project’s plan');
    expect(errorOf(await addSiteLineAction(HLT, 'prerequisite', { title: 'x', activity: 'A1320', needed: '31 Feb' }))).toBe('Needed by: enter a date such as 2 Nov 2026');
    let s = await site();
    const added = s.prerequisites.at(-1)!;
    expect([added.position, added.title, added.activityCode, added.activityName !== null, added.neededBy, added.status, added.evidence]).toEqual([
      6, 'Plan de prévention signé', 'A1320', true, '2026-10-26', 'pending', '',
    ]);
    expect(await editSiteLineAction(HLT, 'prerequisite', 6, added.stamp, { title: 'Plan de prévention signé', activity: 'A1410', needed: '28 Oct 2026', evidence: 'Envoyé 15 Oct' }))
      .toEqual({ toast: 'Line saved · Plan de prévention signé' });
    // The old stamp is stale now.
    expect(await editSiteLineAction(HLT, 'prerequisite', 6, added.stamp, { title: 'x', activity: 'A1320', needed: '26 Oct 2026' })).toEqual({ error: 'This line has changed — the page shows it as it is now' });
    s = await site();
    expect(s.prerequisites[6]).toMatchObject({ activityCode: 'A1410', neededBy: '2026-10-28', evidence: 'Envoyé 15 Oct', status: 'pending' });
    const [audit] = await listAudit({ projectCode: HLT, limit: 1 });
    expect([audit.object, audit.change, audit.before, audit.after]).toEqual([
      'Prerequisite · Plan de prévention signé', 'edited · activityCode, neededBy, evidence',
      { activityCode: 'A1320', neededBy: '2026-10-26', evidence: '' }, { activityCode: 'A1410', neededBy: '2026-10-28', evidence: 'Envoyé 15 Oct' },
    ]);
    // Signed (position 0) and confirmed (position 1) lines are kept.
    expect(await editSiteLineAction(HLT, 'prerequisite', 0, s.prerequisites[0].stamp, { title: 'x', activity: 'A1230', needed: '12 Oct 2026' })).toEqual({ error: 'A confirmed or signed line is kept' });
    expect(await removeSiteLineAction(HLT, 'prerequisite', 1, s.prerequisites[1].stamp)).toEqual({ ok: false, error: 'A confirmed or signed line is kept' });
  });

  it('removal keeps the other positions; the next line takes max + 1, and a form left open on a reused position is refused', async () => {
    as('director');
    let s = await site();
    const old = s.prerequisites[6];
    expect(await removeSiteLineAction(HLT, 'prerequisite', 6, old.stamp)).toEqual({ ok: true, toast: 'Line removed · Plan de prévention signé' });
    expect(await removeSiteLineAction(HLT, 'prerequisite', 6, old.stamp)).toEqual({ ok: false, error: 'This line has changed — the page shows it as it is now' });
    expect(await addSiteLineAction(HLT, 'prerequisite', { title: 'Consignation HT', activity: 'A1410', needed: '16 Nov 2026' })).toEqual({ toast: 'Prerequisite added · Consignation HT' });
    s = await site();
    expect(s.prerequisites.map((p) => p.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // A form opened on the removed line (same position, other content): refused, not applied to the new line.
    expect(await editSiteLineAction(HLT, 'prerequisite', 6, old.stamp, { title: 'x', activity: 'A1320', needed: '26 Oct 2026' })).toEqual({ error: 'This line has changed — the page shows it as it is now' });
    // Confirmed meanwhile: the edit is refused (the pending line's stamp changes with its status).
    const p = s.prerequisites[6];
    await rows(`UPDATE site_prerequisites SET status = 'confirmed' WHERE title = 'Consignation HT'`);
    expect(await editSiteLineAction(HLT, 'prerequisite', 6, p.stamp, { title: 'x', activity: 'A1320', needed: '26 Oct 2026' })).toEqual({ error: 'This line has changed — the page shows it as it is now' });
    const [removed] = (await listAudit({ projectCode: HLT, limit: 20 })).filter((a) => a.change === 'removed');
    expect([removed.who, removed.object, removed.before]).toEqual([
      'Marie Lefebvre', 'Prerequisite · Plan de prévention signé',
      // R-121: the removed line's J-15 alert and raised risk (none here) are part of what it was.
      {
        title: 'Plan de prévention signé', activityCode: 'A1410', neededBy: '2026-10-28', status: 'pending', evidence: 'Envoyé 15 Oct', confirmedOn: null, signedOn: null, position: 6,
        alertedNeededBy: null, alertedAt: null, riskId: null,
      },
    ]);
  });

  it('equipment: Pending lines edited and removed; a confirmed one kept; unknown source refused', async () => {
    as('pm');
    let s = await site();
    const pending = s.equipment.find((e) => e.name === 'Échafaudage (pm)')!;
    expect(errorOf(await editSiteLineAction(HLT, 'equipment', pending.position, pending.stamp, { name: 'x', source: 'airlift' }))).toBe('Unknown source');
    expect(await editSiteLineAction(HLT, 'equipment', pending.position, pending.stamp, { name: 'Échafaudage 12 m', source: 'client', note: '' })).toEqual({ toast: 'Line saved · Échafaudage 12 m' });
    s = await site();
    expect(s.equipment[pending.position]).toMatchObject({ name: 'Échafaudage 12 m', source: 'client', status: 'pending', note: '' });
    expect(await removeSiteLineAction(HLT, 'equipment', 0, s.equipment[0].stamp)).toEqual({ ok: false, error: 'A confirmed or signed line is kept' });
    expect(await removeSiteLineAction(HLT, 'equipment', pending.position, s.equipment[pending.position].stamp)).toEqual({ ok: true, toast: 'Line removed · Échafaudage 12 m' });
    expect((await site()).equipment.map((e) => e.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('rotations: a team member (linked to the person), a contractor crew, not someone off the team; man-days follow', async () => {
    as('pm');
    const before = (await site()).sheet.manDaysPlanned;
    expect(errorOf(await addSiteLineAction(HLT, 'rotation', { person: 'Marion Kerviel', role: 'Expertise', from: '9 Nov 2026', to: '13 Nov 2026' })))
      .toBe('Choose a person of the project team or type the contractor crew');
    expect(errorOf(await addSiteLineAction(HLT, 'rotation', { person: '__crew', crew: ' ', role: 'Montage', from: '9 Nov 2026', to: '13 Nov 2026' })))
      .toBe('Choose a person of the project team or type the contractor crew');
    expect(errorOf(await addSiteLineAction(HLT, 'rotation', { person: 'Fabien Bertrand', role: 'Logistique', from: '13 Nov 2026', to: '9 Nov 2026' })))
      .toBe('The departure is before the arrival');
    expect(errorOf(await addSiteLineAction(HLT, 'rotation', { person: 'Fabien Bertrand', role: 'Logistique', from: '9 Nov 2026', to: '13 Nov 2026', rotation: '0' })))
      .toBe('The rotation is a whole number from 1 to 99');
    expect(await addSiteLineAction(HLT, 'rotation', { person: 'Fabien Bertrand', role: 'Logistique', from: '9 Nov 2026', to: '13 Nov 2026', rotation: '2', lodging: 'Hôtel Vauban', travel: 'TGV' }))
      .toEqual({ toast: 'Rotation added · Fabien Bertrand' });
    expect(await addSiteLineAction(HLT, 'rotation', { person: '__crew', crew: 'Sous-traitant — 3 électriciens', role: 'Câblage', from: '16 Nov 2026', to: '27 Nov 2026' }))
      .toEqual({ toast: 'Rotation added · Sous-traitant — 3 électriciens' });
    let s = await site();
    expect(s.rotation.slice(6).map((r) => [r.position, r.person, !!r.personId, r.roleOnSite, r.fromOn, r.toOn, r.rotationNo, r.lodging, r.travel])).toEqual([
      [6, 'Fabien Bertrand', true, 'Logistique', '2026-11-09', '2026-11-13', 2, 'Hôtel Vauban', 'TGV'],
      [7, 'Sous-traitant — 3 électriciens', false, 'Câblage', '2026-11-16', '2026-11-27', 1, '', ''],
    ]);
    // Σ crew × working days on the project calendar: + 1 × 4 (11 Nov is a holiday) + 3 × 10 (the stored figure follows the screen's).
    expect(s.sheet.manDaysPlanned).toBe(before + 4 + 30);
    expect(await rows(`SELECT man_days_planned AS n FROM site_sheets s JOIN projects p ON p.id = s.project_id WHERE p.code = '${HLT}'`)).toEqual([{ n: before + 34 }]);
    // Edit: the crew becomes a team member; then removed.
    const crew = s.rotation[7];
    expect(await editSiteLineAction(HLT, 'rotation', 7, crew.stamp, { person: 'Damien Roux', role: 'Câblage', from: '16 Nov 2026', to: '20 Nov 2026' })).toEqual({ toast: 'Line saved · Damien Roux' });
    s = await site();
    expect([s.rotation[7].person, !!s.rotation[7].personId, s.sheet.manDaysPlanned]).toEqual(['Damien Roux', true, before + 4 + 5]);
    expect(await removeSiteLineAction(HLT, 'rotation', 7, s.rotation[7].stamp)).toEqual({ ok: true, toast: 'Line removed · Damien Roux' });
    expect((await site()).sheet.manDaysPlanned).toBe(before + 4);
  });

  it('mission cost lines: a budget only (the actual is never typed); a line with a Sage actual is kept', async () => {
    as('pm', 'fr');
    expect(errorOf(await addSiteLineAction(HLT, 'cost', { name: 'Assurance', budget: '-2' }))).toBe('Le budget est un montant en k€, 0 ou plus');
    expect(await addSiteLineAction(HLT, 'cost', { name: 'Assurance chantier', budget: '3,5', actual: '2' } as never)).toEqual({ toast: 'Ligne de coût de mission ajoutée · Assurance chantier' });
    let s = await site();
    const line = s.missionCosts.at(-1)!;
    expect([line.position, line.name, line.budgetKeur, line.actualKeur]).toEqual([6, 'Assurance chantier', 3.5, 0]);
    expect(await editSiteLineAction(HLT, 'cost', 6, line.stamp, { name: 'Assurance chantier', budget: '4', actual: '9' } as never)).toEqual({ toast: 'Ligne enregistrée · Assurance chantier' });
    s = await site();
    expect([s.missionCosts[6].budgetKeur, s.missionCosts[6].actualKeur]).toEqual([4, 0]);
    expect(await removeSiteLineAction(HLT, 'cost', 0, s.missionCosts[0].stamp)).toEqual({ ok: false, error: 'Une ligne avec un réel venu de Sage X3 est conservée' });
    expect(await removeSiteLineAction(HLT, 'cost', 6, s.missionCosts[6].stamp)).toEqual({ ok: true, toast: 'Ligne retirée · Assurance chantier' });
  });

  it('"Edit site sheet": a stale form is refused; moving the window recounts the working days; the audit keeps before / after', async () => {
    as('pm');
    const s = await site();
    expect(s.sheet.planDays).toBe(44);
    const values = { site: s.sheet.site, country: s.sheet.country, tz: s.sheet.timeZone, lang: s.sheet.language, currency: s.sheet.currency, contact: s.sheet.clientContact,
      hours: s.sheet.workingHours, holidays: s.sheet.localHolidays, access: s.sheet.accessConstraints, start: '19 Oct 2026', end: '18 Dec 2026' };
    // Same window: the seeded working days stay.
    expect(await editSiteSheetAction(HLT, s.sheet.stamp, { ...values, hours: 'Lun–Sam 7h–19h' })).toEqual({ toast: 'Site sheet saved' });
    expect((await site()).sheet).toMatchObject({ workingHours: 'Lun–Sam 7h–19h', planDays: 44 });
    expect(await editSiteSheetAction(HLT, s.sheet.stamp, values)).toEqual({ error: 'The site sheet has changed — the page shows it as it is now' });
    const fresh = (await site()).sheet;
    expect(errorOf(await editSiteSheetAction(HLT, fresh.stamp, { ...values, end: '1 Oct 2026' }))).toBe('The end date is before the start date');
    expect(errorOf(await editSiteSheetAction(HLT, fresh.stamp, { ...values, currency: 'XYZ' }))).toBe('Unknown currency');
    expect(errorOf(await editSiteSheetAction(HLT, fresh.stamp, { ...values, site: '' }))).toBe('The site is required');
    expect(await editSiteSheetAction(HLT, fresh.stamp, { ...values, hours: 'Lun–Sam 7h–19h', end: '27 Nov 2026' })).toEqual({ toast: 'Site sheet saved' });
    const after = (await site()).sheet;
    expect([after.endOn, after.planDays < 44, after.cursusChantierId]).toEqual(['2026-11-27', true, null]);
    const [audit] = await listAudit({ projectCode: HLT, limit: 1 });
    expect([audit.object, audit.change, audit.before, audit.after]).toEqual(['Site sheet · HLT-026', 'edited · endOn', { endOn: '2026-12-18' }, { endOn: '2026-11-27', planDays: after.planDays }]);
  });

  it('malformed input is refused before anything is read or written', async () => {
    as('pm');
    const n = await rows(`SELECT (SELECT count(*) FROM site_equipment) + (SELECT count(*) FROM site_rotations) AS n`);
    expect(errorOf(await addSiteLineAction(HLT, 'nope' as never, { name: 'x' }))).toBe('Invalid request');
    expect(errorOf(await addSiteLineAction(42 as never, 'equipment', { name: 'x' }))).toBe('Invalid request');
    expect(errorOf(await addSiteLineAction('NOPE-000', 'equipment', { name: 'x' }))).toBe('Unknown project');
    expect(errorOf(await addSiteLineAction(HLT, 'equipment', null as never))).toBe('The name is required');
    expect(errorOf(await addSiteLineAction(HLT, 'equipment', { name: 'x'.repeat(201) }))).toBe('A text is too long');
    expect(errorOf(await editSiteLineAction(HLT, 'equipment', -1, 'abc', { name: 'x' }))).toBe('Invalid request');
    expect(errorOf(await editSiteLineAction(HLT, 'equipment', 1.5, 'abc', { name: 'x' }))).toBe('Invalid request');
    expect(errorOf(await editSiteLineAction(HLT, 'equipment', 2, 'ABC!', { name: 'x' }))).toBe('Invalid request');
    expect(await removeSiteLineAction(HLT, 'equipment', '2' as never, 'abc')).toEqual({ ok: false, error: 'Invalid request' });
    expect(await removeSiteLineAction(HLT, 'equipment', 99, 'abc')).toEqual({ ok: false, error: 'This line has changed — the page shows it as it is now' });
    expect(errorOf(await editSiteSheetAction(HLT, '' as never, {}))).toBe('Invalid request');
    expect(await rows(`SELECT (SELECT count(*) FROM site_equipment) + (SELECT count(*) FROM site_rotations) AS n`)).toEqual(n);
  });

  it('the writers re-check with the actor (a direct call): workspace, lead, stage, stamp', async () => {
    const s = await site();
    const eqLine = { kind: 'equipment' as const, value: { name: 'x', source: 'shipped' as const, note: '' } };
    await expect(addSiteLine(HLT, eqLine, { name: 'Julien Wagner', role: 'member' })).rejects.toThrow('Only the project’s leads prepare and fill the site sheet');
    await expect(addSiteLine(HLT, eqLine, { name: 'Marion Kerviel', role: 'depthead' })).rejects.toThrow('Only the project’s leads prepare and fill the site sheet');
    await expect(addSiteLine(HLT, eqLine, { name: 'Nadia Bensaïd', role: 'client' })).rejects.toThrow('Site is outside your workspace');
    await expect(addSiteLine(HLT, eqLine, { name: 'Gabriel Comte', role: 'quality' })).rejects.toThrow('Site is outside your workspace');
    await expect(removeSiteLine(HLT, 'equipment', 2, 'nope', { name: 'Romain Aubert', role: 'pm' })).rejects.toThrow('This line has changed');
    await expect(updateSiteSheet(HLT, 'nope', { ...s.sheet, startOn: s.sheet.startOn, endOn: s.sheet.endOn } as never, { name: 'Romain Aubert', role: 'pm' }))
      .rejects.toThrow('The site sheet has changed');
    // HLT-026 moved to Garantie: nothing is entered any more (the existing actions keep their own rules).
    await rows(`UPDATE projects SET stage = 'garantie' WHERE code = '${HLT}'`);
    await expect(addSiteLine(HLT, eqLine, { name: 'Romain Aubert', role: 'pm' })).rejects.toThrow('The site sheet is prepared and filled from the Études stage');
    as('pm');
    expect(errorOf(await addSiteLineAction(HLT, 'equipment', { name: 'x' }))).toBe('The site sheet is prepared and filled from the Études stage until Mise en service & SAT');
    expect((await pageView(HLT)).entry).toBeNull();
    await rows(`UPDATE projects SET stage = 'fabrication_assemblage' WHERE code = '${HLT}'`);
  });
});

describe('R-118 · the screen', () => {
  const render = (code: string, v: SiteView) => renderToStaticMarkup(h(I18nProvider, { lang: 'en', children: h(SiteBody, { code, view: v, canEdit: true, context: code, t: makeT('en') }) }));

  it('the leads: "Edit site sheet", an "Add …" per table, Edit / Remove on the lines that allow it, the Cursus site not created yet', async () => {
    as('pm');
    let out = render(HLT, await pageView(HLT));
    expect(out).toContain('>Edit site sheet<');
    expect(out).toContain('>Add client prerequisite<');
    expect(out).toContain('>Add equipment<');
    expect(out).toContain('aria-label="Edit — Autorisation de levage &amp; arrêt exploitation quai 4"');
    expect(out).toContain('aria-label="Remove — Autorisation de levage &amp; arrêt exploitation quai 4"');
    expect(out).not.toContain('aria-label="Edit — Génie civil rails &amp; massifs réceptionnés"');
    expect(out).not.toContain('aria-label="Remove — Nacelle 20 m ×2"');
    expect(out).toMatch(/Cursus site<\/span><span[^>]*>Not created yet</);
    out = render(HLT, await pageView(HLT, { tab: 'team' }));
    expect(out).toContain('>Add a rotation<');
    expect(out).toContain('>Add mission cost line<');
    expect(out).toContain('aria-label="Remove — Hébergement"');
    expect(out).not.toContain('aria-label="Remove — Voyages"');
    expect(out).toContain('title="Waiting for Sage X3"');
    // The team member reads: no entry control.
    as('member');
    out = render(HLT, await pageView(HLT, { tab: 'team' }));
    expect([out.includes('Add a rotation'), out.includes('aria-label="Edit — '), out.includes('Edit site sheet')]).toEqual([false, false, false]);
  });

  it('the empty state offers "Prepare the site" to the leads only', async () => {
    as('director');
    const out = render('ERP-202', await pageView('ERP-202'));
    expect(out).toContain('No site sheet yet for this project — the project’s leads prepare it from the Études stage.');
    expect(out).toContain('>Prepare the site<');
    as('member');
    expect(render('ERP-202', await pageView('ERP-202'))).not.toContain('Prepare the site');
  });
});
