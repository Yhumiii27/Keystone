// Structured log lines (R-009): pure formatting and redaction, shared by the server logger (./index.ts) and its tests.
// - One JSON object per line in production (time, level, msg, then the fields; errors as { type, message, code, stack }),
//   a readable line in development.
// - No secrets: fields whose name looks secret (password, token, api key, cookie, authorization…) are replaced by
//   "[redacted]"; the secret values of the configuration (API keys, the database password) are masked wherever they appear
//   in a message, a field or a stack; URL credentials and bearer tokens are masked too.
// - Bounded: depth, array length and string length are capped; circular references are cut.
import type { LogFormat, LogLevel } from '@/server/config/parse';

export type LogFields = Record<string, unknown>;
export type EmittedLevel = Exclude<LogLevel, 'silent'>;

export const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export const REDACTED = '[redacted]';
const SECRET_KEY = /pass(word|wd)?$|secret|token|api[-_]?key|authori[sz]ation|cookie|session|credential|private[-_]?key|^key$|sealed/i;
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 4000;
const MAX_STACK = 8000;

/** Masks URL credentials, bearer tokens and the given secret values in a string. */
export function scrub(s: string, secrets: readonly string[]): string {
  let out = s
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:/?#\s@]+):([^@/?#\s]+)@/gi, `$1:${REDACTED}@`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${REDACTED}`);
  for (const secret of secrets) if (secret && out.includes(secret)) out = out.split(secret).join(REDACTED);
  return out;
}

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…[${s.length - max} more]` : s);

interface ErrorShape {
  type: string;
  message: string;
  code?: string | number;
  status?: number;
  digest?: string;
  stack?: string;
  cause?: ErrorShape | unknown;
}

function errorOf(e: Error, secrets: readonly string[], seen: WeakSet<object>, depth: number): ErrorShape {
  const x = e as Error & { code?: unknown; status?: unknown; digest?: unknown; cause?: unknown };
  const out: ErrorShape = { type: e.name || 'Error', message: cut(scrub(String(e.message ?? ''), secrets), MAX_STRING) };
  if (typeof x.code === 'string' || typeof x.code === 'number') out.code = x.code;
  if (typeof x.status === 'number') out.status = x.status;
  if (typeof x.digest === 'string') out.digest = x.digest;
  if (e.stack) out.stack = cut(scrub(e.stack, secrets), MAX_STACK);
  if (x.cause !== undefined && depth < 3) out.cause = x.cause instanceof Error ? errorOf(x.cause, secrets, seen, depth + 1) : sanitize(x.cause, secrets, seen, depth + 1);
  return out;
}

/** JSON-safe copy of a value: secrets redacted, sizes capped, errors serialised. */
export function sanitize(value: unknown, secrets: readonly string[], seen = new WeakSet<object>(), depth = 0): unknown {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return cut(scrub(value, secrets), MAX_STRING);
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Error) return errorOf(value, secrets, seen, depth);
  if (depth >= MAX_DEPTH) return '[…]';
  if (value instanceof URL) return scrub(value.toString(), secrets);
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((v) => sanitize(v, secrets, seen, depth + 1));
    if (value.length > MAX_ARRAY) items.push(`…[${value.length - MAX_ARRAY} more]`);
    return items;
  }
  if (value instanceof Map) return sanitize(Object.fromEntries(value), secrets, seen, depth);
  if (value instanceof Set) return sanitize([...value], secrets, seen, depth);
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `[${(value as ArrayBuffer).byteLength} bytes]`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) out[k] = v == null || v === '' ? v : REDACTED;
    else {
      const s = sanitize(v, secrets, seen, depth + 1);
      if (s !== undefined) out[k] = s;
    }
  }
  return out;
}

export interface LogRecord {
  time: Date;
  level: EmittedLevel;
  msg: string;
  fields?: LogFields;
}

/** The line written for a record: JSON (production) or readable text (development). */
export function formatRecord(r: LogRecord, format: LogFormat, secrets: readonly string[]): string {
  const msg = cut(scrub(r.msg, secrets), MAX_STRING);
  const fields = (r.fields ? sanitize(r.fields, secrets) : {}) as Record<string, unknown>;
  if (format === 'json') {
    // time / level / msg first; a field may not overwrite them.
    const { time: _t, level: _l, msg: _m, ...rest } = fields;
    void _t; void _l; void _m;
    return JSON.stringify({ time: r.time.toISOString(), level: r.level, msg, ...rest });
  }
  const { err, ...rest } = fields;
  const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
  const e = err as ErrorShape | undefined;
  const errText = e && typeof e === 'object' ? `\n  ${e.stack ?? `${e.type}: ${e.message}`}${e.cause ? `\n  cause: ${JSON.stringify(e.cause)}` : ''}` : '';
  return `${r.time.toISOString()} ${r.level.toUpperCase().padEnd(5)} ${msg}${extra}${errText}`;
}
