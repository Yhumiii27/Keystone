// R-130 (NEW-D1-1 a): "Needs attention" computed by rules — one case per rule, the order, the cap and the thresholds.
import { describe, expect, it } from 'vitest';
import { makeT, type T } from '@/i18n/translate';
import { ALERT_RULE_DEFAULTS, DEFAULT_ALERT_THRESHOLDS, portfolioAlertRules, type AlertInput, type AlertProject } from './portfolio-alerts';

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

  it('worst first: rule rank, then severity, then register order; capped', () => {
    const slip = (code: string, floatDays: number) => project({ code, name: code, schedule: { floatDays, finishText: 'x', baselineText: 'y', lateMilestones: [] } });
    const projects = [
      slip('S-1', -4), slip('S-2', -29), project({ code: 'C-1', name: 'C-1', actual: 440 }), project({ code: 'O-1', name: 'O-1', health: 'off_track', actual: 500, spi: 0.8 }),
    ];
    const all = portfolioAlertRules(
      input({ projects, people: { over: ['A'], peakWeeks: [42] }, approvals: [{ id: 'X', title: 'x', since: '2026-09-01' }] }), 'en', t,
    );
    expect(all.map((a) => a.key)).toEqual(['off-O-1', 'slip-S-2', 'slip-S-1', 'cost-C-1', 'people', 'approvals']);
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
