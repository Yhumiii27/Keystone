// ING-29 (owner, 27 Nov 2026): a confidential project (demo: FTU-052, team A. Naveau, Antoine Girard, Marie Lefebvre) is absent
// for everybody else — register, switcher pool, search, current project — and its pages answer 404; outside a request nothing
// is hidden (system reads). The confidentiality change is audited.
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERSONAS } from '@/config/personas';

const jar = new Map<string, string>();
let inRequest = true;
vi.mock('next/headers', () => ({
  cookies: async () => {
    if (!inRequest) throw new Error('`cookies` was called outside a request scope. Read more: https://nextjs.org/docs/messages/next-dynamic-api-wrong-context');
    return { get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) };
  },
}));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  redirect: (u: string) => { throw new Error(`NEXT_REDIRECT ${u}`); },
}));

const { setDb } = await import('@/server/db/client');
const { openDatabase } = await import('@/server/db/open');
const { auditEntries, projects } = await import('@/server/db/schema');
const { listProjects, listAllProjects, getProject } = await import('./projects');
const { hiddenProjectsFor } = await import('./project-visibility');
const { setProjectConfidentiality } = await import('./project-confidentiality');
const { searchShell } = await import('./shell');
const { getProjectContext } = await import('@/server/project-context');
const { resolveCurrentProject } = await import('./current-project');

type DB = Awaited<ReturnType<typeof openDatabase>>;
let db: DB;
const as = (role: string) => jar.set('ks-role', role);
const TEAM_ROLES = new Set(['director', 'englead']);

beforeAll(async () => {
  db = await openDatabase();
  setDb(db);
}, 60_000);
beforeEach(() => { jar.clear(); inRequest = true; });

describe('confidential project FTU-052 (demo)', () => {
  it('is stored confidential and R&D', async () => {
    const [p] = await db.select({ c: projects.confidentiality, cat: projects.category }).from(projects).where(eq(projects.code, 'FTU-052'));
    expect(p).toEqual({ c: 'confidential', cat: 'rd' });
  });

  it('is in the register only for its team, for every persona', async () => {
    for (const p of PERSONAS) {
      const hidden = await hiddenProjectsFor(p);
      expect(hidden.codes.has('FTU-052'), p.role).toBe(!TEAM_ROLES.has(p.role));
      expect([...hidden.codes].filter((c) => c !== 'FTU-052'), p.role).toEqual([]);
    }
  });

  it('a non-member: absent from listProjects, getProject null, 404 on its pages, not found by the search, never the current project', async () => {
    as('pm');
    expect((await listProjects()).some((p) => p.code === 'FTU-052')).toBe(false);
    expect(await getProject('FTU-052')).toBeNull();
    await expect(getProjectContext('FTU-052')).rejects.toThrow('NEXT_NOT_FOUND');
    expect((await searchShell('Fleet Telematics', 'HLT-026')).filter((h) => h.kind === 'Project')).toEqual([]);
    expect(await resolveCurrentProject('FTU-052')).not.toBe('FTU-052');
  });

  it('a member sees it, flagged confidential', async () => {
    as('englead');
    const p = (await listProjects()).find((x) => x.code === 'FTU-052');
    expect(p?.confidential).toBe(true);
    expect((await getProjectContext('FTU-052')).project.code).toBe('FTU-052');
  });

  it('outside a request (jobs, publications) nothing is hidden', async () => {
    inRequest = false;
    expect((await listProjects()).some((p) => p.code === 'FTU-052')).toBe(true);
    expect((await listAllProjects()).length).toBe((await listProjects()).length);
  });

  it('setting the confidentiality is audited (before / after) and makes the project visible again', async () => {
    await setProjectConfidentiality('FTU-052', 'normal', { name: 'Antoine Girard', role: 'englead' });
    const rows = await db.select().from(auditEntries).where(eq(auditEntries.objectRef, 'FTU-052'));
    const last = rows.find((r) => (r.after as { confidentiality?: string } | null)?.confidentiality === 'normal');
    expect(last?.before).toEqual({ confidentiality: 'confidential' });
    expect((await hiddenProjectsFor(PERSONAS.find((p) => p.role === 'pm')!)).codes.size).toBe(0);
    await setProjectConfidentiality('FTU-052', 'confidential', { name: 'Antoine Girard', role: 'englead' });
    await expect(setProjectConfidentiality('FTU-052', 'secret', { name: 'Antoine Girard', role: 'englead' })).rejects.toThrow();
  });
});
