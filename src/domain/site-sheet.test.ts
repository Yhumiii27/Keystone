// R-118 (D-3 'a') — the pure rules of the site sheet entered by the project's leads: the stage window, who, the forms'
// validation, what may change and the stamps that refuse a stale form.
import { describe, expect, it } from 'vitest';
import { parseDateInput } from './contract';
import {
  CONTRACTOR_CREW, SITE_STAGE_ERROR, canFillSiteSheet, costStamp, equipmentStamp, parseCostLineForm, parseEquipmentForm, parsePrerequisiteForm, parseRotationForm,
  parseSiteLine, parseSiteSheetForm, prerequisiteStamp, rotationStamp, sheetStamp, siteLineEditable, siteLineRemovable, siteSheetOpen, siteStamp,
} from './site-sheet';
import { STAGES } from '@/server/db/codes';

const pd = (s: string) => parseDateInput(s);

describe('stage window and who (D-3 a "dès les Études"; defaults for Garantie, Clos, Annulé)', () => {
  it('open from Études to Mise en service & SAT, closed before and after', () => {
    expect(Object.fromEntries(STAGES.map((s) => [s.code, siteSheetOpen(s.code)]))).toEqual({
      initiative: false, aps: false, apd: false, etudes: true, approvisionnements: true, fabrication_assemblage: true, fat: true, expedition: true, chantier: true,
      mise_en_service_sat: true, garantie: false, clos: false, annule: false,
    });
    expect(SITE_STAGE_ERROR).toMatch(/Études/);
  });

  it('a lead who may edit the Site, inside the window', () => {
    expect(canFillSiteSheet({ lead: true, canEdit: true, stage: 'etudes' })).toBe(true);
    expect(canFillSiteSheet({ lead: false, canEdit: true, stage: 'etudes' })).toBe(false);
    expect(canFillSiteSheet({ lead: true, canEdit: false, stage: 'etudes' })).toBe(false);
    expect(canFillSiteSheet({ lead: true, canEdit: true, stage: 'garantie' })).toBe(false);
  });
});

describe('the sheet form', () => {
  const ok = { site: 'Quai 4, Le Havre', country: 'France', tz: 'Europe/Paris', lang: 'Français', currency: 'USD', contact: ' N. Bensaïd ', hours: '', holidays: '', access: '', start: '19 Oct 2026', end: '18 déc. 2026' };
  it('typed values trimmed, blanks kept blank, dates in either language, currency of the list', () => {
    expect(parseSiteSheetForm(ok, pd)).toEqual({
      ok: true,
      value: {
        site: 'Quai 4, Le Havre', country: 'France', timeZone: 'Europe/Paris', language: 'Français', currency: 'USD', clientContact: 'N. Bensaïd', workingHours: '',
        localHolidays: '', accessConstraints: '', startOn: '2026-10-19', endOn: '2026-12-18',
      },
    });
    expect(parseSiteSheetForm({ ...ok, currency: '' }, pd)).toMatchObject({ ok: true, value: { currency: 'EUR' } });
  });
  it('refusals', () => {
    const err = (v: Record<string, string>) => {
      const r = parseSiteSheetForm({ ...ok, ...v }, pd);
      return r.ok ? 'ok' : r.error;
    };
    expect(err({ site: ' ' })).toBe('The site is required');
    expect(err({ country: '' })).toBe('The country is required');
    expect(err({ currency: 'FRF' })).toBe('Unknown currency');
    expect(err({ start: 'soon' })).toBe('Start: enter a date such as 19 Oct 2026');
    expect(err({ end: '' })).toBe('End: enter a date such as 18 Dec 2026');
    expect(err({ end: '18 Oct 2026' })).toBe('The end date is before the start date');
    expect(err({ end: '19 Oct 2026' })).toBe('ok');
    expect(err({ hours: 'x'.repeat(201) })).toBe('A text is too long');
    expect(err({ access: 'x'.repeat(500) })).toBe('ok');
    expect(err({ access: 'x'.repeat(501) })).toBe('A text is too long');
  });
});

describe('the lines’ forms (the prototype’s columns only)', () => {
  it('a prerequisite conditions an activity of the plan; none without a plan', () => {
    expect(parsePrerequisiteForm({ title: ' Accès quai ', activity: 'A1320', needed: '2 Nov 2026', evidence: '' }, ['A1230', 'A1320'], pd)).toEqual({
      ok: true, value: { title: 'Accès quai', activityCode: 'A1320', neededBy: '2026-11-02', evidence: '' },
    });
    expect(parsePrerequisiteForm({ title: 'x', activity: 'A1320', needed: '2 Nov 2026' }, [], pd)).toEqual({
      ok: false, error: 'A prerequisite conditions an activity of the plan — this project’s plan has no activity yet',
    });
    expect(parsePrerequisiteForm({ title: 'x', activity: 'A9', needed: '2 Nov 2026' }, ['A1320'], pd)).toEqual({ ok: false, error: 'Choose an activity of the project’s plan' });
    expect(parsePrerequisiteForm({ title: '', activity: 'A1320', needed: '2 Nov 2026' }, ['A1320'], pd)).toEqual({ ok: false, error: 'The title is required' });
    expect(parsePrerequisiteForm({ title: 'x', activity: 'A1320', needed: '' }, ['A1320'], pd)).toEqual({ ok: false, error: 'Needed by: enter a date such as 2 Nov 2026' });
  });

  it('equipment: a source of the list (default shipped)', () => {
    expect(parseEquipmentForm({ name: 'Nacelle', note: 'Mise à dispo' })).toEqual({ ok: true, value: { name: 'Nacelle', source: 'shipped', note: 'Mise à dispo' } });
    expect(parseEquipmentForm({ name: 'Nacelle', source: 'client' })).toMatchObject({ ok: true, value: { source: 'client', note: '' } });
    expect(parseEquipmentForm({ name: 'Nacelle', source: 'Client' })).toEqual({ ok: false, error: 'Unknown source' });
    expect(parseEquipmentForm({})).toEqual({ ok: false, error: 'The name is required' });
  });

  it('a rotation: a team member, the line’s own person kept, or a contractor crew typed; departure ≥ arrival; rotation 1–99', () => {
    const team = ['Amélie Ollivier', 'Julien Wagner'];
    const base = { role: 'Chef de chantier', from: '19 Oct 2026', to: '18 Dec 2026' };
    expect(parseRotationForm({ ...base, person: 'Julien Wagner', lodging: 'Hôtel Vauban', travel: 'TGV' }, team, pd)).toEqual({
      ok: true,
      value: { personName: 'Julien Wagner', crew: false, roleOnSite: 'Chef de chantier', fromOn: '2026-10-19', toOn: '2026-12-18', lodging: 'Hôtel Vauban', travel: 'TGV', rotationNo: 1 },
    });
    expect(parseRotationForm({ ...base, person: CONTRACTOR_CREW, crew: 'Contractant — 2 monteurs', rotation: '2' }, team, pd)).toMatchObject({
      ok: true, value: { personName: 'Contractant — 2 monteurs', crew: true, rotationNo: 2 },
    });
    const err = (v: Record<string, string>, keep?: string) => {
      const r = parseRotationForm({ ...base, person: 'Julien Wagner', ...v }, team, pd, keep);
      return r.ok ? 'ok' : r.error;
    };
    expect(err({ person: 'Marion Kerviel' })).toBe('Choose a person of the project team or type the contractor crew');
    expect(err({ person: 'Marion Kerviel' }, 'Marion Kerviel')).toBe('ok');
    expect(err({ person: CONTRACTOR_CREW, crew: '' })).toBe('Choose a person of the project team or type the contractor crew');
    expect(err({ person: '' })).toBe('Choose a person of the project team or type the contractor crew');
    expect(err({ role: '' })).toBe('The role on site is required');
    expect(err({ from: 'x' })).toBe('From: enter a date such as 19 Oct 2026');
    expect(err({ to: 'x' })).toBe('To: enter a date such as 13 Nov 2026');
    expect(err({ to: '18 Oct 2026' })).toBe('The departure is before the arrival');
    expect(err({ rotation: '0' })).toBe('The rotation is a whole number from 1 to 99');
    expect(err({ rotation: '100' })).toBe('The rotation is a whole number from 1 to 99');
    expect(err({ rotation: '1.5' })).toBe('The rotation is a whole number from 1 to 99');
  });

  it('a mission cost line: a budget in k€ (comma or point, ≥ 0); no actual', () => {
    expect(parseCostLineForm({ name: 'Voyages', budget: '12,4', actual: '3' })).toEqual({ ok: true, value: { name: 'Voyages', budgetKeur: 12.4 } });
    expect(parseCostLineForm({ name: 'Voyages', budget: '0' })).toEqual({ ok: true, value: { name: 'Voyages', budgetKeur: 0 } });
    for (const budget of ['', '-1', 'abc', '1.2345', '100001']) expect(parseCostLineForm({ name: 'Voyages', budget })).toEqual({ ok: false, error: 'The budget is an amount in k€, 0 or more' });
    expect(parseCostLineForm({ budget: '1' })).toEqual({ ok: false, error: 'The name is required' });
  });

  it('parseSiteLine dispatches per kind', () => {
    const ctx = { activities: ['A1320'], team: ['Julien Wagner'], parseDate: pd };
    expect(parseSiteLine('cost', { name: 'x', budget: '1' }, ctx)).toEqual({ ok: true, value: { kind: 'cost', value: { name: 'x', budgetKeur: 1 } } });
    expect(parseSiteLine('equipment', {}, ctx)).toEqual({ ok: false, error: 'The name is required' });
  });
});

describe('what may change, and stale forms', () => {
  it('prerequisites and equipment while Pending; rotations always; a cost line without an actual is removable', () => {
    expect(['pending', 'confirmed', 'signed'].map((status) => siteLineEditable('prerequisite', { status }))).toEqual([true, false, false]);
    expect(['pending', 'confirmed'].map((status) => siteLineRemovable('equipment', { status }))).toEqual([true, false]);
    expect([siteLineEditable('rotation', {}), siteLineRemovable('rotation', {})]).toEqual([true, true]);
    expect([siteLineEditable('cost', {}), siteLineRemovable('cost', { actualKeur: 4.2 }), siteLineRemovable('cost', { actualKeur: 0 })]).toEqual([true, false, true]);
  });

  it('a stamp changes with any value of the line, its status or its kind', () => {
    const p = { title: 'Accès', activityCode: 'A1320', neededBy: '2026-11-02', status: 'pending', evidence: '' };
    expect(prerequisiteStamp(p)).toBe(prerequisiteStamp({ ...p }));
    expect(new Set([
      prerequisiteStamp(p), prerequisiteStamp({ ...p, status: 'confirmed' }), prerequisiteStamp({ ...p, evidence: 'x' }), prerequisiteStamp({ ...p, neededBy: '2026-11-03' }),
    ]).size).toBe(4);
    expect(equipmentStamp({ name: 'a', source: 'shipped', status: 'pending', note: '' })).not.toBe(equipmentStamp({ name: 'a', source: 'client', status: 'pending', note: '' }));
    const r = { personName: 'J. W.', roleOnSite: 'x', fromOn: '2026-10-19', toOn: '2026-11-13', lodging: '', travel: '', rotationNo: 1 };
    expect(rotationStamp(r)).not.toBe(rotationStamp({ ...r, rotationNo: 2 }));
    expect(costStamp({ name: 'a', budgetKeur: 1, actualKeur: 0 })).not.toBe(costStamp({ name: 'a', budgetKeur: 1, actualKeur: 0.5 }));
    const s = { site: 's', country: 'c', timeZone: '', language: '', currency: 'EUR', clientContact: '', workingHours: '', localHolidays: '', accessConstraints: '', startOn: '2026-10-19', endOn: '2026-12-18' };
    expect(sheetStamp(s)).not.toBe(sheetStamp({ ...s, endOn: '2026-12-19' }));
    expect(siteStamp(['a', null])).toBe(siteStamp(['a', undefined]));
    expect(siteStamp(['a'])).toMatch(/^[0-9a-z]{1,16}$/);
  });
});
