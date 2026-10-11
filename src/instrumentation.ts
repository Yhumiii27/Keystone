// Next.js instrumentation (node_modules/next/dist/docs/01-app/02-guides/instrumentation.md).
// - register(): runs once when a server instance starts, before it handles requests — configuration check and, in
//   production, database check (src/server/startup.ts, R-007 / R-002). In production a failure stops the process (exit 1)
//   so the hosting platform sees a failed start instead of a server that errors on every page.
// - onRequestError(): every error Next catches while rendering a page, running a Route Handler or a Server Function is
//   written as one structured log line (src/server/log, R-009) — path without query string, no header, no secret.
import type { Instrumentation } from 'next';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startServer } = await import('./server/startup');
  try {
    await startServer();
  } catch (e) {
    if (process.env.NODE_ENV === 'production') {
      const { logError } = await import('./server/log');
      logError('Keystone start-up', e, { component: 'startup' });
      process.exit(1);
    }
    throw e;
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { logRequestError } = await import('./server/log');
  logRequestError(err, { path: request.path, method: request.method }, context);
};
