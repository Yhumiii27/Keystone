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
// - The key Cursus presents to Keystone's events endpoint (CURSUS_EVENTS_KEY, R-029) is a separate secret: never the key
//   Keystone sends to Cursus. Outside production it defaults to the demo events key; production refuses the demo key (an
//   error) and, without a key, the endpoint refuses every call (503: Cursus keeps its events and retries).
// - Messages name the variable, never its value (values may be secrets).
// - NEXT_PUBLIC_* URLs are inlined in the bundles at build time (`next build`) and read by the integration modules that are
//   safe in client components (src/server/integrations/*/config.ts); they are only validated here.
import path from 'node:path';
import { z } from 'zod';
import { parseGroupRoleMap } from '@/domain/auth';

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
/** R-029: demo key of Keystone's Cursus events endpoint (what a local Cursus presents) — accepted outside production only. */
export const DEMO_CURSUS_EVENTS_KEY = 'demo-cursus-events';
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
  /**
   * Cursus: API URL and key Keystone sends (outbound); `eventsKey` = the key Cursus must present to Keystone's events endpoint
   * (inbound, R-029; null = the endpoint refuses every call); `directory` = the staff directory import is switched on (R-027).
   */
  cursus: { apiUrl: string | null; apiKey: string | null; eventsKey: string | null; directory: boolean };
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
  // R-029 (NEW-CURSUS-7): key Cursus presents to POST /api/integrations/cursus/events (inbound; separate from the outbound keys).
  CURSUS_EVENTS_KEY: z.string().min(16, 'must be at least 16 characters').optional(),
  // R-027 (NEW-CURSUS-2): staff directory import from Cursus, off until Cursus publishes its directory endpoint.
  CURSUS_DIRECTORY: onOff.optional(),
  VIGIE_API_URL: httpUrl.optional(),
  VIGIE_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  KEYSTONE_AI: onOff.optional(),
  KEYSTONE_AI_MODEL: z.string().regex(/^[a-z0-9][a-z0-9._:@-]*$/i, 'must be a model id').optional(),
  KEYSTONE_AI_FALLBACKS: onOff.optional(),
  // Sign-in (R-038): src/server/auth/config.ts reads them at call time; validated here too so a production start fails on a
  // bad value instead of every sign-in, and the secrets are masked in the logs.
  KEYSTONE_AUTH: z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(['demo', 'entra'], { message: 'must be "demo" or "entra"' }))
    .optional(),
  KEYSTONE_SESSION_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  KEYSTONE_SESSION_HOURS: z.coerce.number().int().min(1, 'must be at least 1').max(168, 'must be at most 168').optional(),
  ENTRA_TENANT_ID: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'must be a GUID').optional(),
  ENTRA_ISSUER: httpUrl.optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),
  ENTRA_REDIRECT_URI: httpUrl.optional(),
  ENTRA_POST_LOGOUT_REDIRECT_URI: httpUrl.optional(),
  ENTRA_GROUP_ROLES: z
    .string()
    .refine((v) => {
      try {
        parseGroupRoleMap(v);
        return true;
      } catch {
        return false;
      }
    }, 'must be a JSON object { "<group object id>": "<role>" | ["<role>", …] } of Keystone roles')
    .optional(),
  // Codex connector (R-124; read by src/server/integrations/codex/config.ts) and IT's connectors file (R-020).
  CODEX_API_URL: httpUrl.optional(),
  KEYSTONE_CONNECTORS_FILE: z.string().optional(),
} as const;

export type ConfigVariable = keyof typeof VARS;
/** Every variable the configuration reads (the cache key of src/server/config/index.ts). */
export const CONFIG_VARIABLES = Object.keys(VARS) as ConfigVariable[];
/** Variables whose value is a secret (masked in logs, never echoed in messages). */
const SECRET_VARIABLES: ConfigVariable[] = [
  'CURSUS_API_KEY', 'KEYSTONE_API_KEY', 'CURSUS_EVENTS_KEY', 'VIGIE_API_KEY', 'ANTHROPIC_API_KEY', 'KEYSTONE_SESSION_SECRET', 'ENTRA_CLIENT_SECRET',
];

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
  // R-029: the inbound events key. Production never accepts the demo key, whatever the address the call comes from.
  if (production && v.CURSUS_EVENTS_KEY === DEMO_CURSUS_EVENTS_KEY)
    errors.push({ variable: 'CURSUS_EVENTS_KEY', message: 'is the demo events key, refused in production' });
  const cursusEventsKey = production ? (v.CURSUS_EVENTS_KEY && v.CURSUS_EVENTS_KEY !== DEMO_CURSUS_EVENTS_KEY ? v.CURSUS_EVENTS_KEY : null) : (v.CURSUS_EVENTS_KEY ?? DEMO_CURSUS_EVENTS_KEY);

  if (v.VIGIE_API_URL && !v.VIGIE_API_KEY && production)
    warnings.push({ variable: 'VIGIE_API_KEY', message: 'is not set: calls to Vigie are not authenticated (Vigie API authentication is open question V-3)' });
  if (production)
    for (const [name, app] of [['NEXT_PUBLIC_CODEX_URL', 'Codex'], ['NEXT_PUBLIC_CURSUS_URL', 'Cursus'], ['NEXT_PUBLIC_VIGIE_URL', 'Vigie']] as const)
      if (!v[name]) warnings.push({ variable: name, message: `is not set: links open ${app} on localhost` });

  // Demo mode in production (R-038): "View as" with no sign-in, the director by default. Refused with the production data
  // set (real people, no persona); otherwise allowed (the Mac app, demonstrations) with a warning when not chosen explicitly.
  if (production && v.KEYSTONE_AUTH !== 'entra') {
    if (v.KEYSTONE_SEED === 'production') errors.push({ variable: 'KEYSTONE_AUTH', message: 'must be "entra" with KEYSTONE_SEED=production (demo mode has no sign-in)' });
    else if (!v.KEYSTONE_AUTH) warnings.push({ variable: 'KEYSTONE_AUTH', message: 'is not set: demo mode ("View as", no sign-in) — set it to "entra" for real users, or "demo" explicitly' });
  }
  // Entra sign-in (R-038) needs its secret and app registration; without them every page would answer the sign-in error.
  if (v.KEYSTONE_AUTH === 'entra') {
    const missing: [ConfigVariable, unknown][] = [
      ['KEYSTONE_SESSION_SECRET', v.KEYSTONE_SESSION_SECRET], ['ENTRA_CLIENT_ID', v.ENTRA_CLIENT_ID], ['ENTRA_CLIENT_SECRET', v.ENTRA_CLIENT_SECRET],
      ['ENTRA_REDIRECT_URI', v.ENTRA_REDIRECT_URI], ['ENTRA_TENANT_ID', v.ENTRA_TENANT_ID ?? v.ENTRA_ISSUER],
    ];
    for (const [name, value] of missing)
      if (!value && !errors.some((e) => e.variable === name)) errors.push({ variable: name, message: name === 'ENTRA_TENANT_ID' ? 'is required with KEYSTONE_AUTH=entra (or ENTRA_ISSUER)' : 'is required with KEYSTONE_AUTH=entra' });
  }

  const anthropic = v.ANTHROPIC_API_KEY ?? null;
  // R-173 (GDPR): meeting transcripts analysed by Claude leave EPC2i for Anthropic, a sub-processor — with real data the
  // sub-processing agreement (DPA) must be signed. A reminder at start-up, no behaviour change.
  if (anthropic && v.KEYSTONE_AI !== 'off' && (production || v.KEYSTONE_SEED === 'production'))
    warnings.push({
      variable: 'ANTHROPIC_API_KEY',
      message: 'is set: meeting transcripts are sent to Anthropic for analysis — the sub-processing agreement (DPA) must be signed (GDPR)',
    });
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
      cursus: { apiUrl: v.CURSUS_API_URL ?? null, apiKey: cursusApiKey, eventsKey: cursusEventsKey, directory: v.CURSUS_DIRECTORY === 'on' },
      vigie: { apiUrl: v.VIGIE_API_URL ?? null, apiKey: v.VIGIE_API_KEY ?? null },
      ai: { anthropicApiKeySet: !!anthropic, enabled: !!anthropic && v.KEYSTONE_AI !== 'off', model: v.KEYSTONE_AI_MODEL ?? null, fallbacks: v.KEYSTONE_AI_FALLBACKS !== 'off' },
      secrets: [...new Set(secrets)],
    },
  };
}

/** "DATABASE_URL must be a postgres:// URL; CURSUS_API_KEY is required…" — one line per issue. */
export const formatIssues = (issues: ConfigIssue[]) => issues.map((i) => `${i.variable} ${i.message}`);
