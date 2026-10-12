// Delivery 8 · platform-ops — the configuration of backups (R-004) and of the antivirus on uploads (R-175): defaults (both
// off), validation, the production rules (KEYSTONE_FILE_SCAN explicit with the production data set, a warning otherwise),
// clamd's target without a default port, and values never echoed in messages.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_VARIABLES, formatIssues, parseConfig } from './parse';

const cwd = '/srv/keystone';
const parse = (env: Record<string, string | undefined>) => parseConfig(env, { cwd });
const vars = (issues: { variable: string }[]) => issues.map((i) => i.variable);

describe('backups (R-004)', () => {
  it('off by default (the Mac app, development): no folder, 10 minutes, 48h,30d,12m', () => {
    const r = parse({});
    expect(r.config.backup).toEqual({ dir: null, everyMin: 10, retention: { allHours: 48, dailyDays: 30, monthlyMonths: 12 } });
    expect(parse({ NODE_ENV: 'production', KEYSTONE_AUTH: 'demo', KEYSTONE_FILE_SCAN: 'off' }).config.backup.dir).toBeNull();
  });

  it('on with a folder (relative to the working directory), an interval and a retention', () => {
    const r = parse({ KEYSTONE_BACKUP_DIR: 'backups', KEYSTONE_BACKUP_EVERY_MIN: '5', KEYSTONE_BACKUP_RETENTION: '24h,14d,6m' });
    expect(r.errors).toEqual([]);
    expect(r.config.backup).toEqual({ dir: path.join(cwd, 'backups'), everyMin: 5, retention: { allHours: 24, dailyDays: 14, monthlyMonths: 6 } });
  });

  it('invalid values are errors; an interval above 15 min warns about the RPO; settings without a folder are ignored (warning)', () => {
    expect(vars(parse({ KEYSTONE_BACKUP_DIR: '/b', KEYSTONE_BACKUP_EVERY_MIN: '2' }).errors)).toEqual(['KEYSTONE_BACKUP_EVERY_MIN']);
    expect(vars(parse({ KEYSTONE_BACKUP_DIR: '/b', KEYSTONE_BACKUP_EVERY_MIN: '7.5' }).errors)).toEqual(['KEYSTONE_BACKUP_EVERY_MIN']);
    expect(vars(parse({ KEYSTONE_BACKUP_DIR: '/b', KEYSTONE_BACKUP_RETENTION: 'forever' }).errors)).toEqual(['KEYSTONE_BACKUP_RETENTION']);
    const slow = parse({ KEYSTONE_BACKUP_DIR: '/b', KEYSTONE_BACKUP_EVERY_MIN: '60' });
    expect(formatIssues(slow.warnings)).toEqual(['KEYSTONE_BACKUP_EVERY_MIN is above 15: the 15-minute recovery point objective (I-1b) cannot be met']);
    expect(vars(parse({ KEYSTONE_BACKUP_EVERY_MIN: '5', KEYSTONE_BACKUP_RETENTION: '48h,30d,12m' }).warnings)).toEqual(['KEYSTONE_BACKUP_EVERY_MIN', 'KEYSTONE_BACKUP_RETENTION']);
  });

  it('the folder must not be inside the files or pg folder of the data directory (the orphan prune would delete it), nor contain it', () => {
    for (const dir of ['/data/files/backups', '/data/pg', '/data/files', '/', '/data'])
      expect(vars(parse({ KEYSTONE_DATA_DIR: '/data', KEYSTONE_BACKUP_DIR: dir }).errors)).toEqual(['KEYSTONE_BACKUP_DIR']);
    expect(parse({ KEYSTONE_DATA_DIR: '/data', KEYSTONE_BACKUP_DIR: '/data/backups' }).errors).toEqual([]);
    expect(parse({ KEYSTONE_DATA_DIR: '/data', KEYSTONE_BACKUP_DIR: '/backups' }).errors).toEqual([]);
  });
});

describe('antivirus on uploads (R-175)', () => {
  const prod = { NODE_ENV: 'production', KEYSTONE_AUTH: 'demo' };

  it('off in development and tests; clamav with a host and port or a socket', () => {
    expect(parse({}).config.fileScan).toEqual({ mode: 'off', explicit: false, clamd: null });
    expect(parse({ KEYSTONE_FILE_SCAN: 'ClamAV', CLAMAV_HOST: 'clamav', CLAMAV_PORT: '3310' }).config.fileScan).toEqual({ mode: 'clamav', explicit: true, clamd: { host: 'clamav', port: 3310 } });
    expect(parse({ KEYSTONE_FILE_SCAN: 'clamav', CLAMAV_SOCKET: '/run/clamav/clamd.ctl', CLAMAV_HOST: 'x', CLAMAV_PORT: '1' }).config.fileScan.clamd).toEqual({ socket: '/run/clamav/clamd.ctl' });
    expect(parse({ KEYSTONE_FILE_SCAN: 'clamav', CLAMAV_HOST: '::1', CLAMAV_PORT: '9000' }).config.fileScan.clamd).toEqual({ host: '::1', port: 9000 });
    expect(parse({ KEYSTONE_FILE_SCAN: 'off' }).config.fileScan).toEqual({ mode: 'off', explicit: true, clamd: null });
  });

  it('clamav needs its target — no default port (3310 is the smoke-test port on the Mac); bad values are errors', () => {
    expect(formatIssues(parse({ KEYSTONE_FILE_SCAN: 'clamav' }).errors)).toEqual(['CLAMAV_HOST is required with KEYSTONE_FILE_SCAN=clamav (CLAMAV_HOST and CLAMAV_PORT, or CLAMAV_SOCKET)']);
    expect(vars(parse({ KEYSTONE_FILE_SCAN: 'clamav', CLAMAV_HOST: 'clamav' }).errors)).toEqual(['CLAMAV_PORT']);
    expect(vars(parse({ KEYSTONE_FILE_SCAN: 'clamav', CLAMAV_HOST: 'clam av', CLAMAV_PORT: '99999' }).errors).sort()).toEqual(['CLAMAV_HOST', 'CLAMAV_PORT']);
    expect(vars(parse({ KEYSTONE_FILE_SCAN: 'clamav', CLAMAV_SOCKET: 'relative.sock' }).errors)).toEqual(['CLAMAV_SOCKET']);
    expect(vars(parse({ KEYSTONE_FILE_SCAN: 'sophos' }).errors)).toEqual(['KEYSTONE_FILE_SCAN']);
    // Settings for clamd while scanning is off are ignored, with a warning.
    expect(vars(parse({ CLAMAV_HOST: 'clamav', CLAMAV_PORT: '3310' }).warnings)).toEqual(['CLAMAV_HOST', 'CLAMAV_PORT']);
  });

  it('production: an error with the production data set unless set explicitly (clamav or off); a warning in other production runs', () => {
    expect(vars(parse({ ...prod, KEYSTONE_AUTH: 'entra', KEYSTONE_SEED: 'production' }).errors)).toContain('KEYSTONE_FILE_SCAN');
    const explicitOff = parse({ NODE_ENV: 'production', KEYSTONE_SEED: 'production', KEYSTONE_FILE_SCAN: 'off' });
    expect(vars(explicitOff.errors)).not.toContain('KEYSTONE_FILE_SCAN');
    expect(vars(explicitOff.warnings)).not.toContain('KEYSTONE_FILE_SCAN');
    expect(vars(parse({ NODE_ENV: 'production', KEYSTONE_SEED: 'production', KEYSTONE_FILE_SCAN: 'clamav', CLAMAV_HOST: 'clamav', CLAMAV_PORT: '3310' }).errors)).not.toContain('KEYSTONE_FILE_SCAN');
    const mac = parse(prod); // the Mac app: production build, demo data
    expect([vars(mac.errors), vars(mac.warnings)]).toEqual([[], expect.arrayContaining(['KEYSTONE_FILE_SCAN'])]);
    expect(vars(parse({ ...prod, KEYSTONE_FILE_SCAN: 'off' }).warnings)).not.toContain('KEYSTONE_FILE_SCAN');
  });

  it('messages never print the values', () => {
    const r = parse({ KEYSTONE_FILE_SCAN: 'secret-mode', CLAMAV_HOST: 'h@st!', CLAMAV_PORT: 'p0rt', KEYSTONE_BACKUP_RETENTION: 'keep-it' });
    const text = formatIssues([...r.errors, ...r.warnings]).join(' ');
    for (const v of ['secret-mode', 'h@st!', 'p0rt', 'keep-it']) expect(text).not.toContain(v);
  });

  it('the new variables are part of the configuration cache key', () => {
    expect(CONFIG_VARIABLES).toEqual(expect.arrayContaining(['KEYSTONE_BACKUP_DIR', 'KEYSTONE_BACKUP_EVERY_MIN', 'KEYSTONE_BACKUP_RETENTION', 'KEYSTONE_FILE_SCAN', 'CLAMAV_HOST', 'CLAMAV_PORT', 'CLAMAV_SOCKET']));
  });
});
