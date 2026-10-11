import { describe, it } from 'vitest';
import { parseConfig } from '@/server/config/parse';
import { authMode } from '@/server/auth/config';

describe('production without KEYSTONE_AUTH', () => {
  it('starts in demo mode silently', () => {
    const env = { NODE_ENV: 'production', KEYSTONE_SEED: 'production', DATABASE_URL: 'postgres://u:p@db:5432/ks' };
    const r = parseConfig(env, { cwd: process.cwd() });
    console.log('ERRORS', JSON.stringify(r.errors), 'WARNINGS', JSON.stringify(r.warnings), 'MODE', authMode(env));
  });
});
