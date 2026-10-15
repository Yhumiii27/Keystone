import 'server-only';
// The configuration of this server process, read from process.env through the validated schema of ./parse.ts (R-007).
// Server code reads settings here instead of process.env (the integration modules that are safe in client components keep
// reading their NEXT_PUBLIC_* URL directly, since Next inlines those at build time). The result is cached while the
// variables it reads are unchanged, so tests that stub a variable see the new value.
import { CONFIG_VARIABLES, formatIssues, parseConfig, type ConfigIssue, type ConfigResult, type KeystoneConfig } from './parse';

export {
  DEMO_CURSUS_API_KEY, SEED_MODES, formatIssues, parseConfig, redactUrl,
  type ClamdTarget, type ConfigIssue, type ConfigResult, type DatabaseConfig, type FileScanMode, type KeystoneConfig, type LogFormat, type LogLevel, type SeedMode,
} from './parse';

let cache: { key: string; result: ConfigResult } | null = null;

/** Validation result for the current environment (cached per variable values). */
export function configResult(): ConfigResult {
  const key = CONFIG_VARIABLES.map((n) => process.env[n] ?? '\u0000').join('\u0001') + '\u0001' + process.cwd();
  if (cache?.key !== key) cache = { key, result: parseConfig(process.env, { cwd: process.cwd() }) };
  return cache.result;
}

/** The configuration (invalid variables replaced by their defaults; see `assertValidConfig` for the errors). */
export function getConfig(): KeystoneConfig {
  return configResult().config;
}

/** Invalid or missing configuration: the message lists every issue, never a value. */
export class ConfigError extends Error {
  readonly issues: ConfigIssue[];
  constructor(issues: ConfigIssue[]) {
    super(`Invalid configuration: ${formatIssues(issues).join('; ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Throws a ConfigError when the configuration has errors and `strict` (default: in production). Returns the result so the
 * caller can log the warnings.
 */
export function assertValidConfig(opts: { strict?: boolean } = {}): ConfigResult {
  const r = configResult();
  if (r.errors.length && (opts.strict ?? r.config.production)) throw new ConfigError(r.errors);
  return r;
}
