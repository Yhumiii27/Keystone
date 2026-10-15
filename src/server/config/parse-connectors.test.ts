// Delivery 8, lot connectors — the configuration variables it adds (src/server/config/parse.ts):
// - CURSUS_EVENTS_KEY (R-029, NEW-CURSUS-7): the key Cursus presents to POST /api/integrations/cursus/events — a separate
//   secret, the demo key outside production only, refused in production (an error; without a key the endpoint answers 503);
// - CURSUS_DIRECTORY (R-027, NEW-CURSUS-2): the staff directory import, off by default;
// - the GDPR reminder (R-173): meeting transcripts go to Anthropic when Claude analysis is on with real data.
import { describe, expect, it } from 'vitest';
import { DEMO_CURSUS_API_KEY, DEMO_CURSUS_EVENTS_KEY, formatIssues, parseConfig } from './parse';

const parse = (env: Record<string, string | undefined>) => parseConfig(env, { cwd: '/srv/keystone' });
const vars = (issues: { variable: string }[]) => issues.map((i) => i.variable);
// KEYSTONE_FILE_SCAN set explicitly: production otherwise warns about the antivirus (R-175, platform-ops lot).
const PROD = { NODE_ENV: 'production', KEYSTONE_AUTH: 'demo', KEYSTONE_FILE_SCAN: 'off', NEXT_PUBLIC_CODEX_URL: 'https://codex', NEXT_PUBLIC_CURSUS_URL: 'https://cursus', NEXT_PUBLIC_VIGIE_URL: 'https://vigie' };

describe('CURSUS_EVENTS_KEY (R-029)', () => {
  it('outside production: the demo events key by default, or the key given', () => {
    expect(parse({}).config.cursus).toMatchObject({ eventsKey: DEMO_CURSUS_EVENTS_KEY, directory: false });
    expect(parse({ CURSUS_EVENTS_KEY: 'k-events-0123456789' }).config.cursus.eventsKey).toBe('k-events-0123456789');
    // Never the outbound key (what Keystone sends to Cursus).
    expect(parse({ CURSUS_API_KEY: 'cursus-outbound-key' }).config.cursus.eventsKey).toBe(DEMO_CURSUS_EVENTS_KEY);
    expect(DEMO_CURSUS_EVENTS_KEY).not.toBe(DEMO_CURSUS_API_KEY);
  });

  it('production: no key → null (the endpoint refuses every call, no start-up error); the demo key is an error; a real key is kept and masked', () => {
    const none = parse(PROD);
    expect([none.errors, none.warnings, none.config.cursus.eventsKey]).toEqual([[], [], null]);
    const demo = parse({ ...PROD, CURSUS_EVENTS_KEY: DEMO_CURSUS_EVENTS_KEY });
    expect(formatIssues(demo.errors)).toEqual(['CURSUS_EVENTS_KEY is the demo events key, refused in production']);
    expect(demo.config.cursus.eventsKey).toBeNull();
    // Even with a Cursus on this machine (the loopback exception of the outbound key does not apply to inbound calls).
    expect(vars(parse({ ...PROD, CURSUS_API_URL: 'http://localhost:3210', CURSUS_EVENTS_KEY: DEMO_CURSUS_EVENTS_KEY }).errors)).toEqual(['CURSUS_EVENTS_KEY']);
    const ok = parse({ ...PROD, CURSUS_EVENTS_KEY: 'k-live-0123456789abcdef' });
    expect([ok.errors, ok.config.cursus.eventsKey, ok.config.secrets]).toEqual([[], 'k-live-0123456789abcdef', ['k-live-0123456789abcdef']]);
  });

  it('a key shorter than 16 characters is an error naming the variable, never its value; the default applies', () => {
    const r = parse({ CURSUS_EVENTS_KEY: 'short-key' });
    expect(formatIssues(r.errors)).toEqual(['CURSUS_EVENTS_KEY must be at least 16 characters']);
    expect(formatIssues(r.errors).join(' ')).not.toContain('short-key');
    expect(r.config.cursus.eventsKey).toBe(DEMO_CURSUS_EVENTS_KEY);
  });
});

describe('CURSUS_DIRECTORY (R-027)', () => {
  it('off unless "on"; an unknown value is an error', () => {
    expect(parse({}).config.cursus.directory).toBe(false);
    expect(parse({ CURSUS_DIRECTORY: 'off' }).config.cursus.directory).toBe(false);
    expect(parse({ CURSUS_DIRECTORY: 'ON' }).config.cursus.directory).toBe(true);
    const bad = parse({ CURSUS_DIRECTORY: 'daily' });
    expect([vars(bad.errors), bad.config.cursus.directory]).toEqual([['CURSUS_DIRECTORY'], false]);
  });
});

describe('GDPR reminder for Claude analysis (R-173)', () => {
  const AI = 'ANTHROPIC_API_KEY is set: meeting transcripts are sent to Anthropic for analysis — the sub-processing agreement (DPA) must be signed (GDPR)';
  it('warned in production or with the production data set while Claude analysis is on; never otherwise; no behaviour change', () => {
    expect(formatIssues(parse({ ...PROD, ANTHROPIC_API_KEY: 'sk-ant-0123456789' }).warnings)).toEqual([AI]);
    expect(formatIssues(parse({ KEYSTONE_SEED: 'production', ANTHROPIC_API_KEY: 'sk-ant-0123456789' }).warnings)).toEqual([AI]);
    expect(parse({ ...PROD, ANTHROPIC_API_KEY: 'sk-ant-0123456789', KEYSTONE_AI: 'off' }).warnings).toEqual([]);
    expect(parse({ ANTHROPIC_API_KEY: 'sk-ant-0123456789' }).warnings).toEqual([]);
    expect(parse(PROD).warnings).toEqual([]);
    expect(parse({ ...PROD, ANTHROPIC_API_KEY: 'sk-ant-0123456789' }).config.ai).toMatchObject({ anthropicApiKeySet: true, enabled: true });
    // The warning never echoes the key.
    expect(formatIssues(parse({ ...PROD, ANTHROPIC_API_KEY: 'sk-ant-0123456789' }).warnings).join(' ')).not.toContain('sk-ant');
  });
});
