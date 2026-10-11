import 'server-only';
// Server start-up (src/instrumentation.ts → register): checks the configuration (R-007) and, in production, opens the
// database (R-002) before the server accepts requests, so a misconfigured deployment stops at once with a clear log line
// instead of failing on the first page. In development the problems are logged and the defaults are used.
import { ConfigError, configResult, formatIssues, getConfig, type KeystoneConfig } from '@/server/config';
import { getDb } from '@/server/db/client';
import { log, logError } from '@/server/log';

/** Validates the configuration and logs its warnings and errors; in production also opens the database. Throws to stop. */
export async function startServer(): Promise<KeystoneConfig> {
  const { config, errors, warnings } = configResult();
  for (const w of formatIssues(warnings)) log.warn(`Configuration: ${w}`, { component: 'config' });
  if (errors.length) {
    // Production: the caller logs the error (its message lists every issue) and stops the process.
    if (config.production) throw new ConfigError(errors);
    log.error('Invalid configuration: defaults are used outside production', { component: 'config', issues: formatIssues(errors) });
  }
  log.info('Keystone server starting', {
    component: 'startup', env: config.env, database: config.database.driver, newDatabaseSeed: config.seed, logLevel: config.log.level,
    cursus: config.cursus.apiUrl ? 'http' : 'mock', vigie: config.vigie.apiUrl ? 'http' : 'mock', transcriptAnalysis: config.ai.enabled ? 'claude' : 'local',
  });
  // Production: an unreachable database or pending migrations stop the server now (PGlite: migrated and seeded here).
  if (config.production) await getDb();
  return config;
}

/** instrumentation register() on Node.js: start-up check; in production a failure is logged and stops the process. */
export async function registerNodeServer(exit: (code: number) => never = (code) => process.exit(code)): Promise<void> {
  try {
    await startServer();
  } catch (e) {
    if (getConfig().production) {
      logError('Keystone start-up', e, { component: 'startup' });
      exit(1);
    }
    throw e;
  }
}
