// R-111 (NEW-D4-5 = c): the BOM flags a possible duplicate — a purchased line and an assembly line with the same customs code
// and catalogue price, neither in the other's structure (on the seed, EQ-CRN-250T and ASM-RMG-250 on HLT-026) — for the
// engineering office to check: a note on both flat-list lines, a qualitative note under the KPI tiles (never an amount), the
// part drawer on a project screen; no value changes, no dismiss. Pure rule, then the seeded in-memory database.
import { createElement as h, type ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/HLT-026/bom',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('./actions', () => ({ addBomArticleAction: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => 'HLT-026',
  };
});

import { renderToStaticMarkup } from 'react-dom/server';
import { bomSummary, possibleDuplicates } from '@/domain/bom';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { bomDuplicatePartners, getProjectBom } from '@/server/dal/bom';
import { getBomScreen } from '@/server/dal/bom-screen';
import { PartDrawer, type PartDrawerPanelProps } from '@/features/plm/part-drawer';
import { BomBody } from './bom-view';
import { parseBomState } from './links';
import { bomScreenView } from './model';

const line = (ref: string, over: Partial<{ makeBuy: 'purchased' | 'manufactured'; type: string; hsCode: string | null; listPriceEur: number; quantity: number }> = {}) => ({
  ref, makeBuy: 'purchased' as const, type: 'heavy_equipment', hsCode: '8426.30', listPriceEur: 1_850_000, quantity: 2, ...over,
});

describe('R-111 rule', () => {
  const asm = line('ASM-1', { makeBuy: 'manufactured', type: 'assembly' });
  const none = () => [];

  it('pairs a purchased line with an assembly line of the same customs code and catalogue price', () => {
    expect(possibleDuplicates([line('EQ-1'), asm], none)).toEqual({ partners: { 'EQ-1': ['ASM-1'], 'ASM-1': ['EQ-1'] }, pairs: 1 });
    // A part with components is an assembly whatever its type.
    const kids = (r: string) => (r === 'SYS-1' ? [{ ref: 'CMP-1', q: 1 }] : []);
    expect(possibleDuplicates([line('EQ-1'), line('SYS-1', { makeBuy: 'manufactured', type: 'mechanical' })], kids).pairs).toBe(1);
  });

  it('no flag: another code or price, no code, two purchased lines, a part inside the assembly, a line at quantity 0', () => {
    expect(possibleDuplicates([line('EQ-1', { hsCode: '8426.20' }), asm], none).pairs).toBe(0);
    expect(possibleDuplicates([line('EQ-1', { listPriceEur: 1_849_999 }), asm], none).pairs).toBe(0);
    expect(possibleDuplicates([line('EQ-1', { hsCode: null }), { ...asm, hsCode: null }], none).pairs).toBe(0);
    expect(possibleDuplicates([line('EQ-1'), line('EQ-2')], none).pairs).toBe(0);
    expect(possibleDuplicates([line('EQ-1'), asm], (r) => (r === 'ASM-1' ? [{ ref: 'SUB-1', q: 1 }] : r === 'SUB-1' ? [{ ref: 'EQ-1', q: 2 }] : [])).pairs).toBe(0);
    expect(possibleDuplicates([line('EQ-1', { quantity: 0 }), asm], none).pairs).toBe(0);
  });
});

describe('R-111 on the seed (HLT-026)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('EQ-CRN-250T and ASM-RMG-250 flag each other; the values do not move', async () => {
    const bom = (await getProjectBom('HLT-026'))!;
    const of = (ref: string) => bom.lines.find((l) => l.ref === ref)!.possibleDuplicateOf;
    expect([of('EQ-CRN-250T'), of('ASM-RMG-250')]).toEqual([['ASM-RMG-250'], ['EQ-CRN-250T']]);
    expect(bom.lines.filter((l) => l.possibleDuplicateOf.length).map((l) => l.ref).sort()).toEqual(['ASM-RMG-250', 'EQ-CRN-250T']);
    expect(bom.summary.possibleDuplicates).toBe(1);
    expect(bom.summary).toEqual({ ...bomSummary(bom.lines), possibleDuplicates: 1 });
    expect((await getProjectBom('NDC-031'))?.summary.possibleDuplicates ?? 0).toBe(0);
    expect([await bomDuplicatePartners('HLT-026', 'EQ-CRN-250T'), await bomDuplicatePartners('HLT-026', 'EL-VFD-200'), await bomDuplicatePartners('NDC-031', 'EQ-CRN-250T')])
      .toEqual([['ASM-RMG-250'], [], []]);
  });

  it.each(['en', 'fr'] as Lang[])('%s: flat-list notes on both lines (the assembly keeps its own), a qualitative note under the KPIs', async (lang) => {
    const state = parseBomState({});
    const data = (await getBomScreen('HLT-026', { view: state.view, used: state.used, system: state.sys }))!;
    const view = bomScreenView('HLT-026', state, data, { canEdit: true, canRaiseEco: true }, makeT(lang), lang);
    const row = (ref: string) => view.flat!.rows.find((r) => r.ref === ref)!;
    const fr = lang === 'fr';
    expect(row('EQ-CRN-250T').duplicate).toBe(fr ? 'Doublon possible de ASM-RMG-250 · à vérifier par le bureau d’études' : 'Possible duplicate of ASM-RMG-250 · to be checked by the engineering office');
    expect(row('ASM-RMG-250').duplicate).toBe(fr ? 'Doublon possible de EQ-CRN-250T · à vérifier par le bureau d’études' : 'Possible duplicate of EQ-CRN-250T · to be checked by the engineering office');
    expect(row('ASM-RMG-250').totalNote).not.toBeNull();
    expect(row('EL-VFD-200').duplicate).toBeNull();
    expect(view.duplicates).toBe(fr ? '1 doublon possible · la valeur de la nomenclature peut le compter deux fois' : '1 possible duplicate · the BOM value may count it twice');
    expect(view.duplicates).not.toMatch(/€|k€|M€/);
    const html = renderToStaticMarkup(h(I18nProvider, { lang, children: h(BomBody, { view, canEdit: true }) as ReactElement }));
    expect(html).toContain(view.duplicates!);
    expect(html).toContain(row('EQ-CRN-250T').duplicate!);
  });

  it('the part drawer says it on a project screen only', async () => {
    const el = (await PartDrawer({ partRef: 'EQ-CRN-250T', projectCode: 'HLT-026', closeHref: '/projects/HLT-026/bom' })) as ReactElement<PartDrawerPanelProps>;
    expect(el.props.view.duplicate).toBe('Possible duplicate of ASM-RMG-250 · to be checked by the engineering office');
    const global = (await PartDrawer({ partRef: 'EQ-CRN-250T', closeHref: '/reference/parts' })) as ReactElement<PartDrawerPanelProps>;
    expect(global.props.view.duplicate).toBeNull();
  });
});
