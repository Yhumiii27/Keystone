// R-189 (Arche K-04): the automatic mapping of schedule milestones to Arche's CAPEX milestones — the name patterns (French and
// English), the ambiguity rules, the code typed on the Schedule screen, and the backfill migration carrying the same patterns.
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { CAPEX_MILESTONE_CODES, CAPEX_MILESTONE_PATTERNS, autoCapexMilestoneCodes, capexCodesOfName, parseCapexMilestoneCode } from './capex-milestones';

/** Names and the codes they match (also run against PostgreSQL's `~*` below: the backfill migration's engine). */
const NAME_CASES: [string, string[]][] = [
  ['Commande', ['commande']],
  ['Commande client reçue', ['commande']],
  ['Order received', ['commande']],
  ['Contract signed', ['commande']],
  ['Signature du contrat', ['commande']],
  ['Kick-off meeting', ['commande']],
  ['Commande moteurs', []],
  ['Fin des études', ['fin_etudes']],
  ['Fin d’études', ['fin_etudes']],
  ['Design freeze', ['fin_etudes']],
  ['Survey & design complete', ['fin_etudes']],
  ['Design & prototyping complete', []],
  ['FAT', ['fat']],
  ['FAT passée', ['fat']],
  ['Factory acceptance test', ['fat']],
  ['Essais usine', ['fat']],
  ['Réception en usine', ['fat']],
  ['Expédition', ['expedition']],
  ['Shipment to site', ['expedition']],
  ['Départ usine', ['expedition']],
  ['Arrivée sur site', ['arrivee_site']],
  ['Arrivée du matériel sur site', ['arrivee_site']],
  ['Delivery to site', ['arrivee_site']],
  ['Livraison chantier', ['arrivee_site']],
  ['SAT', ['sat']],
  ['Site acceptance test', ['sat']],
  ['Mise en service', ['sat']],
  ['Commissioning complete', ['sat']],
  ['Commissioning & IST complete', ['sat']],
  ['Satellite link', []],
  ['PV de réception', ['pv_reception']],
  ['PV', ['pv_reception']],
  ['Réception provisoire', ['pv_reception']],
  ['Handover', ['pv_reception']],
  ['Acceptance & handover complete', ['pv_reception']],
  ['PV modules complete', []],
  ['Fin de garantie', ['fin_garantie']],
  ['End of warranty', ['fin_garantie']],
  ['Réception définitive', ['fin_garantie']],
  ['Final acceptance', ['fin_garantie']],
  // Ambiguous: two codes.
  ['Commissioning & handover complete', ['sat', 'pv_reception']],
  ['Expédition et arrivée sur site', ['expedition', 'arrivee_site']],
  // Not CAPEX milestones.
  ['Permits approved', []],
  ['Foundations complete', []],
  ['Cranes operational', []],
  ['Cutover & hypercare complete', []],
];

describe('capexCodesOfName (R-189)', () => {
  it.each(NAME_CASES)('%s → %j', (name, codes) => {
    expect(capexCodesOfName(name)).toEqual(codes);
  });
  it('is case-insensitive', () => {
    expect(capexCodesOfName('mise EN SERVICE')).toEqual(['sat']);
    expect(capexCodesOfName('ARRIVÉE SUR SITE')).toEqual(['arrivee_site']);
  });
});

describe('autoCapexMilestoneCodes (R-189)', () => {
  const m = (id: string, name: string, capexCode: (typeof CAPEX_MILESTONE_CODES)[number] | null = null) => ({ id, name, capexCode });

  it('tags the unambiguous milestones of the demo projects', () => {
    // HLT-026: only « Handover » is a CAPEX milestone.
    const hlt = ['Permits approved', 'Foundations complete', 'Structure topped out', 'Cranes operational', 'Systems energised', 'Handover'].map((n, i) => m(`h${i}`, n));
    expect([...autoCapexMilestoneCodes(hlt)]).toEqual([['h5', 'pv_reception']]);
    // RCF-019: « Commissioning & handover complete » matches SAT and PV → left to the leads.
    const rcf = ['MEP — electrical & medical gas complete', 'Fire systems complete', 'Commissioning & handover complete'].map((n, i) => m(`r${i}`, n));
    expect(autoCapexMilestoneCodes(rcf).size).toBe(0);
  });

  it('two milestones matching the same code: neither is tagged', () => {
    expect(autoCapexMilestoneCodes([m('a', 'FAT lot 1'), m('b', 'FAT lot 2'), m('c', 'Expédition')])).toEqual(new Map([['c', 'expedition']]));
  });

  it('a code already held stays where it is; tagged milestones are never retagged', () => {
    expect(autoCapexMilestoneCodes([m('a', 'Essais usine', 'sat'), m('b', 'Mise en service'), m('c', 'FAT')])).toEqual(new Map([['c', 'fat']]));
    // The ambiguous milestone does not block the other candidate.
    expect(autoCapexMilestoneCodes([m('a', 'Commissioning & handover complete'), m('b', 'SAT')])).toEqual(new Map([['b', 'sat']]));
  });
});

describe('parseCapexMilestoneCode (R-189)', () => {
  it('accepts the eight codes, clears on empty, refuses anything else', () => {
    for (const c of CAPEX_MILESTONE_CODES) expect(parseCapexMilestoneCode(c)).toEqual({ ok: true, value: c });
    expect(parseCapexMilestoneCode('')).toEqual({ ok: true, value: null });
    expect(parseCapexMilestoneCode('SAT')).toEqual({ ok: false, error: 'Invalid request' });
    expect(parseCapexMilestoneCode(3)).toEqual({ ok: false, error: 'Invalid request' });
  });
});

describe('0056_capex_milestone_backfill (R-189)', () => {
  it('carries exactly the TypeScript patterns, one CASE per code', () => {
    const file = fs.readFileSync(path.join(process.cwd(), 'drizzle', '0056_capex_milestone_backfill.sql'), 'utf8');
    for (const c of CAPEX_MILESTONE_CODES) {
      const pattern = CAPEX_MILESTONE_PATTERNS[c];
      expect(pattern).not.toMatch(/[\\']/); // the same string is valid in a SQL literal and in both regex engines
      expect(file).toContain(`CASE WHEN m."name" ~* '${pattern}' THEN '${c}' END`);
    }
    expect(file.match(/CASE WHEN m\."name" ~\*/g)).toHaveLength(CAPEX_MILESTONE_CODES.length);
  });
});

describe('the patterns read the same in PostgreSQL (R-189)', () => {
  it('`~*` gives every name the codes JavaScript gives it', async () => {
    const pg = new PGlite();
    try {
      for (const [name] of [...NAME_CASES, ['ARRIVÉE SUR SITE'], ['mise EN SERVICE']] as [string][]) {
        const got: string[] = [];
        for (const c of CAPEX_MILESTONE_CODES) {
          const r = await pg.query<{ m: boolean }>('select $1 ~* $2 as m', [name, CAPEX_MILESTONE_PATTERNS[c]]);
          if (r.rows[0].m) got.push(c);
        }
        expect(got, name).toEqual(capexCodesOfName(name));
      }
    } finally {
      await pg.close();
    }
  }, 30_000);
});
