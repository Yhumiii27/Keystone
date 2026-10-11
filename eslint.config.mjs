import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-ci/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Design prototype sources (reference only)
    "design/**",
    ".data/**",
    // Agent worktrees (each a full checkout) and end-to-end outputs (R-016).
    ".claude/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
