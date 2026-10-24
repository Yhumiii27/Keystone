// R-190 (Arche K-05): the project's client as a group subsidiary — the Contract screen's "Client" card and its Server Function
// (the director only, never on a project whose Contract they may not edit), validation, the write with its audit row and activity
// event, pub_projets (client_interne, filiale_code, maj_le), the client portal closed to an internal client (R-179, I-2b), and the
// client of a project created from a subsidiary's need. Session and project context are mocked; the viewer is the actor.
import { eq, sql } from 'drizzle-orm';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Romain Aubert', role: 'pm', lead: true, edit: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/contract', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name, role: viewer.role }, access: { lead: viewer.lead }, canEdit: () => viewer.edit }),
}));

import { projectAccess } from '@/domain/rights';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { clients, projects } from '@/server/db/schema';
import { resolveCurrentProject } from '@/server/dal/current-project';
import { getProjectClient, listSubsidiaries, markNeedSubsidiaryClient } from '@/server/dal/internal-client';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { listProjects } from '@/server/dal/projects';
import { setInternalClientAction } from './actions';
import { ProjectClientCard } from './contract-view';

const REFUSED = { error: 'Only the director sets whether the client is a group subsidiary' };
const PORT = { role: 'client' as const, short: 'Client', name: 'Client', personId: null, organisation: 'Port authority' };

const shared = async () => {
  const db = await getDb();
  return (await db.execute(sql`select code, client_interne, filiale_code, maj_le from pub_projets where client = 'Port authority' order by code`)).rows as {
    code: string; client_interne: boolean; filiale_code: string | null; maj_le: unknown;
  }[];
};

const card = (lang: Lang, canEdit: boolean, client: { name: string; isInternal: boolean; subsidiaryCode: string | null }) =>
  renderToStaticMarkup(h(I18nProvider, {
    lang, children: h(ProjectClientCard, { client, code: 'HLT-026', canEdit, subsidiaries: [{ code: 'SAI', name: 'Sahel Agro Industries' }], t: makeT(lang), lang }),
  }));

beforeAll(async () => setDb(await openDatabase()), 60_000);

describe('setInternalClientAction (R-190)', () => {
  it('refuses a project manager (even a lead), Finance, and a project whose Contract the director may not edit', async () => {
    expect(await setInternalClientAction('HLT-026', true, '')).toEqual(REFUSED);
    Object.assign(viewer, { name: 'Claire Dumas', role: 'finance', lead: false });
    expect(await setInternalClientAction('HLT-026', true, '')).toEqual(REFUSED);
    Object.assign(viewer, { name: 'Hélène Marchetti', role: 'director', lead: true, edit: false });
    expect(await setInternalClientAction('HLT-026', true, '')).toEqual(REFUSED);
    expect(await getProjectClient('HLT-026')).toMatchObject({ name: 'Port authority', isInternal: false, subsidiaryCode: null });
  });

  it('validates the input; one client per subsidiary', async () => {
    viewer.edit = true;
    expect(await setInternalClientAction('HLT-026', 'yes' as unknown as boolean, '')).toEqual({ error: 'Invalid request' });
    expect(await setInternalClientAction('NOPE-000', true, '')).toEqual({ error: 'Unknown project' });
    expect(await setInternalClientAction('HLT-026', false, 'SAI')).toEqual({ error: 'Only an internal client has a subsidiary code' });
    expect(await setInternalClientAction('HLT-026', true, 'S4I')).toEqual({ error: 'Choose a subsidiary code of three capital letters' });
    // SAI is the demo's internal client Sahel Agro Industries.
    expect(await setInternalClientAction('HLT-026', true, 'SAI')).toEqual({ error: 'This subsidiary is already another client' });
    expect(await getProjectClient('HLT-026')).toMatchObject({ isInternal: false, subsidiaryCode: null });
  });

  it('the director flags the client: every project of the client in pub_projets (maj_le moved), audited, in the activity feed', async () => {
    const before = await shared();
    expect(before.map((r) => [r.code, r.client_interne, r.filiale_code])).toEqual([['HLT-026', false, null], ['PRS-038', false, null], ['QFR-015', false, null]]);
    expect(await setInternalClientAction('HLT-026', true, 'pag')).toEqual({ ok: true });
    expect(await getProjectClient('HLT-026')).toMatchObject({ name: 'Port authority', isInternal: true, subsidiaryCode: 'PAG' });
    const after = await shared();
    expect(after.map((r) => [r.code, r.client_interne, r.filiale_code])).toEqual([['HLT-026', true, 'PAG'], ['PRS-038', true, 'PAG'], ['QFR-015', true, 'PAG']]);
    expect(after.every((r, i) => String(r.maj_le) !== String(before[i].maj_le))).toBe(true);
    expect((await listAudit())[0]).toMatchObject({ object: 'Port authority', change: 'Client Port authority marked internal · group subsidiary PAG' });
    expect((await listActivity()).some((e) => e.what === 'Client Port authority marked internal · group subsidiary PAG')).toBe(true);
    expect((await listSubsidiaries()).map((s) => s.code)).toEqual(['APM', 'PAG', 'SAI']);
  });

  it('the client portal is closed to an internal client (R-179, I-2b): no project, no current project', async () => {
    const hlt = (await listProjects()).find((p) => p.code === 'HLT-026')!;
    expect(hlt.clientInternal).toBe(true);
    expect(projectAccess(PORT, { ...hlt, team: [] })).toMatchObject({ refused: true, member: false });
    expect(await resolveCurrentProject('HLT-026', PORT)).toBeNull();
    // Back to external: the portal finds its project again; the database refuses a code on an external client.
    expect(await setInternalClientAction('HLT-026', false, '')).toEqual({ ok: true });
    expect((await listProjects()).find((p) => p.code === 'HLT-026')!.clientInternal).toBeUndefined();
    expect(await resolveCurrentProject('HLT-026', PORT)).toBe('HLT-026');
    expect((await listAudit())[0]).toMatchObject({ change: 'Client Port authority marked external' });
    const db = await getDb();
    await expect(db.update(clients).set({ subsidiaryCode: 'PAG' }).where(eq(clients.name, 'Port authority'))).rejects.toThrow();
  });

  it('a project created from a subsidiary’s need: its client named as Arche names the subsidiary becomes internal with the code (R-187)', async () => {
    const db = await getDb();
    const [{ id: clientId }] = await db.insert(clients).values({ name: 'Atlas Process Maroc', sortOrder: 999 }).returning({ id: clients.id });
    const [ndc] = await db.update(projects).set({ clientId }).where(eq(projects.code, 'NDC-031')).returning({ id: projects.id });
    const who = { actorName: 'Hélène Marchetti', actorPersonId: null };
    expect(await db.transaction((tx) => markNeedSubsidiaryClient(tx, ndc.id, 'CPX-APM-2026-01', who))).toBe(true);
    expect(await getProjectClient('NDC-031')).toMatchObject({ name: 'Atlas Process Maroc', isInternal: true, subsidiaryCode: 'APM' });
    expect(await db.transaction((tx) => markNeedSubsidiaryClient(tx, ndc.id, 'CPX-APM-2026-01', who))).toBe(false);
    // Another client (not the subsidiary) is left as it is.
    const [rcf] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'RCF-019'));
    expect(await db.transaction((tx) => markNeedSubsidiaryClient(tx, rcf.id, 'CPX-SAI-2026-01', who))).toBe(false);
    expect(await getProjectClient('RCF-019')).toMatchObject({ name: 'Health trust', isInternal: false });
  });

  it('the card: the badge for everyone, the editor for the director only (EN / FR)', () => {
    const fr = card('fr', true, { name: 'Sahel Agro Industries', isInternal: true, subsidiaryCode: 'SAI' });
    expect(fr).toContain('Interne');
    expect(fr).toContain('Filiale du groupe');
    expect(fr).toContain('Enregistrer le type de client');
    expect(fr).toContain('SAI · Sahel Agro Industries');
    const ro = card('en', false, { name: 'Health trust', isInternal: false, subsidiaryCode: null });
    expect(ro).toContain('External client');
    expect(ro).not.toContain('Internal');
    expect(ro).not.toContain('<form');
  });
});
