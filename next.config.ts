import type { NextConfig } from 'next';
import { staticSecurityHeaders } from './src/server/http/security-headers';

const nextConfig: NextConfig = {
  // Native / file-reading server packages stay outside the bundle: PGlite (WASM + data files), pdfkit (reads its AFM font
  // metrics from node_modules at run time) and exceljs (CommonJS with dynamic requires). Used only by route handlers and
  // Server Functions (src/server/export, src/server/interchange).
  serverExternalPackages: ['@electric-sql/pglite', 'pdfkit', 'exceljs'],
  // KEYSTONE_DIST_DIR lets CI / verification builds use their own output folder (e.g. .next-ci) so they never
  // overwrite the .next build served by the Mac app (desktop/).
  distDir: process.env.KEYSTONE_DIST_DIR || '.next',
  // KEYSTONE_TURBOPACK_ROOT: a checkout whose node_modules is a symlink to another folder (agent worktrees under
  // .claude/worktrees) sets the common parent as Turbopack's root, which otherwise refuses to resolve outside the project
  // (tests/e2e/run.ts sets it by itself). Unset everywhere else.
  ...(process.env.KEYSTONE_TURBOPACK_ROOT ? { turbopack: { root: process.env.KEYSTONE_TURBOPACK_ROOT } } : {}),
  // R-008: security headers on every response, static assets included (the per-request Content-Security-Policy is set by
  // src/proxy.ts). HSTS only in production builds.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: staticSecurityHeaders(process.env.NODE_ENV === 'production') }];
  },
};

export default nextConfig;
