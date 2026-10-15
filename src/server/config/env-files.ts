// .env files for scripts run outside Next (npm run db:migrate): the same files and precedence as Next —
// .env.$NODE_ENV.local, .env.local (not in tests), .env.$NODE_ENV, .env — and, like Next, a variable already set in the
// environment is never overwritten (process.loadEnvFile keeps existing values, so the first file that sets a variable wins).
import fs from 'node:fs';
import path from 'node:path';

/** The .env files Next would load in `dir`, highest precedence first. */
export function envFilesOf(dir: string, nodeEnv: string | undefined): string[] {
  const mode = nodeEnv === 'production' || nodeEnv === 'test' ? nodeEnv : 'development';
  const names = [`.env.${mode}.local`, ...(mode === 'test' ? [] : ['.env.local']), `.env.${mode}`, '.env'];
  return names.map((n) => path.join(dir, n));
}

/** Loads the existing .env files of `dir` into process.env; returns the files loaded. */
export function loadEnvFiles(dir: string, nodeEnv = process.env.NODE_ENV): string[] {
  const loaded: string[] = [];
  for (const file of envFilesOf(dir, nodeEnv)) {
    if (!fs.existsSync(file)) continue;
    process.loadEnvFile(file);
    loaded.push(file);
  }
  return loaded;
}
