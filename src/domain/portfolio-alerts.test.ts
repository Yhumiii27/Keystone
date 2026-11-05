// R-130 (NEW-D1-1 a): "Needs attention" computed by rules — one case per rule, the order, the cap and the thresholds.
import { describe, expect, it } from 'vitest';
import { makeT, type T } from '@/i18n/translate';
import { ALERT_RULE_DEFAULTS, DEFAULT_ALERT_THRESHOLDS, alertTargetHref, portfolioAlertRules, type AlertInput, type AlertProject } from './portfolio-alerts';

const t: T = ((s: string) => s) as T;
const AS_OF = '2026-09-25';

const project = (over: Partial<AlertProject> = {}): AlertProject => ({
  code: 'AAA-001', name: 'Alpha', health: 'on_track', budget: 1000, actual: 400, progress: 0.4, spi: 1, schedule: null, billing: null, ...over,
});
const input = (over: Partial<AlertInput> = {}): AlertInput => ({ projects: [], people: null, approvals: [], asOf: AS_OF, ...over });

describe('portfolio alert rules', () => {
  it('defaults: Settings health thresholds; 5 days, 110 %, 8 alerts', () => {
    expect(ALERT_RULE_DEFAULTS).toEqual({ approvalDays: 5, overAllocatedPct: 110, maxAlerts: 8, onTimeChance: 0.2 }); // R-208: Monte-Carlo chance under 20 %.
    expect(DEFAULT_ALERT_THRESHOLDS.health).toEqual({ risk: 0.97, off: 0.9 });
  });

  it('a healthy portfolio has nothing to say', () => {
    expect(portfolioAlertRules(input({ projects: [project()] }), 'en', t)).toEqual([]);
  });

  it('off track: the weaker index names the screen; no separate cost alert', () => {
    // CPI = 1000 × 0.4 / 500 = 0.80; SPI 0.85 → the budget side is weaker.
    const p = project({ health: 'off_track', actual: 500, spi: 0.85 });
    const [a, ...rest] = portfolioAlertRules(input({ projects: [p] }), 'en', t);
    expect(rest).toEqual([]);
    expect(a).toEqual({
      key: 'off-AAA-001', kind: 'off_track', icon: 'clock-countdown', code: 'AAA-001', title: 'Alpha — off track',
      detail: 'SPI 0.85 · CPI 0.80 — below the off-track threshold 0.90.', action: 'Open budget', target: { screen: 'budget', code: 'AAA-001' },
    });
    const sched = portfolioAlertRules(input({ projects: [project({ health: 'off_track', actual: 450, spi: 0.84 })] }), 'fr', t)[0];
    expect([sched.title, sched.detail, sched.action, sched.target]).toEqual([
      'Alpha — hors trajectoire', 'SPI 0,84 · CPI 0,89 — sous le seuil « hors trajectoire » 0,90.', 'Open schedule', { screen: 'schedule', code: 'AAA-001' },
    ]);
  });

  it('critical-path slip vs late milestone', () => {
    const schedule = { floatDays: -12, finishText: '14 Jan 2027', baselineText: '18 Dec 2026', lateMilestones: ['Cranes operational'] };
    const [slip] = portfolioAlertRules(input({ projects: [project({ schedule })] }), 'en', t);
    expect(slip).toMatchObject({
      key: 'slip-AAA-001', kind: 'critical_slip', icon: 'lightning', title: 'Alpha — critical path slip',
      detail: 'Critical path −12 d · forecast finish 14 Jan 2027 (baseline 18 Dec 2026) · 1 milestone late: Cranes operational.', target: { screen: 'schedule', code: 'AAA-001' },
    });
    const [late] = portfolioAlertRules(input({ projects: [project({ schedule: { ...schedule, floatDays: 3, lateMilestones: ['A', 'B'] } })] }), 'fr', t);
    expect(late).toMatchObject({
      key: 'ms-AAA-001', kind: 'milestone_late', title: 'Alpha — jalon en retard', detail: 'Fin prévue 14 Jan 2027 (référence 18 Dec 2026) · 2 jalons en retard : A, B.',
    });
    // Float ≥ 0 and nothing late: no alert.
    expect(portfolioAlertRules(input({ projects: [project({ schedule: { ...schedule, floatDays: 0, lateMilestones: [] } })] }), 'en', t)).toEqual([]);
  });

  it('cost overrun below the "At risk below" threshold (CPI clamped to 0.70–1.25)', () => {
    // CPI = 400 / 440 = 0.909 → EAC 1 100, +100.
    const [a] = portfolioAlertRules(input({ projects: [project({ actual: 440, health: 'at_risk' })] }), 'en', t);
    expect(a).toMatchObject({ key: 'cost-AAA-001', kind: 'cost_overrun', icon: 'coins', detail: 'Forecast €1.10M vs budget €1.00M (+€100k) · CPI 0.91.', action: 'Open budget' });
    // CPI 0.98 ≥ 0.97: nothing; a custom threshold 0.99 raises it.
    const p = project({ actual: 408 });
    expect(portfolioAlertRules(input({ projects: [p] }), 'en', t)).toEqual([]);
    expect(portfolioAlertRules(input({ projects: [p] }), 'en', t, { ...DEFAULT_ALERT_THRESHOLDS, health: { risk: 0.99, off: 0.9 } }).map((x) => x.kind)).toEqual(['cost_overrun']);
    // CPI 0.25 clamps to 0.70.
    const [clamped] = portfolioAlertRules(input({ projects: [project({ actual: 1600, health: 'at_risk' })] }), 'en', t);
    expect(clamped.detail).toBe('Forecast €1.43M vs budget €1.00M (+€429k) · CPI 0.70.');
    // No actuals: no index, no alert.
    expect(portfolioAlertRules(input({ projects: [project({ actual: 0 })] }), 'en', t)).toEqual([]);
  });

  it('billing late: overdue invoice first (document currency), else a milestone not invoiced', () => {
    const billing = {
      currency: 'USD' as const,
      overdue: [{ number: 'INV-2026-004', amountKeur: 1200, dueOn: '2026-09-10' }, { number: 'INV-2026-005', amountKeur: 10, dueOn: '2026-09-20' }],
      late: [{ number: 'M4', label: 'Cranes operational', dueOn: '2026-09-01' }],
    };
    const [inv] = portfolioAlertRules(input({ projects: [project({ billing })] }), 'en', t);
    expect(inv).toMatchObject({
      key: 'bill-AAA-001', kind: 'billing_late', icon: 'receipt', title: 'Alpha — invoice overdue', detail: 'INV-2026-004 · $1.20M due 10 Sep 2026 · 1 more.',
      action: 'Open billing', target: { screen: 'billing', code: 'AAA-001' },
    });
    const [ms] = portfolioAlertRules(input({ projects: [project({ billing: { ...billing, overdue: [] } })] }), 'fr', t);
    expect([ms.title, ms.detail]).toEqual(['Alpha — facturation en retard', 'M4 Cranes operational · date contractuelle 1 Sep 2026, non facturé.']);
    expect(portfolioAlertRules(input({ projects: [project({ billing: { ...billing, overdue: [], late: [] } })] }), 'en', t)).toEqual([]);
  });

  it('over-allocation of the pool (portfolio-wide)', () => {
    const [a] = portfolioAlertRules(input({ people: { over: ['A', 'B', 'C', 'D', 'E'], peakWeeks: [44, 42, 43, 46] } }), 'en', t);
    expect(a).toEqual({
      key: 'people', kind: 'over_allocation', icon: 'users-three', code: null, title: '5 people over 110%', detail: 'Weeks 42–44, 46 · A, B, C and 2 more.',
      action: 'Rebalance', target: { screen: 'resources' },
    });
    const [fr] = portfolioAlertRules(input({ people: { over: ['A', 'B', 'C', 'D'], peakWeeks: [42] } }), 'fr', t);
    expect([fr.title, fr.detail]).toEqual(['4 personnes au-delà de 110 %', 'Semaine 42 · A, B, C et 1 autre.']);
    expect(portfolioAlertRules(input({ people: { over: [], peakWeeks: [] } }), 'en', t)).toEqual([]);
  });

  it('approvals waiting more than N days (strictly), oldest named', () => {
    const approvals = [
      { id: 'CR-008', title: 'Crane rail', since: '2026-09-20' }, // 5 d: not yet
      { id: 'PO-1', title: 'Steel', since: '2026-09-18' }, // 7 d
      { id: 'INV-9', title: 'Supplier', since: '2026-09-10' }, // 15 d
    ];
    const [a] = portfolioAlertRules(input({ approvals }), 'en', t);
    expect(a).toEqual({
      key: 'approvals', kind: 'approvals_waiting', icon: 'stamp', code: null, title: '2 approvals waiting more than 5 days',
      detail: 'Oldest: INV-9 · Supplier · since 10 Sep 2026 (15 d).', action: 'Open my approvals', target: { screen: 'myapprovals' },
    });
    expect(portfolioAlertRules(input({ approvals }), 'en', t, { ...DEFAULT_ALERT_THRESHOLDS, approvalDays: 10 })[0].title).toBe('1 approval waiting more than 10 days');
    expect(portfolioAlertRules(input({ approvals: approvals.slice(0, 1) }), 'en', t)).toEqual([]);
  });

  // S-33 (owner, 5 Nov 2026): ordered by urgency and importance (class, then magnitude), no longer by rule — was
  // ['off-O-1', 'slip-S-2', 'slip-S-1', 'cost-C-1', 'people', 'approvals']. Here: O-1 is 0.10 under the off-track threshold (50 %
  // of class 1) before S-2's −29 d (48 %); the approval waiting 24 days (80 % of class 3) before 1 person over-allocated (20 %).
  it('worst first (S-33): class, then magnitude, then register order; capped', () => {
    const slip = (code: string, floatDays: number) => project({ code, name: code, schedule: { floatDays, finishText: 'x', baselineText: 'y', lateMilestones: [] } });
    const projects = [
      slip('S-1', -4), slip('S-2', -29), project({ code: 'C-1', name: 'C-1', actual: 440 }), project({ code: 'O-1', name: 'O-1', health: 'off_track', actual: 500, spi: 0.8 }),
    ];
    const all = portfolioAlertRules(
      input({ projects, people: { over: ['A'], peakWeeks: [42] }, approvals: [{ id: 'X', title: 'x', since: '2026-09-01' }] }), 'en', t,
    );
    expect(all.map((a) => a.key)).toEqual(['off-O-1', 'slip-S-2', 'slip-S-1', 'cost-C-1', 'approvals', 'people']);
    const capped = portfolioAlertRules(input({ projects, people: { over: ['A'], peakWeeks: [42] } }), 'en', t, { ...DEFAULT_ALERT_THRESHOLDS, maxAlerts: 2 });
    expect(capped.map((a) => a.key)).toEqual(['off-O-1', 'slip-S-2']);
  });
});

describe('R-208: Monte-Carlo chance of meeting the end date', () => {
  const p = (riskAnalysis: AlertProject['riskAnalysis']): AlertProject => ({
    code: 'HLT-026', name: 'Harbor Line', health: 'on_track', budget: 1000, actual: 400, progress: 0.4, spi: 1, schedule: null, billing: null, riskAnalysis,
  });
  const run = (projects: AlertProject[]) => portfolioAlertRules({ projects, people: null, approvals: [], asOf: '2026-09-25' }, 'en', makeT('en'));
  it('lists a project whose latest run gives less than 20 % (stored values only)', () => {
    const a = run([p({ probOnTarget: 0.12, p80Finish: '2027-02-05', target: '2026-12-18' })]);
    expect(a.map((x) => [x.kind, x.title, x.action, x.target])).toEqual([
      ['risk_forecast', 'Harbor Line — low chance of meeting the end date', 'Open risk register', { screen: 'risks', code: 'HLT-026' }],
    ]);
    expect(a[0].detail).toMatch(/^Monte-Carlo risk analysis: 12 % · P80 finish .+ \(target .+\)\.$/);
    expect(run([p({ probOnTarget: 0.35, p80Finish: '2027-02-05', target: '2026-12-18' })])).toEqual([]);
    expect(run([p(null)])).toEqual([]);
    expect(run([p(undefined)])).toEqual([]);
  });
});

describe('S-30: supplier schedule slipping (threshold S-31)', () => {
  const slips: AlertProject['supplierSlips'] = [
    { po: 'PO-1082', supplier: 'Acme', slipDays: 7, activity: 'Fabrication' },
    { po: 'PO-1078', supplier: 'Steelco', slipDays: 12, activity: null },
    { po: 'PO-1090', supplier: 'Bolt', slipDays: 4, activity: 'FAT' },
  ];
  const p = (supplierSlips: AlertProject['supplierSlips']) => project({ code: 'HLT-026', name: 'Harbor Line', supplierSlips });
  it('one line per project: the worst schedule at or above the threshold named, the others counted; opens the order', () => {
    const [a, ...rest] = portfolioAlertRules(input({ projects: [p(slips)] }), 'en', t);
    expect(rest).toEqual([]);
    expect(a).toMatchObject({
      key: 'supplier-HLT-026', kind: 'supplier_slip', icon: 'truck', code: 'HLT-026', title: 'Harbor Line — supplier schedule slipping',
      detail: 'PO-1078 · Steelco · +12 working days (threshold 5) · 1 more.', action: 'Open the order', target: { screen: 'orders', code: 'HLT-026', params: { po: 'PO-1078' } },
    });
    expect(alertTargetHref(a.target)).toBe('/projects/HLT-026/orders?po=PO-1078');
    expect(alertTargetHref({ screen: 'schedule', code: 'HLT-026' })).toBe('/projects/HLT-026/schedule');
    const [fr] = portfolioAlertRules(input({ projects: [p(slips.slice(0, 1))] }), 'fr', t);
    expect([fr.title, fr.detail]).toEqual(['Harbor Line — planning fournisseur en glissement', 'PO-1082 · Acme · +7 jours ouvrés (seuil 5) · Fabrication.']);
  });
  it('the Settings threshold; nothing under it or without schedules', () => {
    expect(portfolioAlertRules(input({ projects: [p(slips)] }), 'en', t, { ...DEFAULT_ALERT_THRESHOLDS, supplierSlipDays: 13 })).toEqual([]);
    const [a] = portfolioAlertRules(input({ projects: [p(slips)] }), 'en', t, { ...DEFAULT_ALERT_THRESHOLDS, supplierSlipDays: 4 });
    expect(a.detail).toBe('PO-1078 · Steelco · +12 working days (threshold 4) · 2 more.');
    expect(portfolioAlertRules(input({ projects: [p(slips.slice(2))] }), 'en', t)).toEqual([]);
    expect(portfolioAlertRules(input({ projects: [p(undefined)] }), 'en', t)).toEqual([]);
  });
  // S-33: was ['ms-MS-1', 'supplier-S-2', 'supplier-S-1', 'mc-MC-1'] (rule order). Now by magnitude inside class 2: the 10 %
  // Monte-Carlo chance (half the 20 % threshold missing: 50 %), then 1 late milestone and a 20-day slip (both 33 %: the former rule
  // order breaks the tie), then a 6-day slip (10 %).
  it('ranked by magnitude in class 2 (S-33); the worse slip first', () => {
    const late = project({ code: 'MS-1', name: 'MS-1', schedule: { floatDays: 2, finishText: 'x', baselineText: 'y', lateMilestones: ['M'] } });
    const mc = project({ code: 'MC-1', name: 'MC-1', riskAnalysis: { probOnTarget: 0.1, p80Finish: '2027-01-04', target: null } });
    const small = project({ code: 'S-1', name: 'S-1', supplierSlips: [{ po: 'PO-1', supplier: 'X', slipDays: 6, activity: null }] });
    const big = project({ code: 'S-2', name: 'S-2', supplierSlips: [{ po: 'PO-2', supplier: 'Y', slipDays: 20, activity: null }] });
    expect(portfolioAlertRules(input({ projects: [mc, small, late, big] }), 'en', makeT('en')).map((a) => a.key)).toEqual(['mc-MC-1', 'ms-MS-1', 'supplier-S-2', 'supplier-S-1']);
  });
  it('S-33 / S-34: a slip pushing the project finish by the impact threshold ranks with the end-date alerts; the impact is shown', () => {
    const slipCp = project({ code: 'CP-1', name: 'CP-1', schedule: { floatDays: -3, finishText: 'x', baselineText: 'y', lateMilestones: [] } });
    const push = (finishImpactDays: number | null) => project({ code: 'S-1', name: 'S-1', supplierSlips: [
      { po: 'PO-1', supplier: 'X', slipDays: 8, activity: null, finishImpactDays },
      { po: 'PO-2', supplier: 'Y', slipDays: 12, activity: null, finishImpactDays: 0 },
    ] });
    const mc = project({ code: 'MC-1', name: 'MC-1', riskAnalysis: { probOnTarget: 0.1, p80Finish: '2027-01-04', target: null } });
    // 6 working days ≥ 5: class 1, 10 % (6 / 60) — before the 3-day critical slip (5 %) and every class-2 alert.
    const hit = portfolioAlertRules(input({ projects: [mc, slipCp, push(6)] }), 'en', t);
    expect(hit.map((a) => a.key)).toEqual(['supplier-S-1', 'slip-CP-1', 'mc-MC-1']);
    // The schedule pushing the finish is named first, even with the smaller slip.
    expect(hit[0].detail).toBe('PO-1 · X · +8 working days (threshold 5) · project finish +6 working days · 1 more.');
    expect(portfolioAlertRules(input({ projects: [push(6)] }), 'fr', t)[0].detail).toBe('PO-1 · X · +8 jours ouvrés (seuil 5) · fin du projet +6 jours ouvrés · 1 de plus.');
    // Under the impact threshold (Settings): class 2, ranked by the slip (12 / 60 = 20 %) after the Monte-Carlo alert (50 %).
    expect(portfolioAlertRules(input({ projects: [mc, slipCp, push(6)] }), 'en', t, { ...DEFAULT_ALERT_THRESHOLDS, supplierImpactDays: 7 }).map((a) => a.key))
      .toEqual(['slip-CP-1', 'mc-MC-1', 'supplier-S-1']);
    expect(portfolioAlertRules(input({ projects: [mc, slipCp, push(null)] }), 'en', t).map((a) => a.key)).toEqual(['slip-CP-1', 'mc-MC-1', 'supplier-S-1']);
    expect(portfolioAlertRules(input({ projects: [push(null)] }), 'en', t)[0].detail).toBe('PO-2 · Y · +12 working days (threshold 5) · 1 more.');
  });
});
