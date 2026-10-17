// R-121 (D-4 'a'): which client prerequisites the daily job alerts (late at J-15 — the Site screen's rule —, once per need date,
// open stages only), when "Raise as a risk" is offered, and the "New risk" values proposed.
import { describe, expect, it } from 'vitest';
import { makeT } from '@/i18n/translate';
import {
  PREREQUISITE_RISK_CATEGORY, canRaisePrerequisiteRisk, prerequisiteNeedsAlert, prerequisiteRiskDraft, prerequisiteRiskTrigger, prerequisitesToAlert,
} from './prerequisite-alerts';
import { isPrerequisiteLate } from './site';

const pending = (neededBy: string, alertedNeededBy: string | null = null) => ({ status: 'pending' as const, neededBy, alertedNeededBy });

describe('which prerequisites are alerted', () => {
  it('late = still pending at J-15 of the need date, the same rule as the Site screen', () => {
    // Need date 2 Nov → J-15 = 18 Oct.
    expect([prerequisiteNeedsAlert(pending('2026-11-02'), '2026-10-17'), prerequisiteNeedsAlert(pending('2026-11-02'), '2026-10-18')]).toEqual([false, true]);
    for (const today of ['2026-10-17', '2026-10-18', '2026-11-03'])
      expect(prerequisiteNeedsAlert(pending('2026-11-02'), today)).toBe(isPrerequisiteLate(pending('2026-11-02'), today));
    expect(prerequisiteNeedsAlert({ status: 'confirmed', neededBy: '2026-11-02', alertedNeededBy: null }, '2026-11-03')).toBe(false);
    expect(prerequisiteNeedsAlert({ status: 'signed', neededBy: '2026-11-02', alertedNeededBy: null }, '2026-11-03')).toBe(false);
  });

  it('once per need date: alerted again only when the need date changed and is late again', () => {
    expect(prerequisiteNeedsAlert(pending('2026-11-02', '2026-11-02'), '2026-10-20')).toBe(false);
    // Need date moved to 20 Nov: not late on 20 Oct, late (new episode) on 5 Nov.
    expect(prerequisiteNeedsAlert(pending('2026-11-20', '2026-11-02'), '2026-10-20')).toBe(false);
    expect(prerequisiteNeedsAlert(pending('2026-11-20', '2026-11-02'), '2026-11-05')).toBe(true);
  });

  it('only on projects whose site sheet is open (Études … Mise en service & SAT)', () => {
    const rows = [
      { ...pending('2026-10-01'), stage: 'chantier' as const, id: 'a' },
      { ...pending('2026-10-01'), stage: 'etudes' as const, id: 'b' },
      { ...pending('2026-10-01'), stage: 'garantie' as const, id: 'c' },
      { ...pending('2026-10-01'), stage: 'clos' as const, id: 'd' },
      { ...pending('2026-10-01'), stage: 'apd' as const, id: 'e' },
      { ...pending('2026-12-01'), stage: 'chantier' as const, id: 'f' },
    ];
    expect(prerequisitesToAlert(rows, '2026-09-25').map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('demo data set at its date (Fri 25 Sep 2026): the two pending prerequisites (2 Nov, 20 Nov) are not late — the first run alerts nothing', () => {
    const demo = [pending('2026-11-02'), pending('2026-11-20')].map((p) => ({ ...p, stage: 'chantier' as const }));
    expect(prerequisitesToAlert(demo, '2026-09-25')).toEqual([]);
    expect(prerequisitesToAlert(demo, '2026-10-18')).toHaveLength(1);
    expect(prerequisitesToAlert(demo, '2026-11-05')).toHaveLength(2);
  });
});

describe('"Raise as a risk"', () => {
  it('offered while late and no risk raised yet', () => {
    const p = { status: 'pending' as const, neededBy: '2026-11-02', riskNumber: null };
    expect([canRaisePrerequisiteRisk(p, '2026-10-17'), canRaisePrerequisiteRisk(p, '2026-10-18')]).toEqual([false, true]);
    expect(canRaisePrerequisiteRisk({ ...p, riskNumber: 'R-21' }, '2026-10-18')).toBe(false);
    expect(canRaisePrerequisiteRisk({ ...p, status: 'confirmed' }, '2026-10-18')).toBe(false);
  });

  it('pre-fills title, category (Contractual / client, else the first offered), owner (the PM of record when listed) and response', () => {
    const p = { title: 'Autorisation de levage & arrêt exploitation quai 4', activityCode: 'A1320' };
    const owners = ['Julien Wagner', 'Romain Aubert'];
    const en = makeT('en');
    expect(prerequisiteRiskDraft(p, { pmName: 'Romain Aubert', owners, categories: ['technical', PREREQUISITE_RISK_CATEGORY] }, en)).toEqual({
      title: 'Late client prerequisite — Autorisation de levage & arrêt exploitation quai 4', cat: 'contractual_client', owner: 'Romain Aubert', resp: 'mitigate',
    });
    // Category inactive, PM not on the owner list: the form's first options.
    expect(prerequisiteRiskDraft(p, { pmName: 'Nobody', owners, categories: ['technical'] }, en)).toMatchObject({ cat: 'technical', owner: 'Julien Wagner' });
    // French: Keystone's words translated, the prerequisite as typed.
    expect(prerequisiteRiskDraft(p, { pmName: null, owners, categories: [] }, makeT('fr')).title).toBe('Prérequis client en retard — Autorisation de levage & arrêt exploitation quai 4');
  });

  it('the trigger records the cause: rule · prerequisite · activity · need date', () => {
    const p = { title: 'Point HT', activityCode: 'A1410' };
    expect(prerequisiteRiskTrigger(p, '20 Nov 2026', makeT('en'))).toBe('Client prerequisite not confirmed 15 days before its need date · Point HT · A1410 · 20 Nov 2026');
    expect(prerequisiteRiskTrigger(p, '20 nov. 2026', makeT('fr'))).toBe('Prérequis client non confirmé 15 jours avant sa date de besoin · Point HT · A1410 · 20 nov. 2026');
  });
});
