import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite'],
  // KEYSTONE_DIST_DIR lets CI / verification builds use their own output folder (e.g. .next-ci) so they never
  // overwrite the .next build served by the Mac app (desktop/).
  distDir: process.env.KEYSTONE_DIST_DIR || '.next',
};

export default nextConfig;
