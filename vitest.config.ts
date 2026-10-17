import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // The connectors switch to HTTP when these are set (e.g. on the Mac where Vigie / Cursus run): tests never reach the network,
  // so they start empty; the tests of the HTTP connectors set them explicitly. ANTHROPIC_API_KEY likewise (Claude is mocked),
  // and KEYSTONE_AUTH (tests run in demo mode; the Entra tests set it themselves); KEYSTONE_CLOCK pinned to the demo data
  // set's date, Fri 25 Sep 2026 (R-013: unset is the real clock). MATRIX_URL / MATRIX_DECLARATIONS_DIR: the tests never
  // declare the schema to Matrix (src/server/integrations/matrix).
  // testTimeout: most tests open a seeded PGlite and render pages for several personas; under the full suite's load some
  // pass 5 s (the default) though they take 2–4 s alone.
  test: { include: ['src/**/*.test.ts'], environment: 'node', testTimeout: 30_000, env: { VIGIE_API_URL: '', CURSUS_API_URL: '', ANTHROPIC_API_KEY: '', KEYSTONE_AUTH: '', KEYSTONE_CLOCK: '2026-09-25', MATRIX_URL: '', MATRIX_DECLARATIONS_DIR: '' } },
  resolve: { alias: { '@': path.resolve(__dirname, 'src'), 'server-only': path.resolve(__dirname, 'src/test/server-only-stub.ts') } },
});
