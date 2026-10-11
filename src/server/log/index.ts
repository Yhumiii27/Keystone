import 'server-only';
// Server logger (R-009). Route Handlers, Server Functions, connectors and start-up write through it instead of console.*:
//   log.error('Export failed', { screen, err })      logError('approveOrderAction', e, { number })
// Lines go to stdout (debug, info) or stderr (warn, error) as JSON in production — the hosting platform collects them — or
// as readable text in development (LOG_FORMAT overrides). LOG_LEVEL (default info) filters. Secrets never reach a line:
// see ./format.ts. Logging never throws.
import { getConfig } from '@/server/config';
import { LEVEL_RANK, formatRecord, type EmittedLevel, type LogFields } from './format';

export type { LogFields } from './format';

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A logger that adds `bindings` to every line (e.g. { component: 'cursus' }). */
  child(bindings: LogFields): Logger;
}

const SINK: Record<EmittedLevel, (line: string) => void> = {
  debug: (l) => console.debug(l),
  info: (l) => console.log(l),
  warn: (l) => console.warn(l),
  error: (l) => console.error(l),
};

function write(level: EmittedLevel, msg: string, fields: LogFields | undefined): void {
  try {
    const { log: cfg, secrets } = getConfig();
    if (LEVEL_RANK[level] < LEVEL_RANK[cfg.level]) return;
    SINK[level](formatRecord({ time: new Date(), level, msg, fields }, cfg.format, secrets));
  } catch {
    try {
      SINK[level](`${level.toUpperCase()} ${msg}`);
    } catch {
      // nothing left to do
    }
  }
}

function make(bindings: LogFields): Logger {
  const at = (level: EmittedLevel) => (msg: string, fields?: LogFields) => write(level, msg, fields ? { ...bindings, ...fields } : bindings);
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error'), child: (b) => make({ ...bindings, ...b }) };
}

/** The application logger. */
export const log: Logger = make({});

/**
 * Logs a failure caught on an error path (Server Function, Route Handler, connector): `where` names the operation
 * ("approveOrderAction", "export"), `err` is what was caught.
 */
export function logError(where: string, err: unknown, fields?: LogFields): void {
  log.error(`${where} failed`, { where, ...fields, err });
}

/** Same as logError at warning level (a degraded path that recovered, e.g. a connector falling back to its mirror). */
export function logWarning(where: string, err: unknown, fields?: LogFields): void {
  log.warn(`${where} failed`, { where, ...fields, err });
}

/** Request information of Next's onRequestError (src/instrumentation.ts). */
export interface RequestErrorInfo {
  path: string;
  method: string;
}
export interface RequestErrorContext {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
}

/** An error Next caught while serving a request (render, Route Handler, Server Function, proxy). Headers are never logged. */
export function logRequestError(err: unknown, request: RequestErrorInfo, context: RequestErrorContext): void {
  // The query string may carry identifiers or tokens: only the path is kept.
  const pathOnly = String(request.path ?? '').split('?')[0];
  log.error('Request failed', { method: request.method, path: pathOnly, route: context.routePath, routeType: context.routeType, renderSource: context.renderSource, err });
}
