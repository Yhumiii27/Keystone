// End-to-end run (R-016) — `npm run test:e2e [-- <playwright options>]`:
// 1. builds the app into KEYSTONE_DIST_DIR (default .next-ci) when no build is there yet (CI builds before; a local run
//    reuses the last build — delete the folder to rebuild);
// 2. starts `next start` on a free port of 127.0.0.1 with a fresh temporary data directory (new PGlite database seeded
//    from the prototype data set, empty file store) and no connector URL or Claude key (nothing leaves the machine);
// 3. waits for the first page, runs Playwright (tests/e2e/*.spec.ts, playwright.config.ts) against it, then stops the
//    server and removes the data directory. The server log is kept in test-results/e2e-server.log; a server error line
//    fails the run.
// Never uses the ports of the other EPC2i apps (3000, 3100, 3110, 3200, 3210, 3217, 5173) nor the smoke-test port 3310.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = process.env.KEYSTONE_DIST_DIR || '.next-ci';
const RESERVED = new Set([3000, 3100, 3110, 3200, 3210, 3217, 3310, 5173]);
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const PLAYWRIGHT_CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');

/** A checkout whose node_modules is a symlink (agent worktrees): Turbopack needs the common parent as its root. */
function turbopackRoot(): string | undefined {
  if (process.env.KEYSTONE_TURBOPACK_ROOT) return process.env.KEYSTONE_TURBOPACK_ROOT;
  const nm = path.join(ROOT, 'node_modules');
  if (!fs.existsSync(nm) || !fs.lstatSync(nm).isSymbolicLink()) return undefined;
  const target = fs.realpathSync(nm).split(path.sep);
  const here = fs.realpathSync(ROOT).split(path.sep);
  let i = 0;
  while (i < target.length && i < here.length && target[i] === here[i]) i++;
  return here.slice(0, i).join(path.sep) || path.sep;
}

/** An unused port on 127.0.0.1 (E2E_PORT when given), never one of the reserved ones. */
async function freePort(): Promise<number> {
  if (process.env.E2E_PORT) {
    const p = Number(process.env.E2E_PORT);
    if (RESERVED.has(p)) throw new Error(`E2E_PORT ${p} is reserved for another EPC2i app`);
    return p;
  }
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const p = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(p));
      });
    });
    if (!RESERVED.has(port)) return port;
  }
}

function build(env: NodeJS.ProcessEnv): void {
  if (fs.existsSync(path.join(ROOT, DIST, 'BUILD_ID'))) return;
  console.log(`[e2e] no build in ${DIST} — next build`);
  const r = spawnSync(process.execPath, [NEXT_BIN, 'build'], { cwd: ROOT, env, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('next build failed');
}

async function waitReady(url: string, server: ChildProcess, timeoutMs = 180_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error(`next start exited with code ${server.exitCode}`);
    try {
      // The first request opens the database (migrations + seed): it may take a while.
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
}

async function main(): Promise<number> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-e2e-'));
  const root = turbopackRoot();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KEYSTONE_DIST_DIR: DIST,
    KEYSTONE_DATA_DIR: dataDir,
    ...(root ? { KEYSTONE_TURBOPACK_ROOT: root } : {}),
    // Nothing leaves the machine: mock connectors, local transcript analyser.
    VIGIE_API_URL: '',
    CURSUS_API_URL: '',
    ANTHROPIC_API_KEY: '',
    // R-029: the key Cursus would present to the events endpoint (production refuses the demo key; d8-connectors.spec.ts).
    CURSUS_EVENTS_KEY: process.env.CURSUS_EVENTS_KEY || 'e2e-cursus-events-key-0001',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  let server: ChildProcess | null = null;
  const logDir = path.join(ROOT, 'test-results');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'e2e-server.log');
  try {
    build(env);
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const log = fs.createWriteStream(logFile);
    server = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: ROOT, env: { ...env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout!.pipe(log);
    server.stderr!.pipe(log);
    console.log(`[e2e] next start on ${base} · data ${dataDir}`);
    await waitReady(`${base}/`, server);
    const pw = spawnSync(process.execPath, [PLAYWRIGHT_CLI, 'test', ...process.argv.slice(2)], { cwd: ROOT, env: { ...env, E2E_BASE_URL: base }, stdio: 'inherit' });
    let code = pw.status ?? 1;
    // The server log must hold nothing but the start-up lines and the expected job / incident lines.
    await new Promise((r) => setTimeout(r, 200));
    const errors = fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => /⨯|\bError\b|"level":"error"/.test(l) && !/"msg":"Browser error"/.test(l));
    if (errors.length) {
      console.error(`[e2e] the server logged errors (${logFile}):\n${errors.slice(0, 20).join('\n')}`);
      code = code || 1;
    }
    return code;
  } finally {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise((r) => {
        const t = setTimeout(() => {
          server?.kill('SIGKILL');
          r(null);
        }, 5000);
        server!.once('exit', () => {
          clearTimeout(t);
          r(null);
        });
      });
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error('[e2e]', e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
