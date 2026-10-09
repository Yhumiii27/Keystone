import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native / file-reading server packages stay outside the bundle: PGlite (WASM + data files), pdfkit (reads its AFM font
  // metrics from node_modules at run time) and exceljs (CommonJS with dynamic requires). Used only by route handlers and
  // Server Functions (src/server/export, src/server/interchange).
  serverExternalPackages: ['@electric-sql/pglite', 'pdfkit', 'exceljs'],
  // KEYSTONE_DIST_DIR lets CI / verification builds use their own output folder (e.g. .next-ci) so they never
  // overwrite the .next build served by the Mac app (desktop/).
  distDir: process.env.KEYSTONE_DIST_DIR || '.next',
};

export default nextConfig;
