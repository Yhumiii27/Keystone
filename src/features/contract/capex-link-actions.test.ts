// R-190 (Arche K-05): "CAPEX link" of the Contract screen — the Server Function's rights (the director and the project's leads,
// not Finance nor a team member, never on a read-only project), validation (Arche's formats), the write with its audit row and
// activity event, and the link published at the end of pub_projets. Session and project context are mocked; the viewer is the actor.
import { sql } from 'drizzle-orm';
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

import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getCapexLink } from '@/server/dal/capex-link';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { setCapexLinkAction } from './actions';
import { CapexLinkCard } from './contract-view';

const card = (lang: Lang, canEdit: boolean, link: { capexCode: string | null; needRef: string | null } = { capexCode: 'CPX-SAI-2026-01', needRef: null }) =>
  renderToStaticMarkup(h(I18nProvider, { lang, children: h(CapexLinkCard, { link, code: 'HLT-026', canEdit, t: makeT(lang) }) }));

const REFUSED = { error: 'Only the project’s leads and the director set the CAPEX link' };

beforeAll(async () => setDb(await openDatabase()), 60_000);

describe('setCapexLinkAction (R-190)', () => {
  it('refuses Finance, a team member who is not a lead, and a read-only project', async () => {
    Object.assign(viewer, { name: 'Claire Dumas', role: 'finance', lead: false, edit: true });
    expect(await setCapexLinkAction('HLT-026', 'CPX-SAI-2026-01', '')).toEqual(REFUSED);
    Object.assign(viewer, { name: 'Romain Aubert', role: 'member', lead: false });
    expect(await setCapexLinkAction('HLT-026', 'CPX-SAI-2026-01', '')).toEqual(REFUSED);
    Object.assign(viewer, { role: 'pm', lead: true, edit: false });
    expect(await setCapexLinkAction('HLT-026', 'CPX-SAI-2026-01', '')).toEqual(REFUSED);
    expect(await getCapexLink('HLT-026')).toEqual({ capexCode: null, needRef: null });
  });

  it('validates the formats and the input', async () => {
    Object.assign(viewer, { name: 'Romain Aubert', role: 'pm', lead: true, edit: true });
    expect(await setCapexLinkAction('HLT-026', 'CAPEX-1', '')).toEqual({ error: 'Enter a CAPEX code like CPX-SAI-2026-01' });
    expect(await setCapexLinkAction('HLT-026', 'CPX-SAI-2026-01', 'CPX-APM-2026-01/B01')).toEqual({ error: 'The need belongs to another CAPEX' });
    expect(await setCapexLinkAction('NOPE-000', 'CPX-SAI-2026-01', '')).toEqual({ error: 'Unknown project' });
    expect(await setCapexLinkAction('HLT-026', 42 as unknown as string, '')).toEqual({ error: 'Invalid request' });
  });

  it('the PM of record sets it: stored, audited, in the activity feed and in pub_projets; empty clears', async () => {
    expect(await setCapexLinkAction('HLT-026', 'cpx-sai-2026-01', 'cpx-sai-2026-01/b01')).toEqual({ ok: true });
    expect(await getCapexLink('HLT-026')).toEqual({ capexCode: 'CPX-SAI-2026-01', needRef: 'CPX-SAI-2026-01/B01' });
    expect((await listAudit())[0]).toMatchObject({ object: 'HLT-026', change: 'CAPEX link: — → CPX-SAI-2026-01 · CPX-SAI-2026-01/B01' });
    expect((await listActivity()).some((e) => e.what === 'CAPEX link: — → CPX-SAI-2026-01 · CPX-SAI-2026-01/B01')).toBe(true);
    const db = await getDb();
    const [row] = (await db.execute(sql`select capex_code, besoin_ref from pub_projets where code = 'HLT-026'`)).rows;
    expect(row).toEqual({ capex_code: 'CPX-SAI-2026-01', besoin_ref: 'CPX-SAI-2026-01/B01' });
    // The director clears it.
    Object.assign(viewer, { name: 'Hélène Marchetti', role: 'director', lead: true });
    expect(await setCapexLinkAction('HLT-026', '', '')).toEqual({ ok: true });
    expect(await getCapexLink('HLT-026')).toEqual({ capexCode: null, needRef: null });
  });

  it('the card: the link for everyone, the editor for the leads only (EN / FR)', () => {
    const fr = card('fr', true);
    expect(fr).toContain('Rattachement CAPEX');
    expect(fr).toContain('Aucun besoin machine');
    expect(fr).toContain('Enregistrer le rattachement');
    expect(fr).toContain('value="CPX-SAI-2026-01"');
    const ro = card('en', false, { capexCode: null, needRef: null });
    expect(ro).toContain('No CAPEX');
    expect(ro).not.toContain('<form');
  });
});
