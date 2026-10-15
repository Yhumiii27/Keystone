// Delivery 8 integration review (contract-rates) — R-046: Activity & integrations (/admin/integrations, read-only outside the
// workspace for every internal role, P-1 = a) and its export must not give rate values to the roles that do not see rates
// (`canSeeRates`: director, PM, Finance). A grid change writes its values in the audit row only — the activity text has none —
// and the "Rate card" audit changes (the seeded one included) and older feed events with values are masked ("•••") for the
// others, on the screen and in the export. Before the fix the feed read "Rate card · Planner base: 74 → 78 €/h from 1 Nov 2026"
// and the trail showed the values to every internal role.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string };
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  usePathname: () => '/',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./actions', () => ({}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: 'en', t: makeT('en') }),
    getLang: async () => 'en',
    getLastProject: async () => 'HLT-026',
    getZone: async () => null,
    getNavOpen: async () => ({}),
  };
});

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import IntegrationsPage from '@/app/(app)/admin/integrations/page';
import { PERSONAS } from '@/config/personas';
import { MASK, canSeeRates } from '@/domain/hr';
import { getDb, setDb } from '@/server/db/client';
import { recordActivity } from '@/server/db/helpers';
import { openDatabase } from '@/server/db/open';
import { setBaseRate, setMultiplier } from '@/server/dal/hr';
import { buildExportContext, runExport } from '@/server/export/run';
import { readXlsx } from '@/server/export/xlsx';
import '@/server/export/providers';
import type { PlumbingView } from './model';

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
async function view(sp: Record<string, string>): Promise<PlumbingView> {
  const tree = (await IntegrationsPage({ searchParams: Promise.resolve(sp) })) as El;
  const kids = tree.props.children;
  const body = ((Array.isArray(kids) ? kids : [kids]) as unknown[]).find((k) => isValidElement(k) && (k.type as { name?: string }).name === 'PlumbingBody') as El;
  return body.props.view as PlumbingView;
}
/** A rate value: "78 €/h", "×1.6", or a change "74 → 78". */
const VALUE = /€\/h|×\s*\d|\d\s*→\s*\d/;

beforeAll(async () => {
  setDb(await openDatabase());
  const director = { name: 'Marie Lefebvre', role: 'director' };
  await setBaseRate('Planner', 78, '2026-11-01', director);
  await setMultiplier('sat', 1.6, '2027-01-01', director);
  // A feed event with values, as written before the fix.
  await recordActivity(await getDb(), { actorName: 'Léa Marchand', text: 'Rate card · Planner base: 74 → 79 €/h from 1 Dec 2026', kind: 'change', occurredAt: new Date('2026-09-28T09:00:00Z') });
}, 60_000);

describe('R-046 — rate values on Activity & integrations, for the 9 personas', () => {
  for (const persona of PERSONAS)
    it(persona.role, async () => {
      session.role = persona.role;
      if (persona.role === 'client') {
        // R-042 (P-1): outside the client's workspace — sent home; no export.
        await expect(view({})).rejects.toThrow('REDIRECT /');
        await expect(buildExportContext({ screen: 'plumbing', viewer: persona, lang: 'en', params: new URLSearchParams() })).rejects.toMatchObject({ status: 403 });
        return;
      }
      const sees = canSeeRates(persona.role);
      const feed = (await view({})).activity.map((a) => a.what);
      const trail = (await view({ view: 'audit' })).audit.filter((a) => a.object === 'Rate card').map((a) => a.change);
      // The new events never carry values; everyone reads that the grid changed.
      expect(feed).toContain('Rate card · Planner base changed from 1 Nov 2026');
      expect(feed).toContain('Rate card · Saturday multiplier changed from 1 Jan 2027');
      expect(trail.length).toBeGreaterThanOrEqual(3);

      const ctx = await buildExportContext({ screen: 'plumbing', viewer: persona, lang: 'en', params: new URLSearchParams(), now: new Date('2026-10-09T08:00:00Z') });
      const sheets = await readXlsx((await runExport(ctx, 'xlsx')).body);
      const column = (name: string, header: string) => {
        const s = sheets.find((x) => x.name === name)!;
        return s.rows.slice(1).map((r) => String(r[s.rows[0].indexOf(header)] ?? ''));
      };
      const xFeed = column('Activity feed', 'What').filter((w) => w.startsWith('Rate card · '));
      const xTrail = column('Audit trail', 'Change').filter((_, n) => column('Audit trail', 'Object')[n] === 'Rate card');
      expect(xTrail.length).toBe(trail.length);

      if (sees) {
        expect(trail).toEqual(expect.arrayContaining(['Planner base: 74 → 78 €/h from 1 Nov 2026', 'Saturday multiplier: ×1.5 → ×1.6 from 1 Jan 2027', 'Structural engineer base: 82 → 85 €/h']));
        expect(feed).toContain('Rate card · Planner base: 74 → 79 €/h from 1 Dec 2026');
        expect(xTrail).toEqual(expect.arrayContaining(['Planner base: 74 → 78 €/h from 1 Nov 2026']));
        return;
      }
      expect([persona.role, trail.filter((c) => c !== MASK)]).toEqual([persona.role, []]);
      expect([persona.role, xTrail.filter((c) => c !== MASK)]).toEqual([persona.role, []]);
      expect([persona.role, feed.filter((w) => w.startsWith('Rate card · ') && VALUE.test(w))]).toEqual([persona.role, []]);
      expect([persona.role, xFeed.filter((w) => VALUE.test(w))]).toEqual([persona.role, []]);
      expect(feed).toContain(`Rate card · ${MASK}`);
    });
});
