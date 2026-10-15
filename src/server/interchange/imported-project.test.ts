// A project created by a schedule import (MS Project XML and P6 XER) opens on every project screen: each page is called as a
// function for the imported project (its data loading and view models run; no Next runtime), for the director and the PM
// who imported it. Guards the header, WBS and planning rows the importer writes against screens that expect them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// D-7b: imports are off in the app (IMPORTS_ENABLED); this test imports, so it turns the flag on.
vi.mock('@/domain/ch4-defaults', async (orig) => ({ ...(await orig<typeof import('@/domain/ch4-defaults')>()), IMPORTS_ENABLED: true }));

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  usePathname: () => '/',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }), headers: async () => new Headers() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    COOKIE: { role: 'ks-role', lang: 'ks-lang', nav: 'ks-nav', project: 'ks-project', zone: 'ks-zone' },
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => 'HLT-026',
    getZone: async () => null,
    getNavOpen: async () => ({}),
  };
});

import { PERSONA_BY_ROLE } from '@/config/personas';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { setFilesRoot } from '@/server/storage/files';
import { applyImport, startImport, type ImportViewer } from './jobs';

type PageFn = (props: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
const SCREENS = [
  'plan', 'schedule', 'budget', 'trends', 'resources', 'changes', 'risks', 'contingency', 'hours', 'meetings', 'stakeholders', 'bom', 'quality', 'itp', 'site',
  'closure', 'contract', 'billing', 'documents', 'engineering', 'interfaces', 'commissioning', 'deliveries', 'orders', 'client', 'pid',
];
const viewer = (role: keyof typeof PERSONA_BY_ROLE): ImportViewer => ({ name: PERSONA_BY_ROLE[role].name, short: PERSONA_BY_ROLE[role].short, role });
let filesDir = '';
const codes: string[] = [];

beforeAll(async () => {
  filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-imported-'));
  setFilesRoot(filesDir);
  setDb(await openDatabase());
  for (const [file, role] of [['sample.mspdi.xml', 'pm'], ['sample.xer', 'director']] as const) {
    const data = new Uint8Array(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/ch4', file)));
    const step = await startImport({ kind: 'schedule', mode: 'new', projectCode: null, fileName: file, data }, viewer(role));
    if (!step.ok || step.step !== 'preview') throw new Error(JSON.stringify(step));
    const done = await applyImport(step.preview.jobId, viewer(role));
    if (!done.ok || done.step !== 'done') throw new Error(JSON.stringify(done));
    codes.push(done.projectCode!);
  }
}, 120_000);
afterAll(() => {
  setFilesRoot(null);
  fs.rmSync(filesDir, { recursive: true, force: true });
});

describe('imported projects open on every project screen', () => {
  it.each(SCREENS)('%s', async (screen) => {
    const mod = (await import(`@/app/(app)/projects/[code]/${screen}/page.tsx`)) as { default: PageFn };
    for (const code of codes) {
      for (const [role, lang] of [['director', 'fr'], ['pm', 'en']] as const) {
        session.role = role;
        session.lang = lang;
        try {
          await mod.default({ params: Promise.resolve({ code }), searchParams: Promise.resolve({}) });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/^(REDIRECT|NOT_FOUND)/.test(msg)) continue;
          throw new Error(`${screen} · ${code} · ${role}: ${msg}`);
        }
      }
    }
    expect(codes).toHaveLength(2);
  }, 60_000);
});
