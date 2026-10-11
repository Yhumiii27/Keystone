// Checks a connectors file before IT installs it (D-7a, R-020; format in src/domain/connector-config.ts):
//   npx tsx scripts/connectors-check.ts config/connectors.json
// Without an argument, the file named by KEYSTONE_CONNECTORS_FILE. Prints what Keystone would apply, or every error
// (exit code 1). Read-only: the running Keystone applies the file itself when it starts and whenever the file changes.
import fs from 'node:fs';
import { CONNECTORS_FILE_ENV, parseConnectorsFile } from '@/domain/connector-config';

const file = process.argv[2] ?? process.env[CONNECTORS_FILE_ENV];
if (!file) {
  console.error(`Usage: npx tsx scripts/connectors-check.ts <file> (or set ${CONNECTORS_FILE_ENV})`);
  process.exit(2);
}
let json: unknown;
try {
  json = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`${file}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
const r = parseConnectorsFile(json);
if (!r.ok) {
  console.error(`${file}: ${r.errors.length} error(s), nothing would be applied`);
  for (const e of r.errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`${file}: valid · ${r.entries.length} connector(s)`);
for (const e of r.entries) {
  const parts = Object.entries(e).filter(([k]) => k !== 'name').map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  console.log(`  ${e.name}: ${parts.join(' ') || '(no change)'}`);
}
