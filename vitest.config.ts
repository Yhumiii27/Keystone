import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // The connectors switch to HTTP when these are set (e.g. on the Mac where Vigie / Cursus run): tests never reach the network,
  // so they start empty; the tests of the HTTP connectors set them explicitly. ANTHROPIC_API_KEY likewise (Claude is mocked).
  test: { include: ['src/**/*.test.ts'], environment: 'node', env: { VIGIE_API_URL: '', CURSUS_API_URL: '', ANTHROPIC_API_KEY: '' } },
  resolve: { alias: { '@': path.resolve(__dirname, 'src'), 'server-only': path.resolve(__dirname, 'src/test/server-only-stub.ts') } },
});
