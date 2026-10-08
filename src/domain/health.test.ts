import { describe, expect, it } from 'vitest';
import { healthOf } from './health';
import { PROTO_GEN } from '@/server/prototype';

describe('healthOf (golden values, docs/spec/01 §5.2)', () => {
  it('matches the prototype for the 6 projects with data', () => {
    const want: Record<string, string> = { 'HLT-026': 'at_risk', 'NDC-031': 'on_track', 'RCF-019': 'off_track', 'ERP-202': 'on_track', 'WSA-044': 'on_track', 'MSR-012': 'at_risk' };
    for (const p of PROTO_GEN.initialProjects.filter((x) => want[x.code])) expect([p.code, healthOf(p)]).toEqual([p.code, want[p.code]]);
  });
});
