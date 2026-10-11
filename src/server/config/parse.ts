// Keystone configuration (R-007): every environment variable the server reads, validated with zod in ONE place.
// Pure module (no I/O besides the `env` object it is given): src/server/config/index.ts applies it to process.env, the
// start-up check (src/server/startup.ts) and `npm run db:migrate` fail fast on its errors in production, and the tests feed
// it plain objects. .env.example documents every variable.
//
// Rules
// - An empty value counts as unset (a blank line in a .env file must not switch a connector on).
// - A value that is set but invalid is an error. In production (NODE_ENV=production) errors stop the server at start-up; in
//   development and tests they are logged once and the variable falls back to its default.
// - Production refuses the Cursus demo API key ("demo-keystone"): CURSUS_API_URL needs CURSUS_API_KEY (or KEYSTONE_API_KEY),
//   except for a Cursus on this machine (loopback URL — the Mac app next to a local Cursus), where it is only a warning.
// - Messages name the variable, never its value (values may be secrets).
// - NEXT_PUBLIC_* URLs are inlined in the bundles at build time (`next build`) and read by the integration modules that are
//   safe in client components (src/server/integrations/*/config.ts); they are only validated here.
import path from 'node:path';
import { z } from 'zod';

export const SEED_MODES = ['demo', 'production'] as const;
/** What a NEW database is seeded with (KEYSTONE_SEED): the prototype data set, or reference data only (A-15). */
export type SeedMode = (typeof SEED_MODES)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export const LOG_FORMATS = ['json', 'pretty'] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];
export type RuntimeEnv = 'development' | 'production' | 'test';

/** Cursus's demo API key (Cursus README: KEYSTONE_API_KEY default) — accepted outside production only. */
export const DEMO_CURSUS_API_KEY = 'demo-keystone';
export const DEFAULT_POOL_MAX = 10;

export type DatabaseConfig =
  /** Embedded PGlite in `dir` (one server process; migrated and seeded when opened). */
  | { driver: 'pglite'; dir: string }
  /** PostgreSQL server through a node-postgres pool (migrated and seeded by `npm run db:migrate`). */
  | { driver: 'postgres'; url: string; poolMax: number };

export interface KeystoneConfig {
  env: RuntimeEnv;
  production: boolean;
  /** Absolute data directory (PGlite database in <dir>/pg, stored files in <dir>/files). */
  dataDir: string;
  database: DatabaseConfig;
  /** Seed of a new database. An existing database keeps the seed it was created with (app_settings `keystone.seed`). */
  seed: SeedMode;
  /** KEYSTONE_SEED was set explicitly (seeding an empty PostgreSQL database requires it). */
  seedExplicit: boolean;
  log: { level: LogLevel; format: LogFormat };
  cursus: { apiUrl: string | null; apiKey: string | null };
  vigie: { apiUrl: string | null; apiKey: string | null };
  ai: { anthropicApiKeySet: boolean; enabled: boolean; model: string | null; fallbacks: boolean };
  /** Secret values present in the environment: the logger masks them wherever they appear. */
  secrets: string[];
}

export interface ConfigIssue {
  variable: string;
  message: string;
}

export interface ConfigResult {
  config: KeystoneConfig;
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
}

const trimSlash = (u: string) => u.replace(/\/+$/, '');

const isUrlWith = (v: string, protocols: string[]) => {
  try {
    return protocols.includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

const httpUrl = z.string().refine((v) => isUrlWith(v, ['http:', 'https:']), 'must be an http:// or https:// URL').transform(trimSlash);
const onOff = z
  .string()
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(['on', 'off'], { message: 'must be "on" or "off"' }));

/** One schema per variable (input: the trimmed string, undefined when unset or blank). */
const VARS = {
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  KEYSTONE_DATA_DIR: z.string().optional(),
  DATABASE_URL: z
    .string()
    .refine((v) => isUrlWith(v, ['postgres:', 'postgresql:']), 'must be a postgres:// or postgresql:// URL')
    .optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1, 'must be at least 1').max(200, 'must be at most 200').optional(),
  KEYSTONE_SEED: z.enum(SEED_MODES, { message: 'must be "demo" or "production"' }).optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS, { message: `must be one of ${LOG_LEVELS.join(', ')}` }).optional(),
  LOG_FORMAT: z.enum(LOG_FORMATS, { message: 'must be "json" or "pretty"' }).optional(),
  NEXT_PUBLIC_CODEX_URL: httpUrl.optional(),
  NEXT_PUBLIC_CURSUS_URL: httpUrl.optional(),
  NEXT_PUBLIC_VIGIE_URL: httpUrl.optional(),
  CURSUS_API_URL: httpUrl.optional(),
  CURSUS_API_KEY: z.string().optional(),
  KEYSTONE_API_KEY: z.string().optional(),
  VIGIE_API_URL: httpUrl.optional(),
  VIGIE_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  KEYSTONE_AI: onOff.optional(),
  KEYSTONE_AI_MODEL: z.string().regex(/^[a-z0-9][a-z0-9._:@-]*$/i, 'must be a model id').optional(),
  KEYSTONE_AI_FALLBACKS: onOff.optional(),
} as const;

export type ConfigVariable = keyof typeof VARS;
/** Every variable the configuration reads (the cache key of src/server/config/index.ts). */
export const CONFIG_VARIABLES = Object.keys(VARS) as ConfigVariable[];
/** Variables whose value is a secret (masked in logs, never echoed in messages). */
const SECRET_VARIABLES: ConfigVariable[] = ['CURSUS_API_KEY', 'KEYSTONE_API_KEY', 'VIGIE_API_KEY', 'ANTHROPIC_API_KEY'];

type Values = { [K in ConfigVariable]: z.output<(typeof VARS)[K]> };

const blank = (v: string | undefined) => {
  const s = v?.trim();
  return s ? s : undefined;
};

/** Password of a postgres:// URL (masked in logs). */
function urlPassword(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const p = new URL(url).password;
    return p ? decodeURIComponent(p) : null;
  } catch {
    return null;
  }
}

/** True for a URL on this machine (localhost, 127.0.0.0/8, ::1). */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

/** postgres://user:***@host:5432/db — a database URL safe to print. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '[invalid URL]';
  }
}

/**
 * Validates `env` and builds the configuration. Never throws: errors (invalid values, production requirements) and warnings
 * come back with a configuration where every invalid variable has its default.
 */
export function parseConfig(env: Record<string, string | undefined>, opts: { cwd: string }): ConfigResult {
  const errors: ConfigIssue[] = [];
  const warnings: ConfigIssue[] = [];
  const values = {} as Record<ConfigVariable, unknown>;
  for (const name of CONFIG_VARIABLES) {
    const raw = blank(env[name]);
    const r = VARS[name].safeParse(raw);
    if (r.success) values[name] = r.data;
    else {
      values[name] = undefined;
      if (name === 'NODE_ENV') warnings.push({ variable: name, message: 'is not development, production or test; development is assumed' });
      else errors.push({ variable: name, message: r.error.issues[0]?.message ?? 'is invalid' });
    }
  }
  const v = values as Values;

  const runtime: RuntimeEnv = v.NODE_ENV ?? 'development';
  const production = runtime === 'production';
  const dataDir = v.KEYSTONE_DATA_DIR ? path.resolve(opts.cwd, v.KEYSTONE_DATA_DIR) : path.join(opts.cwd, '.data');
  const database: DatabaseConfig = v.DATABASE_URL
    ? { driver: 'postgres', url: v.DATABASE_URL, poolMax: v.DATABASE_POOL_MAX ?? DEFAULT_POOL_MAX }
    : { driver: 'pglite', dir: path.join(dataDir, 'pg') };
  if (!v.DATABASE_URL && v.DATABASE_POOL_MAX != null) warnings.push({ variable: 'DATABASE_POOL_MAX', message: 'is ignored without DATABASE_URL (PGlite has one connection)' });

  // Cursus: production never presents the demo key to a Cursus elsewhere on the network. A Cursus on this machine (loopback
  // URL: the Mac app next to a local Cursus) may keep it, with a warning.
  const cursusKey = v.CURSUS_API_KEY ?? v.KEYSTONE_API_KEY ?? null;
  const localCursus = !!v.CURSUS_API_URL && isLoopbackUrl(v.CURSUS_API_URL);
  const strictCursus = production && !localCursus;
  const cursusApiKey = strictCursus ? (cursusKey === DEMO_CURSUS_API_KEY ? null : cursusKey) : (cursusKey ?? DEMO_CURSUS_API_KEY);
  if (strictCursus && v.CURSUS_API_URL && !cursusApiKey)
    errors.push({
      variable: 'CURSUS_API_KEY',
      message: cursusKey === DEMO_CURSUS_API_KEY ? 'is the Cursus demo key, refused in production' : 'is required in production when CURSUS_API_URL is set',
    });
  if (production && localCursus && cursusApiKey === DEMO_CURSUS_API_KEY)
    warnings.push({ variable: 'CURSUS_API_KEY', message: 'is the Cursus demo key: accepted for a Cursus on this machine only' });

  if (v.VIGIE_API_URL && !v.VIGIE_API_KEY && production)
    warnings.push({ variable: 'VIGIE_API_KEY', message: 'is not set: calls to Vigie are not authenticated (Vigie API authentication is open question V-3)' });
  if (production)
    for (const [name, app] of [['NEXT_PUBLIC_CODEX_URL', 'Codex'], ['NEXT_PUBLIC_CURSUS_URL', 'Cursus'], ['NEXT_PUBLIC_VIGIE_URL', 'Vigie']] as const)
      if (!v[name]) warnings.push({ variable: name, message: `is not set: links open ${app} on localhost` });

  const anthropic = v.ANTHROPIC_API_KEY ?? null;
  const secrets = [...SECRET_VARIABLES.map((n) => v[n] as string | undefined), urlPassword(v.DATABASE_URL)].filter((s): s is string => !!s && s.length >= 4);

  return {
    errors,
    warnings,
    config: {
      env: runtime,
      production,
      dataDir,
      database,
      seed: v.KEYSTONE_SEED ?? 'demo',
      seedExplicit: v.KEYSTONE_SEED != null,
      log: { level: v.LOG_LEVEL ?? 'info', format: v.LOG_FORMAT ?? (production ? 'json' : 'pretty') },
      cursus: { apiUrl: v.CURSUS_API_URL ?? null, apiKey: cursusApiKey },
      vigie: { apiUrl: v.VIGIE_API_URL ?? null, apiKey: v.VIGIE_API_KEY ?? null },
      ai: { anthropicApiKeySet: !!anthropic, enabled: !!anthropic && v.KEYSTONE_AI !== 'off', model: v.KEYSTONE_AI_MODEL ?? null, fallbacks: v.KEYSTONE_AI_FALLBACKS !== 'off' },
      secrets: [...new Set(secrets)],
    },
  };
}

/** "DATABASE_URL must be a postgres:// URL; CURSUS_API_KEY is required…" — one line per issue. */
export const formatIssues = (issues: ConfigIssue[]) => issues.map((i) => `${i.variable} ${i.message}`);
