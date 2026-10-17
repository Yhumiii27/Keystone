// Matrix (the EPC2i data catalogue): Keystone declares its database schema right after the migrations (contract
// matrix.schema/1, see ./declare-schema.ts). Send-only integration: no mirror, no outbox, no screen.
import { log as appLog } from '@/server/log';
import { declareSchema, introspectPostgres, matrixDeclarationEnabled, type MatrixEnv, type MatrixLogger, type RowQuery } from './declare-schema';

export const MATRIX_APP = 'keystone';

/** Keystone's logger, component "matrix". */
function matrixLogger(): MatrixLogger {
  const l = appLog.child({ component: 'matrix' });
  return { info: (m) => l.info(m), warn: (m) => l.warn(m) };
}

/**
 * Declares Keystone's schema to Matrix in the background: returns at once and never rejects (a failure is a warning).
 * Runs only for a persistent database (`persistent`) or when MATRIX_URL is set, and only when the declaration has somewhere
 * to go (MATRIX_URL or MATRIX_DECLARATIONS_DIR) — the tests' in-memory databases read and send nothing.
 * Returns the pending declaration (tests), or null when nothing is declared.
 */
export function declareKeystoneSchema(query: RowQuery, opts: { persistent: boolean; env?: MatrixEnv; log?: MatrixLogger }): Promise<void> | null {
  const env = opts.env ?? process.env;
  if (!(opts.persistent || env.MATRIX_URL?.trim()) || !matrixDeclarationEnabled(env)) return null;
  const log = opts.log ?? matrixLogger();
  const pending = introspectPostgres(query)
    .then((tables) => declareSchema({ app: MATRIX_APP, version: env.APP_VERSION?.trim() || null, tables, env, log }))
    .then(() => undefined, (e: unknown) => log.warn?.(`[matrix] schema of ${MATRIX_APP} not read: ${e instanceof Error ? e.message : String(e)}`));
  void pending;
  return pending;
}
