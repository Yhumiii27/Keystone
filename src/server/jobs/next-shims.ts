// R-199 — the worker (`npm run worker`, tsx --conditions=react-server) loads Server Component code outside Next. Next's bundler
// resolves `next/navigation` to its react-server build in server code (redirect, notFound… without the client router's React
// context); plain Node resolves the package's client build, which needs React's client API and fails under the react-server
// condition. The weekly reports reuse the export pipeline and the portfolio overview, whose modules import the session and the
// project context (and so `next/navigation`): this hook gives the worker the same resolution as Next. Imported first by
// scripts/worker.ts only; the web server never loads it.
import Module from 'node:module';

type Resolve = (request: string, ...rest: unknown[]) => string;
const M = Module as unknown as { _resolveFilename: Resolve };
const original = M._resolveFilename;
const REACT_SERVER: Record<string, string> = { 'next/navigation': 'next/dist/client/components/navigation.react-server' };

M._resolveFilename = function (request: string, ...rest: unknown[]) {
  return original.call(this, REACT_SERVER[request] ?? request, ...rest);
};
