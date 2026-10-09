import { describe, expect, it } from 'vitest';
import { DEFAULT_HEALTH_THRESHOLDS, clampHealthCpi, healthIndex, healthOf, healthOfIndex, usableThresholds } from './health';
import { overviewMetrics } from './portfolio';
import { PROTO_GEN } from '@/server/prototype';

describe('healthOf (golden values, docs/spec/01 §5.2)', () => {
  it('matches the prototype for the 6 projects with data', () => {
    const want: Record<string, string> = { 'HLT-026': 'at_risk', 'NDC-031': 'on_track', 'RCF-019': 'off_track', 'ERP-202': 'on_track', 'WSA-044': 'on_track', 'MSR-012': 'at_risk' };
    for (const p of PROTO_GEN.initialProjects.filter((x) => want[x.code])) expect([p.code, healthOf(p)]).toEqual([p.code, want[p.code]]);
  });
});

describe('one health rule (A-13)', () => {
  it('clamps CPI to [0.70, 1.25] and takes the lower of CPI and SPI', () => {
    expect([clampHealthCpi(0.4), clampHealthCpi(0.95), clampHealthCpi(3)]).toEqual([0.7, 0.95, 1.25]);
    expect(healthIndex({ budget: 1000, actual: 2000, progress: 0.5, spi: 1 })).toBe(0.7); // CPI 0.25 → 0.70
    expect(healthIndex({ budget: 1000, actual: 100, progress: 0.5, spi: 1.4 })).toBe(1.25); // CPI 5 → 1.25, SPI 1.4
    expect(healthIndex({ budget: 1000, actual: 500, progress: 0.5, spi: 0.92 })).toBe(0.92);
    expect(healthIndex({ budget: 1000, actual: 500, progress: 0.5, spi: null })).toBe(1); // SPI || 1
    expect(healthIndex({ budget: 1000, actual: 0, progress: 0.5 })).toBeNull();
    expect(healthIndex({ budget: 1000, actual: 10, progress: 0 })).toBeNull();
  });

  it('reads the thresholds it is given (Settings), defaults 0.97 / 0.90', () => {
    expect(DEFAULT_HEALTH_THRESHOLDS).toEqual({ risk: 0.97, off: 0.9 });
    expect([healthOfIndex(0.96), healthOfIndex(0.89), healthOfIndex(0.97)]).toEqual(['at_risk', 'off_track', 'on_track']);
    const p = { budget: 1000, actual: 500, progress: 0.5, spi: 0.93 };
    expect(healthOf(p)).toBe('at_risk');
    expect(healthOf(p, { risk: 0.92, off: 0.85 })).toBe('on_track');
    expect(healthOf(p, { risk: 1.1, off: 0.95 })).toBe('off_track');
  });

  it('falls back to the defaults on unusable stored thresholds', () => {
    expect(usableThresholds(null)).toEqual({ risk: 0.97, off: 0.9 });
    expect(usableThresholds({ risk: 0.9, off: 0.95 })).toEqual({ risk: 0.97, off: 0.9 });
    expect(usableThresholds({ risk: 3, off: 0.9 })).toEqual({ risk: 0.97, off: 0.9 });
    expect(usableThresholds({ risk: 0.95, off: 0.85 })).toEqual({ risk: 0.95, off: 0.85 });
  });

  it('the Overview uses the same rule (no health without actuals; thresholds passed through)', () => {
    expect(overviewMetrics({ budget: 500, actual: 0, progress: 0, spi: null }).health).toBeNull();
    const p = { budget: 1000, actual: 500, progress: 0.5, spi: 0.93 };
    expect(overviewMetrics(p).health).toBe(healthOf(p));
    expect(overviewMetrics(p, { risk: 0.92, off: 0.85 }).health).toBe('on_track');
    // The prototype's Overview used the unclamped CPI: 0.25 here; the verdict is the same off track.
    expect(overviewMetrics({ budget: 1000, actual: 2000, progress: 0.5, spi: 1 })).toMatchObject({ cpi: 0.25, health: 'off_track' });
  });
});
